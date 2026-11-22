/**
 * v123 — /api/gate — the ONLY door into the private site.
 * POST { key } → correct key sets the `ca_gate` cookie (sha256 of the key).
 * Wrong/missing key → 401 with an honest message. No enumeration help.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getGate, checkGate, GATE_COOKIE, sha256Hex } from '@/lib/gate'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const key = String((body as any).key || '').trim()
  const gate = await getGate()
  if (!checkGate(key, gate)) {
    return NextResponse.json(
      { ok: false, error: 'Wrong key. Ei site private — shudhu owner ar operator dhukte pare.' },
      { status: 401 }
    )
  }
  const res = NextResponse.json({ ok: true })
  // 30 days — the owner should not re-type the key on every visit.
  res.cookies.set(GATE_COOKIE, gate.hash, {
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    sameSite: 'lax',
  })
  return res
}

/** GET → status probe used by the gate page to detect an already-open session. */
export async function GET(req: NextRequest) {
  const presented = req.cookies.get(GATE_COOKIE)?.value
  const gate = await getGate()
  return NextResponse.json({ ok: true, open: checkGate(presented, gate) })
}
