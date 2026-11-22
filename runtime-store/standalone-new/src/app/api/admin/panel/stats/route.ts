/**
 * ADMIN CONTROL ROOM — overview stats (v113). Double-gated:
 * admin session + control-room unlock PIN.
 *
 * GET → users / plans / projects / runs / tokens / revenue / recent payments
 *       / provider count / local AI status / toolchain status / disk + DB size
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminUnlocked } from '@/lib/admin-lock'
import { getPlan, PLANS } from '@/lib/plans'
import { MANAGED_TOOLCHAINS } from '@/lib/toolchains'
import { detectLocalServer } from '@/lib/ai/local'
import fs from 'fs'
import path from 'path'

function dirSizeMb(dir: string): number {
  try {
    let total = 0
    const stack = [dir]
    while (stack.length) {
      const d = stack.pop()!
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
      for (const e of entries) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) stack.push(p)
        else { try { total += fs.statSync(p).size } catch {} }
      }
    }
    return Math.round(total / (1024 * 1024))
  } catch { return 0 }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }

  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  const dayStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()))

  const [usersTotal, usersActive, usersSuspended, projects, runsMonth, runsToday, tokensAgg, paymentsPaid, recentPayments, providers, planGroups] =
    await Promise.all([
      db.authUser.count(),
      db.authUser.count({ where: { status: 'active' } }),
      db.authUser.count({ where: { status: 'suspended' } }),
      db.project.count({ where: { deletedAt: null } }),
      db.agentRun.count({ where: { createdAt: { gte: monthStart } } }),
      db.agentRun.count({ where: { createdAt: { gte: dayStart } } }),
      db.agentRun.aggregate({ _sum: { tokensIn: true, tokensOut: true }, where: { createdAt: { gte: monthStart } } }),
      db.payment.aggregate({ _sum: { amount: true }, where: { status: 'paid' } }),
      db.payment.findMany({ where: { status: 'paid' }, orderBy: { createdAt: 'desc' }, take: 8, include: { user: { select: { email: true, name: true } } } }),
      db.aIProvider.findMany({ select: { id: true, name: true, kind: true, category: true, isDefault: true, role: true, model: true }, orderBy: { createdAt: 'asc' } }),
      db.authUser.groupBy({ by: ['plan'], _count: { plan: true } }),
    ])

  const planBreakdown = Object.keys(PLANS).map((p) => ({
    plan: p,
    name: getPlan(p as any).name,
    priceINR: getPlan(p as any).priceINR,
    count: planGroups.find((g) => g.plan === p)?._count.plan ?? 0,
  }))

  // Toolchain probe (same paths the runtime uses).
  const root = process.cwd()
  const toolchains = MANAGED_TOOLCHAINS.map((t) => {
    const probePath = path.join(root, t.probe)
    let installed = false
    try { installed = fs.existsSync(probePath) } catch {}
    return { name: t.name, label: t.label, version: t.version, approxMb: t.approxMb, setup: t.setup, installed }
  })

  let localAi: any = { up: false }
  try {
    const s = await detectLocalServer()
    localAi = { up: s.up, server: s.server, models: s.models?.slice(0, 12) ?? [] }
  } catch { /* stays down */ }

  const dbSizeMb = dirSizeMb(path.join(root, 'db'))
  const sdkSizeMb = dirSizeMb(path.join(root, 'sdk'))
  const projectsSizeMb = dirSizeMb(path.join(root, 'projects'))

  let disk: { totalGb: number; usedGb: number; availGb: number } | null = null
  try {
    const st: any = await (fs as any).promises.statfs(root)
    disk = { totalGb: +(st.blocks * st.bsize / 1024 ** 3).toFixed(1), usedGb: +((st.blocks - st.bavail) * st.bsize / 1024 ** 3).toFixed(1), availGb: +(st.bavail * st.bsize / 1024 ** 3).toFixed(1) }
  } catch { disk = null }

  return NextResponse.json({
    ok: true,
    users: { total: usersTotal, active: usersActive, suspended: usersSuspended },
    planBreakdown,
    projects,
    runs: { month: runsMonth, today: runsToday },
    tokens: { month: (tokensAgg._sum.tokensIn || 0) + (tokensAgg._sum.tokensOut || 0) },
    revenue: { paidTotalINR: Math.round((paymentsPaid._sum.amount || 0) / 100), currency: 'INR' },
    recentPayments: recentPayments.map((p) => ({
      id: p.id, plan: p.plan, amountINR: Math.round(p.amount / 100), method: p.method,
      paidAt: p.paidAt, email: p.user?.email, name: p.user?.name,
    })),
    providers: { count: providers.length, rows: providers },
    localAi,
    toolchains,
    storage: { dbMb: dbSizeMb, sdkMb: sdkSizeMb, projectsMb: projectsSizeMb, disk },
  })
}
