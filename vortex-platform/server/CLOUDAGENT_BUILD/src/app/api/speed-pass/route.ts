/**
 * /api/speed-pass — v124 ⚡ Ultra Speed Pass switch (per user).
 *
 *   GET          → { ok, on }
 *   POST {value} → '1' on · '0' off  (anything else → 400)
 *
 * When ON, every AI run this user starts leads with the built-in
 * GLM 5.3 Flash lane (see lib/speed-pass.ts + /api/agent hook).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { isSpeedPassOn, setSpeedPass } from '@/lib/speed-pass'

export async function GET(req: NextRequest) {
  const user = await requireUser(req)
  const on = await isSpeedPassOn(user.id)
  return NextResponse.json({ ok: true, on })
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req)
  const body = await req.json().catch(() => ({} as any))
  const raw = body?.value
  if (raw !== '1' && raw !== '0') {
    return NextResponse.json({ ok: false, error: "value must be '1' or '0'" }, { status: 400 })
  }
  await setSpeedPass(user.id, raw === '1')
  return NextResponse.json({ ok: true, on: raw === '1' })
}
