/**
 * v115 — BIG BILLION DAY (owner decision)
 *
 * There is NO free trial and NO standing free tier on this builder. Instead,
 * on the 1st of EVERY month, everyone — signed in or brand new — gets 4 free
 * hours: 08:00 → 12:00 IST (Asia/Kolkata, UTC+5:30, no DST). The owner calls
 * it "Big Billion Day" — a monthly flash-open like the big Indian sale days.
 *
 * Outside that window, building requires a paid plan (₹1,999+/mo).
 * During the window, free accounts get Pro-level limits (see plan-guard).
 *
 * The math is done in the IST wall clock so the window is EXACTLY 8–12 for
 * Indian users regardless of the server's own timezone.
 */

export const BBD_TIMEZONE_LABEL = 'IST (Indian Standard Time)'
export const BBD_DAY_OF_MONTH = 1 // the 1st of every month
export const BBD_START_HOUR = 8 // 08:00 IST
export const BBD_END_HOUR = 12 // 12:00 noon IST (4 hours)
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000 // +5:30, no DST

export interface BbdState {
  active: boolean
  /** ISO instant the current window closes (only when active). */
  endsAt?: string
  /** ISO instant the NEXT window opens (only when not active). */
  nextAt?: string
}

/** Shift an instant into the IST wall clock and read its Y/M/D/H fields. */
function istParts(now: Date) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(), // 0-based
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  }
}

/** IST wall clock → real UTC instant. */
function istToUtc(year: number, month: number, day: number, hour: number): Date {
  return new Date(Date.UTC(year, month, day, hour) - IST_OFFSET_MS)
}

/**
 * Is the Big Billion Day window open right now?
 * Pure function of the clock — no DB, no config, cannot drift.
 *
 * v116 — the control room can OVERRIDE the clock:
 *   override='on'  → window forced OPEN (owner opens free access early)
 *   override='off' → window forced SHUT (owner closes it mid-sale)
 * The override comes from lib/app-control (30s-cached, owner-only writes).
 */
export function bigBillionDayState(now: Date = new Date(), override: '' | 'on' | 'off' = ''): BbdState {
  if (override === 'on') {
    // Forced open: close the window 7 days out so UI countdowns stay sane.
    return { active: true, endsAt: new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString() }
  }
  const p = istParts(now)
  const isWindowDay = p.day === BBD_DAY_OF_MONTH
  const isWindowHours = p.hour >= BBD_START_HOUR && p.hour < BBD_END_HOUR

  if (override !== 'off' && isWindowDay && isWindowHours) {
    const endsAt = istToUtc(p.year, p.month, p.day, BBD_END_HOUR)
    return { active: true, endsAt: endsAt.toISOString() }
  }

  // Next window: the 1st of the current month at 08:00 IST, or next month's.
  let next = istToUtc(p.year, p.month, BBD_DAY_OF_MONTH, BBD_START_HOUR)
  if (next.getTime() <= now.getTime()) {
    const nm = p.month === 11 ? 0 : p.month + 1
    const ny = p.month === 11 ? p.year + 1 : p.year
    next = istToUtc(ny, nm, BBD_DAY_OF_MONTH, BBD_START_HOUR)
  }
  return { active: false, nextAt: next.toISOString() }
}

/** Human sentence for UI copy — always honest about the next window. */
export function bigBillionDayCopy(now: Date = new Date()): string {
  const s = bigBillionDayState(now)
  if (s.active && s.endsAt) {
    const mins = Math.max(1, Math.round((new Date(s.endsAt).getTime() - now.getTime()) / 60000))
    return `Big Billion Day is LIVE — free access for the next ${mins} min (until 12:00 IST).`
  }
  if (s.nextAt) {
    const d = new Date(s.nextAt)
    const when = d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    return `Next Big Billion Day: ${when} IST — 4 free hours, no card needed.`
  }
  return ''
}
