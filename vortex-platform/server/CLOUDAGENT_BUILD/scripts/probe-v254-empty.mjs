// Probe: reproduce empty-project pub fallback and dump resulting pubspec.yaml
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const BASE = 'http://127.0.0.1:3000'
const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000
const payload = `v1.${expiry}`
const TOKEN = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
await db.lockSession.upsert({
  where: { tokenHash: crypto.createHash('sha256').update(TOKEN).digest('hex') },
  update: { lastSeenAt: new Date() },
  create: { tokenHash: crypto.createHash('sha256').update(TOKEN).digest('hex'), device: 'probe v254', ip: '127.0.0.1' },
})
const H = { 'Content-Type': 'application/json', 'x-ca-lock': TOKEN }
const res0 = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'probe-v254-empty' }) })
const raw0 = await res0.text()
console.log('create status:', res0.status, 'body:', raw0.slice(0, 300))
const { project } = JSON.parse(raw0 || '{}')
const id = project.id
const r = await fetch(`${BASE}/api/internal/tool`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ca-lock': TOKEN }, body: JSON.stringify({ projectId: id, tool: 'install_package', args: { package: 'flutter_tts' } }) })
const d = await r.json()
console.log('FULL RESPONSE:', JSON.stringify(d, null, 2).slice(0, 1200))
console.log('--- pubspec.yaml on disk ---')
try {
  const fs = await import('fs')
  console.log(fs.readFileSync(`/home/z/my-project/projects/${id}/pubspec.yaml`, 'utf8'))
} catch (e) { console.log('READ FAIL:', e.message) }
await db.project.delete({ where: { id } }).catch(() => {})
const fs2 = await import('fs')
fs2.rmSync(`/home/z/my-project/projects/${id}`, { recursive: true, force: true })
await db.$disconnect()
