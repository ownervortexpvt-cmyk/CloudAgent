/**
 * v127 — POST /api/billing/keys/test — REAL-TIME Razorpay connection health.
 *
 * Why: a saved key pair can go bad AFTER the fact (revoked / regenerated on
 * the Razorpay dashboard) while the admin panel keeps saying CONNECTED. This
 * endpoint pings Razorpay with the SAVED keys right now and reports the
 * truth: accepted (live/test mode), rejected (401), or network error.
 *
 * Gate: requireAdminUnlocked (same double gate as saving keys — this moves
 * money, so the control-room PIN applies). The secret never leaves the
 * server and never appears in any response.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getRazorpayConfig, testRazorpayConnection } from '@/lib/razorpay'
import { requireAdminUnlocked } from '@/lib/admin-lock'

export async function POST(req: NextRequest) {
  let admin
  try {
    admin = await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e
    throw e
  }
  void admin
  const cfg = await getRazorpayConfig()
  if (cfg.source === 'none') {
    return NextResponse.json(
      { ok: false, mode: 'none', detail: 'No keys saved yet — connect Razorpay first.' },
      { status: 503 }
    )
  }
  const result = await testRazorpayConnection(cfg)
  return NextResponse.json({ ...result })
}
