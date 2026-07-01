/**
 * Structured logging for the chat retrieval → prompt → LLM pipeline.
 */
function createPipelineLogger(meta = {}) {
  const state = {
    meta,
    lastStage: null,
    stages: [],
  };

  function log(stage, detail = {}, level = "info") {
    state.lastStage = stage;
    state.stages.push({ stage, detail, level, at: new Date().toISOString() });
    const payload = { stage, ...meta, ...detail };
    if (level === "error") {
      console.error("[chat-pipeline]", JSON.stringify(payload));
      if (detail?.stack) console.error(detail.stack);
    } else {
      console.log("[chat-pipeline]", JSON.stringify(payload));
    }
  }

  return {
    get lastStage() {
      return state.lastStage;
    },
    get stages() {
      return state.stages;
    },
    stage(name, detail = {}) {
      log(name, detail);
    },
    ok(name, detail = {}) {
      log(`✓ ${name}`, detail);
    },
    fail(name, error, detail = {}) {
      log(
        `✗ ${name}`,
        {
          ...detail,
          error: error?.message || String(error),
          stack: error?.stack,
        },
        "error"
      );
    },
    beforeLlm({
      intent = null,
      selectedDocumentIds = [],
      workspaceName = null,
      retrievedChunkCount = 0,
      promptLength = 0,
      promptPreview = "",
    } = {}) {
      log("before_openai_request", {
        intent,
        selectedDocumentIds,
        workspace: workspaceName,
        retrievedChunks: retrievedChunkCount,
        promptLength,
        promptPreview:
          typeof promptPreview === "string" ? promptPreview.slice(0, 500) : "",
      });
    },
  };
}

module.exports = { createPipelineLogger };
