/**
 * v116 — PLATFORM CONTROL SWITCHES (owner's secret control room)
 *
 * The owner asked: "admin panel theke puro app ke control korar jonno
 * shonno doroner feature rakho". This lib is the server-side truth for
 * every global switch the control room exposes:
 *
 *   maintenance         — whole site shows a maintenance page (admins pass)
 *   maintenanceMessage  — the human sentence on that page
 *   signupsEnabled      — new registrations open/closed
 *   aiRunsEnabled       — the AI builder accepts runs or refuses politely
 *   bbdOverride         — '' (clock decides) | 'on' (force open) | 'off' (force shut)
 *   announcement        — banner text shown to every signed-in user ('' = none)
 *   announcementLevel   — info | warning | critical
 *
 * Storage: UserSetting KV (key `platform_control_v1`) — no migration needed.
 * Reads are cached in-process for 30s so the enforcement points (middleware,
 * plan-guard, register) stay FREE on hot paths: one DB read per 30s per pod,
 * everything else rides memory.
 */
import { db } from '@/lib/db'

const KEY = 'platform_control_v1'
const CACHE_MS = 30_000

export interface ControlFlags {
  maintenance: boolean
  maintenanceMessage: string
  signupsEnabled: boolean
  aiRunsEnabled: boolean
  bbdOverride: '' | 'on' | 'off'
  announcement: string
  announcementLevel: 'info' | 'warning' | 'critical'
  siteOpen: boolean // v135 — false = the private access-code gate is enforced
}

export const DEFAULT_FLAGS: ControlFlags = {
  maintenance: false,
  maintenanceMessage: 'CloudAgent is getting a quick upgrade — back in a few minutes.',
  signupsEnabled: true,
  aiRunsEnabled: true,
  bbdOverride: '',
  announcement: '',
  announcementLevel: 'info',
  siteOpen: true, // v135 — OPEN by default: users pay → dashboard, no access code
}

type CacheShape = { flags: ControlFlags; at: number }
const g = globalThis as unknown as { __caControlCache?: CacheShape }

function parse(raw: string | null | undefined): ControlFlags {
  if (!raw) return { ...DEFAULT_FLAGS }
  try {
    const parsed = JSON.parse(raw) as Partial<ControlFlags>
    return {
      maintenance: Boolean(parsed.maintenance),
      maintenanceMessage: typeof parsed.maintenanceMessage === 'string' && parsed.maintenanceMessage.trim()
        ? parsed.maintenanceMessage.slice(0, 300)
        : DEFAULT_FLAGS.maintenanceMessage,
      signupsEnabled: parsed.signupsEnabled !== false, // default OPEN
      aiRunsEnabled: parsed.aiRunsEnabled !== false, // default OPEN
      bbdOverride: parsed.bbdOverride === 'on' || parsed.bbdOverride === 'off' ? parsed.bbdOverride : '',
      announcement: typeof parsed.announcement === 'string' ? parsed.announcement.slice(0, 300) : '',
      announcementLevel: parsed.announcementLevel === 'warning' || parsed.announcementLevel === 'critical'
        ? parsed.announcementLevel
        : 'info',
      siteOpen: parsed.siteOpen !== false, // default OPEN (v135)
    }
  } catch {
    return { ...DEFAULT_FLAGS }
  }
}

/** Live flags — 30s in-process cache, safe to call on every request. */
export async function getControlFlags(): Promise<ControlFlags> {
  const hit = g.__caControlCache
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.flags
  let flags: ControlFlags
  try {
    const row = await db.userSetting.findUnique({ where: { key: KEY } }).catch(() => null)
    flags = parse(row?.value)
  } catch {
    flags = { ...DEFAULT_FLAGS }
  }
  g.__caControlCache = { flags, at: Date.now() }
  return flags
}

/** Merge-patch flags from the control room; invalidates the cache instantly. */
export async function setControlFlags(patch: Partial<ControlFlags>): Promise<ControlFlags> {
  const current = await getControlFlags()
  const next = parse(JSON.stringify({ ...current, ...patch }))
  await db.userSetting.upsert({
    where: { key: KEY },
    update: { value: JSON.stringify(next) },
    create: { key: KEY, value: JSON.stringify(next) },
  })
  g.__caControlCache = { flags: next, at: Date.now() }
  return next
}

/** Test hook / cache-buster after direct DB edits. */
export function invalidateControlCache(): void {
  g.__caControlCache = undefined
}
