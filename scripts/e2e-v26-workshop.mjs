/**
 * E2E — v26 "Workshop Pack" (ai_code_review, i18n_builder, theme_studio,
 * a11y_audit) + v25.5 fingerprint-in-iframe guidance strings shipped to the
 * client. Runs real tools through the /api/internal/tool bridge with the
 * built-in Z.ai model for the LLM-backed ones.
 *
 * Run: node scripts/e2e-v26-workshop.mjs
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

async function callTool(projectId, tool, args) {
  const res = await fetch(`${BASE}/api/internal/tool`, {
    method: 'POST', headers: HEADERS(),
    body: JSON.stringify({ projectId, tool, args }),
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

const BAD_HTML = [
  '<!DOCTYPE html>',
  '<html>',
  '<head><title>My App</title></head>',
  '<body style="color:#111111;background-color:#111111">',
  '  <img src="logo.png">',
  '  <input type="text" name="q" tabindex="2">',
  '  <button></button>',
  '  <a href="/more"></a>',
  '</body>',
  '</html>',
].join('\n')
const SAMPLE_JS = [
  'function getUser(id) {',
  '  var data = eval("({id:" + id + "})"); // dynamic eval',
  '  document.getElementById("out").innerHTML = data.id;',
  '  return data;',
  '}',
  'getUser(1);',
].join('\n')

async function main() {
  console.log(`\n=== v26 Workshop Pack E2E @ ${BASE} ===\n`)

  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  global.TOKEN = signToken(secret)
  await db.lockSession.upsert({
    where: { tokenHash: sha256(global.TOKEN) },
    update: { lastSeenAt: new Date() },
    create: { tokenHash: sha256(global.TOKEN), device: 'E2E v26 workshop', ip: '127.0.0.1' },
  })

  const created = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ name: 'e2e-v26-workshop' }) })
  const { project } = await created.json()
  const pid = project.id

  await callTool(pid, 'write_file', { path: 'index.html', content: BAD_HTML })
  await callTool(pid, 'write_file', { path: 'app.js', content: SAMPLE_JS })

  // ── 1. a11y_audit (deterministic, no LLM needed to pass) ────────────────
  const r1 = await callTool(pid, 'a11y_audit', {})
  ok('1a. a11y_audit ok', r1.data?.ok === true, (r1.data?.output || r1.data?.error || '').slice(0, 100))
  ok('1b. findings reported (alt/lang/tabindex/empty button…)', (r1.data?.data?.count || 0) >= 5, `count=${r1.data?.data?.count}`)
  const a11y = fs.readFileSync(`/home/z/my-project/projects/${pid}/A11Y_REPORT.md`, 'utf8')
  ok('1c. A11Y_REPORT.md written with file:line findings', a11y.includes('index.html:5') && a11y.includes('alt'))

  // ── 2. i18n_builder (REAL LLM translation en→bn) ────────────────────────
  const r2 = await callTool(pid, 'i18n_builder', { languages: ['en', 'bn'], keys: ['Welcome', 'Settings', 'Save', 'Cancel'] })
  ok('2a. i18n_builder ok', r2.data?.ok === true, (r2.data?.error || r2.data?.output || '').slice(0, 100))
  const bn = JSON.parse(fs.readFileSync(`/home/z/my-project/projects/${pid}/locales/bn.json`, 'utf8'))
  ok('2b. locales/bn.json has REAL Bangla translations', typeof bn['Welcome'] === 'string' && /[\u0980-\u09FF]/.test(bn['Welcome']), `Welcome → ${bn['Welcome']}`)
  const i18njs = fs.readFileSync(`/home/z/my-project/projects/${pid}/js/i18n.js`, 'utf8')
  ok('2c. js/i18n.js helper written', i18njs.includes('I18N') && i18njs.includes('locales/'))

  // ── 3. theme_studio (REAL LLM design tokens) ────────────────────────────
  const r3 = await callTool(pid, 'theme_studio', { style: 'dark premium fintech, deep navy background with gold accents, rounded corners' })
  ok('3a. theme_studio ok', r3.data?.ok === true, (r3.data?.error || r3.data?.output || '').slice(0, 100))
  const theme = fs.readFileSync(`/home/z/my-project/projects/${pid}/assets/theme.css`, 'utf8')
  ok('3b. theme.css has tokens + dark mode', theme.includes('--color-bg') && theme.includes('data-theme="dark"'))
  const idx2 = fs.readFileSync(`/home/z/my-project/projects/${pid}/index.html`, 'utf8')
  ok('3c. <link> auto-injected into index.html', idx2.includes('assets/theme.css'))

  // ── 4. ai_code_review (REAL LLM review) ─────────────────────────────────
  const r4 = await callTool(pid, 'ai_code_review', { focus: 'security' })
  ok('4a. ai_code_review ok', r4.data?.ok === true, (r4.data?.error || r4.data?.output || '').slice(0, 100))
  const review = fs.readFileSync(`/home/z/my-project/projects/${pid}/CODE_REVIEW.md`, 'utf8')
  ok('4b. CODE_REVIEW.md is a real, substantive review', review.length > 1000 && /security|critical|fix/i.test(review) && /app\.js/.test(review), `${review.length} chars`)

  // ── 5. new tools registered for the swarm ───────────────────────────────
  const unk = await callTool(pid, 'a11y_audit_typo', {})
  ok('5a. unknown tool still 404 (registration sane)', unk.status === 404)

  // ── 6. fingerprint iframe-guidance code shipped to the client ───────────
  const lockPage = await fetch(`${BASE}/lock`, { headers: HEADERS() })
  const lockHtml = await lockPage.text()
  ok('6a. /lock served 200', lockPage.status === 200)
  const chunkUrls = [...lockHtml.matchAll(/\/_next\/static\/chunks\/[^"']+\.js/g)].map(m => m[0])
  let found = false
  for (const u of chunkUrls) {
    const c = await fetch(`${BASE}${u}`).then(r => r.text()).catch(() => '')
    if (c.includes('cross-origin child frames') && (c.includes('publickey-credentials') || c.includes('Permissions Policy'))) { found = true; break }
  }
  ok('6b. v25.5 frame-error classifier shipped in client JS', found, `${chunkUrls.length} chunks scanned`)

  // ── cleanup ──────────────────────────────────────────────────────────────
  await db.project.delete({ where: { id: pid } }).catch(() => {})
  fs.rmSync(`/home/z/my-project/projects/${pid}`, { recursive: true, force: true })
  await db.lockSession.deleteMany({ where: { device: 'E2E v26 workshop' } })

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  await db.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
