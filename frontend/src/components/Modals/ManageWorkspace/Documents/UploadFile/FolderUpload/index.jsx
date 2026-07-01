import { useCallback, useRef, useState } from "react";
import { FolderOpen, ArrowClockwise } from "@phosphor-icons/react";
import showToast from "@/utils/toast";
import FolderUpload from "@/models/folderUpload";
import {
  scanFolderFiles,
  uploadFolderInBatches,
} from "@/utils/folderUpload/scanner";
import { useWorkspaceEmbeddingProgress } from "@/EmbeddingProgressContext";
import CompactProgress from "@/components/lib/MinimalUI/CompactProgress";
import CollapsibleSection from "@/components/lib/MinimalUI/CollapsibleSection";

const BATCH_SIZE = 20;

export default function FolderUploadPanel({
  workspace,
  fetchKeys,
  setLoading,
  setLoadingMessage,
  disabled = false,
}) {
  const inputRef = useRef(null);
  const [phase, setPhase] = useState("idle");
  const [uploadProgress, setUploadProgress] = useState({ uploaded: 0, total: 0 });
  const [jobStatus, setJobStatus] = useState(null);
  const [failedFiles, setFailedFiles] = useState([]);
  const { startEmbedding } = useWorkspaceEmbeddingProgress(workspace.slug, {
    onProgressCleared: () => fetchKeys?.(true),
  });

  const reset = useCallback(() => {
    setPhase("idle");
    setUploadProgress({ uploaded: 0, total: 0 });
    setJobStatus(null);
    setFailedFiles([]);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const handleFolderSelected = async (event) => {
    const fileList = event.target.files;
    if (!fileList?.length) return;

    const { supported, skipped } = scanFolderFiles(fileList);
    if (!supported.length) {
      showToast("No supported documents in this folder.", "error");
      return;
    }

    setPhase("uploading");
    setLoading?.(true);
    setLoadingMessage?.("");

    try {
      const { jobId } = await uploadFolderInBatches({
        slug: workspace.slug,
        files: supported,
        folderName: supported[0]?.webkitRelativePath?.split("/")[0] || "folder",
        batchSize: BATCH_SIZE,
        onProgress: ({ uploaded, total }) => {
          setUploadProgress({ uploaded, total });
        },
      });

      setPhase("indexing");

      const finalJob = await FolderUpload.pollUploadStatus(workspace.slug, jobId, {
        onUpdate: (job) => setJobStatus(job),
      });

      if (finalJob?.embeddedCount) {
        startEmbedding(workspace.slug, finalJob.embedded || []);
      }

      setFailedFiles(finalJob?.failed || []);
      setPhase("complete");
      await fetchKeys?.(true, { autoSelectNew: false });

      const failed = finalJob?.failed?.length ?? 0;
      if (failed > 0) {
        showToast(
          `Indexed ${finalJob?.embeddedCount ?? 0} files. ${failed} failed.`,
          "warning"
        );
      } else {
        showToast(`Indexed ${finalJob?.embeddedCount ?? 0} documents.`, "success");
      }
    } catch (error) {
      setPhase("failed");
      showToast(error.message || "Folder upload failed", "error");
    } finally {
      setLoading?.(false);
      setLoadingMessage?.("");
    }
  };

  const isBusy = phase === "uploading" || phase === "indexing";
  const indexCurrent = jobStatus?.progress?.indexed ?? 0;
  const indexTotal = jobStatus?.progress?.total ?? 0;

  return (
    <div className="w-full max-w-[520px]">
      <input
        ref={inputRef}
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={handleFolderSelected}
        disabled={disabled || isBusy}
      />

      <button
        type="button"
        disabled={disabled || isBusy}
        onClick={() => inputRef.current?.click()}
        className="w-full border border-dashed border-white/15 light:border-slate-300 rounded-lg bg-transparent hover:bg-white/5 light:hover:bg-black/[0.02] transition-colors p-3 flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <FolderOpen size={20} className="text-white/60 light:text-slate-500 shrink-0" />
        <div className="text-left min-w-0">
          <p className="text-sm font-medium text-white light:text-slate-900">
            Upload folder
          </p>
          <p className="text-xs text-white/45 light:text-slate-500 truncate">
            PDF, DOCX, TXT, MD, CSV, XLSX, PPTX
          </p>
        </div>
      </button>

      {phase === "uploading" && (
        <div className="mt-3 px-1">
          <CompactProgress
            label="Uploading"
            current={uploadProgress.uploaded}
            total={uploadProgress.total}
          />
        </div>
      )}

      {phase === "indexing" && jobStatus && (
        <div className="mt-3 px-1">
          <CompactProgress
            label={
              jobStatus.phase === "intelligence"
                ? "Building intelligence"
                : "Indexing"
            }
            current={indexCurrent}
            total={indexTotal}
            estimatedSecondsRemaining={jobStatus.progress?.estimatedSecondsRemaining}
            detail={jobStatus.currentFile}
          />
        </div>
      )}

      {failedFiles.length > 0 && (
        <CollapsibleSection
          title={`${failedFiles.length} failed`}
          defaultOpen={false}
          className="mt-3"
        >
          <ul className="space-y-1 text-xs text-red-300/90 max-h-28 overflow-y-auto">
            {failedFiles.map((file) => (
              <li key={`${file.document}-${file.reason}`}>
                <span className="font-medium">{file.document}</span>
                <span className="text-red-200/60"> — {file.reason}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={reset}
            className="mt-2 inline-flex items-center gap-1 text-xs text-white/60 hover:text-white border-none bg-transparent cursor-pointer p-0"
          >
            <ArrowClockwise size={12} /> Retry
          </button>
        </CollapsibleSection>
      )}
    </div>
  );
}
