/**
 * v123 — /api/marketplace — share & sell the apps you built.
 *
 *   GET  ?q=&category=&mine=1  → published listings (or my own with mine=1)
 *   POST { projectId, title, description, category, priceInr }
 *                              → snapshot my project into a listing
 *   DELETE ?id=                → unpublish my listing (seller or admin)
 *
 * Paid listings (priceInr > 0) are listed with a "paid" badge but installing
 * them answers 402 until Razorpay keys are connected — honest commerce.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireProjectAccess, requireUser } from '@/lib/auth'
import { packageProject } from '@/lib/marketplace'

export const runtime = 'nodejs'

const CATEGORIES = ['apps', 'games', 'business', 'portfolio', 'tools', 'other']

export async function GET(req: NextRequest) {
  const user = await requireUser(req)
  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 80)
  const category = req.nextUrl.searchParams.get('category') || ''
  const mine = req.nextUrl.searchParams.get('mine') === '1'

  const where: any = mine
    ? { sellerId: user.id, status: 'published' }
    : { status: 'published' }
  if (category && CATEGORIES.includes(category)) where.category = category
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
    ]
  }

  const rows = await db.marketListing.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
  return NextResponse.json({
    ok: true,
    listings: rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category,
      priceInr: r.priceInr,
      sellerName: r.sellerName,
      installs: r.installs,
      fileCount: r.fileCount,
      sizeBytes: r.sizeBytes,
      thumbSvg: r.thumbSvg,
      mine: r.sellerId === user.id,
      createdAt: r.createdAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req)
  const body = await req.json().catch(() => null)
  const projectId = String((body as any)?.projectId || '')
  const title = String((body as any)?.title || '').trim().slice(0, 80)
  const description = String((body as any)?.description || '').trim().slice(0, 600)
  const category = CATEGORIES.includes((body as any)?.category) ? (body as any).category : 'apps'
  const priceInr = Math.max(0, Math.min(99999, Math.round(Number((body as any)?.priceInr) || 0)))
  if (!projectId || !title) return NextResponse.json({ ok: false, error: 'projectId and title required' }, { status: 400 })
  try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }

  // snapshot FIRST — if packaging fails, nothing is listed
  const tmpId = `tmp-${Date.now()}`
  const pack = packageProject(projectId, tmpId)
  if (!pack.ok) return NextResponse.json({ ok: false, error: pack.error || 'packaging failed' }, { status: 400 })

  const listing = await db.marketListing.create({
    data: {
      sellerId: user.id,
      sellerName: user.name || user.email.split('@')[0],
      projectId,
      title,
      description,
      category,
      priceInr,
      thumbSvg: pack.thumbSvg,
      fileCount: pack.fileCount,
      sizeBytes: pack.sizeBytes,
      status: 'published',
    },
  })
  // move the temp zip to its real listing id
  try {
    const fs = await import('fs')
    fs.renameSync(`/home/z/my-project/download/market/${tmpId}.zip`, `/home/z/my-project/download/market/${listing.id}.zip`)
  } catch { /* listing still created; install will report missing package honestly */ }

  return NextResponse.json({ ok: true, listing: { id: listing.id, title: listing.title } })
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser(req)
  const id = req.nextUrl.searchParams.get('id') || ''
  const row = await db.marketListing.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ ok: true })
  if (row.sellerId !== user.id && user.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'not your listing' }, { status: 403 })
  }
  await db.marketListing.update({ where: { id }, data: { status: 'removed' } })
  return NextResponse.json({ ok: true })
}
