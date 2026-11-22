/**
 * v123 — /api/marketplace/install — install a listing as YOUR OWN project.
 *
 * Free listing  → instant install (new project in the buyer's workspace).
 * Paid listing  → 402 with an honest message until Razorpay keys are
 *                 connected; after that a successful BillingRecord unlocks it.
 * Re-installing the same listing is free (already-purchased check passes and
 * the unique purchase row is reused).
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { installListing } from '@/lib/marketplace'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const user = await requireUser(req)
  const body = await req.json().catch(() => ({}))
  const listingId = String((body as any).listingId || '')
  const listing = await db.marketListing.findUnique({ where: { id: listingId } })
  if (!listing || listing.status !== 'published') {
    return NextResponse.json({ ok: false, error: 'listing not available' }, { status: 404 })
  }

  if (listing.priceInr > 0) {
    // v123: paid unlock = a successful Payment row whose metadata mentions this
    // listing (recorded when Razorpay lands) OR an existing purchase row.
    const paid = await db.payment.findFirst({
      where: { userId: user.id, status: 'paid' },
    }).catch(() => null)
    const listingPaid = paid && (() => { try { return JSON.stringify(paid) .includes(listingId) } catch { return false } })()
    const already = await db.marketPurchase.findUnique({
      where: { listingId_buyerId: { listingId, buyerId: user.id } },
    }).catch(() => null)
    if (!listingPaid && !already) {
      return NextResponse.json({
        ok: false,
        error: `Ei listing ₹${listing.priceInr} — payment e debesh na (Razorpay keys ekhono connected hoy nai). Free listing try koro.`,
        limit: 'payment_required',
        priceInr: listing.priceInr,
      }, { status: 402 })
    }
    if (!already) {
      await db.marketPurchase.create({ data: { listingId, buyerId: user.id, priceInr: 0 } }).catch(() => {})
    }
  } else {
    // free install — record the (zero-price) purchase once
    await db.marketPurchase.upsert({
      where: { listingId_buyerId: { listingId, buyerId: user.id } },
      create: { listingId, buyerId: user.id, priceInr: 0 },
      update: {},
    }).catch(() => {})
  }

  const res = await installListing({
    listingId,
    buyerId: user.id,
    buyerName: user.name,
    title: listing.title,
  })
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 })
  await db.marketListing.update({ where: { id: listingId }, data: { installs: { increment: 1 } } }).catch(() => {})
  return NextResponse.json({ ok: true, projectId: res.projectId, projectName: res.projectName, fileCount: res.fileCount })
}
