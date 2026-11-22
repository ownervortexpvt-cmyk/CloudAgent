/**
 * v67 warmup — pre-compile every key route AFTER a dev-server restart.
 *
 * WHY: Next dev compiles on first hit — the first request after a restart
 * takes 10-30s. For the owner on a phone that IS the "onek beshi slow"
 * experience, and the preview gateway often 502s while the compile is
 * running. Warmup compiles everything ONCE right after restart so the
 * owner's first real tap is fast.
 *
 * Run: node scripts/warmup.mjs
 */
import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const db = new PrismaClient()

const ROUTES = [
  '/', '/lock', '/manifest.webmanifest', '/sw-builder.js',
  // light GET reads — every dashboard surface the phone opens
  '/api/providers', '/api/projects', '/api/usage', '/api/runs',
  '/api/builds', '/api/deploy', '/api/projects/storage', '/api/secrets',
  '/api/settings', '/api/schedules', '/api/prompts', '/api/benchmarks',
  '/api/analytics', '/api/languages', '/api/templates', '/api/github',
  '/api/devmode', '/api/usage/budget', '/api/usage/webhook',
  '/api/providers/health', '/api/versions',
]

async function main() {
  const t0 = Date.now()
  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  if (!secret) { console.log('warmup: no lock secret yet — public routes only'); }
  let token = ''
  if (secret) {
    const payload = `v1.${Date.now() + 3600e3}`
    token = `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`
    await db.lockSession.create({ data: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), device: 'warmup', ip: '127.0.0.1' } })
  }
  const H = token ? { 'x-ca-lock': token } : {}
  let slowest = { ms: 0, path: '' }
  for (const p of ROUTES) {
    const s = Date.now()
    try {
      const r = await fetch(`${BASE}${p}${p.startsWith('/api/') ? (p.includes('?') ? '&' : '?') + '_warm=1' : ''}`, { headers: H, signal: AbortSignal.timeout(90_000) })
      const ms = Date.now() - s
      if (ms > slowest.ms) slowest = { ms, path: p }
      console.log(`  ${p} → ${r.status} (${ms}ms)`)
    } catch (e) {
      console.log(`  ${p} → ERR ${e.message || e}`)
    }
  }
  if (token) await db.lockSession.deleteMany({ where: { device: 'warmup' } })
  await db.$disconnect()
  console.log(`warmup done in ${((Date.now() - t0) / 1000).toFixed(1)}s — slowest: ${slowest.path} ${slowest.ms}ms`)
}

main().catch(e => { console.error('warmup failed:', e.message); process.exit(1) })
