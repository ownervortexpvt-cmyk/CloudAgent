/**
 * v110 — POST /api/billing/order → create a Razorpay order for a plan.
 * Body: { plan: 'pro'|'pro_plus'|'ultra'|'pro_max'|'ultra_pro_max',
 *         kind: 'monthly' }
 * Returns the checkout payload; the browser opens Razorpay with it.
 * 503 { code: 'keys_missing' } until the owner configures Razorpay keys.
 * v111 — lifetime is RETIRED: kind='lifetime' is rejected outright (410).
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { PLANS, getPlan } from '@/lib/plans'
import { getRazorpayConfig, createRazorpayOrder } from '@/lib/razorpay'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'

export async function POST(req: NextRequest) {
  // v115 ultra-security: order-spam guard (12/min/ip)
  const rl = rateLimit(req, 'billing-order', 12)
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

  const kind = 'monthly'
  if (body?.kind === 'lifetime') {
    // v111: the owner retired lifetime access — subscriptions only, ever.
    return NextResponse.json(
      { ok: false, code: 'lifetime_retired', error: 'Lifetime plans are no longer offered — please pick a monthly plan.' },
      { status: 410 }
    )
  }
  const planId = String(body?.plan || '')

  let plan = planId
  let amountINR: number
  const p = PLANS[planId as keyof typeof PLANS]
  if (!p || p.priceINR <= 0) {
    return NextResponse.json({ ok: false, error: 'A valid paid plan is required.' }, { status: 400 })
  }
  amountINR = p.priceINR

  const cfg = await getRazorpayConfig()
  if (cfg.source === 'none') {
    return NextResponse.json(
      { ok: false, code: 'keys_missing', error: 'Online payments are being configured. Please check back shortly.' },
      { status: 503 }
    )
  }

  const amountPaise = amountINR * 100
  const receipt = `ca_${Date.now().toString(36)}${user.id.slice(-4)}`

  try {
    const order = await createRazorpayOrder(cfg, {
      amountPaise,
      receipt,
      notes: { userId: user.id, email: user.email, plan, kind },
    })
    await db.payment.create({
      data: {
        userId: user.id,
        plan,
        kind,
        amount: amountPaise,
        status: 'created',
        razorpayOrderId: order.id,
      },
    })
    return NextResponse.json({
      ok: true,
      orderId: order.id,
      amount: order.amount,
      keyId: cfg.keyId,
      plan,
      kind,
      planName: getPlan(plan).name,
    })
  } catch (err: any) {
    console.error('[billing/order]', err?.message || err)
    return NextResponse.json(
      { ok: false, error: 'Payment gateway error — please try again in a minute.' },
      { status: 502 }
    )
  }
}
