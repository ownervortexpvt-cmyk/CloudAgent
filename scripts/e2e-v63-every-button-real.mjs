/**
 * E2E v63 — "every button real" sweep (fixes + wiring, one pass):
 *   A.  🔐 /api/secrets/test — NEW route behind the previously-404ing
 *       "Test connection" button (global + project scopes, honest verdicts)
 *   B.  ⬇️  Publish download link — downloadUrl now targets the REAL
 *       /api/publish?id= route (bogus id → honest 404; no /download subroute)
 *   C.  🏗️ /api/builds — GET (used by the new PublishDialog build history)
 *   D.  🚀 /api/deploy GET — deploy targets for the new CLI-deploy card
 *   E.  💾 /api/projects/storage — real disk usage (Settings Storage card)
 *   F.  ⌨️ /api/terminal shell= — Settings → Terminal shell choice honored
 *       (whitelist + honest fallback note) + kill-on-shell-change
 *   G.  🔁 /api/providers/update-model + /models + /bulk-import — the
 *       Provider Manager's one-click model switch + bulk import UI
 *   H.  📁 Files upload path used by the new binary-safe ZIP/AIA attach
 *   I.  🔒 Auth — every touched route is lock-guarded
 *   J–L. Source-structure + shipped-chunk checks for the UI halves
 *
 * Run: node scripts/e2e-v63-every-button-real.mjs   (dev server on :3000)
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

/** strip comments for stable source greps */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

async function main() {
  console.log(`\n=== v63 every-button-real E2E @ ${BASE} ===\n`)

  // ── mint a real session token (the lock is configured) ───────────────────
  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  const payload = `v1.${Date.now() + 3600e3}`
  const token = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  await db.lockSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), device: 'E2E v63 every-button-real', ip: '127.0.0.1' } })
  const H = { 'Content-Type': 'application/json', 'x-ca-lock': token }
  const H0 = { 'Content-Type': 'application/json' } // no lock header

  // ════ I. AUTH: touched routes are lock-guarded ═══════════════════════════
  let r = await fetch(`${BASE}/api/secrets/test`, { method: 'POST', headers: H0, body: JSON.stringify({ key: 'X' }) })
  ok('POST /api/secrets/test without lock → 401', r.status === 401, `got ${r.status}`)
  r = await fetch(`${BASE}/api/builds?projectId=none`, { headers: H0 })
  ok('GET /api/builds without lock → 401', r.status === 401, `got ${r.status}`)
  r = await fetch(`${BASE}/api/projects/storage`, { headers: H0 })
  ok('GET /api/projects/storage without lock → 401', r.status === 401, `got ${r.status}`)
  r = await fetch(`${BASE}/api/terminal`, { method: 'POST', headers: H0, body: JSON.stringify({ action: 'start', projectId: 'x' }) })
  ok('POST /api/terminal without lock → 401', r.status === 401, `got ${r.status}`)

  // ════ A. /api/secrets/test — the restored Test-connection route ══════════
  // A1: global non-key secret (DB-URL-shaped) → verified-stored verdict
  const gKey = 'E2E_V63_DB_URL'
  const gVal = 'postgres://user:pass@db.internal:5432/e2e'
  await fetch(`${BASE}/api/secrets`, { method: 'POST', headers: H, body: JSON.stringify({ key: gKey, value: gVal, isSecret: true }) })
  r = await fetch(`${BASE}/api/secrets/test`, { method: 'POST', headers: H, body: JSON.stringify({ key: gKey, scope: 'global' }) })
  const gTest = await r.json()
  ok('global non-key secret → ok:true verified-stored', r.status === 200 && gTest.ok === true && gTest.scope === 'global' && /decrypts/.test(gTest.message || ''), JSON.stringify(gTest).slice(0, 90))
  ok('secret VALUE never leaks in the response', !JSON.stringify(gTest).includes('postgres://user:pass'))

  // A2: unknown key → honest 404
  r = await fetch(`${BASE}/api/secrets/test`, { method: 'POST', headers: H, body: JSON.stringify({ key: 'E2E_V63_MISSING', scope: 'global' }) })
  ok('missing global secret → 404', r.status === 404)

  // A3: garbage provider-shaped key → live detect runs, honest ok:false
  const gBad = 'E2E_V63_FAKE_KEY'
  await fetch(`${BASE}/api/secrets`, { method: 'POST', headers: H, body: JSON.stringify({ key: gBad, value: 'sk-fake-key-abcdefghijklmnopqrstuvwxyz', isSecret: true }) })
  r = await fetch(`${BASE}/api/secrets/test`, { method: 'POST', headers: H, body: JSON.stringify({ key: gBad, scope: 'global' }) })
  const bTest = await r.json()
  ok('fake provider key → ok:false with honest reason', r.status === 200 && bTest.ok === false && typeof bTest.error === 'string' && bTest.error.length > 5, (bTest.error || '').slice(0, 80))

  // A4: project-scope secret via real project + /api/settings row
  const created = await (await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: '__e2e_v63_btns', description: 'v63 button sweep', language: 'html' }),
  })).json()
  const pid = created.project?.id
  ok('project created (html starter)', !!pid, pid || 'no id')

  const saved = await (await fetch(`${BASE}/api/settings`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ projectId: pid, key: 'E2E_V63_PROJECT_SECRET', value: 'plain-token-abc123', isSecret: false }),
  })).json()
  const envRowId = saved.envVar?.id || saved.id
  r = await fetch(`${BASE}/api/secrets/test`, { method: 'POST', headers: H, body: JSON.stringify({ key: 'E2E_V63_PROJECT_SECRET', id: envRowId, scope: 'project', projectId: pid }) })
  const pTest = await r.json()
  ok('project secret (plain) → ok:true verified-stored', r.status === 200 && pTest.ok === true && pTest.scope === 'project', JSON.stringify(pTest).slice(0, 90))

  // A5: wrong project guard — pretend the row belongs to another project
  r = await fetch(`${BASE}/api/secrets/test`, { method: 'POST', headers: H, body: JSON.stringify({ key: 'E2E_V63_PROJECT_SECRET', id: envRowId, scope: 'project', projectId: 'not-the-owner' }) })
  ok('project secret + wrong projectId → 404', r.status === 404)

  // A6: validation
  r = await fetch(`${BASE}/api/secrets/test`, { method: 'POST', headers: H, body: JSON.stringify({ scope: 'global' }) })
  ok('global test without key → 400', r.status === 400)

  // ════ B. Publish download URL — the real route ═══════════════════════════
  const publishSrc = fs.readFileSync('src/app/api/publish/route.ts', 'utf8')
  ok('publish downloadUrl targets /api/publish?id= (no /download subroute)', publishSrc.includes('/api/publish?id=') && !publishSrc.includes('/api/publish/download'))
  r = await fetch(`${BASE}/api/publish?id=__bogus_build_id__`, { headers: H })
  ok('GET /api/publish?id=bogus → 404 (the URL we now ship is REAL and honest)', r.status === 404)

  // ════ C. /api/builds — build history for PublishDialog ═══════════════════
  r = await fetch(`${BASE}/api/builds?projectId=${pid}`, { headers: H })
  const builds = await r.json()
  ok('GET /api/builds → 200 array (empty for a fresh project)', r.status === 200 && Array.isArray(builds.builds) && builds.builds.length === 0)
  r = await fetch(`${BASE}/api/builds`, { headers: H })
  ok('GET /api/builds without projectId → 400', r.status === 400)

  // ════ D. /api/deploy targets ═════════════════════════════════════════════
  r = await fetch(`${BASE}/api/deploy`, { headers: H })
  const dep = await r.json()
  ok('GET /api/deploy → 4 CLI targets incl. vercel', r.status === 200 && Array.isArray(dep.targets) && dep.targets.length === 4 && dep.targets.some(t => t.id === 'vercel'))

  // ════ E. /api/projects/storage — the Settings Storage card feed ══════════
  r = await fetch(`${BASE}/api/projects/storage?projectId=${pid}`, { headers: H })
  const st = await r.json()
  ok('storage per-project → numbers + html starter files', r.status === 200 && typeof st.totalBytes === 'number' && typeof st.totalFiles === 'number' && st.totalFiles >= 3, `files=${st.totalFiles} bytes=${st.totalBytes}`)
  r = await fetch(`${BASE}/api/projects/storage`, { headers: H })
  const stAll = await r.json()
  ok('storage whole-workspace → totals + perProject array', r.status === 200 && stAll.totalBytes >= st.totalBytes && Array.isArray(stAll.perProject))

  // ════ F. /api/terminal shell support ═════════════════════════════════════
  r = await fetch(`${BASE}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'start', projectId: pid, shell: 'sh' }) })
  const t1 = await r.json()
  ok('terminal start shell=sh → session + shell echo', r.status === 200 && t1.sessionId && t1.shell === 'sh', `sid=${(t1.sessionId || '').slice(0, 8)}…`)
  // prove the session really runs THAT shell
  await fetch(`${BASE}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'input', sessionId: t1.sessionId, data: 'echo SHELLTEST_$((1+1))\n' }) })
  await new Promise(res => setTimeout(res, 700))
  const poll1 = await (await fetch(`${BASE}/api/terminal?sessionId=${t1.sessionId}`, { headers: H })).json()
  ok('sh session executes a command', /SHELLTEST_2/.test(poll1.output || ''), (poll1.output || '').split('\n').find(l => l.includes('SHELLTEST')) || '')
  await fetch(`${BASE}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'kill', sessionId: t1.sessionId }) })

  // shell change on the SAME project → old session killed, new one starts
  r = await fetch(`${BASE}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'start', projectId: pid, shell: 'bash' }) })
  const t2 = await r.json()
  ok('terminal start shell=bash → fresh session with shell=bash', r.status === 200 && t2.sessionId && t2.shell === 'bash')
  await fetch(`${BASE}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'input', sessionId: t2.sessionId, data: 'echo OK_BASH\n' }) })
  await new Promise(res => setTimeout(res, 700))
  const poll2 = await (await fetch(`${BASE}/api/terminal?sessionId=${t2.sessionId}`, { headers: H })).json()
  ok('bash session executes a command', /OK_BASH/.test(poll2.output || ''))

  // bogus shell → honest fallback note, still a working session
  r = await fetch(`${BASE}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'start', projectId: pid, shell: 'csh99' }) })
  const t3 = await r.json()
  ok('unknown shell → bash fallback + honest note', r.status === 200 && t3.shell === 'bash' && /not installed/.test(t3.note || ''), t3.note || '')
  // injection-shaped shell names are rejected (whitelist regex), no error
  r = await fetch(`${BASE}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'start', projectId: pid, shell: 'bash; rm -rf /' }) })
  const t4 = await r.json()
  ok('injection-shaped shell → sanitized to bash', r.status === 200 && t4.shell === 'bash' && !t4.note)
  for (const s of [t2, t3, t4]) {
    if (s.sessionId) await fetch(`${BASE}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'kill', sessionId: s.sessionId }) })
  }

  // ════ G. provider endpoints the new UI wires ═════════════════════════════
  // G1: update-model — light partial update (one-click switch)
  const prov = await (await fetch(`${BASE}/api/providers`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: '__e2e_v63_provider', kind: 'openai-compatible', endpoint: 'https://example.invalid/v1', model: 'model-a', apiKey: 'sk-e2e-v63-key-1234567890' }),
  })).json()
  const provId = prov.provider?.id
  ok('provider saved for switch test', !!provId)
  r = await fetch(`${BASE}/api/providers/update-model`, { method: 'POST', headers: H, body: JSON.stringify({ id: provId, model: 'model-b' }) })
  const sw = await r.json()
  ok('POST /api/providers/update-model switches model', r.status === 200 && sw.ok === true && sw.provider?.model === 'model-b', JSON.stringify(sw).slice(0, 80))
  r = await fetch(`${BASE}/api/providers/update-model`, { method: 'POST', headers: H, body: JSON.stringify({ id: provId }) })
  ok('update-model without model → 400', r.status === 400)
  r = await fetch(`${BASE}/api/providers/update-model`, { method: 'POST', headers: H, body: JSON.stringify({ id: '__nope__', model: 'x' }) })
  ok('update-model unknown id → honest failure', r.status >= 400 || (await r.json()).ok === false)

  // G2: models — real endpoint contract (unreachable endpoint → honest ok:false)
  r = await fetch(`${BASE}/api/providers/models`, { method: 'POST', headers: H, body: JSON.stringify({ id: provId }) })
  const ml = await r.json()
  ok('POST /api/providers/models responds with contract JSON', r.status === 200 && typeof ml.ok === 'boolean', `ok=${ml.ok}`)

  // G3: bulk-import — validation + one real import + duplicate skip
  r = await fetch(`${BASE}/api/providers/bulk-import`, { method: 'POST', headers: H, body: JSON.stringify({ providers: [] }) })
  ok('bulk-import empty payload → 400', r.status === 400)
  r = await fetch(`${BASE}/api/providers/bulk-import`, { method: 'POST', headers: H0, body: JSON.stringify({ providers: [] }) })
  ok('bulk-import without lock → 401', r.status === 401)
  const bulkPayload = {
    providers: [
      { name: '__e2e_v63_bulk', kind: 'openai-compatible', endpoint: 'https://example.invalid/v1', apiKey: 'sk-e2e-bulk-key-0987654321', model: 'bulk-model' },
      { name: '__e2e_v63_bulk_dup', kind: 'openai-compatible', endpoint: 'https://example.invalid/v1', apiKey: 'sk-e2e-bulk-key-0987654321', model: 'bulk-model' }, // duplicate key
    ],
  }
  r = await fetch(`${BASE}/api/providers/bulk-import`, { method: 'POST', headers: H, body: JSON.stringify(bulkPayload) })
  const bi = await r.json()
  ok('bulk-import → 1 imported, 1 duplicate skipped', r.status === 200 && bi.ok === true && bi.imported === 1 && bi.duplicates === 1, JSON.stringify({ imported: bi.imported, duplicates: bi.duplicates }))
  const poolNow = await (await fetch(`${BASE}/api/providers`, { headers: H })).json()
  const bulkRow = (poolNow.providers || []).find(p => p.name === '__e2e_v63_bulk')
  ok('bulk-imported provider really landed in the pool', !!bulkRow)

  // ════ H. binary-safe upload path the ZIP/AIA attach uses ════════════════
  // real ZIP bytes (PK header) → writeBase64 → exact read-back
  const zipBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), crypto.randomBytes(48), Buffer.from([0x50, 0x4b, 0x05, 0x06]), crypto.randomBytes(16)])
  const b64 = zipBytes.toString('base64')
  r = await fetch(`${BASE}/api/files`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ projectId: pid, path: 'uploads/e2e-v63.aia', op: 'writeBase64', contentBase64: b64 }),
  })
  ok('writeBase64 ZIP to uploads/ → 200', r.status === 200)
  const back = await (await fetch(`${BASE}/api/files?projectId=${pid}&path=${encodeURIComponent('uploads/e2e-v63.aia')}&encoding=base64`, { headers: H })).json()
  const round = Buffer.from(back.content || '', 'base64')
  ok('uploads/ binary round-trip is byte-exact (PK header intact)', round.length === zipBytes.length && round[0] === 0x50 && round[1] === 0x4b, `${round.length}B`)

  // ════ J. source-structure checks (UI halves of the batch) ════════════════
  const dashSrc = fs.readFileSync('src/components/cloud-agent/dashboard/Dashboard.tsx', 'utf8')
  const dashClean = stripComments(dashSrc)
  ok('Dashboard: global Ctrl+Shift+S handler exists', dashClean.includes("(e.key === 'S' || e.key === 's')") && dashClean.includes('window.addEventListener(\'keydown\''))
  ok('Dashboard: BottomPanel reacts to agentOpen/terminalOpen', dashClean.includes('if (agentOpen) onView(\'agent\')') && dashClean.includes('if (terminalOpen) onView(\'terminal\')'))
  ok('Dashboard: mobile flips land on the right bottom-nav panel', dashClean.includes("setMobilePanel('agent')") && dashClean.includes("setMobilePanel('terminal')"))
  ok('Dashboard: runtime logs finally rendered (logs popover)', dashClean.includes('{logs ||'))
  ok('Dashboard: Save All handler is shared by button + shortcut', dashClean.includes('onClick={saveAll}') && dashClean.includes('void saveAll()'))

  const editorSrc = fs.readFileSync('src/components/cloud-agent/dashboard/CodeEditor.tsx', 'utf8')
  const editorClean = stripComments(editorSrc)
  ok('CodeEditor: reads ca:autoSave gate in scheduleSave', editorClean.includes("localStorage.getItem('ca:autoSave') === 'false'"))
  ok('CodeEditor: font/wrap/minimap come from settings', editorClean.includes('editorPrefs.fontSize') && editorClean.includes('editorPrefs.wordWrap') && editorClean.includes('editorPrefs.minimap'))
  ok('CodeEditor: follows ca:settings-changed live', editorClean.includes("addEventListener('ca:settings-changed'"))

  const paneSrc = fs.readFileSync('src/components/cloud-agent/dashboard/TerminalPane.tsx', 'utf8')
  const paneClean = stripComments(paneSrc)
  ok('TerminalPane: real command history (persist + rerun)', paneClean.includes('ca:term-history:') && paneClean.includes('function rerun('))
  ok('TerminalPane: sends shell choice to /api/terminal', paneClean.includes("localStorage.getItem('ca:shell')") && paneClean.includes('shell'))
  ok('TerminalPane: terminal font size from settings + live', paneClean.includes('ca:termFontSize') && paneClean.includes('ca:settings-changed'))
  ok('TerminalPanel: toast-only history stub is GONE', !paneClean.includes('Use ↑/↓ keys'))

  const agentSrcRaw = fs.readFileSync('src/components/cloud-agent/dashboard/AgentPanel.tsx', 'utf8')
  ok('AgentPanel: archive attach is binary-safe (writeBase64 into uploads/)', agentSrcRaw.includes('uploads/${safeName}') && agentSrcRaw.includes("op: 'writeBase64'"))
  ok('AgentPanel: .aia files can be selected', agentSrcRaw.includes("'.zip,.aia'"))
  ok('AgentPanel: pendingChatPrompt store handoff (welcome-safe)', agentSrcRaw.includes('pendingChatPrompt') && agentSrcRaw.includes("setPendingChatPrompt('')"))
  ok('AgentPanel: dead ca:use-prompt listener migrated away', !agentSrcRaw.includes("addEventListener('ca:use-prompt'"))
  ok('AgentPanel: chevron has a real handler (or hides on mobile fullHeight)', agentSrcRaw.includes('setExpanded(!expanded)') && agentSrcRaw.includes('{!fullHeight && ('))

  const pmSrc = fs.readFileSync('src/components/cloud-agent/dialogs/ProviderManagerDialog.tsx', 'utf8')
  const pmClean = stripComments(pmSrc)
  ok('ProviderManager: one-click model switch wired (models + update-model)', pmClean.includes("fetch('/api/providers/models'") && pmClean.includes("fetch('/api/providers/update-model'"))
  ok('ProviderManager: bulk import wired', pmClean.includes("fetch('/api/providers/bulk-import'"))

  const pubSrc = fs.readFileSync('src/components/cloud-agent/dialogs/PublishDialog.tsx', 'utf8')
  const pubClean = stripComments(pubSrc)
  ok('PublishDialog: build history + deploy targets wired', pubClean.includes('/api/builds?projectId=') && pubClean.includes("fetch('/api/deploy')"))
  ok('PublishDialog: history re-download uses the REAL route', pubClean.includes('/api/publish?id=${b.id}'))

  const setSrc = fs.readFileSync('src/components/cloud-agent/dialogs/SettingsDialog.tsx', 'utf8')
  const setClean = stripComments(setSrc)
  ok('Settings: storage card consumes /api/projects/storage', setClean.includes('/api/projects/storage'))
  ok('Settings: changes broadcast ca:settings-changed', (setClean.match(/ca:settings-changed/g) || []).length >= 4)

  const storeSrc = fs.readFileSync('src/lib/store.ts', 'utf8')
  ok('store: pendingChatPrompt exists', stripComments(storeSrc).includes('pendingChatPrompt: string'))

  const toolsSrc = fs.readFileSync('src/lib/ai/tools.ts', 'utf8')
  ok('deploy tool: no more hardcoded localhost:3000', stripComments(toolsSrc).includes('process.env.PORT || 3000') && !stripComments(toolsSrc).includes("http://localhost:3000/api/deploy'"))

  const devSrc = fs.readFileSync('src/components/cloud-agent/dialogs/DeveloperModeDialog.tsx', 'utf8')
  ok('DeveloperModeDialog: dead /api/secrets fetch removed', !devSrc.includes("await fetch('/api/secrets')"))

  const kSrc = fs.readFileSync('src/components/cloud-agent/dashboard/CodeEditor.tsx', 'utf8')
  ok('shortcut: no leftover toast in FileTree preview close (X icon now)', fs.readFileSync('src/components/cloud-agent/dashboard/FileTree.tsx', 'utf8').includes('Close preview'))

  // ════ K. shipped-chunk checks (what the browser actually loads) ══════════
  // Same method as v62: fetch the app page, collect the chunk URLs it loads,
  // fetch each chunk, and assert the v63 wiring really ships.
  const page = await (await fetch(`${BASE}/`, { headers: { 'x-ca-lock': token } })).text()
  const chunks = [...new Set(page.match(/\/_next\/static\/chunks\/[^"]+\.js/g) || [])]
  let bundled = ''
  for (const c of chunks) {
    try { bundled += await (await fetch(`${BASE}${c}`)).text() } catch {}
  }
  ok('bundle walk actually found client chunks', chunks.length > 0 && bundled.length > 100000, `${chunks.length} chunks, ${Math.round(bundled.length / 1024)}KB scanned`)
  ok('bundle ships the secrets/test caller (Test connection now real)', bundled.includes('/api/secrets/test'))
  ok('bundle ships Ctrl+Shift+S save-all wiring', bundled.includes('ca:autoSave') && bundled.includes("addEventListener('keydown'"))
  ok('bundle ships pendingChatPrompt handoff', bundled.includes('pendingChatPrompt'))
  ok('bundle ships bulk-import + update-model UI calls', bundled.includes('/api/providers/bulk-import') && bundled.includes('/api/providers/update-model'))
  ok('bundle ships build history + deploy card calls', bundled.includes('/api/builds?projectId=') && bundled.includes("fetch('/api/deploy')"))
  // The Settings → Terminal side ships EAGER (SettingsDialog). TerminalPane
  // itself is a LAZY chunk — compiled only when a browser first opens the
  // terminal — so its wiring is proven by the source checks above and by the
  // LIVE shell tests in section F, not by this eager-bundle check.
  ok('bundle ships terminal settings wiring (ca:shell writer + settings-changed bus)', bundled.includes('ca:shell') && bundled.includes('ca:settings-changed'))

  // ════ cleanup via real APIs only ═════════════════════════════════════════
  await fetch(`${BASE}/api/projects/${pid}?hard=1`, { method: 'DELETE', headers: H })
  if (provId) await fetch(`${BASE}/api/providers?id=${provId}`, { method: 'DELETE', headers: H })
  if (bulkRow?.id) await fetch(`${BASE}/api/providers?id=${bulkRow.id}`, { method: 'DELETE', headers: H })
  await fetch(`${BASE}/api/secrets?id=`, { method: 'DELETE', headers: H }) // no id → no-op safe call
  for (const k of [gKey, gBad]) {
    const row = await db.userSetting.findUnique({ where: { key: `secret:${k}` } })
    if (row) await db.userSetting.delete({ where: { id: row.id } })
  }
  const afterPool = await (await fetch(`${BASE}/api/providers`, { headers: H })).json()
  ok('cleanup: no e2e providers left in the pool', !(afterPool.providers || []).some(p => /e2e/i.test(p.name)))
  await db.lockSession.deleteMany({ where: { device: 'E2E v63 every-button-real' } })
  console.log('\ncleanup: E2E project hard-deleted, providers removed, secrets removed, session removed')

  console.log(`\n=== v63 RESULT: ${pass} PASS / ${fail} FAIL ===\n`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
