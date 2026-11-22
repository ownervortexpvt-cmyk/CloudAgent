/* Provision Firebase Storage for cloud-agent-19b5f programmatically:
 *  1. enable firebasestorage.googleapis.com via Service Usage API
 *  2. enable storage.googleapis.com (JSON API) — harmless if already on
 *  3. hit the defaultBucket endpoint (what console "Get started" does)
 *  4. report which bucket now exists
 * Run: node scripts/provision-fb-storage.mjs
 */
import crypto from 'crypto'
import { readFileSync } from 'fs'

const sa = JSON.parse(readFileSync('/home/z/my-project/data/fb-sa.json', 'utf8'))
const b64u = s => Buffer.from(s, 'utf8').toString('base64url')
const now = Math.floor(Date.now() / 1000)
const input = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64u(JSON.stringify({
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.storage',
  aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
}))
const jwt = input + '.' + crypto.createSign('RSA-SHA256').update(input).sign(sa.private_key, 'base64url')

async function main() {
  const tr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const tok = (await tr.json()).access_token
  if (!tok) { console.log('token fail'); return }
  const H = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }
  const P = sa.project_id

  const enableService = async (svc) => {
    const r = await fetch(`https://serviceusage.googleapis.com/v1/projects/${P}/services/${svc}:enable`, { method: 'POST', headers: H, body: '{}' })
    const j = await r.json().catch(() => null)
    if (r.ok) {
      const op = j?.name
      if (op && String(j?.done ?? false) !== true) {
        for (let i = 0; i < 15; i++) {
          await new Promise(res => setTimeout(res, 2000))
          const st = await fetch(`https://serviceusage.googleapis.com/v1/${op}`, { headers: H })
          const sj = await st.json().catch(() => null)
          if (sj?.done) { console.log(`  enable ${svc} → done (response: ${JSON.stringify(sj?.response || sj?.error || {}).slice(0, 150)})`); return true }
        }
        console.log(`  enable ${svc} → still running (op pending)`)
        return true
      }
      console.log(`  enable ${svc} → ok`)
      return true
    }
    console.log(`  enable ${svc} → HTTP ${r.status} ${JSON.stringify(j?.error?.message || j).slice(0, 220)}`)
    return false
  }

  console.log('[1] enable Cloud Storage for Firebase API')
  await enableService('firebasestorage.googleapis.com')
  console.log('[2] enable Cloud Storage JSON API')
  await enableService('storage.googleapis.com')

  console.log('[3] defaultBucket provisioning (console "Get started" path)')
  const tries = [
    ['GET', `https://firebasestorage.googleapis.com/v1alpha/projects/${P}/defaultBucket`],
    ['POST', `https://firebasestorage.googleapis.com/v1alpha/projects/${P}/defaultBucket`],
  ]
  let bucket = null
  for (const [m, u] of tries) {
    const r = await fetch(u, { method: m, headers: H, body: m === 'POST' ? '{}' : undefined })
    const t = await r.text()
    console.log(`  ${m} defaultBucket → HTTP ${r.status} ${t.slice(0, 400)}`)
    try { const j = JSON.parse(t); bucket = j?.name?.split('/buckets/')[1] || j?.bucket || bucket } catch {}
    if (r.ok) break
  }

  console.log('[4] probe buckets')
  for (const b of [bucket, `${P}.firebasestorage.app`, `${P}.appspot.com`].filter(Boolean)) {
    const r = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(b)}`, { headers: H })
    const j = await r.json().catch(() => null)
    console.log(`  ${b} → HTTP ${r.status} ${r.ok ? `EXISTS (location=${j?.location})` : (j?.error?.message || '').slice(0, 120)}`)
  }
}
main().catch(e => console.error('FATAL', e?.message || e))
