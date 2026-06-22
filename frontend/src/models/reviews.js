import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const Reviews = {
  list: async (workspaceSlug, { limit = 50, offset = 0, q = "", riskLevel = "", template = "" } = {}) => {
    const params = new URLSearchParams({ limit, offset });
    if (q) params.set("q", q);
    if (riskLevel) params.set("riskLevel", riskLevel);
    if (template) params.set("template", template);

    return await fetch(`${API_BASE}/workspace/${workspaceSlug}/reviews?${params}`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return { reviews: [], error: e.message };
      });
  },

  dashboard: async (workspaceSlug) => {
    return await fetch(
      `${API_BASE}/workspace/${workspaceSlug}/reviews?dashboard=true`,
      {
        method: "GET",
        headers: baseHeaders(),
      }
    )
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return { totalReviews: 0, averageRiskScore: 0, highRiskReviews: 0, recentReviews: [] };
      });
  },

  get: async (workspaceSlug, id) => {
    return await fetch(`${API_BASE}/workspace/${workspaceSlug}/reviews/${id}`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return { error: e.message };
      });
  },

  getShared: async (shareToken) => {
    return await fetch(`${API_BASE}/review/${shareToken}`, {
      method: "GET",
    })
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return { error: e.message };
      });
  },

  templates: async (workspaceSlug) => {
    return await fetch(`${API_BASE}/workspace/${workspaceSlug}/reviews/templates`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .then((data) => data.templates || [])
      .catch(() => []);
  },

  export: async (workspaceSlug, { reviewId, type = "pdf", template = null }) => {
    const response = await fetch(`${API_BASE}/workspace/${workspaceSlug}/reviews/export`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ reviewId, type, template }),
    });

    if (!response.ok) throw new Error("Export failed");
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="(.+?)"/);
    const filename = match?.[1] || `review.${type === "md" ? "md" : type}`;
    return { blob, filename };
  },

  share: async (workspaceSlug, reviewId) => {
    return await fetch(`${API_BASE}/workspace/${workspaceSlug}/reviews/share`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ reviewId }),
    })
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return { error: e.message };
      });
  },

  // Backward-compatible aliases
  history: async (workspaceSlug, opts = {}) => Reviews.list(workspaceSlug, opts),
  compare: async (workspaceSlug, body) =>
    fetch(`${API_BASE}/workspace/${workspaceSlug}/diff/compare`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(body),
    }).then((res) => res.json()),
};

export default Reviews;
