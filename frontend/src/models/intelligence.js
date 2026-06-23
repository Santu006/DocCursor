import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const Intelligence = {
  topicGraph: async (workspaceSlug) => {
    return await fetch(
      `${API_BASE}/workspace/${workspaceSlug}/topic-graph`,
      {
        method: "GET",
        headers: baseHeaders(),
      }
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Topic graph request failed (${res.status})`);
        return res.json();
      })
      .catch((e) => {
        console.error(e);
        return { graph: null, error: e.message };
      });
  },

  clusters: async (workspaceSlug) => {
    return await fetch(`${API_BASE}/workspace/${workspaceSlug}/clusters`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Clusters request failed (${res.status})`);
        return res.json();
      })
      .catch((e) => {
        console.error(e);
        return { clusters: null, error: e.message };
      });
  },

  relatedDocuments: async (workspaceSlug, documentId) => {
    return await fetch(
      `${API_BASE}/workspace/${workspaceSlug}/related-documents/${documentId}`,
      {
        method: "GET",
        headers: baseHeaders(),
      }
    )
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Related documents request failed (${res.status})`);
        }
        return res.json();
      })
      .catch((e) => {
        console.error(e);
        return { related: null, error: e.message };
      });
  },
};

export default Intelligence;
