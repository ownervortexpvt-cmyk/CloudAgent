// E2E v92 — zip import keeps binaries (regression: /api/zip silently dropped pngs)
// A) AdmZip zip under my-app/ → strip test: png ON DISK, text in DB, node_modules skipped
// B) python-crafted zip with literal ../ names → route traversal guard blocks both
import { PrismaClient } from '@prisma/client'
import { createHmac, createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const db = new PrismaClient()
const base = 'http://localhost:3000'
let pass = 0, fail = 0
const ok = (cond, label) => { if (cond) { pass++; console.log(`  PASS ${label}`) } else { fail++; console.log(`  FAIL ${label}`) } }

const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
if (!secret) { console.error('no lock_secret'); process.exit(1) }
const payload = `v1.${Date.now() + 3600e3}`
const TOKEN = `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex')
await db.lockSession.create({ data: { tokenHash: TOKEN_HASH, device: 'e2e v92 zip', ip: '127.0.0.1' } })
const H = { 'x-ca-lock': TOKEN }

// --- zip A: all under my-app/ (GitHub-style), png + nested + node_modules ---
const zipA = new AdmZip()
zipA.addFile('my-app/README.md', Buffer.from('# Hello v92\nbinary safe now'))
zipA.addFile('my-app/package.json', Buffer.from(JSON.stringify({ name: 'v92-e2e', scripts: { dev: 'next dev' } })))
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
zipA.addFile('my-app/public/logo.png', PNG_1x1)
zipA.addFile('my-app/src/lib/util.ts', Buffer.from('export const v92 = true\n'))
zipA.addFile('my-app/node_modules/x/index.js', Buffer.from('skip me'))

// --- zip B: literal ../ entry names (python stores them verbatim) ---
const evilZipPath = '/home/z/my-project/scripts/.tmp-evil.zip'
execSync(`python3 /home/z/my-project/scripts/craft-evil-zip.py ${evilZipPath}`)
const zipB = fs.readFileSync(evilZipPath)
fs.rmSync(evilZipPath, { force: true })

let projectId = null
try {
  console.log('=== 1. create project ===')
  const cr = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...H }, body: JSON.stringify({ name: 'v92-zip-e2e' }) })
  const crd = await cr.json()
  ok(!!crd.project?.id, `project created (${cr.status})`)
  projectId = crd.project?.id
  if (!projectId) throw new Error('no project id')
  const root = `/home/z/my-project/projects/${projectId}`

  console.log('=== 2. POST /api/zip — zip A (strip + binaries) ===')
  const fd = new FormData()
  fd.append('file', new Blob([zipA.toBuffer()], { type: 'application/zip' }), 'v92-e2e.zip')
  fd.append('projectId', projectId)
  const up = await fetch(`${base}/api/zip`, { method: 'POST', headers: H, body: fd })
  const upd = await up.json()
  ok(upd.ok === true, `import ok (${up.status})`)
  ok(upd.imported === 4, `imported===4, node_modules skipped (got ${upd.imported})`)

  console.log('=== 3. disk assertions (top-level folder STRIPPED) ===')
  const pngPath = path.join(root, 'public/logo.png')
  ok(fs.existsSync(pngPath), 'logo.png EXISTS on disk (was silently dropped before v92)')
  if (fs.existsSync(pngPath)) ok(fs.readFileSync(pngPath).equals(PNG_1x1), 'logo.png bytes identical')
  ok(fs.existsSync(path.join(root, 'src/lib/util.ts')), 'nested src/lib/util.ts on disk')
  ok(fs.existsSync(path.join(root, 'package.json')), 'package.json on disk')
  ok(!fs.existsSync(path.join(root, 'node_modules')), 'node_modules skipped')

  console.log('=== 4. DB assertions ===')
  const dbRow = await db.file.findFirst({ where: { projectId, path: 'README.md' } })
  ok(!!dbRow && dbRow.content.includes('Hello v92'), 'text file in DB')
  const pngRow = await db.file.findFirst({ where: { projectId, path: 'public/logo.png' } })
  ok(!pngRow, 'png NOT bloating DB (disk-only by design)')

  console.log('=== 5. traversal guard (zip B, literal ../ names) ===')
  const fd2 = new FormData()
  fd2.append('file', new Blob([zipB], { type: 'application/zip' }), 'evil.zip')
  fd2.append('projectId', projectId)
  const up2 = await fetch(`${base}/api/zip`, { method: 'POST', headers: H, body: fd2 })
  const upd2 = await up2.json()
  ok(upd2.ok === true, `import B ok (${up2.status})`)
  ok(upd2.imported === 1, `only ../-free entry imported (got ${upd2.imported})`)
  ok(!fs.existsSync(path.join(root, 'evil2.txt')) && !fs.existsSync(path.join(root, 'evil3.txt')), 'no evil files inside project')
  ok(!fs.existsSync('/home/z/my-project/projects/evil2.txt') && !fs.existsSync('/home/z/my-project/evil2.txt') && !fs.existsSync('/home/z/my-project/projects/my-app/evil3.txt'), 'no evil files outside project root')
  ok(fs.existsSync(path.join(root, 'ok.txt')), 'benign entry from zip B landed')
} catch (e) {
  fail++; console.log('  FATAL', e.message)
} finally {
  if (projectId) {
    try { fs.rmSync(`/home/z/my-project/projects/${projectId}`, { recursive: true, force: true }) } catch {}
    await db.file.deleteMany({ where: { projectId } }).catch(() => {})
    await db.project.delete({ where: { id: projectId } }).catch(() => {})
  }
  await db.lockSession.deleteMany({ where: { tokenHash: TOKEN_HASH } })
  await db.$disconnect()
}
console.log(`\n=== v92 zip E2E: ${pass} pass / ${fail} fail ===`)
process.exit(fail ? 1 : 0)
