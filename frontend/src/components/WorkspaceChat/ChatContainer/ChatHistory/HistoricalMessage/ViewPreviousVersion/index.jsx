import { useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Workspace from "@/models/workspace";
import { useParams } from "react-router-dom";

export default function ViewPreviousVersion({
  chatId,
  workspaceSlug,
  isEdited = false,
}) {
  const { t } = useTranslation();
  const { threadSlug = null } = useParams();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  if (!isEdited || !chatId) return null;

  async function toggleHistory() {
    if (open) {
      setOpen(false);
      return;
    }

    setLoading(true);
    const entries = await Workspace.getPromptHistory(
      workspaceSlug,
      threadSlug,
      chatId
    );
    setHistory(entries);
    setLoading(false);
    setOpen(true);
  }

  return (
    <div className="mt-1 flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggleHistory}
        className="flex items-center gap-1 text-xs text-zinc-400 light:text-slate-500 hover:text-zinc-200 light:hover:text-slate-700 border-none bg-transparent p-0"
      >
        <ClockCounterClockwise size={14} />
        {loading
          ? t("chat_window.loading_previous_versions")
          : t("chat_window.view_previous_version")}
      </button>
      {open && history.length > 0 && (
        <div className="w-full max-w-[600px] rounded-lg border border-zinc-700 light:border-slate-300 bg-zinc-900 light:bg-slate-50 p-3 text-left">
          <p className="text-xs font-medium text-zinc-400 light:text-slate-500 mb-2">
            {t("chat_window.previous_versions")}
          </p>
          <ul className="space-y-2">
            {history.map((entry) => (
              <li
                key={entry.id}
                className="text-sm text-zinc-200 light:text-slate-800 whitespace-pre-wrap border-l-2 border-zinc-600 light:border-slate-300 pl-2"
              >
                {entry.prompt}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
