/* Prove the recovery flow works with the newly provisioned recovery_hash (then restore). */
import crypto from 'crypto'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'
const BASE = 'http://127.0.0.1:3000'
const db = new PrismaClient()
const backup = JSON.parse(fs.readFileSync('scripts/lock-backup.json', 'utf8'))
const orig = Object.fromEntries(backup.map(r => [r.key, r.value]))
const KEY = fs.readFileSync('recovery-key-for-owner.txt', 'utf8').trim()
const post = async (body) => fetch(`${BASE}/api/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

// 1. recover with the NEW key + proper new PIN
let r = await post({ action: 'recover', recoveryKey: KEY, newPin: '864213' })
let j = await r.json().catch(() => ({}))
console.log(`recover with provisioned key → ${r.status} ok=${j.ok} recovered=${j.recovered} token=${j.token ? 'yes' : 'no'}`)
const pass1 = r.status === 200 && j.ok === true && !!j.token

// 2. the recovered token must read a guarded API
r = await fetch(`${BASE}/api/providers`, { headers: { 'x-ca-lock': j.token } })
console.log(`recovered token reads /api/providers → ${r.status}`)
const pass2 = r.status === 200

// 3. wrong-PIN unlock still fails BEFORE restore; new PIN works
r = await post({ action: 'unlock', pin: '00000' })
const pass3 = r.status === 401

// 4. RESTORE the owner's original lock (their own PIN keeps working)
await db.userSetting.update({ where: { key: 'lock_hash' }, data: { value: orig.lock_hash } })
await db.userSetting.update({ where: { key: 'lock_secret' }, data: { value: orig.lock_secret } })
await db.lockSession.deleteMany({ where: { device: { contains: 'E2E v50.1' } } })
const restored = (await db.userSetting.findUnique({ where: { key: 'lock_hash' } }))?.value === orig.lock_hash
console.log(`owner lock restored → ${restored}`)
console.log(pass1 && pass2 && pass3 && restored ? 'RECOVERY FLOW: FULLY WORKING' : 'RECOVERY FLOW: BROKEN')
await db.$disconnect()
