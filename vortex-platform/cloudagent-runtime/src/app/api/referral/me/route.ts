/**
 * v119 — GET /api/referral/me → my invite code, share link and referral stats.
 * Backs Settings → Refer & Earn (and the UserMenu shortcut). Lazily mints the
 * code for pre-v119 accounts. Only masked first names of friends ever leave.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth'
import { referralProfile } from '@/lib/referral'

export async function GET(req: NextRequest) {
  let user
  try {
    user = await requireUser(req)
  } catch (e: any) {
    if (e instanceof Response) return e
    throw e
  }

  const profile = await referralProfile(user.id)
  const origin = req.headers.get('origin') || new URL(req.url).origin
  return NextResponse.json({
    ok: true,
    ...profile,
    link: `${origin}/register?ref=${profile.code}`,
    shareText: `Build real apps with AI on CloudAgent 🚀 — sign up with my link and we BOTH get 7 days of Pro free: ${origin}/register?ref=${profile.code}`,
  })
}
