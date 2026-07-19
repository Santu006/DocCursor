/** Shared layout tokens for DocCursor Phase 9 minimal UX */
export const CHAT_CONTENT_CLASS = "w-full max-w-[820px] mx-auto px-4";

export function shortenError(message) {
  if (!message) return "Something went wrong.";
  const cleaned = message
    .replace(/^An error occurred while streaming response\.\s*/i, "")
    .replace(/^Could not respond to message\.\s*/i, "")
    .trim();
  const first = cleaned.split(/[.!?\n]/)[0]?.trim();
  if (!first) return "Something went wrong.";
  return first.length > 140 ? `${first.slice(0, 137)}…` : first;
}

export function shortenStatusMessage(content = "") {
  const text = String(content).trim();
  if (!text) return "";
  if (text.startsWith("@agent:")) return "Agent mode active";
  if (text === "Agent session complete.") return "Agent finished";
  if (text.length > 72) return `${text.slice(0, 69)}…`;
  return text;
}

export function formatEta(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return null;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `~${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `~${m}m ${rem}s` : `~${m}m`;
}
