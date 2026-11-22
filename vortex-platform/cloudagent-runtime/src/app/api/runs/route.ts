import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, requireProjectAccess, UNAUTH_RESPONSE } from '@/lib/auth'

/**
 * GET /api/runs?projectId=…&limit=50 — v55 DB-backed run history.
 * GET /api/runs?format=csv — v59: the same history as a real CSV download
 * (spreadsheet-ready; fields with commas/quotes are escaped, newlines in
 * prompt/response are flattened so every run is exactly one row).
 *
 * Every single-agent run (lib/ai/agent.ts) AND every swarm run
 * (api/multi-agent) now persists a row in the AgentRun table, so the 🕘
 * history survives browser clears, device switches and localStorage wipes.
 * Returns the newest runs first, trimmed to honest scalar fields.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('projectId')
  // BUSINESS v2 (hardened): authentication is ALWAYS required here, and the
  // no-projectId listing is scoped to the caller's own projects — a tenant
  // can never enumerate other accounts' runs by omitting the parameter.
  const user = await requireUser(req).catch(() => null)
  if (!user) return UNAUTH_RESPONSE() as any
  if (projectId) {
    // verify the caller owns this project (admins exempt)
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200)
  const format = searchParams.get('format')

  try {
    // Tenant scope: admins see everything; normal users only their own projects.
    let where: any = projectId ? { projectId } : undefined
    if (user.role !== 'admin') {
      const ownIds = (await db.project.findMany({ where: { userId: user.id }, select: { id: true } })).map(p => p.id)
      if (projectId) {
        // requireProjectAccess already passed (ownership verified) — keep { projectId }
      } else {
        where = { projectId: { in: ownIds } }
      }
    }
    const runs = await db.agentRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        projectId: true,
        prompt: true,
        status: true,
        model: true,
        provider: true,
        tokensIn: true,
        tokensOut: true,
        toolCalls: true,
        response: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    // v59 — ⬇ CSV export of the run history
    if (format === 'csv') {
      const flat = (v: unknown) => String(v ?? '').replace(/\r?\n/g, ' ')
      const esc = (v: unknown) => {
        const s = flat(v)
        return /[",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      const header = 'id,projectId,createdAt,updatedAt,status,model,provider,tokensIn,tokensOut,files,prompt,response'
      const rows = runs.map(r => [
        r.id, r.projectId, r.createdAt?.toISOString?.() || r.createdAt, r.updatedAt?.toISOString?.() || r.updatedAt,
        r.status, r.model, r.provider, r.tokensIn, r.tokensOut, r.toolCalls, flat(r.prompt), flat(r.response),
      ].map(esc).join(','))
      const stamp = new Date().toISOString().slice(0, 10)
      return new NextResponse(header + '\n' + rows.join('\n') + (rows.length ? '\n' : ''), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="runs-${stamp}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    return NextResponse.json({ ok: true, runs })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'failed to load runs' }, { status: 500 })
  }
}
