#!/usr/bin/env node
/** Manual probe: does the rejoin stream still emit (streamOnly) heartbeats? */
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'

const db = new PrismaClient()
const BASE = 'http://localhost:3000'
const signToken = (secret) => {
  const exp = Date.now() + 10 * 60 * 1000
  const mac = crypto.createHmac('sha256', secret).update(`v1.${exp}`).digest('hex')
  return `v1.${exp}.${mac}`
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const secretRow = await db.userSetting.findUnique({ where: { key: 'lock_secret' } })
const TOKEN = signToken(secretRow.value)
await db.lockSession.upsert({ where: { tokenHash: sha256(TOKEN) }, update: {}, create: { tokenHash: sha256(TOKEN), device: 'probe heartbeat', ip: '127.0.0.1' } })
const H = { 'Content-Type': 'application/json', 'x-ca-lock': TOKEN }

const project = await db.project.findFirst({ select: { id: true } })

// start a tiny swarm
const res = await fetch(`${BASE}/api/multi-agent`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'start', projectId: project.id, task: 'Do NOT use any tools. Reply with exactly: HB-PROBE-OK' }) })
let runId = null
const dec = new TextDecoder()
let buf = ''
const reader1 = res.body.getReader()
while (true) {
  const { done, value } = await reader1.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  const lines = buf.split('\n'); buf = lines.pop() || ''
  for (const l of lines) { try { const e = JSON.parse(l); if (e.runId) runId = e.runId } catch {} }
  if (runId) break
}
console.log('runId:', runId)
await reader1.cancel().catch(() => {})

// wait 2s then rejoin and log every event type with timing
await new Promise(r => setTimeout(r, 2000))
const t0 = Date.now()
const res2 = await fetch(`${BASE}/api/multi-agent`, { method: 'POST', headers: H, body: JSON.stringify({ action: 'rejoin', runId, from: 0 }) })
const reader2 = res2.body.getReader()
buf = ''
const timeline = []
while (true) {
  const { done, value } = await reader2.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  const lines = buf.split('\n'); buf = lines.pop() || ''
  for (const l of lines) {
    if (!l.trim()) continue
    try { const e = JSON.parse(l); timeline.push([Date.now() - t0, e.type, e.streamOnly ? 'streamOnly' : '']) } catch {}
  }
}
console.log('rejoin event timeline (ms, type, flag):')
timeline.forEach(t => console.log(' ', t[0], t[1], t[2]))
const beats = timeline.filter(t => t[1] === 'heartbeat')
console.log(beats.length > 0 ? `HEARTBEATS PRESENT: ${beats.length}` : 'NO HEARTBEATS (stream closed before 4s interval fired)')
await db.$disconnect()
