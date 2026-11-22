import { db } from "@/lib/db";
import { writeAudit } from "./audit";
import nodemailer from "nodemailer";

/**
 * VORTEX MAIL (Phase 6 + SMTP wiring) — full outbound center.
 *
 * Provider is config-driven (mail.provider: simulated | smtp | postal).
 * "postal" is Postal (mail server) speaking plain SMTP — same transport.
 *
 * SMTP settings resolve in priority order:
 *   1. Environment: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE
 *   2. Control-plane config: mail.smtp_host / _port / _user / _pass (isSecret) /
 *      _from / _secure — the owner can point VORTEX at Postal from the UI,
 *      no redeploy needed.
 *
 * With no SMTP configured, delivery is honestly marked SIMULATED (sandbox
 * truth: nothing leaves the machine) and OTP login codes are shown in the
 * dev hint instead of being emailed.
 */

export type MailStatus = "SIMULATED" | "QUEUED" | "SENT" | "FAILED";

export type SmtpConfig = {
  host: string;
  port: number;
  user: string | null;
  pass: string | null;
  from: string;
  secure: boolean;
  source: "env" | "db";
};

export type SmtpStatus = {
  provider: string;
  transport: "simulated" | "smtp";
  configured: boolean;
  host: string | null;
  port: number | null;
  from: string | null;
  secure: boolean | null;
  source: "env" | "db" | "none";
};

export async function getProvider(): Promise<string> {
  const cfg = await db.appConfig.findUnique({ where: { key: "mail.provider" } });
  return cfg?.value || "simulated";
}

/** Non-secret SMTP settings for the UI. The password is never returned. */
export async function smtpStatus(): Promise<SmtpStatus> {
  const provider = await getProvider();
  const cfg = await resolveSmtpConfig();
  if (!cfg) {
    return { provider, transport: "simulated", configured: false, host: null, port: null, from: null, secure: null, source: "none" };
  }
  return {
    provider,
    transport: "smtp",
    configured: true,
    host: cfg.host,
    port: cfg.port,
    from: cfg.from,
    secure: cfg.secure,
    source: cfg.source,
  };
}

async function dbCfg(key: string): Promise<string | null> {
  const row = await db.appConfig.findUnique({ where: { key } });
  return row?.value || null;
}

/** Resolve SMTP settings from env (priority) or control-plane config. */
export async function resolveSmtpConfig(): Promise<SmtpConfig | null> {
  const provider = await getProvider();
  if (provider === "simulated") return null;

  if (process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_FROM) {
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10),
      user: process.env.SMTP_USER || null,
      pass: process.env.SMTP_PASS || null,
      from: process.env.SMTP_FROM,
      secure: process.env.SMTP_SECURE === "true",
      source: "env",
    };
  }

  const host = await dbCfg("mail.smtp_host");
  const port = await dbCfg("mail.smtp_port");
  const from = await dbCfg("mail.smtp_from");
  if (!host || !port || !from) return null;
  return {
    host,
    port: parseInt(port, 10),
    user: await dbCfg("mail.smtp_user"),
    pass: await dbCfg("mail.smtp_pass"),
    from,
    secure: (await dbCfg("mail.smtp_secure")) === "true",
    source: "db",
  };
}

function transporter(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass || "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
}

type Delivery = { status: MailStatus; error?: string; messageId?: string };

/** Real SMTP delivery. Never throws — failures come back as FAILED. */
async function deliver(cfg: SmtpConfig, mail: { to: string; subject: string; body: string }): Promise<Delivery> {
  try {
    const info = await transporter(cfg).sendMail({
      from: cfg.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.body,
    });
    return { status: "SENT", messageId: info.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "FAILED", error: msg.slice(0, 300) };
  }
}

export async function sendMail(opts: {
  toEmail: string;
  subject: string;
  body: string;
  category?: string;
  actor?: string;
}): Promise<{ id: string; status: MailStatus }> {
  const cfg = await resolveSmtpConfig();
  const delivery: Delivery = cfg
    ? await deliver(cfg, { to: opts.toEmail, subject: opts.subject, body: opts.body })
    : { status: "SIMULATED" };

  const row = await db.mailLog.create({
    data: {
      toEmail: opts.toEmail,
      subject: opts.subject,
      body: opts.body,
      category: opts.category || "system",
      status: delivery.status,
    },
  });

  await writeAudit({
    actor: opts.actor || "system",
    action: "MAIL_SENT",
    resource: `mail:${row.id}`,
    detail: `to=${opts.toEmail} provider=${cfg ? `${cfg.source}:smtp` : "simulated"} status=${delivery.status}${delivery.error ? ` error="${delivery.error}"` : ""} subject="${opts.subject.slice(0, 60)}"`,
  });

  return { id: row.id, status: delivery.status };
}

/** Owner-facing wiring check: send a test mail through the configured SMTP. */
export async function testSmtp(opts: { toEmail: string; actor: string }): Promise<
  { ok: true; status: MailStatus; mailId: string; transport: string } | { error: string }
> {
  const cfg = await resolveSmtpConfig();
  if (!cfg) return { error: "SMTP not configured — set host, port and from first (mail.provider stays simulated)" };
  const res = await sendMail({
    toEmail: opts.toEmail,
    subject: "VORTEX — SMTP wiring test",
    body: [
      "This is a wiring test from the VORTEX control plane.",
      "",
      `Transport : SMTP ${cfg.host}:${cfg.port} (secure=${cfg.secure}, source=${cfg.source})`,
      `Triggered by: ${opts.actor}`,
      "",
      "If you can read this in a real inbox, OTP mails will reach it too.",
    ].join("\n"),
    category: "system",
    actor: opts.actor,
  });
  return { ok: true, status: res.status, mailId: res.id, transport: `smtp:${cfg.source}` };
}

/** Send a mail from a template, rendering {{vars}}. */
export async function sendFromTemplate(opts: {
  templateKey: string;
  toEmail: string;
  vars?: Record<string, string>;
  actor?: string;
}): Promise<{ id: string; status: MailStatus } | { error: string }> {
  const tpl = await db.mailTemplate.findUnique({ where: { key: opts.templateKey } });
  if (!tpl) return { error: `Template "${opts.templateKey}" not found` };
  if (!tpl.enabled) return { error: `Template "${opts.templateKey}" is disabled` };
  const vars = opts.vars || {};
  return sendMail({
    toEmail: opts.toEmail,
    subject: renderTemplate(tpl.subject, vars),
    body: renderTemplate(tpl.body, vars),
    category: tpl.category,
    actor: opts.actor,
  });
}

/** Retry a FAILED mail (re-send with the current provider). */
export async function retryMail(id: string, actor: string): Promise<{ status: MailStatus } | { error: string }> {
  const row = await db.mailLog.findUnique({ where: { id } });
  if (!row) return { error: "Mail not found" };
  if (row.status === "SENT") return { error: "Mail already delivered" };
  const cfg = await resolveSmtpConfig();
  const delivery: Delivery = cfg
    ? await deliver(cfg, { to: row.toEmail, subject: row.subject, body: row.body })
    : { status: "SIMULATED" };
  await db.mailLog.update({ where: { id }, data: { status: delivery.status } });
  await writeAudit({
    actor,
    action: "MAIL_RETRIED",
    resource: `mail:${id}`,
    detail: `provider=${cfg ? `${cfg.source}:smtp` : "simulated"} status=${delivery.status}${delivery.error ? ` error="${delivery.error}"` : ""}`,
  });
  return { status: delivery.status };
}

export async function mailStats() {
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const [total, sent24h, byStatus, byCategory] = await Promise.all([
    db.mailLog.count(),
    db.mailLog.count({ where: { createdAt: { gte: since24h } } }),
    db.mailLog.groupBy({ by: ["status"], _count: true }),
    db.mailLog.groupBy({ by: ["category"], _count: true }),
  ]);
  return {
    total,
    last24h: sent24h,
    byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count])),
    byCategory: Object.fromEntries(byCategory.map((g) => [g.category, g._count])),
  };
}
