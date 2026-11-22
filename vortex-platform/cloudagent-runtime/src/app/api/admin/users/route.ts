/**
 * BUSINESS v2 — GET /api/admin/users (ADMIN) → all accounts + live usage.
 * The owner uses this (Settings → Users) to activate plans after payment.
 * v110 — POST (ADMIN) { action: 'reset_password', userId, newPassword }:
 * a no-email SaaS still needs a first-class recovery path, so the admin can
 * set a temporary password for a customer (all their sessions get revoked).
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { invalidateSessionCache } from '@/lib/auth'
import { requireAdmin, hashPassword, revokeAllSessions } from '@/lib/auth'
import { requireAdminUnlocked } from '@/lib/admin-lock'
import { getPlan } from '@/lib/plans'

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req)
  } catch (e: any) {
    if (e instanceof Response) return e
    throw e
  }

  const users = await db.authUser.findMany({ orderBy: { createdAt: 'asc' } })
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))

  const rows = await Promise.all(
    users.map(async (u) => {
      const [projects, runs, agg] = await Promise.all([
        db.project.count({ where: { userId: u.id, deletedAt: null } }),
        db.agentRun.count({ where: { project: { userId: u.id }, createdAt: { gte: monthStart } } }),
        db.agentRun.aggregate({
          _sum: { tokensIn: true, tokensOut: true },
          where: { project: { userId: u.id }, createdAt: { gte: monthStart } },
        }),
      ])
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        plan: u.plan,
        planName: getPlan(u.plan).name,
        status: u.status,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        usage: { projects, runs, tokens: (agg._sum.tokensIn || 0) + (agg._sum.tokensOut || 0) },
      }
    })
  )
  return NextResponse.json({ ok: true, users: rows })
}

export async function POST(req: NextRequest) {
  let admin
  try {
    // v113: account-control actions (password reset / plan override / ban)
    // are double-gated — admin session AND the control-room PIN unlock.
    admin = await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e
    throw e
  }
  void admin

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  if (body?.action === 'reset_password') {
    const userId = String(body?.userId || '')
    const newPassword = String(body?.newPassword || '')
    if (!userId || newPassword.length < 8) {
      return NextResponse.json({ ok: false, error: 'userId and a password of at least 8 characters are required.' }, { status: 400 })
    }
    const target = await db.authUser.findUnique({ where: { id: userId } })
    if (!target) return NextResponse.json({ ok: false, error: 'User not found.' }, { status: 404 })
    await db.authUser.update({ where: { id: userId }, data: { passwordHash: hashPassword(newPassword) } })
    invalidateSessionCache()
    await revokeAllSessions(userId) // every device of that user signs out now
    return NextResponse.json({ ok: true, action: 'reset_password', userId })
  }

  // v113 — control-room actions: manual plan override (comp / grant / fix a
  // failed renewal) and suspend / reactivate (ban hammer for abusers).
  if (body?.action === 'set_plan') {
    const userId = String(body?.userId || '')
    const plan = String(body?.plan || '')
    const target = await db.authUser.findUnique({ where: { id: userId } })
    if (!target) return NextResponse.json({ ok: false, error: 'User not found.' }, { status: 404 })
    if (target.role === 'admin' && plan !== 'admin_grant') {
      return NextResponse.json({ ok: false, error: 'Admin accounts keep their admin plan.' }, { status: 400 })
    }
    const valid = ['free', 'pro', 'pro_plus', 'ultra', 'pro_max', 'ultra_pro_max']
    if (!valid.includes(plan)) return NextResponse.json({ ok: false, error: `plan must be one of ${valid.join(', ')}` }, { status: 400 })
    const expires = plan === 'free' ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    await db.authUser.update({
      where: { id: userId },
      data: { plan, planKind: plan === 'free' ? 'free' : 'admin', planStartedAt: plan === 'free' ? null : new Date(), planExpiresAt: expires },
    })
    invalidateSessionCache() // v116 — cached sessions must see the new plan NOW
    return NextResponse.json({ ok: true, action: 'set_plan', userId, plan })
  }

  if (body?.action === 'set_status') {
    const userId = String(body?.userId || '')
    const status = String(body?.status || '')
    const target = await db.authUser.findUnique({ where: { id: userId } })
    if (!target) return NextResponse.json({ ok: false, error: 'User not found.' }, { status: 404 })
    if (target.role === 'admin') return NextResponse.json({ ok: false, error: 'The owner account cannot be suspended.' }, { status: 400 })
    if (!['active', 'suspended'].includes(status)) return NextResponse.json({ ok: false, error: "status must be 'active' or 'suspended'" }, { status: 400 })
    await db.authUser.update({ where: { id: userId }, data: { status } })
    if (status === 'suspended') await revokeAllSessions(userId) // banned → every device out now
    invalidateSessionCache() // v116 — reactivate/ban visible instantly
    return NextResponse.json({ ok: true, action: 'set_status', userId, status })
  }

  return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 })
}
