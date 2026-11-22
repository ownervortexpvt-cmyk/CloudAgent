/**
 * BUSINESS v2 — POST /api/auth/logout → revokes the presented session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { revokeSession, tokenFromRequest, SESSION_COOKIE } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const token = tokenFromRequest(req)
  if (token) await revokeSession(token)
  const res = NextResponse.json({ ok: true })
  res.headers.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`)
  return res
}
