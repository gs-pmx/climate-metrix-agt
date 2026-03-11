function apiBaseCandidates() {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const dynamicHostBase = host ? `http://${host}:8000` : "";
  return [
    import.meta.env.VITE_API_BASE || "",
    dynamicHostBase,
    "http://localhost:8000",
    "http://127.0.0.1:8000",
  ].filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);
}

async function request(path, options = {}) {
  let lastError = null;
  const tried = [];
  for (const base of apiBaseCandidates()) {
    tried.push(`${base}${path}`);
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `HTTP ${res.status}`);
      }
      if (res.headers.get("content-type")?.includes("application/json")) {
        return res.json();
      }
      const text = await res.text();
      throw new Error(`Non-JSON response from ${base}${path}: ${text.slice(0, 80)}`);
    } catch (e) {
      lastError = e;
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError || "unknown");
  throw new Error(`API request failed. Tried: ${tried.join(", ")}. Last error: ${msg}`);
}

export const api = {
  listRouting: () => request("/catalog/routing"),
  getMethodSchema: (methodId) => request(`/schema/method/${methodId}`),
  calculate: (payload) => request("/calculate", { method: "POST", body: JSON.stringify(payload) }),
  calculateAudit: (payload) => request("/calculate/audit", { method: "POST", body: JSON.stringify(payload) }),
  listProjects: () => request("/projects"),
  createProject: (payload) => request("/projects", { method: "POST", body: JSON.stringify(payload) }),
  renameProject: (projectId, payload) =>
    request(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteProject: (projectId) => request(`/projects/${projectId}`, { method: "DELETE" }),
  listProjectVersions: (projectId) => request(`/projects/${projectId}/versions`),
  getProjectSnapshot: (projectId, versionNumber = null) =>
    request(`/projects/${projectId}/snapshot${versionNumber == null ? "" : `?version_number=${versionNumber}`}`),
  saveProjectVersion: (projectId, payload) =>
    request(`/projects/${projectId}/versions`, { method: "POST", body: JSON.stringify(payload) }),
  getSchemaMigrations: () => request("/schema/migrations"),
};
