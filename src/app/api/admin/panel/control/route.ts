/**
 * v116 — CONTROL-ROOM APP SWITCHES (the owner controls the WHOLE app).
 *
 * GET  → live ControlFlags + BBD state
 * POST { patch: { maintenance?, signupsEnabled?, aiRunsEnabled?, bbdOverride?,
 *                 announcement?, announcementLevel?, maintenanceMessage? } }
 *       → merge-patch + instant cache invalidation.
 *
 * Double-gated like every money/key/user endpoint: admin session AND the
 * room PIN (requireAdminUnlocked). Enforcement points:
 *   maintenance     → middleware (page rewrite + API 503)
 *   signupsEnabled  → /api/auth/register (first-account bootstrap exempt)
 *   aiRunsEnabled   → plan-guard.assertRunsGloballyEnabled (agent + multi-agent)
 *   bbdOverride     → lib/bbd via plan-guard + /api/billing/me + /api/auth/me
 *   announcement    → /api/auth/me payload → app-shell banner
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminUnlocked } from '@/lib/admin-lock'
import { getControlFlags, setControlFlags, DEFAULT_FLAGS, ControlFlags } from '@/lib/app-control'
import { bigBillionDayState } from '@/lib/bbd'

export async function GET(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }
  const flags = await getControlFlags()
  const bbd = bigBillionDayState(new Date(), flags.bbdOverride)
  return NextResponse.json({ ok: true, flags, bigBillionDay: bbd })
}

const LEVELS = ['info', 'warning', 'critical']

export async function POST(req: NextRequest) {
  try {
    await requireAdminUnlocked(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }

  const body = await req.json().catch(() => null)
  const patch = (body?.patch || {}) as Record<string, unknown>
  const clean: Partial<ControlFlags> = {}

  if (typeof patch.maintenance === 'boolean') clean.maintenance = patch.maintenance
  if (typeof patch.maintenanceMessage === 'string') {
    clean.maintenanceMessage = patch.maintenanceMessage.trim().slice(0, 300) || DEFAULT_FLAGS.maintenanceMessage
  }
  if (typeof patch.signupsEnabled === 'boolean') clean.signupsEnabled = patch.signupsEnabled
  if (typeof patch.siteOpen === 'boolean') clean.siteOpen = patch.siteOpen // v135 — access-code gate switch
  if (typeof patch.aiRunsEnabled === 'boolean') clean.aiRunsEnabled = patch.aiRunsEnabled
  if (patch.bbdOverride === 'on' || patch.bbdOverride === 'off' || patch.bbdOverride === '') {
    clean.bbdOverride = patch.bbdOverride
  }
  if (typeof patch.announcement === 'string') clean.announcement = patch.announcement.trim().slice(0, 300)
  if (LEVELS.includes(String(patch.announcementLevel))) {
    clean.announcementLevel = patch.announcementLevel as ControlFlags['announcementLevel']
  }

  if (Object.keys(clean).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing to change — send a patch with at least one switch' }, { status: 400 })
  }

  const flags = await setControlFlags(clean)
  return NextResponse.json({ ok: true, flags })
}
