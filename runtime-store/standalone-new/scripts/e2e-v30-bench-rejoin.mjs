/**
 * v30 bench REJOIN — the big-app run outlived the bench client (the run keeps
 * going server-side thanks to unbreakable-runs). This rejoins via
 * /api/agent/resume, consumes until done, then verifies the app on disk.
 *
 * Usage: node scripts/e2e-v30-bench-rejoin.mjs [projectId] [runId?]
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const db = new PrismaClient()
const HEADERS = () => ({ 'Content-Type': 'application/json', 'x-ca-lock': global.TOKEN })
const ms = (x) => `${(x / 1000).toFixed(1)}s`

function signToken(secret, now = Date.now()) {
  const expiry = now + 30 * 24 * 60 * 60 * 1000
  const payload = `v1.${expiry}`
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${mac}`
}

async function main() {
  const argPid = process.argv[2]
  let argRunId = process.argv[3]

  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  global.TOKEN = signToken(secret)
  await db.lockSession.upsert({
    where: { tokenHash: crypto.createHash('sha256').update(global.TOKEN).digest('hex') },
    update: { lastSeenAt: new Date() },
    create: { tokenHash: crypto.createHash('sha256').update(global.TOKEN).digest('hex'), device: 'E2E v30 rejoin', ip: '127.0.0.1' },
  })

  // find the latest running agent run (or use args)
  const run = argRunId
    ? await db.agentRun.findUnique({ where: { id: argRunId } })
    : (await db.agentRun.findMany({ where: argPid ? { projectId: argPid } : {}, orderBy: { createdAt: 'desc' }, take: 5 })).find(r => r.status === 'running')
  if (!run) { console.error('no running agent run found'); process.exit(1) }
  const pid = run.projectId
  const startedAt = new Date(run.createdAt).getTime()
  console.log(`rejoining run ${run.id} (project ${pid}, started ${new Date(startedAt).toISOString()})`)

  const res = await fetch(`${BASE}/api/agent/resume`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ runId: run.id, from: 0 }) })
  if (!res.ok || !res.body) { console.error(`resume failed: ${res.status}`); process.exit(1) }

  let done = false, events = 0, toolCalls = 0, tokens = { in: 0, out: 0 }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const t0 = Date.now()
  while (!done) {
    const { done: rd, value } = await reader.read()
    if (rd) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith('{')) continue
      let ev; try { ev = JSON.parse(t) } catch { continue }
      if (ev.type === 'resumed') continue
      events++
      if (ev.type === 'tool_call') toolCalls++
      if (ev.type === 'done') done = true
      if (ev.type === 'error') console.log(`  [error] ${String(ev.content || '').slice(0, 140)}`)
    }
    if (Date.now() - t0 > 570_000) { console.log('rejoin window over — run still alive'); break }
  }
  const runRow = await db.agentRun.findUnique({ where: { id: run.id }, select: { status: true, updatedAt: true } })
  const finishedAt = runRow?.updatedAt ? new Date(runRow.updatedAt).getTime() : Date.now()
  console.log(`events replayed+tailed: ${events}, tool calls: ${toolCalls}`)
  console.log(`run status now: ${runRow?.status}`)

  // ── verify the app on disk ────────────────────────────────────────────────
  const dir = `/home/z/my-project/projects/${pid}`
  const files = []
  ;(function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) } else files.push(p)
    }
  })(dir)
  const rel = files.map(f => path.relative(dir, f))
  console.log(`\nproject files (excl. node_modules): ${rel.length}`)
  console.log(rel.slice(0, 25).join('\n'))

  const jsFiles = rel.filter(f => /\.(js|mjs|cjs)$/i.test(f) && !f.includes('growth-kit'))
  let broken = []
  for (const jf of jsFiles) {
    try { execFileSync('node', ['--check', path.join(dir, jf)], { timeout: 15000 }) }
    catch { broken.push(jf) }
  }
  console.log(`node --check: ${jsFiles.length - broken.length}/${jsFiles.length} valid${broken.length ? ' — BROKEN: ' + broken.join(', ') : ''}`)

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
  console.log(`feature surfaces: ${10 - missingF.length}/10${missingF.length ? ' — missing: ' + missingF.join(', ') : ''}`)

  // live HTTP smoke
  const runT = await fetch(`${BASE}/api/internal/tool`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ projectId: pid, tool: 'run_project', args: {} }) })
  const runD = await runT.json().catch(() => ({}))
  if (runD?.ok && runD?.data?.url) {
    const smoke = await fetch(runD.data.url, { signal: AbortSignal.timeout(15000) }).catch(() => ({ ok: false }))
    console.log(`HTTP smoke: ${smoke.ok ? 'OK ' + smoke.status : 'FAILED'}`)
    if (smoke.ok) {
      const html = await smoke.text()
      console.log(`served ${html.length} bytes, SwiftChat marker: ${/swiftchat|chat/i.test(html)}`)
    }
  } else {
    console.log(`HTTP smoke: runtime start failed — ${String(runD?.error || '').slice(0, 100)}`)
  }

  console.log(`\nTOTAL WALL-CLOCK (create → finish): ${ms(finishedAt - startedAt)}`)
  await db.lockSession.deleteMany({ where: { device: 'E2E v30 rejoin' } })
  await db.$disconnect()
}

main().catch(async (e) => {
  console.error('rejoin crashed:', e)
  await db.$disconnect().catch(() => {})
  process.exit(1)
})
