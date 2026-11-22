/**
 * POST /api/assets/generate — AI image generation (Asset Studio).
 * kind: logo | icon | hero | banner. Saves into project assets/ and, for
 * icon/logo, also writes 192/512px PWA icons.
 */
import { NextRequest, NextResponse } from 'next/server'
import { TOOLS } from '@/lib/ai/tools'
import { requireProjectAccess } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const projectId = String(body.projectId || '')
  const prompt = String(body.prompt || '')
  const kind = String(body.kind || 'hero')
  if (!projectId || !prompt) return NextResponse.json({ ok: false, error: 'projectId and prompt required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }

  const tool = TOOLS.asset_generate
  if (!tool) return NextResponse.json({ ok: false, error: 'asset_generate tool missing' }, { status: 500 })
  const res = await tool.execute({ prompt, kind, filename: body.filename }, { projectId })
  return NextResponse.json({ ok: res.ok, output: res.output, error: res.error, data: res.data })
}
