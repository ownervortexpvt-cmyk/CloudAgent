/**
 * v110 — Razorpay configuration (ADMIN only).
 *   GET  → masked current state (is it configured? from DB or env?)
 *   POST { keyId, keySecret, webhookSecret? } → save (secret encrypted at
 *   rest) + live-validate against the Razorpay API with a read-only call.
 *
 * v115 — ULTRA SECURITY pass (owner request):
 *   - rate-limited: max 6 save attempts / 10 min per admin session (brute-force
 *     the live-validation round-trip and you hit a wall)
 *   - fail-closed save: if Razorpay REJECTS the pair, existing keys are NOT
 *     overwritten — a typo can never take a working payment system down
 *   - the secret is never echoed back in any response, ever
 */
import { NextRequest, NextResponse } from 'next/server'
import { getRazorpayConfig, saveRazorpayKeys, keyMode } from '@/lib/razorpay'
import { requireAdmin } from '@/lib/auth'
import { requireAdminUnlocked } from '@/lib/admin-lock'

/* in-memory rate limiter: adminId → timestamps of recent POSTs */
const keyAttempts = new Map<string, number[]>()
const RATE_WINDOW_MS = 10 * 60 * 1000
const RATE_MAX = 6
function rateLimited(adminId: string): boolean {
  const now = Date.now()
  const arr = (keyAttempts.get(adminId) || []).filter((t) => now - t < RATE_WINDOW_MS)
  if (arr.length >= RATE_MAX) {
    keyAttempts.set(adminId, arr)
    return true
  }
  arr.push(now)
  keyAttempts.set(adminId, arr)
  return false
}

function mask(v: string): string {
  if (!v) return ''
  if (v.length <= 10) return '•'.repeat(v.length)
  return v.slice(0, 6) + '•'.repeat(Math.max(4, v.length - 10)) + v.slice(-4)
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req)
  } catch (e: any) {
    if (e instanceof Response) return e
    throw e
  }
  const cfg = await getRazorpayConfig()
  return NextResponse.json({
    ok: true,
    configured: cfg.source !== 'none',
    source: cfg.source,
    mode: keyMode(cfg.keyId), // v127: 'live' | 'test' | 'none' — drives the admin TEST/LIVE badge
    keyIdMasked: mask(cfg.keyId),
    webhookConfigured: Boolean(cfg.webhookSecret),
  })
}

export async function POST(req: NextRequest) {
  let admin
  try {
    // v113: payment-key changes are control-room material — admin session
    // AND the /admin room PIN must be unlocked (Razorpay keys move money).
    admin = await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e
    throw e
  }
  void admin

  if (rateLimited(admin.id)) {
    return NextResponse.json(
      { ok: false, error: 'Too many key attempts — wait 10 minutes before trying again.' },
      { status: 429 }
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  const keyId = String(body?.keyId || '').trim()
  const keySecret = String(body?.keySecret || '').trim()
  const webhookSecret = String(body?.webhookSecret || '').trim()
  if (!/^rzp_(live|test)_/i.test(keyId) || keySecret.length < 16 || keySecret.length > 256) {
    return NextResponse.json(
      { ok: false, error: 'That does not look like a Razorpay key pair — key id starts with rzp_ and the secret is longer.' },
      { status: 400 }
    )
  }

  // live validation: read-only payments list call must return 200
  let live = false
  try {
    const res = await fetch('https://api.razorpay.com/v1/payments?count=1', {
      headers: { Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64') },
      signal: AbortSignal.timeout(15_000),
    })
    live = res.ok
  } catch {
    live = false
  }

  // v115 fail-closed: Razorpay rejected the pair → do NOT touch whatever is
  // configured now (a paste typo must never break live payments).
  // Escape hatch: `allowUnverified` — same double gate, but saves rejected
  // keys with a warning. ONLY for controlled fixture installs (E2E); the
  // admin UI's Get button never sends it.
  if (!live && !body?.allowUnverified) {
    console.warn(`[billing/keys] REJECTED pair for ${keyId.slice(0, 12)}… by admin ${admin.id} — existing keys untouched`)
    return NextResponse.json(
      {
        ok: false,
        liveValidated: false,
        error: 'Razorpay rejected this key pair — nothing was changed. Copy Key ID + Key Secret together from the dashboard and try again.',
      },
      { status: 400 }
    )
  }

  await saveRazorpayKeys(keyId, keySecret, webhookSecret)
  if (live) {
    console.log(`[billing/keys] LIVE-VALIDATED keys saved for ${keyId.slice(0, 12)}… by admin ${admin.id}`)
  } else {
    console.warn(`[billing/keys] UNVERIFIED keys saved (allowUnverified) for ${keyId.slice(0, 12)}… by admin ${admin.id}`)
  }
  return NextResponse.json({
    ok: true,
    liveValidated: live,
    mode: keyMode(keyId), // v127
    warning: live ? undefined : 'Keys saved WITHOUT live verification — checkout will fail until real keys are installed.',
  })
}
