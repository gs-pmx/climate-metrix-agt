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

// Error subclass raised when the server returns a non-2xx response but
// supplies a structured JSON body (notably the calculate endpoints, which
// return the full envelope with `errors` and `partial_success` even on a
// 400 total-failure). Callers that want row-level attribution can inspect
// `err.body.errors`; legacy callers that only read `err.message` keep
// working because `message` falls back to the body's `detail` string.
export class ApiError extends Error {
  constructor(message, { status, body, url } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.url = url;
  }
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
        // Try to parse the response as JSON first so we can surface the
        // full error envelope (errors[], partial_success, etc.) to
        // callers that want row-level attribution. Fall back to text for
        // non-JSON error responses.
        const ct = res.headers.get("content-type") || "";
        let body = null;
        let msg = "";
        if (ct.includes("application/json")) {
          try {
            body = await res.json();
            msg = body?.detail || (Array.isArray(body?.errors) && body.errors[0]?.message) || `HTTP ${res.status}`;
          } catch {
            msg = `HTTP ${res.status}`;
          }
        } else {
          const text = await res.text();
          msg = text || `HTTP ${res.status}`;
        }
        throw new ApiError(msg, { status: res.status, body, url });
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
  if (lastError instanceof ApiError) {
    // Preserve the structured body for the caller; don't bury it under
    // the "Tried: ..." multi-URL message.
    throw lastError;
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
