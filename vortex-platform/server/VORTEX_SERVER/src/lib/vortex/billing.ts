import { db } from "@/lib/db";
import { writeAudit } from "./audit";
import { fanoutNotification } from "./notify";

/**
 * VORTEX BILLING (Phase 7) — showback metering for the owner's own apps.
 *
 * VORTEX is PRIVATE: nobody is billed externally and no money moves while
 * `future.firebase_mode = LOCKED`. What BILLING does today is answer, with
 * real numbers, the owner's question: "what does each of my apps cost me
 * to run inside VORTEX?" — metered from the actual platform tables:
 *
 *   API_CALLS        ← gateway requests (app-bound) this period
 *   STORAGE_MB       ← bucket usage (point in time)
 *   COMPUTE_HOURS    ← running workloads × hours in period
 *   AI_TOKENS        ← inference jobs this period (in + out tokens)
 *   DB_SIZE_MB       ← provisioned database size
 *   CDN_BANDWIDTH_MB ← edge bandwidth accounting
 *
 * EXTERNAL audience plans are the locked Firebase Mode reserve: they can
 * neither be subscribed nor issued against while the gate is LOCKED.
 */

export type MetricKey =
  | "API_CALLS"
  | "STORAGE_MB"
  | "COMPUTE_HOURS"
  | "AI_TOKENS"
  | "DB_SIZE_MB"
  | "CDN_BANDWIDTH_MB";

export type RateCardRow = {
  metric: MetricKey;
  label: string;
  unit: string;
  /** BDT charged per `per` units beyond the plan allowance. */
  rateBdt: number;
  per: number;
};

export const RATE_CARD: RateCardRow[] = [
  { metric: "API_CALLS", label: "Gateway API calls", unit: "calls", rateBdt: 2, per: 1000 },
  { metric: "STORAGE_MB", label: "Object storage", unit: "MB-month", rateBdt: 3, per: 1024 },
  { metric: "COMPUTE_HOURS", label: "Compute (runtime workloads)", unit: "core-hours", rateBdt: 8, per: 1 },
  { metric: "AI_TOKENS", label: "AI inference tokens", unit: "10k tokens", rateBdt: 5, per: 10000 },
  { metric: "DB_SIZE_MB", label: "Database capacity", unit: "MB-month", rateBdt: 4, per: 1024 },
  { metric: "CDN_BANDWIDTH_MB", label: "CDN egress", unit: "MB", rateBdt: 2, per: 1024 },
];

export function rateFor(metric: string): RateCardRow {
  return RATE_CARD.find((r) => r.metric === metric) || RATE_CARD[0];
}

/** "2026-11" month bucket for a date. */
export function periodKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** UTC window of a period key. */
export function periodWindow(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start, end };
}

export function currentPeriod(): string {
  return periodKey();
}

export type UsageMap = Map<string, Map<string, number>>; // appId -> metric -> quantity

export type InvoiceLine = {
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

/** Integer-BDT pricing of one app's usage against a plan. All rounding is ceil (honest, never under-counts). */
export function priceUsage(
  plan: { monthlyBaseBdt: number; inclApiCalls: number; inclStorageMb: number; inclComputeHours: number; inclAiTokens: number; inclDbMb: number; inclCdnMb: number },
  usage: Record<string, number>
): { lines: InvoiceLine[]; subtotalBdt: number; taxBdt: number; totalBdt: number } {
  const includedMap: Record<string, number> = {
    API_CALLS: plan.inclApiCalls,
    STORAGE_MB: plan.inclStorageMb,
    COMPUTE_HOURS: plan.inclComputeHours,
    AI_TOKENS: plan.inclAiTokens,
    DB_SIZE_MB: plan.inclDbMb,
    CDN_BANDWIDTH_MB: plan.inclCdnMb,
  };
  let subtotal = plan.monthlyBaseBdt;
  const lines: InvoiceLine[] = RATE_CARD.map((r) => {
    const quantity = usage[r.metric] || 0;
    const included = includedMap[r.metric] || 0;
    const billable = Math.max(0, quantity - included);
    const cost = billable > 0 ? Math.ceil((billable / r.per) * r.rateBdt) : 0;
    subtotal += cost;
    return {
      metric: r.metric,
      label: r.label,
      quantity,
      unit: r.unit,
      included,
      billable,
      rateBdt: r.rateBdt,
      per: r.per,
      costBdt: cost,
    };
  });
  // Bangladesh VAT 15% — informational in SHOWBACK mode, real if the gate ever opens.
  const tax = Math.round(subtotal * 0.15);
  return { lines, subtotalBdt: subtotal, taxBdt: tax, totalBdt: subtotal + tax };
}

/** Allowance fields of a plan as a usage-shaped record (for the portal + UI). */
export function planAllowances(plan: {
  inclApiCalls: number; inclStorageMb: number; inclComputeHours: number; inclAiTokens: number; inclDbMb: number; inclCdnMb: number;
}): Record<string, number> {
  return {
    API_CALLS: plan.inclApiCalls,
    STORAGE_MB: plan.inclStorageMb,
    COMPUTE_HOURS: plan.inclComputeHours,
    AI_TOKENS: plan.inclAiTokens,
    DB_SIZE_MB: plan.inclDbMb,
    CDN_BANDWIDTH_MB: plan.inclCdnMb,
  };
}

/** Live metering from real platform tables, grouped per app, for the current period. */
export async function meterLive(period: string): Promise<UsageMap> {
  const { start } = periodWindow(period);
  const now = new Date();
  const usage: UsageMap = new Map();
  const bump = (appId: string, metric: MetricKey, qty: number) => {
    if (!appId || qty <= 0) return;
    const m = usage.get(appId) || new Map();
    m.set(metric, (m.get(metric) || 0) + qty);
    usage.set(appId, m);
  };

  // apps carrying the load (subs are the billing boundary)
  const subs = await db.billingSubscription.findMany({ where: { status: "ACTIVE" }, select: { appId: true } });
  const subAppIds = new Set(subs.map((s) => s.appId));
  if (subAppIds.size === 0) return usage;

  // 1. API calls from the gateway log (this period, app-bound)
  const apiRows = await db.gatewayRequest.groupBy({
    by: ["appId"],
    where: { createdAt: { gte: start }, appId: { in: [...subAppIds] } },
    _count: true,
  });
  for (const row of apiRows) if (row.appId) bump(row.appId, "API_CALLS", row._count);

  // 2. Storage usage per app (point in time)
  const bucketRows = await db.storageBucket.groupBy({
    by: ["appId"],
    where: { appId: { in: [...subAppIds] } },
    _sum: { usedMb: true },
  });
  for (const row of bucketRows) if (row.appId) bump(row.appId, "STORAGE_MB", row._sum.usedMb || 0);

  // 3. Compute hours: running workloads × hours elapsed this period
  const workloads = await db.workload.findMany({
    where: { status: "RUNNING", appId: { in: [...subAppIds] } },
    select: { appId: true, startedAt: true },
  });
  for (const w of workloads) {
    if (!w.appId || !w.startedAt) continue;
    const from = w.startedAt.getTime() > start.getTime() ? w.startedAt.getTime() : start.getTime();
    const hours = Math.max(0, Math.round((now.getTime() - from) / 3600_000));
    bump(w.appId, "COMPUTE_HOURS", hours);
  }

  // 4. AI tokens from inference jobs this period
  const aiRows = await db.aiJob.groupBy({
    by: ["appId"],
    where: { createdAt: { gte: start }, appId: { in: [...subAppIds] } },
    _sum: { tokensIn: true, tokensOut: true },
  });
  for (const row of aiRows) if (row.appId) bump(row.appId, "AI_TOKENS", (row._sum.tokensIn || 0) + (row._sum.tokensOut || 0));

  // 5. Database capacity per app
  const dbRows = await db.databaseInstance.groupBy({
    by: ["appId"],
    where: { appId: { in: [...subAppIds] }, status: { not: "DESTROYED" } },
    _sum: { sizeMb: true },
  });
  for (const row of dbRows) if (row.appId) bump(row.appId, "DB_SIZE_MB", row._sum.sizeMb || 0);

  // 6. CDN bandwidth per app
  const cdnRows = await db.cdnDistribution.groupBy({
    by: ["appId"],
    where: { appId: { in: [...subAppIds] } },
    _sum: { bandwidthMb: true },
  });
  for (const row of cdnRows) if (row.appId) bump(row.appId, "CDN_BANDWIDTH_MB", row._sum.bandwidthMb || 0);

  // 7. MANUAL adjustments recorded for this period (one-off imports, corrections)
  const manual = await db.usageRecord.findMany({ where: { period, source: "MANUAL" } });
  for (const rec of manual) {
    bump(rec.appId, rec.metric as MetricKey, rec.quantity);
  }

  return usage;
}

/** Persist the metered snapshot of a period (METER source) — idempotent upserts. */
export async function persistMeteredUsage(period: string): Promise<number> {
  const live = await meterLive(period);
  let n = 0;
  for (const [appId, metrics] of live) {
    for (const [metric, quantity] of metrics) {
      await db.usageRecord.upsert({
        where: { appId_metric_period: { appId, metric, period } },
        update: { quantity },
        create: { appId, metric, quantity, period, source: "METER" },
      });
      n += 1;
    }
  }
  return n;
}

/** Stored usage of a past period (UsageRecords). */
async function storedUsage(period: string): Promise<UsageMap> {
  const rows = await db.usageRecord.findMany({ where: { period, source: { in: ["METER", "MANUAL"] } } });
  const usage: UsageMap = new Map();
  for (const r of rows) {
    const m = usage.get(r.appId) || new Map();
    m.set(r.metric, (m.get(r.metric) || 0) + r.quantity);
    usage.set(r.appId, m);
  }
  return usage;
}

async function firebaseMode(): Promise<string> {
  const cfg = await db.appConfig.findUnique({ where: { key: "future.firebase_mode" } });
  return cfg?.value || "LOCKED";
}

async function nextInvoiceNumber(period: string): Promise<string> {
  const count = await db.invoice.count({ where: { period } });
  return `VX-${period}-${String(count + 1).padStart(4, "0")}`;
}

// ------------------------------------------------------------ state

export async function billingState() {
  const period = currentPeriod();
  const [plans, subs, invoices, live, recentPeriod] = await Promise.all([
    db.billingPlan.findMany({ orderBy: [{ audience: "asc" }, { monthlyBaseBdt: "asc" }], include: { _count: { select: { subscriptions: { where: { status: "ACTIVE" } } } } } }),
    db.billingSubscription.findMany({
      orderBy: { createdAt: "asc" },
      include: { app: { select: { name: true, appId: true, slug: true } }, plan: true },
    }),
    db.invoice.findMany({ orderBy: { createdAt: "desc" }, include: { app: { select: { name: true, appId: true, slug: true } } } }),
    meterLive(period),
    periodKey(new Date(Date.now() - 30 * 86400_000)),
  ]);

  const apps = await db.app.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, appId: true, slug: true } });
  const prevStored = await storedUsage(recentPeriod);

  const mode = await firebaseMode();

  // live projected cost per app (current period)
  const projections = subs.map((s) => {
    const metrics = live.get(s.appId) || new Map<string, number>();
    const usage: Record<string, number> = {};
    metrics.forEach((v, k) => (usage[k] = v));
    const priced = priceUsage(s.plan, usage);
    return {
      subId: s.subId,
      appId: s.appId,
      priced,
      overBudget: s.budgetMonthlyBdt != null && priced.totalBdt > s.budgetMonthlyBdt,
      budget: s.budgetMonthlyBdt,
    };
  });

  return {
    mode,
    period,
    recentPeriod,
    rateCard: RATE_CARD,
    plans: plans.map((p) => ({ ...p, locked: p.audience === "EXTERNAL_RESERVED" && mode === "LOCKED" })),
    subscriptions: subs,
    apps: apps.map((a) => ({ id: a.id, name: a.name, appId: a.appId, slug: a.slug, subscribed: subs.some((s) => s.appId === a.id && s.status === "ACTIVE") })),
    invoices,
    projections,
    previousUsage: [...prevStored.entries()].map(([appId, metrics]) => ({
      appId,
      metrics: Object.fromEntries(metrics),
    })),
    stats: {
      subsActive: subs.filter((s) => s.status === "ACTIVE").length,
      plansActive: plans.filter((p) => p.isActive).length,
      invoicesTotal: invoices.length,
      invoicesDraft: invoices.filter((i) => i.status === "DRAFT").length,
      invoicesIssued: invoices.filter((i) => i.status === "ISSUED").length,
      invoicesPaid: invoices.filter((i) => i.status === "PAID").length,
      showbackMonthBdt: projections.reduce((a, p) => a + p.priced.totalBdt, 0),
      showbackLastMonthBdt: invoices.filter((i) => i.period === recentPeriod).reduce((a, i) => a + i.totalBdt, 0),
      overBudget: projections.filter((p) => p.overBudget).length,
      usageRecords: await db.usageRecord.count(),
    },
  };
}

// ------------------------------------------------------------ operations

export async function subscribe(opts: { appId: string; planId: string; budgetMonthlyBdt?: number | null; actor: string }) {
  const app = await db.app.findUnique({ where: { id: opts.appId } });
  if (!app) return { error: "App not found" };
  const plan = await db.billingPlan.findUnique({ where: { id: opts.planId } });
  if (!plan) return { error: "Plan not found" };
  if (plan.audience === "EXTERNAL_RESERVED" && (await firebaseMode()) === "LOCKED") {
    return { error: "External plans are reserved for Firebase Mode — the gate is LOCKED by owner decision" };
  }
  const existing = await db.billingSubscription.findFirst({ where: { appId: opts.appId, status: "ACTIVE" } });
  if (existing) return { error: `${app.name} already has an active subscription — use change_plan instead` };

  const subId = `sub_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  await db.billingSubscription.create({
    data: {
      subId,
      appId: opts.appId,
      planId: opts.planId,
      budgetMonthlyBdt: opts.budgetMonthlyBdt ?? null,
      periodStart: new Date(),
    },
  });
  await writeAudit({
    actor: opts.actor,
    action: "BILLING_SUBSCRIBED",
    resource: `app:${app.appId}`,
    detail: `${app.name} subscribed to plan ${plan.code}${opts.budgetMonthlyBdt ? ` · budget ${opts.budgetMonthlyBdt} BDT/mo` : ""}`,
  });
  return { subId, plan: plan.code };
}

export async function changePlan(opts: { subId: string; planId: string; actor: string }) {
  const sub = await db.billingSubscription.findUnique({ where: { subId: opts.subId }, include: { app: true } });
  if (!sub) return { error: "Subscription not found" };
  const plan = await db.billingPlan.findUnique({ where: { id: opts.planId } });
  if (!plan) return { error: "Plan not found" };
  if (plan.audience === "EXTERNAL_RESERVED" && (await firebaseMode()) === "LOCKED") {
    return { error: "External plans are reserved for Firebase Mode — the gate is LOCKED by owner decision" };
  }
  await db.billingSubscription.update({ where: { id: sub.id }, data: { planId: opts.planId } });
  await writeAudit({
    actor: opts.actor,
    action: "BILLING_PLAN_CHANGED",
    resource: `sub:${sub.subId}`,
    detail: `${sub.app.name} → ${plan.code}`,
  });
  return { subId: sub.subId, plan: plan.code };
}

export async function setBudget(opts: { subId: string; budgetMonthlyBdt: number | null; actor: string }) {
  const sub = await db.billingSubscription.findUnique({ where: { subId: opts.subId }, include: { app: true } });
  if (!sub) return { error: "Subscription not found" };
  const budget = opts.budgetMonthlyBdt != null ? Math.max(0, Math.round(opts.budgetMonthlyBdt)) : null;
  await db.billingSubscription.update({ where: { id: sub.id }, data: { budgetMonthlyBdt: budget } });
  await writeAudit({
    actor: opts.actor,
    action: "BILLING_BUDGET_SET",
    resource: `sub:${sub.subId}`,
    detail: `${sub.app.name} showback budget → ${budget == null ? "none" : `${budget} BDT/mo`}`,
  });
  return { subId: sub.subId, budget };
}

export async function generateInvoice(opts: { appId: string; period: string; actor: string }) {
  const app = await db.app.findUnique({ where: { id: opts.appId } });
  if (!app) return { error: "App not found" };
  const sub = await db.billingSubscription.findFirst({
    where: { appId: opts.appId, status: "ACTIVE" },
    include: { plan: true },
  });
  if (!sub) return { error: `${app.name} has no active subscription` };
  if (!/^\d{4}-\d{2}$/.test(opts.period)) return { error: "period must look like 2026-11" };
  const existing = await db.invoice.findFirst({ where: { appId: opts.appId, period: opts.period, mode: "SHOWBACK" } });
  if (existing && existing.status !== "DRAFT" && existing.status !== "VOID") {
    return { error: `Invoice ${existing.number} already ${existing.status} for ${opts.period} — void it first to regenerate` };
  }

  let usage: Record<string, number>;
  if (opts.period === currentPeriod()) {
    await persistMeteredUsage(opts.period); // snapshot the live meter
    const live = await meterLive(opts.period);
    const metrics = live.get(opts.appId) || new Map<string, number>();
    usage = Object.fromEntries(metrics);
  } else {
    const stored = await storedUsage(opts.period);
    const metrics = stored.get(opts.appId) || new Map<string, number>();
    usage = Object.fromEntries(metrics);
    // keep records around for auditability
    for (const [metric, quantity] of Object.entries(usage)) {
      await db.usageRecord.upsert({
        where: { appId_metric_period: { appId: opts.appId, metric, period: opts.period } },
        update: { quantity },
        create: { appId: opts.appId, metric, quantity, period: opts.period, source: "METER" },
      });
    }
  }

  const priced = priceUsage(sub.plan, usage);
  const invoiceId = `inv_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const number = await nextInvoiceNumber(opts.period);

  const invoice = existing
    ? await db.invoice.update({
        where: { id: existing.id },
        data: {
          invoiceId,
          number,
          subtotalBdt: priced.subtotalBdt,
          taxBdt: priced.taxBdt,
          totalBdt: priced.totalBdt,
          lines: JSON.stringify(priced.lines),
          status: "DRAFT",
          issuedAt: null,
          paidAt: null,
        },
      })
    : await db.invoice.create({
        data: {
          invoiceId,
          number,
          appId: opts.appId,
          period: opts.period,
          mode: "SHOWBACK",
          status: "DRAFT",
          subtotalBdt: priced.subtotalBdt,
          taxBdt: priced.taxBdt,
          totalBdt: priced.totalBdt,
          lines: JSON.stringify(priced.lines),
        },
      });

  await writeAudit({
    actor: opts.actor,
    action: "BILLING_INVOICE_DRAFTED",
    resource: `invoice:${invoice.invoiceId}`,
    detail: `${app.name} · ${opts.period} · showback ${priced.totalBdt} BDT (${priced.lines.filter((l) => l.costBdt > 0).length} priced lines)`,
  });
  return { invoiceId: invoice.invoiceId, number, totalBdt: priced.totalBdt };
}

export async function issueInvoice(opts: { invoiceId: string; actor: string }) {
  const inv = await db.invoice.findUnique({ where: { invoiceId: opts.invoiceId }, include: { app: true } });
  if (!inv) return { error: "Invoice not found" };
  if (inv.status !== "DRAFT") return { error: `Only DRAFT invoices can be issued (this one is ${inv.status})` };
  await db.invoice.update({ where: { id: inv.id }, data: { status: "ISSUED", issuedAt: new Date() } });

  const sub = await db.billingSubscription.findFirst({ where: { appId: inv.appId, status: "ACTIVE" } });
  const overBudget = sub?.budgetMonthlyBdt != null && inv.totalBdt > sub.budgetMonthlyBdt;
  await fanoutNotification({
    eventType: overBudget ? "BUDGET_BREACH" : "INVOICE_ISSUED",
    title: overBudget ? `Showback over budget: ${inv.app.name}` : `Showback issued: ${inv.number}`,
    body: overBudget
      ? `${inv.app.name} · ${inv.period} showback is ${inv.totalBdt} BDT against a ${sub?.budgetMonthlyBdt} BDT budget (VAT incl.).`
      : `${inv.app.name} · ${inv.period} showback issued at ${inv.totalBdt} BDT (VAT incl.). Internal — no external charge.`,
    source: "BILLING",
    severity: overBudget ? "WARNING" : "INFO",
    actor: opts.actor,
  });
  await writeAudit({
    actor: opts.actor,
    action: "BILLING_INVOICE_ISSUED",
    resource: `invoice:${inv.invoiceId}`,
    detail: `${inv.number} · ${inv.totalBdt} BDT${overBudget ? " · OVER BUDGET" : ""}`,
  });
  return { invoiceId: inv.invoiceId, status: "ISSUED", overBudget: !!overBudget };
}

export async function invoiceAction(opts: { invoiceId: string; action: "paid" | "void"; actor: string }) {
  const inv = await db.invoice.findUnique({ where: { invoiceId: opts.invoiceId }, include: { app: true } });
  if (!inv) return { error: "Invoice not found" };
  if (inv.status === "PAID") return { error: "Invoice is already settled" };
  if (inv.status === "VOID") return { error: "Invoice is void" };

  if (opts.action === "paid") {
    if (inv.status !== "ISSUED") return { error: "Issue the invoice before settling it" };
    await db.invoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: new Date() } });
  } else {
    await db.invoice.update({ where: { id: inv.id }, data: { status: "VOID", paidAt: null } });
  }
  await writeAudit({
    actor: opts.actor,
    action: `BILLING_INVOICE_${opts.action.toUpperCase()}`,
    resource: `invoice:${inv.invoiceId}`,
    detail: `${inv.number} · ${inv.app.name} · ${opts.action}`,
  });
  return { invoiceId: inv.invoiceId, status: opts.action === "paid" ? "PAID" : "VOID" };
}
