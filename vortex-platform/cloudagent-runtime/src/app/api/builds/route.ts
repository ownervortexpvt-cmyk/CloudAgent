import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireProjectAccess } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')!
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  const builds = await db.build.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 1000 })
  return NextResponse.json({ builds })
}
