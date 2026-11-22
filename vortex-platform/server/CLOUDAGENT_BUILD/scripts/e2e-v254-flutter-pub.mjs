/**
 * E2E — v25.4 "Right Package Manager" (install_package pub.dev support).
 *
 * The bug: agent builds a Flutter project, then install_package ran
 * `npm install speech_to_text` → registry E404 → the agent retried forever
 * ("npm error 404 Not Found - speech_to_text / flutter_tts"). Flutter packages
 * live on pub.dev, not npm.
 *
 * Fix under test (against the LIVE server via /api/internal/tool bridge):
 *   1. Flutter project (pubspec.yaml) → install_package resolves the REAL
 *      latest version from pub.dev and writes it into pubspec.yaml
 *   2. "name:1.2.3" spec → pinned as ^1.2.3; re-install → UPDATED, no dupe
 *   3. pubspec.yaml stays valid (flutter.sdk section, single dependencies:)
 *   4. npm path untouched: node project + lodash → npm still works
 *   5. unknown-framework project + pub-only name → npm 404 → pub fallback
 *      records the dependency honestly
 *   6. bridge security: locked → 401, unknown tool → 404,
 *      confirmation-gated tool (terminal rm -rf) → 403
 *
 * Run: node scripts/e2e-v254-flutter-pub.mjs
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

const FLUTTER_PUBSPEC = [
  'name: bangla_assistant',
  'description: Bangla voice assistant.',
  'publish_to: none',
  'version: 1.0.0',
  '',
  'environment:',
  "  sdk: '>=3.0.0 <4.0.0'",
  '',
  'dependencies:',
  '  flutter:',
  '    sdk: flutter',
  '  cupertino_icons: ^1.0.6',
  '',
  'dev_dependencies:',
  '  flutter_lints: ^3.0.0',
  '',
  'flutter:',
  '  uses-material-design: true',
  '',
].join('\n')

async function makeProject(name) {
  const res = await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: HEADERS(),
    body: JSON.stringify({ name }),
  })
  const { project } = await res.json()
  return project.id
}

async function main() {
  console.log(`\n=== v25.4 Right Package Manager E2E @ ${BASE} ===\n`)

  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  global.TOKEN = signToken(secret)
  await db.lockSession.upsert({
    where: { tokenHash: sha256(global.TOKEN) },
    update: { lastSeenAt: new Date() },
    create: { tokenHash: sha256(global.TOKEN), device: 'E2E v25.4 right-pkg-manager', ip: '127.0.0.1' },
  })

  const ids = []
  const flutterId = await makeProject('e2e-v254-flutter')
  ids.push(flutterId)

  // ── 1. Flutter project: real pub.dev resolution ─────────────────────────
  const w1 = await callTool(flutterId, 'write_file', { path: 'pubspec.yaml', content: FLUTTER_PUBSPEC })
  ok('1a. pubspec.yaml written via bridge', w1.status === 200 && w1.data.ok === true, `HTTP ${w1.status}`)

  const r1 = await callTool(flutterId, 'install_package', { package: 'speech_to_text' })
  ok('1b. install_package(speech_to_text) ok', r1.status === 200 && r1.data.ok === true, r1.data.error || r1.data.output?.split('\n')[0])
  ok('1c. version resolved LIVE from pub.dev', r1.data?.data?.source === 'pub.dev', `source=${r1.data?.data?.source} constraint=${r1.data?.data?.constraint}`)
  const yaml1 = fs.readFileSync(`/home/z/my-project/projects/${flutterId}/pubspec.yaml`, 'utf8')
  const m1 = yaml1.match(/^  speech_to_text: (any|\^\d+\.\d+\.\d+)\s*$/m)
  ok('1d. pubspec has speech_to_text: ^X.Y.Z', !!m1, m1 ? m1[1] : 'LINE MISSING')

  // ── 2. Pinned spec + update-not-duplicate ────────────────────────────────
  const r2 = await callTool(flutterId, 'install_package', { package: 'flutter_tts:4.0.3' })
  ok('2a. install_package(flutter_tts:4.0.3) ok', r2.data?.ok === true && r2.data?.data?.constraint === '^4.0.3', `constraint=${r2.data?.data?.constraint}`)
  const r3 = await callTool(flutterId, 'install_package', { package: 'speech_to_text:5.0.1' })
  ok('3a. re-install pins ^5.0.1 (specified)', r3.data?.ok === true && r3.data?.data?.constraint === '^5.0.1' && r3.data?.data?.source === 'specified', `constraint=${r3.data?.data?.constraint} source=${r3.data?.data?.source}`)
  const yaml2 = fs.readFileSync(`/home/z/my-project/projects/${flutterId}/pubspec.yaml`, 'utf8')
  const stCount = (yaml2.match(/^  speech_to_text:/gm) || []).length
  ok('3b. NO duplicate dependency lines', stCount === 1, `speech_to_text lines=${stCount}`)
  ok('3c. pinned version applied', /^  speech_to_text: \^5\.0\.1\s*$/m.test(yaml2) && /^  flutter_tts: \^4\.0\.3\s*$/m.test(yaml2))
  ok('3d. YAML still valid (flutter sdk + one dependencies:)', /^\s+sdk:\s*flutter\s*$/m.test(yaml2) && (yaml2.match(/^dependencies:\s*$/gm) || []).length === 1)
  ok('3e. existing dep (cupertino_icons) untouched', /^  cupertino_icons: \^1\.0\.6\s*$/m.test(yaml2))

  // ── 4. Node project regression: npm path unchanged ──────────────────────
  const nodeId = await makeProject('e2e-v254-node')
  ids.push(nodeId)
  await callTool(nodeId, 'write_file', { path: 'package.json', content: JSON.stringify({ name: 'e2e-node', version: '1.0.0', dependencies: {} }) })
  const r4 = await callTool(nodeId, 'install_package', { package: 'lodash' })
  ok('4a. node project still installs via npm', r4.data?.ok === true, (r4.data?.output || r4.data?.error || '').split('\n').slice(-1)[0]?.slice(0, 80))

  // ── 5. Unknown framework + pub-only name → honest pub fallback ──────────
  const emptyId = await makeProject('e2e-v254-empty')
  ids.push(emptyId)
  const r5 = await callTool(emptyId, 'install_package', { package: 'flutter_tts' })
  ok('5a. npm-404 on unknown project → pub fallback ok', r5.data?.ok === true, (r5.data?.output || '').split('\n')[0])
  const yaml3 = fs.readFileSync(`/home/z/my-project/projects/${emptyId}/pubspec.yaml`, 'utf8')
  const m5 = yaml3.match(/^  flutter_tts: (any|\^\d+\.\d+\.\d+)\s*$/m)
  ok('5b. minimal pubspec created with the dep', !!m5, m5 ? m5[1] : 'snippet: ' + yaml3.slice(0, 150).replace(/\n/g, ' | '))

  // ── 6. Bridge security ───────────────────────────────────────────────────
  const anon = await fetch(`${BASE}/api/internal/tool`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: flutterId, tool: 'detect', args: {} }) })
  ok('6a. locked request → 401', anon.status === 401, `HTTP ${anon.status}`)
  const unk = await callTool(flutterId, 'no_such_tool', {})
  ok('6b. unknown tool → 404', unk.status === 404)
  const dty = await callTool(flutterId, 'terminal', { command: 'rm -rf /' })
  ok('6c. confirmation-gated tool → 403', dty.status === 403, `HTTP ${dty.status}`)

  // ── cleanup ──────────────────────────────────────────────────────────────
  for (const id of ids) {
    await db.project.delete({ where: { id } }).catch(() => {})
    fs.rmSync(`/home/z/my-project/projects/${id}`, { recursive: true, force: true })
  }
  await db.lockSession.deleteMany({ where: { device: 'E2E v25.4 right-pkg-manager' } })

  console.log(`\n${pass} PASS / ${fail} FAIL`)
  await db.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
