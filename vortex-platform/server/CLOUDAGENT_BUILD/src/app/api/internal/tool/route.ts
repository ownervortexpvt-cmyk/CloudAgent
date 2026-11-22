/**
 * Internal tool bridge — run a single agent tool directly, without a full
 * LLM orchestration round-trip.
 *
 * Purpose:
 *   1. E2E tests can exercise real tools (install_package, write_file…)
 *      deterministically instead of hoping the model calls them.
 *   2. Developer Mode / future integrations get a narrow, audited entry
 *      point to the same tool implementations the agent uses.
 *
 * Security: middleware already fail-closes every non-public path on the lock
 * token; this route re-checks isUnlockedRequest itself (defense in depth).
 * Tools that declare requiresConfirmation (rm -rf, git push…) are refused —
 * this bridge is for build/install tooling, not destructive ops.
 */
import { NextResponse } from 'next/server'
import { TOOLS } from '@/lib/ai/tools'
import { isUnlockedRequest } from '@/lib/lock'
import { requireProjectAccess } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!(await isUnlockedRequest(req))) {
    return NextResponse.json({ ok: false, error: 'Locked — unlock required' }, { status: 401 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const { projectId, tool, args } = body || {}
  if (typeof projectId !== 'string' || !projectId) {
    return NextResponse.json({ ok: false, error: 'projectId is required' }, { status: 400 })
  }
  // SECURITY FIX: this bridge used to accept ANY projectId from ANY signed-in
  // session — a verified cross-tenant write (free user wrote hacked.txt into
  // another account's project). Ownership must be enforced before any tool
  // runs against the project.
  try { await requireProjectAccess(req as any, projectId) } catch (e: any) {
    if (e instanceof Response) return e as any
    return NextResponse.json({ ok: false, error: 'no access to this project' }, { status: 403 })
  }
  if (typeof tool !== 'string' || !tool) {
    return NextResponse.json({ ok: false, error: 'tool is required' }, { status: 400 })
  }

  const def = TOOLS[tool]
  if (!def) {
    return NextResponse.json({ ok: false, error: `Unknown tool: ${tool}` }, { status: 404 })
  }
  if (def.requiresConfirmation?.(args || {})) {
    return NextResponse.json({ ok: false, error: `Tool "${tool}" is confirmation-gated and cannot run through the internal bridge` }, { status: 403 })
  }

  try {
    const result = await def.execute(args || {}, { projectId })
    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ ok: false, output: '', error: e?.message || 'tool crashed' })
  }
}
