/**
 * POST /api/aso-listing — AI App Store Optimization copy generator.
 * Thin wrapper over the aso_listing tool.
 */
import { NextRequest, NextResponse } from 'next/server'
import { TOOLS } from '@/lib/ai/tools'
import { requireProjectAccess } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const projectId = String(body.projectId || '')
  if (!projectId) return NextResponse.json({ ok: false, error: 'projectId required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  const tool = TOOLS.aso_listing
  if (!tool) return NextResponse.json({ ok: false, error: 'aso_listing tool missing' }, { status: 500 })
  const res = await tool.execute({ appName: body.appName, tone: body.tone }, { projectId })
  return NextResponse.json({ ok: res.ok, output: res.output, error: res.error, data: res.data })
}
