/**
 * VORTEX CLOUD AGENT SDK — drop-in client for the CLOUD AGENT platform.
 *
 * Zero dependencies (Node 18+ / Bun / any runtime with `fetch`).
 * Talks to the VORTEX SERVER central infrastructure:
 *   POST   /api/v1/cloud-agent/projects                create project
 *   POST   /api/v1/cloud-agent/projects/:id/source     register source files (base64)
 *   POST   /api/v1/cloud-agent/projects/:id/build      package pipeline
 *   GET    /api/v1/cloud-agent/projects                list projects
 *   GET    /api/v1/cloud-agent/projects/:id            detail + build history
 *   GET    /api/v1/cloud-agent/projects/:id/export?what=source|artifact
 *                                                      one signed download URL (24h)
 *   POST   /api/v1/cloud-agent/export/:id              source + artifact links together
 *
 * Auth: `Authorization: Bearer pk_live_...` (CLOUD AGENT platform key,
 * issued from VORTEX SERVER dashboard → SERVER → APIs → CLOUD AGENT → Issue key).
 *
 * Usage:
 *   import { VortexCloudAgent } from "./vortex-client.mjs";
 *   const ca = new VortexCloudAgent({ baseUrl: "https://vortex.example.com", platformKey: process.env.VORTEX_PLATFORM_KEY });
 *   const p  = await ca.createProject({ name: "My App", type: "flutter" });
 *   await ca.uploadSource(p.projectId, [{ path: "lib/main.dart", content: "void main() {}" }]);
 *   const b  = await ca.build(p.projectId);
 *   const dl = await ca.exportSigned(p.projectId, "artifact");
 *   const bytes = await ca.download(dl.url);   // Buffer
 */

export class VortexError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "VortexError";
    this.status = status;
    this.data = data;
  }
}

export class VortexCloudAgent {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl      VORTEX SERVER origin, e.g. "http://127.0.0.1:3000"
   * @param {string} opts.platformKey  pk_live_... platform key for CLOUD AGENT
   * @param {number} [opts.timeoutMs]  per-request timeout (default 30000)
   */
  constructor({ baseUrl, platformKey, timeoutMs = 30_000 }) {
    if (!baseUrl) throw new Error("baseUrl is required");
    if (!platformKey || !platformKey.startsWith("pk_live_")) {
      throw new Error('platformKey must be a pk_live_... key (see dashboard → SERVER → APIs → CLOUD AGENT → Issue key)');
    }
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.platformKey = platformKey;
    this.timeoutMs = timeoutMs;
  }

  /** Low-level JSON request. Throws VortexError on non-ok responses. */
  async request(method, path, body) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.platformKey}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new VortexError(json?.error || `HTTP ${res.status}`, res.status, json);
      }
      return json?.data ?? json;
    } finally {
      clearTimeout(t);
    }
  }

  // ---------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------

  /**
   * Create a CLOUD AGENT project. Status starts as DRAFT.
   * @param {object} p
   * @param {string} p.name        display name (max 80 chars)
   * @param {string} p.type        android|ios|web|desktop|flutter|react|java|kotlin|swift|dart|csharp|cpp|go|rust|php|html
   * @param {string} [p.language]  defaults to `type`
   * @param {string} [p.ownerEmail] end-user of YOUR app (used for per-user isolation prefix)
   * @param {object} [p.meta]      arbitrary metadata stored with the project
   * @returns {Promise<{projectId: string, name: string, type: string, status: string, prefix: string}>}
   */
  createProject(p) {
    return this.request("POST", "/api/v1/cloud-agent/projects", {
      name: p.name,
      type: p.type,
      language: p.language,
      ownerEmail: p.ownerEmail,
      meta: p.meta,
    });
  }

  listProjects() {
    return this.request("GET", "/api/v1/cloud-agent/projects").then((d) => d.projects);
  }

  getProject(projectId) {
    return this.request("GET", `/api/v1/cloud-agent/projects/${encodeURIComponent(projectId)}`);
  }

  // ---------------------------------------------------------------
  // Source upload
  // ---------------------------------------------------------------

  /**
   * Register source files into the project bucket (`cloud-agent-projects`).
   * Max 200 files per call; each file max practical size via JSON base64.
   * @param {string} projectId
   * @param {{ path: string, content: string|Buffer|Uint8Array }[]} files
   * @param {object} [opts]
   * @param {string} [opts.entry]  entry file hint stored in the manifest
   * @returns {Promise<{projectId: string, status: string, files: number, sizeBytes: number}>}
   */
  async uploadSource(projectId, files, opts = {}) {
    const payload = {
      entry: opts.entry,
      files: files
        .filter((f) => f?.path && f.content !== undefined && f.content !== null)
        .map((f) => ({
          path: f.path,
          contentB64: typeof f.content === "string"
            ? Buffer.from(f.content, "utf8").toString("base64")
            : Buffer.from(f.content).toString("base64"),
        })),
    };
    if (payload.files.length === 0) throw new Error("uploadSource: no usable files");
    return this.request("POST", `/api/v1/cloud-agent/projects/${encodeURIComponent(projectId)}/source`, payload);
  }

  // ---------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------

  /**
   * Run the packaging pipeline (manifest + sources → artifact bundle).
   * Project must not be DRAFT (upload source first).
   * @param {string} projectId
   * @param {object} [opts]  { trigger: "manual"|"agent"|"webhook" }
   * @returns {Promise<{buildId: string, status: string, sizeBytes: number, checksum: string, artifactKey: string, log: string}>}
   */
  build(projectId, opts = {}) {
    return this.request("POST", `/api/v1/cloud-agent/projects/${encodeURIComponent(projectId)}/build`, { trigger: opts.trigger || "manual" });
  }

  // ---------------------------------------------------------------
  // Export (signed URLs — HMAC, platform-bound, max 7 days)
  // ---------------------------------------------------------------

  /**
   * Get ONE signed download URL.
   * @param {string} projectId
   * @param {"source"|"artifact"} [what]  "source" = manifest.json, "artifact" = latest successful build bundle
   * @returns {Promise<{projectId: string, what: string, url: string, expiresAt: string, checksum?: string}>}
   *         `url` is always ABSOLUTE (server may return a path — this client joins it with baseUrl).
   */
  async exportSigned(projectId, what = "source") {
    const d = await this.request("GET", `/api/v1/cloud-agent/projects/${encodeURIComponent(projectId)}/export?what=${what}`);
    if (d?.url) d.url = this.absolutize(d.url);
    return d;
  }

  /**
   * Get source + artifact links in one payload (artifact null until a build succeeds).
   * Returned `url` fields are always ABSOLUTE.
   * @returns {Promise<{projectId: string, source: {url, expiresAt}|null, artifact: {url, expiresAt}|null}>}
   */
  async exportLinks(projectId) {
    const d = await this.request("POST", `/api/v1/cloud-agent/export/${encodeURIComponent(projectId)}`);
    for (const k of ["source", "artifact"]) if (d?.[k]?.url) d[k].url = this.absolutize(d[k].url);
    return d;
  }

  /** Join a server-issued signed path/URL against baseUrl. */
  absolutize(url) {
    if (!url) return url;
    try { return new URL(url, this.baseUrl + "/").toString(); } catch { return url; }
  }

  /** Fetch bytes from a signed URL (no key needed — the URL itself is the credential). */
  async download(url) {
    const res = await fetch(this.absolutize(url));
    if (!res.ok) throw new VortexError(`signed download failed: HTTP ${res.status}`, res.status);
    return Buffer.from(await res.arrayBuffer());
  }

  // ---------------------------------------------------------------
  // Convenience: full pipeline in one call
  // ---------------------------------------------------------------

  /**
   * create → upload → build → return project + build + signed links.
   * @param {object} job
   * @param {string} job.name
   * @param {string} job.type
   * @param {{ path: string, content: string|Buffer|Uint8Array }[]} job.files
   * @param {string} [job.ownerEmail]
   * @param {string} [job.entry]
   */
  async ship(job) {
    const project = await this.createProject({ name: job.name, type: job.type, ownerEmail: job.ownerEmail, meta: job.meta });
    const source = await this.uploadSource(project.projectId, job.files, { entry: job.entry });
    const build = await this.build(project.projectId, { trigger: "agent" });
    const links = await this.exportLinks(project.projectId);
    return { project, source, build, links };
  }
}
