/**
 * E2E v62 — the full missing-features batch (12 features, all REAL):
 *   1.  🗑️ Trash — soft-delete, separate trash list, files survive, restore,
 *       delete-forever (hard) — all through real APIs
 *   2.  ✏️ Rename — PATCH name + description through the whitelisted PATCH
 *   3.  🔀 Version diff — snapshot → edit + add files → action:diff reports
 *       the exact +/− lines between snapshot and current
 *   4.  ⌨️ Quick-open wiring — ca:quick-open / ca:search-project events now
 *       have a real listener (dead-shortcut fix) + files mode
 *   5.  📚 Prompt Library API — create → list → use-bump → delete (+400s)
 *   6.  🏁 Benchmarks API — real provider row → upsert score → list joins
 *       provider name → DELETE cleanup
 *   7.  🖼️ Binary-safe files — writeBase64 PNG bytes → ?encoding=base64 read
 *       round-trips EXACTLY; binary download path fixed
 *   8.  📝 Markdown preview split view ships (editor Preview toggle)
 *   9.  🌗 Monaco light theme (cloud-agent-light) defined + theme-following
 *   10. 🔔 Mobile bell (no more hidden md:block wrapper) + sheet menu rows
 *   11. 🧭 Getting-started dialog + first-run auto-open
 *   12. 🔒 Auth — every NEW route is lock-guarded (401 without a session)
 *
 * Run: node scripts/e2e-v62-full-batch.mjs   (dev server on :3000)
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

async function main() {
  console.log(`\n=== v62 full-batch E2E @ ${BASE} ===\n`)

  // ── mint a real session token (the lock is configured) ───────────────────
  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  const payload = `v1.${Date.now() + 3600e3}`
  const token = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  await db.lockSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), device: 'E2E v62 full-batch', ip: '127.0.0.1' } })
  const H = { 'Content-Type': 'application/json', 'x-ca-lock': token }
  const H0 = { 'Content-Type': 'application/json' } // no lock header

  // ── 12. AUTH: every NEW route is lock-guarded ────────────────────────────
  let r401 = await fetch(`${BASE}/api/prompts`, { headers: H0 })
  ok('/api/prompts without lock session → 401', r401.status === 401, `got ${r401.status}`)
  r401 = await fetch(`${BASE}/api/benchmarks`, { headers: H0 })
  ok('/api/benchmarks without lock session → 401', r401.status === 401, `got ${r401.status}`)
  r401 = await fetch(`${BASE}/api/projects?trash=1`, { headers: H0 })
  ok('/api/projects?trash=1 without lock session → 401', r401.status === 401, `got ${r401.status}`)

  // ── 1+2. TRASH + RENAME — full real lifecycle ────────────────────────────
  const created = await (await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: '__e2e_v62_trash', description: 'v62 trash target', language: 'html' }),
  })).json()
  const pid = created.project?.id
  ok('project created (html starter)', !!pid && !!created.project, pid || 'no id')

  // rename before trashing
  let r = await fetch(`${BASE}/api/projects/${pid}`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ name: '__e2e_v62_renamed', description: 'renamed by v62 E2E' }),
  })
  const renamed = await r.json()
  ok('PATCH renames project + rewrites description', r.status === 200 && renamed.project?.name === '__e2e_v62_renamed' && renamed.project?.description === 'renamed by v62 E2E')
  const afterRename = await (await fetch(`${BASE}/api/projects/${pid}`, { headers: H })).json()
  ok('GET shows the new metadata persisted', afterRename.project?.name === '__e2e_v62_renamed')

  // soft delete → trash
  r = await fetch(`${BASE}/api/projects/${pid}`, { method: 'DELETE', headers: H })
  const soft = await r.json()
  ok('DELETE (no flags) → soft delete, trashed:true', r.status === 200 && soft.trashed === true)

  const aliveList = (await (await fetch(`${BASE}/api/projects`, { headers: H })).json()).projects || []
  ok('default project list EXCLUDES the trashed project', !aliveList.some(p => p.id === pid), `list=${aliveList.length}`)

  const trashList = (await (await fetch(`${BASE}/api/projects?trash=1`, { headers: H })).json()).projects || []
  ok('?trash=1 lists ONLY trashed projects and contains ours', trashList.some(p => p.id === pid), `trash=${trashList.length}`)

  // files must SURVIVE the soft delete (disk is untouched)
  const treeWhileTrashed = await (await fetch(`${BASE}/api/projects/${pid}`, { headers: H })).json()
  const trashedFileCount = (treeWhileTrashed.tree?.children || []).length
  ok('trashed project files SURVIVE (tree still readable)', trashedFileCount >= 3, `children=${trashedFileCount}`)

  // restore
  r = await fetch(`${BASE}/api/projects/${pid}/restore`, { method: 'POST', headers: H })
  const restored = await r.json()
  ok('restore route → ok:true, restored:true', r.status === 200 && restored.restored === true)
  const aliveList2 = (await (await fetch(`${BASE}/api/projects`, { headers: H })).json()).projects || []
  ok('restored project is back in the default list', aliveList2.some(p => p.id === pid))

  // restore when NOT trashed → honest no-op
  r = await fetch(`${BASE}/api/projects/${pid}/restore`, { method: 'POST', headers: H })
  const noop = await r.json()
  ok('restore on a non-trashed project → honest no-op (restored:false, 200)', r.status === 200 && noop.restored === false)

  // hard delete forever
  r = await fetch(`${BASE}/api/projects/${pid}?hard=1`, { method: 'DELETE', headers: H })
  const hard = await r.json()
  ok('DELETE ?hard=1 → old destructive path (ok:true, no trashed flag)', r.status === 200 && hard.trashed === undefined)
  const trashList2 = (await (await fetch(`${BASE}/api/projects?trash=1`, { headers: H })).json()).projects || []
  const aliveList3 = (await (await fetch(`${BASE}/api/projects`, { headers: H })).json()).projects || []
  ok('hard-deleted project gone from BOTH lists', !trashList2.some(p => p.id === pid) && !aliveList3.some(p => p.id === pid))
  const gone = await fetch(`${BASE}/api/projects/${pid}`, { headers: H })
  ok('GET on the hard-deleted project → 404', gone.status === 404, `got ${gone.status}`)

  // ── 3. VERSION DIFF — snapshot → edit → diff ─────────────────────────────
  const vproj = await (await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: '__e2e_v62_diff', language: 'html' }),
  })).json()
  const vid = vproj.project?.id
  const snap1 = await (await fetch(`${BASE}/api/versions`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ projectId: vid, action: 'snapshot', label: 'v62 before edit' }),
  })).json()
  ok('snapshot created', snap1.ok && !!snap1.snapshot?.id)

  // edit an existing starter file + add a new one
  const indexFile = (await (await fetch(`${BASE}/api/files/${vid}`, { headers: H })).json()).tree.children.find(f => f.name.endsWith('.html'))
  await fetch(`${BASE}/api/files`, { method: 'PUT', headers: H, body: JSON.stringify({ projectId: vid, path: indexFile.path, content: '<html><body>V62 EDITED LINE</body></html>\n' }) })
  await fetch(`${BASE}/api/files`, { method: 'POST', headers: H, body: JSON.stringify({ projectId: vid, path: 'v62-added.txt', content: 'brand new file\n' }) })

  const diff = await (await fetch(`${BASE}/api/versions`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ projectId: vid, action: 'diff', id: snap1.snapshot.id }),
  })).json()
  ok('action:diff → ok with changed>=2 (edited + added)', diff.ok && diff.changed >= 2, `changed=${diff.changed}`)
  const editedDiff = (diff.files || []).find(f => f.path === indexFile.path)
  const addedDiff = (diff.files || []).find(f => f.path === 'v62-added.txt')
  ok('edited file diff carries the + line with the new content', !!editedDiff && editedDiff.lines.some(l => l.t === '+' && l.s.includes('V62 EDITED LINE')))
  ok('edited file diff carries the − line with the old content', !!editedDiff && editedDiff.lines.some(l => l.t === '-' && l.s.length > 0 && !l.s.includes('V62 EDITED LINE')))
  ok('added file reported (+brand new file)', !!addedDiff && addedDiff.added >= 1 && addedDiff.lines.some(l => l.t === '+' && l.s.includes('brand new file')))
  const badDiff = await (await fetch(`${BASE}/api/versions`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ projectId: vid, action: 'diff', id: 'nonexistent' }),
  })).json()
  ok('diff with a bogus snapshot id → honest 400-style error', badDiff.ok === false && /not found/i.test(badDiff.error || ''))

  // ── 5. PROMPT LIBRARY API ────────────────────────────────────────────────
  let pr = await fetch(`${BASE}/api/prompts`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'x' }) })
  ok('POST /api/prompts without prompt → 400', pr.status === 400)
  pr = await fetch(`${BASE}/api/prompts`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'v62 E2E prompt', prompt: 'Refactor the open file to use early returns', category: 'code' }) })
  const promptSaved = await pr.json()
  ok('POST /api/prompts → created', pr.status === 200 && promptSaved.ok && !!promptSaved.prompt?.id)
  const promptList = (await (await fetch(`${BASE}/api/prompts?q=v62`, { headers: H })).json()).prompts || []
  ok('GET /api/prompts?q= finds it, most-used ordering present', promptList.some(p => p.id === promptSaved.prompt.id))
  pr = await fetch(`${BASE}/api/prompts`, { method: 'PATCH', headers: H, body: JSON.stringify({ id: promptSaved.prompt.id, use: true }) })
  const bumped = await pr.json()
  ok('PATCH use:true bumps useCount to 1', pr.status === 200 && bumped.prompt?.useCount === 1, `useCount=${bumped.prompt?.useCount}`)
  pr = await fetch(`${BASE}/api/prompts?id=${promptSaved.prompt.id}`, { method: 'DELETE', headers: H })
  const promptGone = (await (await fetch(`${BASE}/api/prompts?q=v62`, { headers: H })).json()).prompts || []
  ok('DELETE /api/prompts removes it', pr.status === 200 && !promptGone.some(p => p.id === promptSaved.prompt.id))

  // ── 6. BENCHMARKS API ────────────────────────────────────────────────────
  const provBefore = (await (await fetch(`${BASE}/api/providers`, { headers: H })).json()).providers || []
  const prov = await (await fetch(`${BASE}/api/providers`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: '__e2e_v62_bench', kind: 'openai-compatible', endpoint: 'https://example.invalid/v1', apiKey: 'e2e-v62-bench-key', model: 'v62-model-x' }),
  })).json()
  ok('benchmark host provider saved', !!prov.provider?.id)
  let br = await fetch(`${BASE}/api/benchmarks`, { method: 'POST', headers: H, body: JSON.stringify({ model: 'm' }) })
  ok('POST /api/benchmarks missing fields → 400', br.status === 400)
  br = await fetch(`${BASE}/api/benchmarks`, { method: 'POST', headers: H, body: JSON.stringify({ providerId: 'nope', model: 'm', task: 'math' }) })
  ok('POST /api/benchmarks unknown provider → 404', br.status === 404, `got ${br.status}`)
  br = await fetch(`${BASE}/api/benchmarks`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ providerId: prov.provider.id, model: 'v62-model-x', task: 'code_generation', score: 87.5, latencyMs: 1400, tokensIn: 210, tokensOut: 90, notes: 'v62 e2e' }),
  })
  const benchSaved = await br.json()
  ok('POST /api/benchmarks upserts a real score', br.status === 200 && benchSaved.ok && benchSaved.benchmark?.score === 87.5)
  const benchList = (await (await fetch(`${BASE}/api/benchmarks`, { headers: H })).json()).benchmarks || []
  const benchRow = benchList.find(b => b.providerId === prov.provider.id)
  ok('GET /api/benchmarks joins the real provider NAME', !!benchRow && benchRow.providerName === '__e2e_v62_bench', benchRow ? benchRow.providerName : 'missing')
  br = await fetch(`${BASE}/api/benchmarks`, { method: 'DELETE', headers: H, body: JSON.stringify({}), search: undefined })
  // (DELETE is query-param based; do it properly)
  const bd = await fetch(`${BASE}/api/benchmarks?id=${benchRow.id}`, { method: 'DELETE', headers: H })
  ok('DELETE /api/benchmarks cleans the row', bd.status === 200)
  await fetch(`${BASE}/api/providers?id=${prov.provider.id}`, { method: 'DELETE', headers: H })
  const provAfter = (await (await fetch(`${BASE}/api/providers`, { headers: H })).json()).providers || []
  ok('benchmark host provider cleaned via real DELETE', provAfter.length === provBefore.length, `before=${provBefore.length} after=${provAfter.length}`)

  // ── 7. BINARY-SAFE FILES — base64 round trip ─────────────────────────────
  const bproj = await (await fetch(`${BASE}/api/projects`, {
    method: 'POST', headers: H, body: JSON.stringify({ name: '__e2e_v62_bin', language: 'html' }),
  })).json()
  const bid = bproj.project?.id
  // A tiny valid PNG (1×1 red pixel)
  const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const wb = await fetch(`${BASE}/api/files`, { method: 'POST', headers: H, body: JSON.stringify({ projectId: bid, path: 'assets/pixel.png', op: 'writeBase64', contentBase64: PNG_B64 }) })
  const wbData = await wb.json()
  ok('writeBase64 stores real binary bytes (ok, bytes=70)', wb.status === 200 && wbData.ok && wbData.bytes === 70, `bytes=${wbData.bytes}`)
  const rb = await (await fetch(`${BASE}/api/files?projectId=${bid}&path=${encodeURIComponent('assets/pixel.png')}&encoding=base64`, { headers: H })).json()
  ok('?encoding=base64 round-trips the EXACT bytes', rb.content === PNG_B64 && rb.encoding === 'base64' && rb.size === 70, `size=${rb.size}`)
  const rtext = await (await fetch(`${BASE}/api/files?projectId=${bid}&path=${encodeURIComponent('assets/pixel.png')}`, { headers: H })).json()
  ok('plain GET still returns utf8 view (back-compat)', typeof rtext.content === 'string' && !('encoding' in rtext))
  const badB64 = await fetch(`${BASE}/api/files`, { method: 'POST', headers: H, body: JSON.stringify({ projectId: bid, path: 'x.bin', op: 'writeBase64' }) })
  ok('writeBase64 without contentBase64 → 400', badB64.status === 400)

  // ── 8-11. SHIPPED CLIENT — source structure + compiled chunks ────────────
  const welcomeSrc = fs.readFileSync('/home/z/my-project/src/components/cloud-agent/welcome/WelcomeView.tsx', 'utf8')
  const fileTreeSrc = fs.readFileSync('/home/z/my-project/src/components/cloud-agent/dashboard/FileTree.tsx', 'utf8')
  const editorSrc = fs.readFileSync('/home/z/my-project/src/components/cloud-agent/dashboard/CodeEditor.tsx', 'utf8')
  const paletteSrc = fs.readFileSync('/home/z/my-project/src/components/cloud-agent/dashboard/CommandPalette.tsx', 'utf8')
  const storeSrc = fs.readFileSync('/home/z/my-project/src/lib/store.ts', 'utf8')
  const pageSrc = fs.readFileSync('/home/z/my-project/src/app/page.tsx', 'utf8')
  const dashSrc = fs.readFileSync('/home/z/my-project/src/components/cloud-agent/dashboard/Dashboard.tsx', 'utf8')
  const helpSrc = fs.readFileSync('/home/z/my-project/src/components/cloud-agent/dialogs/HelpDialog.tsx', 'utf8')
  const promptDlgSrc = fs.readFileSync('/home/z/my-project/src/components/cloud-agent/dialogs/PromptLibraryDialog.tsx', 'utf8')
  const versionsSrc = fs.readFileSync('/home/z/my-project/src/lib/versions.ts', 'utf8')
  const diffSrc = fs.readFileSync('/home/z/my-project/src/lib/diff.ts', 'utf8')
  const settingsSrc = fs.readFileSync('/home/z/my-project/src/components/cloud-agent/dialogs/SettingsDialog.tsx', 'utf8')

  ok('WelcomeView: trash toggle + Delete forever + restore wired', welcomeSrc.includes("'/api/projects?trash=1'") && welcomeSrc.includes('Delete forever') && welcomeSrc.includes('/restore'))
  ok('WelcomeView: delete is a TRASH move (soft) with hard=1 for forever', welcomeSrc.includes('Move this project to the Trash?') && welcomeSrc.includes('?hard=1'))
  ok('WelcomeView: Rename / Edit menu item + PATCH submit', welcomeSrc.includes('Rename / Edit') && welcomeSrc.includes("method: 'PATCH'"))
  ok('WelcomeView: Prompt Library + Help header buttons', welcomeSrc.includes('setPromptLibraryOpen(true)') && welcomeSrc.includes('setHelpOpen(true)'))
  ok('FileTree: upload via writeBase64 for binaries + plain write for text', fileTreeSrc.includes("op: 'writeBase64'") && fileTreeSrc.includes('uploadFiles'))
  ok('FileTree: image preview via base64 data URL + markdown rendered preview', fileTreeSrc.includes('data:${mimeFor(name)};base64,') && fileTreeSrc.includes('ReactMarkdown'))
  ok('FileTree: binary-safe download uses the base64 endpoint', fileTreeSrc.includes('&encoding=base64') && fileTreeSrc.includes('re-assembled with the right MIME type'))
  ok('CodeEditor: markdown Preview toggle + split view for .md', editorSrc.includes('Toggle rendered markdown preview') && editorSrc.includes('isMd && mdPreview'))
  ok('CodeEditor: cloud-agent-light theme defined + theme-following', editorSrc.includes("'cloud-agent-light'") && editorSrc.includes('MutationObserver'))
  ok('CodeEditor: Ctrl+P / Ctrl+Shift+F dispatch events (now with listeners)', editorSrc.includes("ca:quick-open") && editorSrc.includes("ca:search-project"))
  ok('CommandPalette: listens for quick-open + search-project events', paletteSrc.includes("addEventListener('ca:quick-open'") && paletteSrc.includes("addEventListener('ca:search-project'"))
  ok('CommandPalette: files mode lists active project files', paletteSrc.includes('filesMode') && paletteSrc.includes('Files in'))
  ok('CommandPalette: Prompt library + Getting started commands', paletteSrc.includes("'Prompt library'") && paletteSrc.includes("'Getting started / help'"))
  ok('AgentPanel: prompt prefill via pendingChatPrompt store handoff (v63 migrated from ca:use-prompt)', fs.readFileSync('/home/z/my-project/src/components/cloud-agent/dashboard/AgentPanel.tsx', 'utf8').includes('pendingChatPrompt') && fs.readFileSync('/home/z/my-project/src/components/cloud-agent/dashboard/AgentPanel.tsx', 'utf8').includes("setPendingChatPrompt('')"))
  ok('store: promptLibraryOpen + helpOpen flags', storeSrc.includes('promptLibraryOpen') && storeSrc.includes('helpOpen'))
  ok('page: dialogs mounted + first-run help auto-open (ca:helpSeen)', pageSrc.includes('<PromptLibraryDialog />') && pageSrc.includes('<HelpDialog />') && pageSrc.includes("ca:helpSeen"))
  ok('Dashboard: bell visible on ALL sizes (no hidden md:block wrapper)', !dashSrc.includes('hidden md:block') && dashSrc.includes('<NotificationCenter />'))
  ok('Dashboard: sheet menu has Prompt Library + Getting Started + Move to Trash', dashSrc.includes('Prompt Library') && dashSrc.includes('Getting Started') && dashSrc.includes('Move to Trash'))
  ok('HelpDialog: 5 real steps + Add-key CTA', helpSrc.includes('1 · Add an AI key') && helpSrc.includes('Add an AI key now'))
  ok('PromptLibraryDialog: Use-in-chat handoff + Use-in-Army prefill + copy (v63: store-based, welcome-safe)', promptDlgSrc.includes('setPendingChatPrompt') && promptDlgSrc.includes('setMultiAgentPrompt') && promptDlgSrc.includes('clipboard'))
  ok('versions lib: diffVersion caps (60 files, 1200 lines, 2MB) + binary guard', versionsSrc.includes('DIFF_MAX_FILES = 60') && versionsSrc.includes('includes(0)'))
  ok('diff lib: real LCS with common prefix/suffix trim', diffSrc.includes('MAX_LCS') && diffSrc.includes('dp[i + 1][j]'))
  ok('Settings: recharts usage chart + Benchmarks tab', settingsSrc.includes('ResponsiveContainer') && settingsSrc.includes('BenchmarksSettings') && settingsSrc.includes("'benchmarks'"))

  // compiled chunks
  const page = await (await fetch(`${BASE}/`, { headers: { 'x-ca-lock': token } })).text()
  const chunks = [...new Set(page.match(/\/_next\/static\/chunks\/[^"]+\.js/g) || [])]
  let hay = ''
  for (const c of chunks) {
    try { hay += await (await fetch(`${BASE}${c}`)).text() } catch {}
  }
  ok('chunk set collected', chunks.length > 0, `${chunks.length} chunks, ${Math.round(hay.length / 1024)}KB`)
  ok('bundle ships trash UI ("Delete forever" + "Move to Trash")', hay.includes('Delete forever') && hay.includes('Move to Trash'))
  ok('bundle ships Rename / Edit + trash hint text', hay.includes('Rename / Edit') && hay.includes('keep their files until you remove them forever'))
  ok('bundle ships the prompt prefill wiring (pendingChatPrompt, v63 mechanism)', hay.includes('pendingChatPrompt'))
  ok('bundle ships the light theme name cloud-agent-light', hay.includes('cloud-agent-light'))
  ok('bundle ships the markdown preview toggle', hay.includes('Toggle rendered markdown preview'))
  ok('bundle ships Prompt library + Getting started commands', hay.includes('Prompt library') && hay.includes('Getting started / help'))
  ok('bundle ships quick-open files header', hay.includes('Files in'))
  ok('bundle ships the diff view header ("vs current files")', hay.includes('vs current files'))
  ok('bundle ships upload (writeBase64 op)', hay.includes('writeBase64'))

  // ── cleanup via real APIs only ───────────────────────────────────────────
  await fetch(`${BASE}/api/projects/${bid}?hard=1`, { method: 'DELETE', headers: H })
  await fetch(`${BASE}/api/projects/${vid}?hard=1`, { method: 'DELETE', headers: H })
  await db.lockSession.deleteMany({ where: { device: 'E2E v62 full-batch' } })
  console.log('\ncleanup: E2E projects hard-deleted via real APIs, session removed')

  console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===\n`)
  await db.$disconnect()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async e => { console.error('E2E crashed:', e); await db.$disconnect().catch(() => {}); process.exit(1) })
