import { Info, Pencil } from "@phosphor-icons/react";
import { useRef, useEffect } from "react";
import Appearance from "@/models/appearance";
import { useTranslation } from "react-i18next";
import {
  useMessageActionsContext,
  EDIT_EVENT,
} from "@/components/WorkspaceChat/ChatContainer/ChatHistory/MessageActionsContext";

export function useEditMessage({ chatId, role }) {
  const context = useMessageActionsContext();
  const isEditing = context?.isEditing(chatId, role) ?? false;
  return { isEditing };
}

export function EditMessageAction({ chatId = null, role, isEditing }) {
  const { t } = useTranslation();

  function handleEditClick() {
    window.dispatchEvent(
      new CustomEvent(EDIT_EVENT, { detail: { chatId, role } })
    );
  }

  if (!chatId || isEditing || role !== "user") return null;
  return (
    <div className="mt-3 relative">
      <button
        onClick={handleEditClick}
        data-tooltip-id="edit-input-text"
        data-tooltip-content={t("chat_window.edit_prompt")}
        className="border-none text-zinc-300 light:text-slate-500 px-0"
        aria-label={t("chat_window.edit_prompt")}
      >
        <Pencil size={21} className="mb-1" />
      </button>
    </div>
  );
}

export function EditMessageForm({
  role,
  chatId,
  message,
  attachments = [],
  adjustTextArea,
  saveChanges,
}) {
  const formRef = useRef(null);
  const { t } = useTranslation();

  function handleSubmit(e) {
    e.preventDefault();
    const editedMessage = formRef.current.value;
    saveChanges({ editedMessage, chatId, role, attachments });
    window.dispatchEvent(
      new CustomEvent(EDIT_EVENT, { detail: { chatId, role, attachments } })
    );
  }

  function cancelEdits() {
    window.dispatchEvent(
      new CustomEvent(EDIT_EVENT, { detail: { chatId, role, attachments } })
    );
    return false;
  }

  useEffect(() => {
    if (!formRef?.current) return;
    formRef.current.focus();
    adjustTextArea({ target: formRef.current });
  }, []);

  if (role !== "user") return null;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col w-full max-w-[650px]"
    >
      <textarea
        ref={formRef}
        name="editedMessage"
        spellCheck={Appearance.get("enableSpellCheck")}
        className="text-white light:text-slate-900 w-full rounded-2xl bg-zinc-800 light:bg-slate-100 border border-sky-300 focus:border-sky-300 active:outline-none focus:outline-none focus:ring-0 px-4 py-3 resize-none overflow-hidden"
        defaultValue={message}
        onChange={adjustTextArea}
      />
      <EditActionBar onCancel={cancelEdits} />
    </form>
  );
}

function EditActionBar({ onCancel }) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex flex-col md:flex-row md:items-center justify-between gap-2 bg-zinc-800 light:bg-slate-200 rounded-lg p-2">
      <div className="flex items-start gap-2">
        <Info
          size={12}
          className="shrink-0 mt-0.5 text-zinc-200 light:text-slate-800"
        />
        <span className="text-zinc-200 light:text-slate-800 text-xs leading-4">
          {t("chat_window.edit_info_user")}
        </span>
      </div>
      <div className="flex items-center gap-2 self-end shrink-0">
        <button
          type="button"
          onClick={onCancel}
          className="border-none text-white light:text-slate-900 text-sm font-medium min-w-[70px] h-9 px-2 rounded-lg hover:bg-white/5 light:hover:bg-slate-300"
        >
          {t("chat_window.cancel")}
        </button>
        <button
          type="submit"
          className="border-none bg-zinc-50 light:bg-slate-800 text-zinc-800 light:text-white text-sm font-medium min-w-[110px] h-9 px-2 rounded-lg hover:bg-zinc-200 light:hover:bg-slate-800"
        >
          {t("chat_window.save_and_rerun")}
        </button>
      </div>
    </div>
  );
}
