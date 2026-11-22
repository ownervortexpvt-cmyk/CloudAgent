import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

/**
 * v117.2 — PUBLIC build-version endpoint (powers the "New version available"
 * update notification on users' phones).
 *
 * How the update flow works:
 *   1. Every deploy produces a fresh BUILD_ID (Next.js writes .next/BUILD_ID).
 *   2. The client component <UpdateNotifier> (mounted in the root layout)
 *      polls this endpoint when the tab is visible and compares the value
 *      with the last one it stored in localStorage.
 *   3. Different build → banner "New version available — Tap to update".
 *      Tapping saves the new build id and reloads — the network-first
 *      service worker then serves the fresh shell. A system notification
 *      is also fired (best-effort) when the user has granted permission.
 *
 * no-store on purpose — a cached version check is a lie.
 */
let cachedBuildId: string | null = null

function getBuildId(): string {
  if (cachedBuildId) return cachedBuildId
  try {
    cachedBuildId = fs.readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim()
  } catch {
    cachedBuildId = 'dev'
  }
  return cachedBuildId
}

export async function GET() {
  return NextResponse.json(
    { ok: true, buildId: getBuildId(), at: Date.now() },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
