/**
 * v124 ⚡ ULTRA SPEED PASS — the utmost-speed run lane.
 *
 * "Ottonto speed" made real: when a user flips this switch, EVERY AI run
 * leads with the built-in GLM 5.3 Flash lane (the fastest responder in the
 * stack) instead of waiting on whatever provider sorts first in the pool.
 * The rest of the swarm still runs behind it as fallback — quality net is
 * never removed, only the starting line moves forward.
 *
 * Storage: UserSetting(`ultra_speed_pass:<userId>`) — per-user, same KV
 * pattern as the budget cap. Reads are cached in-process for 15s so the
 * /api/agent hot path pays one tiny memory lookup instead of a DB read.
 */

import { db } from '@/lib/db'

export const SPEED_PASS_PREFIX = 'ultra_speed_pass:'
export const speedPassKey = (userId: string) => `${SPEED_PASS_PREFIX}${userId}`

type CacheShape = Map<string, { on: boolean; at: number }>
const g = globalThis as unknown as { __caSpeedPassCache?: CacheShape }
function cache(): CacheShape {
  if (!g.__caSpeedPassCache) g.__caSpeedPassCache = new Map()
  return g.__caSpeedPassCache
}
const CACHE_MS = 15_000

/** Is the Ultra Speed Pass ON for this user? (15s in-process cache) */
export async function isSpeedPassOn(userId: string): Promise<boolean> {
  if (!userId) return false
  const hit = cache().get(userId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.on
  let on = false
  try {
    const row = await db.userSetting.findUnique({ where: { key: speedPassKey(userId) } })
    on = row?.value === '1'
  } catch { /* DB hiccup → default OFF, never block a run */ }
  cache().set(userId, { on, at: Date.now() })
  return on
}

/** Flip the pass on/off; invalidates the cache instantly. */
export async function setSpeedPass(userId: string, on: boolean): Promise<void> {
  const key = speedPassKey(userId)
  await db.userSetting.upsert({
    where: { key },
    update: { value: on ? '1' : '0' },
    create: { key, value: on ? '1' : '0' },
  })
  cache().set(userId, { on, at: Date.now() })
}

/** Test hook — clear a user's cached flag after direct DB edits. */
export function invalidateSpeedPass(userId?: string): void {
  if (userId) cache().delete(userId)
  else cache().clear()
}
