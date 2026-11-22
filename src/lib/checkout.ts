'use client'

/**
 * v110 — client-side Razorpay checkout (loads the official checkout.js ON
 * DEMAND — zero cost on pages that never open payment, keeping the app fast).
 *
 * Flow: POST /api/billing/order → open Razorpay modal → user pays (UPI /
 * card / netbanking / wallet) → handler POSTs /api/billing/verify →
 * server verifies HMAC and activates the plan instantly.
 */

export type CheckoutKind = 'monthly' // v111: lifetime retired — subscriptions only

export interface CheckoutResult {
  ok: boolean
  error?: string
  plan?: string
  kind?: CheckoutKind
  alreadyActive?: boolean
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true)
    const existing = document.querySelector('script[data-rzp-checkout]')
    if (existing) {
      existing.addEventListener('load', () => resolve(true))
      existing.addEventListener('error', () => resolve(false))
      return
    }
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.async = true
    s.dataset.rzpCheckout = '1'
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })
}

/** Fire a full checkout for one plan. Resolves after activation attempt. */
export async function startCheckout(args: {
  plan: string
  planName: string
  kind: CheckoutKind
  amountINR: number
  prefill?: { name?: string; email?: string }
  onKeysMissing?: () => void
}): Promise<CheckoutResult> {
  const loaded = await loadRazorpayScript()
  if (!loaded || !window.Razorpay) {
    return { ok: false, error: 'Could not reach the payment service (network blocked?). Please retry.' }
  }

  let order: any
  try {
    const res = await fetch('/api/billing/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: args.plan, kind: args.kind }),
    })
    order = await res.json()
    if (res.status === 503 || order?.code === 'keys_missing') {
      args.onKeysMissing?.()
      return { ok: false, error: order?.error || 'Online payments are being configured. Please try again shortly.' }
    }
    if (!res.ok) {
      return { ok: false, error: order?.error || `Could not start payment (HTTP ${res.status}).` }
    }
  } catch {
    return { ok: false, error: 'Network error while starting the payment.' }
  }

  return new Promise<CheckoutResult>((resolve) => {
    let settled = false
    const finish = (r: CheckoutResult) => {
      if (!settled) {
        settled = true
        resolve(r)
      }
    }

    const rzp = new window.Razorpay!({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: 'INR',
      name: 'CloudAgent',
      description: `${args.planName} — 1 month`,
      prefill: args.prefill || {},
      notes: { plan: args.plan, kind: args.kind },
      theme: { color: '#10b981' },
      modal: { ondismiss: () => finish({ ok: false, error: 'Payment cancelled.' }) },
      handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
        try {
          const res = await fetch('/api/billing/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(resp),
          })
          const data = await res.json()
          if (res.ok && data.ok) {
            finish({ ok: true, plan: data.plan, kind: data.kind, alreadyActive: data.alreadyActive })
          } else {
            finish({ ok: false, error: data?.error || 'Payment received but activation failed — support can activate it manually from your payment ID.' })
          }
        } catch {
          finish({ ok: false, error: 'Network error during activation — your payment is safe; contact support.' })
        }
      },
    })
    rzp.open()
  })
}
