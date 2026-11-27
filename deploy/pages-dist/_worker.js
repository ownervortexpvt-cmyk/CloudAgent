/**
 * VORTEX CLOUD AGENT — Cloudflare Pages `_worker.js` (Advanced Mode)
 *
 * vortex-cloud-agent.pages.dev  →  live Vortex backend (session sandbox app)
 *
 * WHY: Vortex is a full-stack Next.js server (Prisma + SQLite + auth +
 * admin control room). Static Pages hosting alone returns 405 "Method
 * Not Allowed" for every POST (login / register / admin actions) because
 * there is no server behind it. This catch-all Worker forwards EVERY
 * request — all methods, headers, cookies and bodies — to the running
 * backend, so the public Pages URL behaves exactly like the app itself.
 *
 * This is a PAGES deployment (Pages Advanced Mode), NOT a Workers
 * project — the Worker code lives inside the Pages project.
 */

const DEFAULT_BACKEND = "https://employer-domestic-clothes-operators.trycloudflare.com";
const DEFAULT_SESSION = "web-ade5d89e-9b30-402f-9325-86c152ea835d";

// Hop-by-hop headers must never be forwarded.
const HOP_HEADERS = new Set([
  "host", "connection", "keep-alive", "transfer-encoding", "upgrade",
  "proxy-authenticate", "proxy-authorization", "te", "trailer",
  "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor",
  "cf-worker", "cdn-loop", "x-real-ip",
]);

export default {
  async fetch(request, env) {
    const backend = (env && env.BACKEND_URL) || DEFAULT_BACKEND;
    const session = (env && env.BACKEND_SESSION) || DEFAULT_SESSION;

    const url = new URL(request.url);
    // v162.1 — anonymous "/" → "/landing": the app's middleware rewrite of
    // "/" is treated as a CROSS-ORIGIN rewrite behind this proxy (forwarded
    // https) and Next 16 then proxies it to itself with a broken TLS scheme
    // ("Failed to proxy https://localhost:3000/landing"). Rewriting here at
    // the edge avoids that entire class of bug; signed-in users keep their
    // real dashboard (session cookie present → pass through untouched).
    const hasSession = /(?:^|;\s*)ca_session=/.test(request.headers.get("cookie") || "");
    if (url.pathname === "/" && request.method === "GET" && !hasSession) {
      url.pathname = "/landing";
    }
    const target = backend.replace(/\/+$/, "") + url.pathname + url.search;

    const headers = new Headers();
    for (const [k, v] of request.headers.entries()) {
      const key = k.toLowerCase();
      if (HOP_HEADERS.has(key)) continue;
      if (key === "x-forwarded-host" || key === "x-forwarded-proto") continue;
      headers.set(k, v);
    }
    // Session affinity for the sandbox gateway + preserve the public host
    // so the app logs/links the pages.dev domain the visitor actually used.
    headers.set("x-session-id", session);
    headers.set("x-forwarded-host", url.host);
    headers.set("x-forwarded-proto", "https");

    let body;
    if (!["GET", "HEAD"].includes(request.method)) {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > 0) body = buf;
    }

    let resp;
    try {
      resp = await fetch(target, {
        method: request.method,
        headers,
        body,
        redirect: "manual",
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            "Vortex backend is waking up or unreachable. Open the Vortex chat session once (the app auto-boots), then reload this page.",
          hint: String(err && err.message),
        }),
        {
          status: 502,
          headers: { "content-type": "application/json", "retry-after": "10" },
        }
      );
    }

    const out = new Headers();
    for (const [k, v] of resp.headers.entries()) {
      const key = k.toLowerCase();
      if (HOP_HEADERS.has(key)) continue;
      if (key === "content-security-policy" || key === "content-security-policy-report-only") continue;
      if (key === "content-length") continue;
      out.append(k, v);
    }
    out.set("x-vortex-proxy", "pages");

    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: out,
    });
  },
};
