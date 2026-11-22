// Task 102: verify /api/backup-download auth + byte-identical serving.
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import fs from 'fs'

const db = new PrismaClient()
const base = 'http://localhost:3000'
// newest cloud-agent-full-backup-*.zip on disk — same rule the route uses
const ZIP = fs.readdirSync('/home/z/my-project/download')
  .filter(f => /^cloud-agent-full-backup-\d{8}\.zip$/.test(f))
  .sort()
  .pop()
const zipPath = `/home/z/my-project/download/${ZIP}`

const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
const expiry = (Date.now() + 60 * 60 * 1000).toString()
const token = `v1.${expiry}.${crypto.createHmac('sha256', secret).update('v1.' + expiry).digest('hex')}`
const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
await db.lockSession.upsert({ where: { tokenHash }, update: { lastSeenAt: new Date() }, create: { tokenHash, lastSeenAt: new Date() } })

const linkToken = JSON.parse((await db.userSetting.findUnique({ where: { key: 'zip_download_token' } })).value).token

let pass = 0, fail = 0
const ok = (c, n) => { console.log((c ? '✅' : '❌') + ' ' + n); c ? pass++ : fail++ }

// 1. no auth → 401
let r = await fetch(`${base}/api/backup-download`)
ok(r.status === 401, 'no auth → 401 (fail-closed)')

// 2. wrong token → 401
r = await fetch(`${base}/api/backup-download?token=${'a'.repeat(48)}`)
ok(r.status === 401, 'wrong token → 401')

// 3. valid token → 200 + byte-identical
r = await fetch(`${base}/api/backup-download?token=${linkToken}`)
ok(r.status === 200, 'valid token → 200')
ok((r.headers.get('content-disposition') || '').includes('cloud-agent-full-backup'), 'Content-Disposition attachment')
const buf = Buffer.from(await r.arrayBuffer())
const disk = fs.readFileSync(zipPath)
ok(buf.length === disk.length, `size identical (${(buf.length / 1048576).toFixed(1)} MB)`)
ok(crypto.createHash('sha256').update(buf).digest('hex') === crypto.createHash('sha256').update(disk).digest('hex'), 'sha256 BYTE-IDENTICAL to disk file')

// 4. lock header → 200 (UI button path)
r = await fetch(`${base}/api/backup-download`, { headers: { 'x-ca-lock': token } })
ok(r.status === 200, 'lock header → 200 (Settings button path)')

console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
process.exit(fail ? 1 : 0)
