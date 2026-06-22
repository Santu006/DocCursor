const prisma = require("../utils/prisma");

const WorkspaceChatPromptHistory = {
  /**
   * @param {object} params
   * @param {number} params.chatId
   * @param {string} params.prompt
   * @param {number|null} [params.editedBy]
   */
  create: async function ({ chatId, prompt, editedBy = null }) {
    if (!chatId || !prompt) return null;
    try {
      return await prisma.workspace_chat_prompt_history.create({
        data: {
          chatId: Number(chatId),
          prompt: String(prompt),
          editedBy: editedBy ? Number(editedBy) : null,
        },
      });
    } catch (error) {
      console.error("[WorkspaceChatPromptHistory] create failed:", error.message);
      return null;
    }
  },

  forChat: async function (chatId, { limit = 20 } = {}) {
    if (!chatId) return [];
    try {
      return await prisma.workspace_chat_prompt_history.findMany({
        where: { chatId: Number(chatId) },
        orderBy: { createdAt: "desc" },
        take: Math.min(Number(limit) || 20, 100),
      });
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },
};

module.exports = { WorkspaceChatPromptHistory };
