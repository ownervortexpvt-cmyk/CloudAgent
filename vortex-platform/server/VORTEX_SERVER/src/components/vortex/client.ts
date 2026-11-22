"use client";

/** Shared client types + fetch helper for the VORTEX control plane UI. */

export type ApiEnvelope<T> = { ok: boolean; data?: T; error?: string };

export async function api<T = unknown>(
  path: string,
  opts?: { method?: string; body?: unknown }
): Promise<ApiEnvelope<T>> {
  try {
    const res = await fetch(path, {
      method: opts?.method || "GET",
      headers: opts?.body ? { "Content-Type": "application/json" } : undefined,
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
    const json = (await res.json()) as ApiEnvelope<T>;
    return json;
  } catch {
    return { ok: false, error: "Network error — control plane unreachable" };
  }
}

export type Service = {
  id: string;
  serviceKey: string;
  name: string;
  description: string;
  phase: number;
  status: string;
  endpoint: string | null;
  version: string | null;
  lastHeartbeat: string | null;
};

export type AppBackendRow = {
  projectId: string;
  slug: string;
  backendStatus: string;
  region: string;
  viaNexa: boolean;
  clientKey: string;
  linkedAt: string | null;
};

export type AppRow = {
  id: string;
  appId: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  activeKeys: number;
  backend: AppBackendRow | null;
  createdAt: string;
};

export type KeyRow = {
  id: string;
  keyId: string;
  prefix: string;
  name: string;
  scopes: string[];
  status: string;
  app: { name: string; appId: string } | null;
  lastUsedAt: string | null;
  createdAt: string;
};

export type ConfigRow = {
  id: string;
  key: string;
  value: string;
  category: string;
  description: string;
  isSecret: boolean;
  updatedBy: string | null;
  updatedAt: string;
};

export type AuditRow = {
  id: string;
  actor: string;
  action: string;
  resource: string;
  detail: string | null;
  ip: string | null;
  createdAt: string;
};

export type MailRow = {
  id: string;
  toEmail: string;
  subject: string;
  body: string;
  category: string;
  status: string;
  createdAt: string;
};

export type Overview = {
  version: string;
  stats: {
    servicesTotal: number;
    servicesOnline: number;
    servicesBuilding: number;
    servicesPlanned: number;
    servicesReserved: number;
    appsTotal: number;
    keysActive: number;
    auditEvents: number;
    mailsSent: number;
    serversRunning: number;
    serversTotal: number;
    cpuAllocated: number;
    ramAllocatedMb: number;
    ipsFree: number;
    ipsTotal: number;
    firewallRulesActive: number;
    dbsRunning: number;
    dbsTotal: number;
    dbsSizeGb: number;
    backupsCount: number;
    backupsSizeGb: number;
    lastBackupAt: string | null;
    monitorsUp: number;
    monitorsTotal: number;
    alertsOpen: number;
    // Phase 4
    gwRoutesActive: number;
    gwRequests24h: number;
    gwBlocked24h: number;
    storageBuckets: number;
    storageObjects: number;
    storageUsedMb: number;
    storageQuotaMb: number;
    // Phase 5
    secEvents24h: number;
    ipBlocksActive: number;
    wafRulesEnabled: number;
    deploysRunning: number;
    deploysInflight: number;
    pipelinesActive: number;
    pipelineRunsTotal: number;
    sslActive: number;
    sslExpiringSoon: number;
    // Phase 6
    mailsLast24h: number;
    mailsFailed: number;
    notifyUnread: number;
    cdnDists: number;
    cdnHitRate: number;
    computeRunning: number;
    computeTotal: number;
    aiModelsReady: number;
    aiModelsTotal: number;
    aiJobs24h: number;
    // Phase 7
    billingShowbackMonthBdt: number;
    billingInvoices: number;
    billingOverBudget: number;
    billingSubsActive: number;
    firebaseMode: string;
    // Phase 8 — VAAS
    vaasDevelopers: number;
    vaasProjects: number;
    vaasEndUsers: number;
    vaasDocs: number;
    vaasFiles: number;
    vaasRt24h: number;
    vaasFnRuns24h: number;
    vaasApiCalls: number;
    vaasNexaProjects: number;
  };
  phases: { phase: number; total: number; done: number; pct: number }[];
  recentAudit: AuditRow[];
  recentMail: MailRow[];
  node: string;
};

export type ServerNodeRow = {
  id: string;
  nodeId: string;
  name: string;
  role: string;
  hostType: string;
  status: string;
  cpuCores: number;
  ramMb: number;
  diskGb: number;
  ipAddress: string | null;
  osImage: string;
  region: string;
  app: { name: string; appId: string } | null;
  uptimeSince: string | null;
  provisionedBy: string | null;
  createdAt: string;
};

export type IpRow = {
  id: string;
  address: string;
  ipType: string;
  status: string;
  assignedTo: string | null;
  note: string;
  zone: { name: string; cidr: string } | null;
};

export type DnsRow = {
  id: string;
  zone: string;
  name: string;
  type: string;
  value: string;
  ttl: number;
  status: string;
};

export type FirewallRow = {
  id: string;
  name: string;
  direction: string;
  action: string;
  protocol: string;
  port: string | null;
  source: string;
  priority: number;
  enabled: boolean;
  isSystem: boolean;
};

export type ZoneRow = {
  id: string;
  name: string;
  cidr: string;
  vlan: number | null;
  purpose: string;
  status: string;
  ipTotal: number;
  ipFree: number;
};

/* ---- Phase 3 ---- */

export type DatabaseRow = {
  id: string;
  dbId: string;
  name: string;
  engine: string;
  version: string;
  status: string;
  sizeMb: number;
  host: string;
  port: number;
  ipAddress: string | null;
  dnsName: string | null;
  username: string;
  secretPrefix: string | null;
  app: { name: string; appId: string } | null;
  provisionedBy: string | null;
  createdAt: string;
};

export type SnapshotRow = {
  id: string;
  backupId: string;
  policyId: string | null;
  trigger: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  sizeMb: number;
  checksum: string;
  cipher: string;
  tierDisk: boolean;
  tierCluster: boolean;
  tierOffsite: boolean;
  status: string;
  restoredAt: string | null;
  createdAt: string;
};

export type PolicyRow = {
  id: string;
  policyId: string;
  name: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  schedule: string;
  retentionCount: number;
  encrypted: boolean;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  createdAt: string;
};

export type MonitorRow = {
  id: string;
  monitorId: string;
  name: string;
  targetType: string;
  target: string;
  intervalSec: number;
  enabled: boolean;
  status: string;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastStatusCode: number | null;
  lastMessage: string | null;
  uptimePct: number | null;
  consecutiveFails: number;
};

export type CheckRow = {
  id: string;
  targetId: string;
  status: string;
  latencyMs: number | null;
  statusCode: number | null;
  message: string | null;
  checkedAt: string;
};

export type AlertRow = {
  id: string;
  targetId: string | null;
  source: string;
  type: string;
  severity: string;
  message: string;
  status: string;
  ackBy: string | null;
  ackAt: string | null;
  createdAt: string;
};

/* ---- Phase 4 ---- */

export type GatewayRouteRow = {
  id: string;
  routeId: string;
  name: string;
  publicPath: string;
  targetType: string;
  target: string;
  auth: string;
  requiredScope: string;
  rateLimitPerMin: number;
  status: string;
  hitCount: number;
  lastHitAt: string | null;
  app: { name: string; appId: string } | null;
  createdBy: string | null;
  createdAt: string;
};

export type GatewayRequestRow = {
  id: string;
  routeKey: string;
  method: string;
  status: number;
  latencyMs: number;
  keyPrefix: string | null;
  sourceIp: string;
  via: string;
  blocked: string | null;
  createdAt: string;
};

export type GatewayStats = {
  routesTotal: number;
  routesActive: number;
  requests24h: number;
  ok24h: number;
  blocked24h: number;
  okRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  hourly: { hour: string; count: number; blocked: number }[];
};

export type BucketRow = {
  id: string;
  bucketId: string;
  name: string;
  storageClass: string;
  replicationFactor: number;
  quotaMb: number;
  usedMb: number;
  objectCount: number;
  status: string;
  app: { name: string; appId: string } | null;
  volume: { name: string; volumeId: string; status: string } | null;
  createdAt: string;
};

export type VolumeRow = {
  id: string;
  volumeId: string;
  name: string;
  capacityGb: number;
  replicationFactor: number;
  status: string;
  region: string;
  node: { name: string } | null;
  usedMb: number;
  bucketCount: number;
};

export type FileRow = {
  id: string;
  fileId: string;
  path: string;
  name: string;
  mime: string;
  sizeBytes: number;
  checksum: string;
  version: number;
  status: string;
  uploadedBy: string | null;
  updatedAt: string;
  bucket: { name: string; bucketId: string } | null;
};

/* ---- Phase 5 ---- */

export type SecurityPolicyRow = {
  id: string;
  wafEnabled: boolean;
  ipBlockEnabled: boolean;
  ddosEnabled: boolean;
  ddosThreshold: number;
  blockMode: string;
  updatedBy: string | null;
  updatedAt: string;
};

export type WafRuleRow = {
  id: string;
  ruleId: string;
  name: string;
  pattern: string;
  matchIn: string;
  headerName: string | null;
  action: string;
  severity: string;
  isSystem: boolean;
  enabled: boolean;
  hitCount: number;
  createdAt: string;
};

export type IpBlockRow = {
  id: string;
  ip: string;
  reason: string;
  source: string;
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type SecurityEventRow = {
  id: string;
  type: string;
  severity: string;
  sourceIp: string | null;
  routeKey: string | null;
  action: string;
  detail: string | null;
  createdAt: string;
};

export type SecurityState = {
  policy: SecurityPolicyRow;
  rules: WafRuleRow[];
  blocks: IpBlockRow[];
  events: SecurityEventRow[];
  stats: { events24h: number; wafBlocked24h: number; activeBlocks: number };
};

export type DeploymentRow = {
  id: string;
  deployId: string;
  version: string;
  buildNumber: number;
  source: string;
  gitSha: string | null;
  status: string;
  health: string;
  url: string | null;
  artifactKb: number | null;
  artifactPath: string | null;
  log: string | null;
  rollbackOf: string | null;
  deployedBy: string | null;
  createdAt: string;
  finishedAt: string | null;
  app: { name: string; appId: string; slug: string };
  node: { name: string } | null;
};

export type PipelineRow = {
  id: string;
  pipelineId: string;
  name: string;
  repo: string;
  branch: string;
  trigger: string;
  stages: string;
  enabled: boolean;
  runCount: number;
  successCount: number;
  failCount: number;
  lastRunAt: string | null;
  lastStatus: string | null;
  createdAt: string;
  app: { name: string; appId: string; slug: string };
};

export type StageLogRow = { stage: string; status: string; ms: number; log: string };

export type PipelineRunRow = {
  id: string;
  runId: string;
  commitSha: string;
  commitMessage: string;
  trigger: string;
  status: string;
  stagesLog: string; // JSON StageLogRow[]
  durationMs: number | null;
  deployId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  pipeline: { pipelineId: string; name: string; branch: string; app: { name: string; appId: string } };
};

export type SslCertRow = {
  id: string;
  certId: string;
  domain: string;
  issuer: string;
  status: string;
  autoRenew: boolean;
  issuedAt: string;
  expiresAt: string;
  targetLabel: string;
  daysLeft?: number;
};

export type DevopsState = {
  pipelines: PipelineRow[];
  runs: PipelineRunRow[];
  certs: SslCertRow[];
  stats: { runsSuccess24h: number; runsFailed24h: number; pipelinesActive: number };
};

/* ---- Phase 6 ---- */

export type MailRow6 = {
  id: string;
  toEmail: string;
  subject: string;
  body: string;
  category: string;
  status: string; // SIMULATED | QUEUED | SENT | FAILED
  createdAt: string;
};

export type MailTemplateRow = {
  id: string;
  key: string;
  name: string;
  subject: string;
  body: string;
  category: string;
  enabled: boolean;
  isSystem: boolean;
};

export type SmtpStatusRow = {
  provider: string;
  transport: "simulated" | "smtp";
  configured: boolean;
  host: string | null;
  port: number | null;
  from: string | null;
  secure: boolean | null;
  source: "env" | "db" | "none";
};

export type MailState = {
  mails: MailRow6[];
  templates: MailTemplateRow[];
  provider: string;
  smtp: SmtpStatusRow;
  stats: {
    total: number;
    last24h: number;
    byStatus: Record<string, number>;
    byCategory: Record<string, number>;
  };
};

export type ChannelRow = {
  id: string;
  channelId: string;
  name: string;
  type: string; // INAPP | EMAIL | WEBHOOK
  target: string;
  enabled: boolean;
  isSystem: boolean;
  app: { name: string; appId: string } | null;
  _count: { rules: number };
  createdAt: string;
};

export type RuleRow = {
  id: string;
  ruleId: string;
  name: string;
  eventType: string;
  minSeverity: string;
  enabled: boolean;
  channel: { name: string; type: string; channelId: string };
  createdAt: string;
};

export type NotificationRow = {
  id: string;
  title: string;
  body: string;
  source: string;
  severity: string;
  channelType: string;
  readAt: string | null;
  createdAt: string;
};

export type NotifyState = {
  channels: ChannelRow[];
  rules: RuleRow[];
  feed: NotificationRow[];
  stats: { unread: number; delivered24h: number };
};

export type CdnDistRow = {
  id: string;
  distId: string;
  name: string;
  domain: string;
  defaultTtlSec: number;
  maxTtlSec: number;
  compress: boolean;
  edgeRegion: string;
  status: string;
  cacheHits: number;
  cacheMisses: number;
  bandwidthMb: number;
  purgedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  bucket: { name: string; bucketId: string; objectCount: number; usedMb: number };
  app: { name: string; appId: string } | null;
};

export type CdnState = {
  distributions: CdnDistRow[];
  buckets: { id: string; name: string; bucketId: string; objectCount: number }[];
  stats: { total: number; active: number; hits: number; misses: number; hitRate: number; bandwidthMb: number };
};

export type WorkloadRow = {
  id: string;
  workloadId: string;
  name: string;
  image: string;
  kind: string;
  cpuMilli: number;
  ramMb: number;
  status: string;
  restartPolicy: string;
  restartCount: number;
  startedAt: string | null;
  createdAt: string;
  app: { name: string; appId: string } | null;
  node: { name: string; nodeId: string } | null;
};

export type ComputeState = {
  workloads: WorkloadRow[];
  nodes: { name: string; nodeId: string; cpuCores: number; ramMb: number }[];
  quotaPerApp: number;
  stats: { total: number; running: number; stopped: number; cpuMilli: number; ramMb: number };
};

export type AiModelRow = {
  id: string;
  modelId: string;
  name: string;
  family: string;
  paramsB: string;
  contextK: number;
  quant: string;
  status: string;
  endpoint: string | null;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  avgLatencyMs: number;
  app: { name: string; appId: string } | null;
};

export type AiJobRow = {
  id: string;
  jobId: string;
  prompt: string;
  status: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number | null;
  output: string | null;
  createdAt: string;
  model: { name: string; modelId: string };
  app: { name: string; appId: string } | null;
};

export type AiState = {
  models: AiModelRow[];
  jobs: AiJobRow[];
  apps: { id: string; name: string; appId: string }[];
  stats: { modelsReady: number; modelsTotal: number; jobs24h: number; tokensIn: number; tokensOut: number };
};

/* ---- Phase 7 ---- */

export type RateCardRow = {
  metric: string;
  label: string;
  unit: string;
  rateBdt: number;
  per: number;
};

export type PlanRow = {
  id: string;
  planId: string;
  code: string;
  name: string;
  audience: string; // INTERNAL | EXTERNAL_RESERVED
  monthlyBaseBdt: number;
  currency: string;
  inclApiCalls: number;
  inclStorageMb: number;
  inclComputeHours: number;
  inclAiTokens: number;
  inclDbMb: number;
  inclCdnMb: number;
  isActive: boolean;
  isDefault: boolean;
  isSystem: boolean;
  note: string;
  locked: boolean;
  _count: { subscriptions: number };
};

export type SubscriptionRow = {
  id: string;
  subId: string;
  status: string;
  budgetMonthlyBdt: number | null;
  periodStart: string;
  createdAt: string;
  app: { name: string; appId: string; slug: string };
  plan: { planId: string; code: string; name: string; monthlyBaseBdt: number; audience: string };
};

export type InvoiceLineRow = {
  metric: string;
  label: string;
  quantity: number;
  unit: string;
  included: number;
  billable: number;
  rateBdt: number;
  per: number;
  costBdt: number;
};

export type InvoiceRow = {
  id: string;
  invoiceId: string;
  number: string;
  period: string;
  mode: string;
  status: string; // DRAFT | ISSUED | PAID | VOID
  currency: string;
  subtotalBdt: number;
  taxBdt: number;
  totalBdt: number;
  lines: string; // JSON InvoiceLineRow[]
  issuedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  app: { name: string; appId: string; slug: string };
};

export type ProjectionRow = {
  subId: string;
  appId: string;
  overBudget: boolean;
  budget: number | null;
  priced: { lines: InvoiceLineRow[]; subtotalBdt: number; taxBdt: number; totalBdt: number };
};

export type BillingState = {
  mode: string;
  period: string;
  recentPeriod: string;
  rateCard: RateCardRow[];
  plans: PlanRow[];
  subscriptions: SubscriptionRow[];
  apps: { id: string; name: string; appId: string; slug: string; subscribed: boolean }[];
  invoices: InvoiceRow[];
  projections: ProjectionRow[];
  previousUsage: { appId: string; metrics: Record<string, number> }[];
  stats: {
    subsActive: number;
    plansActive: number;
    invoicesTotal: number;
    invoicesDraft: number;
    invoicesIssued: number;
    invoicesPaid: number;
    showbackMonthBdt: number;
    showbackLastMonthBdt: number;
    overBudget: number;
    usageRecords: number;
  };
};

export type DocRow = {
  id: string;
  docId: string;
  slug: string;
  title: string;
  category: string; // GET_STARTED | API_REFERENCE | GUIDES | POLICY
  body: string;
  order: number;
  visibility: string; // INTERNAL | PUBLIC
  isSystem: boolean;
  updatedBy: string | null;
  updatedAt: string;
};

export type ApiRefEntryRow = {
  method: string;
  path: string;
  auth: string;
  desc: string;
};

export type ApiRefGroupRow = {
  area: string;
  module: string;
  phase: number;
  entries: ApiRefEntryRow[];
};

export type IntegrationRow = {
  appId: string;
  name: string;
  slug: string;
  status: string;
  activeKeys: number;
  databases: string[];
  buckets: number;
  objects: number;
  workloads: number;
  liveDeploys: number;
  gatewayHits: number;
};

export type PortalState = {
  mode: string;
  docs: DocRow[];
  apiRef: ApiRefGroupRow[];
  integrations: IntegrationRow[];
  stats: {
    docsTotal: number;
    docsInternal: number;
    docsPublic: number;
    endpoints: number;
    endpointGroups: number;
  };
};

export const PHASES: Record<number, { label: string; desc: string }> = {
  1: { label: "Phase 1 — Control Plane", desc: "CORE + AUTH + OTP + ADMIN (live)" },
  2: { label: "Phase 2 — Servers & Network", desc: "SERVER provisioning + NETWORK (IP/DNS/firewall) (live)" },
  3: { label: "Phase 3 — Data & Safety Net", desc: "DATABASE + BACKUP + MONITOR (live)" },
  4: { label: "Phase 4 — API & Storage", desc: "API gateway + STORAGE (SeaweedFS) + FILES (live)" },
  5: { label: "Phase 5 — Security & Delivery", desc: "SECURITY (WAF/DDoS) + DEPLOY + DEVOPS CI/CD & SSL (live)" },
  6: { label: "Phase 6 — Expansion", desc: "MAIL + NOTIFY + CDN + COMPUTE + AI INFRA (live)" },
  7: { label: "Phase 7 — Firebase Mode (internal)", desc: "BILLING showback + developer portal + docs engine (live, internal) — external mode LOCKED by owner decision" },
  8: { label: "Phase 8 — VORTEX AS A SERVICE", desc: "The public multi-tenant BaaS — Firebase's father: projects, keys, end-user auth, doc DB with server-side rules, real-bucket storage, socket.io realtime, sandboxed functions, NEXA one-call provisioning (live)" },
};

/* ---- Phase 8 — VAAS ---- */

export type VaasGate = { mode: string; updatedAt: string | null; updatedBy: string | null };

export type VaasDeveloperRow = {
  devId: string;
  email: string;
  name: string;
  plan: string;
  status: string;
  emailVerified: boolean;
  isNexa: boolean;
  projects: number;
  lastLoginAt: string | null;
  createdAt: string;
};

export type VaasProjectRow = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  region: string;
  status: string;
  viaNexa: boolean;
  authEnabled: boolean;
  rtEnabled: boolean;
  fnEnabled: boolean;
  developer: { devId: string; email: string; name: string } | null;
  users: number;
  collections: number;
  docs: number;
  usageBdt: number;
  createdAt: string;
};

export type VaasCollectionRow = {
  id: string;
  projectId: string;
  name: string;
  docCount: number;
  readRule: string;
  writeRule: string;
  status: string;
};

export type VaasFunctionRow = {
  fnId: string;
  projectId: string;
  name: string;
  trigger: string;
  status: string;
  invocations: number;
  fails: number;
  lastRunAt: string | null;
  lastError: string | null;
};

export type VaasEventRow = {
  eventId: string;
  channel: string;
  type: string;
  payloadJson: string;
  emittedBy: string;
  createdAt: string;
};

export type VaasPlanRow = {
  planId: string;
  code: string;
  name: string;
  audience: string;
  monthlyBaseBdt: number;
  isDefault: boolean;
  note: string;
};

export type VaasState = {
  gate: VaasGate;
  mode: string;
  demo: { projectId: string; projectName: string; clientKey: string; email: string; password: string } | null;
  config: { key: string; value: string; description: string }[];
  plans: VaasPlanRow[];
  developers: VaasDeveloperRow[];
  projects: VaasProjectRow[];
  collections: VaasCollectionRow[];
  functions: VaasFunctionRow[];
  recentEvents: VaasEventRow[];
  usageTop: { metric: string; quantity: number }[];
  stats: {
    developers: number;
    projects: number;
    endUsers: number;
    collections: number;
    docs: number;
    files: number;
    storageMb: number;
    rt24h: number;
    fnRuns24h: number;
    apiCalls: number;
    nexaProjects: number;
    nexaDevId: string | null;
  };
};

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function fmtSize(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB` : `${mb} MB`;
}

/** Byte-level formatter for objects (uploads, downloads). */
export function fmtBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function fmtAgo(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    const ms = Date.now() - new Date(d).getTime();
    if (ms < 0) return "just now";
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch {
    return "—";
  }
}

/** Time until a future date, e.g. "in 42m" — for next backup run. */
export function fmtIn(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    const ms = new Date(d).getTime() - Date.now();
    if (ms <= 0) return "due now";
    const m = Math.floor(ms / 60000);
    if (m < 60) return `in ${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `in ${h}h`;
    return `in ${Math.floor(h / 24)}d`;
  } catch {
    return "—";
  }
}
