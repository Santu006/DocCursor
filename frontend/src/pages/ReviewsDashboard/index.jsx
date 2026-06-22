import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  MagnifyingGlass,
  TrendDown,
  TrendUp,
} from "@phosphor-icons/react";
import Sidebar from "@/components/Sidebar";
import Reviews from "@/models/reviews";
import paths from "@/utils/paths";
import { isMobile } from "react-device-detect";

function StatCard({ label, value, tone = "default" }) {
  const tones = {
    default: "text-white",
    high: "text-red-300",
    medium: "text-yellow-300",
    low: "text-green-300",
  };

  return (
    <div className="rounded-xl border border-white/10 bg-theme-bg-secondary p-4">
      <p className="text-white/50 text-xs uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tones[tone] || tones.default}`}>
        {value}
      </p>
    </div>
  );
}

function RiskBadge({ score, level }) {
  const tone =
    level === "HIGH" || (score != null && score >= 70)
      ? "bg-red-500/20 text-red-300 border-red-500/30"
      : level === "MEDIUM" || (score != null && score >= 40)
        ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
        : "bg-green-500/20 text-green-300 border-green-500/30";

  return (
    <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {score != null ? `${score}/100` : level || "—"}
    </span>
  );
}

export default function ReviewsDashboard() {
  const { slug } = useParams();
  const [dashboard, setDashboard] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [stats, list] = await Promise.all([
        Reviews.dashboard(slug),
        Reviews.list(slug, { limit: 50 }),
      ]);
      setDashboard(stats);
      setReviews(list.reviews || []);
      setLoading(false);
    }
    if (slug) load();
  }, [slug]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const list = await Reviews.list(slug, {
        q: query,
        riskLevel: riskFilter,
      });
      setReviews(list.reviews || []);
    }, 250);
    return () => clearTimeout(timer);
  }, [slug, query, riskFilter]);

  const trend = useMemo(() => {
    if (!dashboard?.recentReviews?.length) return null;
    const latest = dashboard.recentReviews[0]?.riskScore;
    const avg = dashboard.averageRiskScore;
    if (latest == null || !avg) return null;
    return latest >= avg ? "up" : "down";
  }, [dashboard]);

  return (
    <div className="w-screen h-screen overflow-hidden bg-zinc-950 light:bg-slate-50 flex">
      {!isMobile && <Sidebar />}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-6">
            <Link
              to={paths.workspace.chat(slug)}
              className="text-white/60 hover:text-white transition-colors"
            >
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-white text-xl font-bold">Comparison Reviews</h1>
              <p className="text-white/50 text-sm mt-1">
                Save, search, and revisit document comparisons
              </p>
            </div>
          </div>

          {loading ? (
            <p className="text-white/50 text-sm">Loading reviews…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <StatCard label="Total Reviews" value={dashboard?.totalReviews ?? 0} />
                <StatCard
                  label="Average Risk Score"
                  value={dashboard?.averageRiskScore ?? 0}
                  tone={
                    (dashboard?.averageRiskScore ?? 0) >= 70
                      ? "high"
                      : (dashboard?.averageRiskScore ?? 0) >= 40
                        ? "medium"
                        : "low"
                  }
                />
                <StatCard
                  label="High Risk Reviews"
                  value={dashboard?.highRiskReviews ?? 0}
                  tone="high"
                />
              </div>

              {trend && (
                <div className="mb-6 flex items-center gap-2 text-white/60 text-xs">
                  {trend === "up" ? (
                    <TrendUp className="text-red-300" size={16} />
                  ) : (
                    <TrendDown className="text-green-300" size={16} />
                  )}
                  Latest review risk is {trend === "up" ? "above" : "below"} workspace average
                </div>
              )}

              <div className="flex flex-col md:flex-row gap-3 mb-4">
                <div className="relative flex-1">
                  <MagnifyingGlass
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search reviews (NDA, arbitration, HIGH risk…)"
                    className="w-full rounded-lg bg-theme-settings-input-bg border border-white/10 pl-9 pr-3 py-2 text-white text-sm"
                  />
                </div>
                <select
                  value={riskFilter}
                  onChange={(e) => setRiskFilter(e.target.value)}
                  className="rounded-lg bg-theme-settings-input-bg border border-white/10 px-3 py-2 text-white text-sm"
                >
                  <option value="">All risk levels</option>
                  <option value="HIGH">HIGH risk</option>
                  <option value="MEDIUM">MEDIUM risk</option>
                  <option value="LOW">LOW risk</option>
                </select>
              </div>

              <section>
                <h2 className="text-white text-sm font-semibold mb-3">Recent Reviews</h2>
                {reviews.length === 0 ? (
                  <p className="text-white/50 text-sm italic">No reviews yet. Run a document comparison in chat to create one.</p>
                ) : (
                  <ul className="space-y-3">
                    {reviews.map((review) => (
                      <li key={review.id}>
                        <Link
                          to={paths.workspace.review(slug, review.id)}
                          className="block rounded-xl border border-white/10 bg-theme-bg-secondary p-4 hover:border-white/20 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-white font-medium text-sm">{review.title}</p>
                              {review.summary && (
                                <p className="text-white/55 text-xs mt-1 line-clamp-2">
                                  {review.summary}
                                </p>
                              )}
                              <p className="text-white/35 text-[10px] mt-2">
                                {new Date(review.createdAt).toLocaleString()}
                              </p>
                            </div>
                            <RiskBadge score={review.riskScore} level={review.riskLevel} />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
