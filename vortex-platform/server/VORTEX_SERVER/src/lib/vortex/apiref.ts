/**
 * VORTEX API REFERENCE (Phase 7 — developer portal).
 *
 * Single source of truth for the internal API catalog. Every entry is a
 * real endpoint that exists in this control plane — the portal renders
 * this catalog so the owner's developers never guess a path.
 *
 * auth:  SESSION = VORTEX ID cookie (dashboard) · API_KEY = vx_live_* key
 *        via /api/gw or /keys/verify · PUBLIC = no auth (login itself)
 */

export type ApiRefEntry = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: "SESSION" | "API_KEY" | "PUBLIC";
  desc: string;
};

export type ApiRefGroup = {
  area: string;
  module: string;
  phase: number;
  entries: ApiRefEntry[];
};

export const API_REF: ApiRefGroup[] = [
  {
    area: "CORE",
    module: "Control plane brain — registry, config, overview",
    phase: 1,
    entries: [
      { method: "GET", path: "/api/v1/overview", auth: "SESSION", desc: "Whole-platform snapshot: stats, phase progress, recent audit." },
      { method: "GET", path: "/api/v1/services", auth: "SESSION", desc: "Service registry: every module, phase, heartbeat, version." },
      { method: "POST", path: "/api/v1/services", auth: "SESSION", desc: "Register a module / update registry entry." },
      { method: "PATCH", path: "/api/v1/services", auth: "SESSION", desc: "Registry lifecycle edits (status, endpoint, version)." },
      { method: "POST", path: "/api/v1/services/heartbeat", auth: "API_KEY", desc: "Module heartbeat — serviceKey + status + metrics." },
      { method: "GET", path: "/api/v1/config", auth: "SESSION", desc: "Central config store (secrets masked)." },
      { method: "PUT", path: "/api/v1/config", auth: "SESSION", desc: "Upsert a config key with audit trail." },
      { method: "GET", path: "/api/v1/me", auth: "SESSION", desc: "Current VORTEX ID session profile." },
    ],
  },
  {
    area: "AUTH",
    module: "VORTEX ID — owner identity, OTP, sessions",
    phase: 1,
    entries: [
      { method: "POST", path: "/api/v1/auth/login", auth: "PUBLIC", desc: "Step 1 password → OTP issued. Step 2 password+otp → session cookie." },
      { method: "POST", path: "/api/v1/auth/otp", auth: "PUBLIC", desc: "Verify / resend the 6-digit OTP (sha256-stored, 5-min TTL)." },
      { method: "POST", path: "/api/v1/auth/logout", auth: "SESSION", desc: "Destroy the current session." },
    ],
  },
  {
    area: "KEYS",
    module: "SDK-style machine identity (vx_live_*)",
    phase: 1,
    entries: [
      { method: "GET", path: "/api/v1/keys", auth: "SESSION", desc: "List API keys (hash-only storage, prefix display)." },
      { method: "POST", path: "/api/v1/keys", auth: "SESSION", desc: "Create key with scopes — plaintext shown exactly once." },
      { method: "POST", path: "/api/v1/keys/revoke", auth: "SESSION", desc: "Revoke a key instantly (revocation is checked at the edge)." },
      { method: "POST", path: "/api/v1/keys/verify", auth: "API_KEY", desc: "Machine verification: key → identity, app binding, scopes." },
    ],
  },
  {
    area: "SERVERS & NETWORK",
    module: "Node provisioning + zones, IPs, DNS, firewall",
    phase: 2,
    entries: [
      { method: "GET", path: "/api/v1/servers", auth: "SESSION", desc: "Node inventory with CPU/RAM/disk, region, app binding." },
      { method: "POST", path: "/api/v1/servers", auth: "SESSION", desc: "Provision a node (auto IP, lifecycle PROVISIONING→RUNNING)." },
      { method: "PATCH", path: "/api/v1/servers", auth: "SESSION", desc: "start | stop | destroy lifecycle actions." },
      { method: "GET", path: "/api/v1/network/zones", auth: "SESSION", desc: "Network zones with IP utilization." },
      { method: "POST", path: "/api/v1/network/zones", auth: "SESSION", desc: "Create a zone (CIDR + VLAN)." },
      { method: "GET", path: "/api/v1/network/ips", auth: "SESSION", desc: "IP pool with allocation state." },
      { method: "POST", path: "/api/v1/network/ips", auth: "SESSION", desc: "Allocate / reserve / add IPs." },
      { method: "PATCH", path: "/api/v1/network/ips", auth: "SESSION", desc: "Assign / release an IP." },
      { method: "DELETE", path: "/api/v1/network/ips", auth: "SESSION", desc: "Return an IP to the pool." },
      { method: "GET", path: "/api/v1/network/dns", auth: "SESSION", desc: "Internal DNS records (vortex.internal)." },
      { method: "POST", path: "/api/v1/network/dns", auth: "SESSION", desc: "Create a DNS record." },
      { method: "GET", path: "/api/v1/network/firewall", auth: "SESSION", desc: "Firewall rules incl. protected default-deny baseline." },
      { method: "POST", path: "/api/v1/network/firewall", auth: "SESSION", desc: "Add a rule (priority-ordered)." },
    ],
  },
  {
    area: "DATABASES & BACKUPS",
    module: "Per-app data layer + encrypted 3-tier safety net",
    phase: 3,
    entries: [
      { method: "GET", path: "/api/v1/databases", auth: "SESSION", desc: "Database instances (Postgres/MySQL/Redis/Mongo), app-bound." },
      { method: "POST", path: "/api/v1/databases", auth: "SESSION", desc: "Provision DB — one-time password reveal, auto IP+DNS." },
      { method: "PATCH", path: "/api/v1/databases", auth: "SESSION", desc: "Lifecycle + credential rotate." },
      { method: "DELETE", path: "/api/v1/databases", auth: "SESSION", desc: "Destroy an instance (data gravity: confirm required)." },
      { method: "GET", path: "/api/v1/backups", auth: "SESSION", desc: "Snapshots: disk → cluster → offsite tiers, cipher, checksum." },
      { method: "POST", path: "/api/v1/backups", auth: "SESSION", desc: "Manual snapshot / restore." },
      { method: "GET", path: "/api/v1/backups/policies", auth: "SESSION", desc: "Backup schedules with retention pruning." },
      { method: "POST", path: "/api/v1/backups/policies", auth: "SESSION", desc: "Create a policy (HOURLY/DAILY/WEEKLY)." },
      { method: "GET", path: "/api/v1/monitor", auth: "SESSION", desc: "Health monitors with 24h uptime and latency." },
      { method: "POST", path: "/api/v1/monitor", auth: "SESSION", desc: "Create monitor target (URL/NODE/DATABASE/SERVICE)." },
      { method: "POST", path: "/api/v1/monitor/run", auth: "SESSION", desc: "Run all checks now." },
      { method: "GET", path: "/api/v1/monitor/alerts", auth: "SESSION", desc: "Alert events (OPEN/ACK/RESOLVED)." },
    ],
  },
  {
    area: "GATEWAY, STORAGE & FILES",
    module: "One door for app calls + SeaweedFS-design object storage",
    phase: 4,
    entries: [
      { method: "GET", path: "/api/v1/gateway", auth: "SESSION", desc: "Routes + 24h request stats (ok rate, p95, blocked)." },
      { method: "POST", path: "/api/v1/gateway", auth: "SESSION", desc: "Create route: publicPath → app/service target, scope, rate limit." },
      { method: "POST", path: "/api/v1/gateway/simulate", auth: "SESSION", desc: "Fire a simulated edge request to test the full chain." },
      { method: "ANY", path: "/api/gw/<route>/...", auth: "API_KEY", desc: "THE EDGE: key auth → WAF → rate limit → target. Logged per request." },
      { method: "GET", path: "/api/v1/storage", auth: "SESSION", desc: "Volumes + buckets (3 replicas, quotas, real bytes)." },
      { method: "POST", path: "/api/v1/storage", auth: "SESSION", desc: "Create volume / bucket (app-bound)." },
      { method: "GET", path: "/api/v1/files", auth: "SESSION", desc: "Object listing with sha256 checksums + versions." },
      { method: "POST", path: "/api/v1/files", auth: "SESSION", desc: "Upload object (multipart or base64) into a bucket." },
      { method: "GET", path: "/api/v1/files/download", auth: "SESSION", desc: "Download + integrity verify." },
    ],
  },
  {
    area: "SECURITY & DELIVERY",
    module: "WAF/DDoS edge + deployments + CI/CD + SSL",
    phase: 5,
    entries: [
      { method: "GET", path: "/api/v1/security", auth: "SESSION", desc: "Security policy, WAF rules, IP blocks, live event feed." },
      { method: "PATCH", path: "/api/v1/security", auth: "SESSION", desc: "Toggle WAF / DDoS shield / block mode." },
      { method: "POST", path: "/api/v1/security/waf", auth: "SESSION", desc: "Add WAF rule (regex, match-in, action)." },
      { method: "GET", path: "/api/v1/deploys", auth: "SESSION", desc: "Deployment history per app with health + rollback." },
      { method: "POST", path: "/api/v1/deploys", auth: "SESSION", desc: "Ship a build (NEXA_BUILDER | GIT | MANUAL)." },
      { method: "PATCH", path: "/api/v1/deploys", auth: "SESSION", desc: "rollback | stop | promote actions." },
      { method: "GET", path: "/api/v1/devops", auth: "SESSION", desc: "Pipelines, runs, SSL certificates overview." },
      { method: "POST", path: "/api/v1/devops/pipelines", auth: "SESSION", desc: "Create pipeline (Gitea repo, stages)." },
      { method: "POST", path: "/api/v1/devops/runs", auth: "SESSION", desc: "Trigger a pipeline run (build→test→deploy)." },
      { method: "POST", path: "/api/v1/devops/ssl", auth: "SESSION", desc: "Issue internal-CA certificate with auto-renew." },
    ],
  },
  {
    area: "EXPANSION",
    module: "Mail center, notifications, CDN edge, compute, AI infra",
    phase: 6,
    entries: [
      { method: "GET", path: "/api/v1/mail", auth: "SESSION", desc: "Outbox + templates + per-category stats (provider: simulated)." },
      { method: "POST", path: "/api/v1/mail", auth: "SESSION", desc: "Send via template / raw — retries and status marking." },
      { method: "GET", path: "/api/v1/notify", auth: "SESSION", desc: "Channels, routing rules, in-app feed." },
      { method: "POST", path: "/api/v1/notify", auth: "SESSION", desc: "Channel/rule management + test fan-out." },
      { method: "GET", path: "/api/v1/cdn", auth: "SESSION", desc: "Edge distributions with TTL, purge, hit-rate accounting." },
      { method: "POST", path: "/api/v1/cdn", auth: "SESSION", desc: "Create distribution (bucket → edge domain) / purge." },
      { method: "GET", path: "/api/v1/compute", auth: "SESSION", desc: "Runtime workloads (container/function/cron) + node fit." },
      { method: "POST", path: "/api/v1/compute", auth: "SESSION", desc: "create | start | stop | restart | destroy workloads." },
      { method: "GET", path: "/api/v1/ai", auth: "SESSION", desc: "Model registry (vortex-nano/mini/pro) + inference jobs." },
      { method: "POST", path: "/api/v1/ai", auth: "SESSION", desc: "Run inference job / load / unload models. Token-metered." },
    ],
  },
  {
    area: "FIREBASE MODE (P7)",
    module: "Billing showback + developer portal + docs engine",
    phase: 7,
    entries: [
      { method: "GET", path: "/api/v1/billing", auth: "SESSION", desc: "Plans, subscriptions, live metering, invoices, budgets." },
      { method: "POST", path: "/api/v1/billing", auth: "SESSION", desc: "subscribe | change_plan | set_budget | generate_invoice | issue | paid | void." },
      { method: "GET", path: "/api/v1/portal", auth: "SESSION", desc: "Docs, this API catalog, per-app integration status." },
      { method: "POST", path: "/api/v1/portal", auth: "SESSION", desc: "save_doc | delete_doc | toggle_public (gate-enforced)." },
    ],
  },
  {
    area: "VAAS CONTROL (P8)",
    module: "VORTEX AS A SERVICE — owner console over the public BaaS",
    phase: 8,
    entries: [
      { method: "GET", path: "/api/v1/vaas", auth: "SESSION", desc: "VaaS state: gate, developers, projects, usage, plans, playground bootstrap." },
      { method: "POST", path: "/api/v1/vaas", auth: "SESSION", desc: "flip_gate | create_developer | provision_project | nexa_provision | revoke_key | rotate_keys | set_project_status | set_dev_status | project_usage." },
    ],
  },
  {
    area: "VAAS SDK (P8 · PUBLIC)",
    module: "The public surface every app talks to (x-vx-key: vxk_ client key)",
    phase: 8,
    entries: [
      { method: "GET", path: "/api/vaas/v1/health", auth: "API_KEY", desc: "Project config bootstrap — initializeApp returns auth/rt/fn/storage flags." },
      { method: "POST", path: "/api/vaas/v1/dev/signup", auth: "PUBLIC", desc: "Developer self-registration (vaas.public_signup toggle)." },
      { method: "POST", path: "/api/vaas/v1/dev/login", auth: "PUBLIC", desc: "Developer console login → vdt_ token." },
      { method: "GET", path: "/api/vaas/v1/dev/me", auth: "API_KEY", desc: "Developer profile + own projects." },
      { method: "POST", path: "/api/vaas/v1/auth/signup", auth: "API_KEY", desc: "End-user registration (scrypt, per project)." },
      { method: "POST", path: "/api/vaas/v1/auth/login", auth: "API_KEY", desc: "End-user sign-in → idToken (vxt_)." },
      { method: "POST", path: "/api/vaas/v1/auth/otp-request", auth: "API_KEY", desc: "6-digit sign-in code delivered through VORTEX MAIL/SMTP." },
      { method: "POST", path: "/api/vaas/v1/auth/otp-verify", auth: "API_KEY", desc: "Verify OTP → idToken (auto-creates the user)." },
      { method: "GET", path: "/api/vaas/v1/auth/me", auth: "API_KEY", desc: "Current end-user (Bearer idToken)." },
      { method: "GET", path: "/api/vaas/v1/data/:col", auth: "API_KEY", desc: "Query docs: where, contains, orderBy, limit, skip — rules enforced server-side." },
      { method: "POST", path: "/api/vaas/v1/data/:col", auth: "API_KEY", desc: "Add a document (rules + quota checks)." },
      { method: "GET", path: "/api/vaas/v1/data/:col/:docId", auth: "API_KEY", desc: "Fetch one document." },
      { method: "PATCH", path: "/api/vaas/v1/data/:col/:docId", auth: "API_KEY", desc: "Merge-update a document (versioned)." },
      { method: "DELETE", path: "/api/vaas/v1/data/:col/:docId", auth: "API_KEY", desc: "Delete a document (owner/admin rules)." },
      { method: "POST", path: "/api/vaas/v1/storage/upload", auth: "API_KEY", desc: "Upload bytes (base64) into the project bucket — real 3x-replica storage." },
      { method: "GET", path: "/api/vaas/v1/storage/list", auth: "API_KEY", desc: "Project files + bucket usage." },
      { method: "GET", path: "/api/vaas/v1/storage/file", auth: "API_KEY", desc: "Download with checksum verification." },
      { method: "POST", path: "/api/vaas/v1/rt/publish", auth: "API_KEY", desc: "Publish a realtime event (persisted + socket.io fan-out)." },
      { method: "GET", path: "/api/vaas/v1/rt/events", auth: "API_KEY", desc: "Recent events (polling fallback)." },
      { method: "POST", path: "/api/vaas/v1/fn/:name/invoke", auth: "API_KEY", desc: "Invoke a Cloud Function (sandboxed, timeout-enforced)." },
      { method: "POST", path: "/api/vaas/v1/collections", auth: "API_KEY", desc: "ADMIN key: create a collection with read/write rules at runtime." },
    ],
  },
];

/** Human-readable phase tag for the catalog. */
export function phaseTag(phase: number): string {
  return phase === 7 ? "P7 · internal" : phase === 8 ? "P8 · vaas" : `P${phase}`;
}
