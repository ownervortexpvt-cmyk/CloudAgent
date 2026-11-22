import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";
import { notifyState, fanoutNotification, EVENT_TYPES } from "@/lib/vortex/notify";

/**
 * NOTIFY MODULE (Phase 6) — event rules → channel fan-out.
 * GET  — channels (with rule counts), rules, in-app feed, stats.
 * POST — { op: "channel.create" | "channel.toggle" | "channel.delete"
 *              | "rule.create" | "rule.toggle" | "rule.delete"
 *              | "emit" | "read" | "read.all" }
 */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  return ok(await notifyState());
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: {
    op?: string;
    id?: string;
    channelId?: string;
    name?: string;
    type?: string;
    target?: string;
    appId?: string | null;
    eventType?: string;
    minSeverity?: string;
    title?: string;
    message?: string;
    severity?: string;
    source?: string;
  };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const rid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

  switch (body.op) {
    case "channel.create": {
      if (!body.name?.trim()) return fail("Channel name is required");
      const type = ["INAPP", "EMAIL", "WEBHOOK"].includes(body.type || "") ? body.type! : "INAPP";
      let target = "";
      if (type === "EMAIL") {
        if (!body.target || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.target)) return fail("A valid email target is required");
        target = body.target;
      } else if (type === "WEBHOOK") {
        if (!body.target || !/^https?:\/\//.test(body.target)) return fail("Webhook target must be an http(s) URL");
        target = body.target;
      }
      let appId: string | null = null;
      if (body.appId) {
        const app = await db.app.findUnique({ where: { id: body.appId } });
        if (!app) return fail("App not found");
        appId = app.id;
      }
      const ch = await db.notificationChannel.create({
        data: { channelId: `chn_${rid()}`, name: body.name.trim().slice(0, 60), type, target, appId, enabled: true },
      });
      return ok({ channel: ch });
    }
    case "channel.toggle": {
      if (!body.channelId) return fail("channelId is required");
      const ch = await db.notificationChannel.findUnique({ where: { channelId: body.channelId } });
      if (!ch) return fail("Channel not found");
      const updated = await db.notificationChannel.update({ where: { channelId: ch.channelId }, data: { enabled: !ch.enabled } });
      return ok({ channel: updated });
    }
    case "channel.delete": {
      if (!body.channelId) return fail("channelId is required");
      const ch = await db.notificationChannel.findUnique({ where: { channelId: body.channelId } });
      if (!ch) return fail("Channel not found");
      if (ch.isSystem) return fail("System channels cannot be deleted — disable them instead");
      await db.notificationChannel.delete({ where: { channelId: ch.channelId } });
      return ok({ deleted: true });
    }
    case "rule.create": {
      if (!body.eventType || !EVENT_TYPES.includes(body.eventType as (typeof EVENT_TYPES)[number])) {
        return fail(`eventType must be one of: ${EVENT_TYPES.join(", ")}`);
      }
      if (!body.channelId) return fail("channelId is required");
      const ch = await db.notificationChannel.findUnique({ where: { channelId: body.channelId } });
      if (!ch) return fail("Channel not found");
      const minSeverity = ["INFO", "WARNING", "CRITICAL"].includes(body.minSeverity || "") ? body.minSeverity! : "INFO";
      const rule = await db.notificationRule.create({
        data: {
          ruleId: `nrl_${rid()}`,
          name: `${body.eventType} → ${ch.name}`,
          eventType: body.eventType,
          minSeverity,
          channelId: ch.id,
          enabled: true,
        },
      });
      return ok({ rule });
    }
    case "rule.toggle": {
      if (!body.id) return fail("Rule id is required");
      const rule = await db.notificationRule.findUnique({ where: { ruleId: body.id } });
      if (!rule) return fail("Rule not found");
      const updated = await db.notificationRule.update({ where: { ruleId: rule.ruleId }, data: { enabled: !rule.enabled } });
      return ok({ rule: updated });
    }
    case "rule.delete": {
      if (!body.id) return fail("Rule id is required");
      const rule = await db.notificationRule.findUnique({ where: { ruleId: body.id } });
      if (!rule) return fail("Rule not found");
      await db.notificationRule.delete({ where: { ruleId: rule.ruleId } });
      return ok({ deleted: true });
    }
    case "emit": {
      // Manual test event through the REAL fan-out pipeline.
      const res = await fanoutNotification({
        eventType: body.eventType && EVENT_TYPES.includes(body.eventType as (typeof EVENT_TYPES)[number]) ? body.eventType : "ALERT_OPEN",
        title: body.title?.trim() || "Manual test event",
        body: body.message?.trim() || `Fired by ${user.email} from the NOTIFY console to verify delivery paths.`,
        source: body.source?.trim().slice(0, 24) || "MANUAL",
        severity: ["INFO", "WARNING", "CRITICAL"].includes(body.severity || "") ? body.severity! : "WARNING",
        actor: user.email,
      });
      return ok(res);
    }
    case "read": {
      if (!body.id) return fail("Notification id is required");
      await db.notification.update({ where: { id: body.id }, data: { readAt: new Date() } });
      return ok({ read: true });
    }
    case "read.all": {
      const res = await db.notification.updateMany({ where: { readAt: null, channelType: "INAPP" }, data: { readAt: new Date() } });
      return ok({ read: res.count });
    }
    default:
      return fail(`Unknown op "${body.op}"`);
  }
}
