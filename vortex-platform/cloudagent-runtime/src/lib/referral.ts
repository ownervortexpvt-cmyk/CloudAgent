/**
 * v119 — REFER & EARN: CloudAgent's growth engine.
 *
 * Every user owns a personal invite code. A friend who signs up through
 * /register?ref=CODE gets 7 days of Pro free (no card, builds immediately —
 * no waiting for Big Billion Day), and the referrer gets 7 days added to
 * THEIR current plan (same tier extended from its expiry — mirrors the
 * activatePurchase renewal semantics, no lost days). Free referrers get
 * 7 days of Pro instead. Admin/operator accounts record the referral but
 * their operator plan is never touched.
 *
 * Rewards are granted server-side ONLY at registration time — codes pasted
 * later cannot retro-trigger rewards (one honest shot, no farming).
 */
import { db } from '@/lib/db'
import { getPlan } from '@/lib/plans'

export const REWARD_DAYS = 7
export const REWARD_PLAN = 'pro' as const

/** Unambiguous alphabet — no I/1, L, O/0 confusion when read off a phone screen. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

function randomCode(len = 8): string {
  const bytes = new Uint8Array(len)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

/**
 * Normalize anything a user may paste: lowercase → upper, strip spaces and
 * dashes, drop an optional leading "CA" brand prefix ("CA-7K2M9XQD" → "7K2M9XQD").
 */
export function normalizeReferralCode(raw: string | null | undefined): string {
  let c = String(raw || '').toUpperCase().replace(/[\s-]/g, '')
  if (c.length === 10 && c.startsWith('CA')) c = c.slice(2)
  return c
}

/** First name only for public display — never leaks the full identity. */
export function maskName(name: string, email: string): string {
  const n = String(name || '').trim()
  if (n) return n.split(/\s+/)[0].slice(0, 24)
  return String(email || '').split('@')[0].slice(0, 24) || 'A friend'
}

/** Every user gets a code; pre-v119 accounts get theirs lazily (idempotent). */
export async function ensureReferralCode(userId: string): Promise<string> {
  const user = await db.authUser.findUnique({ where: { id: userId }, select: { referralCode: true } })
  if (user?.referralCode) return user.referralCode
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode(8)
    try {
      await db.authUser.update({ where: { id: userId }, data: { referralCode: code } })
      return code
    } catch {
      // unique collision — astronomically unlikely (31^8), retry anyway
    }
  }
  // last resort: longer code
  const code = randomCode(12)
  await db.authUser.update({ where: { id: userId }, data: { referralCode: code } })
  return code
}

export interface ReferralApplyResult {
  applied: boolean
  reason?: string
  referrerName?: string
}

/**
 * Apply a referral code to a JUST-CREATED account and grant both rewards.
 * Never throws for business reasons — an invalid code must never break a
 * signup; it is recorded honestly and ignored.
 */
export async function applyReferral(newUserId: string, rawCode: string | null | undefined): Promise<ReferralApplyResult> {
  const code = normalizeReferralCode(rawCode)
  if (!code || code.length < 6) return { applied: false, reason: 'no-code' }

  const referrer = await db.authUser.findUnique({ where: { referralCode: code } })
  if (!referrer || referrer.status !== 'active') return { applied: false, reason: 'unknown-code' }
  if (referrer.id === newUserId) return { applied: false, reason: 'self' }

  const now = new Date()
  await db.authUser.update({
    where: { id: newUserId },
    data: { referredById: referrer.id, referredAt: now },
  })

  await grantReferralRewards(referrer, newUserId, now)
  return { applied: true, referrerName: maskName(referrer.name, referrer.email) }
}

/**
 * The dual reward:
 *  - REFEREE  → Pro free for 7 days (unless admin — operator plans untouched)
 *  - REFERRER → +7 days on their current active paid tier (extend from expiry,
 *               no lost days) or Pro for 7 days if they had no active plan
 */
async function grantReferralRewards(referrer: { id: string; role: string; plan: string; planKind: string; planExpiresAt: Date | string | null }, refereeId: string, now: Date): Promise<void> {
  const day = REWARD_DAYS * 24 * 60 * 60 * 1000
  const referee = await db.authUser.findUnique({ where: { id: refereeId } })
  if (!referee) return

  // ── referee reward ──
  if (referee.role !== 'admin') {
    await db.authUser.update({
      where: { id: referee.id },
      data: {
        plan: REWARD_PLAN,
        planKind: 'monthly',
        planStartedAt: now,
        planExpiresAt: new Date(now.getTime() + day),
      },
    })
  }

  // ── referrer reward ──
  if (referrer.role === 'admin') return // operator keeps the operator plan; referral still counted
  const expiry = referrer.planExpiresAt ? new Date(referrer.planExpiresAt as unknown as string) : null
  const activePaid = referrer.planKind === 'monthly' && referrer.plan !== 'free' && expiry && expiry.getTime() > now.getTime()
  if (activePaid) {
    // extend the SAME tier from its expiry — no lost days (mirrors activatePurchase)
    await db.authUser.update({
      where: { id: referrer.id },
      data: { planExpiresAt: new Date(expiry!.getTime() + day) },
    })
  } else {
    // free / lapsed referrer → 7 days of Pro so the reward is real for them too
    await db.authUser.update({
      where: { id: referrer.id },
      data: {
        plan: REWARD_PLAN,
        planKind: 'monthly',
        planStartedAt: now,
        planExpiresAt: new Date(now.getTime() + day),
      },
    })
  }

  // cached sessions must not show the old plan for 45s (same trick as activatePurchase)
  try {
    const { invalidateSessionCache } = await import('@/lib/auth')
    invalidateSessionCache()
  } catch {}
}

/** Everything the Refer & Earn UI needs, in one honest payload. */
export async function referralProfile(userId: string) {
  const code = await ensureReferralCode(userId)
  const referred = await db.authUser.findMany({
    where: { referredById: userId },
    select: { name: true, email: true, createdAt: true, plan: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  const reward = getPlan(REWARD_PLAN)
  return {
    code,
    rewardDays: REWARD_DAYS,
    rewardPlan: { id: reward.id, name: reward.name, priceINR: reward.priceINR },
    totalReferred: referred.length,
    friends: referred.map((u) => ({
      name: maskName(u.name, u.email),
      joinedAt: u.createdAt,
      plan: u.plan,
    })),
  }
}
