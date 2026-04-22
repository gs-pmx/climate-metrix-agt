function normalizeBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function localDevBaseCandidates() {
  if (!import.meta.env.DEV) {
    return [];
  }

  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const protocol = typeof window !== "undefined" ? window.location.protocol : "http:";
  const dynamicHostBase = host ? `${protocol}//${host}:8000` : "";

  return [dynamicHostBase, "http://127.0.0.1:8000", "http://localhost:8000"];
}

function apiBaseCandidates() {
  const configuredBase = normalizeBase(import.meta.env.VITE_API_BASE || "");
  const canonicalBase = configuredBase || "/api";

  return [
    canonicalBase,
    ...localDevBaseCandidates(),
  ]
    .map(normalizeBase)
    .filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i);
}

async function request(path, options = {}) {
  let lastError = null;
  const tried = [];
  for (const base of apiBaseCandidates()) {
    const url = `${base}${path}`;
    tried.push(url);
    try {
      const res = await fetch(url, {
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
      throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 80)}`);
    } catch (e) {
      lastError = e;
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError || "unknown");
  throw new Error(`API request failed. Tried: ${tried.join(", ")}. Last error: ${msg}`);
}

export const api = {
  listActivityTypes: (status = null) =>
    request(`/catalog/activity-types${status == null ? "" : `?status=${encodeURIComponent(status)}`}`),
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
