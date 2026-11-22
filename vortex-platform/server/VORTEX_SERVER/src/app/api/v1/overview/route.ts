import { db } from "@/lib/db";
import { ok, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";
import { runDuePolicies } from "@/lib/vortex/backup";
import { advanceDeployments } from "@/lib/vortex/deploy";
import { advanceRuns, refreshCerts } from "@/lib/vortex/devops";
import { advanceCdn } from "@/lib/vortex/cdn";
import { advanceWorkloads } from "@/lib/vortex/compute";
import { advanceModels } from "@/lib/vortex/ai";
import { billingState } from "@/lib/vortex/billing";
import { vaasState } from "@/lib/vortex/vaas";

export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  // Phase 3: let due backup policies fire while the owner is looking at the dashboard
  await runDuePolicies();
  // Phase 5: advance in-flight deployments, CI runs and certificate refresh
  await Promise.all([advanceDeployments(), advanceRuns(), refreshCerts()]);
  // Phase 6: advance CDN cache accounting, workload provisioning and model loading
  await Promise.all([advanceCdn(), advanceWorkloads(), advanceModels()]);

  const [
    services, apps, keys, audits, mails, onlineCount, buildingCount, plannedCount, reservedCount, servers, ips, firewallRules, databases, backups, lastBackup, monitors, openAlerts, gwRoutesActive, gwRequests24h, gwBlocked24h, bucketAgg, storageObjects,
    // Phase 5
    secEvents24h, ipBlocksActive, wafRulesEnabled, deployments, pipelines, sslCerts,
    // Phase 6
    mailsLast24h, mailsFailed, notifyUnread, cdnAgg, cdnHitsMisses, workloads, aiModels, aiJobs24h,
  ] =
    await Promise.all([
      db.service.findMany({ orderBy: [{ phase: "asc" }, { serviceKey: "asc" }] }),
      db.app.findMany({ orderBy: { createdAt: "asc" } }),
      db.apiKey.findMany({ where: { status: "ACTIVE" } }),
      db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
      db.mailLog.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
      db.service.count({ where: { status: "ONLINE" } }),
      db.service.count({ where: { status: { in: ["BUILDING", "OFFLINE", "DEGRADED"] } } }),
      db.service.count({ where: { status: "PLANNED" } }),
      db.service.count({ where: { status: "RESERVED" } }),
      db.serverNode.findMany({ where: { status: { not: "DESTROYED" } } }),
      db.ipAddress.findMany(),
      db.firewallRule.findMany({ where: { enabled: true } }),
      db.databaseInstance.findMany({ where: { status: { not: "DESTROYED" } } }),
      db.backupSnapshot.aggregate({ where: { status: "COMPLETED" }, _count: true, _sum: { sizeMb: true } }),
      db.backupSnapshot.findFirst({ where: { status: "COMPLETED" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.monitorTarget.findMany({ where: { enabled: true }, select: { status: true } }),
      db.alertEvent.count({ where: { status: "OPEN" } }),
      // Phase 4
      db.gatewayRoute.count({ where: { status: "ACTIVE" } }),
      db.gatewayRequest.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
      db.gatewayRequest.count({ where: { status: { gte: 400 }, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
      db.storageBucket.aggregate({ _count: true, _sum: { usedMb: true, quotaMb: true } }),
      db.fileObject.count({ where: { status: { in: ["ACTIVE", "ARCHIVED"] } } }),
      // Phase 5
      db.securityEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
      db.ipBlock.count(),
      db.wafRule.count({ where: { enabled: true } }),
      db.deployment.findMany({ where: { status: { in: ["RUNNING", "QUEUED", "BUILDING", "DEPLOYING"] } }, select: { status: true } }),
      db.pipeline.findMany({ where: { enabled: true }, select: { runCount: true } }),
      db.sslCert.findMany({ where: { status: { in: ["ACTIVE", "EXPIRING"] } }, select: { status: true, expiresAt: true } }),
      // Phase 6
      db.mailLog.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
      db.mailLog.count({ where: { status: "FAILED" } }),
      db.notification.count({ where: { readAt: null, channelType: "INAPP" } }),
      db.cdnDistribution.aggregate({ _count: true }),
      db.cdnDistribution.aggregate({ _sum: { cacheHits: true, cacheMisses: true } }),
      db.workload.findMany({ where: { status: { not: "DESTROYED" } }, select: { status: true } }),
      db.aiModel.findMany({ select: { status: true } }),
      db.aiJob.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }),
    ]);

  const phaseMap = new Map<number, { total: number; done: number }>();
  for (const s of services) {
    const p = phaseMap.get(s.phase) || { total: 0, done: 0 };
    p.total += 1;
    if (s.status === "ONLINE") p.done += 1;
    phaseMap.set(s.phase, p);
  }
  const phases = [...phaseMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([phase, v]) => ({ phase, total: v.total, done: v.done, pct: Math.round((v.done / v.total) * 100) }));

  // Phase 7: billing showback snapshot (live metering + invoice totals + gate)
  const billing = await billingState();
  // Phase 8: VAAS state (runs due SCHEDULE functions as a side effect)
  const vaas = await vaasState();

  const versionCfg = await db.appConfig.findUnique({ where: { key: "platform.version" } });

  return ok({
    version: versionCfg?.value || "0.5.0",
    stats: {
      servicesTotal: services.length,
      servicesOnline: onlineCount,
      servicesBuilding: buildingCount,
      servicesPlanned: plannedCount,
      servicesReserved: reservedCount,
      appsTotal: apps.length,
      keysActive: keys.length,
      auditEvents: await db.auditLog.count(),
      mailsSent: await db.mailLog.count(),
      serversRunning: servers.filter((n) => n.status === "RUNNING").length,
      serversTotal: servers.length,
      cpuAllocated: servers.reduce((a, n) => a + n.cpuCores, 0),
      ramAllocatedMb: servers.reduce((a, n) => a + n.ramMb, 0),
      ipsFree: ips.filter((i) => i.status === "FREE").length,
      ipsTotal: ips.length,
      firewallRulesActive: firewallRules.length,
      // Phase 3
      dbsRunning: databases.filter((d) => d.status === "RUNNING").length,
      dbsTotal: databases.length,
      dbsSizeGb: Math.round(databases.reduce((a, d) => a + d.sizeMb, 0) / 1024),
      backupsCount: backups._count,
      backupsSizeGb: Math.round((backups._sum.sizeMb || 0) / 1024),
      lastBackupAt: lastBackup?.createdAt || null,
      monitorsUp: monitors.filter((m) => m.status === "UP").length,
      monitorsTotal: monitors.length,
      alertsOpen: openAlerts,
      // Phase 4
      gwRoutesActive,
      gwRequests24h,
      gwBlocked24h,
      storageBuckets: bucketAgg._count,
      storageObjects,
      storageUsedMb: bucketAgg._sum.usedMb || 0,
      storageQuotaMb: bucketAgg._sum.quotaMb || 0,
      // Phase 5
      secEvents24h,
      ipBlocksActive,
      wafRulesEnabled,
      deploysRunning: deployments.filter((d) => d.status === "RUNNING").length,
      deploysInflight: deployments.filter((d) => ["QUEUED", "BUILDING", "DEPLOYING"].includes(d.status)).length,
      pipelinesActive: pipelines.length,
      pipelineRunsTotal: pipelines.reduce((a, p) => a + p.runCount, 0),
      sslActive: sslCerts.filter((c) => c.status === "ACTIVE").length,
      sslExpiringSoon: sslCerts.filter((c) => c.expiresAt.getTime() < Date.now() + 14 * 24 * 3600_000).length,
      // Phase 6
      mailsLast24h,
      mailsFailed,
      notifyUnread,
      cdnDists: cdnAgg._count,
      cdnHitRate: (() => {
        const h = cdnHitsMisses._sum.cacheHits || 0;
        const m = cdnHitsMisses._sum.cacheMisses || 0;
        return h + m > 0 ? Math.round((h / (h + m)) * 100) : 0;
      })(),
      computeRunning: workloads.filter((w) => w.status === "RUNNING").length,
      computeTotal: workloads.length,
      aiModelsReady: aiModels.filter((m) => m.status === "READY").length,
      aiModelsTotal: aiModels.length,
      aiJobs24h,
      // Phase 7
      billingShowbackMonthBdt: billing.stats.showbackMonthBdt,
      billingInvoices: billing.stats.invoicesTotal,
      billingOverBudget: billing.stats.overBudget,
      billingSubsActive: billing.stats.subsActive,
      firebaseMode: billing.mode,
      // Phase 8
      vaasDevelopers: vaas.stats.developers,
      vaasProjects: vaas.stats.projects,
      vaasEndUsers: vaas.stats.endUsers,
      vaasDocs: vaas.stats.docs,
      vaasFiles: vaas.stats.files,
      vaasRt24h: vaas.stats.rt24h,
      vaasFnRuns24h: vaas.stats.fnRuns24h,
      vaasApiCalls: vaas.stats.apiCalls,
      vaasNexaProjects: vaas.stats.nexaProjects,
    },
    phases,
    recentAudit: audits,
    recentMail: mails,
    uptimeSince: process.uptime(),
    node: process.version,
  });
}
