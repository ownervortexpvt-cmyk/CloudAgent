/* Audit seed: recreate the owner-baseline rows via REAL APIs (Built-in Z.ai + 1 project) */
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'
const BASE = 'http://127.0.0.1:3000'
const db = new PrismaClient()
const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
const payload = `v1.${Date.now() + 3600e3}`
const token = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
await db.lockSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), device: 'AUDIT seed', ip: '127.0.0.1' } })
const H = { 'Content-Type': 'application/json', 'x-ca-lock': token }
// 1. Built-in Z.ai provider (exactly what the dialog's Save sends)
let r = await fetch(`${BASE}/api/providers`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Built-in Z.ai', kind: 'zai', endpoint: null, model: 'glm-4.6', temperature: 0.7, isDefault: true, role: 'leader' }) })
console.log('provider save:', r.status, JSON.stringify(await r.json()).slice(0, 150))
// 2. host project (html like v60 seed)
r = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Audit Host', language: 'html', description: 'audit seed host' }) })
const pj = await r.json()
console.log('project create:', r.status, JSON.stringify(pj).slice(0, 150))
console.log('SEED_TOKEN=' + token)
await db.lockSession.deleteMany({ where: { device: 'AUDIT seed' } })
await db.$disconnect()
