// CloudAgent public gateway
// Cloudflare Worker that makes the CloudAgent builder reachable from any browser.
// The platform's FC gateway requires an x-session-id header on every request;
// browsers cannot send custom headers on navigation, so this worker injects it.
// Upstream may also answer redirects with upstream-absolute Location headers;
// those are rewritten so the visitor stays on this worker's origin.
// 2026-11-08: upstream repointed to the new sandbox FC gateway (old one 403'd).
const UPSTREAM = "https://ws-dc-ef-bddaac-ilxhiwafwe.cn-hongkong-vpc.fcapp.run";
const SESSION = "ca-builder";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const upstream = new URL(url.pathname + url.search, UPSTREAM);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("x-session-id", SESSION);
    const resp = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });
    const loc = resp.headers.get("location");
    if (loc && resp.status >= 300 && resp.status < 400) {
      const up = new URL(loc, UPSTREAM);
      if (up.origin === new URL(UPSTREAM).origin) {
        const h = new Headers(resp.headers);
        h.set("location", (up.pathname || "/") + up.search);
        return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
      }
    }
    return resp;
  },
};
