import { UploadSimple } from "@phosphor-icons/react";

export default function EmptyWorkspace({
  workspaceName,
  onUpload,
  subtitle = "Upload documents or ask a question.",
}) {
  return (
    <div className="flex flex-col items-center text-center mb-8 px-4">
      <h1 className="text-lg font-medium text-white/90 light:text-slate-900 tracking-tight">
        {workspaceName || "Workspace"}
      </h1>
      <p className="text-sm text-white/45 light:text-slate-500 mt-1.5 max-w-md">
        {subtitle}
      </p>
      <button
        type="button"
        onClick={onUpload}
        className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-white text-zinc-900 hover:bg-white/90 light:bg-slate-900 light:text-white light:hover:bg-slate-800 transition-colors border-none cursor-pointer"
      >
        <UploadSimple size={16} weight="bold" />
        Upload Documents
      </button>
    </div>
  );
}
