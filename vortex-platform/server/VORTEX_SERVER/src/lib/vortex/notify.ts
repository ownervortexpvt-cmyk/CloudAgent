import { db } from "@/lib/db";
import { writeAudit } from "./audit";

/**
 * VORTEX NOTIFY (Phase 6) — notification fan-out.
 *
 * Platform events (alerts, deploy failures, security blocks, backup
 * failures) are routed by rules to channels: the in-app feed, the mail
 * outbox, or app webhooks (simulated delivery log until real endpoints
 * answer). Every rule respects a minimum severity threshold.
 */

export async function ownerEmail(): Promise<string> {
  const owner = await db.adminUser.findFirst({ where: { role: "OWNER" }, orderBy: { createdAt: "asc" } });
  return owner?.email || "admin@vortex.local";
}

/** Legacy helper kept for MONITOR/BACKUP callers — alert mail via outbox. */
export async function sendSystemMail(opts: { subject: string; body: string; category?: string }): Promise<void> {
  const cfg = await db.appConfig.findUnique({ where: { key: "monitor.alert_mail_enabled" } });
  if (cfg && cfg.value !== "true") return; // alert mail can be muted by config

  await db.mailLog.create({
    data: {
      toEmail: await ownerEmail(),
      subject: opts.subject,
      body: opts.body,
      category: opts.category || "alert",
      status: "SIMULATED",
    },
  });
}

const SEVERITY_RANK: Record<string, number> = { INFO: 1, WARNING: 2, CRITICAL: 3 };

export const EVENT_TYPES = [
  "ALERT_OPEN",
  "DEPLOY_FAILED",
  "BACKUP_FAILED",
  "SECURITY_BLOCK",
  "AI_JOB_FAILED",
] as const;

/**
 * Fan a platform event out to every enabled rule matching its type and
 * severity. Returns how many channels actually received it.
 */
export async function fanoutNotification(opts: {
  eventType: string;
  title: string;
  body: string;
  source: string;
  severity?: string;
  actor?: string;
}): Promise<{ delivered: number; via: string[] }> {
  const severity = opts.severity || "INFO";
  const rules = await db.notificationRule.findMany({
    where: { enabled: true, eventType: opts.eventType },
    include: { channel: true },
  });

  const via: string[] = [];
  for (const rule of rules) {
    const ch = rule.channel;
    if (!ch.enabled) continue;
    if ((SEVERITY_RANK[severity] || 1) < (SEVERITY_RANK[rule.minSeverity] || 1)) continue;

    if (ch.type === "INAPP") {
      await db.notification.create({
        data: { title: opts.title, body: opts.body, source: opts.source, severity, channelType: "INAPP" },
      });
      via.push(`inapp:${ch.name}`);
    } else if (ch.type === "EMAIL") {
      await db.mailLog.create({
        data: {
          toEmail: ch.target || (await ownerEmail()),
          subject: opts.title,
          body: opts.body,
          category: "notify",
          status: "SIMULATED",
        },
      });
      via.push(`email:${ch.name}`);
    } else if (ch.type === "WEBHOOK") {
      // Simulated delivery — real endpoints answer once apps wire their hooks.
      await db.notification.create({
        data: {
          title: opts.title,
          body: `POST ${ch.target} → accepted (simulated)\n${opts.body}`,
          source: opts.source,
          severity,
          channelType: "WEBHOOK",
        },
      });
      via.push(`webhook:${ch.name}`);
    }
  }

  if (via.length > 0) {
    await writeAudit({
      actor: opts.actor || "system",
      action: "NOTIFY_FANOUT",
      resource: `event:${opts.eventType}`,
      detail: `severity=${severity} delivered=${via.length} via ${via.join(", ")}`,
    });
  }
  return { delivered: via.length, via };
}

export async function notifyState() {
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const [channels, rules, feed, unread] = await Promise.all([
    db.notificationChannel.findMany({ orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }], include: { app: { select: { name: true, appId: true } }, _count: { select: { rules: true } } } }),
    db.notificationRule.findMany({ orderBy: { createdAt: "asc" }, include: { channel: { select: { name: true, type: true, channelId: true } } } }),
    db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
    db.notification.count({ where: { readAt: null, channelType: "INAPP" } }),
  ]);
  const delivered24h = await db.auditLog.count({ where: { action: "NOTIFY_FANOUT", createdAt: { gte: since24h } } });
  return { channels, rules, feed, stats: { unread, delivered24h } };
}
