import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { syncVault } from '@/lib/provider-vault'

/**
 * POST /api/providers/role  { id: string, role: 'leader' | 'work' }
 *
 * Promote/demote an agent. LEADER agents (max 4) plan the battle and are the
 * face of the team; WORK agents (max 1500) do the bulk of the building.
 * If one agent stops working (401 / out of credit / rate limit) its tasks
 * automatically move to the next healthy agent — that failover is built into
 * the multi-agent run, so a dead agent never stalls the swarm.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { id, role } = body || {}
  if (!id || typeof id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (role !== 'leader' && role !== 'work') {
    return NextResponse.json({ error: "role must be 'leader' or 'work'" }, { status: 400 })
  }

  const row = await db.aIProvider.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: 'agent not found' }, { status: 404 })
  if (row.role === role) return NextResponse.json({ ok: true, role, leaders: await countLeaders() })

  if (role === 'leader') {
    const leaders = await countLeaders()
    if (leaders >= 4) {
      return NextResponse.json(
        { error: 'Maximum 4 leader agents. Demote a leader first (tap its crown), then promote this one.' },
        { status: 400 },
      )
    }
  }

  await db.aIProvider.update({ where: { id }, data: { role } })
  await syncVault()
  return NextResponse.json({ ok: true, role, leaders: await countLeaders() })
}

async function countLeaders(): Promise<number> {
  return db.aIProvider.count({ where: { role: 'leader' } })
}
