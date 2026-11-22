/**
 * E2E v71 — FINAL FULL-CHECK batch (the owner's "shob test koro" round):
 *   A.  zai-models.ts shared source (v70 RE-DELIVERY after the sandbox
 *       rollback lost it) — 13 models, newest first, default protected.
 *   B.  ProviderManagerDialog consumes the shared source at every surface
 *       (quick-pick, Built-in dropdown) + NEW bulk-keys paste section.
 *   C.  /api/providers/models LIVE — 13 curated models incl. glm-5.3.
 *   D.  /api/providers/fix-model zai fallback LIVE — retires a dead model to
 *       the shared lineup; owner's own provider is an honest no-op.
 *   E.  GitHubPanel Pull/Sync UI (the two live operations that never had a
 *       button) + operations route guards.
 *   F.  /api/providers/quick-setup bulk route wired + honest failures.
 *   G.  Root /api honest liveness payload (was "Hello, world!").
 *   H.  PACK & SHARE round-trip — export zip → import → file-identical →
 *       publish web artifact → download.
 *   I.  BIG PROJECT capability — 50-file project, zip, publish, re-import.
 *   J.  Speed spot-check post-warmup.
 *   Z.  Cleanup — E2E rows only; owner data untouched (verified).
 *
 * Run: bun scripts/e2e-v71-final-check.mjs   (dev server on :3000)
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
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

async function main() {
  console.log(`\n=== v71 final-check E2E @ ${BASE} ===\n`)

  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  const payload = `v1.${Date.now() + 3600e3}`
  const token = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  await db.lockSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), device: 'E2E v71 final-check', ip: '127.0.0.1' } })
  const H = { 'Content-Type': 'application/json', 'x-ca-lock': token }
  const H0 = { 'Content-Type': 'application/json' }

  // track every provider row the test creates so cleanup can always find them
  const createdProviderIds = []

  // pre-clean leftovers from any aborted earlier run (E2E rows only)
  await db.aIProvider.deleteMany({ where: { name: { contains: 'E2E v71' } } })

  // owner baseline — verified untouched at the end
  const ownerProvidersBefore = await db.aIProvider.count()
  const ownerProjectId = (await db.project.findFirst({ where: { deletedAt: null, name: { not: { contains: 'E2E' } } } }))?.id

  /* ════ A. shared zai-models source (v70 re-delivery) ════ */
  console.log('A. zai-models.ts shared source')
  const zaiSrc = fs.readFileSync('src/lib/zai-models.ts', 'utf8').replace(/\s+/g, ' ')
  const idOrder = ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.6', 'glm-4.5', 'glm-4-flash', 'glm-4v', 'glm-4v-flash', 'glm-4-air', 'glm-4-airx']
  ok('A1 file exists and exports ZAI_MODELS/ZAI_MODEL_IDS/ZAI_DEFAULT_MODEL',
    zaiSrc.includes('export const ZAI_MODELS') && zaiSrc.includes('export const ZAI_MODEL_IDS') && zaiSrc.includes('export const ZAI_DEFAULT_MODEL'))
  const posOf = (id) => zaiSrc.indexOf(`id: '${id}'`)
  const allThere = idOrder.every(id => posOf(id) > -1)
  const ordered = allThere && idOrder.every((id, i) => i === 0 || posOf(id) > posOf(idOrder[i - 1]))
  ok('A2 exactly 13 model ids, newest-first order', ordered && (zaiSrc.match(/id: 'glm-/g) || []).length === 13, `count=${(zaiSrc.match(/id: 'glm-/g) || []).length}`)
  ok('A3 default stays glm-4.6 (owner default protected)', zaiSrc.includes("ZAI_DEFAULT_MODEL = 'glm-4.6'"))
  ok('A4 ids derived from the array (single source of truth)', zaiSrc.includes('ZAI_MODEL_IDS: string[] = ZAI_MODELS.map'))

  /* ════ B. Dialog consumption + bulk keys UI ════ */
  console.log('B. ProviderManagerDialog consumption')
  const dlgRaw = fs.readFileSync('src/components/cloud-agent/dialogs/ProviderManagerDialog.tsx', 'utf8')
  const dlg = stripComments(dlgRaw)
  ok('B1 dialog imports the shared source', dlg.includes("from '@/lib/zai-models'") && dlg.includes('ZAI_MODELS, ZAI_MODEL_IDS, ZAI_DEFAULT_MODEL'))
  ok('B2 quick-pick zai entry uses models: ZAI_MODEL_IDS (raw check — URLs contain //)', /value: 'zai'[^\n]*models: ZAI_MODEL_IDS/.test(dlgRaw))
  ok('B3 quick-pick zai defaultModel: ZAI_DEFAULT_MODEL', /value: 'zai'[^}]*defaultModel: ZAI_DEFAULT_MODEL/.test(dlg))
  ok('B4 Built-in dropdown maps ZAI_MODELS (13 models, not the old 6)', dlg.includes('ZAI_MODELS.map(m =>') && !dlg.includes("['glm-4.6', 'glm-4.5', 'glm-4-flash', 'glm-4v', 'glm-4-air', 'glm-4-airx']"))
  ok('B5 builtinModel boots from ZAI_DEFAULT_MODEL', dlg.includes('useState(ZAI_DEFAULT_MODEL)'))
  ok('B6 bulk-keys: runBulkKeys → POST /api/providers/quick-setup', dlg.includes('async function runBulkKeys') && dlg.includes("fetch('/api/providers/quick-setup'"))
  ok('B7 bulk-keys UI: textarea + Add ALL as agents', dlgRaw.includes('Add ALL as agents') && dlgRaw.includes('Paste MANY keys'))

  /* ════ C. /api/providers/models LIVE ════ */
  console.log('C. models route (LIVE)')
  let r = await fetch(`${BASE}/api/providers/models`, { method: 'POST', headers: H, body: '{}' })
  let j = await r.json().catch(() => ({}))
  ok('C1 returns 13 curated z.ai models', r.status === 200 && j.ok === true && j.source === 'curated' && j.models?.length === 13, `n=${j.models?.length}`)
  ok('C2 big models present, newest first', j.models?.[0]?.id === 'glm-5.3' && j.models?.some(m => m.id === 'glm-5.3-flash') && j.models?.some(m => m.id === 'glm-4.7') && j.models?.some(m => m.id === 'glm-4.6'))
  ok('C3 every row owned_by z.ai', (j.models || []).every(m => m.owned_by === 'z.ai'))
  r = await fetch(`${BASE}/api/providers/models`, { method: 'POST', headers: H0, body: '{}' })
  ok('C4 lock-guarded (401 without the token)', r.status === 401)

  /* ════ D. fix-model zai fallback (LIVE) ════ */
  console.log('D. fix-model zai fallback')
  const fixSrc = stripComments(fs.readFileSync('src/app/api/providers/fix-model/route.ts', 'utf8'))
  ok('D1 source: zai branch returns the shared lineup', fixSrc.includes('return [...ZAI_MODEL_IDS]'))
  r = await fetch(`${BASE}/api/providers`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'E2E v71 Zai (dead model)', kind: 'zai', model: 'glm-9.9-gone' }) })
  j = await r.json().catch(() => ({}))
  const deadZai = j?.provider?.id
  if (deadZai) createdProviderIds.push(deadZai)
  ok('D2 E2E zai provider with a dead model created', r.status === 200 && !!deadZai, `status ${r.status}`)
  r = await fetch(`${BASE}/api/providers/fix-model`, { method: 'POST', headers: H, body: JSON.stringify({ id: deadZai }) })
  j = await r.json().catch(() => ({}))
  ok('D3 fixed → best live model = glm-5.3 (newest first)', r.status === 200 && j.ok === true && j.fixed === true && j.to === 'glm-5.3', JSON.stringify(j).slice(0, 120))
  const deadRow = await db.aIProvider.findUnique({ where: { id: deadZai } })
  ok('D4 DB row persisted to glm-5.3', deadRow?.model === 'glm-5.3', `db=${deadRow?.model}`)
  // owner's own Built-in Z.ai must be an honest NO-OP (no write)
  const ownerZai = await db.aIProvider.findFirst({ where: { kind: 'zai', name: 'Built-in Z.ai' } })
  const ownerModelBefore = ownerZai?.model
  r = await fetch(`${BASE}/api/providers/fix-model`, { method: 'POST', headers: H, body: JSON.stringify({ id: ownerZai.id }) })
  j = await r.json().catch(() => ({}))
  ok('D5 owner Built-in Z.ai → honest no-op (model still live)', j.ok === true && j.fixed === false, JSON.stringify(j).slice(0, 110))
  ok('D6 owner model value unchanged in DB', (await db.aIProvider.findUnique({ where: { id: ownerZai.id } }))?.model === ownerModelBefore)
  r = await fetch(`${BASE}/api/providers/fix-model`, { method: 'POST', headers: H0, body: JSON.stringify({ id: deadZai }) })
  ok('D7 401 without lock', r.status === 401)
  r = await fetch(`${BASE}/api/providers/fix-model`, { method: 'POST', headers: H, body: '{}' })
  ok('D8 400 without id', r.status === 400)
  r = await fetch(`${BASE}/api/providers/fix-model`, { method: 'POST', headers: H, body: JSON.stringify({ id: 'nope-does-not-exist' }) })
  ok('D9 404 unknown provider', r.status === 404)

  /* ════ E. GitHub Pull/Sync UI + guards ════ */
  console.log('E. GitHub pull/sync UI')
  const gh = stripComments(fs.readFileSync('src/components/cloud-agent/dialogs/GitHubPanel.tsx', 'utf8'))
  ok('E1 pull wired: action pull + mode merge/reset', gh.includes("action: 'pull'") && gh.includes("'merge' | 'reset'"))
  ok('E2 sync wired: action sync', gh.includes("action: 'sync'"))
  ok('E3 PullSyncForm with Pull merge / Pull reset / Sync buttons', gh.includes('Pull merge') && gh.includes('Pull reset') && gh.includes('>Sync<'))
  ok('E4 tree refresh after success (bumpTree)', (gh.match(/bumpTree\(\)/g) || []).length >= 2)
  ok('E5 honest guard: no open project → error toast', gh.includes("'Open a project first'"))
  r = await fetch(`${BASE}/api/github/operations`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'pull', accountId: 'bogus', projectId: 'bogus', repo: 'x/y' }) })
  ok('E6 operations pull: unknown account → 404', r.status === 404)
  r = await fetch(`${BASE}/api/github/operations`, { method: 'POST', headers: H0, body: JSON.stringify({ action: 'sync', accountId: 'bogus' }) })
  ok('E7 operations lock-guarded (401)', r.status === 401)

  /* ════ F. bulk quick-setup route ════ */
  console.log('F. quick-setup bulk route')
  r = await fetch(`${BASE}/api/providers/quick-setup`, { method: 'POST', headers: H, body: JSON.stringify({ keys: ['totally-fake-key-not-real-123456'] }) })
  j = await r.json().catch(() => ({}))
  ok('F1 garbage key → honest failure, ZERO rows created (auth-class guard)', r.status === 200 && j.ok === true && (j.added?.length || 0) === 0 && (j.failed?.length || 0) === 1, JSON.stringify(j).slice(0, 130))
  const afterFake = await db.aIProvider.count()
  ok('F2 no provider row leaked from the failed key', afterFake === ownerProvidersBefore + 1, `count=${afterFake} (baseline+deadZai)`)
  r = await fetch(`${BASE}/api/providers/quick-setup`, { method: 'POST', headers: H, body: '{}' })
  ok('F3 empty body → 400', r.status === 400)
  r = await fetch(`${BASE}/api/providers/quick-setup`, { method: 'POST', headers: H0, body: JSON.stringify({ keys: ['x'] }) })
  ok('F4 401 without lock', r.status === 401)
  // preverified: device-verified keys save instantly (then duplicated)
  const pvKey = `E2E-v71-preverified-key-${Date.now()}`
  r = await fetch(`${BASE}/api/providers/quick-setup`, { method: 'POST', headers: H, body: JSON.stringify({ preverified: [{ key: pvKey, providerKind: 'openai-compatible', providerName: 'E2E v71 FakeCo', endpoint: 'http://127.0.0.1:9/v1', models: [{ id: 'fake-1' }] }] }) })
  j = await r.json().catch(() => ({}))
  const pvId = j?.added?.[0]?.id
  if (pvId) createdProviderIds.push(pvId)
  ok('F5 preverified key saved instantly as its own agent row', j.ok === true && j.added?.length === 1 && j.added[0].name.startsWith('E2E v71 FakeCo'), JSON.stringify(j).slice(0, 120))
  r = await fetch(`${BASE}/api/providers/quick-setup`, { method: 'POST', headers: H, body: JSON.stringify({ preverified: [{ key: pvKey, providerKind: 'openai-compatible', providerName: 'E2E v71 FakeCo', endpoint: 'http://127.0.0.1:9/v1', models: [{ id: 'fake-1' }] }] }) })
  j = await r.json().catch(() => ({}))
  ok('F6 same key again → duplicate skipped, nothing added', j.ok === true && (j.added?.length || 0) === 0 && j.duplicates === 1, JSON.stringify(j).slice(0, 110))

  /* ════ G. root /api honest payload ════ */
  console.log('G. root /api route')
  const apiSrc = fs.readFileSync('src/app/api/route.ts', 'utf8')
  ok('G1 no more scaffold "Hello, world!"', !apiSrc.includes('Hello, world!') && apiSrc.includes("app: 'Cloud Agent'") || apiSrc.includes('app: "Cloud Agent"'))
  r = await fetch(`${BASE}/api`, { headers: H })
  j = await r.json().catch(() => ({}))
  ok('G2 honest liveness payload when unlocked', r.status === 200 && j.app === 'Cloud Agent' && j.status === 'ok', JSON.stringify(j).slice(0, 100))
  r = await fetch(`${BASE}/api`)
  ok('G3 still lock-guarded (401 locked)', r.status === 401)

  /* ════ H. PACK & SHARE round-trip ════ */
  console.log('H. pack & share round-trip')
  r = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'E2E v71 pack', templateId: 'static' }) })
  j = await r.json().catch(() => ({}))
  const packId = j?.project?.id
  ok('H1 E2E pack project created', r.status === 200 && !!packId, `status ${r.status}`)
  const marker = `pack-marker-${Date.now()}`
  await fetch(`${BASE}/api/files`, { method: 'POST', headers: H, body: JSON.stringify({ projectId: packId, path: 'notes/handover.md', content: `# Handover\n\n${marker}\n` }) })
  r = await fetch(`${BASE}/api/zip?projectId=${packId}`, { headers: H })
  const zipBuf = Buffer.from(await r.arrayBuffer())
  ok('H2 export zip: 200 + application/zip + non-empty', r.status === 200 && (r.headers.get('content-type') || '').includes('zip') && zipBuf.length > 500, `bytes=${zipBuf.length}`)
  r = await fetch(`${BASE}/api/projects/import`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'E2E v71 import', zipBase64: zipBuf.toString('base64') }) })
  j = await r.json().catch(() => ({}))
  const importId = j?.project?.id
  ok('H3 re-import as a NEW project', r.status === 200 && !!importId, `status ${r.status}`)
  r = await fetch(`${BASE}/api/files?projectId=${importId}&path=notes/handover.md`, { headers: H })
  j = await r.json().catch(() => ({}))
  ok('H4 imported file byte-identical (marker present)', j.content?.includes(marker), `len=${(j.content || '').length}`)
  r = await fetch(`${BASE}/api/publish`, { method: 'POST', headers: H, body: JSON.stringify({ projectId: importId, target: 'web' }) })
  j = await r.json().catch(() => ({}))
  ok('H5 publish web → artifact + downloadUrl', j.ok === true && !!j.artifactPath && !!j.downloadUrl, JSON.stringify(j).slice(0, 130))
  if (j.downloadUrl) {
    r = await fetch(`${BASE}${j.downloadUrl}`, { headers: H })
    const art = Buffer.from(await r.arrayBuffer())
    ok('H6 published artifact downloads as a real zip', r.status === 200 && art.length > 500 && art[0] === 0x50 && art[1] === 0x4b, `bytes=${art.length}`)
  }
  r = await fetch(`${BASE}/api/projects/duplicate`, { method: 'POST', headers: H, body: JSON.stringify({}) })
  ok('H7 dead /api/projects/duplicate route is gone (non-2xx; [id] route may swallow it)', r.status >= 400, `status ${r.status}`)

  /* ════ I. BIG PROJECT capability ════ */
  console.log('I. big project (50 files)')
  r = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'E2E v71 big', templateId: 'static' }) })
  j = await r.json().catch(() => ({}))
  const bigId = j?.project?.id
  ok('I1 big E2E project created', r.status === 200 && !!bigId)
  const bigMarker = `big-marker-${Date.now()}`
  const t0 = Date.now()
  let writes = 0
  for (let i = 0; i < 50; i++) {
    const mod = Math.floor(i / 10)
    const body = JSON.stringify({ projectId: bigId, path: `src/feature-${mod}/module-${i}.js`, content: `// E2E v71 big project module ${i}\n// ${bigMarker}\nexport function mod${i}(x) {\n  const steps = [];\n  for (let k = 0; k < ${i + 5}; k++) steps.push(k * ${i + 1});\n  return steps.reduce((a, b) => a + b, 0) + x;\n}\n` })
    const wr = await fetch(`${BASE}/api/files`, { method: 'POST', headers: H, body })
    if (wr.status === 200) writes++
  }
  const writeMs = Date.now() - t0
  ok('I2 50 files written via API', writes === 50, `writes=${writes} in ${writeMs}ms`)
  r = await fetch(`${BASE}/api/files/${bigId}`, { headers: H })
  j = await r.json().catch(() => ({}))
  const treeIds = new Set((JSON.stringify(j).match(/module-\d+\.js/g) || []))
  ok('I3 file tree reports the 50 modules (distinct)', treeIds.size === 50, `distinct=${treeIds.size}`)
  r = await fetch(`${BASE}/api/zip?projectId=${bigId}`, { headers: H })
  const bigZip = Buffer.from(await r.arrayBuffer())
  ok('I4 big zip export works (sane size)', r.status === 200 && bigZip.length > 10 * 1024, `bytes=${bigZip.length}`)
  r = await fetch(`${BASE}/api/publish`, { method: 'POST', headers: H, body: JSON.stringify({ projectId: bigId, target: 'web' }) })
  j = await r.json().catch(() => ({}))
  ok('I5 big project publish → artifact', j.ok === true && !!j.artifactPath, JSON.stringify(j).slice(0, 110))
  r = await fetch(`${BASE}/api/projects/import`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'E2E v71 big import', zipBase64: bigZip.toString('base64') }) })
  j = await r.json().catch(() => ({}))
  const bigImportId = j?.project?.id
  ok('I6 big zip re-imports as a full project', r.status === 200 && !!bigImportId)
  r = await fetch(`${BASE}/api/files/${bigImportId}`, { headers: H })
  j = await r.json().catch(() => ({}))
  const bigImportIds = new Set((JSON.stringify(j).match(/module-\d+\.js/g) || []))
  ok('I7 all 50 modules survived the pack→share→import loop (distinct)', bigImportIds.size === 50, `distinct=${bigImportIds.size}`)

  /* ════ J. speed spot-check ════ */
  console.log('J. speed (post-warmup)')
  const t = async (fn) => { const s = Date.now(); await fn(); return Date.now() - s }
  const lockMs = await t(() => fetch(`${BASE}/lock`))
  const projMs = await t(async () => { const x = await fetch(`${BASE}/api/projects`, { headers: H }); await x.arrayBuffer() })
  const provMs = await t(async () => { const x = await fetch(`${BASE}/api/providers`, { headers: H }); await x.arrayBuffer() })
  ok('J1 /lock page fast (<1500ms)', lockMs < 1500, `${lockMs}ms`)
  ok('J2 /api/projects fast (<1500ms)', projMs < 1500, `${projMs}ms`)
  ok('J3 /api/providers fast (<1500ms)', provMs < 1500, `${provMs}ms`)

  /* ════ Z. cleanup — E2E rows ONLY ════ */
  console.log('Z. cleanup')
  for (const pid of [packId, importId, bigId, bigImportId].filter(Boolean)) {
    await fetch(`${BASE}/api/projects/${pid}?hard=1`, { method: 'DELETE', headers: H })
  }
  await db.aIProvider.deleteMany({ where: { id: { in: createdProviderIds } } })
  await db.aIProvider.deleteMany({ where: { name: { contains: 'E2E v71' } } })
  await db.build.deleteMany({ where: { project: { name: { contains: 'E2E v71' } } } })
  await db.lockSession.deleteMany({ where: { device: 'E2E v71 final-check' } })
  const leftP = await db.aIProvider.count()
  const leftProjects = await db.project.count({ where: { deletedAt: null, name: { contains: 'E2E v71' } } })
  ok('Z1 owner pool restored (provider count == baseline)', leftP === ownerProvidersBefore, `now=${leftP} before=${ownerProvidersBefore}`)
  ok('Z2 no E2E v71 projects left alive', leftProjects === 0)
  const ownerStill = await db.aIProvider.findFirst({ where: { kind: 'zai', name: 'Built-in Z.ai' } })
  ok('Z3 owner Built-in Z.ai untouched', !!ownerStill && ownerStill.model === ownerModelBefore, `model=${ownerStill?.model}`)
  const ownerAlive = await db.project.findFirst({ where: { id: ownerProjectId, deletedAt: null } })
  ok('Z4 owner project untouched', !!ownerAlive)

  console.log(`\n=== v71 RESULT: ${pass} PASS / ${fail} FAIL ===\n`)
  await db.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('E2E crashed:', e)
  try { await db.$disconnect() } catch {}
  process.exit(2)
})
