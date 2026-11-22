/**
 * v115 — Big Billion Day window math verification (pure, no DB).
 * Runs the boundary hours through bigBillionDayState() and asserts exactness.
 */
import { bigBillionDayState } from '../src/lib/bbd'

let pass = 0, fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} — ${detail}`) }
}

// IST is UTC+5:30 → IST 08:00 on the 1st = UTC 02:30 on the 1st
// IST 12:00 on the 1st = UTC 06:30 on the 1st

function ist(day: number, hour: number, minute = 0, month = 9, year = 2026): Date {
  // build IST wall clock → UTC instant
  return new Date(Date.UTC(year, month, day, hour, minute) - 5.5 * 3600 * 1000)
}

// ACTIVE cases — Nov 1 2026 (month index 10)
for (const [h, m] of [[8, 0], [9, 30], [11, 59]]) {
  const s = bigBillionDayState(ist(1, h, m, 10))
  check(`active Nov 1 ${h}:${String(m).padStart(2, '0')} IST`, s.active === true, JSON.stringify(s))
}
// ends exactly at 12:00 IST = 06:30 UTC
{
  const s = bigBillionDayState(ist(1, 8, 0, 10))
  check('window ends at 12:00 IST', s.endsAt === ist(1, 12, 0, 10).toISOString(), `${s.endsAt}`)
}
// INACTIVE cases
{
  const s = bigBillionDayState(ist(1, 7, 59, 10))
  check('inactive before 08:00 IST (07:59)', s.active === false, JSON.stringify(s))
}
{
  const s = bigBillionDayState(ist(1, 12, 0, 10))
  check('inactive at exactly 12:00 IST', s.active === false, JSON.stringify(s))
}
{
  const s = bigBillionDayState(ist(2, 10, 0, 10))
  check('inactive on the 2nd', s.active === false, JSON.stringify(s))
}
{
  const s = bigBillionDayState(ist(15, 10, 0, 9))
  check('inactive mid-month', s.active === false, JSON.stringify(s))
}
// nextAt correctness: Oct 15 → next window Nov 1 08:00 IST
{
  const s = bigBillionDayState(ist(15, 10, 0, 9))
  const expected = ist(1, 8, 0, 10).toISOString()
  check('nextAt from Oct 15 → Nov 1 08:00 IST', s.nextAt === expected, `${s.nextAt} vs ${expected}`)
}
// nextAt on the 1st BEFORE the window (07:00) → same day 08:00
{
  const s = bigBillionDayState(ist(1, 7, 0, 10))
  const expected = ist(1, 8, 0, 10).toISOString()
  check('nextAt Nov 1 07:00 → same day 08:00 IST', s.nextAt === expected, `${s.nextAt}`)
}
// year rollover: Dec 15 2026 → Jan 1 2027
{
  const s = bigBillionDayState(ist(15, 10, 0, 11, 2026))
  const expected = ist(1, 8, 0, 0, 2027).toISOString()
  check('year rollover Dec 15 → Jan 1 08:00 IST', s.nextAt === expected, `${s.nextAt} vs ${expected}`)
}

console.log(`\nRESULT: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
