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
  const lastRefreshCountRef = useRef(-1);
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
    lastRefreshCountRef.current = -1;
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const handleFolderSelected = async (event) => {
    const fileList = event.target.files;
    if (!fileList?.length) return;

    const { supported } = scanFolderFiles(fileList);
    if (!supported.length) {
      showToast("No supported documents in this folder.", "error");
      return;
    }

    setPhase("uploading");
    // Keep the documents browser usable while large files embed in the background.
    setLoading?.(false);
    setLoadingMessage?.("");
    showToast(
      `Importing ${supported.length} documents. Large annual reports can take several minutes.`,
      "info"
    );

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
      await fetchKeys?.(true, { autoSelectNew: false });

      const finalJob = await FolderUpload.pollUploadStatus(workspace.slug, jobId, {
        onUpdate: (job) => {
          setJobStatus(job);
          const doneCount =
            (job?.embeddedCount ?? 0) +
            (job?.processedCount ?? 0) +
            (job?.parsedCount ?? 0);
          if (doneCount !== lastRefreshCountRef.current) {
            lastRefreshCountRef.current = doneCount;
            fetchKeys?.(true, { autoSelectNew: false });
          }
        },
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
  const indexCurrent = Math.max(
    jobStatus?.progress?.indexed ?? 0,
    jobStatus?.embeddedCount ?? 0,
    jobStatus?.processedCount ?? 0
  );
  const indexTotal = Math.max(
    jobStatus?.progress?.total ?? 0,
    jobStatus?.totalCount ?? 0,
    uploadProgress.total
  );
  const phaseLabel =
    jobStatus?.phase === "intelligence"
      ? "Building intelligence"
      : jobStatus?.phase === "embedding"
        ? "Embedding"
        : jobStatus?.phase === "parsing"
          ? "Parsing"
          : "Indexing";
  const progressDetail = [
    jobStatus?.currentFile ? `Current: ${jobStatus.currentFile}` : null,
    indexTotal > 0 ? `${indexCurrent} of ${indexTotal} files` : null,
  ]
    .filter(Boolean)
    .join(" · ");

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
        className="w-full border-2 border-dashed border-primary-button/40 light:border-blue-300 rounded-xl bg-primary-button/5 light:bg-blue-50/60 hover:bg-primary-button/10 light:hover:bg-blue-50 transition-colors p-4 flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <FolderOpen
          size={24}
          className="text-primary-button light:text-blue-600 shrink-0"
          weight="duotone"
        />
        <div className="text-left min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white light:text-slate-900">
              Upload folder / client project
            </p>
            <span className="rounded-full bg-primary-button/15 light:bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-primary-button light:text-blue-700">
              Recommended
            </span>
          </div>
          <p className="text-xs text-white/50 light:text-slate-500 mt-0.5">
            Recursively imports documents and preserves nested folder paths
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

      {phase === "indexing" && (
        <div className="mt-3 px-1">
          <CompactProgress
            label={phaseLabel}
            current={indexCurrent}
            total={indexTotal}
            estimatedSecondsRemaining={
              jobStatus?.progress?.estimatedSecondsRemaining
            }
            detail={
              progressDetail ||
              "Large PDFs/HTML filings embed chunk-by-chunk — this can take several minutes."
            }
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
