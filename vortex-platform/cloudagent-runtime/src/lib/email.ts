/**
 * v134 — EMAIL SYSTEM (owner request: "email system shoriye din").
 *
 * Outbox-first design: every email the platform composes is persisted in the
 * EmailLog table, THEN delivery is attempted. If SMTP credentials are not
 * configured yet, rows stay 'queued' — nothing is lost — and the admin can
 * flush them later with one click after adding SMTP (e.g. a Gmail app
 * password) in the admin panel's Email tab.
 *
 * Templates cover the full user lifecycle: welcome, UPI payment received,
 * payment approved (plan activated) and payment rejected (with reason).
 * The admin can also broadcast to all users or a single plan's users.
 */
import { db } from '@/lib/db'

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string // e.g. "CloudAgent <owner@gmail.com>"
}

const SMTP_KEY = 'email.smtp' // stored in userSetting KV as JSON

/** Read SMTP config (KV first, then env fallback). Password never leaves the server except masked. */
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  try {
    const row = await db.userSetting.findUnique({ where: { key: SMTP_KEY } })
    if (row?.value) {
      const cfg = JSON.parse(row.value) as SmtpConfig
      if (cfg?.host && cfg?.user && cfg?.pass) return cfg
    }
  } catch {
    /* fall through to env */
  }
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (host && user && pass) {
    return {
      host,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE ?? 'true') !== 'false',
      user,
      pass,
      from: process.env.SMTP_FROM || `CloudAgent <${user}>`,
    }
  }
  return null
}

export async function saveSmtpConfig(cfg: SmtpConfig): Promise<void> {
  const value = JSON.stringify(cfg)
  await db.userSetting.upsert({ where: { key: SMTP_KEY }, update: { value }, create: { key: SMTP_KEY, value } })
}

export function maskSmtp(cfg: SmtpConfig | null) {
  if (!cfg) return null
  return {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    from: cfg.from,
    passSet: true,
    configured: true as const,
  }
}

/** Lazy nodemailer import keeps the module light when SMTP is unused. */
async function transport(cfg: SmtpConfig) {
  const nm = await import('nodemailer')
  const t = (nm as any).default ?? nm
  return t.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
}

export interface SendEmailOpts {
  to: string
  subject: string
  html: string
  kind?: string
  userId?: string | null
}

/**
 * Persist-then-send. Never throws — email problems must never break the
 * user flow that triggered it (registration, payment, admin actions).
 */
export async function sendEmail(opts: SendEmailOpts): Promise<{ id: string; ok: boolean; status: string }> {
  const row = await db.emailLog.create({
    data: {
      to: opts.to,
      userId: opts.userId || null,
      kind: opts.kind || 'custom',
      subject: opts.subject.slice(0, 300),
      body: opts.html,
      status: 'queued',
    },
  })

  const cfg = await getSmtpConfig()
  if (!cfg) return { id: row.id, ok: false, status: 'queued' }

  try {
    const tx = await transport(cfg)
    await tx.sendMail({
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    })
    await db.emailLog.update({
      where: { id: row.id },
      data: { status: 'sent', provider: 'smtp', sentAt: new Date(), attempts: { increment: 1 } },
    })
    return { id: row.id, ok: true, status: 'sent' }
  } catch (e: any) {
    await db.emailLog.update({
      where: { id: row.id },
      data: { status: 'failed', error: String(e?.message || e).slice(0, 500), attempts: { increment: 1 } },
    })
    return { id: row.id, ok: false, status: 'failed' }
  }
}

/** Retry every queued/failed row (admin "Flush outbox" button). */
export async function flushOutbox(limit = 50): Promise<{ sent: number; failed: number }> {
  const cfg = await getSmtpConfig()
  if (!cfg) return { sent: 0, failed: 0 }
  const rows = await db.emailLog.findMany({
    where: { status: { in: ['queued', 'failed'] } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  let sent = 0
  let failed = 0
  for (const r of rows) {
    try {
      const tx = await transport(cfg)
      await tx.sendMail({ from: cfg.from, to: r.to, subject: r.subject, html: r.body })
      await db.emailLog.update({
        where: { id: r.id },
        data: { status: 'sent', provider: 'smtp', sentAt: new Date(), error: null, attempts: { increment: 1 } },
      })
      sent++
    } catch (e: any) {
      await db.emailLog.update({
        where: { id: r.id },
        data: { status: 'failed', error: String(e?.message || e).slice(0, 500), attempts: { increment: 1 } },
      })
      failed++
    }
  }
  return { sent, failed }
}

// ─── Templates ────────────────────────────────────────────────────────────────

function wrap(title: string, inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0b0b10;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;">
  <div style="font-size:20px;font-weight:800;color:#fff;margin-bottom:4px;">⚡ <span style="color:#a78bfa">Cloud</span>Agent</div>
  <div style="font-size:12px;color:#8b8b96;margin-bottom:24px;">Don't prompt a chatbot. Command an army of agents.</div>
  <div style="background:#13131a;border:1px solid #26262f;border-radius:16px;padding:28px;">
    <h1 style="margin:0 0 14px;font-size:20px;color:#fff;">${title}</h1>
    ${inner}
  </div>
  <div style="margin-top:20px;font-size:11px;color:#6b6b76;line-height:1.6;">
    CloudAgent · AI app-builder platform · Bengaluru, India<br/>
    You received this because an account on CloudAgent uses this email address.
  </div>
</div>
</body></html>`
}

const OK = `style="display:inline-block;background:#10b981;color:#04120c;font-weight:700;padding:10px 18px;border-radius:10px;text-decoration:none;margin-top:14px;"`
const INR = (n: number) => '₹' + n.toLocaleString('en-IN')

export function tplWelcome(name: string): { subject: string; html: string } {
  const who = name ? `, ${name}` : ''
  return {
    subject: 'Welcome to CloudAgent ⚡',
    html: wrap(
      `Welcome aboard${who}!`,
      `<p style="color:#c9c9d4;line-height:1.7;margin:0 0 12px;">Your free account is live. You get <b style="color:#fff">1 project, 10 AI runs and a 2-agent swarm</b> every month — plus full Pro power during Big Billion Day (1st of every month, 8 AM–12 PM IST).</p>
       <p style="color:#c9c9d4;line-height:1.7;margin:0;">Describe an app in plain language and your agent army plans, codes, tests and ships it. Need more power? Upgrade to Pro from ₹1,999/mo — pay by UPI and it activates after a quick verification.</p>`
    ),
  }
}

export function tplPaymentSubmitted(planName: string, amountINR: number, utr: string): { subject: string; html: string } {
  return {
    subject: `Payment received — ${planName} under review`,
    html: wrap(
      'Payment proof received ✅',
      `<p style="color:#c9c9d4;line-height:1.7;margin:0 0 12px;">We got your UPI payment details for <b style="color:#fff">${planName} (${INR(amountINR)}/mo)</b>.</p>
       <p style="color:#c9c9d4;line-height:1.7;margin:0 0 6px;">UTR reference: <b style="color:#a78bfa;font-family:monospace">${utr}</b></p>
       <p style="color:#c9c9d4;line-height:1.7;margin:0;">Our team verifies payments quickly — usually within a few hours. Your plan activates automatically the moment it's approved, and you'll get a confirmation email here.</p>`
    ),
  }
}

export function tplPaymentApproved(planName: string, amountINR: number): { subject: string; html: string } {
  return {
    subject: `🎉 Payment verified — ${planName} is active!`,
    html: wrap(
      'Payment verified 🎉',
      `<p style="color:#c9c9d4;line-height:1.7;margin:0 0 12px;">Your payment of <b style="color:#fff">${INR(amountINR)}</b> is verified and your <b style="color:#10b981">${planName}</b> plan is now <b style="color:#10b981">ACTIVE</b> for the next 30 days.</p>
       <p style="color:#c9c9d4;line-height:1.7;margin:0;">Sign in and start building — bigger swarms, more runs, more tokens are all unlocked. Welcome to the fast lane ⚡</p>
       <a href="#" ${OK}>Open CloudAgent →</a>`
    ),
  }
}

export function tplPaymentRejected(planName: string, amountINR: number, reason: string): { subject: string; html: string } {
  return {
    subject: `Payment could not be verified — ${planName}`,
    html: wrap(
      'Payment could not be verified',
      `<p style="color:#c9c9d4;line-height:1.7;margin:0 0 12px;">We couldn't verify your UPI payment of <b style="color:#fff">${INR(amountINR)}</b> for ${planName}.</p>
       ${reason ? `<p style="color:#f87171;line-height:1.7;margin:0 0 12px;"><b>Reason:</b> ${reason}</p>` : ''}
       <p style="color:#c9c9d4;line-height:1.7;margin:0;">If you believe this is a mistake, reply to this email with your UTR number and payment screenshot — we'll re-check it. You can also submit a fresh proof from the pricing page anytime.</p>`
    ),
  }
}
