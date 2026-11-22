import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadBalancer } from '@/lib/ai/load-balancer'

/**
 * GET /api/providers/health
 * Returns the size of the provider pool (how many AI keys are configured)
 * plus live health stats from the load balancer — used by the Multi-Agent
 * "AI Army" panel and the Agent list (All Agent / Active agent tabs).
 * Each provider carries its role (leader | work) and live balancer status
 * (healthy | cooldown | disabled | dead) so the UI can show which agents
 * are ACTIVE right now.
 */
export async function GET() {
  const rows = await db.aIProvider.findMany({
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, kind: true, model: true, isDefault: true, role: true },
  })

  // Register every provider so the balancer tracks it
  for (const r of rows) loadBalancer.registerKey(r.id)

  const byKind: Record<string, number> = {}
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] || 0) + 1

  // Live per-agent status — an agent is "active" while the balancer still
  // routes work to it (healthy or briefly cooling down after a 429).
  const statusById = new Map(loadBalancer.getHealthReport().map(h => [h.keyId, h.status]))

  const leaders = rows.filter(r => r.role === 'leader').length

  return NextResponse.json({
    poolSize: rows.length,
    leaders,
    byKind,
    providers: rows.slice(0, 2000).map(r => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      model: r.model,
      isDefault: r.isDefault,
      role: r.role === 'leader' ? 'leader' : 'work',
      status: statusById.get(r.id) || 'healthy',
    })),
    balancer: loadBalancer.getSummary(),
    limits: { maxConcurrency: 1000, maxProviders: 100000, maxLeaders: 4, maxWorkAgents: 1500 },
  })
}
