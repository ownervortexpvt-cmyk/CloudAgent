/**
 * v129 — POST /api/billing/upi/submit → UPI-direct payment proof submission.
 *
 * The user pays the owner's UPI ID (QR / deep link on the pricing page), then
 * submits the 12-char UTR + optional screenshot. The row lands in the admin
 * control-room queue with an AI verdict attached. Nothing is auto-activated —
 * approval is always a human (admin) action.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getPlan } from '@/lib/plans'
import { looksLikeUtr, upiOrderId, UPI_SCREENSHOT_MAX_CHARS } from '@/lib/upi'
import { verifyUpiSubmission } from '@/lib/upi-ai'
import { sendEmail, tplPaymentSubmitted } from '@/lib/email'

export async function POST(req: NextRequest) {
  // v160 — UPI-direct payments RETIRED (owner request: "shob jaygay UPI shoriye
  // razorpay add koro"). Razorpay checkout (which itself accepts UPI, cards,
  // netbanking) is the only payment path now. Keep the old admin queue data.
  return NextResponse.json(
    { ok: false, error: 'UPI-direct payments are retired — please pay with Razorpay on the pricing page (UPI, card, netbanking all supported there).' },
    { status: 410 },
  )
}

async function legacySubmitUnused(req: NextRequest) {
  const rl = rateLimit(req, 'upi-submit', 10)
  if (!rl.ok) return rateLimitResponse(rl) as any

  let user
  try {
    user = await requireUser(req)
  } catch (e: any) {
    if (e instanceof Response) return e
    throw e
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const planId = String(body?.planId || '')
  const utr = String(body?.utr || '').trim()
  const note = String(body?.note || '').slice(0, 300)
  const screenshot = typeof body?.screenshot === 'string' ? body.screenshot : ''

  const plan = getPlan(planId)
  if (!plan || plan.priceINR <= 0) {
    return NextResponse.json({ ok: false, error: 'choose a paid plan first' }, { status: 400 })
  }
  if (!looksLikeUtr(utr)) {
    return NextResponse.json(
      { ok: false, error: 'UTR must be the 12-letter/digit reference number from your UPI app' },
      { status: 400 }
    )
  }
  if (screenshot) {
    if (!screenshot.startsWith('data:image/')) {
      return NextResponse.json({ ok: false, error: 'screenshot must be an image' }, { status: 400 })
    }
    if (screenshot.length > UPI_SCREENSHOT_MAX_CHARS) {
      return NextResponse.json({ ok: false, error: 'screenshot too large (max ~1.2MB)' }, { status: 413 })
    }
  }

  // one UTR can only ever be used once
  const dup = await db.payment.findFirst({
    where: { utr, status: { in: ['created', 'paid'] } },
    select: { id: true },
  })
  if (dup) {
    return NextResponse.json(
      { ok: false, error: 'this UTR was already submitted — each payment has its own UTR' },
      { status: 409 }
    )
  }

  const payment = await db.payment.create({
    data: {
      userId: user.id,
      plan: plan.id,
      kind: 'monthly',
      amount: plan.priceINR * 100, // paise — same unit Razorpay uses
      method: 'upi_direct',
      razorpayOrderId: upiOrderId(),
      status: 'created',
      utr,
      screenshot: screenshot || null,
    },
  })

  let ai: any = null
  try {
    const verdict = await verifyUpiSubmission({
      utr,
      amountINR: plan.priceINR,
      planId: plan.id,
      userId: user.id,
      userCreatedAt: (user as any)?.createdAt ?? null,
      screenshot: screenshot || null,
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
    ai = verdict
  } catch {
    ai = null // AI hiccup must never block the submission itself
  }

  // v134 — confirmation email: "we got your proof, it's under review"
  try {
    await sendEmail({
      to: user.email,
      userId: user.id,
      kind: 'payment_submitted',
      ...tplPaymentSubmitted(plan.name, plan.priceINR, utr.toUpperCase()),
    })
  } catch { /* email must never break submission */ }

  return NextResponse.json({
    ok: true,
    paymentId: payment.id,
    ai,
    message:
      'Payment proof received — the admin will verify it shortly. Your plan activates automatically once approved.',
  })
}
