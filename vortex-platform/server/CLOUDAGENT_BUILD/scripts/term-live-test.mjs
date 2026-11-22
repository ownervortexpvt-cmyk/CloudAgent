// Task 102: LIVE terminal test — start session, run a command, poll output.
// Usage: node scripts/term-live-test.mjs
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const db = new PrismaClient()
const base = 'http://localhost:3000'

const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
if (!secret) { console.error('no lock_secret in DB'); process.exit(1) }
const expiry = (Date.now() + 60 * 60 * 1000).toString() // v1.<expiry>.<hmac("v1.<expiry>")>
const token = `v1.${expiry}.${crypto.createHmac('sha256', secret).update('v1.' + expiry).digest('hex')}`
// middleware ALSO requires the token to exist in the revocable session registry
const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
await db.lockSession.upsert({
  where: { tokenHash },
  update: { lastSeenAt: new Date() },
  create: { tokenHash, lastSeenAt: new Date() },
})
const H = { 'Content-Type': 'application/json', 'x-ca-lock': token }

// pick a real project dir
const projects = await db.project.findMany({ select: { id: true, name: true } })
console.log('projects in DB:', projects.map(p => `${p.id}(${p.name})`).join(', ') || 'NONE')
const pid = process.argv[2] || projects[0]?.id || 'term-probe'
console.log('using projectId:', pid)

// 1. start
let r = await fetch(`${base}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'start', projectId: pid }) })
console.log('start status:', r.status)
const start = await r.json()
console.log('start resp:', JSON.stringify(start).slice(0, 300))
if (!start.sessionId) process.exit(1)
const sid = start.sessionId

// 2. wait for prompt
await new Promise(res => setTimeout(res, 1200))
r = await fetch(`${base}/api/terminal?sessionId=${sid}`, { headers: H })
console.log('poll status:', r.status)
const out1 = await r.json()
console.log('initial output (first 300):', JSON.stringify(out1.output || '').slice(0, 300))

// 3. run a command
r = await fetch(`${base}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'input', sessionId: sid, data: 'echo TERMINAL_ALIVE_$((40+2)) && pwd\n' }) })
console.log('input status:', r.status, JSON.stringify(await r.json()))
await new Promise(res => setTimeout(res, 1500))
r = await fetch(`${base}/api/terminal?sessionId=${sid}`, { headers: H })
const out2 = await r.json()
console.log('command output:', JSON.stringify(out2.output || ''))

const alive = (out2.output || '').includes('TERMINAL_ALIVE_42')
console.log(alive ? '✅ TERMINAL WORKS' : '❌ TERMINAL BROKEN — no command output')

// 4. cleanup
await fetch(`${base}/api/terminal`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'kill', sessionId: sid }) })
console.log('session killed')
process.exit(alive ? 0 : 1)
