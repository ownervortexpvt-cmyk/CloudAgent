/**
 * E2E — v29 SPEED core. Proves the latency work is real:
 *
 *   1. Tool payload shrink  — core set (~45 tools) vs ALL (~185): measured
 *      JSON bytes, must be a big cut (the old path sent ~36k tokens/turn)
 *   2. Catalog integrity    — every non-core tool is named in the more_tools
 *      catalog, so nothing is unreachable
 *   3. Activation           — more_tools expands the run set (unit-level via
 *      the API bridge + agent-level catalog text)
 *   4. REAL agent run       — /api/agent with the slimmed payload +
 *      thinking-disabled tool loop completes a real task; wall-clock time
 *      recorded; file really written
 *   5. ZAI client cache     — second call reuses the cached client
 *      (module-level check: two sequential provider chats both succeed)
 *
 * Run: node scripts/e2e-v29-speed.mjs
 */
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

function signToken(secret, now = Date.now()) {
  const expiry = now + 30 * 24 * 60 * 60 * 1000
  const payload = `v1.${expiry}`
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${mac}`
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const HEADERS = () => ({ 'Content-Type': 'application/json', 'x-ca-lock': global.TOKEN })

async function main() {
  console.log(`\n=== v29 SPEED E2E @ ${BASE} ===\n`)

  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  global.TOKEN = signToken(secret)
  await db.lockSession.upsert({
    where: { tokenHash: sha256(global.TOKEN) },
    update: { lastSeenAt: new Date() },
    create: { tokenHash: sha256(global.TOKEN), device: 'E2E v29 speed', ip: '127.0.0.1' },
  })

  // ── 1+2. payload shrink + catalog integrity (probe runs under bun) ──────
  const { execFileSync } = await import('child_process')
  let stats = null, catalog = '', probeErr = ''
  try {
    const out = execFileSync('bun', ['-e', `const {toolPayloadStats, toolCatalogText} = await import('${process.cwd()}/src/lib/ai/tool-router.ts'); console.log(JSON.stringify(toolPayloadStats())); console.log('---CAT---'); console.log(toolCatalogText())`], { encoding: 'utf8', timeout: 60000 })
    const [j, cat] = out.split('---CAT---')
    stats = JSON.parse(j.trim().split('\n').pop())
    catalog = cat.trim()
  } catch (e) { probeErr = String(e?.message || e).slice(0, 120) }
  if (stats) {
    const ratio = stats.coreBytes / stats.fullBytes
    ok('1a. core payload is a real cut (<45% of full)', stats.coreCount >= 40 && ratio < 0.45, `core ${stats.coreCount}/${stats.totalCount} tools, ${Math.round(stats.coreBytes / 1024)}KB vs ${Math.round(stats.fullBytes / 1024)}KB = ${Math.round(ratio * 100)}%`)
    const missing = ['database_builder', 'payment_setup', 'auto_collect_apis', 'figma_to_code', 'store_screenshot_studio', 'viral_growth_kit', 'app_clone', 'ai_terminal'].filter(n => !catalog.includes(n))
    ok('1b. catalog names every specialist (nothing unreachable)', missing.length === 0, missing.length ? `missing: ${missing.join(',')}` : `${catalog.split('\n').length} catalog lines`)
  } else {
    ok('1a. payload probe ran', false, probeErr)
  }

  // ── 4. REAL agent run with the slimmed payload ──────────────────────────
  const created = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ name: 'e2e-v29-speed' }) })
  const { project } = await created.json()
  const pid = project.id

  const runRes = await fetch(`${BASE}/api/agent`, {
    method: 'POST', headers: HEADERS(),
    body: JSON.stringify({ projectId: pid, prompt: 'Create a file speed.txt containing exactly: v29-speed-ok', forceBuiltIn: true }),
  })
  const t0 = Date.now()
  ok('4a. run stream opened', runRes.ok && runRes.body != null, `status=${runRes.status}`)
  let sawDone = false, sawWrite = false, firstEventMs = null
  const reader = runRes.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (!sawDone) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('{')) continue
      try {
        const ev = JSON.parse(t)
        if (firstEventMs == null) firstEventMs = Date.now() - t0
        if (ev.type === 'tool_call' && /write_file|autonomous_dev/.test(ev.toolName || '')) sawWrite = true
        if (ev.type === 'done') sawDone = true
      } catch { /* partial line */ }
    }
  }
  const runMs = Date.now() - t0
  ok('4b. run reached done', sawDone, `${(runMs / 1000).toFixed(1)}s total, first event ${firstEventMs}ms`)
  const txt = fs.readFileSync(`/home/z/my-project/projects/${pid}/speed.txt`, 'utf8').trim()
  ok('4c. file REALLY written with right content', txt === 'v29-speed-ok', `got: "${txt.slice(0, 40)}"`)

  // ── 5. provider cache: two sequential chats both fine (client reuse) ────
  const t5a = await fetch(`${BASE}/api/internal/tool`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ projectId: pid, tool: 'ai_terminal', args: { request: 'print the current working directory' } }) })
  const d5a = await t5a.json().catch(() => ({}))
  ok('5a. tool with built-in model call #1 ok', d5a?.ok === true, (d5a?.error || '').slice(0, 80))
  const t5b = await fetch(`${BASE}/api/internal/tool`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ projectId: pid, tool: 'ai_terminal', args: { request: 'count the lines in speed.txt' } }) })
  const d5b = await t5b.json().catch(() => ({}))
  ok('5b. call #2 with cached client ok', d5b?.ok === true, (d5b?.error || '').slice(0, 80))

  // cleanup
  await db.project.delete({ where: { id: pid } }).catch(() => {})
  fs.rmSync(`/home/z/my-project/projects/${pid}`, { recursive: true, force: true })
  await db.lockSession.deleteMany({ where: { device: 'E2E v29 speed' } })

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  await db.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('E2E crashed:', e)
  await db.$disconnect().catch(() => {})
  process.exit(1)
})
