/* eslint-env jest, node */

jest.mock("../../../utils/prisma", () => ({
  workspace_chats: {
    update: jest.fn(),
    create: jest.fn(),
  },
  workspace_chat_prompt_history: {
    create: jest.fn(),
  },
}));

const prisma = require("../../../utils/prisma");
const { WorkspaceChats } = require("../../../models/workspaceChats");
const {
  updateWorkspaceChatMessage,
  prepareWorkspaceChatRerun,
} = require("../../../utils/chats/editMessage");

describe("WorkspaceChats edit & re-run", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    WorkspaceChats.delete = jest.fn().mockResolvedValue(true);
    WorkspaceChats._update = jest.fn().mockResolvedValue(true);
    WorkspaceChats.new = jest.fn().mockResolvedValue({ chat: { id: 99 }, message: null });
  });

  it("editUserPrompt archives the previous prompt and marks the chat edited", async () => {
    prisma.workspace_chat_prompt_history.create.mockResolvedValue({ id: 1 });
    const existingChat = { id: 5, prompt: "Compare A with B" };

    await WorkspaceChats.editUserPrompt({
      existingChat,
      newPrompt: "Compare A with C",
      userId: 7,
    });

    expect(prisma.workspace_chat_prompt_history.create).toHaveBeenCalledWith({
      data: {
        chatId: 5,
        prompt: "Compare A with B",
        editedBy: 7,
      },
    });
    expect(WorkspaceChats._update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        prompt: "Compare A with C",
        isEdited: true,
        editedAt: expect.any(Date),
      })
    );
  });

  it("prepareChatRerun keeps the user turn, clears response, and deletes later turns", async () => {
    prisma.workspace_chat_prompt_history.create.mockResolvedValue({ id: 2 });
    const existingChat = { id: 5, prompt: "Compare A with B", isEdited: false };

    await WorkspaceChats.prepareChatRerun({
      existingChat,
      newPrompt: "Compare A with C",
      userId: 7,
      deleteClause: { workspaceId: 1, thread_id: null, user_id: 7 },
    });

    expect(WorkspaceChats.delete).toHaveBeenCalledWith({
      workspaceId: 1,
      thread_id: null,
      user_id: 7,
      id: { gt: 5 },
    });
    expect(WorkspaceChats._update).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        prompt: "Compare A with C",
        isEdited: true,
        response: expect.stringContaining('"text":""'),
      })
    );
  });

  it("saveResponse updates an existing chat row when rerunChatId is provided", async () => {
    await WorkspaceChats.saveResponse({
      workspaceId: 1,
      prompt: "Summarize workspace",
      response: { text: "Summary", sources: [] },
      existingChatId: 12,
    });

    expect(WorkspaceChats.new).not.toHaveBeenCalled();
    expect(WorkspaceChats._update).toHaveBeenCalledWith(
      12,
      expect.objectContaining({
        response: expect.stringContaining("Summary"),
      })
    );
  });

  it("updateWorkspaceChatMessage rejects assistant edits", async () => {
    await expect(
      updateWorkspaceChatMessage({
        existingChat: { id: 1, prompt: "hi" },
        newText: "changed",
        role: "assistant",
        userId: 1,
      })
    ).rejects.toThrow("Only user messages can be edited.");
  });

  it("prepareWorkspaceChatRerun delegates to WorkspaceChats.prepareChatRerun", async () => {
    const spy = jest
      .spyOn(WorkspaceChats, "prepareChatRerun")
      .mockResolvedValue(true);

    await prepareWorkspaceChatRerun({
      existingChat: { id: 3, prompt: "old" },
      newPrompt: "new",
      userId: 2,
      deleteClause: { workspaceId: 1 },
    });

    expect(spy).toHaveBeenCalledWith({
      existingChat: { id: 3, prompt: "old" },
      newPrompt: "new",
      userId: 2,
      deleteClause: { workspaceId: 1 },
    });
  });
});

describe("convertToChatHistory edit metadata", () => {
  const { convertToChatHistory } = require("../../../utils/helpers/chat/responses");

  it("includes isEdited and editedAt on user messages", () => {
    const editedAt = new Date("2026-06-23T12:00:00.000Z");
    const history = convertToChatHistory([
      {
        id: 10,
        prompt: "Compare A with C",
        response: JSON.stringify({ text: "Report", sources: [] }),
        createdAt: editedAt,
        feedbackScore: null,
        isEdited: true,
        editedAt,
      },
    ]);

    expect(history[0]).toMatchObject({
      role: "user",
      content: "Compare A with C",
      chatId: 10,
      isEdited: true,
      editedAt: expect.any(Number),
    });
  });
});

describe("convertToPromptHistory pending reruns", () => {
  const { convertToPromptHistory } = require("../../../utils/helpers/chat/responses");

  it("skips chat rows with empty assistant responses during re-run", () => {
    const history = convertToPromptHistory([
      {
        id: 1,
        prompt: "Earlier question",
        response: JSON.stringify({ text: "Earlier answer", sources: [] }),
      },
      {
        id: 2,
        prompt: "Edited question",
        response: JSON.stringify({ text: "", sources: [] }),
      },
    ]);

    expect(history).toHaveLength(2);
    expect(history[0].content).toBe("Earlier question");
    expect(history[1].content).toBe("Earlier answer");
  });
});
