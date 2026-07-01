/* eslint-env jest, node */

const { createPipelineLogger } = require("../../../utils/chats/pipelineLogger");

describe("pipelineLogger", () => {
  it("records stages and exposes lastStage on failure", () => {
    const logger = createPipelineLogger({ workspaceSlug: "santosh" });
    logger.ok("workspace_found", { embeddingsCount: 23 });
    logger.ok("retrieval_complete", { chunkCount: 4 });
    logger.fail("vector_search", new Error("boom"), { input: "test" });

    expect(logger.lastStage).toBe("✗ vector_search");
    expect(logger.stages.length).toBe(3);
  });

  it("logs before OpenAI request fields", () => {
    const logger = createPipelineLogger({ workspaceSlug: "santosh" });
    logger.beforeLlm({
      intent: "workspace_summary",
      selectedDocumentIds: [],
      workspaceName: "Santosh",
      retrievedChunkCount: 5,
      promptLength: 120,
      promptPreview: "User Question:\nSummarize this workspace.",
    });
    expect(logger.lastStage).toBe("before_openai_request");
  });
});
