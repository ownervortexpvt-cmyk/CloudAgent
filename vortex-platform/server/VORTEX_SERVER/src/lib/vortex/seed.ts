import { db } from "@/lib/db";
import { hashPassword, sha256, generateToken } from "./crypto";
import { ensureBucketDir, writeObject, mimeFromPath } from "./storage";
import { priceUsage, periodKey, RATE_CARD } from "./billing";
import { writeAudit } from "./audit";
import { ensurePlatforms, ensureBucketRegistry, ensureCloudAgentPlans, issuePlatformKey } from "./vserver";

/**
 * VORTEX CORE — idempotent bootstrap seed.
 * Runs lazily on first API hit; safe to call concurrently (guarded by a flag row).
 *
 * Owner credentials (private control plane — the sandbox owner):
 *   admin@vortex.local / Vortex@2026
 */

const OWNER_EMAIL = "admin@vortex.local";
const OWNER_PASSWORD = "Vortex@2026";

/** Bump when new seed data ships; re-runs idempotently for the new items. */
const SEED_VERSION = "vs1.0";
type ServiceSeed = {
  serviceKey: string;
  name: string;
  description: string;
  phase: number;
  status: string;
  endpoint?: string;
  version?: string;
  /** when true, existing row is refreshed (status/version/description) on re-seed */
  refresh?: boolean;
};

// The locked ~20-module roadmap. Status reflects what is LIVE in this build.
const SERVICES: ServiceSeed[] = [
  // Phase 1 — Control plane (this build)
  { serviceKey: "core", name: "CORE", description: "Central brain: config, service registry, orchestration. This control plane.", phase: 1, status: "ONLINE", endpoint: "/api/v1", version: "0.5.0", refresh: true },
  { serviceKey: "auth", name: "AUTH — VORTEX ID", description: "Owner accounts, sessions, SSO foundation. One identity for the whole ecosystem.", phase: 1, status: "ONLINE", endpoint: "/api/v1/auth", version: "0.1.0" },
  { serviceKey: "otp", name: "OTP", description: "Email OTP for login verification (SMTP provider plugs in later).", phase: 1, status: "ONLINE", endpoint: "/api/v1/auth/otp", version: "0.1.0" },
  { serviceKey: "admin", name: "ADMIN", description: "Super admin embedded in CORE: users, apps, keys, quotas.", phase: 1, status: "ONLINE", endpoint: "/api/v1", version: "0.1.0" },
  { serviceKey: "api", name: "API GATEWAY", description: "One door for every app call: /api/gw/<route> — key auth, app binding, scopes, per-key rate limits, full access log.", phase: 4, status: "ONLINE", endpoint: "/api/gw", version: "0.4.0", refresh: true },
  { serviceKey: "mail", name: "MAIL", description: "Outbound center: provider abstraction (simulated | SMTP | Postal), templates with {{vars}}, retries, per-category stats. Honest sandbox status marking.", phase: 6, status: "ONLINE", endpoint: "/api/v1/mail", version: "0.6.0", refresh: true },

  // Phase 2 — live: provisioning + network control
  { serviceKey: "server", name: "SERVER", description: "Node inventory + provisioning engine (CPU/RAM/disk, auto IP assignment, lifecycle: provision → run → stop → destroy).", phase: 2, status: "ONLINE", endpoint: "/api/v1/servers", version: "0.2.0", refresh: true },
  { serviceKey: "network", name: "NETWORK", description: "Zones, IP pool with auto-allocation, internal DNS, firewall rules with default-deny baseline.", phase: 2, status: "ONLINE", endpoint: "/api/v1/network", version: "0.2.0", refresh: true },

  // Phase 3 — live: data layer + safety net
  { serviceKey: "database", name: "DATABASE", description: "Per-app SQL/NoSQL provisioning (PostgreSQL, MySQL, Redis, MongoDB): one-time credentials, auto IP + DNS, app-bound by design (data gravity).", phase: 3, status: "ONLINE", endpoint: "/api/v1/databases", version: "0.3.0", refresh: true },
  { serviceKey: "backup", name: "BACKUP", description: "Encrypted 3-tier snapshots (disk → cluster → offsite), schedules with retention pruning, one-click restore.", phase: 3, status: "ONLINE", endpoint: "/api/v1/backups", version: "0.3.0", refresh: true },
  { serviceKey: "monitor", name: "MONITOR", description: "Real-state health checks (nodes, databases, services, URLs), 24h uptime, alert events + mail alerts. Own dashboard — no AGPL Grafana.", phase: 3, status: "ONLINE", endpoint: "/api/v1/monitor", version: "0.3.0", refresh: true },

  // Phase 4 — live: object storage + file layer
  { serviceKey: "storage", name: "STORAGE", description: "Object storage engine (SeaweedFS design, Apache-2.0 — no AGPL): volumes hold buckets, 3 copies per object, per-app quotas. Real bytes on disk.", phase: 4, status: "ONLINE", endpoint: "/api/v1/storage", version: "0.4.0", refresh: true },
  { serviceKey: "files", name: "FILES", description: "File layer on top of STORAGE: upload, download, versioning, sha256 integrity on every read. App-scoped by design.", phase: 4, status: "ONLINE", endpoint: "/api/v1/files", version: "0.4.0", refresh: true },

  // Phase 5 — live: threat detection + app delivery
  { serviceKey: "security", name: "SECURITY", description: "Central threat detection at the gateway edge: WAF rules, IP blocklist, DDoS auto-block on rate-limit abuse, live event feed + self-test probe.", phase: 5, status: "ONLINE", endpoint: "/api/v1/security", version: "0.5.0", refresh: true },
  { serviceKey: "deploy", name: "DEPLOY", description: "App delivery pipeline: NEXA / GIT / MANUAL builds ship onto APP_RUNTIME nodes, get a health monitor, and roll back with one click (history kept).", phase: 5, status: "ONLINE", endpoint: "/api/v1/deploys", version: "0.5.0", refresh: true },
  { serviceKey: "devops", name: "DEVOPS", description: "CI/CD pipelines (Gitea + Woodpecker design): build → test → deploy runs ship real deployments; internal-CA SSL certificates with auto-renew.", phase: 5, status: "ONLINE", endpoint: "/api/v1/devops", version: "0.5.0", refresh: true },

  // Phase 6 — live: expansion modules
  { serviceKey: "notify", name: "NOTIFY", description: "Event fan-out: platform events (alerts, deploy failures, security blocks) routed by rules to in-app feed, mail outbox or app webhooks — severity thresholds included.", phase: 6, status: "ONLINE", endpoint: "/api/v1/notify", version: "0.6.0", refresh: true },
  { serviceKey: "cdn", name: "CDN", description: "Edge cache in front of STORAGE — Cloudflare free-tier design (zero cost, no lock-in): one distribution per bucket, TTL rules, purge, hit accounting.", phase: 6, status: "ONLINE", endpoint: "/api/v1/cdn", version: "0.6.0", refresh: true },
  { serviceKey: "compute", name: "COMPUTE", description: "Runtime workloads for apps (containers / functions / cron) scheduled onto APP_RUNTIME nodes with CPU/RAM guarantees and full lifecycle.", phase: 6, status: "ONLINE", endpoint: "/api/v1/compute", version: "0.6.0", refresh: true },
  { serviceKey: "ai-infra", name: "AI INFRASTRUCTURE", description: "Proprietary model serving for NEXA: vortex-nano/mini/pro registry, inference jobs, token accounting per app (billing groundwork for Phase 7 reserve).", phase: 6, status: "ONLINE", endpoint: "/api/v1/ai", version: "0.6.0", refresh: true },
  { serviceKey: "global-infra", name: "GLOBAL INFRASTRUCTURE", description: "Multi-region / edge expansion (future).", phase: 6, status: "PLANNED" },
  { serviceKey: "dns", name: "DNS", description: "Public DNS management (internal DNS already live in NETWORK).", phase: 6, status: "PLANNED" },

  // Phase 7 — "Firebase Mode" groundwork: built INTERNAL, external mode stays locked
  { serviceKey: "billing", name: "BILLING", description: "Showback metering for the owner's apps: real usage from gateway/storage/compute/AI/DB/CDN, BDT rate card, monthly invoices, budgets. Now also prices the public VAAS plans (Phase 8).", phase: 7, status: "ONLINE", endpoint: "/api/v1/billing", version: "0.7.0", refresh: true },
  { serviceKey: "dev-portal", name: "DEVELOPER PORTAL", description: "Developer hub: real API catalog, quickstart guides, per-app integration status. Public docs publishing is now OPEN via the Phase 8 gate.", phase: 7, status: "ONLINE", endpoint: "/api/v1/portal", version: "0.7.0", refresh: true },
  { serviceKey: "public-docs", name: "DOCS ENGINE", description: "Docs engine with per-doc visibility. Publishing outside the ecosystem is OPEN — future.firebase_mode = OPEN (owner decision, Phase 8).", phase: 7, status: "ONLINE", endpoint: "/api/v1/portal", version: "0.7.0", refresh: true },

  // Phase 8 — VORTEX AS A SERVICE: the public face, the Firebase's father
  { serviceKey: "vaas", name: "VAAS — VORTEX AS A SERVICE", description: "The public multi-tenant BaaS: projects + CLIENT/ADMIN keys, end-user Auth (password + OTP via MAIL), Firestore-style doc DB with server-side rules, storage on real 3x-replica buckets, socket.io realtime, sandboxed Cloud Functions. One-call backend provisioning for the NEXA AI app builder. Metered into BDT pricing.", phase: 8, status: "ONLINE", endpoint: "/api/vaas/v1", version: "0.8.0", refresh: true },
  { serviceKey: "vaas-realtime", name: "VAAS REALTIME", description: "socket.io fan-out for VxRealtimeEvent (rooms per project/channel) + polling fallback, emit door wired to the control plane.", phase: 8, status: "ONLINE", endpoint: "/api/vaas/v1/rt", version: "0.8.0", refresh: true },
  { serviceKey: "vaas-sdk", name: "VAAS SDK", description: "Drop-in vanilla JS SDK at /vortex-sdk.js: initializeApp → auth().signIn, data().collection().add, storage().upload, realtime().channel().on, functions().invoke — the Firebase-parity surface.", phase: 8, status: "ONLINE", endpoint: "/vortex-sdk.js", version: "0.8.0", refresh: true },
];

const APPS = [
  { appId: "app_nexseva", name: "NEXSEVA", slug: "nexseva", description: "Government/citizen services app — data residency: Bangladesh (verify rules)." },
  { appId: "app_nexa", name: "NEXA", slug: "nexa", description: "AI app builder — builds apps that publish into VORTEX." },
  { appId: "app_flarex", name: "FLAREX", slug: "flarex", description: "Social media platform — media-heavy, STORAGE + CDN consumer." },
  { appId: "app_vortex_store", name: "VORTEX App Store", slug: "app-store", description: "App/web store where builder apps get published." },
  { appId: "app_web_storage", name: "Website Storage", slug: "website-storage", description: "Static hosting/storage for websites." },
];

const CONFIGS = [
  { key: "platform.name", value: "VORTEX", category: "platform", description: "Platform display name" },
  { key: "platform.mode", value: "PRIVATE", category: "platform", description: "Control plane stays PRIVATE (owner only). The public face is VAAS — Phase 8." },
  { key: "platform.public_signup", value: "false", category: "platform", description: "No public signup for the CONTROL PLANE. VaaS developers sign up via /api/vaas/v1/dev/signup (vaas.public_signup)." },
  { key: "platform.version", value: "0.8.0", category: "platform", description: "Control plane version", refresh: true },
  { key: "security.otp_enabled", value: "true", category: "security", description: "Require OTP at every owner login" },
  { key: "security.otp_ttl_minutes", value: "5", category: "security", description: "OTP validity window" },
  { key: "security.admin_ip_whitelist", value: "", category: "security", description: "Optional: comma-separated IPs allowed to reach the admin panel" },
  { key: "mail.provider", value: "postal", category: "mail", description: "simulated | smtp | postal — WIRED (Phase 8): OTP + system mail go over REAL SMTP", refresh: true },
  { key: "mail.from", value: "VORTEX <no-reply@vortex.local>", category: "mail", description: "From header for system mail" },
  { key: "mail.smtp_host", value: "127.0.0.1", category: "mail", description: "Postal relay host — sandbox runs the local SMTP sink; production points at the Postal cluster", refresh: true },
  { key: "mail.smtp_port", value: "8025", category: "mail", description: "Postal relay port (SMTP sink 8025 in sandbox, 25 in production)", refresh: true },
  { key: "mail.smtp_from", value: "VORTEX <no-reply@vortex.internal>", category: "mail", description: "Envelope-from for real SMTP delivery", refresh: true },
  { key: "dev.show_otp_in_response", value: "true", category: "dev", description: "DEV ONLY: return OTP in login response so the flow is testable without SMTP" },
  { key: "storage.provider", value: "seaweedfs-engine", category: "storage", description: "Embedded SeaweedFS-style engine (Apache-2.0 design); real cluster joins later. Never MinIO (AGPL).", refresh: true },
  { key: "storage.replication", value: "3", category: "storage", description: "Copies kept per object (locked permanent-storage design)" },
  { key: "storage.volume_node", value: "vortex-storage-01", category: "storage", description: "Node hosting the SeaweedFS-style volume servers" },
  { key: "files.max_upload_mb", value: "5", category: "storage", description: "Max single upload size through the control plane" },
  { key: "gateway.base_path", value: "/api/gw", category: "gateway", description: "Public edge path: /api/gw/<route>/..." },
  { key: "gateway.default_rate_limit", value: "120", category: "gateway", description: "Default per-key requests/minute on new routes" },
  { key: "future.firebase_mode", value: "OPEN", category: "platform", description: "Phase 8 gate: OPEN — VAAS is live, public multi-tenant BaaS, NEXA-wired (owner decision, audited)", refresh: true },
  { key: "network.default_zone", value: "vortex-internal", category: "network", description: "Zone new nodes attach to by default" },
  { key: "network.firewall_default_deny", value: "true", category: "network", description: "Baseline DENY-all rule is enforced and protected" },
  { key: "server.default_os", value: "debian-12", category: "server", description: "Default OS image for provisioned nodes" },
  { key: "server.max_per_app", value: "10", category: "server", description: "Quota: max running nodes per app (ADMIN quotas groundwork)" },
  { key: "database.max_per_app", value: "10", category: "database", description: "Quota: max database instances per app" },
  { key: "database.allowed_engines", value: "POSTGRES,MYSQL,REDIS,MONGO", category: "database", description: "Engines DATABASE can provision (SQL first, then NoSQL)" },
  { key: "backup.encryption", value: "age-x25519", category: "backup", description: "Encryption cipher for every snapshot (always on)" },
  { key: "backup.offsite_target", value: "vortex-backup://dhaka-1/offsite", category: "backup", description: "Tier-3 offsite destination (permanent storage design)" },
  { key: "monitor.alert_mail_enabled", value: "true", category: "monitor", description: "Also deliver alert events into the mail outbox" },
  { key: "monitor.default_interval_sec", value: "60", category: "monitor", description: "Default check interval for new monitor targets" },
  { key: "security.block_mode", value: "BLOCK", category: "security", description: "SECURITY edge mode: BLOCK rejects threats, LOG_ONLY observes (Phase 5 WAF)" },
  { key: "security.ddos_threshold", value: "30", category: "security", description: "Rate-limit hits within 5 min before the DDoS shield auto-blocks an IP" },
  { key: "security.waf_enabled", value: "true", category: "security", description: "WAF inspection at the gateway edge (Phase 5)" },
  { key: "deploy.default_source", value: "NEXA_BUILDER", category: "deploy", description: "Default build source: NEXA_BUILDER | GIT | MANUAL" },
  { key: "deploy.runtime_node", value: "vortex-app-01", category: "deploy", description: "Default APP_RUNTIME node for deployments" },
  { key: "devops.gitea_url", value: "gitea.vortex.internal", category: "devops", description: "Internal Git hosting (CI/CD source of truth)" },
  { key: "devops.ssl_issuer", value: "VORTEX_INTERNAL_CA", category: "devops", description: "Certificate authority for internal TLS" },
  { key: "mail.templates_enabled", value: "true", category: "mail", description: "System templates render {{vars}} and feed the outbox (Phase 6)" },
  { key: "notify.inapp_enabled", value: "true", category: "notify", description: "In-app notification feed enabled for the owner (Phase 6)" },
  { key: "cdn.edge_domain", value: "cdn.vortex.internal", category: "cdn", description: "Edge domain root — Cloudflare free tier in front of STORAGE (Phase 6)" },
  { key: "cdn.default_ttl_sec", value: "300", category: "cdn", description: "Default cache TTL for new distributions" },
  { key: "compute.max_per_app", value: "6", category: "compute", description: "Quota: max runtime workloads per app" },
  { key: "compute.scheduler", value: "ram-fit", category: "compute", description: "Scheduler: packs workloads onto the APP_RUNTIME node with most free RAM" },
  { key: "ai.default_model", value: "vortex-nano", category: "ai", description: "Default serving model for NEXA builder requests" },
  { key: "ai.serving_node", value: "vortex-app-01", category: "ai", description: "Node running the model server (q4 quantization)" },
  { key: "billing.currency", value: "BDT", category: "billing", description: "Showback currency — Bangladesh taka (Phase 7)" },
  { key: "billing.mode", value: "SHOWBACK", category: "billing", description: "SHOWBACK = internal cost visibility only. CHARGE needs the Firebase Mode gate." },
  { key: "billing.vat_rate", value: "15", category: "billing", description: "VAT percent shown on showback totals (Bangladesh)" },
  // Phase 8 — VAAS
  { key: "vaas.public_signup", value: "true", category: "vaas", description: "Developers can self-register at POST /api/vaas/v1/dev/signup (Phase 8)" },
  { key: "vaas.max_projects_per_dev", value: "10", category: "vaas", description: "Project quota per developer account" },
  { key: "vaas.doc_quota_per_project", value: "5000", category: "vaas", description: "Document quota per project (Firestore-style collections)" },
  { key: "vaas.storage_quota_mb_per_project", value: "2048", category: "vaas", description: "Default project bucket quota (real STORAGE bytes, 3x replicas)" },
  { key: "vaas.max_upload_mb", value: "5", category: "vaas", description: "Max single SDK upload size" },
  { key: "vaas.fn_timeout_ms", value: "3000", category: "vaas", description: "Cloud Function execution timeout (sandboxed runtime)" },
  { key: "vaas.fn_max_per_project", value: "10", category: "vaas", description: "Function quota per project" },
  { key: "vaas.rt_history_per_project", value: "200", category: "vaas", description: "Realtime event history retained per project (polling fallback)" },
  { key: "vaas.demo_enduser_email", value: "demo@store.local", category: "vaas", description: "Seeded end-user for the Demo Store playground" },
  { key: "vaas.demo_enduser_password", value: "Demo@2026", category: "vaas", description: "Seeded end-user password for the Demo Store playground" },
] as { key: string; value: string; category: string; description: string; refresh?: boolean }[];

// ------------------------------------------------------------
// Phase 2 seed data — zones, IP pool, DNS, firewall baseline
// ------------------------------------------------------------

const ZONES = [
  { name: "vortex-internal", cidr: "10.10.0.0/16", vlan: 10, purpose: "Main private network — app runtime + control plane" },
  { name: "vortex-storage", cidr: "10.20.0.0/24", vlan: 20, purpose: "Isolated storage network (SeaweedFS, Phase 4)" },
  { name: "vortex-edge", cidr: "10.30.0.0/24", vlan: 30, purpose: "Edge/gateway network for public traffic termination" },
];

const IP_POOL: { address: string; ipType: string; status: string; assignedTo?: string; note?: string; zone?: string }[] = [
  { address: "10.10.0.1", ipType: "PRIVATE", status: "ASSIGNED", assignedTo: "vortex-core-01", note: "Control plane node", zone: "vortex-internal" },
  { address: "10.10.0.10", ipType: "PRIVATE", status: "RESERVED", note: "Reserved: DATABASE node (Phase 3)", zone: "vortex-internal" },
  { address: "10.10.0.11", ipType: "PRIVATE", status: "RESERVED", note: "Reserved: STORAGE node (Phase 4)", zone: "vortex-internal" },
  { address: "10.10.0.20", ipType: "PRIVATE", status: "FREE", zone: "vortex-internal" },
  { address: "10.10.0.21", ipType: "PRIVATE", status: "FREE", zone: "vortex-internal" },
  { address: "10.10.0.22", ipType: "PRIVATE", status: "FREE", zone: "vortex-internal" },
  { address: "10.10.0.23", ipType: "PRIVATE", status: "FREE", zone: "vortex-internal" },
  { address: "10.10.0.24", ipType: "PRIVATE", status: "FREE", zone: "vortex-internal" },
];

const DNS_RECORDS = [
  { zone: "vortex.internal", name: "core", type: "A", value: "10.10.0.1", ttl: 120, note: "" },
  { zone: "vortex.internal", name: "api", type: "A", value: "10.10.0.1", ttl: 120, note: "" },
  { zone: "vortex.internal", name: "mail", type: "A", value: "10.10.0.1", ttl: 300, note: "" },
  { zone: "vortex.internal", name: "*.apps", type: "A", value: "10.10.0.20", ttl: 60, note: "Wildcard for app runtimes" },
];

const FIREWALL_RULES = [
  { name: "Allow HTTPS from anywhere", direction: "IN", action: "ALLOW", protocol: "tcp", port: "443", source: "0.0.0.0/0", priority: 10 },
  { name: "Allow SSH from internal zone only", direction: "IN", action: "ALLOW", protocol: "tcp", port: "22", source: "10.10.0.0/16", priority: 20 },
  { name: "Allow all internal traffic", direction: "IN", action: "ALLOW", protocol: "any", port: null, source: "10.10.0.0/16", priority: 30 },
  { name: "DEFAULT DENY — everything else", direction: "IN", action: "DENY", protocol: "any", port: null, source: "0.0.0.0/0", priority: 1000, isSystem: true },
];

// ------------------------------------------------------------
// Phase 3 seed data — database node, per-app instances,
// backup policies + snapshots, monitor targets
// ------------------------------------------------------------

const DB_NODE = {
  nodeId: "srv_db000001",
  name: "vortex-db-01",
  role: "DATABASE",
  hostType: "KVM",
  status: "RUNNING",
  cpuCores: 8,
  ramMb: 16384,
  diskGb: 500,
  ipAddress: "10.10.0.10", // consumes the IP reserved for DATABASE in seed v2
  region: "dhaka-1",
  provisionedBy: "system",
};

type InstanceSeed = {
  dbId: string;
  name: string;
  engine: string;
  version: string;
  sizeMb: number;
  port: number;
  appKey: string;
};
// host is vortex-db-01, ip 10.10.0.10 for all instances (shared DB node)
const DB_INSTANCES: InstanceSeed[] = [
  { dbId: "db_nx000001", name: "nexseva-pg", engine: "POSTGRES", version: "16.4", sizeMb: 5120, port: 5432, appKey: "app_nexseva" },
  { dbId: "db_nx000002", name: "nexa-pg", engine: "POSTGRES", version: "16.4", sizeMb: 2048, port: 5432, appKey: "app_nexa" },
  { dbId: "db_nx000003", name: "flarex-pg", engine: "POSTGRES", version: "16.4", sizeMb: 8192, port: 5432, appKey: "app_flarex" },
  { dbId: "db_nx000004", name: "flarex-cache", engine: "REDIS", version: "7.4", sizeMb: 512, port: 6379, appKey: "app_flarex" },
  { dbId: "db_nx000005", name: "store-mongo", engine: "MONGO", version: "7.0", sizeMb: 2048, port: 27017, appKey: "app_vortex_store" },
];

const DB_DNS = DB_INSTANCES.map((i) => ({
  zone: "vortex.internal",
  name: `${i.name}.db`,
  type: "A",
  value: "10.10.0.10",
  ttl: 120,
}));

const H = 3600_000;
const DAY = 24 * H;

type SnapshotSeed = {
  backupId: string;
  policyId?: string;
  trigger: "POLICY" | "MANUAL";
  targetType: "DATABASE" | "SERVER";
  targetDb?: string; // dbId
  targetNode?: string; // nodeId
  targetLabel: string;
  sizeMb: number;
  ageMs: number;
  offsite?: boolean;
  status?: string;
};
const SNAPSHOTS: SnapshotSeed[] = [
  { backupId: "bkp_seednx01", policyId: "pol_seed001", trigger: "POLICY", targetType: "DATABASE", targetDb: "db_nx000001", targetLabel: "nexseva-pg", sizeMb: 1902, ageMs: 8 * H },
  { backupId: "bkp_seednx02", policyId: "pol_seed001", trigger: "POLICY", targetType: "DATABASE", targetDb: "db_nx000001", targetLabel: "nexseva-pg", sizeMb: 1861, ageMs: DAY + 8 * H, offsite: false },
  { backupId: "bkp_seednx03", policyId: "pol_seed001", trigger: "POLICY", targetType: "DATABASE", targetDb: "db_nx000001", targetLabel: "nexseva-pg", sizeMb: 1790, ageMs: 2 * DAY + 8 * H },
  { backupId: "bkp_seedfl01", policyId: "pol_seed002", trigger: "POLICY", targetType: "DATABASE", targetDb: "db_nx000003", targetLabel: "flarex-pg", sizeMb: 3011, ageMs: 2 * H },
  { backupId: "bkp_seedfl02", policyId: "pol_seed002", trigger: "POLICY", targetType: "DATABASE", targetDb: "db_nx000003", targetLabel: "flarex-pg", sizeMb: 2948, ageMs: 3 * H },
  { backupId: "bkp_seedfl03", policyId: "pol_seed002", trigger: "POLICY", targetType: "DATABASE", targetDb: "db_nx000003", targetLabel: "flarex-pg", sizeMb: 2902, ageMs: 4 * H },
  { backupId: "bkp_seedcore1", policyId: "pol_seed003", trigger: "POLICY", targetType: "SERVER", targetNode: "srv_core00001", targetLabel: "vortex-core-01", sizeMb: 8201, ageMs: 14 * H },
  { backupId: "bkp_seedcore2", policyId: "pol_seed003", trigger: "POLICY", targetType: "SERVER", targetNode: "srv_core00001", targetLabel: "vortex-core-01", sizeMb: 8140, ageMs: DAY + 14 * H },
  { backupId: "bkp_seedman1", trigger: "MANUAL", targetType: "DATABASE", targetDb: "db_nx000002", targetLabel: "nexa-pg", sizeMb: 902, ageMs: 3 * DAY, offsite: false },
  { backupId: "bkp_seedold01", policyId: "pol_seed001", trigger: "POLICY", targetType: "DATABASE", targetDb: "db_nx000001", targetLabel: "nexseva-pg", sizeMb: 1710, ageMs: 5 * DAY, status: "EXPIRED" },
];

type PolicySeed = {
  policyId: string;
  name: string;
  targetType: "DATABASE" | "SERVER";
  targetDb?: string;
  targetNode?: string;
  schedule: "HOURLY" | "DAILY" | "WEEKLY";
  retentionCount: number;
  lastRunMs: number;
  nextRunMs: number;
  runCount: number;
};
const POLICIES: PolicySeed[] = [
  { policyId: "pol_seed001", name: "nexseva-pg — daily", targetType: "DATABASE", targetDb: "db_nx000001", schedule: "DAILY", retentionCount: 14, lastRunMs: 8 * H, nextRunMs: 16 * H, runCount: 42 },
  { policyId: "pol_seed002", name: "flarex-pg — hourly", targetType: "DATABASE", targetDb: "db_nx000003", schedule: "HOURLY", retentionCount: 24, lastRunMs: 2 * H, nextRunMs: H, runCount: 190 },
  { policyId: "pol_seed003", name: "control-plane — daily", targetType: "SERVER", targetNode: "srv_core00001", schedule: "DAILY", retentionCount: 7, lastRunMs: 14 * H, nextRunMs: 10 * H, runCount: 31 },
];

type MonitorSeed = {
  monitorId: string;
  name: string;
  targetType: "URL" | "NODE" | "DATABASE" | "SERVICE";
  target: string;
  intervalSec: number;
};
const MONITORS: MonitorSeed[] = [
  { monitorId: "mon_seed0001", name: "Control plane web", targetType: "URL", target: "/", intervalSec: 60 },
  { monitorId: "mon_seed0002", name: "Core node", targetType: "NODE", target: "vortex-core-01", intervalSec: 60 },
  { monitorId: "mon_seed0003", name: "Database node", targetType: "NODE", target: "vortex-db-01", intervalSec: 60 },
  { monitorId: "mon_seed0004", name: "NEXSEVA database", targetType: "DATABASE", target: "nexseva-pg", intervalSec: 120 },
  { monitorId: "mon_seed0005", name: "AUTH module", targetType: "SERVICE", target: "auth", intervalSec: 300 },
  { monitorId: "mon_seed0006", name: "Storage node", targetType: "NODE", target: "vortex-storage-01", intervalSec: 60 },
];

// ------------------------------------------------------------
// Phase 4 seed data — storage node, volumes, buckets, real
// seed objects, gateway routes + 24h of traffic history
// ------------------------------------------------------------

const STORAGE_NODE = {
  nodeId: "srv_st000001",
  name: "vortex-storage-01",
  role: "STORAGE",
  hostType: "KVM",
  status: "RUNNING",
  cpuCores: 4,
  ramMb: 8192,
  diskGb: 2000,
  ipAddress: "10.10.0.11", // consumes the IP reserved for STORAGE in seed v2
  region: "dhaka-1",
  provisionedBy: "system",
};

const VOLUMES = [
  { volumeId: "vol_seed0001", name: "weed-vol-01", capacityGb: 1000 },
  { volumeId: "vol_seed0002", name: "weed-vol-02", capacityGb: 1000 },
];

type BucketSeed = { bucketId: string; name: string; appKey: string; storageClass: "HOT" | "WARM" | "COLD"; quotaMb: number };
const BUCKETS: BucketSeed[] = [
  { bucketId: "bkt_nxs0001", name: "nexseva-docs", appKey: "app_nexseva", storageClass: "HOT", quotaMb: 1024 },
  { bucketId: "bkt_nxa0002", name: "nexa-artifacts", appKey: "app_nexa", storageClass: "WARM", quotaMb: 2048 },
  { bucketId: "bkt_flx0003", name: "flarex-media", appKey: "app_flarex", storageClass: "HOT", quotaMb: 5120 },
  { bucketId: "bkt_str0004", name: "app-store-assets", appKey: "app_vortex_store", storageClass: "HOT", quotaMb: 1024 },
  { bucketId: "bkt_web0005", name: "website-static", appKey: "app_web_storage", storageClass: "WARM", quotaMb: 2048 },
];

type FileSeed = { fileId: string; bucket: string; path: string; content: string };
const SEED_FILES: FileSeed[] = [
  {
    fileId: "fil_seed0001",
    bucket: "nexseva-docs",
    path: "docs/welcome.txt",
    content: "NEXSEVA — Citizen Services Platform\n\nOfficial documentation object. This file lives inside VORTEX STORAGE (bucket nexseva-docs),\nreplicated 3x across SeaweedFS-style volumes. Data residency: Bangladesh (dhaka-1).\n",
  },
  {
    fileId: "fil_seed0002",
    bucket: "nexseva-docs",
    path: "docs/faq.txt",
    content: "NEXSEVA FAQ (excerpt)\n\nQ: Where is my data stored?\nA: Inside VORTEX — disk (tier 1), cluster (tier 2), offsite backup (tier 3).\nQ: Who can access it?\nA: Only NEXSEVA through its app-scoped API key via the gateway.\n",
  },
  {
    fileId: "fil_seed0003",
    bucket: "flarex-media",
    path: "media/feed-seed.json",
    content: '{"feed":"flarex","generatedBy":"vortex-storage","posts":[{"id":"p_001","media":"posts/hello.jpg","copies":3},{"id":"p_002","media":"posts/launch.mp4","copies":3}]}\n',
  },
  {
    fileId: "fil_seed0004",
    bucket: "flarex-media",
    path: "media/welcome.txt",
    content: "FLAREX media bucket — every object carries app_id=app_flarex (data gravity).\n",
  },
  {
    fileId: "fil_seed0005",
    bucket: "website-static",
    path: "index.html",
    content: "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>Hosted on VORTEX</title></head>\n<body><h1>Website Storage</h1><p>Served from bucket website-static, 3 copies, dhaka-1.</p></body></html>\n",
  },
  {
    fileId: "fil_seed0006",
    bucket: "website-static",
    path: "assets/app.css",
    content: "body{font-family:system-ui;margin:0;background:#0b0616;color:#eee}\nh1{color:#a78bfa}\n",
  },
  {
    fileId: "fil_seed0007",
    bucket: "app-store-assets",
    path: "manifest.json",
    content: '{"store":"VORTEX App Store","listings":["nexa-built-demo","flarex-lite"],"assetCdn":"phase-6:cloudflare-free-tier"}\n',
  },
  {
    fileId: "fil_seed0008",
    bucket: "nexa-artifacts",
    path: "builds/first-build.txt",
    content: "NEXA build artifact #1\nbuilder: nexa (AI app builder)\ntarget runtime: VORTEX COMPUTE (Phase 6)\nstatus: archived\n",
  },
];

type RouteSeed = {
  routeId: string;
  name: string;
  publicPath: string;
  targetType: "APP" | "SERVICE" | "MOCK";
  target: string;
  auth: "API_KEY" | "PUBLIC";
  requiredScope: string;
  rateLimitPerMin: number;
  appKey: string | null;
};
const ROUTES: RouteSeed[] = [
  { routeId: "gw_seed0001", name: "NEXSEVA public API", publicPath: "nexseva", targetType: "APP", target: "app_nexseva", auth: "API_KEY", requiredScope: "read", rateLimitPerMin: 120, appKey: "app_nexseva" },
  { routeId: "gw_seed0002", name: "NEXA builder API", publicPath: "nexa", targetType: "APP", target: "app_nexa", auth: "API_KEY", requiredScope: "read", rateLimitPerMin: 120, appKey: "app_nexa" },
  { routeId: "gw_seed0003", name: "FLAREX media feed", publicPath: "flarex", targetType: "SERVICE", target: "storage", auth: "API_KEY", requiredScope: "read", rateLimitPerMin: 600, appKey: "app_flarex" },
  { routeId: "gw_seed0004", name: "App Store catalog", publicPath: "store", targetType: "APP", target: "app_vortex_store", auth: "API_KEY", requiredScope: "read", rateLimitPerMin: 300, appKey: "app_vortex_store" },
  { routeId: "gw_seed0005", name: "Website storage writer", publicPath: "web", targetType: "SERVICE", target: "files", auth: "API_KEY", requiredScope: "write", rateLimitPerMin: 240, appKey: "app_web_storage" },
  { routeId: "gw_seed0006", name: "Public status probe", publicPath: "status", targetType: "SERVICE", target: "core", auth: "PUBLIC", requiredScope: "none", rateLimitPerMin: 60, appKey: null },
];

// ------------------------------------------------------------
// Phase 5 seed data — APP_RUNTIME node, SECURITY baseline
// (policy + WAF rules + blocklist + events), deployments,
// CI/CD pipelines + runs, SSL certificates
// ------------------------------------------------------------

const APP_NODE = {
  nodeId: "srv_app00001",
  name: "vortex-app-01",
  role: "APP_RUNTIME",
  hostType: "KVM",
  status: "RUNNING",
  cpuCores: 8,
  ramMb: 16384,
  diskGb: 200,
  ipAddress: "10.10.0.20", // consumes the first FREE ip from seed v2
  region: "dhaka-1",
  provisionedBy: "system",
};

const SECURITY_POLICY_SEED = {
  singleton: "global",
  wafEnabled: true,
  ipBlockEnabled: true,
  ddosEnabled: true,
  ddosThreshold: 30,
  blockMode: "BLOCK",
};

type WafRuleSeed = {
  ruleId: string;
  name: string;
  pattern: string;
  matchIn: "PATH" | "QUERY" | "BODY" | "USER_AGENT" | "HEADER";
  headerName?: string;
  action: "BLOCK" | "LOG";
  severity: "CRITICAL" | "WARNING" | "INFO";
};
const WAF_RULES: WafRuleSeed[] = [
  // patterns must survive URL-encoding (URLSearchParams.toString() encodes "/" as %2F)
  { ruleId: "waf_seed0001", name: "SQL injection probe", pattern: "union\\s+select|or\\s+1=1|;\\s*--|drop\\s+table", matchIn: "QUERY", action: "BLOCK", severity: "CRITICAL" },
  { ruleId: "waf_seed0002", name: "Path traversal", pattern: "\\.\\.(%2f|/)", matchIn: "QUERY", action: "BLOCK", severity: "CRITICAL" },
  { ruleId: "waf_seed0003", name: "Admin panel probe", pattern: "^/(admin|wp-admin|phpmyadmin|\\.env|\\.git)", matchIn: "PATH", action: "BLOCK", severity: "WARNING" },
  { ruleId: "waf_seed0004", name: "XSS probe", pattern: "<script|javascript:|onerror\\s*=", matchIn: "QUERY", action: "BLOCK", severity: "WARNING" },
  { ruleId: "waf_seed0005", name: "Known scanner user-agents", pattern: "sqlmap|nikto|nmap|masscan|dirbuster", matchIn: "USER_AGENT", action: "BLOCK", severity: "CRITICAL" },
  { ruleId: "waf_seed0006", name: "Fuzzing observation", pattern: "(acunetix|w3af|whatweb)", matchIn: "USER_AGENT", action: "LOG", severity: "INFO" },
];

const IP_BLOCKS_SEED = [
  { ip: "203.0.113.66", reason: "Repeated /.env and /wp-admin probing against every route", source: "MANUAL", createdBy: "admin@vortex.local", hours: null as number | null },
  { ip: "198.51.100.7", reason: "Auto-blocked: 34 rate-limit violations in 5 minutes (DDoS shield)", source: "AUTO_RATE", createdBy: "security", hours: 1 },
];

type SecEventSeed = {
  type: string;
  severity: string;
  sourceIp?: string;
  routeKey?: string;
  action: string;
  detail: string;
  ageMs: number;
};
const SECURITY_EVENTS: SecEventSeed[] = [
  { type: "WAF_BLOCK", severity: "CRITICAL", sourceIp: "198.51.100.23", routeKey: "flarex", action: "blocked", detail: "Rule \"SQL injection probe\" matched in QUERY", ageMs: 2 * H },
  { type: "WAF_BLOCK", severity: "CRITICAL", sourceIp: "203.0.113.66", routeKey: "store", action: "blocked", detail: "Rule \"Admin panel probe\" matched in PATH", ageMs: 5 * H },
  { type: "WAF_BLOCK", severity: "CRITICAL", sourceIp: "198.51.100.23", routeKey: "nexseva", action: "blocked", detail: "Rule \"Path traversal\" matched in QUERY", ageMs: 7 * H },
  { type: "WAF_BLOCK", severity: "WARNING", sourceIp: "192.0.2.140", routeKey: "web", action: "blocked", detail: "Rule \"XSS probe\" matched in QUERY", ageMs: 11 * H },
  { type: "RATE_ABUSE", severity: "CRITICAL", sourceIp: "198.51.100.7", routeKey: "flarex", action: "counting", detail: "34/30 rate-limit hits in 5 min", ageMs: 13 * H },
  { type: "IP_BLOCKED", severity: "CRITICAL", sourceIp: "198.51.100.7", action: "blocked for 1h", detail: "Auto-blocked: 34 rate-limit violations in 5 minutes (DDoS shield)", ageMs: 13 * H },
  { type: "WAF_BLOCK", severity: "INFO", sourceIp: "192.0.2.99", routeKey: "store", action: "logged", detail: "Rule \"Fuzzing observation\" matched in USER_AGENT (observe only)", ageMs: 19 * H },
  { type: "IP_BLOCKED", severity: "WARNING", sourceIp: "203.0.113.66", action: "blocked permanently", detail: "Repeated /.env and /wp-admin probing against every route", ageMs: 26 * H },
  { type: "RULE_ADDED", severity: "INFO", action: "rule added (LOG)", detail: "Fuzzing observation — /(acunetix|w3af|whatweb)/i in USER_AGENT", ageMs: 30 * H },
  { type: "POLICY_UPDATED", severity: "INFO", action: "policy updated", detail: "waf=true blocklist=true ddos=true mode=BLOCK", ageMs: 32 * H },
];

type CertSeed = { certId: string; domain: string; issuer: string; targetLabel: string; expiresInDays: number };
const SSL_CERTS: CertSeed[] = [
  { certId: "ssl_seed0001", domain: "vortex.internal", issuer: "VORTEX_INTERNAL_CA", targetLabel: "Control plane web + core APIs", expiresInDays: 74 },
  { certId: "ssl_seed0002", domain: "api.vortex.internal", issuer: "VORTEX_INTERNAL_CA", targetLabel: "Gateway edge /api/gw", expiresInDays: 74 },
  { certId: "ssl_seed0003", domain: "*.apps.vortex.internal", issuer: "VORTEX_INTERNAL_CA", targetLabel: "Wildcard for all deployed app runtimes", expiresInDays: 41 },
  { certId: "ssl_seed0004", domain: "gitea.vortex.internal", issuer: "VORTEX_INTERNAL_CA", targetLabel: "Internal Git hosting (CI/CD)", expiresInDays: 12 },
];

type PipelineSeed = {
  pipelineId: string;
  appKey: string;
  name: string;
  repo: string;
  branch: string;
  trigger: "PUSH" | "MANUAL" | "WEBHOOK";
};
const PIPELINES: PipelineSeed[] = [
  { pipelineId: "pip_seed0001", appKey: "app_nexseva", name: "nexseva-main", repo: "gitea.vortex.internal/vortex/nexseva", branch: "main", trigger: "PUSH" },
  { pipelineId: "pip_seed0002", appKey: "app_flarex", name: "flarex-main", repo: "gitea.vortex.internal/vortex/flarex", branch: "main", trigger: "PUSH" },
  { pipelineId: "pip_seed0003", appKey: "app_vortex_store", name: "store-main", repo: "gitea.vortex.internal/vortex/app-store", branch: "main", trigger: "WEBHOOK" },
  { pipelineId: "pip_seed0004", appKey: "app_web_storage", name: "web-storage-main", repo: "gitea.vortex.internal/vortex/website-storage", branch: "main", trigger: "PUSH" },
  { pipelineId: "pip_seed0005", appKey: "app_nexa", name: "nexa-nightly", repo: "gitea.vortex.internal/vortex/nexa", branch: "nightly", trigger: "MANUAL" },
];

type RunSeed = {
  runId: string;
  pipelineId: string;
  commitSha: string;
  commitMessage: string;
  trigger: string;
  status: "SUCCESS" | "FAILED";
  ageMs: number;
  deployVersion?: string;
};
const PIPELINE_RUNS: RunSeed[] = [
  { runId: "run_seed0001", pipelineId: "pip_seed0001", commitSha: "9f3ab12c7d", commitMessage: "citizen grievance flow: attach NID scan", trigger: "PUSH", status: "SUCCESS", ageMs: 3 * H, deployVersion: "1.11.0" },
  { runId: "run_seed0002", pipelineId: "pip_seed0002", commitSha: "4c81e0fa2b", commitMessage: "feed: paginate media cache", trigger: "PUSH", status: "SUCCESS", ageMs: 6 * H, deployVersion: "2.4.0" },
  { runId: "run_seed0003", pipelineId: "pip_seed0003", commitSha: "b77d9c1e55", commitMessage: "listing screenshots CDN hints", trigger: "WEBHOOK", status: "SUCCESS", ageMs: 9 * H, deployVersion: "0.8.0" },
  { runId: "run_seed0004", pipelineId: "pip_seed0002", commitSha: "d02f77aa91", commitMessage: "hotfix: upload retry on flaky edge", trigger: "PUSH", status: "FAILED", ageMs: 14 * H },
  { runId: "run_seed0005", pipelineId: "pip_seed0001", commitSha: "e5c44b8d20", commitMessage: "weekly dependency refresh", trigger: "PUSH", status: "SUCCESS", ageMs: 21 * H, deployVersion: "1.10.0" },
  { runId: "run_seed0006", pipelineId: "pip_seed0005", commitSha: "1a99cc0f34", commitMessage: "nightly: builder template refresh", trigger: "MANUAL", status: "SUCCESS", ageMs: 26 * H, deployVersion: "0.9.0" },
  { runId: "run_seed0007", pipelineId: "pip_seed0004", commitSha: "88ab12ff6e", commitMessage: "static index cache headers", trigger: "PUSH", status: "SUCCESS", ageMs: 31 * H, deployVersion: "1.3.0" },
];

type DeploySeed = {
  deployId: string;
  appKey: string;
  version: string;
  buildNumber: number;
  source: "NEXA_BUILDER" | "GIT" | "MANUAL";
  status: "RUNNING" | "ROLLED_BACK" | "STOPPED";
  health: "HEALTHY" | "PENDING";
  ageMs: number;
  rollbackOf?: string;
  note?: string;
};
const DEPLOYMENTS: DeploySeed[] = [
  { deployId: "dep_seed0001", appKey: "app_nexseva", version: "1.11.0", buildNumber: 11, source: "GIT", status: "RUNNING", health: "HEALTHY", ageMs: 3 * H },
  { deployId: "dep_seed0002", appKey: "app_nexseva", version: "1.10.0", buildNumber: 10, source: "GIT", status: "ROLLED_BACK", health: "PENDING", ageMs: 21 * H },
  { deployId: "dep_seed0003", appKey: "app_nexseva", version: "1.9.0", buildNumber: 9, source: "NEXA_BUILDER", status: "ROLLED_BACK", health: "PENDING", ageMs: 3 * DAY },
  { deployId: "dep_seed0004", appKey: "app_flarex", version: "2.4.0", buildNumber: 24, source: "GIT", status: "RUNNING", health: "HEALTHY", ageMs: 6 * H },
  { deployId: "dep_seed0005", appKey: "app_flarex", version: "2.3.0", buildNumber: 23, source: "GIT", status: "ROLLED_BACK", health: "PENDING", ageMs: 2 * DAY },
  { deployId: "dep_seed0006", appKey: "app_vortex_store", version: "0.8.0", buildNumber: 8, source: "NEXA_BUILDER", status: "RUNNING", health: "HEALTHY", ageMs: 9 * H },
  { deployId: "dep_seed0007", appKey: "app_web_storage", version: "1.3.0", buildNumber: 3, source: "MANUAL", status: "RUNNING", health: "HEALTHY", ageMs: 31 * H },
  { deployId: "dep_seed0008", appKey: "app_nexa", version: "0.9.0", buildNumber: 9, source: "NEXA_BUILDER", status: "RUNNING", health: "HEALTHY", ageMs: 26 * H },
  { deployId: "dep_seed0009", appKey: "app_flarex", version: "2.2.0", buildNumber: 22, source: "GIT", status: "STOPPED", health: "PENDING", ageMs: 5 * DAY, note: "traffic drained after hotfix deploy" },
];

// ------------------------------------------------------------
// Phase 6 seed data — mail templates, notification channels/rules,
// CDN distributions, compute workloads, AI models + job history
// ------------------------------------------------------------

const MAIL_TEMPLATES = [
  { key: "otp_login", name: "Login OTP", subject: "VORTEX ID — your login code is {{code}}", body: "Your VORTEX ID verification code:\n\n{{code}}\n\nValid for {{minutes}} minutes. If this wasn't you, ignore this mail — nobody else can see this address.", category: "otp" },
  { key: "alert_open", name: "Alert opened", subject: "[{{severity}}] {{target}} needs attention", body: "Monitor {{target}} reports:\n\n{{message}}\n\nOpened at {{time}} — check the MONITOR view for live state.", category: "alert" },
  { key: "deploy_failed", name: "Deployment failed", subject: "Deploy failed: {{app}} v{{version}}", body: "Deployment {{deployId}} for {{app}} v{{version}} failed at the {{stage}} stage.\n\n{{error}}\n\nRollback stays available from the DEPLOY view.", category: "deploy" },
  { key: "backup_done", name: "Backup completed", subject: "Snapshot {{backupId}} completed", body: "{{target}} was snapshotted ({{sizeMb}} MB, cipher {{cipher}}).\nTiers: disk={{tierDisk}} cluster={{tierCluster}} offsite={{tierOffsite}}.", category: "system" },
  { key: "weekly_digest", name: "Weekly platform digest", subject: "VORTEX weekly digest — week of {{date}}", body: "Apps: {{apps}}\nGateway requests (7d): {{requests}}\nBlocked threats: {{blocked}}\nBackups taken: {{backups}}\nAI tokens served: {{tokens}}\n\n— VORTEX CORE (private ecosystem, owner only)", category: "system" },
];

type ChannelSeed = { channelId: string; name: string; type: string; target: string; appKey?: string; isSystem?: boolean };
const NOTIFY_CHANNELS: ChannelSeed[] = [
  { channelId: "chn_seedinap", name: "Owner in-app feed", type: "INAPP", target: "", isSystem: true },
  { channelId: "chn_seedmail", name: "Owner email (outbox)", type: "EMAIL", target: "admin@vortex.local", isSystem: true },
  { channelId: "chn_seedops1", name: "Ops webhook", type: "WEBHOOK", target: "https://hooks.vortex.internal/ops", isSystem: true },
  { channelId: "chn_seedflx1", name: "FLAREX platform hooks", type: "WEBHOOK", target: "https://flarex.apps.vortex.internal/hooks", appKey: "app_flarex" },
];

type RuleSeed = { ruleId: string; name: string; eventType: string; minSeverity: string; channelKey: string };
const NOTIFY_RULES: RuleSeed[] = [
  { ruleId: "nrl_seed001", name: "ALERT_OPEN → Owner email", eventType: "ALERT_OPEN", minSeverity: "WARNING", channelKey: "chn_seedmail" },
  { ruleId: "nrl_seed002", name: "ALERT_OPEN → Ops webhook", eventType: "ALERT_OPEN", minSeverity: "CRITICAL", channelKey: "chn_seedops1" },
  { ruleId: "nrl_seed003", name: "DEPLOY_FAILED → In-app feed", eventType: "DEPLOY_FAILED", minSeverity: "INFO", channelKey: "chn_seedinap" },
  { ruleId: "nrl_seed004", name: "BACKUP_FAILED → Owner email", eventType: "BACKUP_FAILED", minSeverity: "WARNING", channelKey: "chn_seedmail" },
  { ruleId: "nrl_seed005", name: "SECURITY_BLOCK → Ops webhook", eventType: "SECURITY_BLOCK", minSeverity: "CRITICAL", channelKey: "chn_seedops1" },
];

type NotifSeed = { title: string; body: string; source: string; severity: string; channelType: string; ageMs: number; read: boolean };
const NOTIFICATIONS: NotifSeed[] = [
  { title: "flarex v2.4.0 shipped", body: "DEPLOY put flarex v2.4.0 live on vortex-app-01 — health checks green, CDN distribution warmed.", source: "DEPLOY", severity: "INFO", channelType: "INAPP", ageMs: 6 * H, read: false },
  { title: "Auto-block: 198.51.100.7", body: "SECURITY auto-blocked 198.51.100.7 for 1h after 34 rate-limit violations in 5 minutes (DDoS shield).", source: "SECURITY", severity: "CRITICAL", channelType: "INAPP", ageMs: 13 * H, read: false },
  { title: "flarex-pg hourly snapshot done", body: "3,011 MB snapshotted — disk + cluster tiers, offsite queued.", source: "BACKUP", severity: "INFO", channelType: "INAPP", ageMs: 2 * H, read: true },
  { title: "vortex-app-01 recovered", body: "Monitor went UP again after 2 failed checks (avg latency 41ms).", source: "MONITOR", severity: "INFO", channelType: "INAPP", ageMs: 26 * H, read: true },
];

type DistSeed = { distId: string; name: string; domain: string; bucket: string; ttlSec: number; hits: number; misses: number; bandwidthMb: number; status?: string; ageMs: number };
const CDN_DISTS: DistSeed[] = [
  { distId: "cdn_seedflx1", name: "FLAREX media edge", domain: "cdn.flarex.vortex.internal", bucket: "flarex-media", ttlSec: 300, hits: 41231, misses: 6184, bandwidthMb: 8120, ageMs: 12 * DAY },
  { distId: "cdn_seedweb1", name: "Website static edge", domain: "cdn.websites.vortex.internal", bucket: "website-static", ttlSec: 3600, hits: 9102, misses: 1130, bandwidthMb: 940, ageMs: 9 * DAY },
  { distId: "cdn_seedstr1", name: "App Store assets edge", domain: "cdn.store.vortex.internal", bucket: "app-store-assets", ttlSec: 86400, hits: 2210, misses: 602, bandwidthMb: 310, status: "PAUSED", ageMs: 6 * DAY },
];

type WorkloadSeed = { workloadId: string; name: string; image: string; kind: string; appKey: string; cpuMilli: number; ramMb: number; status: string; restarts?: number; ageMs: number };
const WORKLOADS: WorkloadSeed[] = [
  { workloadId: "wrk_seednexa1", name: "nexa-runtime", image: "vortex/nexa-runtime:1.4", kind: "CONTAINER", appKey: "app_nexa", cpuMilli: 1000, ramMb: 1024, status: "RUNNING", restarts: 2, ageMs: 10 * DAY },
  { workloadId: "wrk_seedflx01", name: "flarex-api", image: "vortex/flarex-api:2.1", kind: "CONTAINER", appKey: "app_flarex", cpuMilli: 2000, ramMb: 2048, status: "RUNNING", ageMs: 8 * DAY },
  { workloadId: "wrk_seednxs01", name: "nexseva-jobs", image: "vortex/nexseva-jobs:0.9", kind: "CRON", appKey: "app_nexseva", cpuMilli: 500, ramMb: 512, status: "STOPPED", ageMs: 15 * DAY },
];

type ModelSeed = { modelId: string; name: string; paramsB: string; contextK: number; status: string; requests: number; tokensIn: number; tokensOut: number; avgLatency: number };
const AI_MODELS: ModelSeed[] = [
  { modelId: "aim_seednano1", name: "vortex-nano", paramsB: "1.5B", contextK: 32, status: "READY", requests: 1820, tokensIn: 412_000, tokensOut: 388_500, avgLatency: 210 },
  { modelId: "aim_seedmini1", name: "vortex-mini", paramsB: "7B", contextK: 64, status: "READY", requests: 642, tokensIn: 298_000, tokensOut: 240_100, avgLatency: 480 },
  { modelId: "aim_seedpro01", name: "vortex-pro", paramsB: "32B", contextK: 128, status: "LOADING", requests: 0, tokensIn: 0, tokensOut: 0, avgLatency: 0 },
];

type JobSeed = { jobId: string; modelKey: string; appKey: string; prompt: string; tokensIn: number; tokensOut: number; latencyMs: number; ageMs: number };
const AI_JOBS: JobSeed[] = [
  { jobId: "job_seed00001", modelKey: "aim_seednano1", appKey: "app_nexa", prompt: "Generate a citizen grievance form for NEXSEVA with NID attachment", tokensIn: 38, tokensOut: 142, latencyMs: 231, ageMs: 40 * 60_000 },
  { jobId: "job_seed00002", modelKey: "aim_seedmini1", appKey: "app_nexa", prompt: "Summarize this week's FLAREX moderation queue and suggest rule tweaks", tokensIn: 512, tokensOut: 96, latencyMs: 498, ageMs: 3 * H },
  { jobId: "job_seed00003", modelKey: "aim_seednano1", appKey: "app_nexa", prompt: "Draft the store listing description for nexa-built-demo", tokensIn: 64, tokensOut: 88, latencyMs: 187, ageMs: 9 * H },
];

// ------------------------------------------------------------
// Phase 7 — BILLING showback baseline + PORTAL docs
// ------------------------------------------------------------

type PlanSeed = {
  planId: string; code: string; name: string; audience: string; monthlyBaseBdt: number;
  inclApiCalls?: number; inclStorageMb?: number; inclComputeHours?: number; inclAiTokens?: number; inclDbMb?: number; inclCdnMb?: number;
  isActive?: boolean; isDefault?: boolean; note: string;
};
const BILLING_PLANS: PlanSeed[] = [
  { planId: "plan_showback01", code: "INTERNAL_SHOWBACK", name: "Internal Showback", audience: "INTERNAL", monthlyBaseBdt: 0, isDefault: true, note: "Owner's apps — see what each one really costs. Nothing is charged externally." },
  { planId: "plan_team00001", code: "TEAM_STANDARD", name: "Team Standard (chargeback)", audience: "INTERNAL", monthlyBaseBdt: 4900, inclApiCalls: 5000000, inclStorageMb: 102400, inclComputeHours: 1488, inclAiTokens: 12000000, inclDbMb: 204800, inclCdnMb: 204800, note: "Real chargeback base for shared-node cost splitting between the owner's own teams." },
  { planId: "plan_exthobby1", code: "EXTERNAL_HOBBY", name: "External Hobby (Firebase Mode)", audience: "EXTERNAL_RESERVED", monthlyBaseBdt: 0, inclApiCalls: 100000, inclStorageMb: 5120, inclComputeHours: 24, inclAiTokens: 100000, inclDbMb: 5120, inclCdnMb: 10240, isActive: false, note: "Locked Firebase Mode reserve — cannot be subscribed while the gate is LOCKED." },
  { planId: "plan_extpro001", code: "EXTERNAL_PRO", name: "External Pro (Firebase Mode)", audience: "EXTERNAL_RESERVED", monthlyBaseBdt: 9900, inclApiCalls: 2000000, inclStorageMb: 51200, inclComputeHours: 744, inclAiTokens: 5000000, inclDbMb: 102400, inclCdnMb: 102400, isActive: false, note: "Locked Firebase Mode reserve — cannot be subscribed while the gate is LOCKED." },
  // Phase 8 — VAAS public plans (the reserve became an offering)
  { planId: "plan_vaas_free1", code: "VAAS_FREE", name: "VaaS Free", audience: "EXTERNAL", monthlyBaseBdt: 0, inclApiCalls: 100000, inclStorageMb: 512, isDefault: false, note: "Public tier for VaaS projects — auth, data, storage, realtime, functions with generous free allowances." },
  { planId: "plan_vaas_pro01", code: "VAAS_PRO", name: "VaaS Pro", audience: "EXTERNAL", monthlyBaseBdt: 990, inclApiCalls: 2000000, inclStorageMb: 5120, isDefault: false, note: "Production tier: 2M SDK calls, 5 GB project storage, priority realtime fan-out." },
];

type SubSeed = { subId: string; appKey: string; planId: string; budgetMonthlyBdt: number | null };
const BILLING_SUBS: SubSeed[] = [
  { subId: "sub_seednexseva", appKey: "app_nexseva", planId: "plan_showback01", budgetMonthlyBdt: 60000 },
  { subId: "sub_seednexa01", appKey: "app_nexa", planId: "plan_team00001", budgetMonthlyBdt: 80000 },
  { subId: "sub_seedflarex1", appKey: "app_flarex", planId: "plan_team00001", budgetMonthlyBdt: 90000 },
  { subId: "sub_seedstore01", appKey: "app_vortex_store", planId: "plan_showback01", budgetMonthlyBdt: 40000 },
  { subId: "sub_seedwebst01", appKey: "app_web_storage", planId: "plan_showback01", budgetMonthlyBdt: 25000 },
];

// Previous month's metered snapshot (BDT rate card applies over allowances).
type UsageSeed = { appKey: string; API_CALLS: number; STORAGE_MB: number; COMPUTE_HOURS: number; AI_TOKENS: number; DB_SIZE_MB: number; CDN_BANDWIDTH_MB: number };
const PREV_USAGE: UsageSeed[] = [
  { appKey: "app_nexseva", API_CALLS: 1240000, STORAGE_MB: 68000, COMPUTE_HOURS: 620, AI_TOKENS: 0, DB_SIZE_MB: 80000, CDN_BANDWIDTH_MB: 30000 },
  { appKey: "app_nexa", API_CALLS: 480000, STORAGE_MB: 12000, COMPUTE_HOURS: 780, AI_TOKENS: 9400000, DB_SIZE_MB: 40000, CDN_BANDWIDTH_MB: 8000 },
  { appKey: "app_flarex", API_CALLS: 3900000, STORAGE_MB: 240000, COMPUTE_HOURS: 700, AI_TOKENS: 250000, DB_SIZE_MB: 120000, CDN_BANDWIDTH_MB: 480000 },
  { appKey: "app_vortex_store", API_CALLS: 950000, STORAGE_MB: 45000, COMPUTE_HOURS: 300, AI_TOKENS: 0, DB_SIZE_MB: 30000, CDN_BANDWIDTH_MB: 90000 },
  { appKey: "app_web_storage", API_CALLS: 120000, STORAGE_MB: 30000, COMPUTE_HOURS: 0, AI_TOKENS: 0, DB_SIZE_MB: 10000, CDN_BANDWIDTH_MB: 60000 },
];

type DocSeed = { docId: string; slug: string; title: string; category: string; order: number; body: string; public?: boolean };
const PORTAL_DOCS: DocSeed[] = [
  {
    docId: "doc_quickstart", slug: "quickstart", title: "VORTEX Quickstart", category: "GET_STARTED", order: 10,
    body: [
      "Get one of the owner's apps talking to the private control plane in three steps.",
      "",
      "## 1. Get a machine identity",
      "In **API Keys**, create a key bound to your app with the scopes it needs (`read`, `write`, `admin`).",
      "The plaintext `vx_live_...` is shown exactly once — the control plane stores only a sha256 hash.",
      "",
      "## 2. Verify the key (optional sanity check)",
      "~~~bash",
      "curl -s https://core.vortex.internal/api/v1/keys/verify \\",
      "  -H \"Authorization: Bearer vx_live_YOUR_KEY\"",
      "~~~",
      "You get back the key identity, its app binding and its scopes.",
      "",
      "## 3. Make your first edge call",
      "Ask the owner to create a gateway route for your app (or use an existing one), then:",
      "~~~bash",
      "curl -s https://core.vortex.internal/api/gw/<route>/... \\",
      "  -H \"Authorization: Bearer vx_live_YOUR_KEY\"",
      "~~~",
      "The edge chain runs: key auth → WAF → rate limit → target — and every request is logged.",
      "",
      "Rules that never change: data gravity (your data stays inside VORTEX), `app_id` on everything,",
      "and no public access — VORTEX is private, closed, proprietary.",
    ].join("\n"),
  },
  {
    docId: "doc_auth", slug: "auth", title: "VORTEX ID — Owner Authentication", category: "GUIDES", order: 20,
    body: [
      "One identity for the whole ecosystem. Owner/admin accounts only — there is no public signup, ever.",
      "",
      "## Two-step login",
      "1. **POST /api/v1/auth/login** with `{ email, password }` — scrypt-verified; an OTP is issued.",
      "2. **POST /api/v1/auth/login** with `{ email, password, otp }` — the 6-digit code (sha256-stored, 5-minute TTL, 5 attempts) exchanges into an httpOnly session cookie (7 days).",
      "",
      "## Programmatic access",
      "Sessions are for humans on the dashboard. Machines use `vx_live_*` API keys — see the API keys guide.",
      "",
      "## Protections",
      "- Rate limits on login and OTP endpoints",
      "- Every auth event lands in the append-only audit log",
      "- OTP delivery is simulated in this sandbox (SMTP/Postal plugs in later without model changes)",
    ].join("\n"),
  },
  {
    docId: "doc_apikeys", slug: "api-keys", title: "API Keys & Scopes", category: "GUIDES", order: 30,
    body: [
      "SDK-style machine identity: `vx_live_<id>_<secret>`.",
      "",
      "## Properties",
      "- Hash-only storage (sha256) — plaintext revealed once at creation",
      "- Scoped: `read` ⊂ `write` ⊂ `admin`",
      "- App-bound — every key belongs to one app (`app_id` travels with every call)",
      "- Revocable in one click; revocation is enforced at the gateway edge",
      "",
      "## Verify a key programmatically",
      "~~~bash",
      "curl -s -X POST https://core.vortex.internal/api/v1/keys/verify \\",
      "  -H \"Authorization: Bearer vx_live_...\"",
      "~~~",
      "",
      "## Rate limits",
      "Per-key limits are set on each gateway route (default 120 req/min) and the DDoS shield",
      "auto-blocks abusive sources at the SECURITY layer.",
    ].join("\n"),
  },
  {
    docId: "doc_gateway", slug: "gateway", title: "API Gateway — the one door", category: "GUIDES", order: 40,
    body: [
      "Every app call enters through **/api/gw/<route>/...** — one door, fully logged.",
      "",
      "## Route anatomy",
      "- `publicPath` — first path segment of the edge URL",
      "- `target` — app, internal service, or mock echo",
      "- `auth` — `API_KEY` (default) or `PUBLIC`",
      "- `requiredScope` — minimum key scope",
      "- `rateLimitPerMin` — per-key limit",
      "",
      "## Request chain",
      "1. SECURITY edge: IP blocklist, WAF rules, DDoS auto-block",
      "2. Key auth + scope check",
      "3. Rate limit",
      "4. Proxy to target (or echo for mocks)",
      "",
      "Every request lands in the access log with method, status, latency, key prefix and block reason —",
      "and the same log is what BILLING meters for `API_CALLS`.",
    ].join("\n"),
  },
  {
    docId: "doc_data", slug: "data", title: "Data: Databases, Storage, Files & Gravity", category: "GUIDES", order: 50,
    body: [
      "Data gravity is the core value: your app's data lives inside VORTEX, or it does not exist here.",
      "",
      "## Databases",
      "Provision PostgreSQL / MySQL / Redis / MongoDB per app — one-time credentials (hash-only storage),",
      "auto IP + DNS `<name>.db.vortex.internal`, encrypted 3-tier backups (disk → cluster → offsite).",
      "",
      "## Object storage (SeaweedFS design, Apache-2.0 lineage)",
      "Volumes hold buckets; every object keeps 3 copies; per-app quotas; real bytes on disk under",
      "`.vortex-storage/`. Deliberately no MinIO (AGPL) anywhere in the stack.",
      "",
      "## Files layer",
      "Upload/download with sha256 integrity on every read and version bump on overwrite.",
      "",
      "## CDN",
      "Cloudflare-free-tier design puts a bucket on an edge domain with TTL rules, purge and hit accounting.",
    ].join("\n"),
  },
  {
    docId: "doc_compute_ai", slug: "compute-ai", title: "Compute & AI Infrastructure", category: "GUIDES", order: 60,
    body: [
      "DEPLOY ships a build once; COMPUTE owns what keeps running.",
      "",
      "## Workloads",
      "Containers, functions and cron jobs scheduled onto APP_RUNTIME nodes with CPU/RAM guarantees",
      "(KVM/libvirt design, ram-fit scheduler). Lifecycle: PROVISIONING → RUNNING ⇄ STOPPED → DESTROYED.",
      "",
      "## AI infra (for NEXA and friends)",
      "Proprietary model registry — vortex-nano (1.5B), vortex-mini (7B), vortex-pro (32B) — served",
      "internally with q4 quantization. Every inference job records tokens in/out per app.",
      "",
      "Both surfaces are token- and hour-metered — the numbers that appear on your app's showback invoice.",
    ].join("\n"),
  },
  {
    docId: "doc_billing", slug: "billing", title: "Billing — Showback, Rate Card, Invoices", category: "GUIDES", order: 70,
    body: [
      "BILLING answers one question with real numbers: **what does each app cost to run inside VORTEX?**",
      "",
      "## Mode: SHOWBACK (locked)",
      "VORTEX is private — no external customer is ever billed. Invoices are internal cost statements.",
      "External plans (`EXTERNAL_*`) refuse to activate while `future.firebase_mode = LOCKED`.",
      "",
      "## Metered metrics (live from platform tables)",
      "~~~text",
      "API_CALLS         gateway requests / period          2 BDT per 1,000 over allowance",
      "STORAGE_MB        bucket usage                       3 BDT per GB-month over",
      "COMPUTE_HOURS     running workloads × hours          8 BDT per core-hour over",
      "AI_TOKENS         inference tokens (in+out)          5 BDT per 10k over",
      "DB_SIZE_MB        provisioned database size          4 BDT per GB-month over",
      "CDN_BANDWIDTH_MB  edge egress                        2 BDT per GB over",
      "~~~",
      "",
      "## Lifecycle",
      "`DRAFT` (generate from the live meter) → `ISSUED` (fan-out to NOTIFY) → `PAID` / `VOID`.",
      "Budgets are showback warnings — breaching one raises a BUDGET_BREACH notification, never a hard stop.",
      "VAT 15% (Bangladesh) is displayed on totals.",
    ].join("\n"),
  },
  {
    docId: "doc_firebase", slug: "firebase-mode-policy", title: "Firebase Mode — the locked gate", category: "POLICY", order: 90,
    body: [
      "**Status: LOCKED — owner decision, enforced server-side.**",
      "",
      "Phase 7 shipped everything a Firebase-style platform needs *internally*:",
      "",
      "- API-first control plane with one envelope (`{ok, data, error}`)",
      "- `app_id` on every record (multi-tenant safe)",
      "- SDK-style keys with scopes and revocation",
      "- Real usage metering + rate card + invoices",
      "- Docs engine with per-doc visibility",
      "",
      "## What flipping the gate would mean",
      "External developer onboarding (dev portal), public docs, charged plans — Firebase Mode.",
      "",
      "## Why it stays locked",
      "VORTEX is private, closed, proprietary: it serves the owner's apps only. Opening it would change",
      "compliance, support and security obligations (including NEXSEVA's Bangladesh data-localization",
      "requirements). The gate exists so that *if* the owner ever changes their mind, no rewrite is needed —",
      "flip `future.firebase_mode` and the reserve becomes an offering. Until then, publish attempts are",
      "rejected with HTTP 423 and logged.",
    ].join("\n"),
  },
  {
    docId: "doc_vaasquick", slug: "vaas-quickstart", title: "VaaS Quickstart — a backend in five minutes", category: "GET_STARTED", order: 5, public: true,
    body: [
      "VORTEX AS A SERVICE (VaaS) is the public face of the platform: a Firebase-style backend",
      "backed by the real control plane — auth, document data, storage, realtime and functions.",
      "Every developer gets projects; every project gets CLIENT + ADMIN keys.",
      "",
      "## 1. Add the SDK (zero dependencies)",
      "~~~html",
      "<script src=\"/vortex-sdk.js\"></script>",
      "~~~",
      "",
      "## 2. Initialize with the project config",
      "~~~js",
      "const vx = Vortex.initializeApp({",
      "  projectId: \"vxproj_…\",     // from the VaaS console",
      "  clientKey: \"vxk_…\",        // publishable CLIENT key (rules are server-side)",
      "  apiUrl: \"/api/vaas/v1\"",
      "});",
      "~~~",
      "",
      "## 3. End-user auth (Firebase Auth counterpart)",
      "~~~js",
      "await vx.auth().signUp(\"user@example.com\", \"secret123\", \"Rahim\");",
      "await vx.auth().signIn(\"user@example.com\", \"secret123\");",
      "await vx.auth().sendSignInCode(\"user@example.com\"); // 6-digit OTP through VORTEX MAIL",
      "~~~",
      "",
      "## 4. Data (Firestore counterpart, rules enforced server-side)",
      "~~~js",
      "await vx.data().collection(\"posts\").add({ title: \"Hello VORTEX\", likes: 0 });",
      "const posts = await vx.data().collection(\"posts\").orderBy(\"-likes\").limit(10).get();",
      "await vx.data().collection(\"posts\").doc(id).update({ likes: 1 });",
      "~~~",
      "",
      "Collection rules (`read`/`write` = public | auth | owner | admin) are checked on the SERVER",
      "on every call — the CLIENT key is safe to publish, exactly like a Firebase apiKey.",
      "",
      "## 5. Storage, realtime, functions",
      "~~~js",
      "await vx.storage().uploadText(\"notes/day1.txt\", \"hello\");  // real bytes, 3x replicas, sha256",
      "vx.realtime().channel(\"chat-1\").on(\"message\", (m) => console.log(m));",
      "await vx.realtime().channel(\"chat-1\").publish(\"message\", { text: \"hi\" });",
      "await vx.functions().invoke(\"onUserWelcome\");            // EVENT_AUTH trigger fires on signup",
      "~~~",
      "",
      "## AI app builder integration",
      "NEXA provisions a complete backend in ONE call:",
      "`POST /api/v1/vaas {op:\"nexa_provision\", appName:\"My App\", collections:[\"posts\",\"profile\"]}`",
      "→ project + collections + keys + welcome function + SDK snippet, ready to paste.",
    ].join("\n"),
  },
  {
    docId: "doc_vaasarch", slug: "vaas-vs-firebase", title: "VaaS vs Firebase — why the father wins", category: "POLICY", order: 6, public: true,
    body: [
      "The honest comparison. VaaS maps every Firebase capability onto machinery that already runs",
      "in the VORTEX control plane — then adds what Firebase does not give you.",
      "",
      "~~~text",
      "Firebase capability      VORTEX VaaS counterpart                      Backed by",
      "Auth                     VxUser (password + OTP)                      scrypt + VORTEX MAIL/SMTP",
      "Firestore                VxCollection/VxDocument + rules               server-side rules engine",
      "Cloud Storage            project buckets + VxFile                      real 3x-replica storage, sha256",
      "Realtime DB              VxRealtimeEvent + socket.io rooms             persisted + pollable history",
      "Cloud Functions          VxFunction (HTTP/DOC/AUTH/CRON)               sandboxed, timeout-enforced",
      "Projects                 VxProject + CLIENT/ADMIN keys                 SDK-style key discipline",
      "Console                  Developer accounts                            public signup (toggleable)",
      "~~~",
      "",
      "## What Firebase does NOT give you (VaaS does)",
      "- ONE platform for auth + data + storage AND raw infrastructure: servers, databases, CDNs,",
      "  CI/CD, security edge, backups — the control plane is underneath, not a separate product.",
      "- Your AI app builder (NEXA) provisions the whole backend in one call, and the same metering",
      "  answers what every app costs to run (BDT showback + external plans).",
      "- Data residency you control: dhaka-1, Bangladesh — compliance is yours, not a vendor's.",
      "- No surprise quotas: free + pro plans with transparent BDT rate cards and VAT handled.",
    ].join("\n"),
  },
];

let seedPromise: Promise<void> | null = null;

export function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = doSeed().catch((e) => {
      seedPromise = null;
      throw e;
    });
  }
  return seedPromise;
}

async function doSeed() {
  // guard flag — re-runs when SEED_VERSION bumps
  const flag = await db.appConfig.findUnique({ where: { key: "core.seeded" } });
  if (flag?.value === SEED_VERSION) return;

  // ---- VORTEX SERVER: platform tenancy roots (Phase VS) ----
  await ensurePlatforms();
  await ensureBucketRegistry();
  await ensureCloudAgentPlans();
  // per-platform credentials — the RAW keys are printed once into the audit
  // trail on first seed; the owner re-issues keys from the admin console
  const keyCount = await db.platformKey.count();
  if (keyCount === 0) {
    for (const p of ["cloud-agent", "vortex-website", "appverse", "vi"]) {
      const issued = await issuePlatformKey(p, `${p} service key`, "system:seed");
      if ("raw" in issued) {
        await writeAudit({
          actor: "system:seed",
          action: "VS_SEED_KEY",
          resource: issued.keyId,
          detail: `platform=${p} raw=${issued.raw} scopes=${issued.scopes.join("|")}`,
        });
      }
    }
  }

  // Owner account
  const owner = await db.adminUser.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: {
      email: OWNER_EMAIL,
      passwordHash: hashPassword(OWNER_PASSWORD),
      name: "VORTEX Owner",
      role: "OWNER",
      emailVerified: true,
    },
  });

  // Service registry
  for (const s of SERVICES) {
    await db.service.upsert({
      where: { serviceKey: s.serviceKey },
      update: s.refresh
        ? {
            name: s.name,
            description: s.description,
            phase: s.phase,
            status: s.status,
            endpoint: s.endpoint ?? null,
            version: s.version ?? null,
            ...(s.status === "ONLINE" ? { lastHeartbeat: new Date() } : {}),
          }
        : {},
      create: {
        serviceKey: s.serviceKey,
        name: s.name,
        description: s.description,
        phase: s.phase,
        status: s.status,
        endpoint: s.endpoint ?? null,
        version: s.version ?? null,
        lastHeartbeat: s.status === "ONLINE" ? new Date() : null,
      },
    });
  }

  // Registry hygiene: the registry must match the locked module list exactly —
  // drop rows left over from earlier seed versions (e.g. a cancelled SEARCH).
  const knownKeys = SERVICES.map((s) => s.serviceKey);
  const staleServices = await db.service.findMany({
    where: { serviceKey: { notIn: knownKeys } },
    select: { id: true, serviceKey: true },
  });
  if (staleServices.length > 0) {
    await db.service.deleteMany({ where: { id: { in: staleServices.map((s) => s.id) } } });
  }

  // Apps
  for (const a of APPS) {
    await db.app.upsert({
      where: { appId: a.appId },
      update: {},
      create: a,
    });
  }

  // Config
  for (const c of CONFIGS) {
    await db.appConfig.upsert({
      where: { key: c.key },
      update: c.refresh ? { value: c.value } : {},
      create: { key: c.key, value: c.value, category: c.category, description: c.description, updatedBy: "system" },
    });
  }

  // ---- Phase 2: network fabric ----
  for (const z of ZONES) {
    await db.netZone.upsert({ where: { name: z.name }, update: {}, create: z });
  }
  for (const ip of IP_POOL) {
    await db.ipAddress.upsert({
      where: { address: ip.address },
      update: {},
      create: {
        address: ip.address,
        ipType: ip.ipType,
        status: ip.status,
        assignedTo: ip.assignedTo ?? null,
        note: ip.note ?? "",
        zoneId: ip.zone ? (await db.netZone.findUnique({ where: { name: ip.zone } }))?.id ?? null : null,
      },
    });
  }
  for (const r of DNS_RECORDS) {
    await db.dnsRecord.upsert({
      where: { zone_name_type: { zone: r.zone, name: r.name, type: r.type } },
      update: {},
      create: { zone: r.zone, name: r.name, type: r.type, value: r.value, ttl: r.ttl },
    });
  }
  const existingRules = await db.firewallRule.count();
  if (existingRules === 0) {
    for (const rule of FIREWALL_RULES) {
      await db.firewallRule.create({ data: { ...rule, enabled: true } });
    }
  }

  // ---- Phase 2: control-plane node itself ----
  await db.serverNode.upsert({
    where: { name: "vortex-core-01" },
    update: {},
    create: {
      nodeId: "srv_core00001",
      name: "vortex-core-01",
      role: "CONTROL_PLANE",
      hostType: "KVM",
      status: "RUNNING",
      cpuCores: 4,
      ramMb: 8192,
      diskGb: 80,
      ipAddress: "10.10.0.1",
      region: "dhaka-1",
      uptimeSince: new Date(),
      provisionedBy: "system",
    },
  });

  // ---- Phase 3: DATABASE node (claims the IP reserved in seed v2) ----
  await db.serverNode.upsert({
    where: { name: DB_NODE.name },
    update: {},
    create: { ...DB_NODE, uptimeSince: new Date() },
  });
  await db.ipAddress.updateMany({
    where: { address: DB_NODE.ipAddress },
    data: { status: "ASSIGNED", assignedTo: DB_NODE.name, note: "vortex-db-01 (DATABASE node, Phase 3)" },
  });

  // ---- Phase 3: per-app database instances + their DNS names ----
  for (const i of DB_INSTANCES) {
    const app = await db.app.findUnique({ where: { appId: i.appKey } });
    await db.databaseInstance.upsert({
      where: { name: i.name },
      update: {},
      create: {
        dbId: i.dbId,
        name: i.name,
        engine: i.engine,
        version: i.version,
        status: "RUNNING",
        sizeMb: i.sizeMb,
        host: DB_NODE.name,
        port: i.port,
        ipAddress: DB_NODE.ipAddress,
        dnsName: `${i.name}.db.vortex.internal`,
        username: `vx_${i.appKey.replace("app_", "")}`,
        appId: app?.id ?? null,
        provisionedBy: "system",
      },
    });
  }
  for (const r of DB_DNS) {
    await db.dnsRecord.upsert({
      where: { zone_name_type: { zone: r.zone, name: r.name, type: r.type } },
      update: {},
      create: r,
    });
  }

  // ---- Phase 3: backup policies + snapshot history ----
  const now = Date.now();
  for (const p of POLICIES) {
    const label = p.targetDb ? DB_INSTANCES.find((i) => i.dbId === p.targetDb)?.name || p.targetDb : DB_NODE.name;
    await db.backupPolicy.upsert({
      where: { policyId: p.policyId },
      update: {},
      create: {
        policyId: p.policyId,
        name: p.name,
        targetType: p.targetType,
        targetId: p.targetDb || p.targetNode || "",
        targetLabel: label,
        schedule: p.schedule,
        retentionCount: p.retentionCount,
        enabled: true,
        lastRunAt: new Date(now - p.lastRunMs),
        nextRunAt: new Date(now + p.nextRunMs),
        runCount: p.runCount,
      },
    });
  }
  for (const s of SNAPSHOTS) {
    await db.backupSnapshot.upsert({
      where: { backupId: s.backupId },
      update: {},
      create: {
        backupId: s.backupId,
        policyId: s.policyId ?? null,
        trigger: s.trigger,
        targetType: s.targetType,
        targetId: s.targetDb || s.targetNode || "",
        targetLabel: s.targetLabel,
        sizeMb: s.sizeMb,
        checksum: sha256(s.backupId).slice(0, 32),
        cipher: "age-x25519",
        tierDisk: true,
        tierCluster: true,
        tierOffsite: s.offsite !== false,
        status: s.status || "COMPLETED",
        createdAt: new Date(now - s.ageMs),
      },
    });
  }

  // ---- Phase 3: monitor targets (first checks run on first dashboard load) ----
  for (const m of MONITORS) {
    await db.monitorTarget.upsert({
      where: { monitorId: m.monitorId },
      update: {},
      create: {
        monitorId: m.monitorId,
        name: m.name,
        targetType: m.targetType,
        target: m.target,
        intervalSec: m.intervalSec,
        enabled: true,
        status: "PENDING",
      },
    });
  }

  // ---- Phase 4: storage node (claims the IP reserved in seed v2) ----
  await db.serverNode.upsert({
    where: { name: STORAGE_NODE.name },
    update: {},
    create: { ...STORAGE_NODE, uptimeSince: new Date() },
  });
  await db.ipAddress.updateMany({
    where: { address: STORAGE_NODE.ipAddress },
    data: { status: "ASSIGNED", assignedTo: STORAGE_NODE.name, note: "vortex-storage-01 (STORAGE node, Phase 4)" },
  });

  // ---- Phase 4: SeaweedFS-style volumes + buckets + real seed objects ----
  for (const v of VOLUMES) {
    await db.storageVolume.upsert({
      where: { volumeId: v.volumeId },
      update: {},
      create: { ...v, nodeId: STORAGE_NODE.nodeId, replicationFactor: 3, status: "READ_WRITE" },
    });
  }
  const volumeRows = await db.storageVolume.findMany({ orderBy: { name: "asc" } });
  const appRows = await db.app.findMany();

  for (const b of BUCKETS) {
    const app = appRows.find((a) => a.appId === b.appKey);
    const volume = volumeRows[BUCKETS.indexOf(b) % volumeRows.length];
    await db.storageBucket.upsert({
      where: { bucketId: b.bucketId },
      update: {},
      create: {
        bucketId: b.bucketId,
        name: b.name,
        appId: app?.id ?? null,
        volumeId: volume?.id ?? null,
        storageClass: b.storageClass,
        replicationFactor: 3,
        quotaMb: b.quotaMb,
        status: "ACTIVE",
        createdBy: "system",
      },
    });
    ensureBucketDir(volume.name, b.name);
  }

  const bucketRowsByName = new Map((await db.storageBucket.findMany()).map((b) => [b.name, b]));
  for (const f of SEED_FILES) {
    const bucket = bucketRowsByName.get(f.bucket);
    if (!bucket) continue;
    const volume = volumeRows.find((v) => v.id === bucket.volumeId) || volumeRows[0];
    const buf = Buffer.from(f.content, "utf-8");
    const stored = writeObject(volume.name, bucket.name, f.path, buf);
    const existing = await db.fileObject.findUnique({ where: { fileId: f.fileId } });
    await db.fileObject.upsert({
      where: { fileId: f.fileId },
      update: { sizeBytes: stored.sizeBytes, checksum: stored.checksum },
      create: {
        fileId: f.fileId,
        bucketId: bucket.id,
        appId: bucket.appId,
        path: f.path,
        name: f.path.split("/").pop() || f.path,
        mime: mimeFromPath(f.path),
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        version: 1,
        status: "ACTIVE",
        uploadedBy: "system",
      },
    });
    if (!existing) {
      await db.storageBucket.update({
        where: { id: bucket.id },
        data: { objectCount: { increment: 1 }, usedMb: { increment: Math.max(1, Math.ceil(stored.sizeBytes / 1_000_000)) } },
      });
    }
  }

  // ---- Phase 4: gateway routes ----
  for (const r of ROUTES) {
    const app = r.appKey ? appRows.find((a) => a.appId === r.appKey) : null;
    await db.gatewayRoute.upsert({
      where: { routeId: r.routeId },
      update: {},
      create: {
        routeId: r.routeId,
        name: r.name,
        publicPath: r.publicPath,
        targetType: r.targetType,
        target: r.target,
        auth: r.auth,
        requiredScope: r.requiredScope,
        rateLimitPerMin: r.rateLimitPerMin,
        appId: app?.id ?? null,
        status: "ACTIVE",
        createdBy: "system",
      },
    });
  }

  // ---- Phase 4: 24h of gateway traffic history (once) ----
  const gwCount = await db.gatewayRequest.count();
  if (gwCount === 0) {
    const routeRows = await db.gatewayRoute.findMany();
    const methods = ["GET", "GET", "GET", "GET", "POST", "PUT"];
    const traffic: {
      routeId: string;
      routeKey: string;
      method: string;
      status: number;
      latencyMs: number;
      keyPrefix: string | null;
      appId: string | null;
      sourceIp: string;
      via: string;
      blocked: string | null;
      createdAt: Date;
    }[] = [];
    for (let i = 0; i < 150; i++) {
      const r = routeRows[Math.floor(Math.random() * routeRows.length)];
      const roll = Math.random();
      let status = 200;
      let blocked: string | null = null;
      if (roll > 0.98) {
        status = 404;
        blocked = "no route matched";
      } else if (roll > 0.95 && r.auth === "API_KEY") {
        status = 401;
        blocked = "no/invalid key";
      } else if (roll > 0.92 && r.auth === "API_KEY") {
        status = 403;
        blocked = "key/app mismatch";
      } else if (roll > 0.89) {
        status = 429;
        blocked = "rate limited";
      }
      traffic.push({
        routeId: r.id,
        routeKey: r.publicPath,
        method: methods[Math.floor(Math.random() * methods.length)],
        status,
        latencyMs: 4 + Math.floor(Math.random() * 180),
        keyPrefix: r.auth === "API_KEY" && status !== 401 ? `vx_live_${sha256(r.publicPath).slice(0, 4)}` : null,
        appId: r.appId,
        sourceIp: `10.10.${Math.floor(Math.random() * 3)}.${2 + Math.floor(Math.random() * 30)}`,
        via: Math.random() > 0.8 ? "SIMULATOR" : "EDGE",
        blocked,
        createdAt: new Date(now - Math.floor(Math.random() * DAY)),
      });
    }
    await db.gatewayRequest.createMany({ data: traffic });
    for (const r of routeRows) {
      const hits = traffic.filter((t) => t.routeId === r.id && t.status === 200);
      await db.gatewayRoute.update({
        where: { id: r.id },
        data: {
          hitCount: { increment: hits.length },
          ...(hits.length > 0
            ? { lastHitAt: new Date(Math.max(...hits.map((h) => h.createdAt.getTime()))) }
            : {}),
        },
      });
    }
  }

  // ---- Phase 5: APP_RUNTIME node (claims the first FREE ip from seed v2) ----
  await db.serverNode.upsert({
    where: { name: APP_NODE.name },
    update: {},
    create: { ...APP_NODE, uptimeSince: new Date() },
  });
  await db.ipAddress.updateMany({
    where: { address: APP_NODE.ipAddress },
    data: { status: "ASSIGNED", assignedTo: APP_NODE.name, note: "vortex-app-01 (APP_RUNTIME node, Phase 5)" },
  });

  // ---- Phase 5: SECURITY — policy singleton, WAF baseline, blocklist, events ----
  await db.securityPolicy.upsert({ where: { singleton: "global" }, update: {}, create: SECURITY_POLICY_SEED });
  for (const r of WAF_RULES) {
    await db.wafRule.upsert({
      where: { ruleId: r.ruleId },
      update: {},
      create: {
        ruleId: r.ruleId,
        name: r.name,
        pattern: r.pattern,
        matchIn: r.matchIn,
        headerName: r.headerName ?? null,
        action: r.action,
        severity: r.severity,
        isSystem: true,
        enabled: true,
      },
    });
  }
  for (const b of IP_BLOCKS_SEED) {
    await db.ipBlock.upsert({
      where: { ip: b.ip },
      update: {},
      create: {
        ip: b.ip,
        reason: b.reason,
        source: b.source,
        createdBy: b.createdBy,
        expiresAt: b.hours === null ? null : new Date(now + b.hours * H),
      },
    });
  }
  const secEventCount = await db.securityEvent.count();
  if (secEventCount === 0) {
    await db.securityEvent.createMany({
      data: SECURITY_EVENTS.map((e) => ({
        type: e.type,
        severity: e.severity,
        sourceIp: e.sourceIp ?? null,
        routeKey: e.routeKey ?? null,
        action: e.action,
        detail: e.detail,
        createdAt: new Date(now - e.ageMs),
      })),
    });
  }

  // ---- Phase 5: DEVOPS SSL certificates ----
  for (const c of SSL_CERTS) {
    await db.sslCert.upsert({
      where: { certId: c.certId },
      update: {},
      create: {
        certId: c.certId,
        domain: c.domain,
        issuer: c.issuer,
        status: "ACTIVE",
        autoRenew: true,
        issuedAt: new Date(now - (90 - c.expiresInDays) * DAY),
        expiresAt: new Date(now + c.expiresInDays * DAY),
        targetLabel: c.targetLabel,
      },
    });
  }

  // ---- Phase 5: deployments history (one RUNNING per app) ----
  const appNodes = await db.serverNode.findMany({ where: { role: "APP_RUNTIME", status: "RUNNING" } });
  const runtimeNode = appNodes[0];
  for (const d of DEPLOYMENTS) {
    const app = appRows.find((a) => a.appId === d.appKey);
    if (!app) continue;
    const logLines = [
      `[deploy] ${d.appKey} v${d.version} build #${d.buildNumber} (source: ${d.source})`,
      "[build] pulling source into isolated builder",
      "[build] bundle compiled — artifact sealed",
      "[ship] uploading artifact to STORAGE (nexa-artifacts, 3x replicas)",
      d.note ? `[note] ${d.note}` : "[ship] released on vortex-app-01",
      d.status === "RUNNING" ? "[live] health checks green" : `[end] ${d.status.toLowerCase()}`,
    ].filter(Boolean);
    await db.deployment.upsert({
      where: { deployId: d.deployId },
      update: {},
      create: {
        deployId: d.deployId,
        appId: app.id,
        version: d.version,
        buildNumber: d.buildNumber,
        source: d.source,
        status: d.status,
        health: d.health,
        nodeId: runtimeNode?.nodeId ?? null,
        url: `${app.slug}.apps.vortex.internal`,
        artifactKb: 800 + d.buildNumber * 37,
        artifactPath: `builds/${app.slug}/v${d.version}-b${d.buildNumber}.tar`,
        log: logLines.join("\n"),
        rollbackOf: d.rollbackOf ?? null,
        deployedBy: "system",
        startedAt: new Date(now - d.ageMs - 60_000),
        finishedAt: new Date(now - d.ageMs),
        createdAt: new Date(now - d.ageMs),
      },
    });
  }

  // ---- Phase 5: CI/CD pipelines + run history ----
  for (const p of PIPELINES) {
    const app = appRows.find((a) => a.appId === p.appKey);
    if (!app) continue;
    await db.pipeline.upsert({
      where: { pipelineId: p.pipelineId },
      update: {},
      create: {
        pipelineId: p.pipelineId,
        appId: app.id,
        name: p.name,
        repo: p.repo,
        branch: p.branch,
        trigger: p.trigger,
        stages: "build,test,deploy",
        enabled: true,
      },
    });
  }
  const pipelineRows = await db.pipeline.findMany();
  for (const r of PIPELINE_RUNS) {
    const pipeline = pipelineRows.find((p) => p.pipelineId === r.pipelineId);
    if (!pipeline) continue;
    const stageMs = 5_000;
    const stagesLog = JSON.stringify([
      { stage: "build", status: "OK", ms: stageMs, log: "cloning gitea.vortex.internal — shallow, branch locked\ncache restored (pnpm store)\nbundle built" },
      ...(r.status === "FAILED"
        ? [{ stage: "test", status: "FAILED", ms: stageMs, log: "unit tests: 147 passed, 1 failed\ncoverage gate not reached — run stopped" }]
        : [
            { stage: "test", status: "OK", ms: stageMs, log: "unit tests: 148 passed, 0 failed\ncoverage 92.4% (gate: 80%)" },
            { stage: "deploy", status: "OK", ms: stageMs, log: "handing artifact to DEPLOY module\ndeployment accepted — tracking" },
          ]),
    ]);
    const linkedDeploy = r.deployVersion
      ? await db.deployment.findFirst({ where: { appId: pipeline.appId, version: r.deployVersion }, select: { deployId: true } })
      : null;
    await db.pipelineRun.upsert({
      where: { runId: r.runId },
      update: {},
      create: {
        runId: r.runId,
        pipelineId: pipeline.id,
        commitSha: r.commitSha,
        commitMessage: r.commitMessage,
        trigger: r.trigger,
        status: r.status,
        stagesLog,
        durationMs: (r.status === "SUCCESS" ? 3 : 2) * stageMs,
        deployId: linkedDeploy?.deployId ?? null,
        startedAt: new Date(now - r.ageMs - 15_000),
        finishedAt: new Date(now - r.ageMs),
        createdAt: new Date(now - r.ageMs),
      },
    });
    // pipeline counters reflect seeded history (only when untouched by live runs)
    const existingPipeline = await db.pipeline.findUnique({ where: { pipelineId: r.pipelineId } });
    if (existingPipeline && existingPipeline.runCount === 0) {
      const runCounts = PIPELINE_RUNS.filter((x) => x.pipelineId === r.pipelineId);
      await db.pipeline.update({
        where: { id: existingPipeline.id },
        data: {
          runCount: runCounts.length,
          successCount: runCounts.filter((x) => x.status === "SUCCESS").length,
          failCount: runCounts.filter((x) => x.status === "FAILED").length,
          lastRunAt: new Date(now - Math.min(...runCounts.map((x) => x.ageMs))),
          lastStatus: [...runCounts].sort((a, b) => a.ageMs - b.ageMs)[0].status,
        },
      });
    }
  }

  // ---- Phase 6: MAIL templates ----
  for (const t of MAIL_TEMPLATES) {
    await db.mailTemplate.upsert({
      where: { key: t.key },
      update: {},
      create: { ...t, isSystem: true, enabled: true },
    });
  }

  // ---- Phase 6: NOTIFY channels + rules + in-app feed ----
  for (const c of NOTIFY_CHANNELS) {
    const app = c.appKey ? appRows.find((a) => a.appId === c.appKey) : null;
    await db.notificationChannel.upsert({
      where: { channelId: c.channelId },
      update: {},
      create: {
        channelId: c.channelId,
        name: c.name,
        type: c.type,
        target: c.target,
        appId: app?.id ?? null,
        enabled: true,
        isSystem: c.isSystem ?? false,
      },
    });
  }
  const channelRows = await db.notificationChannel.findMany();
  for (const r of NOTIFY_RULES) {
    const ch = channelRows.find((c) => c.channelId === r.channelKey);
    if (!ch) continue;
    await db.notificationRule.upsert({
      where: { ruleId: r.ruleId },
      update: {},
      create: {
        ruleId: r.ruleId,
        name: r.name,
        eventType: r.eventType,
        minSeverity: r.minSeverity,
        channelId: ch.id,
        enabled: true,
      },
    });
  }
  const notifCount = await db.notification.count();
  if (notifCount === 0) {
    await db.notification.createMany({
      data: NOTIFICATIONS.map((n) => ({
        title: n.title,
        body: n.body,
        source: n.source,
        severity: n.severity,
        channelType: n.channelType,
        readAt: n.read ? new Date(now - n.ageMs + 60_000) : null,
        createdAt: new Date(now - n.ageMs),
      })),
    });
  }

  // ---- Phase 6: CDN distributions (one bucket → one edge domain) ----
  for (const d of CDN_DISTS) {
    const bucket = await db.storageBucket.findUnique({ where: { name: d.bucket } });
    if (!bucket) continue;
    await db.cdnDistribution.upsert({
      where: { distId: d.distId },
      update: {},
      create: {
        distId: d.distId,
        name: d.name,
        domain: d.domain,
        bucketId: bucket.id,
        appId: bucket.appId,
        defaultTtlSec: d.ttlSec,
        maxTtlSec: Math.max(d.ttlSec * 4, 3600),
        status: d.status || "ACTIVE",
        cacheHits: d.hits,
        cacheMisses: d.misses,
        bandwidthMb: d.bandwidthMb,
        createdBy: "system",
        createdAt: new Date(now - d.ageMs),
      },
    });
  }

  // ---- Phase 6: COMPUTE workloads (scheduled onto the runtime node) ----
  const computeNode = await db.serverNode.findUnique({ where: { name: "vortex-app-01" } });
  for (const w of WORKLOADS) {
    const app = appRows.find((a) => a.appId === w.appKey);
    if (!app) continue;
    await db.workload.upsert({
      where: { workloadId: w.workloadId },
      update: {},
      create: {
        workloadId: w.workloadId,
        name: w.name,
        image: w.image,
        kind: w.kind,
        appId: app.id,
        nodeId: computeNode?.nodeId ?? null,
        cpuMilli: w.cpuMilli,
        ramMb: w.ramMb,
        status: w.status,
        restartCount: w.restarts || 0,
        startedAt: w.status === "RUNNING" ? new Date(now - w.ageMs) : null,
        createdAt: new Date(now - w.ageMs),
      },
    });
  }

  // ---- Phase 6: AI models + inference job history (serving for NEXA) ----
  const nexaApp = appRows.find((a) => a.appId === "app_nexa");
  for (const m of AI_MODELS) {
    await db.aiModel.upsert({
      where: { modelId: m.modelId },
      update: {},
      create: {
        modelId: m.modelId,
        name: m.name,
        family: "VORTEX",
        paramsB: m.paramsB,
        contextK: m.contextK,
        quant: "q4_KM",
        status: m.status,
        endpoint: m.status === "READY" ? `http://ai.vortex.internal/v1/${m.name}` : null,
        appId: nexaApp?.id ?? null,
        requests: m.requests,
        tokensIn: m.tokensIn,
        tokensOut: m.tokensOut,
        avgLatencyMs: m.avgLatency,
      },
    });
  }
  const modelRows = await db.aiModel.findMany();
  for (const j of AI_JOBS) {
    const model = modelRows.find((m) => m.modelId === j.modelKey);
    if (!model) continue;
    await db.aiJob.upsert({
      where: { jobId: j.jobId },
      update: {},
      create: {
        jobId: j.jobId,
        modelId: model.id,
        appId: nexaApp?.id ?? null,
        prompt: j.prompt,
        status: "DONE",
        tokensIn: j.tokensIn,
        tokensOut: j.tokensOut,
        latencyMs: j.latencyMs,
        output: `[${model.name} · ${model.paramsB} · VORTEX internal serving]\nUnderstood: "${j.prompt.slice(0, 48)}…".\nDraft response generated inside the private VORTEX AI runtime — no data left the ecosystem.`,
        finishedAt: new Date(now - j.ageMs + j.latencyMs),
        createdAt: new Date(now - j.ageMs),
      },
    });
  }

  // ---- Phase 7: BILLING plans + subscriptions + previous-month showback ----
  const prevPeriod = periodKey(new Date(now - 30 * 86400_000));
  for (const p of BILLING_PLANS) {
    await db.billingPlan.upsert({
      where: { planId: p.planId },
      update: {},
      create: {
        planId: p.planId,
        code: p.code,
        name: p.name,
        audience: p.audience,
        monthlyBaseBdt: p.monthlyBaseBdt,
        inclApiCalls: p.inclApiCalls ?? 2000000,
        inclStorageMb: p.inclStorageMb ?? 51200,
        inclComputeHours: p.inclComputeHours ?? 744,
        inclAiTokens: p.inclAiTokens ?? 5000000,
        inclDbMb: p.inclDbMb ?? 102400,
        inclCdnMb: p.inclCdnMb ?? 102400,
        isActive: p.isActive ?? true,
        isDefault: p.isDefault ?? false,
        isSystem: true,
        note: p.note,
      },
    });
  }
  for (const s of BILLING_SUBS) {
    const app = appRows.find((a) => a.appId === s.appKey);
    const plan = await db.billingPlan.findUnique({ where: { planId: s.planId } });
    if (!app || !plan) continue;
    await db.billingSubscription.upsert({
      where: { subId: s.subId },
      update: { planId: plan.id, budgetMonthlyBdt: s.budgetMonthlyBdt, status: "ACTIVE" },
      create: {
        subId: s.subId,
        appId: app.id,
        planId: plan.id,
        status: "ACTIVE",
        budgetMonthlyBdt: s.budgetMonthlyBdt,
        periodStart: new Date(now - 35 * 86400_000),
        createdAt: new Date(now - 35 * 86400_000),
      },
    });
  }
  const showbackPlan = await db.billingPlan.findUnique({ where: { planId: "plan_showback01" } });
  let invSeq = 0;
  for (const u of PREV_USAGE) {
    const app = appRows.find((a) => a.appId === u.appKey);
    if (!app || !showbackPlan) continue;
    // price the history against the plan the app is actually subscribed to
    const subSeed = BILLING_SUBS.find((s) => s.appKey === u.appKey);
    const subPlan = await db.billingPlan.findUnique({ where: { planId: subSeed?.planId || "plan_showback01" } });
    if (!subPlan) continue;
    const usage: Record<string, number> = {
      API_CALLS: u.API_CALLS,
      STORAGE_MB: u.STORAGE_MB,
      COMPUTE_HOURS: u.COMPUTE_HOURS,
      AI_TOKENS: u.AI_TOKENS,
      DB_SIZE_MB: u.DB_SIZE_MB,
      CDN_BANDWIDTH_MB: u.CDN_BANDWIDTH_MB,
    };
    for (const r of RATE_CARD) {
      const qty = usage[r.metric] || 0;
      if (qty <= 0) continue;
      await db.usageRecord.upsert({
        where: { appId_metric_period: { appId: app.id, metric: r.metric, period: prevPeriod } },
        update: {},
        create: { appId: app.id, metric: r.metric, quantity: qty, period: prevPeriod, source: "METER" },
      });
    }
    const priced = priceUsage(subPlan, usage);
    invSeq += 1;
    const paid = invSeq <= 2; // the two biggest consumers settled, the rest issued and open
    const invoiceId = `inv_seed${String(invSeq).padStart(4, "0")}`;
    await db.invoice.upsert({
      where: { invoiceId },
      // seeded baseline rows refresh on a seed bump; owner-created invoices are never touched
      update: {
        subtotalBdt: priced.subtotalBdt,
        taxBdt: priced.taxBdt,
        totalBdt: priced.totalBdt,
        lines: JSON.stringify(priced.lines),
        status: paid ? "PAID" : "ISSUED",
      },
      create: {
        invoiceId,
        number: `VX-${prevPeriod}-${String(invSeq).padStart(4, "0")}`,
        appId: app.id,
        period: prevPeriod,
        mode: "SHOWBACK",
        status: paid ? "PAID" : "ISSUED",
        subtotalBdt: priced.subtotalBdt,
        taxBdt: priced.taxBdt,
        totalBdt: priced.totalBdt,
        lines: JSON.stringify(priced.lines),
        issuedAt: new Date(now - 12 * 86400_000),
        paidAt: paid ? new Date(now - 6 * 86400_000) : null,
        createdAt: new Date(now - 13 * 86400_000),
      },
    });
  }

  // ---- Phase 7: PORTAL docs (internal baseline, gate-locked) ----
  for (const d of PORTAL_DOCS) {
    await db.docPage.upsert({
      where: { docId: d.docId },
      update: {},
      create: {
        docId: d.docId,
        slug: d.slug,
        title: d.title,
        category: d.category,
        body: d.body,
        order: d.order,
        visibility: d.public ? "PUBLIC" : "INTERNAL",
        isSystem: true,
        updatedBy: "system",
      },
    });
  }

  // ---- Phase 8: VAAS — the public face goes live (owner decision recorded) ----
  // The stored seed version below 8.0 means the owner asked for the flip: LOCKED → OPEN.
  {
    const devs = [
      { devId: "dev_demo00001", email: "dev@vortex.local", password: "VortexDev@2026", name: "Demo Developer", plan: "VAAS_FREE" },
      { devId: "dev_nexa00001", email: "nexa@vortex.local", password: "NexaBuilder@2026", name: "NEXA AI Builder", plan: "VAAS_PRO" },
    ];
    for (const d of devs) {
      await db.developer.upsert({
        where: { email: d.email },
        update: {},
        create: { devId: d.devId, email: d.email, passwordHash: hashPassword(d.password), name: d.name, emailVerified: true, plan: d.plan },
      });
    }
    const nexaDev = await db.developer.findUnique({ where: { email: "nexa@vortex.local" } });
    const demoDev = await db.developer.findUnique({ where: { email: "dev@vortex.local" } });

    const projects: { projectId: string; name: string; slug: string; devId?: string; viaNexa?: boolean }[] = [
      { projectId: "vxproj_demo0001", name: "Demo Store", slug: "demo-store", devId: demoDev?.id },
      { projectId: "vxproj_nxa00001", name: "NEXA Showcase", slug: "nexa-showcase", devId: nexaDev?.id, viaNexa: true },
    ];
    for (const p of projects) {
      if (!p.devId) continue;
      await db.vxProject.upsert({
        where: { projectId: p.projectId },
        update: {},
        create: { projectId: p.projectId, name: p.name, slug: p.slug, developerId: p.devId, region: "dhaka-1", viaNexa: p.viaNexa ?? false },
      });
    }
    const demoProject = await db.vxProject.findUnique({ where: { projectId: "vxproj_demo0001" } });
    const nexaProject = await db.vxProject.findUnique({ where: { projectId: "vxproj_nxa00001" } });

    if (demoProject) {
      // collections with real rules
      const demoCols = [
        { name: "posts", read: "public", write: "auth" },
        { name: "comments", read: "public", write: "auth" },
        { name: "profile", read: "auth", write: "owner" },
      ];
      for (const c of demoCols) {
        await db.vxCollection.upsert({
          where: { projectId_name: { projectId: demoProject.id, name: c.name } },
          update: {},
          create: { projectId: demoProject.id, name: c.name, readRule: c.read, writeRule: c.write },
        });
      }
      const postsCol = await db.vxCollection.findUnique({ where: { projectId_name: { projectId: demoProject.id, name: "posts" } } });
      const commentsCol = await db.vxCollection.findUnique({ where: { projectId_name: { projectId: demoProject.id, name: "comments" } } });
      const demoDocs = [
        { col: postsCol, docId: "vxd_demo0001", data: { title: "Hello from VORTEX VaaS", body: "Firestore-style docs, server-side rules, real metering.", likes: 12, author: "demo" } },
        { col: postsCol, docId: "vxd_demo0002", data: { title: "dhaka-1 data residency", body: "Your bytes stay in Bangladesh — 3 copies, checksummed.", likes: 7, author: "demo" } },
        { col: commentsCol, docId: "vxd_demo0003", data: { post: "vxd_demo0001", text: "This is realtime-enabled — publish and watch.", author: "guest" } },
      ];
      for (const d of demoDocs) {
        if (!d.col) continue;
        await db.vxDocument.upsert({
          where: { docId: d.docId },
          update: {},
          create: { docId: d.docId, collectionId: d.col.id, projectId: demoProject.id, dataJson: JSON.stringify(d.data) },
        });
      }
      if (postsCol) await db.vxCollection.update({ where: { id: postsCol.id }, data: { docCount: 2, sizeBytes: 240 } });
      if (commentsCol) await db.vxCollection.update({ where: { id: commentsCol.id }, data: { docCount: 1, sizeBytes: 110 } });

      // demo end-user
      await db.vxUser.upsert({
        where: { projectId_email: { projectId: demoProject.id, email: "demo@store.local" } },
        update: {},
        create: {
          uid: "vxu_demo0001",
          projectId: demoProject.id,
          email: "demo@store.local",
          passwordHash: hashPassword("Demo@2026"),
          displayName: "Demo User",
          emailVerified: true,
        },
      });

      // demo functions: HTTP ping + EVENT_AUTH welcome
      await db.vxFunction.upsert({
        where: { projectId_name: { projectId: demoProject.id, name: "ping" } },
        update: {},
        create: {
          fnId: "vxfn_demo001",
          projectId: demoProject.id,
          name: "ping",
          trigger: "HTTP",
          code: [
            "// HTTP trigger — called via POST /api/vaas/v1/fn/ping/invoke",
            "await ctx.realtime.publish('system', 'ping', { at: ctx.now });",
            "return { pong: true, at: ctx.now, project: ctx.project.projectId };",
          ].join("\n"),
        },
      });
      await db.vxFunction.upsert({
        where: { projectId_name: { projectId: demoProject.id, name: "onUserWelcome" } },
        update: {},
        create: {
          fnId: "vxfn_demo002",
          projectId: demoProject.id,
          name: "onUserWelcome",
          trigger: "EVENT_AUTH",
          code: [
            "// EVENT_AUTH trigger — fires on signup + login",
            "if (ctx.payload.event === 'signup') {",
            "  await ctx.db.add('posts', {",
            "    kind: 'welcome',",
            "    forUid: ctx.payload.user.uid,",
            "    message: 'Welcome to ' + ctx.project.name + '!',",
            "    createdAt: ctx.now",
            "  });",
            "}",
            "return { ok: true, event: ctx.payload.event };",
          ].join("\n"),
        },
      });

      // demo CLIENT key (publishable) stored for the console playground
      let demoKey = await db.vxKey.findFirst({ where: { projectId: demoProject.id, kind: "CLIENT" } });
      const demoClientSecret = demoKey?.secretHash || `vxk_${generateToken(16)}`;
      if (!demoKey) {
        demoKey = await db.vxKey.create({
          data: { keyId: "vxk_demo000001", kind: "CLIENT", secretHash: demoClientSecret, prefix: demoClientSecret.slice(0, 12), projectId: demoProject.id },
        });
      }
      await db.appConfig.upsert({
        where: { key: "vaas.demo_client_key" },
        update: { value: demoClientSecret },
        create: { key: "vaas.demo_client_key", value: demoClientSecret, category: "vaas", description: "Playground CLIENT key for the seeded Demo Store project (publishable by design)" },
      });

      // seed one realtime event
      await db.vxRealtimeEvent.upsert({
        where: { eventId: "rte_seed0001" },
        update: {},
        create: {
          eventId: "rte_seed0001",
          projectId: demoProject.id,
          channel: "system",
          type: "system",
          payloadJson: JSON.stringify({ text: "VaaS realtime channel is live on dhaka-1" }),
          emittedBy: "system",
        },
      });

      // project bucket
      const volume = (await db.storageVolume.findMany({ where: { status: "READ_WRITE" }, orderBy: { name: "asc" } }))[0];
      if (volume) {
        await db.storageBucket.upsert({
          where: { bucketId: "bkt_vxdemo01" },
          update: {},
          create: {
            bucketId: "bkt_vxdemo01",
            name: "vx-demo-store",
            projectId: demoProject.id,
            volumeId: volume.id,
            storageClass: "HOT",
            replicationFactor: 3,
            quotaMb: 2048,
            status: "ACTIVE",
            createdBy: "vaas",
          },
        });
        ensureBucketDir(volume.name, "vx-demo-store");
      }
    }

    if (nexaProject) {
      for (const c of [{ name: "posts", read: "public", write: "auth" }, { name: "profile", read: "auth", write: "owner" }]) {
        await db.vxCollection.upsert({
          where: { projectId_name: { projectId: nexaProject.id, name: c.name } },
          update: {},
          create: { projectId: nexaProject.id, name: c.name, readRule: c.read, writeRule: c.write },
        });
      }
    }

    await db.auditLog.create({
      data: {
        actor: "system",
        action: "VAAS_ACTIVATED",
        resource: "config:future.firebase_mode",
        detail: "Phase 8: the owner flipped future.firebase_mode LOCKED → OPEN — VORTEX AS A SERVICE is live: public multi-tenant BaaS (projects, keys, end-user auth, doc DB with rules, storage on real buckets, socket.io realtime, sandboxed functions), wired into NEXA, metered into BDT plans",
        userId: owner.id,
      },
    });
  }

  await db.appConfig.upsert({
    where: { key: "core.seeded" },
    update: { value: SEED_VERSION },
    create: { key: "core.seeded", value: SEED_VERSION, category: "dev", description: "Bootstrap seed version", updatedBy: "system" },
  });

  await db.auditLog.create({
    data: {
      actor: "system",
      action: "CORE_BOOTSTRAP",
      resource: "control-plane",
      detail: `Seed v${SEED_VERSION}: registry (${SERVICES.length} services incl. VAAS+REALTIME+SDK), ${APPS.length} apps, ${DB_INSTANCES.length} databases on ${DB_NODE.name}, ${POLICIES.length} backup policies, ${SNAPSHOTS.length} snapshots, ${MONITORS.length} monitors, SECURITY baseline (${WAF_RULES.length} WAF rules), ${DEPLOYMENTS.length} deployments, ${PIPELINES.length} pipelines, ${SSL_CERTS.length} SSL certs, VAAS demo developer+projects live`,
      userId: owner.id,
    },
  });
}
