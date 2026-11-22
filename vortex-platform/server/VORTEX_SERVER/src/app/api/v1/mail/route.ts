import { db } from "@/lib/db";
import { ok, fail, requireSession } from "@/lib/vortex/api";
import { ensureSeeded } from "@/lib/vortex/seed";
import { writeAudit } from "@/lib/vortex/audit";
import { getProvider, sendMail, sendFromTemplate, retryMail, mailStats, smtpStatus, testSmtp } from "@/lib/vortex/mail";

/**
 * MAIL MODULE (Phase 6 + SMTP wiring) — full outbound center.
 * GET  — outbox (50 latest), templates, provider + SMTP status, stats.
 * POST — { op: "send" | "send.template" | "retry" | "provider" | "template.save"
 *          | "smtp.save" | "smtp.test" | "smtp.clear" }
 *
 * SMTP settings live in the control plane (Postal or any provider) — the
 * password is stored as an isSecret config value and never returned to the UI.
 */
export async function GET(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;

  const [mails, templates, provider, stats, smtp] = await Promise.all([
    db.mailLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db.mailTemplate.findMany({ orderBy: [{ isSystem: "desc" }, { key: "asc" }] }),
    getProvider(),
    mailStats(),
    smtpStatus(),
  ]);
  return ok({ mails, templates, provider, stats, smtp });
}

export async function POST(req: Request) {
  await ensureSeeded();
  const gate = await requireSession(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  let body: {
    op?: string;
    to?: string;
    subject?: string;
    body?: string;
    category?: string;
    templateKey?: string;
    vars?: Record<string, string>;
    id?: string;
    provider?: string;
    key?: string;
    name?: string;
    enabled?: boolean;
    host?: string;
    port?: number;
    user?: string;
    pass?: string;
    from?: string;
    secure?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body");
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  switch (body.op) {
    case "send": {
      if (!body.to || !emailRe.test(body.to)) return fail("A valid recipient email is required");
      if (!body.subject?.trim()) return fail("Subject is required");
      if (!body.body?.trim()) return fail("Body is required");
      const res = await sendMail({
        toEmail: body.to,
        subject: body.subject.trim().slice(0, 200),
        body: body.body.slice(0, 8000),
        category: ["otp", "alert", "notify", "deploy", "system"].includes(body.category || "") ? body.category : "system",
        actor: user.email,
      });
      return ok({ mail: res });
    }
    case "send.template": {
      if (!body.templateKey) return fail("templateKey is required");
      const to = body.to || (await db.adminUser.findFirst({ where: { role: "OWNER" } }))?.email;
      if (!to) return fail("Recipient missing — pass `to`");
      const res = await sendFromTemplate({ templateKey: body.templateKey, toEmail: to, vars: body.vars || {}, actor: user.email });
      if ("error" in res) return fail(res.error);
      return ok({ mail: res });
    }
    case "retry": {
      if (!body.id) return fail("Mail id is required");
      const res = await retryMail(body.id, user.email);
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "provider": {
      if (!["simulated", "smtp", "postal"].includes(body.provider || "")) {
        return fail("provider must be simulated | smtp | postal");
      }
      const current = await db.appConfig.findUnique({ where: { key: "mail.provider" } });
      if (current) {
        await db.appConfig.update({ where: { key: "mail.provider" }, data: { value: body.provider!, updatedBy: user.email } });
      } else {
        await db.appConfig.create({
          data: { key: "mail.provider", value: body.provider!, category: "mail", description: "Outbound mail provider", updatedBy: user.email },
        });
      }
      return ok({ provider: body.provider });
    }
    case "template.save": {
      if (!body.key) return fail("Template key is required");
      const tpl = await db.mailTemplate.findUnique({ where: { key: body.key } });
      if (!tpl) return fail("Template not found — only existing templates can be edited");
      const data: Record<string, unknown> = {};
      if (body.subject?.trim()) data.subject = body.subject.trim().slice(0, 200);
      if (body.body?.trim()) data.body = body.body.slice(0, 8000);
      if (typeof body.enabled === "boolean") data.enabled = body.enabled;
      const updated = await db.mailTemplate.update({ where: { key: body.key }, data });
      return ok({ template: updated });
    }
    case "smtp.save": {
      const SMTP_KEYS: Record<string, { category: string; description: string; isSecret?: boolean }> = {
        "mail.smtp_host": { category: "mail", description: "SMTP server hostname (e.g. Postal relay)" },
        "mail.smtp_port": { category: "mail", description: "SMTP server port (25 / 465 / 587)" },
        "mail.smtp_user": { category: "mail", description: "SMTP username (blank = no auth)" },
        "mail.smtp_pass": { category: "mail", description: "SMTP password", isSecret: true },
        "mail.smtp_from": { category: "mail", description: "From address for all outbound mail" },
        "mail.smtp_secure": { category: "mail", description: "Use implicit TLS (port 465)" },
      };
      const updates: { key: string; value: string }[] = [];
      if (body.host !== undefined) updates.push({ key: "mail.smtp_host", value: body.host.trim() });
      if (body.port !== undefined) {
        const p = parseInt(String(body.port), 10);
        if (!Number.isFinite(p) || p < 1 || p > 65535) return fail("port must be 1-65535");
        updates.push({ key: "mail.smtp_port", value: String(p) });
      }
      if (body.user !== undefined) updates.push({ key: "mail.smtp_user", value: body.user.trim() });
      if (body.pass !== undefined && body.pass !== "") updates.push({ key: "mail.smtp_pass", value: body.pass }); // empty = keep existing
      if (body.from !== undefined) {
        if (!emailRe.test(body.from.trim())) return fail("from must be a valid email address");
        updates.push({ key: "mail.smtp_from", value: body.from.trim() });
      }
      if (body.secure !== undefined) updates.push({ key: "mail.smtp_secure", value: body.secure ? "true" : "false" });
      for (const u of updates) {
        const meta = SMTP_KEYS[u.key];
        await db.appConfig.upsert({
          where: { key: u.key },
          update: { value: u.value, updatedBy: user.email },
          create: { key: u.key, value: u.value, category: meta.category, description: meta.description, isSecret: meta.isSecret ?? false, updatedBy: user.email },
        });
      }
      await writeAudit({
        actor: user.email,
        action: "MAIL_SMTP_SAVED",
        resource: "mail:smtp",
        detail: `updated=${updates.map((u) => u.key).join(", ") || "nothing"}`,
      });
      return ok({ smtp: await smtpStatus() });
    }
    case "smtp.test": {
      const to = body.to || (await db.adminUser.findFirst({ where: { role: "OWNER" } }))?.email;
      if (!to || !emailRe.test(to)) return fail("A valid recipient email is required");
      const res = await testSmtp({ toEmail: to, actor: user.email });
      if ("error" in res) return fail(res.error);
      return ok(res);
    }
    case "smtp.clear": {
      await db.appConfig.deleteMany({ where: { key: { startsWith: "mail.smtp_" } } });
      await writeAudit({ actor: user.email, action: "MAIL_SMTP_CLEARED", resource: "mail:smtp", detail: "SMTP settings removed — delivery falls back to simulated outbox" });
      return ok({ smtp: await smtpStatus() });
    }
    default:
      return fail(`Unknown op "${body.op}" — use send | send.template | retry | provider | template.save | smtp.save | smtp.test | smtp.clear`);
  }
}
