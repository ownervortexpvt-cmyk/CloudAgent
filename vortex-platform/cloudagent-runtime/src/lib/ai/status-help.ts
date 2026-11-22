/**
 * Self-explaining provider errors (rebuild of lost v43).
 *
 * The owner tests many free provider keys. When one fails, a raw
 * "HTTP 401" tells him NOTHING about what to do next. Every provider
 * failure surfaced to the chat now carries a short, honest, actionable
 * explanation: what happened, and the fastest way out (fix the key,
 * top up credit, let another agent take over, or use the device relay).
 */

export function explainProviderError(providerName: string, kind: string, message: string): string {
  const m = message || ''
  const p = providerName || kind || 'provider'

  if (/401|invalid.*key|unauthor|api key/i.test(m)) {
    return `${p}: the API key was rejected (401). Open Provider Manager → Test this key — if it fails, get a fresh key from the provider's key page and re-save it. The swarm moves your work to the next healthy agent automatically.`
  }
  if (/402|quota|billing|credit|exceeded.*balance/i.test(m)) {
    return `${p}: this key has no credit left (402). Check the provider's billing / free-tier page — free tiers reset monthly on most providers. The swarm moves your work to the next healthy agent automatically.`
  }
  if (/429|rate.*limit|too many|overloaded/i.test(m)) {
    return `${p}: rate-limited (429) — too many requests right now. The engine backs off and retries automatically; no action needed unless it keeps failing.`
  }
  if (/403|forbidden|blocked|region/i.test(m)) {
    return `${p}: access blocked (403) — this is usually the provider blocking server IPs (regions/cloud). Try the browser relay (your device's IP) or another provider.`
  }
  if (/404/i.test(m)) {
    return `${p}: endpoint/model not found (404). Check the model id and endpoint URL in Provider Manager — the model may have been renamed.`
  }
  if (/network|fetch|ECONNREFUSED|ENOTFOUND|timeout|timed out/i.test(m)) {
    return `${p}: network error reaching the provider. Check connectivity (and the endpoint URL for custom providers), then retry.`
  }
  if (/5\d\d|internal|bad gateway|service unavailable/i.test(m)) {
    return `${p}: the provider is having a server-side problem (${m.slice(0, 40)}). Usually temporary — retry, or let another agent take over.`
  }
  return `${p}: ${m.slice(0, 160)}`
}
