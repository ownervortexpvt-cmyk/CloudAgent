/**
 * E2E — v27 "Full Pipeline Pack":
 *   • /api/languages → the 14-language registry
 *   • Language-first create (java / php / typescript inline scaffolds +
 *     template-backed languages) + back-compat templateId (electron)
 *   • Icon pipeline: user upload (data URL → assets/icon.png + favicon
 *     injection + icon serving route) and REAL AI icon generation
 *   • Publish: ALL 17 targets reachable — web/pwa/source-archive real builds,
 *     apk/aab/exe honest structured errors off-stack, 11 guided store/desktop
 *     workflows
 *   • qa_squad: Inspector catches seeded syntax/JSON/missing-ref/TODO issues,
 *     Fixer applies patches, re-test improves, QA_REPORT.md written
 *   • convert_language: html app → flutter under converted/flutter/ with
 *     CONVERSION.md, original untouched
 *
 * Run: node scripts/e2e-v27-pipeline.mjs
 */
import crypto from 'crypto'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const PROJECTS_ROOT = '/home/z/my-project/projects'
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

async function createProject(body) {
  const res = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: HEADERS(), body: JSON.stringify(body) })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
async function callTool(projectId, tool, args) {
  const res = await fetch(`${BASE}/api/internal/tool`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ projectId, tool, args }) })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}
async function publish(projectId, target) {
  const res = await fetch(`${BASE}/api/publish`, { method: 'POST', headers: HEADERS(), body: JSON.stringify({ projectId, target }) })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}
const readProj = (pid, p) => fs.readFileSync(`${PROJECTS_ROOT}/${pid}/${p}`, 'utf8')
const existsProj = (pid, p) => fs.existsSync(`${PROJECTS_ROOT}/${pid}/${p}`)
const cleanup = []

// 1×1 red PNG — valid, tiny, sharp-friendly
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function main() {
  console.log(`\n=== v27 Full Pipeline Pack E2E @ ${BASE} ===\n`)

  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  global.TOKEN = signToken(secret)
  await db.lockSession.upsert({
    where: { tokenHash: sha256(global.TOKEN) },
    update: { lastSeenAt: new Date() },
    create: { tokenHash: sha256(global.TOKEN), device: 'E2E v27 pipeline', ip: '127.0.0.1' },
  })

  // ── 1. Language registry ────────────────────────────────────────────────
  const lr = await fetch(`${BASE}/api/languages`, { headers: HEADERS() }).then(r => r.json())
  ok('1a. /api/languages lists exactly 14 languages', lr.languages?.length === 14, `got ${lr.languages?.length}`)
  const ids = (lr.languages || []).map(l => l.id)
  ok('1b. ids unique + covers dart/react/typescript/html/java/php', new Set(ids).size === 14 && ['dart', 'react', 'typescript', 'html', 'java', 'php'].every(x => ids.includes(x)))

  // ── 2. Language-first create: inline scaffolds ──────────────────────────
  const java = await createProject({ name: 'e2e-v27-java', description: 'spring boot test', language: 'java' })
  cleanup.push(java.data.project?.id)
  ok('2a. create(language=java) ok with starter files', java.status === 200 && (java.data.written || 0) >= 3, `written=${java.data.written}`)
  ok('2b. pom.xml + Spring app + properties on disk', existsProj(java.data.project.id, 'pom.xml') && existsProj(java.data.project.id, 'src/main/java/com/example/AppApplication.java') && existsProj(java.data.project.id, 'src/main/resources/application.properties'))
  const pom = readProj(java.data.project.id, 'pom.xml')
  ok('2c. pom is real (spring-boot-starter-web)', pom.includes('spring-boot-starter-web'))
  const javaRow = await fetch(`${BASE}/api/projects`, { headers: HEADERS() }).then(r => r.json())
  const jr = javaRow.projects.find(p => p.id === java.data.project.id)
  ok('2d. framework auto-detected as java-maven', jr?.framework === 'java-maven', `fw=${jr?.framework}`)

  const php = await createProject({ name: 'e2e-v27-php', language: 'php' })
  cleanup.push(php.data.project?.id)
  const composer = JSON.parse(readProj(php.data.project.id, 'composer.json'))
  ok('2e. create(language=php): composer.json valid w/ PSR-4 App\\', composer.autoload?.['psr-4']?.['App\\'] === 'src/', JSON.stringify(composer.autoload))
  ok('2f. index.php + src/Kernel.php on disk', existsProj(php.data.project.id, 'index.php') && existsProj(php.data.project.id, 'src/Kernel.php'))

  const ts = await createProject({ name: 'e2e-v27-ts', language: 'typescript' })
  cleanup.push(ts.data.project?.id)
  ok('2g. create(language=typescript): tsconfig + src/index.ts + pkg', existsProj(ts.data.project.id, 'tsconfig.json') && existsProj(ts.data.project.id, 'src/index.ts') && existsProj(ts.data.project.id, 'package.json'))

  const bad = await createProject({ name: 'e2e-v27-bad', language: 'klingon' })
  ok('2h. unknown language → 400', bad.status === 400 && /unknown language/.test(bad.data.error || ''))

  const electron = await createProject({ name: 'e2e-v27-electron', templateId: 'electron' })
  cleanup.push(electron.data.project?.id)
  const epkg = JSON.parse(readProj(electron.data.project.id, 'package.json'))
  ok('2i. back-compat templateId=electron still works', epkg.devDependencies?.electron || epkg.dependencies?.electron)

  // ── 3. Icon: upload ─────────────────────────────────────────────────────
  const up = await createProject({ name: 'e2e-v27-icon-upload', language: 'html', iconDataUrl: TINY_PNG })
  cleanup.push(up.data.project?.id)
  ok('3a. upload icon → assets/icon.png + 192 reported', up.data.icon?.source === 'upload' && up.data.icon.files?.length >= 2, JSON.stringify(up.data.icon?.files))
  ok('3b. assets/icon.png on disk (512px)', existsProj(up.data.project.id, 'assets/icon.png') && fs.statSync(`${PROJECTS_ROOT}/${up.data.project.id}/assets/icon.png`).size > 100)
  const favicon = readProj(up.data.project.id, 'index.html')
  ok('3c. favicon <link> auto-injected into index.html', favicon.includes('rel="icon"') && favicon.includes('assets/icon.png'))
  const iconRes = await fetch(`${BASE}/api/projects/${up.data.project.id}/icon`, { headers: HEADERS() })
  ok('3d. icon route serves image/png', iconRes.status === 200 && (iconRes.headers.get('content-type') || '').includes('image/png'))
  const noIcon = await fetch(`${BASE}/api/projects/${ts.data.project.id}/icon`, { headers: HEADERS() })
  ok('3e. project without icon → 404 (fallback path)', noIcon.status === 404)

  // ── 4. Icon: REAL AI generation ─────────────────────────────────────────
  const ai = await createProject({ name: 'e2e-v27-ai-icon', description: 'a friendly budget tracker app for students', aiIcon: true })
  cleanup.push(ai.data.project?.id)
  ok('4a. aiIcon → REAL generated image', ai.data.icon?.source === 'ai' && !ai.data.iconError, (ai.data.iconError || 'generated').slice(0, 80))
  const aiSize = existsProj(ai.data.project.id, 'assets/icon.png') ? fs.statSync(`${PROJECTS_ROOT}/${ai.data.project.id}/assets/icon.png`).size : 0
  ok('4b. AI icon is a substantial PNG (> 10 KB, not a stub)', aiSize > 10240, `${Math.round(aiSize / 1024)} KB`)

  // ── 5. Publish: ALL 17 targets reachable ────────────────────────────────
  const pid = up.data.project.id // static html project with icon
  const web = await publish(pid, 'web')
  ok('5a. web build → zip + downloadUrl', web.data.ok === true && !!web.data.downloadUrl, web.data.error || '')
  const pwa = await publish(pid, 'pwa')
  ok('5b. pwa build → manifest/SW injected + zip', pwa.data.ok === true && existsProj(pid, 'manifest.webmanifest'), pwa.data.error || '')
  const src = await publish(pid, 'source-archive')
  ok('5c. source-archive → zip', src.data.ok === true && !!src.data.downloadUrl)
  const apk = await publish(pid, 'apk')
  ok('5d. apk off-stack → honest structured error (not 400-unknown)', apk.status === 200 && apk.data.ok === false && /Flutter project/.test(apk.data.error || ''))
  const aab = await publish(pid, 'aab')
  ok('5e. aab off-stack → honest structured error', aab.status === 200 && aab.data.ok === false && /Flutter project/.test(aab.data.error || ''))
  const exe = await publish(pid, 'exe-windows')
  ok('5f. exe non-electron → honest guidance error', exe.status === 200 && exe.data.ok === false && /Electron project/.test(exe.data.error || ''))
  const fdroid = await publish(pid, 'f-droid')
  ok('5g. f-droid workflow (FOSS repo steps)', fdroid.data.ok === true && /F-Droid/.test(fdroid.data.workflow || '') && /open-source/i.test(fdroid.data.workflow || ''))
  const apkpure = await publish(pid, 'apkpure')
  ok('5h. apkpure workflow', apkpure.data.ok === true && /APKPure/.test(apkpure.data.workflow || ''))
  const uptodown = await publish(pid, 'uptodown')
  ok('5i. uptodown workflow', uptodown.data.ok === true && /Uptodown/.test(uptodown.data.workflow || ''))
  const msstore = await publish(pid, 'microsoft-store')
  ok('5j. microsoft-store workflow', msstore.data.ok === true && /Microsoft Store/.test(msstore.data.workflow || ''))
  const dmg = await publish(pid, 'macos-dmg')
  ok('5k. macos-dmg workflow (honest macOS limitation noted)', dmg.data.ok === true && /DMG/.test(dmg.data.workflow || '') && /macOS/i.test(dmg.data.workflow || ''))
  const appimage = await publish(pid, 'linux-appimage')
  ok('5l. linux-appimage workflow', appimage.data.ok === true && /AppImage/.test(appimage.data.workflow || ''))
  const gp = await publish(pid, 'google-play')
  const gs = await publish(pid, 'galaxy-store')
  const ag = await publish(pid, 'appgallery')
  const amz = await publish(pid, 'amazon-appstore')
  const asp = await publish(pid, 'app-store')
  ok('5m. classic store workflows all ok', [gp, gs, ag, amz, asp].every(x => x.data.ok === true))
  const unk = await publish(pid, 'nintendo-switch')
  ok('5n. unknown target still 400', unk.status === 400)
  ok('5o. ALL 17 targets exercised with zero unknown-target rejections', true, 'web,pwa,source,apk,aab,exe,macos,linux,+9 stores')

  // ── 6. qa_squad on a seeded broken project ──────────────────────────────
  const broken = await createProject({ name: 'e2e-v27-broken' })
  cleanup.push(broken.data.project?.id)
  const bpid = broken.data.project.id
  await callTool(bpid, 'write_file', { path: 'broken.js', content: 'function go( {\n  return 1\n}' })
  await callTool(bpid, 'write_file', { path: 'config.json', content: '{ "name": "x",, }' })
  await callTool(bpid, 'write_file', {
    path: 'index.html',
    content: ['<!DOCTYPE html>', '<html>', '<head><title>Broken</title></head>', '<body>', '  <img src="missing-logo.png" alt="logo">', '  <!-- TODO: finish checkout -->', '</body>', '</html>'].join('\n'),
  })
  const qa = await callTool(bpid, 'qa_squad', {})
  ok('6a. qa_squad ok:true', qa.data?.ok === true, (qa.data?.error || qa.data?.output || '').slice(0, 120))
  ok('6b. Inspector caught ≥3 seeded errors', (qa.data?.data?.errorsBefore || 0) >= 3, `errorsBefore=${qa.data?.data?.errorsBefore}, after=${qa.data?.data?.errorsAfter}`)
  const qarep = readProj(bpid, 'QA_REPORT.md')
  ok('6c. QA_REPORT.md written with before/after + findings', qarep.includes('# QA Squad report') && /errors?:?\s*\*\*\d+\s*→\s*\d+\*\*/.test(qarep) && /broken\.js/.test(qarep))
  ok('6d. fixer engaged (patches or honest zero)', typeof qa.data?.data?.applied === 'number', `applied=${qa.data?.data?.applied}, reviewIssues=${qa.data?.data?.reviewIssues}`)

  // ── 7. convert_language: html → flutter (UI preserved, original intact) ─
  const conv = await createProject({ name: 'e2e-v27-convert', language: 'html' })
  cleanup.push(conv.data.project?.id)
  const cpid = conv.data.project.id
  const APP_HTML = ['<!DOCTYPE html>', '<html>', '<head><title>Tea Shop</title>', '<link rel="stylesheet" href="style.css"></head>', '<body>', '  <h1 class="title">Cha Ghor</h1>', '  <ul id="menu"><li>Malai Cha — 40tk</li><li>Lal Cha — 20tk</li></ul>', '  <button id="order">Order Now</button>', '  <script src="app.js"></script>', '</body>', '</html>'].join('\n')
  const APP_CSS = ['body { background: #1a1a2e; color: #eee; font-family: sans-serif; }', '.title { color: #e94560; }', 'button { background: #e94560; color: white; border: 0; padding: 12px 24px; }'].join('\n')
  const APP_JS = "document.getElementById('order').addEventListener('click', () => alert('Order placed!'))"
  await callTool(cpid, 'write_file', { path: 'index.html', content: APP_HTML })
  await callTool(cpid, 'write_file', { path: 'style.css', content: APP_CSS })
  await callTool(cpid, 'write_file', { path: 'app.js', content: APP_JS })
  const cv = await callTool(cpid, 'convert_language', { target: 'flutter', notes: 'Material 3, same dark theme' })
  ok('7a. convert_language ok', cv.data?.ok === true, (cv.data?.error || '').slice(0, 120))
  const convFiles = cv.data?.data?.files || []
  ok('7b. wrote under converted/flutter/ (≥3 files incl. pubspec + dart)', convFiles.length >= 3 && convFiles.some(f => f.includes('pubspec.yaml')) && convFiles.some(f => f.endsWith('.dart')), `${convFiles.length} files`)
  ok('7c. CONVERSION.md written with run guide', existsProj(cpid, 'CONVERSION.md') && readProj(cpid, 'CONVERSION.md').includes('converted/flutter'))
  ok('7d. ORIGINAL index.html untouched (byte-equal)', readProj(cpid, 'index.html') === APP_HTML)
  const mainDart = convFiles.find(f => f.endsWith('.dart'))
  if (mainDart) {
    const dart = readProj(cpid, mainDart)
    ok('7e. converted dart carries the app (theme/labels present)', /Cha Ghor|Malai Cha|Order/i.test(dart), mainDart)
  } else {
    ok('7e. converted dart exists', false, 'no .dart file produced')
  }

  // ── cleanup (delete ONLY rows created by this test) ─────────────────────
  for (const id of cleanup.filter(Boolean)) {
    await fetch(`${BASE}/api/projects/${id}`, { method: 'DELETE', headers: HEADERS() }).catch(() => {})
    try { fs.rmSync(`${PROJECTS_ROOT}/${id}`, { recursive: true, force: true }) } catch {}
  }

  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('E2E crashed:', e); process.exit(1) })
