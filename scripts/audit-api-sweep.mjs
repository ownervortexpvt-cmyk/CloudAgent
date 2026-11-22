import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'
const BASE = 'http://127.0.0.1:3000'
const db = new PrismaClient()
const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
const payload = `v1.${Date.now() + 3600e3}`
const token = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
await db.lockSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), device: 'AUDIT sweep', ip: '127.0.0.1' } })
const H = { 'x-ca-lock': token }
const routes = [
  ['GET', '/api'], ['GET', '/api/templates'], ['GET', '/api/languages'], ['GET', '/api/projects'],
  ['GET', '/api/providers'], ['GET', '/api/providers/health'], ['GET', '/api/runs'], ['GET', '/api/usage?days=7'],
  ['GET', '/api/usage/budget'], ['GET', '/api/usage/webhook'], ['GET', '/api/prompts'], ['GET', '/api/benchmarks'],
  ['GET', '/api/schedules'], ['GET', '/api/builds'], ['GET', '/api/deploy'], ['GET', '/api/backup'],
  ['GET', '/api/projects/storage'], ['GET', '/api/settings'], ['GET', '/api/analytics?projectId=x'],
  ['GET', '/api/security-scan?projectId=x'], ['GET', '/api/aso-listing?projectId=x'],
  ['GET', '/api/growth-tools?projectId=x'], ['GET', '/api/pwa-setup?projectId=x'],
  ['GET', '/api/custom-domains'], ['GET', '/api/versions?projectId=x'], ['GET', '/api/secrets'],
  ['GET', '/api/github'], ['GET', '/api/terminal'], ['GET', '/api/assets?projectId=x'],
]
for (const [m, r] of routes) {
  try {
    const res = await fetch(BASE + r, { method: m, headers: H })
    const cl = res.headers.get('content-type') || ''
    console.log(`${res.status}  ${m} ${r}  ${cl.includes('json') ? '' : '(' + cl.split(';')[0] + ')'}`)
  } catch (e) { console.log(`ERR  ${m} ${r}  ${e.message.slice(0, 60)}`) }
}
await db.lockSession.deleteMany({ where: { device: 'AUDIT sweep' } })
await db.$disconnect()
