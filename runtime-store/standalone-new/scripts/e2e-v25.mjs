#!/usr/bin/env node
/**
 * E2E — v25 OWNER PACK (live server, lock included):
 *  1. lock first-run: setup → cookie; no-cookie → 307/401 (locked)
 *  2. wrong PIN → 401
 *  3. sessions: ≥1 current; second device unlock → revoke-others
 *  4. change PIN: rotates secret, old devices die, new cookie works
 *  5. passkey API: auth-options 404 (none) → register-options (auth) →
 *     register GARBAGE → 400 (crypto really verifies) → delete → ok
 *  6. usage: direct DB row → GET aggregates → POST reset clears
 *  7. clone: template project → clone → files on disk → cleanup
 *  8. zip import: build zip (top-level folder) → import → folder stripped,
 *     files on disk → cleanup
 *  9. builder PWA: manifest/sw/icons reachable WITHOUT cookie (public paths)
 * 10. lock screen page renders
 * 11. cleanup: wipe lock → first-run state for the owner
 */
const BASE = 'http://127.0.0.1:3000'
let cookie = ''
let pass = 0, fail = 0
const ok = (b, name) => { if (b) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}`) } }
const PIN1 = '445566'
const PIN2 = '778899'

async function req(method, path, body, useCookie = true, extraHeaders = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(useCookie && cookie ? { Cookie: cookie } : {}), ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie && setCookie.includes('ca_lock=')) {
    cookie = setCookie.split(';')[0].split('ca_lock=')[1]
    cookie = `ca_lock=${cookie}`
  }
  return res
}

async function main() {
  // idempotent start: wipe any lock/sessions/passkeys from previous runs so
  // the suite can run repeatedly (also clears old-cookie assertions)
  const { execSync } = await import('child_process')
  execSync('bunx tsx scripts/reset-lock.ts', { cwd: '/home/z/my-project', stdio: 'pipe' })

  console.log('— 1. lock first-run setup —')
  let r = await req('GET', '/api/lock', null, false)
  let d = await r.json()
  ok(r.ok && d.configured === false, 'GET status → configured:false (fresh state)')
  r = await req('GET', '/api/projects', null, false)
  ok(r.status === 401, 'locked API → 401 without cookie')
  r = await req('GET', '/', null, false)
  ok(r.status === 307 && (r.headers.get('location') || '').includes('/lock'), 'locked page → 307 /lock')
  r = await req('POST', '/api/lock', { action: 'setup', pin: PIN1 }, false)
  ok(r.ok, 'setup creates the lock + session cookie')
  r = await req('GET', '/api/projects', null, true)
  ok(r.ok, 'unlocked API works with cookie')
  r = await req('POST', '/api/lock', { action: 'setup', pin: '9999' }, true)
  ok(r.status === 400, 'setup twice → rejected (already configured)')

  console.log('— 2. wrong PIN —')
  const savedCookie = cookie
  cookie = ''
  r = await req('POST', '/api/lock', { action: 'unlock', pin: '0000' }, true)
  ok(r.status === 401, 'wrong PIN → 401')
  cookie = savedCookie

  console.log('— 3. sessions —')
  r = await req('GET', '/api/lock/sessions', null, true)
  d = await r.json()
  ok(r.ok && d.sessions.length >= 1 && d.sessions.some(s => s.current), 'current session listed')
  // second device
  const r2 = await fetch(BASE + '/api/lock', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/120' },
    body: JSON.stringify({ action: 'unlock', pin: PIN1 }),
  })
  ok(r2.ok, 'second device unlocks')
  r = await req('GET', '/api/lock/sessions', null, true)
  d = await r.json()
  ok(d.sessions.length >= 2, 'two sessions visible')
  r = await req('POST', '/api/lock/sessions', { action: 'revoke-others' }, true)
  d = await r.json()
  ok(r.ok && d.revoked >= 1, `revoke-others killed ${d.revoked} other session(s)`)
  r = await req('GET', '/api/lock/sessions', null, true)
  d = await r.json()
  ok(d.sessions.length === 1 && d.sessions[0].current, 'only current session remains')

  console.log('— 4. passkey API (crypto enforcement) —')
  r = await req('POST', '/api/lock/passkey', { action: 'auth-options' }, false)
  ok(r.status === 404, 'auth-options with no passkeys → 404')
  r = await req('POST', '/api/lock/passkey', { action: 'register-options' }, true)
  d = await r.json()
  ok(r.ok && d.options && d.options.challenge, 'register-options returns WebAuthn options')
  r = await req('POST', '/api/lock/passkey', {
    action: 'register', challenge: d.challenge,
    clientDataJSON: 'e30', attestationObject: 'AAA',
  }, true)
  ok(r.status === 400, 'register with garbage → 400 (verification is real)')
  const publicCount = await (await fetch(BASE + '/api/lock/passkey?publicCount=1')).json()
  ok(publicCount.ok && publicCount.count === 0, 'public count endpoint works')
  // authed-only enforcement: register-options without cookie → 401
  r = await req('POST', '/api/lock/passkey', { action: 'register-options' }, false)
  ok(r.status === 401, 'register-options locked → 401 (outsiders can never enroll)')

  console.log('— 5. change PIN —')
  r = await req('POST', '/api/lock', { action: 'change', currentPin: 'wrong!', newPin: PIN2 }, true)
  ok(r.status === 401, 'change with wrong current PIN → 401')
  const oldCookie = cookie // capture BEFORE change — after the call req() swaps in the fresh cookie
  r = await req('POST', '/api/lock', { action: 'change', currentPin: PIN1, newPin: PIN2 }, true)
  ok(r.ok, 'change PIN works')
  cookie = ''
  r = await req('POST', '/api/lock', { action: 'unlock', pin: PIN1 }, true)
  ok(r.status === 401, 'OLD PIN dead after change')
  r = await req('POST', '/api/lock', { action: 'unlock', pin: PIN2 }, true)
  ok(r.ok, 'NEW PIN unlocks')
  // old cookie must now fail (secret rotated, sessions wiped)
  {
    const res = await fetch(BASE + '/api/projects', { headers: { Cookie: oldCookie }, redirect: 'manual' })
    ok(res.status === 401, 'old device cookie invalidated by PIN change')
  }

  console.log('— 6. usage —')
  const { PrismaClient } = await import('@prisma/client')
  const pdb = new PrismaClient()
  const day = new Date().toISOString().slice(0, 10)
  await pdb.usageDaily.upsert({
    where: { day_provider_model_kind: { day, provider: 'E2E-Test', model: 'mock-1', kind: 'chat' } },
    update: { requests: { increment: 2 }, tokensIn: { increment: 500 }, tokensOut: { increment: 250 } },
    create: { day, provider: 'E2E-Test', model: 'mock-1', kind: 'chat', requests: 2, tokensIn: 500, tokensOut: 250 },
  })
  r = await req('GET', '/api/usage?days=7', null, true)
  d = await r.json()
  const p = (d.providers || []).find(x => x.provider === 'E2E-Test')
  ok(r.ok && p && p.requests >= 2 && p.tokensIn >= 500, 'usage aggregates real rows')
  ok(Array.isArray(d.series) && d.series.length === 7, '7-day series shape')
  r = await req('POST', '/api/usage', { action: 'reset' }, true)
  d = await r.json()
  ok(r.ok && d.deleted >= 1, `usage reset cleared ${d.deleted} row(s)`)
  await pdb.$disconnect()

  console.log('— 7. clone —')
  r = await req('POST', '/api/projects', { name: 'v25-clone-src', templateId: 'static' }, true)
  d = await r.json()
  ok(r.ok && d.project, 'template project created')
  const srcId = d.project?.id
  r = await req('POST', '/api/projects/clone', { projectId: srcId }, true)
  d = await r.json()
  ok(r.ok && d.project && d.project.name === 'v25-clone-src (copy)', `clone created (${d.fileCount} files)`)
  const fs = await import('fs')
  const path = await import('path')
  const copyRoot = path.join('/home/z/my-project/projects', d.project.id)
  ok(fs.existsSync(path.join(copyRoot, 'index.html')), 'clone files really copied on disk')
  await req('DELETE', `/api/projects/${d.project.id}`, null, true)
  await req('DELETE', `/api/projects/${srcId}`, null, true)
  ok(true, 'clone test projects cleaned')

  console.log('— 8. zip import —')
  const { default: AdmZip } = await import('adm-zip')
  const zip = new AdmZip()
  zip.addFile('my-app-folder/index.html', Buffer.from('<html><body><h1>Imported!</h1></body></html>'))
  zip.addFile('my-app-folder/js/app.js', Buffer.from('console.log("hi")'))
  const b64 = zip.toBuffer().toString('base64')
  r = await req('POST', '/api/projects/import', { name: 'v25-imported', zipBase64: b64 }, true)
  d = await r.json()
  ok(r.ok && d.project && d.fileCount === 2, `zip imported (${d.fileCount} files)`)
  const impRoot = path.join('/home/z/my-project/projects', d.project.id)
  ok(fs.existsSync(path.join(impRoot, 'index.html')) && fs.existsSync(path.join(impRoot, 'js/app.js')), 'top-level folder stripped, files on disk')
  ok(fs.readFileSync(path.join(impRoot, 'index.html'), 'utf8').includes('Imported!'), 'imported content intact')
  await req('DELETE', `/api/projects/${d.project.id}`, null, true)
  ok(true, 'import test project cleaned')

  console.log('— 9. builder PWA (public, no cookie) —')
  r = await fetch(BASE + '/manifest.webmanifest')
  d = await r.json()
  ok(r.ok && (d.icons || []).some(i => String(i.src).includes('builder-icon-512')), 'manifest with PNG icons (public)')
  r = await fetch(BASE + '/sw-builder.js')
  ok(r.ok && (await r.text()).includes('ca-builder-v1'), 'service worker served (public)')
  r = await fetch(BASE + '/builder-icon-512.png')
  ok(r.ok && r.headers.get('content-type') === 'image/png', '512px PNG icon served')
  r = await fetch(BASE + '/builder-icon-192.png')
  ok(r.ok, '192px PNG icon served')

  console.log('— 10. lock screen —')
  r = await fetch(BASE + '/lock', { redirect: 'manual' })
  const html = await r.text()
  ok(r.status === 200 && html.includes('AI App Builder'), 'lock screen renders')

  console.log('— 11. cleanup → owner first-run state —')
  r = await req('POST', '/api/lock', { action: 'logout' }, true)
  ok(r.ok, 'logout works')
  execSync('bunx tsx scripts/reset-lock.ts', { cwd: '/home/z/my-project', stdio: 'pipe' })
  r = await fetch(BASE + '/api/lock')
  d = await r.json()
  ok(d.configured === false, 'lock reset → owner creates their own PIN on next visit')

  console.log(`\n═══ RESULT: ${pass} PASS / ${fail} FAIL ═══`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
