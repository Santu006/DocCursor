const { WorkspaceChats } = require("../../models/workspaceChats");
const { WorkspaceChatPromptHistory } = require("../../models/workspaceChatPromptHistory");

/**
 * @param {object} params
 * @param {object} params.existingChat
 * @param {string} params.newText
 * @param {string} params.role
 * @param {number|null} params.userId
 */
async function updateWorkspaceChatMessage({
  existingChat,
  newText,
  role,
  userId = null,
}) {
  if (role !== "user") {
    throw new Error("Only user messages can be edited.");
  }

  return WorkspaceChats.editUserPrompt({
    existingChat,
    newPrompt: newText,
    userId,
  });
}

/**
 * @param {object} params
 * @param {object} params.existingChat
 * @param {string} params.newPrompt
 * @param {number|null} params.userId
 * @param {object} params.deleteClause
 */
async function prepareWorkspaceChatRerun({
  existingChat,
  newPrompt,
  userId = null,
  deleteClause,
}) {
  return WorkspaceChats.prepareChatRerun({
    existingChat,
    newPrompt,
    userId,
    deleteClause,
  });
}

/**
 * @param {number} chatId
 */
async function getWorkspaceChatPromptHistory(chatId) {
  return WorkspaceChatPromptHistory.forChat(chatId);
}

module.exports = {
  updateWorkspaceChatMessage,
  prepareWorkspaceChatRerun,
  getWorkspaceChatPromptHistory,
};
