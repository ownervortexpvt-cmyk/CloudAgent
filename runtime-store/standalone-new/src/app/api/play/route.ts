import { NextRequest, NextResponse } from 'next/server'
import { playStatus, savePlayCredentials, clearPlayCredentials } from '@/lib/play'
import { requireAdmin } from '@/lib/auth'

/**
 * v81 — Google Play service-account connection.
 *
 * GET                → { configured, clientEmail, projectIdHint }
 * POST { action:
 *   'save'  { json }         paste the service-account JSON key (validated)
 *   'clear'                  remove stored credentials
 * }
 * Uploads happen through POST /api/publish { target: 'google-play',
 * packageName } — this endpoint only manages credentials.
 */
export async function GET() {
  return NextResponse.json(await playStatus())
}

export async function POST(req: NextRequest) {
  // SECURITY FIX: Play credentials are PLATFORM-GLOBAL (owner's service
  // account). Any signed-in user used to be able to save/clear them —
  // overwrite the owner's key with an attacker-controlled one. Admin-only now.
  try { await requireAdmin(req) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  let body: { action?: string; json?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  if (body.action === 'save') {
    const r = await savePlayCredentials(String(body.json || ''))
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (body.action === 'clear') {
    await clearPlayCredentials()
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: "action must be 'save' or 'clear'" }, { status: 400 })
}
