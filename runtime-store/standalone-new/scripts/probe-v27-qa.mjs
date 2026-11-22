// Focused probe: seed a broken project, run qa_squad, dump full result.
import crypto from 'crypto'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'

const BASE = 'http://127.0.0.1:3000'
const db = new PrismaClient()
const signToken = (secret) => {
  const p = `v1.${Date.now() + 86400000}`
  return `${p}.${crypto.createHmac('sha256', secret).update(p).digest('hex')}`
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const H = { 'Content-Type': 'application/json', 'x-ca-lock': null }

async function main() {
  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  H['x-ca-lock'] = signToken(secret)
  await db.lockSession.upsert({
    where: { tokenHash: sha256(H['x-ca-lock']) },
    update: { lastSeenAt: new Date() },
    create: { tokenHash: sha256(H['x-ca-lock']), device: 'probe v27 qa', ip: '127.0.0.1' },
  })
  const mk = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'probe-v27-qa' }) }).then(r => r.json())
  const pid = mk.project.id
  const call = (tool, args) => fetch(`${BASE}/api/internal/tool`, { method: 'POST', headers: H, body: JSON.stringify({ projectId: pid, tool, args }) }).then(r => r.json())

  await call('write_file', { path: 'broken.js', content: 'function go( {\n  return 1\n}' })
  await call('write_file', { path: 'config.json', content: '{ "name": "x",, }' })
  await call('write_file', { path: 'index.html', content: '<!DOCTYPE html>\n<html>\n<head><title>Broken</title></head>\n<body>\n  <img src="missing-logo.png" alt="logo">\n</body>\n</html>' })

  const r = await call('qa_squad', {})
  console.log(JSON.stringify(r, null, 2))
  await fetch(`${BASE}/api/projects/${pid}`, { method: 'DELETE', headers: H }).catch(() => {})
  try { fs.rmSync(`/home/z/my-project/projects/${pid}`, { recursive: true, force: true }) } catch {}
  await db.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
