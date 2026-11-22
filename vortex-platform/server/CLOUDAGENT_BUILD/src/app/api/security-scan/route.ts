/**
 * POST /api/security-scan — deterministic vulnerability scan of the project.
 * Thin wrapper over lib/securityscan so the UI and scripts can call it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { securityScan } from '@/lib/securityscan'
import { requireProjectAccess } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any))
  const projectId = String(body.projectId || '')
  if (!projectId) return NextResponse.json({ ok: false, error: 'projectId required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  const { findings, score, scanned } = securityScan(projectId)
  return NextResponse.json({ ok: true, score, scanned, findings })
}
