/**
 * v62 regression helper — the v60 suite needs ≥1 existing project (host
 * dependency found in Task 65). Seeds ONE project via the REAL API if the
 * list is empty. Prints the seed id so the cleanup step can hard-delete it.
 *
 * Usage: node scripts/seed-project.mjs ensure | node scripts/seed-project.mjs remove <id>
 */
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const db = new PrismaClient()
const mode = process.argv[2] || 'ensure'

async function tokenFor(device) {
  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  const payload = `v1.${Date.now() + 3600e3}`
  const token = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
  await db.lockSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), device, ip: '127.0.0.1' } })
  return token
}

async function main() {
  if (mode === 'remove') {
    const id = process.argv[3]
    if (!id) { console.error('remove needs an id'); process.exit(1) }
    const token = await tokenFor('E2E seed-removal')
    await fetch(`${BASE}/api/projects/${id}?hard=1`, { method: 'DELETE', headers: { 'x-ca-lock': token } })
    await db.lockSession.deleteMany({ where: { device: 'E2E seed-removal' } })
    console.log(`seed ${id} hard-deleted`)
    await db.$disconnect()
    return
  }

  const token = await tokenFor('E2E seed-project')
  const H = { 'Content-Type': 'application/json', 'x-ca-lock': token }
  const projects = (await (await fetch(`${BASE}/api/projects`, { headers: H })).json()).projects || []
  if (projects.length > 0) {
    console.log(`no seed needed — ${projects.length} project(s) already exist`)
  } else {
    const created = await (await fetch(`${BASE}/api/projects`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ name: '__seed_regression', language: 'html' }),
    })).json()
    console.log(`SEED_ID=${created.project.id}`)
  }
  await db.lockSession.deleteMany({ where: { device: 'E2E seed-project' } })
  await db.$disconnect()
}

main().catch(async e => { console.error(e); await db.$disconnect().catch(() => {}); process.exit(1) })
