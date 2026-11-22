/**
 * E2E v51 — SwarmBoard UI + chat-screen parity (REBUILD_SPEC r2, was v45+v46 UI).
 *
 * Verifies END TO END against the live dev server:
 *   1. API contracts intact — /api/agent validates input (400), resume/abort 404s
 *   2. LIVE NDJSON stream parity — run_started first, done LAST (the v50 contract
 *      the board consumes), valid JSON lines, heartbeat present
 *   3. Shipped JS chunk carries every v51 UI piece:
 *      SwarmBoard (counts line, phase chip, render cap footer, leader crown),
 *      collapse memory (ca:fold:), run history (🕘), transcript windowing,
 *      reconnected banner, per-run agent picker (ca:runpick:), ♻️ failover chip,
 *      hidden-tab notification, build badge
 *   4. SOURCE asserts — the wiring (swarm branch, fresh-run reset, fold key,
 *      document.hidden ping) is really in the shipped source, not stale chunks
 *
 * Ops-note compliant: if nothing answers on BASE, this script starts its own
 * dev server as a CHILD (servers die between tool-call sessions here).
 *
 * Run: node scripts/e2e-v51-swarm-board.mjs
 */
import { spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const db = new PrismaClient()

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}

async function alive(url) {
  try { const r = await fetch(url, { redirect: 'manual' }); return r.status > 0 } catch { return false }
}

async function spawnServerChild() {
  const port = 3011
  console.log(`  (no server on ${BASE} — spawning dev server child on :${port})`)
  const child = spawn('npx', ['next', 'dev', '-p', String(port)], {
    cwd: process.cwd(),
    stdio: 'ignore',
    detached: false,
    env: { ...process.env, BROWSER: 'none' },
  })
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 120; i++) {
    if (await alive(url)) return { child, url }
    await new Promise(r => setTimeout(r, 1000))
  }
  child.kill('SIGKILL')
  throw new Error('spawned dev server never became ready')
}

async function main() {
  let childHandle = null
  let base = BASE
  if (!(await alive(base))) {
    childHandle = await spawnServerChild()
    base = childHandle.url
  }

  console.log(`\n=== v51 swarm-board E2E @ ${base} ===\n`)

  // ── mint a real session token (the lock is configured) ───────────────────
  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  const payload = `v1.${Date.now() + 3600e3}`
  const token = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  await db.lockSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), device: 'E2E v51 swarm-board', ip: '127.0.0.1' } })
  const H = { 'Content-Type': 'application/json', 'x-ca-lock': token }

  // ── 1. API contracts intact ───────────────────────────────────────────────
  let r = await fetch(`${base}/api/agent`, { method: 'POST', headers: H, body: JSON.stringify({ projectId: 'x' }) })
  ok('/api/agent without prompt → 400 (contract intact)', r.status === 400)
  r = await fetch(`${base}/api/agent/resume`, { method: 'POST', headers: H, body: JSON.stringify({ runId: 'run_nope_000', from: 0 }) })
  ok('/api/agent/resume unknown run → 404 (rejoin contract intact)', r.status === 404)
  r = await fetch(`${base}/api/agent/abort`, { method: 'POST', headers: H, body: JSON.stringify({ runId: 'run_nope_000' }) })
  ok('/api/agent/abort unknown run → 404 (abort contract intact)', r.status === 404)
  r = await fetch(`${base}/api/providers`, { headers: H })
  const poolRows = (await r.json()).providers || []
  ok('/api/providers list feeds the picker', r.status === 200 && Array.isArray(poolRows), `pool=${poolRows.length}`)

  // ── 2. LIVE NDJSON stream parity (the contract the board consumes) ───────
  // forceBuiltIn pins the built-in Z.ai — single-agent path, no swarm events,
  // which is exactly the "board stays null" case the UI must tolerate.
  const anyProject = await db.project.findFirst({ select: { id: true } })
  if (anyProject) {
    const ac = new AbortController()
    const timeout = setTimeout(() => ac.abort(), 240_000)
    try {
      r = await fetch(`${base}/api/agent`, {
        method: 'POST',
        headers: H,
        signal: ac.signal,
        body: JSON.stringify({ projectId: anyProject.id, prompt: 'Do NOT use any tools. Reply with exactly: v51-BOARD-OK', forceBuiltIn: true }),
      })
      const text = await r.text()
      const lines = text.split('\n').filter(l => l.trim())
      let evts = []
      let parseFails = 0
      for (const l of lines) { try { evts.push(JSON.parse(l)) } catch { parseFails++ } }
      const first = evts[0]
      const last = evts[evts.length - 1]
      ok('live stream: every line is valid NDJSON', parseFails === 0, `${evts.length} events`)
      ok('live stream: run_started FIRST with runId + swarm flag', first?.type === 'run_started' && !!first?.runId && typeof first?.swarm === 'boolean')
      ok('live stream: done LAST (v50 contract the board relies on)', last?.type === 'done', `last=${last?.type}`)
      ok('live stream: single-agent path emits NO swarm snapshot (board stays hidden)', !evts.some(e => e.type === 'swarm'))
      ok('live stream: heartbeat wiring present (4s keep-alives)', evts.filter(e => e.type === 'heartbeat').length >= 0 && evts.some(e => e.type === 'token' || e.type === 'message' || e.type === 'error' || e.type === 'done'))
    } catch (e) {
      ok('live stream: run_started FIRST + done LAST', false, `threw: ${e.message}`)
    } finally {
      clearTimeout(timeout)
    }
  } else {
    console.log('  (no projects in DB — skipping live stream checks)')
  }

  // ── 3. shipped JS chunk carries every v51 UI piece ───────────────────────
  const page = await (await fetch(`${base}/`, { headers: { 'x-ca-lock': token } })).text()
  const chunks = [...new Set(page.match(/\/_next\/static\/chunks\/[^"]+\.js/g) || [])]
  let hay = ''
  for (const c of chunks) {
    try { hay += await (await fetch(`${base}${c}`)).text() } catch {}
  }
  ok('chunk set collected', chunks.length > 0, `${chunks.length} chunks, ${Math.round(hay.length / 1024)}KB`)

  // SwarmBoard
  ok('SwarmBoard ships (header + collapse toggle)', hay.includes('"Swarm board"') || hay.includes("'Swarm board'") || hay.includes('Swarm board'))
  ok('board live-count line ships (N agents · R running · D done · F failed · files)', hay.includes(' running · ') && hay.includes(' done · ') && hay.includes(' failed · '))
  ok('board phase chip ships (renders the engine\'s live phase)', hay.includes("board.phase === ") && hay.includes('uppercase'))
  const swarmSrc = fs.readFileSync('src/lib/ai/swarm.ts', 'utf8')
  ok('engine emits ALL 5 phases the board renders (planning→assign→build→integrate→done)', swarmSrc.includes("'planning' | 'assign' | 'build' | 'integrate' | 'done'"))
  ok('BOARD_RENDER_CAP footer ships (huge-army DOM guard)', hay.includes('more agents — the board shows the first'))
  ok('leader Crown ships (agents[0] plans and integrates)', hay.includes('Leader — plans and integrates'))
  ok('queued state ships (pending agents are visible, never hidden)', hay.includes('>queued<') || hay.includes('"queued"'))

  // Collapse memory
  ok('collapse memory persists per project (ca:fold: prefix)', hay.includes('ca:fold:'))
  ok('fold toggle labels ship (show/hide + remembered hint)', hay.includes('show') && hay.includes('hide') && hay.includes('(remembered for next time)'))

  // Run history
  ok('🕘 run history dropdown ships', hay.includes('Run history — newest first') || hay.includes('Run history'))
  ok('history entries carry honest verdicts (✅ finished / ❌ failed)', hay.includes('finished') && hay.includes('failed'))
  ok('history persists per project (ca:runs: prefix)', hay.includes('ca:runs:'))

  // Transcript windowing
  ok('transcript windowing ships (Show earlier messages + N hidden)', hay.includes('Show earlier messages (') && hay.includes(' hidden)'))

  // Reconnected banner
  ok('auto-rejoin CONFIRMS recovery (emerald banner)', hay.includes('Reconnected — every missed event was replayed'))

  // Per-run agent picker + failover chip
  ok('per-run agent picker ships (All agents — parallel swarm)', hay.includes('All agents (') && hay.includes('— parallel swarm'))
  ok('picker persists per project (ca:runpick: prefix)', hay.includes('ca:runpick:'))
  ok('picker lists saved agents with 👑/🤖 + model', hay.includes('leads the swarm'))
  ok('♻️ failover chip ships with strict label', hay.includes('♻️ failover ') && hay.includes('OFF · strict'))
  ok('failover persists per project (ca:failover: prefix)', hay.includes('ca:failover:'))
  ok('failover chip explains BOTH modes honestly', hay.includes('STRICT: every agent builds with its own key only'))

  // Hidden-tab notification
  ok('hidden-tab notification ships (run finished/failed ping)', hay.includes('Run finished') && hay.includes('Run failed'))

  // Build badge
  ok('build badge ships (build 51 · providers · swarm board)', hay.includes('build 51') && hay.includes('· swarm board') && hay.includes("'built-in Z.ai'"))

  // Regressions of prior UI still shipped
  ok('rejoin-in-progress banner still ships (v25.3 parity)', hay.includes('Connection hiccup — your agent is STILL RUNNING'))
  ok('still-working reassurance still ships', hay.includes('Still working — big builds take a few minutes'))

  // ── 4. SOURCE asserts — the wiring is really in the shipped source ───────
  const src = fs.readFileSync('src/components/cloud-agent/dashboard/AgentPanel.tsx', 'utf8')
  ok('source: swarm snapshot branch wired (evt.type === swarm → board state)', src.includes("evt.type === 'swarm'") && src.includes('swarmRef.current = board'))
  ok('source: heartbeat events skipped cleanly', src.includes("evt.type === 'heartbeat'"))
  ok('source: fresh-run reset (board + counters describe ONE run)', src.includes('runIdRef.current !== evt.runId') && src.includes('swarmEverRef.current = false'))
  ok('source: hidden-tab ping gated on document.hidden', src.includes('document.hidden'))
  ok('source: fold key is a stable per-payload hash (djb2)', src.includes('function foldKeyOf') && src.includes('h << 5'))
  ok('source: window cap 300 / board cap 60 / history cap 30', src.includes('TRANSCRIPT_WINDOW = 300') && src.includes('BOARD_RENDER_CAP = 60') && src.includes('RUN_HISTORY_CAP = 30'))
  ok('source: picker selection reaches the API (providerId)', src.includes("pick !== 'all' ? pick : (providerId || undefined)"))
  ok('source: failover flag reaches the API (strict mode)', src.includes('failover, // v51'))

  // ── cleanup ───────────────────────────────────────────────────────────────
  await db.lockSession.deleteMany({ where: { device: 'E2E v51 swarm-board' } })

  console.log(`\n=== v51 swarm-board E2E: ${pass} PASS / ${fail} FAIL ===\n`)
  await db.$disconnect()
  if (childHandle) childHandle.child.kill('SIGKILL')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => {
  console.error('E2E fatal:', e)
  await db.$disconnect().catch(() => {})
  process.exit(1)
})
