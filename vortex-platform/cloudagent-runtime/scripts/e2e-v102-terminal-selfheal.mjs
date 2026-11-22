// Task 102: terminal SELF-HEAL simulation — mimics the fixed TerminalPane client.
// 1. start session A, run cmd, verify output
// 2. kill A server-side (simulates a server restart wiping the in-memory Map)
// 3. poll A → 404  → client self-heal: re-start → session B
// 4. run cmd in B → verify output (pane survives without page reload)
// 5. 410 path: type `exit` in a fresh session → ended → re-mint works too
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const db = new PrismaClient()
const base = 'http://localhost:3000'
const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
if (!secret) { console.error('no lock_secret'); process.exit(1) }
const expiry = (Date.now() + 60 * 60 * 1000).toString()
const token = `v1.${expiry}.${crypto.createHmac('sha256', secret).update('v1.' + expiry).digest('hex')}`
const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
await db.lockSession.upsert({ where: { tokenHash }, update: { lastSeenAt: new Date() }, create: { tokenHash, lastSeenAt: new Date() } })
const H = { 'Content-Type': 'application/json', 'x-ca-lock': token }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const projectId = (await db.project.findFirst({ select: { id: true } }))?.id
if (!projectId) { console.error('no project'); process.exit(1) }

async function start() {
  const r = await fetch(`${base}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'start', projectId }) })
  if (!r.ok) throw new Error('start HTTP ' + r.status)
  return (await r.json()).sessionId
}
async function poll(sid) {
  const r = await fetch(`${base}/api/terminal?sessionId=${sid}`, { headers: H })
  return { status: r.status, body: r.ok ? await r.json() : null }
}
async function input(sid, data) {
  const r = await fetch(`${base}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'input', sessionId: sid, data }) })
  return r.status
}
async function kill(sid) {
  await fetch(`${base}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'kill', sessionId: sid }) })
}
async function runAndCollect(sid, cmd) {
  await input(sid, cmd + '\n')
  await sleep(1500)
  const { body } = await poll(sid)
  return body?.output || ''
}

let pass = 0, fail = 0
const ok = (cond, name) => { console.log((cond ? '✅' : '❌') + ' ' + name); cond ? pass++ : fail++ }

// --- Phase 1: normal session works
const sidA = await start()
const outA = await runAndCollect(sidA, 'echo PHASE_ONE_$((10+10))')
ok(outA.includes('PHASE_ONE_20'), 'phase 1: command runs in session A')

// --- Phase 2: server "restart" (kill = session wiped from memory) + self-heal
await kill(sidA)
const pA = await poll(sidA)
ok(pA.status === 404, 'phase 2: dead session polls 404 (was: silent freeze forever)')
// fixed-client self-heal: on 404 → re-mint
const sidB = await start()
ok(sidB && sidB !== sidA, 'phase 2: self-heal re-mints a NEW session (no page reload)')
const outB = await runAndCollect(sidB, 'echo SELF_HEAL_$((40+2))')
ok(outB.includes('SELF_HEAL_42'), 'phase 2: pane fully usable after reconnect')

// --- Phase 3: 410 path — shell exited (`exit`) → client reconnects
const inExit = await input(sidB, 'exit\n')
ok(inExit === 200, 'phase 3: exit command accepted')
await sleep(1200)
const pExit = await poll(sidB)
ok(pExit.body?.ended === true || pExit.status === 410 || pExit.body?.output?.includes('exited'), 'phase 3: ended state detected (was: bricked pane)')
const sidC = await start()
const outC = await runAndCollect(sidC, 'echo AFTER_EXIT_$((5+5))')
ok(outC.includes('AFTER_EXIT_10'), 'phase 3: fresh shell after exit, pane usable')

// cleanup
await kill(sidC)
console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
await db.$disconnect()
process.exit(fail ? 1 : 0)
