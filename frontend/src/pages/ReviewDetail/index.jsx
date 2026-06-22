import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "@phosphor-icons/react";
import DocumentDiffReport from "@/components/WorkspaceChat/ChatContainer/ChatHistory/DocumentDiffReport";
import Reviews from "@/models/reviews";
import paths from "@/utils/paths";
import Sidebar from "@/components/Sidebar";
import { isMobile } from "react-device-detect";

export default function ReviewDetail() {
  const { slug, reviewId } = useParams();
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const data = await Reviews.get(slug, reviewId);
      setReview(data.review || null);
      setLoading(false);
    }
    if (slug && reviewId) load();
  }, [slug, reviewId]);

  return (
    <div className="w-screen h-screen overflow-hidden bg-zinc-950 flex">
      {!isMobile && <Sidebar />}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-6">
            <Link
              to={paths.workspace.reviews(slug)}
              className="text-white/60 hover:text-white transition-colors"
            >
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-white text-lg font-bold">
                {review?.title || "Document Review"}
              </h1>
              {review?.createdAt && (
                <p className="text-white/45 text-xs mt-1">
                  {new Date(review.createdAt).toLocaleString()}
                </p>
              )}
            </div>
          </div>

          {loading ? (
            <p className="text-white/50 text-sm">Loading review…</p>
          ) : !review ? (
            <p className="text-white/50 text-sm">Review not found.</p>
          ) : (
            <DocumentDiffReport
              report={review.comparison || review.report}
              reviewId={review.id}
              workspaceSlug={slug}
              title={review.title}
            />
          )}
        </div>
      </div>
    </div>
  );
}
