-- AlterTable
ALTER TABLE "workspace_chats" ADD COLUMN "isEdited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "workspace_chats" ADD COLUMN "editedAt" DATETIME;

-- CreateTable
CREATE TABLE "workspace_chat_prompt_history" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "editedBy" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workspace_chat_prompt_history_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "workspace_chats" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "workspace_chat_prompt_history_chatId_idx" ON "workspace_chat_prompt_history"("chatId");
