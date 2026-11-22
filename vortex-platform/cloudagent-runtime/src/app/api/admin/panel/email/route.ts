/**
 * v134 — ADMIN CONTROL ROOM · Email system API (owner request).
 * Double-gated like every other panel route (admin session + unlock).
 *
 * GET                    → smtp status (masked), outbox stats + latest rows
 * POST {action:...}
 *   save-smtp            → store SMTP credentials (KV; e.g. Gmail app password)
 *   clear-smtp           → forget stored credentials
 *   test      {to}       → send a branded test email
 *   send                 → broadcast: {to} one user | {all:true} everyone | {plan} one plan's users
 *   retry     {id}       → resend one queued/failed row now
 *   flush                → resend ALL queued/failed rows (up to 100)
 *   delete    {id}       → remove an outbox row
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminUnlocked } from '@/lib/admin-lock'
import {
  getSmtpConfig,
  saveSmtpConfig,
  maskSmtp,
  sendEmail,
  flushOutbox,
  SmtpConfig,
} from '@/lib/email'

export async function GET(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }

  const [cfg, queued, sent, failed] = await Promise.all([
    getSmtpConfig(),
    db.emailLog.count({ where: { status: 'queued' } }),
    db.emailLog.count({ where: { status: 'sent' } }),
    db.emailLog.count({ where: { status: 'failed' } }),
  ])
  const rows = await db.emailLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
  const users = await db.authUser.count({ where: { status: 'active' } })

  return NextResponse.json({
    ok: true,
    smtp: maskSmtp(cfg),
    stats: { queued, sent, failed, users },
    rows: rows.map((r) => ({
      id: r.id,
      to: r.to,
      kind: r.kind,
      subject: r.subject,
      status: r.status,
      error: r.error,
      attempts: r.attempts,
      createdAt: r.createdAt,
      sentAt: r.sentAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const action = String(body?.action || '')

  // ── SMTP credentials ──
  if (action === 'save-smtp') {
    const host = String(body?.host || '').trim()
    const user = String(body?.user || '').trim()
    const pass = String(body?.pass || '')
    const port = Math.max(1, Math.min(65535, Number(body?.port || 465)))
    const secure = body?.secure === false ? false : true
    const from = String(body?.from || '').trim() || `CloudAgent <${user}>`
    if (!host || !user || !pass) {
      return NextResponse.json({ ok: false, error: 'host, user and password are all required' }, { status: 400 })
    }
    const cfg: SmtpConfig = { host, port, secure, user, pass, from }
    await saveSmtpConfig(cfg)
    // live probe — prove the credentials work before saying "saved"
    try {
      const nm = await import('nodemailer')
      const t = ((nm as any).default ?? nm).createTransport({ ...cfg, connectionTimeout: 15_000 })
      await t.verify()
      return NextResponse.json({ ok: true, message: `SMTP saved and verified ✓ (${host}:${port})` })
    } catch (e: any) {
      return NextResponse.json({
        ok: true,
        warning: `Saved, but the connection test failed: ${String(e?.message || e).slice(0, 300)}`,
      })
    }
  }

  if (action === 'clear-smtp') {
    await db.userSetting.deleteMany({ where: { key: 'email.smtp' } })
    return NextResponse.json({ ok: true, message: 'SMTP credentials cleared.' })
  }

  // ── test email ──
  if (action === 'test') {
    const to = String(body?.to || '').trim()
    if (!to) return NextResponse.json({ ok: false, error: 'to: address required' }, { status: 400 })
    const r = await sendEmail({
      to,
      kind: 'test',
      subject: 'CloudAgent test email ⚡',
      html: `<!doctype html><body style="font-family:Arial,sans-serif;background:#0b0b10;color:#e5e5ee;padding:40px;"><h2 style="color:#a78bfa;">⚡ CloudAgent</h2><p>If you can read this, your SMTP is working — payment & welcome emails will reach users.</p></body>`,
    })
    if (r.status === 'sent') return NextResponse.json({ ok: true, message: `Test email sent to ${to} ✓` })
    if (r.status === 'queued')
      return NextResponse.json({
        ok: true,
        warning: 'No SMTP configured yet — the test email is queued in the outbox. Save SMTP credentials, then Flush.',
      })
    return NextResponse.json({ ok: false, error: 'send failed — check credentials / app password' }, { status: 502 })
  }

  // ── broadcast ──
  if (action === 'send') {
    const subject = String(body?.subject || '').trim()
    const text = String(body?.body || '').trim()
    if (!subject || !text) {
      return NextResponse.json({ ok: false, error: 'subject and body are required' }, { status: 400 })
    }
    const html = text
      .split(/\n{2,}/)
      .map((p: string) => `<p style="color:#c9c9d4;line-height:1.7;margin:0 0 12px;">${p.replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</p>`)
      .join('')
    let recipients: { id: string; email: string }[] = []
    if (body?.to) {
      const u = await db.authUser.findUnique({ where: { email: String(body.to).trim().toLowerCase() }, select: { id: true, email: true } })
      if (!u) return NextResponse.json({ ok: false, error: 'no user with that email' }, { status: 404 })
      recipients = [u]
    } else {
      const where: any = { status: 'active' }
      if (body?.plan) where.plan = String(body.plan)
      recipients = await db.authUser.findMany({ where, select: { id: true, email: true }, take: 500 })
    }
    if (!recipients.length) return NextResponse.json({ ok: false, error: 'no recipients matched' }, { status: 400 })
    let sent = 0
    let queued = 0
    for (const u of recipients) {
      const r = await sendEmail({ to: u.email, userId: u.id, kind: body?.to ? 'custom' : 'broadcast', subject, html })
      if (r.status === 'sent') sent++
      else queued++
    }
    const cfg = await getSmtpConfig()
    return NextResponse.json({
      ok: true,
      message: cfg
        ? `Sent to ${sent} recipient(s)${queued ? `, ${queued} queued (retry via Flush)` : ''}.`
        : `No SMTP configured — ${recipients.length} email(s) queued in the outbox. Add SMTP credentials and hit Flush to deliver.`,
    })
  }

  // ── outbox maintenance ──
  if (action === 'retry') {
    const id = String(body?.id || '')
    const row = await db.emailLog.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ ok: false, error: 'email row not found' }, { status: 404 })
    const cfg = await getSmtpConfig()
    if (!cfg) return NextResponse.json({ ok: false, error: 'SMTP not configured — save credentials first' }, { status: 400 })
    try {
      const nm = await import('nodemailer')
      const t = ((nm as any).default ?? nm).createTransport({ ...cfg, connectionTimeout: 15_000 })
      await t.sendMail({ from: cfg.from, to: row.to, subject: row.subject, html: row.body })
      await db.emailLog.update({
        where: { id },
        data: { status: 'sent', provider: 'smtp', sentAt: new Date(), error: null, attempts: { increment: 1 } },
      })
      return NextResponse.json({ ok: true, message: `Resent to ${row.to} ✓` })
    } catch (e: any) {
      await db.emailLog.update({
        where: { id },
        data: { status: 'failed', error: String(e?.message || e).slice(0, 500), attempts: { increment: 1 } },
      })
      return NextResponse.json({ ok: false, error: `resend failed: ${String(e?.message || e).slice(0, 200)}` }, { status: 502 })
    }
  }

  if (action === 'flush') {
    const r = await flushOutbox(100)
    if (!r.sent && !r.failed)
      return NextResponse.json({ ok: false, error: 'SMTP not configured — save credentials first' }, { status: 400 })
    return NextResponse.json({ ok: true, message: `Outbox flushed — ${r.sent} sent, ${r.failed} failed.` })
  }

  if (action === 'delete') {
    await db.emailLog.delete({ where: { id: String(body?.id || '') } }).catch(() => {})
    return NextResponse.json({ ok: true, message: 'Removed.' })
  }

  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
}
