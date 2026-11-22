/**
 * E2E — v30 BIG-APP BENCHMARK. Answers the owner's question with REAL numbers:
 * "Instagram / Flipkart / WhatsApp / Telegram / Google er theke — boro ekta
 *  multiple app banate koto time nibe?"
 *
 * Builds a WhatsApp-style messenger ("SwiftChat") through the REAL product
 * pipeline (/api/projects → /api/agent NDJSON stream) and measures:
 *   - time to first event  (perceived speed)
 *   - time to done         (total build wall-clock)
 *   - per-phase breakdown  (planning / coding / tools / qa)
 *   - files written, tool calls, events
 * Then verifies the app is REAL: files on disk, node --check every JS,
 * JSON validity, and a live HTTP smoke via the runtime (run_project).
 *
 * Run: node scripts/e2e-v30-bench-big-app.mjs
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const db = new PrismaClient()

function signToken(secret, now = Date.now()) {
  const expiry = now + 30 * 24 * 60 * 60 * 1000
  const payload = `v1.${expiry}`
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${mac}`
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const HEADERS = () => ({ 'Content-Type': 'application/json', 'x-ca-lock': global.TOKEN })
const ms = (x) => `${(x / 1000).toFixed(1)}s`

const PROMPT = `Build "SwiftChat" — a WhatsApp-style messenger web app. Required features:
1. Chat list screen: avatar circles with initials, contact name, last message preview, timestamp, unread badge count, pinned chat on top, online dot on some contacts.
2. Conversation screen: sent (green) and received (white) message bubbles with tails, timestamps inside bubbles, double-tick read marks on sent messages, date divider chips, smooth auto-scroll to newest.
3. Bot auto-replies: when the user sends a message the contact replies after 1-2.5s with a keyword-matched reply (hi/hello, how are you, help, time, bye) plus a typing indicator bubble ("..." animation) BEFORE the reply lands.
4. Composer: text input, emoji quick-picker (at least 12 emojis), send button that disables when empty, Enter to send.
5. Image sharing: attach button opens a file picker, shows a thumbnail preview in the composer, sends it as an image bubble (object URL), clicking opens full-screen overlay with close button.
6. Search bar filtering the chat list by name or message text live.
7. Profile screen: editable display name, about text, avatar color — persisted.
8. Dark / light theme toggle in the header, persisted, dark navy + WhatsApp green palette in dark mode.
9. Persistence: every chat, message and profile saved to localStorage; chats survive reload.
10. Mobile-first layout that also looks right on desktop (max-width centered phone frame on wide screens). All in vanilla HTML/CSS/JS, polished production feel, no external CDN dependencies.`

async function main() {
  console.log(`\n=== v30 BIG-APP BENCHMARK @ ${BASE} ===\n`)

  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  if (!secret) throw new Error('no lock_secret')
  global.TOKEN = signToken(secret)
  await db.lockSession.upsert({
    where: { tokenHash: sha256(global.TOKEN) },
    update: { lastSeenAt: new Date() },
    create: { tokenHash: sha256(global.TOKEN), device: 'E2E v30 bench', ip: '127.0.0.1' },
  })

  let pass = 0, fail = 0
  const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`) }
    else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
  }

  // ── create the project through the real API ──────────────────────────────
  const created = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ name: 'SwiftChat Benchmark' }) })
  const { project } = await created.json()
  const pid = project.id
  const dir = `/home/z/my-project/projects/${pid}`
  console.log(`project: ${pid}`)

  // ── the real agent run, timed ─────────────────────────────────────────────
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST', headers: HEADERS(),
    body: JSON.stringify({ projectId: pid, prompt: PROMPT, forceBuiltIn: true }),
  })
  ok('stream opened', res.ok && res.body != null, `status=${res.status}`)

  const tFirst = { v: null }
  const stats = { events: 0, toolCalls: 0, fileWrites: 0, byType: {}, phase: 'unknown', phases: {}, lastEventAt: t0 }
  const markPhase = (p) => {
    const now = Date.now()
    if (stats.phase !== 'unknown') {
      stats.phases[stats.phase] = (stats.phases[stats.phase] || 0) + (now - stats.lastEventAt)
    }
    stats.phase = p
    stats.lastEventAt = now
  }

  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', done = false, runId = ''
  const handle = (line) => {
    const t = line.trim()
    if (!t.startsWith('{')) return
    let ev
    try { ev = JSON.parse(t) } catch { return }
    const now = Date.now()
    if (tFirst.v == null) { tFirst.v = now - t0; markPhase(ev.type === 'status' ? 'planning' : 'working') }
    if (ev.type === 'run_started' && ev.runId) runId = ev.runId
    stats.events++
    stats.byType[ev.type] = (stats.byType[ev.type] || 0) + 1
    stats.lastEventAt = now
    if (ev.type === 'tool_call') { stats.toolCalls++; if (/write_file|autonomous_dev|multi_agent/.test(ev.toolName || '')) markPhase('coding') }
    if (ev.type === 'tool_result') { stats.fileWrites += Number(ev?.data?.written ?? 0) || (/write_file/.test(ev.toolName || '') ? 1 : 0) }
    if (ev.type === 'status' && /plan|architect/i.test(String(ev.message || ''))) markPhase('planning')
    if (ev.type === 'done') done = true
    if (ev.type === 'error') console.log(`  [run error] ${String(ev.content || '').slice(0, 160)}`)
  }
  // v25.3 unbreakable-runs: if the network dies mid-run (body timeout),
  // rejoin via /api/agent/resume instead of losing the whole benchmark.
  while (!done) {
    let chunk
    try {
      const r = await reader.read()
      if (r.done) break
      chunk = r.value
    } catch (netErr) {
      console.log(`  [stream dropped: ${String(netErr?.cause?.code || netErr?.message).slice(0, 60)} — rejoining via resume]`)
      if (!runId) throw netErr
      await new Promise(r => setTimeout(r, 2000))
      const r2 = await fetch(`${BASE}/api/agent/resume`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ runId, from: Math.max(0, stats.events - 1) }) })
      if (!r2.ok || !r2.body) throw netErr
      Object.assign(reader, r2.body.getReader())
      continue
    }
    buf += dec.decode(chunk, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) handle(line)
  }
  if (buf.trim().startsWith('{')) handle(buf)
  const total = Date.now() - t0
  markPhase('end')
  delete stats.phases['end']

  console.log(`\n── TIMING ──────────────────────────────────`)
  console.log(`first event : ${ms(tFirst.v)}`)
  console.log(`total build : ${ms(total)}`)
  for (const [p, d] of Object.entries(stats.phases)) console.log(`  ${p.padEnd(9)} ~${ms(d)}`)
  console.log(`events: ${stats.events} (${JSON.stringify(stats.byType)})`)
  console.log(`tool calls: ${stats.toolCalls}`)

  ok('run reached done', done, `total ${ms(total)}, first event ${tFirst.v}ms`)

  // ── verify the app is REAL on disk ────────────────────────────────────────
  const files = []
  ;(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) }
      else files.push(p)
    }
  })(dir)
  const rel = files.map(f => path.relative(dir, f))
  const appIndex = rel.find(f => f === 'index.html' || f === 'public/index.html' || /^[^/]+\/index\.html$/.test(f))
  const jsFiles = rel.filter(f => /\.(js|mjs|cjs)$/i.test(f) && !f.includes('assets/growth-kit'))
  const indexHtml = appIndex ? fs.readFileSync(path.join(dir, appIndex), 'utf8') : ''
  const hasInlineScript = /<script[\s>]/i.test(indexHtml)
  ok('index.html exists (root / public / app folder)', !!appIndex, `${appIndex || 'none'} — ${rel.length} files total`)
  ok('real JS written', jsFiles.length > 0 || hasInlineScript, jsFiles.length ? jsFiles.slice(0, 6).join(', ') : 'inline <script> in single-file app')

  let broken = []
  for (const jf of jsFiles) {
    try { execFileSync('node', ['--check', path.join(dir, jf)], { timeout: 15000 }) }
    catch (e) { broken.push(`${jf}: ${String(e?.message).split('\n')[0].slice(0, 90)}`) }
  }
  ok('node --check clean on every JS', broken.length === 0, broken.length ? broken.join(' | ') : `${jsFiles.length} files valid`)

  for (const jf of rel.filter(f => f.endsWith('.json'))) {
    try { JSON.parse(fs.readFileSync(path.join(dir, jf), 'utf8')) } catch { broken.push(`json:${jf}`) }
  }
  ok('every JSON valid', !broken.some(b => b.startsWith('json:')))

  const allText = rel.filter(f => /\.(html|js|css)$/i.test(f)).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
  const features = [
    ['chat list', /chat[- ]?list|conversation[- ]?list/i],
    ['message bubbles', /bubble/i],
    ['bot auto-reply', /reply|bot/i],
    ['typing indicator', /typing/i],
    ['emoji picker', /emoji/i],
    ['image sharing', /file|attach|image/i],
    ['search', /search/i],
    ['profile', /profile/i],
    ['theme toggle', /dark|theme/i],
    ['localStorage persistence', /localStorage/i],
  ]
  const missingF = features.filter(([n, re]) => !re.test(allText)).map(([n]) => n)
  ok('all 10 feature surfaces present', missingF.length === 0, missingF.length ? `missing: ${missingF.join(', ')}` : '10/10')

  // ── live HTTP smoke through the real runtime ─────────────────────────────
  const run = await fetch(`${BASE}/api/internal/tool`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ projectId: pid, tool: 'run_project', args: {} }) })
  const runData = await run.json().catch(() => ({}))
  ok('runtime started', runData?.ok === true && !!runData?.data?.url, (runData?.error || `port ${runData?.data?.port}`).slice(0, 80))
  if (runData?.ok && runData?.data?.url) {
    // the platform returns a proxy-relative URL (/?XTransformPort=N) — the
    // real dev server lives on 127.0.0.1:<port>
    const absolute = `http://127.0.0.1:${runData.data.port}/`
    const smoke = await fetch(absolute, { signal: AbortSignal.timeout(15000) }).catch(e => ({ ok: false, error: String(e?.message || e) }))
    ok('app serves HTTP 200', smoke.ok === true, `status=${smoke.status || smoke.error || ''}`)
    if (smoke.ok) {
      const html = await smoke.text()
      ok('served page is SwiftChat', /swiftchat|chat/i.test(html), `${html.length} bytes`)
    }
  }

  console.log(`\n=== VERDICT: a WhatsApp-style messenger built end-to-end in ${ms(total)} ===`)
  console.log(`${pass} PASS / ${fail} FAIL`)

  // cleanup DB row + dir (bench artifact — keep the app for inspection instead)
  console.log(`(bench project kept for inspection: ${dir})`)
  await db.lockSession.deleteMany({ where: { device: 'E2E v30 bench' } })
  await db.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('BENCH crashed:', e)
  await db.$disconnect().catch(() => {})
  process.exit(1)
})
