import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const WorkspaceReport = {
  executive: async (workspaceSlug) => {
    return await fetch(
      `${API_BASE}/workspace/${workspaceSlug}/executive-report`,
      {
        method: "GET",
        headers: baseHeaders(),
      }
    )
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Executive report request failed (${res.status})`);
        }
        return res.json();
      })
      .catch((e) => {
        console.error(e);
        return { report: null, error: e.message };
      });
  },
};

export default WorkspaceReport;
