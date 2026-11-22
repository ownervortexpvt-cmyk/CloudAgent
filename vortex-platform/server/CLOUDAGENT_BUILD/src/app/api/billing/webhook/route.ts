/**
 * v110 — POST /api/billing/webhook → Razorpay server-to-server events.
 * PUBLIC path (Razorpay's servers can't send session cookies) but EVERY call
 * is verified with HMAC(raw body, webhook_secret) — fail closed.
 *
 * Configure in the Razorpay Dashboard → Webhooks:
 *   URL: https://<your-domain>/api/billing/webhook
 *   Secret: the same secret the admin saves in Settings → Payments
 *   Events: payment.captured, order.paid, refund.processed
 *
 * Idempotent: duplicate deliveries are absorbed by activatePurchase().
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getRazorpayConfig, verifyWebhookSignature, activatePurchase } from '@/lib/razorpay'

export async function POST(req: NextRequest) {
  const raw = await req.text()

  const cfg = await getRazorpayConfig()
  if (!cfg.webhookSecret) {
    return NextResponse.json({ ok: false, error: 'webhook not configured' }, { status: 503 })
  }
  if (!verifyWebhookSignature(cfg, raw, req.headers.get('x-razorpay-signature'))) {
    return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 400 })
  }

  let event: any
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 })
  }

  const type = String(event?.event || '')
  const paymentEntity = event?.payload?.payment?.entity
  const orderEntity = event?.payload?.order?.entity

  try {
    if ((type === 'payment.captured' || type === 'order.paid') && (paymentEntity || orderEntity)) {
      const orderId = paymentEntity?.order_id || orderEntity?.id
      const paymentId = paymentEntity?.id || null
      const method = paymentEntity?.method || undefined
      if (orderId) {
        const local = await db.payment.findUnique({ where: { razorpayOrderId: orderId } })
        if (local && local.status !== 'paid') {
          await activatePurchase(
            { id: local.id, userId: local.userId, plan: local.plan, kind: local.kind, status: local.status, razorpayPaymentId: local.razorpayPaymentId },
            method
          )
          if (paymentId) {
            await db.payment.update({
              where: { id: local.id },
              data: { razorpayPaymentId: paymentId },
            }).catch(() => {})
          }
        }
      }
    }

    if (type === 'payment.failed' && paymentEntity?.order_id) {
      const local = await db.payment.findUnique({ where: { razorpayOrderId: paymentEntity.order_id } })
      if (local && local.status === 'created') {
        await db.payment.update({
          where: { id: local.id },
          data: { status: 'failed', failureReason: String(paymentEntity?.error_description || 'payment failed') },
        }).catch(() => {})
      }
    }

    if (type === 'refund.processed' && paymentEntity?.id) {
      // honest books: mark refunded; the plan itself keeps running until its
      // natural expiry (cancellation/refund policy lives in /refund).
      await db.payment.updateMany({
        where: { razorpayPaymentId: paymentEntity.id, status: 'paid' },
        data: { status: 'refunded' },
      })
    }
  } catch (err: any) {
    // never 500 to Razorpay on internal hiccups — it would retry-storm; log it
    console.error('[billing/webhook] handler error:', err?.message || err)
  }

  return NextResponse.json({ ok: true })
}
