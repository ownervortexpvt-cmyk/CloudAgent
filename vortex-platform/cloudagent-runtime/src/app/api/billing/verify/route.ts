/**
 * v110 — POST /api/billing/verify → Razorpay checkout callback verification.
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Verifies HMAC(order|payment, key_secret) then activates the plan.
 * Idempotent: the webhook may have already activated — returns alreadyActive.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { getRazorpayConfig, verifyCheckoutSignature, activatePurchase, fetchRazorpayPayment } from '@/lib/razorpay'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export async function POST(req: NextRequest) {
  // v115 ultra-security: verify-replay hammering guard (20/min/ip)
  const rl = rateLimit(req, 'billing-verify', 20)
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

  const orderId = String(body?.razorpay_order_id || '')
  const paymentId = String(body?.razorpay_payment_id || '')
  const signature = String(body?.razorpay_signature || '')
  if (!orderId || !paymentId || !signature) {
    return NextResponse.json({ ok: false, error: 'missing payment confirmation fields' }, { status: 400 })
  }

  const cfg = await getRazorpayConfig()
  if (cfg.source === 'none') {
    return NextResponse.json({ ok: false, error: 'Payments are not configured yet.' }, { status: 503 })
  }

  const payment = await db.payment.findUnique({ where: { razorpayOrderId: orderId } })
  if (!payment) return NextResponse.json({ ok: false, error: 'unknown order' }, { status: 404 })
  if (payment.userId !== user.id && user.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'this order belongs to another account' }, { status: 403 })
  }

  if (!verifyCheckoutSignature(cfg, orderId, paymentId, signature)) {
    // only a still-unpaid order can be downgraded — never overwrite a real
    // paid payment's status because someone posted a bad signature later
    if (payment.status === 'created') {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', failureReason: 'checkout signature mismatch' },
      }).catch(() => {})
    }
    return NextResponse.json({ ok: false, error: 'signature verification failed — payment NOT activated' }, { status: 400 })
  }

  // enrich with the payment method (UPI / card / …) — best effort
  let method: string | undefined
  const entity = await fetchRazorpayPayment(cfg, paymentId)
  method = entity?.method || undefined

  const { activated } = await activatePurchase(
    { id: payment.id, userId: payment.userId, plan: payment.plan, kind: payment.kind, status: payment.status, razorpayPaymentId: payment.razorpayPaymentId },
    method
  )
  await db.payment.update({
    where: { id: payment.id },
    data: { razorpayPaymentId: paymentId, razorpaySignature: signature },
  }).catch(() => {})

  return NextResponse.json({
    ok: true,
    activated,
    alreadyActive: !activated,
    plan: payment.plan,
    kind: payment.kind,
  })
}
