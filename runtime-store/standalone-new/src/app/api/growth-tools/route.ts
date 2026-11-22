/**
 * POST /api/growth-tools — whitelisted v24 tool execution for the Growth
 * Studio UI (owner-only: the middleware lock already gates this route).
 */
import { NextRequest, NextResponse } from 'next/server'
import { TOOLS } from '@/lib/ai/tools'
import { requireProjectAccess } from '@/lib/auth'

const ALLOWED = new Set([
  'payment_setup',
  'push_notification_setup',
  'database_builder',
  'analytics_setup',
  'version_snapshot',
])

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const projectId = String(body.projectId || '')
  const tool = String(body.tool || '')
  if (!projectId) return NextResponse.json({ ok: false, error: 'projectId required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  if (!ALLOWED.has(tool)) return NextResponse.json({ ok: false, error: `tool not allowed: ${tool}` }, { status: 400 })
  const def = TOOLS[tool]
  if (!def) return NextResponse.json({ ok: false, error: `unknown tool: ${tool}` }, { status: 400 })
  const res = await def.execute(body.args || {}, { projectId })
  return NextResponse.json({ ok: res.ok, output: res.output, error: res.error, data: res.data })
}
