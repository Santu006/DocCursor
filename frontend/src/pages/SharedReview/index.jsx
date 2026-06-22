import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import DocumentDiffReport from "@/components/WorkspaceChat/ChatContainer/ChatHistory/DocumentDiffReport";
import Reviews from "@/models/reviews";
import paths from "@/utils/paths";

export default function SharedReview() {
  const { shareToken } = useParams();
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const data = await Reviews.getShared(shareToken);
      setReview(data.review || null);
      setLoading(false);
    }
    if (shareToken) load();
  }, [shareToken]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/40">Shared Review</p>
            <h1 className="text-lg font-bold mt-1">
              {review?.title || "Document Comparison"}
            </h1>
          </div>
          <Link to={paths.home()} className="text-sm text-white/60 hover:text-white">
            DocCursor
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {loading ? (
          <p className="text-white/50 text-sm">Loading shared review…</p>
        ) : !review ? (
          <p className="text-white/50 text-sm">This review link is invalid or has expired.</p>
        ) : (
          <DocumentDiffReport report={review.report} readOnly title={review.title} />
        )}
      </main>
    </div>
  );
}
