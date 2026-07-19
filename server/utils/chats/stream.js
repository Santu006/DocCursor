const { v4: uuidv4 } = require("uuid");
const { DocumentManager } = require("../DocumentManager");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { WorkspaceParsedFiles } = require("../../models/workspaceParsedFiles");
const { getVectorDbClass, resolveProviderConnector } = require("../helpers");
const {
  writeResponseChunk,
} = require("../helpers/chat/responses");
const { grepAgents } = require("./agents");
const {
  grepCommand,
  VALID_COMMANDS,
  chatPrompt,
  recentChatHistory,
  sourceIdentifier,
} = require("./index");
const {
  performWorkspaceSimilaritySearch,
  mergeRetrievalIntoContext,
  applyProjectWideSystemPrompt,
} = require("./projectWideRetrieval");
const {
  performDocumentDiffAnalysis,
  DOCUMENT_DIFF_SYSTEM_PROMPT,
} = require("./documentDiffRetrieval");
const {
  performWorkspaceGraphQuery,
  WORKSPACE_GRAPH_SYSTEM_PROMPT,
} = require("./workspaceGraphRetrieval");
const {
  resolveContextRouting,
  buildRoutedUserPrompt,
  applyContextAvailableInstructions,
  isInvalidNoAccessResponse,
} = require("./contextRouting");
const {
  loadSelectedDocumentContext,
  applyDocumentQaSystemPrompt,
} = require("./selectedDocumentContext");
const {
  performWorkspaceExactSearch,
  applyExactSearchSystemPrompt,
} = require("./workspaceExactSearch");
const {
  performWorkspaceAnalytics,
  applyAnalyticsSystemPrompt,
  ANALYTICS_SYSTEM_PROMPT,
} = require("./workspaceAnalytics");
const { createPipelineLogger } = require("./pipelineLogger");
const {
  performExecutiveReportQuery,
  EXECUTIVE_REPORT_SYSTEM_PROMPT,
} = require("./workspaceReportRetrieval");
const {
  performWorkspaceSummaryQuery,
  sanitizeResponseQuality,
  assembleHierarchicalResponse,
} = require("./workspaceSummaryRetrieval");

const VALID_CHAT_MODE = ["automatic", "chat", "query"];

async function persistChatTurn({
  workspace,
  message,
  responsePayload,
  thread,
  user,
  rerunChatId = null,
  include = true,
}) {
  return WorkspaceChats.saveResponse({
    workspaceId: workspace.id,
    prompt: message,
    response: responsePayload,
    threadId: thread?.id || null,
    user,
    existingChatId: rerunChatId,
    include,
  });
}

function abortPipeline(response, uuid, errorMessage) {
  writeResponseChunk(response, {
    id: uuid,
    type: "abort",
    textResponse: null,
    sources: [],
    close: true,
    error: errorMessage,
  });
}

async function runWorkspaceSummarySynthesis({
  workspaceSummaryResult,
  LLMConnector,
  workspace,
  user,
  rawHistory,
}) {
  const messages = await LLMConnector.compressMessages(
    {
      systemPrompt: workspaceSummaryResult.synthesisSystemPrompt,
      userPrompt: workspaceSummaryResult.synthesisUserPrompt,
      contextTexts: [],
      chatHistory: [],
      attachments: [],
    },
    rawHistory
  );

  let synthesisSections = "";
  let metrics = {};

  try {
    const result = await LLMConnector.getChatCompletion(messages, {
      temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
      user,
    });
    synthesisSections = result.textResponse;
    metrics = result.metrics || {};
  } catch (error) {
    console.error("[workspaceSummarySynthesis]", error);
    synthesisSections = workspaceSummaryResult.fallbackSynthesisSections;
  }

  if (!synthesisSections?.trim()) {
    synthesisSections = workspaceSummaryResult.fallbackSynthesisSections;
  }

  return {
    text: assembleHierarchicalResponse({
      deterministicPrefix: workspaceSummaryResult.deterministicPrefix,
      synthesisSections,
      recurringMetricsSection: workspaceSummaryResult.recurringMetricsSection,
    }),
    metrics,
  };
}

async function emitDirectChatResponse({
  response,
  uuid,
  text,
  sources = [],
  metrics = {},
  metadata = null,
  workspace,
  message,
  thread,
  user,
  rerunChatId,
  chatMode,
  attachments,
}) {
  const sanitizedText = sanitizeResponseQuality(text);

  writeResponseChunk(response, {
    uuid,
    sources,
    type: "textResponseChunk",
    textResponse: sanitizedText,
    close: true,
    error: false,
    metrics,
    ...(metadata ? { workspaceSummaryMetadata: metadata } : {}),
  });

  const { chat } = await persistChatTurn({
    workspace,
    message,
    responsePayload: {
      text: sanitizedText,
      sources,
      type: chatMode,
      attachments,
      metrics,
      ...(metadata ? { workspaceSummaryMetadata: metadata } : {}),
    },
    thread,
    user,
    rerunChatId,
  });

  writeResponseChunk(response, {
    uuid,
    type: "finalizeResponseStream",
    close: true,
    error: false,
    chatId: chat.id,
    metrics,
  });
}

async function streamChatWithWorkspace(
  response,
  workspace,
  message,
  chatMode = "automatic",
  user = null,
  thread = null,
  attachments = [],
  rerunChatId = null,
  selectedDocumentIds = []
) {
  const uuid = uuidv4();
  const pipeline = createPipelineLogger({
    workspaceSlug: workspace?.slug,
    workspaceId: workspace?.id,
  });

  try {
    pipeline.stage("routing_start");
    const updatedMessage = await grepCommand(message, user);

    if (Object.keys(VALID_COMMANDS).includes(updatedMessage)) {
      const data = await VALID_COMMANDS[updatedMessage](
        workspace,
        message,
        uuid,
        user,
        thread
      );
      writeResponseChunk(response, data);
      return;
    }

    const VectorDb = getVectorDbClass();
    const embeddingsCount = await VectorDb.namespaceCount(workspace.slug);
    pipeline.ok("workspace_found", {
      workspaceName: workspace?.name,
      embeddingsCount,
    });

    const routing = await resolveContextRouting({
      message: updatedMessage,
      workspaceId: workspace.id,
      workspaceName: workspace?.name || null,
      selectedDocumentIds,
      indexedDocumentCount: embeddingsCount,
    });
    pipeline.ok("documents_loaded", {
      selectedDocumentIds: routing.selectedDocumentIds,
      intent: routing.workspaceIntent,
      cleanMessage: routing.cleanMessage,
      parsedMentionCount: routing.parsedMentions?.length || 0,
    });

    const scopedDocumentIds = routing.selectedDocumentIds;
    const cleanMessage = routing.cleanMessage;
    const retrievalPlan = routing.retrievalPlan;
    let routedUserPrompt = buildRoutedUserPrompt({
      cleanMessage,
      selectedDocuments: routing.selectedDocuments,
      workspaceName: routing.workspaceName,
      indexedDocumentCount: routing.indexedDocumentCount,
      workspaceIntent: routing.workspaceIntent,
    });

    const isAgentChat = await grepAgents({
      uuid,
      response,
      message: cleanMessage,
      user,
      workspace,
      thread,
      attachments,
    });
    if (isAgentChat) return;

    const {
      connector: LLMConnector,
      routingMetadata,
      prefetchedContext,
      error: routerError,
    } = await resolveLLMConnector({
      workspace,
      message: cleanMessage,
      user,
      thread,
      attachments,
    });

    if (routerError) {
      pipeline.fail("model_router", new Error(routerError));
      return abortPipeline(response, uuid, routerError);
    }

    if (routingMetadata?.routedTo?.shouldNotify) {
      writeResponseChunk(response, {
        uuid: `${uuid}:route`,
        type: "modelRouteNotification",
        routedTo: routingMetadata.routedTo,
      });
    }

    const messageLimit = workspace?.openAiHistory || 20;
    const hasVectorizedSpace = await VectorDb.hasNamespace(workspace.slug);
    const hasSelectedDocuments = (scopedDocumentIds || []).length > 0;

    // Query mode with an empty vector index can still answer from selected
    // documents via direct file read (Cursor-style Q/A).
    if (
      (!hasVectorizedSpace || embeddingsCount === 0) &&
      chatMode === "query" &&
      !hasSelectedDocuments
    ) {
      const textResponse =
        workspace?.queryRefusalResponse ??
        "There is no relevant information in this workspace to answer your query.";
      writeResponseChunk(response, {
        id: uuid,
        type: "textResponse",
        textResponse,
        sources: [],
        attachments,
        close: true,
        error: null,
      });
      await persistChatTurn({
        workspace,
        message,
        responsePayload: {
          text: textResponse,
          sources: [],
          type: chatMode,
          attachments,
        },
        thread,
        user,
        rerunChatId,
        include: false,
      });
      return;
    }

    let completeText;
    let metrics = {};
    let contextTexts = [];
    let sources = [];
    let pinnedDocIdentifiers = [];

    const {
      rawHistory,
      chatHistory,
      pinnedDocs: prefetchedPinnedDocs,
      parsedFiles: prefetchedParsedFiles,
    } = prefetchedContext ??
    (await recentChatHistory({ user, workspace, thread, messageLimit }));

    const pinnedDocs =
      prefetchedPinnedDocs ??
      (await new DocumentManager({
        workspace,
        maxTokens: LLMConnector.promptWindowLimit(),
      }).pinnedDocs());
    pinnedDocs.forEach((doc) => {
      const { pageContent, ...metadata } = doc;
      pinnedDocIdentifiers.push(sourceIdentifier(doc));
      contextTexts.push(doc.pageContent);
      sources.push({
        text:
          pageContent.slice(0, 1_000) + "...continued on in source document...",
        ...metadata,
      });
    });

    const parsedFiles =
      prefetchedParsedFiles ??
      (await WorkspaceParsedFiles.getContextFiles(
        workspace,
        thread || null,
        user || null
      ));
    parsedFiles.forEach((doc) => {
      const { pageContent, ...metadata } = doc;
      contextTexts.push(doc.pageContent);
      sources.push({
        text:
          pageContent.slice(0, 1_000) + "...continued on in source document...",
        ...metadata,
      });
    });

    let workspaceSummaryResult = { handled: false };
    if (retrievalPlan.runWorkspaceSummary) {
      try {
        pipeline.stage("workspace_summary_start");
        workspaceSummaryResult = await performWorkspaceSummaryQuery({
          message: cleanMessage,
          workspace,
        });
        pipeline.ok("workspace_summary_complete", {
          handled: workspaceSummaryResult.handled,
        });
      } catch (error) {
        pipeline.fail("workspace_summary", error);
        return abortPipeline(
          response,
          uuid,
          `Workspace summary failed: ${error.message}`
        );
      }
    }

    if (workspaceSummaryResult.handled && workspaceSummaryResult.error) {
      return abortPipeline(response, uuid, workspaceSummaryResult.error);
    }

    if (
      workspaceSummaryResult.handled &&
      workspaceSummaryResult.synthesisRequired
    ) {
      pipeline.ok("prompt_built", { mode: "hierarchical_workspace_summary" });
      pipeline.beforeLlm({
        intent: routing.workspaceIntent,
        selectedDocumentIds: scopedDocumentIds,
        workspaceName: workspace?.name,
        retrievedChunkCount: 0,
        promptLength: workspaceSummaryResult.synthesisUserPrompt.length,
        promptPreview: workspaceSummaryResult.synthesisUserPrompt.slice(0, 300),
        documentCount: workspaceSummaryResult.metadata?.documents,
      });

      const { text: hierarchicalText, metrics: synthesisMetrics } =
        await runWorkspaceSummarySynthesis({
          workspaceSummaryResult,
          LLMConnector,
          workspace,
          user,
          rawHistory,
        });

      await emitDirectChatResponse({
        response,
        uuid,
        text: hierarchicalText,
        sources: workspaceSummaryResult.sources || [],
        metadata: workspaceSummaryResult.metadata || null,
        metrics: synthesisMetrics,
        workspace,
        message,
        thread,
        user,
        rerunChatId,
        chatMode,
        attachments,
      });
      pipeline.ok("openai_request_sent", { mode: "workspace_synthesis" });
      return;
    }

    if (
      workspaceSummaryResult.handled &&
      workspaceSummaryResult.directResponse
    ) {
      pipeline.ok("prompt_built", { mode: "deterministic_workspace_summary" });
      pipeline.beforeLlm({
        intent: routing.workspaceIntent,
        selectedDocumentIds: scopedDocumentIds,
        workspaceName: workspace?.name,
        retrievedChunkCount: 0,
        promptLength: workspaceSummaryResult.directResponse.length,
        promptPreview: workspaceSummaryResult.directResponse.slice(0, 300),
        skippedLlm: true,
      });

      await emitDirectChatResponse({
        response,
        uuid,
        text: workspaceSummaryResult.directResponse,
        sources: workspaceSummaryResult.sources || [],
        metadata: workspaceSummaryResult.metadata || null,
        workspace,
        message,
        thread,
        user,
        rerunChatId,
        chatMode,
        attachments,
      });
      pipeline.ok("openai_request_sent", { skipped: true });
      return;
    }

    let documentDiffResult = { handled: false };
    if (retrievalPlan.runDocumentDiff) {
      try {
        pipeline.stage("document_diff_start");
        documentDiffResult = await performDocumentDiffAnalysis({
          message: cleanMessage,
          workspace,
          user,
        });
        pipeline.ok("document_diff_complete", { handled: documentDiffResult.handled });
      } catch (error) {
        pipeline.fail("document_diff", error);
        return abortPipeline(
          response,
          uuid,
          `Document comparison failed: ${error.message}`
        );
      }
    }

    if (documentDiffResult.handled && documentDiffResult.error) {
      return abortPipeline(response, uuid, documentDiffResult.error);
    }

    if (documentDiffResult.handled && documentDiffResult.context) {
      contextTexts.unshift(documentDiffResult.context);
      if (documentDiffResult.report) {
        writeResponseChunk(response, {
          uuid: `${uuid}:diff`,
          type: "documentDiffReport",
          report: documentDiffResult.report,
          reviewId: documentDiffResult.reviewId || null,
        });
      }
    }

    let executiveReportResult = { handled: false };
    if (retrievalPlan.runExecutiveReport) {
      try {
        pipeline.stage("executive_report_start");
        executiveReportResult = await performExecutiveReportQuery({
          message: cleanMessage,
          workspace,
        });
        pipeline.ok("executive_report_complete", {
          handled: executiveReportResult.handled,
        });
      } catch (error) {
        pipeline.fail("executive_report", error);
        return abortPipeline(
          response,
          uuid,
          `Executive report failed: ${error.message}`
        );
      }
    }

    if (executiveReportResult.handled && executiveReportResult.error) {
      return abortPipeline(response, uuid, executiveReportResult.error);
    }

    if (executiveReportResult.handled && executiveReportResult.context) {
      contextTexts.unshift(executiveReportResult.context);
    }

    let workspaceGraphResult = { handled: false };
    if (retrievalPlan.runWorkspaceGraph) {
      try {
        pipeline.stage("workspace_graph_start");
        workspaceGraphResult = await performWorkspaceGraphQuery({
          message: cleanMessage,
          workspace,
        });
        pipeline.ok("workspace_graph_complete", {
          handled: workspaceGraphResult.handled,
        });
      } catch (error) {
        pipeline.fail("workspace_graph", error);
        return abortPipeline(
          response,
          uuid,
          `Workspace graph query failed: ${error.message}`
        );
      }
    }

    if (workspaceGraphResult.handled && workspaceGraphResult.error) {
      return abortPipeline(response, uuid, workspaceGraphResult.error);
    }

    if (workspaceGraphResult.handled && workspaceGraphResult.context) {
      contextTexts.unshift(workspaceGraphResult.context);
    }

    let exactSearchResult = {
      handled: false,
      values: [],
      contextTexts: [],
      sources: [],
      matchCount: 0,
      documentCount: 0,
    };
    if (!hasSelectedDocuments) {
      try {
        pipeline.stage("workspace_exact_search_start");
        exactSearchResult = await performWorkspaceExactSearch({
          workspaceId: workspace.id,
          message: cleanMessage,
        });
        if (exactSearchResult.contextTexts.length > 0) {
          contextTexts.unshift(...exactSearchResult.contextTexts);
          sources.unshift(...exactSearchResult.sources);
        }
        pipeline.ok("workspace_exact_search_complete", {
          handled: exactSearchResult.handled,
          values: exactSearchResult.values,
          matchCount: exactSearchResult.matchCount,
          documentCount: exactSearchResult.documentCount,
        });
      } catch (error) {
        // Exact search supplements RAG. Preserve semantic fallback on scan errors.
        pipeline.fail("workspace_exact_search", error);
      }
    }

    let analyticsResult = {
      handled: false,
      operations: [],
      contextTexts: [],
      sources: [],
      productCount: 0,
      reportCount: 0,
    };
    try {
      pipeline.stage("workspace_analytics_start");
      analyticsResult = await performWorkspaceAnalytics({
        workspaceId: workspace.id,
        message: cleanMessage,
      });
      if (analyticsResult.contextTexts.length > 0) {
        contextTexts.unshift(...analyticsResult.contextTexts);
        sources.unshift(...analyticsResult.sources);
        // Put authoritative computed numbers in the user message so they
        // cannot be outranked by selected-file / "Not found" instructions.
        routedUserPrompt = [
          analyticsResult.contextTexts[0],
          "",
          "Instruction: Answer using the Computed stock analytics above. Do not say Not found.",
          "",
          `User Question:\n${cleanMessage}`,
        ].join("\n");
      }
      pipeline.ok("workspace_analytics_complete", {
        handled: analyticsResult.handled,
        operations: analyticsResult.operations,
        productCount: analyticsResult.productCount,
        reportCount: analyticsResult.reportCount,
      });
    } catch (error) {
      // Analytics augment the answer; degrade to RAG/direct read on failure.
      pipeline.fail("workspace_analytics", error);
    }

    let vectorSearchResults = {
      contextTexts: [],
      sources: [],
      message: null,
      projectWide: false,
    };

    if (embeddingsCount !== 0) {
      try {
        pipeline.stage("vector_search_start", {
          forceProjectWide: retrievalPlan.forceProjectWide,
          selectedDocumentIds: scopedDocumentIds,
        });
        vectorSearchResults = await performWorkspaceSimilaritySearch({
          VectorDb,
          workspace,
          input: cleanMessage,
          LLMConnector,
          filterIdentifiers: pinnedDocIdentifiers,
          selectedDocumentIds: scopedDocumentIds,
          forceProjectWide: retrievalPlan.forceProjectWide,
        });
        pipeline.ok("retrieval_complete", {
          chunkCount: vectorSearchResults.contextTexts?.length || 0,
          projectWide: vectorSearchResults.projectWide,
        });
      } catch (error) {
        pipeline.fail("vector_search", error);
        return abortPipeline(
          response,
          uuid,
          `Document retrieval failed: ${error.message}`
        );
      }
    }

    if (!!vectorSearchResults.message) {
      return abortPipeline(response, uuid, String(vectorSearchResults.message));
    }

    ({ contextTexts, sources } = mergeRetrievalIntoContext({
      vectorSearchResults,
      contextTexts,
      sources,
      rawHistory,
      workspace,
      pinnedDocIdentifiers,
    }));

    let directDocumentResult = {
      contextTexts: [],
      sources: [],
      loadedCount: 0,
      requestedCount: 0,
      labels: [],
      truncatedLabels: [],
      failedLabels: [],
    };
    if (hasSelectedDocuments) {
      try {
        pipeline.stage("selected_document_direct_read_start", {
          selectedDocumentIds: scopedDocumentIds,
        });
        directDocumentResult = await loadSelectedDocumentContext({
          selectedDocumentIds: scopedDocumentIds,
          selectedDocuments: routing.selectedDocuments,
        });
        // Direct file text is primary for selected-doc Q/A; RAG chunks support it.
        contextTexts = [
          ...directDocumentResult.contextTexts,
          ...contextTexts,
        ];
        sources = [...directDocumentResult.sources, ...sources];
        pipeline.ok("selected_document_direct_read_complete", {
          loadedCount: directDocumentResult.loadedCount,
          requestedCount: directDocumentResult.requestedCount,
          labels: directDocumentResult.labels,
          truncatedLabels: directDocumentResult.truncatedLabels,
          failedLabels: directDocumentResult.failedLabels,
        });
      } catch (error) {
        pipeline.fail("selected_document_direct_read", error);
        return abortPipeline(
          response,
          uuid,
          `Selected document read failed: ${error.message}`
        );
      }
    }

    if (chatMode === "query" && contextTexts.length === 0) {
      const textResponse =
        workspace?.queryRefusalResponse ??
        "There is no relevant information in this workspace to answer your query.";
      writeResponseChunk(response, {
        id: uuid,
        type: "textResponse",
        textResponse,
        sources: [],
        close: true,
        error: null,
      });

      await persistChatTurn({
        workspace,
        message,
        responsePayload: {
          text: textResponse,
          sources: [],
          type: chatMode,
          attachments,
        },
        thread,
        user,
        rerunChatId,
        include: false,
      });
      return;
    }

    const retrievedChunkCount = contextTexts.length;
    // When analytics is present, skip DOCUMENT_QA / exact-search "Not found"
    // instructions — they conflict with computed aggregates and cause false refusals.
    const systemPrompt = applyAnalyticsSystemPrompt(
      applyExactSearchSystemPrompt(
        applyDocumentQaSystemPrompt(
          applyContextAvailableInstructions(
            applyProjectWideSystemPrompt(
              prefetchedContext?.systemPrompt ??
                (await chatPrompt(workspace, user, {
                  prompt: cleanMessage,
                  rawHistory,
                })),
              vectorSearchResults
            ),
            analyticsResult.handled ? 0 : retrievedChunkCount
          ),
          !analyticsResult.handled && directDocumentResult.loadedCount > 0
        ),
        !analyticsResult.handled && exactSearchResult.matchCount > 0
      ),
      analyticsResult.handled
    );
    const diffAwareSystemPrompt = documentDiffResult.handled
      ? `${systemPrompt}\n\n${DOCUMENT_DIFF_SYSTEM_PROMPT}`
      : executiveReportResult.handled
        ? `${systemPrompt}\n\n${EXECUTIVE_REPORT_SYSTEM_PROMPT}`
        : workspaceGraphResult.handled
          ? `${systemPrompt}\n\n${WORKSPACE_GRAPH_SYSTEM_PROMPT}`
          : systemPrompt;

    pipeline.ok("prompt_built", {
      retrievedChunkCount,
      directDocumentCount: directDocumentResult.loadedCount,
      exactMatchCount: exactSearchResult.matchCount,
      analyticsHandled: analyticsResult.handled,
      routedUserPromptPreview: routedUserPrompt.slice(0, 300),
    });

    pipeline.beforeLlm({
      intent: routing.workspaceIntent,
      selectedDocumentIds: scopedDocumentIds,
      workspaceName: workspace?.name,
      retrievedChunkCount,
      directDocumentCount: directDocumentResult.loadedCount,
      exactMatchCount: exactSearchResult.matchCount,
      promptLength: routedUserPrompt.length + diffAwareSystemPrompt.length,
      promptPreview: routedUserPrompt,
    });

    const messages = await LLMConnector.compressMessages(
      {
        systemPrompt: diffAwareSystemPrompt,
        userPrompt: routedUserPrompt,
        contextTexts,
        chatHistory,
        attachments,
      },
      rawHistory
    );

    if (LLMConnector.streamingEnabled() !== true) {
      console.log(
        `\x1b[31m[STREAMING DISABLED]\x1b[0m Streaming is not available for ${LLMConnector.constructor.name}. Will use regular chat method.`
      );
      const { textResponse, metrics: performanceMetrics } =
        await LLMConnector.getChatCompletion(messages, {
          temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
          user: user,
        });

      completeText = textResponse;
      metrics = performanceMetrics;
      writeResponseChunk(response, {
        uuid,
        sources,
        type: "textResponseChunk",
        textResponse: completeText,
        close: true,
        error: false,
        metrics,
      });
    } else {
      const stream = await LLMConnector.streamGetChatCompletion(messages, {
        temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
        user: user,
      });
      completeText = await LLMConnector.handleStream(response, stream, {
        uuid,
        sources,
      });
      metrics = stream.metrics;
    }

    pipeline.ok("openai_request_sent");

    const isFalseAnalyticsNotFound =
      analyticsResult.handled &&
      /not\s+found\s+in\s+the\s+provided\s+document/i.test(completeText || "");

    if (
      (isInvalidNoAccessResponse(completeText, retrievedChunkCount) &&
        retrievedChunkCount > 0) ||
      isFalseAnalyticsNotFound
    ) {
      pipeline.stage("response_guard_retry", {
        reason: isFalseAnalyticsNotFound
          ? "analytics_not_found_refusal"
          : "no_access_refusal",
      });
      const retryUserPrompt = isFalseAnalyticsNotFound
        ? [
            analyticsResult.contextTexts[0],
            "",
            "You previously refused incorrectly. The Computed stock analytics above ARE the answer. Produce the averages/totals from that table now. Never say Not found.",
            "",
            `User Question:\n${cleanMessage}`,
          ].join("\n")
        : routedUserPrompt;
      const retrySystemPrompt = isFalseAnalyticsNotFound
        ? `${diffAwareSystemPrompt}\n\n${ANALYTICS_SYSTEM_PROMPT}\nYou must answer from Computed stock analytics. Never say Not found.`
        : `${diffAwareSystemPrompt}\n\nYou previously incorrectly claimed you could not access the documents. The Context section above contains the retrieved excerpts. Answer the user question using only that context.`;
      const retryMessages = await LLMConnector.compressMessages(
        {
          systemPrompt: retrySystemPrompt,
          userPrompt: retryUserPrompt,
          contextTexts,
          chatHistory: isFalseAnalyticsNotFound ? [] : chatHistory,
          attachments,
        },
        isFalseAnalyticsNotFound ? [] : rawHistory
      );

      if (LLMConnector.streamingEnabled() !== true) {
        const { textResponse, metrics: retryMetrics } =
          await LLMConnector.getChatCompletion(retryMessages, {
            temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
            user,
          });
        if (textResponse) {
          const stillAnalyticsRefusal =
            isFalseAnalyticsNotFound &&
            /not\s+found\s+in\s+the\s+provided\s+document/i.test(textResponse);
          const stillNoAccess = isInvalidNoAccessResponse(
            textResponse,
            retrievedChunkCount
          );
          if (!stillAnalyticsRefusal && !stillNoAccess) {
            completeText = textResponse;
            metrics = retryMetrics;
            writeResponseChunk(response, {
              uuid,
              sources,
              type: "textResponseChunk",
              textResponse: completeText,
              replace: true,
              close: true,
              error: false,
              metrics,
            });
          }
        }
      } else {
        const retryStream = await LLMConnector.streamGetChatCompletion(
          retryMessages,
          {
            temperature: workspace?.openAiTemp ?? LLMConnector.defaultTemp,
            user,
          }
        );
        writeResponseChunk(response, {
          uuid,
          sources,
          type: "textResponseChunk",
          textResponse: "",
          replace: true,
          close: false,
          error: false,
        });
        completeText = await LLMConnector.handleStream(response, retryStream, {
          uuid,
          sources,
        });
        metrics = retryStream.metrics;
      }
    }

    completeText = sanitizeResponseQuality(completeText);

    if (completeText?.length > 0) {
      const { chat } = await persistChatTurn({
        workspace,
        message,
        responsePayload: {
          text: completeText,
          sources,
          type: chatMode,
          attachments,
          metrics,
        },
        thread,
        user,
        rerunChatId,
      });

      writeResponseChunk(response, {
        uuid,
        type: "finalizeResponseStream",
        close: true,
        error: false,
        chatId: chat.id,
        metrics,
      });
      return;
    }

    writeResponseChunk(response, {
      uuid,
      type: "finalizeResponseStream",
      close: true,
      error: false,
      metrics,
    });
  } catch (error) {
    pipeline.fail(pipeline.lastStage || "pipeline", error);
    abortPipeline(
      response,
      uuid,
      `Chat pipeline failed during ${pipeline.lastStage || "unknown stage"}: ${error.message}`
    );
  }
}

async function resolveLLMConnector({
  workspace,
  message,
  user,
  thread,
  attachments,
}) {
  try {
    const result = await resolveProviderConnector({
      workspace,
      prompt: message,
      user,
      thread,
      attachments,
    });
    return { ...result, error: null };
  } catch (routerError) {
    return {
      connector: null,
      routingMetadata: null,
      prefetchedContext: null,
      error: `Model router error: ${routerError.message}`,
    };
  }
}

module.exports = {
  VALID_CHAT_MODE,
  streamChatWithWorkspace,
};
