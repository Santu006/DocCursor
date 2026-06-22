const { v4: uuidv4 } = require("uuid");
const { getVectorDbClass, resolveProviderConnector } = require("../helpers");
const { chatPrompt, sourceIdentifier } = require("./index");
const {
  performWorkspaceSimilaritySearch,
  mergeRetrievalIntoContext,
  applyProjectWideSystemPrompt,
} = require("./projectWideRetrieval");
const { EmbedChats } = require("../../models/embedChats");
const {
  convertToPromptHistory,
  writeResponseChunk,
} = require("../helpers/chat/responses");
const { DocumentManager } = require("../DocumentManager");

async function streamChatWithForEmbed(
  response,
  /** @type {import("@prisma/client").embed_configs & {workspace?: import("@prisma/client").workspaces}} */
  embed,
  /** @type {String} */
  message,
  /** @type {String} */
  sessionId,
  { promptOverride, modelOverride, temperatureOverride, username }
) {
  // Automatic mode is NOT valid for embeds, so we default to chat mode.
  let chatMode = embed.chat_mode ?? "chat";
  if (chatMode === "automatic") chatMode = "chat";

  const chatModel = embed.allow_model_override ? modelOverride : null;

  // If there are overrides in request & they are permitted, override the default workspace ref information.
  if (embed.allow_prompt_override)
    embed.workspace.openAiPrompt = promptOverride;
  if (embed.allow_temperature_override)
    embed.workspace.openAiTemp = parseFloat(temperatureOverride);

  const uuid = uuidv4();
  const {
    connector: LLMConnector,
    prefetchedContext,
    error: routerError,
  } = await resolveLLMConnectorForEmbed({
    embed,
    chatModel,
    message,
    sessionId,
  });

  if (routerError) {
    return writeResponseChunk(response, {
      id: uuid,
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: routerError,
    });
  }

  const VectorDb = getVectorDbClass();

  const messageLimit = embed.message_limit ?? 20;
  const hasVectorizedSpace = await VectorDb.hasNamespace(embed.workspace.slug);
  const embeddingsCount = await VectorDb.namespaceCount(embed.workspace.slug);

  // User is trying to query-mode chat a workspace that has no data in it - so
  // we should exit early as no information can be found under these conditions.
  if ((!hasVectorizedSpace || embeddingsCount === 0) && chatMode === "query") {
    writeResponseChunk(response, {
      id: uuid,
      type: "textResponse",
      textResponse:
        "I do not have enough information to answer that. Try another question.",
      sources: [],
      close: true,
      error: null,
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
  } = prefetchedContext ??
  (await recentEmbedChatHistory(sessionId, embed, messageLimit));

  const pinnedDocs =
    prefetchedPinnedDocs ??
    (await new DocumentManager({
      workspace: embed.workspace,
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

  const vectorSearchResults =
    embeddingsCount !== 0
      ? await performWorkspaceSimilaritySearch({
          VectorDb,
          workspace: embed.workspace,
          input: message,
          LLMConnector,
          filterIdentifiers: pinnedDocIdentifiers,
        })
      : {
          contextTexts: [],
          sources: [],
          message: null,
          projectWide: false,
        };

  // Failed similarity search if it was run at all and failed.
  if (!!vectorSearchResults.message) {
    writeResponseChunk(response, {
      id: uuid,
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: "Failed to connect to vector database provider.",
    });
    return;
  }

  ({ contextTexts, sources } = mergeRetrievalIntoContext({
    vectorSearchResults,
    contextTexts,
    sources,
    rawHistory,
    workspace: embed.workspace,
    pinnedDocIdentifiers,
  }));

  // If in query mode and no sources are found in current search or backfilled from history, do not
  // let the LLM try to hallucinate a response or use general knowledge
  if (chatMode === "query" && contextTexts.length === 0) {
    writeResponseChunk(response, {
      id: uuid,
      type: "textResponse",
      textResponse:
        embed.workspace?.queryRefusalResponse ??
        "There is no relevant information in this workspace to answer your query.",
      sources: [],
      close: true,
      error: null,
    });
    return;
  }

  // Compress message to ensure prompt passes token limit with room for response
  // and build system messages based on inputs and history.
  const messages = await LLMConnector.compressMessages(
    {
      systemPrompt: applyProjectWideSystemPrompt(
        await chatPrompt(embed.workspace, username),
        vectorSearchResults
      ),
      userPrompt: message,
      contextTexts,
      chatHistory,
    },
    rawHistory
  );

  // If streaming is not explicitly enabled for connector
  // we do regular waiting of a response and send a single chunk.
  if (LLMConnector.streamingEnabled() !== true) {
    console.log(
      `\x1b[31m[STREAMING DISABLED]\x1b[0m Streaming is not available for ${LLMConnector.constructor.name}. Will use regular chat method.`
    );
    const { textResponse, metrics: performanceMetrics } =
      await LLMConnector.getChatCompletion(messages, {
        temperature: embed.workspace?.openAiTemp ?? LLMConnector.defaultTemp,
      });
    completeText = textResponse;
    metrics = performanceMetrics;
    writeResponseChunk(response, {
      uuid,
      sources: [],
      type: "textResponseChunk",
      textResponse: completeText,
      close: true,
      error: false,
    });
  } else {
    const stream = await LLMConnector.streamGetChatCompletion(messages, {
      temperature: embed.workspace?.openAiTemp ?? LLMConnector.defaultTemp,
    });
    completeText = await LLMConnector.handleStream(response, stream, {
      uuid,
      sources: [],
    });
    metrics = stream.metrics;
  }

  await EmbedChats.new({
    embedId: embed.id,
    prompt: message,
    response: { text: completeText, type: chatMode, sources, metrics },
    connection_information: response.locals.connection
      ? {
          ...response.locals.connection,
          username: !!username ? String(username) : null,
        }
      : { username: !!username ? String(username) : null },
    sessionId,
  });
  return;
}

/**
 * @param {string} sessionId the session id of the user from embed widget
 * @param {Object} embed the embed config object
 * @param {Number} messageLimit the number of messages to return
 * @returns {Promise<{rawHistory: import("@prisma/client").embed_chats[], chatHistory: {role: string, content: string, attachments?: Object[]}[]}>
 */
async function recentEmbedChatHistory(sessionId, embed, messageLimit = 20) {
  const rawHistory = (
    await EmbedChats.forEmbedByUser(embed.id, sessionId, messageLimit, {
      id: "desc",
    })
  ).reverse();
  return { rawHistory, chatHistory: convertToPromptHistory(rawHistory) };
}

/**
 * Resolves the LLM connector for embed chats, either directly or via the model router.
 * @returns {Promise<{ connector: Object, error: string|null }>}
 */
async function resolveLLMConnectorForEmbed({
  embed,
  chatModel,
  message,
  sessionId,
}) {
  // If a chat model is provided, use it to override the workspace chat model
  // otherwise use the workspace chat model as we do everywhere else.
  const workspace = chatModel
    ? { ...embed?.workspace, chatModel }
    : embed?.workspace;
  try {
    const messageLimit = workspace?.openAiHistory || 20;
    const embedHistory = await recentEmbedChatHistory(
      sessionId,
      embed,
      messageLimit
    );
    const embedMessageCount = await EmbedChats.count({
      embed_id: embed.id,
      session_id: sessionId,
      include: true,
    });

    const { connector, prefetchedContext } = await resolveProviderConnector({
      workspace,
      prompt: message,
      chatHistoryOverride: embedHistory,
      // +1 to include the current in-flight message to ensure routing rules are evaluated against the real total.
      messageCountOverride: embedMessageCount + 1,
    });

    return {
      connector,
      prefetchedContext: prefetchedContext
        ? {
            rawHistory: embedHistory.rawHistory,
            chatHistory: embedHistory.chatHistory,
            pinnedDocs: prefetchedContext.pinnedDocs,
          }
        : null,
      error: null,
    };
  } catch (routerError) {
    return {
      connector: null,
      prefetchedContext: null,
      error: `Model router error: ${routerError.message}`,
    };
  }
}

module.exports = {
  streamChatWithForEmbed,
};
