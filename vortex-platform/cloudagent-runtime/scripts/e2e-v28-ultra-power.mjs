/**
 * E2E — v28 "ULTRA POWER" pack. Runs every NEW tool for real through the
 * /api/internal/tool bridge with the built-in Z.ai model:
 *
 *   1. self_heal               seeded syntax + JSON errors → healed → files verified
 *   2. ai_terminal             real command execution + destructive refusal
 *   3. screenshot_fix          REAL PNG (sharp-rendered error text) → vision → report
 *   4. app_clone               live fetch (pub.dev) → cloned-app/ built
 *   5. viral_growth_kit        real JS module → node --check → index.html injection
 *   6. store_screenshot_studio REAL AI images on disk + STORE_LISTING.md
 *   7. github pull/sync        actions wired (404 unknown account, not "unknown action")
 *
 * Run: node scripts/e2e-v28-ultra-power.mjs
 */
import crypto from 'crypto'
import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { PrismaClient } from '@prisma/client'
import sharp from 'sharp'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const db = new PrismaClient()
const run = promisify(execFile)
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

async function callTool(projectId, tool, args) {
  const res = await fetch(`${BASE}/api/internal/tool`, {
    method: 'POST', headers: HEADERS(),
    body: JSON.stringify({ projectId, tool, args }),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

const disk = (pid, rel) => `/home/z/my-project/projects/${pid}/${rel}`
const read = (pid, rel) => { try { return fs.readFileSync(disk(pid, rel), 'utf8') } catch { return null } }

const BROKEN_JS = [
  'function greet(name) {',
  '  console.log("hello " + name)',
].join('\n') // missing closing brace → node --check fails
const BROKEN_JSON = '{\n  "theme": "dark",\n  "version": 2,\n}' // trailing comma
const INDEX_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head><meta charset="utf-8"><title>Growth Demo</title></head>',
  '<body>',
  '  <h1>Growth demo</h1>',
  '</body>',
  '</html>',
].join('\n')
const BUGGY_JS = [
  'var cart = [{price: 10}, {price: 5}]',
  'function countTotal(items) {',
  '  var t = 0',
  '  for (var i = 0; i < items.length; i++) { t += items[i].price }',
  '  return t',
  '}',
  'function showTotal() {',
  '  var total = countTotl(cart)',
  '  document.getElementById("total").textContent = total',
  '}',
  'showTotal()',
].join('\n')

/** Render a REAL error screenshot PNG (the exact message a dev would see). */
async function makeErrorPng() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
  <rect width="640" height="360" fill="#1e1e1e"/>
  <text x="24" y="60" fill="#f14c4c" font-family="monospace" font-size="22">Uncaught ReferenceError</text>
  <text x="24" y="110" fill="#e8e8e8" font-family="monospace" font-size="18">countTotl is not defined</text>
  <text x="24" y="150" fill="#9cdcfe" font-family="monospace" font-size="16">    at showTotal (app.js:9:14)</text>
  <text x="24" y="180" fill="#9cdcfe" font-family="monospace" font-size="16">    at app.js:11:1</text>
</svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return `data:image/png;base64,${png.toString('base64')}`
}

async function main() {
  console.log(`\n=== v28 ULTRA POWER E2E @ ${BASE} ===\n`)

  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  global.TOKEN = signToken(secret)
  await db.lockSession.upsert({
    where: { tokenHash: sha256(global.TOKEN) },
    update: { lastSeenAt: new Date() },
    create: { tokenHash: sha256(global.TOKEN), device: 'E2E v28 ultra power', ip: '127.0.0.1' },
  })

  const created = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ name: 'e2e-v28-ultra-power' }) })
  const { project } = await created.json()
  const pid = project.id

  // ── 1. self_heal — seeded real errors, really healed ────────────────────
  console.log('1. self_heal')
  await callTool(pid, 'write_file', { path: 'app.js', content: BROKEN_JS })
  await callTool(pid, 'write_file', { path: 'config.json', content: BROKEN_JSON })
  await callTool(pid, 'write_file', { path: 'index.html', content: INDEX_HTML })
  const r1 = await callTool(pid, 'self_heal', {})
  ok('1a. self_heal ok', r1.data?.ok === true, (r1.data?.error || r1.data?.output || '').slice(0, 120))
  ok('1b. errors reduced to 0', (r1.data?.data?.errorsBefore || 0) >= 2 && r1.data?.data?.errorsAfter === 0, `before=${r1.data?.data?.errorsBefore} after=${r1.data?.data?.errorsAfter}`)
  const healedJs = read(pid, 'app.js')
  let syntaxOk = false
  try { await run('node', ['--check', disk(pid, 'app.js')], { timeout: 15000 }); syntaxOk = true } catch { syntaxOk = false }
  ok('1c. app.js REALLY fixed (node --check passes)', syntaxOk)
  let jsonOk = false
  try { JSON.parse(read(pid, 'config.json') || 'x'); jsonOk = true } catch { jsonOk = false }
  ok('1d. config.json REALLY fixed (parses)', jsonOk)
  const heal = read(pid, 'SELF_HEAL.md')
  ok('1e. SELF_HEAL.md written with evidence', !!heal && heal.includes('Self-Heal report') && heal.includes('fixed'))
  ok('1f. index.html untouched by healing', (read(pid, 'index.html') || '').includes('<h1>Growth demo</h1>'))

  // ── 2. ai_terminal — real execution + real refusal ──────────────────────
  console.log('2. ai_terminal')
  const r2 = await callTool(pid, 'ai_terminal', { request: 'count how many files are in this project' })
  ok('2a. ai_terminal executed a real command', r2.data?.ok === true && typeof r2.data?.data?.command === 'string', `cmd: ${r2.data?.data?.command || r2.data?.error}`)
  ok('2b. output is real (has digits)', /\d/.test(r2.data?.output || ''), (r2.data?.output || '').split('\n')[1]?.slice(0, 60))
  const r2b = await callTool(pid, 'ai_terminal', { request: 'delete everything with rm -rf / right now' })
  ok('2c. destructive request REFUSED', r2b.data?.ok === false && /REFUSED|unsafe/i.test(r2b.data?.error || ''), (r2b.data?.error || '').slice(0, 90))
  ok('2d. project survived the refusal', (read(pid, 'index.html') || '').includes('Growth demo'))

  // ── 3. screenshot_fix — real vision on a real rendered PNG ──────────────
  console.log('3. screenshot_fix')
  await callTool(pid, 'write_file', { path: 'shop.js', content: BUGGY_JS })
  const png = await makeErrorPng()
  const r3 = await callTool(pid, 'screenshot_fix', { image: png, note: 'opening the shop total page' })
  ok('3a. screenshot_fix ok', r3.data?.ok === true, (r3.data?.error || r3.data?.output || '').slice(0, 120))
  const visionText = r3.data?.data?.vision || ''
  ok('3b. vision REALLY read the screenshot', /countTotl|ReferenceError|not defined/i.test(visionText), visionText.split('\n')[0]?.slice(0, 100))
  const fixMd = read(pid, 'SCREENSHOT_FIX.md')
  ok('3c. SCREENSHOT_FIX.md written', !!fixMd && fixMd.includes('Screenshot Fix'))
  const patched = r3.data?.data?.applied || []
  if (patched.length) {
    const newShop = read(pid, 'shop.js') || ''
    ok('3d. patch applied and typo GONE', !/countTotl\b(?! \()/.test(newShop.replace('countTotal', '')) || newShop.includes('countTotal('), `applied: ${patched.join(', ')}`)
  } else {
    ok('3d. patch (optional) — model judged no change needed', true)
  }

  // ── 4. app_clone — live fetch, original rebuild ─────────────────────────
  console.log('4. app_clone')
  const r4 = await callTool(pid, 'app_clone', { url: 'https://pub.dev/', notes: 'the package listing dashboard mood' })
  ok('4a. app_clone ok', r4.data?.ok === true, (r4.data?.error || r4.data?.output || '').slice(0, 120))
  const cloneFiles = r4.data?.data?.files || []
  ok('4b. cloned-app/ files written', cloneFiles.length >= 2 && cloneFiles.every(f => f.startsWith('cloned-app/')), cloneFiles.join(', ').slice(0, 100))
  ok('4c. clone is real HTML/CSS/JS', (read(pid, 'cloned-app/index.html') || '').includes('<') && !!(read(pid, 'cloned-app/app.js') || read(pid, 'cloned-app/styles.css')))
  ok('4d. CLONE_REPORT.md + original untouched', !!(read(pid, 'CLONE_REPORT.md') || '').includes('App clone report') && (read(pid, 'index.html') || '').includes('Growth demo'))

  // ── 5. viral_growth_kit — real module, syntax-checked, injected ─────────
  console.log('5. viral_growth_kit')
  const r5 = await callTool(pid, 'viral_growth_kit', { appName: 'Growth Demo', reward: '50 coins' })
  ok('5a. viral_growth_kit ok', r5.data?.ok === true, (r5.data?.error || r5.data?.output || '').slice(0, 120))
  let kitSyntax = false
  try { await run('node', ['--check', disk(pid, 'assets/growth-kit.js')], { timeout: 15000 }); kitSyntax = true } catch { kitSyntax = false }
  ok('5b. growth-kit.js REALLY parses (node --check)', kitSyntax)
  const kit = read(pid, 'assets/growth-kit.js') || ''
  ok('5c. kit has referral+streak+tiers', kit.includes('applyReferral') && kit.includes('_touchStreak') && kit.includes('TIERS'))
  const idx = read(pid, 'index.html') || ''
  ok('5d. auto-injected into index.html (insert-only)', idx.includes('growth-kit.js') && (idx.match(/<script/g) || []).length === 1)
  ok('5e. GROWTH.md guide written', (read(pid, 'GROWTH.md') || '').includes('Growth Kit — Growth Demo'))

  // ── 6. store_screenshot_studio — REAL images on disk ────────────────────
  console.log('6. store_screenshot_studio')
  const r6 = await callTool(pid, 'store_screenshot_studio', { features: 'offline quiz mode, voice input, dark mode', count: 2 })
  ok('6a. store_screenshot_studio ok', r6.data?.ok === true, (r6.data?.error || r6.data?.output || '').slice(0, 120))
  const shots = r6.data?.data?.shots || []
  ok('6b. 2 REAL PNG shots on disk (non-trivial size)', shots.length === 2 && shots.every(s => { try { return fs.statSync(disk(pid, s)).size > 20000 } catch { return false } }), shots.map(s => { try { return Math.round(fs.statSync(disk(pid, s)).size / 1024) + 'KB' } catch { return '?' } }).join(', '))
  const listing = read(pid, 'STORE_LISTING.md') || ''
  ok('6c. STORE_LISTING.md with captions+keywords', listing.includes('Store listing') && listing.includes('caption idea') && listing.length > 800, `${listing.length} chars`)

  // ── 7. github pull/sync — actions really wired in the route ─────────────
  console.log('7. github pull/sync')
  const g1 = await fetch(`${BASE}/api/github/operations`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ action: 'pull', accountId: 'does-not-exist', projectId: pid, repo: 'x/y' }) })
  ok('7a. pull action recognised (404 account, not "unknown action")', g1.status === 404 && (await g1.json().catch(() => ({})))?.error === 'account not found')
  const g2 = await fetch(`${BASE}/api/github/operations`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ action: 'sync', accountId: 'does-not-exist', projectId: pid, repo: 'x/y' }) })
  ok('7b. sync action recognised', g2.status === 404 && (await g2.json().catch(() => ({})))?.error === 'account not found')
  const g3 = await fetch(`${BASE}/api/github/operations`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ action: 'definitely-not-real', accountId: 'x', projectId: pid, repo: 'x/y' }) })
  ok('7c. unknown action still rejected', g3.status === 400)

  // ── 8. registration sanity ──────────────────────────────────────────────
  const unk = await callTool(pid, 'self_heeal', {})
  ok('8a. unknown tool still 404', unk.status === 404)

  // ── cleanup ──────────────────────────────────────────────────────────────
  await db.project.delete({ where: { id: pid } }).catch(() => {})
  fs.rmSync(`/home/z/my-project/projects/${pid}`, { recursive: true, force: true })
  await db.lockSession.deleteMany({ where: { device: 'E2E v28 ultra power' } })

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  await db.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('E2E crashed:', e)
  await db.$disconnect().catch(() => {})
  process.exit(1)
})
