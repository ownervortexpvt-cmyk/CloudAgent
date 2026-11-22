import { NextRequest, NextResponse } from 'next/server'
import * as storage from '@/lib/storage'
import { requireProjectAccess } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')!
  const q = req.nextUrl.searchParams.get('q')!
  if (!projectId || !q) return NextResponse.json({ error: 'projectId and q required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  const results = storage.searchFiles(projectId, q, 1000)
  return NextResponse.json({ results })
}
