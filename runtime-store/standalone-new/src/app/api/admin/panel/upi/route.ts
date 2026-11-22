/**
 * v129 — ADMIN CONTROL ROOM · UPI verify queue.
 * Double-gated exactly like the other panel routes (admin session + unlock).
 *
 * GET                → upi_direct payment rows + queue stats
 * GET  ?screenshot=id → the stored screenshot data URL for one row
 * POST {id, action}   → approve | reject | ai (re-run AI check)
 *
 * Approve reuses activatePurchase() — the SAME plan-activation path Razorpay
 * uses (30-day rolling subscription, renewal extends from current expiry).
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminUnlocked } from '@/lib/admin-lock'
import { activatePurchase } from '@/lib/razorpay'
import { verifyUpiSubmission } from '@/lib/upi-ai'
import { sendEmail, tplPaymentApproved, tplPaymentRejected } from '@/lib/email'

export async function GET(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }

  const url = new URL(req.url)
  const shotId = url.searchParams.get('screenshot')
  if (shotId) {
    const row = await db.payment.findUnique({ where: { id: shotId }, select: { screenshot: true } })
    return NextResponse.json({ ok: true, screenshot: row?.screenshot || null })
  }

  const rows = await db.payment.findMany({
    where: { method: 'upi_direct' },
    orderBy: { createdAt: 'desc' },
    take: 120,
    include: { user: { select: { email: true, name: true } } },
  })

  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000)
  const [pending, approvedToday, rejectedToday] = await Promise.all([
    db.payment.count({ where: { method: 'upi_direct', status: 'created' } }),
    db.payment.count({ where: { method: 'upi_direct', status: 'paid', reviewedAt: { gte: dayAgo } } }),
    db.payment.count({ where: { method: 'upi_direct', status: 'failed', reviewedAt: { gte: dayAgo } } }),
  ])
  const approvedRows = await db.payment.findMany({
    where: { method: 'upi_direct', status: 'paid' },
    select: { amount: true },
  })
  const totalApprovedINR = approvedRows.reduce((s, r) => s + r.amount, 0) / 100

  return NextResponse.json({
    ok: true,
    stats: { pending, approvedToday, rejectedToday, totalApprovedINR },
    rows: rows.map((r) => ({
      id: r.id,
      email: r.user?.email || '—',
      name: r.user?.name || '',
      plan: r.plan,
      amountINR: r.amount / 100,
      utr: r.utr || '',
      status: r.status,
      aiScore: r.aiScore,
      aiVerdict: r.aiVerdict,
      aiReason: r.aiReason,
      adminNote: r.adminNote,
      hasScreenshot: Boolean(r.screenshot),
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
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

  const id = String(body?.id || '')
  const action = String(body?.action || '')
  const note = String(body?.note || '').slice(0, 300)
  if (!id || !['approve', 'reject', 'ai'].includes(action)) {
    return NextResponse.json({ ok: false, error: 'expected { id, action: approve|reject|ai }' }, { status: 400 })
  }

  const payment = await db.payment.findUnique({ where: { id }, include: { user: true } })
  if (!payment || payment.method !== 'upi_direct') {
    return NextResponse.json({ ok: false, error: 'payment not found' }, { status: 404 })
  }

  if (action === 'approve') {
    if (payment.status === 'paid') {
      return NextResponse.json({ ok: true, alreadyActive: true, message: 'Already approved and active.' })
    }
    if (payment.status !== 'created') {
      return NextResponse.json({ ok: false, error: `cannot approve a ${payment.status} payment` }, { status: 400 })
    }
    const r = await activatePurchase(payment as any, 'upi_direct')
    await db.payment.update({
      where: { id: payment.id },
      data: { reviewedAt: new Date(), adminNote: note || payment.adminNote },
    })
    // v134 — the "you're in!" email
    if (r.activated && payment.user?.email) {
      try {
        await sendEmail({
          to: payment.user.email,
          userId: payment.userId,
          kind: 'payment_approved',
          ...tplPaymentApproved(payment.plan, Math.round(payment.amount / 100)),
        })
      } catch { /* never blocks approval */ }
    }
    return NextResponse.json({
      ok: true,
      activated: r.activated,
      message: `Approved — ${payment.plan} is now active for ${payment.user?.email || payment.userId}.`,
    })
  }

  if (action === 'reject') {
    if (payment.status === 'paid') {
      return NextResponse.json({ ok: false, error: 'already paid — revoke via users panel instead' }, { status: 400 })
    }
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: 'failed',
        failureReason: note || 'rejected by admin',
        reviewedAt: new Date(),
        adminNote: note || payment.adminNote,
      },
    })
    // v134 — polite rejection email with the reason + next steps
    if (payment.user?.email) {
      try {
        await sendEmail({
          to: payment.user.email,
          userId: payment.userId,
          kind: 'payment_rejected',
          ...tplPaymentRejected(payment.plan, Math.round(payment.amount / 100), note || ''),
        })
      } catch { /* never blocks rejection */ }
    }
    return NextResponse.json({ ok: true, message: 'Rejected.' })
  }

  // action === 'ai' → re-run the AI check with everything we know now
  const verdict = await verifyUpiSubmission({
    utr: payment.utr || '',
    amountINR: payment.amount / 100,
    planId: payment.plan,
    userId: payment.userId,
    userCreatedAt: (payment.user as any)?.createdAt ?? null,
    screenshot: payment.screenshot,
    excludePaymentId: payment.id,
  })
  await db.payment.update({
    where: { id: payment.id },
    data: {
      aiScore: verdict.score,
      aiVerdict: verdict.verdict,
      aiReason: verdict.reasons.join(' | ').slice(0, 900),
    },
  })
  return NextResponse.json({ ok: true, ai: verdict })
}
