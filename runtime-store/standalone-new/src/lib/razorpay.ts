/**
 * v110 — Razorpay payment gateway (server side, zero external SDK).
 *
 * Talks to the Razorpay REST API directly (Basic auth) and verifies every
 * callback with HMAC-SHA256, so the whole gateway is ~150 lines with no new
 * npm dependency to break.
 *
 * Key sources (in priority order):
 *   1. UserSetting rows  → razorpay_key_id / razorpay_key_secret (encrypted
 *      at rest with lib/crypto) / razorpay_webhook_secret — set by the admin
 *      in Settings → Payments so the product works with zero redeploy.
 *   2. Environment       → RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET /
 *      RAZORPAY_WEBHOOK_SECRET (.env fallback for CI-style deployments).
 *
 * Plan activation is centralised in activatePurchase() — both the checkout
 * callback (/api/billing/verify) and the webhook (/api/billing/webhook)
 * converge here, idempotently.
 */
import crypto from 'crypto'
import { db } from '@/lib/db'
import { decrypt, encrypt } from '@/lib/crypto'

const RZP_API = 'https://api.razorpay.com/v1'
const KEY_ID_K = 'razorpay_key_id'
const KEY_SECRET_K = 'razorpay_key_secret'
const WEBHOOK_SECRET_K = 'razorpay_webhook_secret'

export interface RazorpayConfig {
  keyId: string
  keySecret: string
  webhookSecret: string
  source: 'db' | 'env' | 'none'
}

export async function getRazorpayConfig(): Promise<RazorpayConfig> {
  const rows = await db.userSetting.findMany({
    where: { key: { in: [KEY_ID_K, KEY_SECRET_K, WEBHOOK_SECRET_K] } },
  })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  // v148: key_id is encrypted at rest too (owner request). decrypt() returns
  // '' for any legacy PLAINTEXT row, so fall back to the raw stored value.
  const dbId = map[KEY_ID_K] ? (decrypt(map[KEY_ID_K]) || map[KEY_ID_K]) : ''
  const dbSecret = map[KEY_SECRET_K] ? decrypt(map[KEY_SECRET_K]) : ''
  // v127: the webhook secret is now encrypted at rest too. decrypt() returns ''
  // on any error, so a LEGACY PLAINTEXT value (pre-v127) still works — fall
  // back to the raw stored value when decryption yields nothing.
  let dbWebhook = ''
  if (map[WEBHOOK_SECRET_K]) {
    const dec = decrypt(map[WEBHOOK_SECRET_K])
    dbWebhook = dec || map[WEBHOOK_SECRET_K]
  }
  if (dbId && dbSecret) {
    return { keyId: dbId, keySecret: dbSecret, webhookSecret: dbWebhook, source: 'db' }
  }
  const envId = process.env.RAZORPAY_KEY_ID || ''
  const envSecret = process.env.RAZORPAY_KEY_SECRET || ''
  if (envId && envSecret) {
    return {
      keyId: envId,
      keySecret: envSecret,
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
      source: 'env',
    }
  }
  return { keyId: '', keySecret: '', webhookSecret: '', source: 'none' }
}

export async function saveRazorpayKeys(keyId: string, keySecret: string, webhookSecret: string) {
  // v148: BOTH credentials are encrypted at rest now (key_id used to be
  // plaintext). getRazorpayConfig decrypts with a legacy-plaintext fallback.
  await db.userSetting.upsert({
    where: { key: KEY_ID_K },
    create: { key: KEY_ID_K, value: encrypt(keyId) },
    update: { value: encrypt(keyId) },
  })
  await db.userSetting.upsert({
    where: { key: KEY_SECRET_K },
    create: { key: KEY_SECRET_K, value: encrypt(keySecret) },
    update: { value: encrypt(keySecret) },
  })
  if (webhookSecret) {
    // v127: webhook secret is now ALSO encrypted at rest (used to be plaintext —
    // getRazorpayConfig falls back to the raw value for legacy rows).
    await db.userSetting.upsert({
      where: { key: WEBHOOK_SECRET_K },
      create: { key: WEBHOOK_SECRET_K, value: encrypt(webhookSecret) },
      update: { value: encrypt(webhookSecret) },
    })
  }
}

/** v127 — 'live' | 'test' | 'none' straight from the key-id prefix. */
export function keyMode(keyId: string): 'live' | 'test' | 'none' {
  if (/^rzp_live_/i.test(keyId)) return 'live'
  if (/^rzp_test_/i.test(keyId)) return 'test'
  return 'none'
}

/**
 * v127 — REAL connection health: pings Razorpay with the SAVED keys.
 * A stored pair can go bad after the fact (revoked/regenerated on the
 * dashboard) while the admin panel still says CONNECTED — this tells the
 * truth right now. Never echoes the secret.
 */
export async function testRazorpayConnection(cfg: RazorpayConfig): Promise<{ ok: boolean; mode: 'live' | 'test' | 'none'; detail: string }> {
  const mode = keyMode(cfg.keyId)
  if (!cfg.keyId || !cfg.keySecret) return { ok: false, mode: 'none', detail: 'No keys saved — connect Razorpay first.' }
  try {
    const r = await fetch(`${RZP_API}/payments?count=1`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64') },
      signal: AbortSignal.timeout(12_000),
    })
    if (r.ok) {
      return { ok: true, mode, detail: mode === 'live' ? 'LIVE keys accepted by Razorpay — real payments will succeed.' : 'TEST keys accepted by Razorpay — checkout runs in test mode (no real money).' }
    }
    if (r.status === 401) return { ok: false, mode, detail: 'Razorpay REJECTED the saved keys (401) — they were revoked or regenerated. Paste the current pair again.' }
    return { ok: false, mode, detail: `Razorpay responded ${r.status} — check api.razorpay.com status or the key pair.` }
  } catch (e: any) {
    return { ok: false, mode, detail: `Network error talking to Razorpay: ${e?.message || 'unknown'}` }
  }
}

/* ─── REST calls ─── */

function authHeader(cfg: RazorpayConfig): string {
  return 'Basic ' + Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')
}

export interface RazorpayOrder {
  id: string
  amount: number
  currency: string
  receipt?: string
  status: string
}

export async function createRazorpayOrder(
  cfg: RazorpayConfig,
  args: { amountPaise: number; receipt: string; notes: Record<string, string> }
): Promise<RazorpayOrder> {
  const res = await fetch(`${RZP_API}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader(cfg) },
    body: JSON.stringify({
      amount: args.amountPaise,
      currency: 'INR',
      receipt: args.receipt.slice(0, 40),
      notes: args.notes,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = body?.error?.description || body?.error?.reason || `HTTP ${res.status}`
    throw new Error(`Razorpay order failed: ${detail}`)
  }
  return body as RazorpayOrder
}

export async function fetchRazorpayPayment(cfg: RazorpayConfig, paymentId: string): Promise<any | null> {
  try {
    const res = await fetch(`${RZP_API}/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: authHeader(cfg) },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/* ─── signature verification (the trust boundary) ─── */

/** Checkout callback: HMAC(order_id|payment_id, key_secret). */
export function verifyCheckoutSignature(cfg: RazorpayConfig, orderId: string, paymentId: string, signature: string): boolean {
  if (!orderId || !paymentId || !signature) return false
  const expected = crypto
    .createHmac('sha256', cfg.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(signature), 'hex'))
  } catch {
    return false
  }
}

/** Webhook: HMAC(rawRequestBody, webhook_secret) vs x-razorpay-signature. */
export function verifyWebhookSignature(cfg: RazorpayConfig, rawBody: string, signature: string | null): boolean {
  if (!cfg.webhookSecret || !signature) return false
  const expected = crypto.createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(signature), 'hex'))
  } catch {
    return false
  }
}

/* ─── activation (shared by verify + webhook, idempotent) ─── */

export interface PurchaseRecord {
  id: string
  userId: string
  plan: string
  kind: string // monthly (v111: lifetime is no longer purchasable)
  status: string
  razorpayPaymentId: string | null
}

/**
 * Mark the payment paid and grant the plan. Safe to call twice (webhook may
 * arrive after the checkout callback already activated).
 */
export async function activatePurchase(payment: PurchaseRecord, method?: string): Promise<{ activated: boolean }> {
  if (payment.status === 'paid') return { activated: false } // already granted
  const now = new Date()
  await db.payment.update({
    where: { id: payment.id },
    data: { status: 'paid', paidAt: now, method: method || null },
  })

  const user = await db.authUser.findUnique({ where: { id: payment.userId } })
  if (!user) return { activated: false }

  // v111: lifetime purchases no longer exist — every payment grants a rolling
  // 30-day subscription. Renewing the SAME tier before expiry extends from
  // the current expiry (no lost days); upgrading/lapsed starts fresh today.
  const sameTierActive =
    user.plan === payment.plan &&
    user.planKind === 'monthly' &&
    user.planExpiresAt &&
    new Date(user.planExpiresAt).getTime() > now.getTime()
  const base = sameTierActive ? new Date(user.planExpiresAt as unknown as string) : now
  const expires = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000)
  await db.authUser.update({
    where: { id: user.id },
    data: { plan: payment.plan, planKind: 'monthly', planStartedAt: now, planExpiresAt: expires },
  })
  // v116 — the buyer's cached session must not show the old plan for 45s:
  // pay ₹1999, and the very next /api/auth/me already says pro.
  const { invalidateSessionCache } = await import('@/lib/auth')
  invalidateSessionCache()
  return { activated: true }
}
