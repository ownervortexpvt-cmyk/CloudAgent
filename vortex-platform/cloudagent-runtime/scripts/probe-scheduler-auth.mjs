#!/usr/bin/env node
/** Probe: replicate the scheduler's internal auth mint + a lock-guarded call. */
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const db = new PrismaClient()
const BASE = process.env.BASE || 'http://localhost:3000'

const secretRow = await db.userSetting.findUnique({ where: { key: 'lock_secret' } })
console.log('lock_secret present:', Boolean(secretRow?.value))

const exp = Date.now() + 24 * 3600 * 1000
const mac = crypto.createHmac('sha256', secretRow.value).update(`v1.${exp}`).digest('hex')
const token = `v1.${exp}.${mac}`
const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

try {
  const s = await db.lockSession.upsert({
    where: { tokenHash },
    update: { lastSeenAt: new Date() },
    create: { tokenHash, device: 'probe-internal-auth', ip: '127.0.0.1' },
  })
  console.log('session upsert OK:', s.device, s.tokenHash.slice(0, 10))
} catch (e) {
  console.log('session upsert FAILED:', e.message)
  process.exit(1)
}

const r = await fetch(`${BASE}/api/backup`, { headers: { 'x-ca-lock': token } })
console.log('GET /api/backup with minted token →', r.status)
const r2 = await fetch(`${BASE}/api/runs?limit=1`, { headers: { 'x-ca-lock': token } })
console.log('GET /api/runs with minted token →', r2.status)

await db.lockSession.delete({ where: { tokenHash } }).catch(() => {})
await db.$disconnect()
