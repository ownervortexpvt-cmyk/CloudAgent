/**
 * POST /api/pwa-setup — installable PWA + SEO in one click.
 */
import { NextRequest, NextResponse } from 'next/server'
import { pwaSeoSetup } from '@/lib/pwa'
import { requireProjectAccess } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const projectId = String(body.projectId || '')
  if (!projectId) return NextResponse.json({ ok: false, error: 'projectId required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  try {
    const res = await pwaSeoSetup(projectId, { appName: body.appName, description: body.description })
    return NextResponse.json(res)
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'pwa setup failed' }, { status: 500 })
  }
}
