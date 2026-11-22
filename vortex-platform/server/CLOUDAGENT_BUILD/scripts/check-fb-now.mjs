// Quick live Firebase status check (no changes)
import { PrismaClient } from '@prisma/client'
import { createHmac, createHash } from 'node:crypto'

const db = new PrismaClient()
const base = 'http://localhost:3000'

const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
if (!secret) { console.error('no lock_secret'); process.exit(1) }
const payload = `v1.${Date.now() + 3600e3}`
const TOKEN = `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
await db.lockSession.create({ data: { tokenHash: createHash('sha256').update(TOKEN).digest('hex'), device: 'fb status check', ip: '127.0.0.1' } })

const st = await fetch(`${base}/api/firebase`, { headers: { 'x-ca-lock': TOKEN } }).then(r => r.json()).catch(e => ({ err: String(e) }))
console.log('=== FIREBASE LIVE STATUS ===')
console.log(JSON.stringify(st, null, 2))

await db.lockSession.deleteMany({ where: { tokenHash: createHash('sha256').update(TOKEN).digest('hex') } })
await db.$disconnect()
