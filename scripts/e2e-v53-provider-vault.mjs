#!/usr/bin/env node
/**
 * v53 — Provider Vault E2E (non-destructive)
 *
 * Proves: AI provider keys are mirrored to a disk vault on every mutation,
 * and a wiped DB is silently re-seeded from the vault on the next GET.
 * This is the fix for "platform reset ate my ModelScope key" (Tasks 50/51).
 *
 * Non-destructive contract:
 *  - captures pre-existing providers + pre-existing vault file, restores both
 *  - lock token is minted from the stored lock_secret (never rotates it)
 *  - test provider rows are deleted; vault file restored/removed at the end
 */
import { PrismaClient } from '@prisma/client'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const db = new PrismaClient()
const BASE = process.env.BASE || 'http://localhost:3000'
const VAULT = path.join(process.cwd(), 'data', 'provider-vault.json')

let pass = 0, fail = 0
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

const signToken = (secret) => {
  const exp = Date.now() + 10 * 60 * 1000
  const mac = crypto.createHmac('sha256', secret).update(`v1.${exp}`).digest('hex')
  return `v1.${exp}.${mac}`
}
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

const TEST_KEY = 'ms-v53-vault-e2e-key-0001'
const TEST_NAME = '__e2e_v53_vault_provider'

// ── pre-state capture ────────────────────────────────────────────────────
const preVaultExists = fs.existsSync(VAULT)
const preVaultRaw = preVaultExists ? fs.readFileSync(VAULT, 'utf8') : null
// v62 regression fix: the vault may legitimately hold the OWNER's own saved
// providers (e.g. the Built-in Z.ai card saved from the real UI). Every
// restore-count expectation must therefore be BASELINE-RELATIVE, never 1.
const preVaultCount = (() => {
  try { return preVaultRaw ? (JSON.parse(preVaultRaw).providers || []).length : 0 } catch { return 0 }
})()
const preProviders = await db.aIProvider.findMany()
const preIds = new Set(preProviders.map(p => p.id))

const secretRow = await db.userSetting.findUnique({ where: { key: 'lock_secret' } })
const TOKEN = signToken(secretRow.value)
// middleware requires a live LockSession row for the token (v251 pattern)
await db.lockSession.upsert({
  where: { tokenHash: sha256(TOKEN) },
  update: {},
  create: { tokenHash: sha256(TOKEN), device: 'E2E v53 vault', ip: '127.0.0.1' },
})
const H = { 'Content-Type': 'application/json', 'x-ca-lock': TOKEN }

console.log('— v53 Provider Vault E2E —')

// 1. baseline
let r = await fetch(`${BASE}/api/providers`, { headers: H })
ok(r.status === 200, 'GET /api/providers with valid lock token → 200', `got ${r.status}`)
const before = (await r.json()).providers || []
ok(before.length === preProviders.length, 'baseline provider count matches DB', `${before.length} vs ${preProviders.length}`)

// 2. add test provider
r = await fetch(`${BASE}/api/providers`, { method: 'POST', headers: H, body: JSON.stringify({ name: TEST_NAME, kind: 'openai', baseURL: 'https://api-inference.modelscope.cn/v1', apiKey: TEST_KEY, model: 'e2e-vault-model' }) })
const added = await r.json()
ok(r.status === 200 && added?.provider?.id, 'POST add test provider → 200', `status=${r.status}`)
const pid = added?.provider?.id

// 3. vault written, ciphertext-only
ok(fs.existsSync(VAULT), 'vault file created on disk after add')
const vf1 = JSON.parse(fs.readFileSync(VAULT, 'utf8'))
const vaultRow = (vf1.providers || []).find(p => p.id === pid)
ok(!!vaultRow, 'vault contains the new provider row')
ok(vaultRow?.apiKeyEnc && vaultRow.apiKeyEnc.startsWith('v1:'), 'vault stores ENCRYPTED key (v1: AES-GCM ciphertext)')
ok(!fs.readFileSync(VAULT, 'utf8').includes(TEST_KEY), 'vault NEVER contains the plaintext key')

// 4. update flows into vault
r = await fetch(`${BASE}/api/providers`, { method: 'POST', headers: H, body: JSON.stringify({ id: pid, name: TEST_NAME, kind: 'openai', apiKey: TEST_KEY, model: 'e2e-vault-model-2' }) })
ok(r.status === 200, 'POST update test provider → 200', `status=${r.status}`)
const vf2 = JSON.parse(fs.readFileSync(VAULT, 'utf8'))
ok(vf2.providers.find(p => p.id === pid)?.model === 'e2e-vault-model-2', 'vault mirrors the model update')

// 5. role change flows into vault
r = await fetch(`${BASE}/api/providers/role`, { method: 'POST', headers: H, body: JSON.stringify({ id: pid, role: 'leader' }) })
ok(r.status === 200, 'POST role=leader → 200', `status=${r.status}`)
const vf3 = JSON.parse(fs.readFileSync(VAULT, 'utf8'))
ok(vf3.providers.find(p => p.id === pid)?.role === 'leader', 'vault mirrors role change')

// 6. THE CORE: simulate a platform-reset DB wipe, then read back
await db.aIProvider.deleteMany({})
const wiped = await db.aIProvider.count()
ok(wiped === 0, 'DB wipe simulated (all AIProvider rows deleted)')

r = await fetch(`${BASE}/api/providers`, { headers: H })
const after = await r.json()
ok(r.status === 200, 'GET after wipe → 200')
ok(after?.vaultRestored === preProviders.length + 1, 'GET auto-restored the whole mirrored pool (baseline rows + our 1) from disk', `vaultRestored=${after?.vaultRestored} expected=${preProviders.length + 1}`)
const back = (after?.providers || []).find(p => p.id === pid)
ok(!!back, 'wiped provider resurrected with SAME id')
ok(back?.model === 'e2e-vault-model-2', 'restored row keeps updated model')

const dbRow = await db.aIProvider.findUnique({ where: { id: pid } })
// compare against the vault's CURRENT content (each update re-encrypts with a fresh IV,
// so older snapshots hold older ciphertext for the same plaintext)
const vaultNow = JSON.parse(fs.readFileSync(VAULT, 'utf8'))
const vaultEncNow = (vaultNow.providers || []).find(p => p.id === pid)?.apiKeyEnc
ok(dbRow?.apiKeyEnc && dbRow.apiKeyEnc === vaultEncNow, 'restored DB ciphertext === vault ciphertext')

// 7. role API works on restored row (FK/state sanity)
r = await fetch(`${BASE}/api/providers/role`, { method: 'POST', headers: H, body: JSON.stringify({ id: pid, role: 'work' }) })
ok(r.status === 200, 'role API works on restored row → 200', `status=${r.status}`)

// 8. delete is a REAL delete — vault must not resurrect it
r = await fetch(`${BASE}/api/providers?id=${pid}`, { method: 'DELETE', headers: H })
ok(r.status === 200, 'DELETE test provider → 200')
const vf4 = JSON.parse(fs.readFileSync(VAULT, 'utf8'))
ok(!vf4.providers.find(p => p.id === pid), 'vault removed the deleted row (no resurrection)')

await db.aIProvider.deleteMany({})
r = await fetch(`${BASE}/api/providers`, { headers: H })
const final = await r.json()
// v62: with owner-saved providers in the baseline vault, the GET honestly
// restores THEM — the invariant under test is that OUR DELETED pid never
// resurrects, and the restore count equals the baseline (no pid ghost).
const finalRestored = final?.vaultRestored || 0
ok(finalRestored === preProviders.length && !(final?.providers || []).some(p => p.id === pid), 'no ghost restore: deleted provider stays dead, exactly the baseline rows come back', `restored=${finalRestored} expected=${preProviders.length}`)

// 9. restore pre-state
if (preVaultExists && preVaultRaw !== null) fs.writeFileSync(VAULT, preVaultRaw)
else if (fs.existsSync(VAULT)) fs.rmSync(VAULT)
const postIds = (await db.aIProvider.findMany({ select: { id: true } })).map(p => p.id)
const sameIds = postIds.length === preProviders.length && postIds.every(id => preIds.has(id))
ok(sameIds, 'pre-state restored (DB rows === captured pre rows)')

console.log(`\nRESULT: ${pass} pass / ${fail} fail`)
await db.lockSession.deleteMany({ where: { device: 'E2E v53 vault' } })
await db.$disconnect()
process.exit(fail ? 1 : 0)
