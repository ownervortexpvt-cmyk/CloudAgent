/* Diagnostic — which Firebase Storage bucket actually exists for cloud-agent-19b5f?
 * Uses the owner's SA (data/fb-sa.json) with the same JWT flow as fbstore.ts.
 * Run: node scripts/diag-fb-bucket.mjs
 */
import crypto from 'crypto'
import { readFileSync } from 'fs'

const sa = JSON.parse(readFileSync('/home/z/my-project/data/fb-sa.json', 'utf8'))
const b64u = s => Buffer.from(s, 'utf8').toString('base64url')
const now = Math.floor(Date.now() / 1000)
const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
const claims = b64u(JSON.stringify({
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/devstorage.full_control https://www.googleapis.com/auth/firebase.storage',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now, exp: now + 3600,
}))
const input = `${header}.${claims}`
const sig = crypto.createSign('RSA-SHA256').update(input).sign(sa.private_key, 'base64url')

async function main() {
  const tr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${sig}` }),
  })
  const tj = await tr.json()
  if (!tj.access_token) { console.log('TOKEN FAIL:', JSON.stringify(tj).slice(0, 300)); return }
  console.log('✓ OAuth2 token OK (jwt-bearer, RS256) — SA key itself is VALID')
  const tok = tj.access_token
  const H = { authorization: `Bearer ${tok}` }

  // 1. what does FIREBASE Storage think the project's buckets are?
  const fb = await fetch(`https://firebasestorage.googleapis.com/v0/projects/${sa.project_id}/buckets`, { headers: H })
  console.log(`\n[1] firebasestorage.googleapis.com/v0/projects/${sa.project_id}/buckets → HTTP ${fb.status}`)
  const fj = await fb.json().catch(() => null)
  console.log(JSON.stringify(fj, null, 2)?.slice(0, 800))

  // 2. probe candidate GCS buckets directly
  const BUCKET = `${sa.project_id}.appspot.com`
  const probe = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(BUCKET)}`, { headers: H })
  console.log(`\n[2] probe ${BUCKET} → HTTP ${probe.status}`)

  if (probe.status === 404) {
    console.log('[3] not found → try CREATING the default appspot.com bucket via GCS API (what Console "Get started" does)')
    const cr = await fetch('https://storage.googleapis.com/storage/v1/b?project=' + encodeURIComponent(sa.project_id), {
      method: 'POST',
      headers: { ...H, 'content-type': 'application/json' },
      body: JSON.stringify({ name: BUCKET, location: 'US' }),
    })
    const cj = await cr.json().catch(() => null)
    console.log(`    create → HTTP ${cr.status} ${cr.ok ? 'CREATED ✓' : JSON.stringify(cj?.error?.message || cj).slice(0, 250)}`)
    if (!cr.ok) return
    console.log('[4] link bucket to Firebase (addFirebase)')
    const af = await fetch(`https://firebasestorage.googleapis.com/v1alpha/projects/${sa.project_id}/buckets/${BUCKET}:addFirebase`, {
      method: 'POST', headers: H, body: '{}',
    })
    const aj = await af.json().catch(() => null)
    console.log(`    addFirebase → HTTP ${af.status} ${af.ok ? 'LINKED ✓' : JSON.stringify(aj?.error?.message || aj).slice(0, 250)}`)
  }

  const fin = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(BUCKET)}`, { headers: H })
  const finj = await fin.json().catch(() => null)
  console.log(`\n[5] final check ${BUCKET} → HTTP ${fin.status} ${fin.ok ? `(location=${finj?.location})` : ''}`)
}
main().catch(e => console.error('FATAL', e?.message || e))
