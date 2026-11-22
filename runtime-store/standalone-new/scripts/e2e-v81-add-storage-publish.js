/**
 * e2e-v81 — Add Storage (auto-SDK provisioning) + iOS Export Kit + Google Play upload.
 *
 * Covers:
 *  1. GET /api/sdks/provision shape
 *  2. REAL auto-install: ninja probe hidden → cpp project provisioning reinstalls it (2MB, safe)
 *  3. dart project create → provision response flutter/android/jdk already-ready
 *  4. ZIP import sniffing: pubspec.yaml zip → dart provisioning job (source: import)
 *  5. healAll: disk guard honesty (ndk blocked-disk at 96% volume, nothing runaway)
 *  6. ipa-export: Flutter project → real ios-export zip artifact + download 200
 *  7. google-play: workflow without credentials (+ playConfigured field)
 *  8. /api/play credential validation (invalid json / missing keys / full fake)
 *  9. publish web regression (v80 behavior intact)
 * 10. v79 regression: GET /api/sdks still 200 with 13 managed toolchains
 * Self-contained: lock-dance backup → temp PIN → tests → cleanup → restore → armed-401 proof.
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const AdmZip = require('/home/z/my-project/node_modules/adm-zip')

const BASE = 'http://localhost:3000'
let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
}
async function api(p, opts = {}, cookie = '') {
  const res = await fetch(BASE + p, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  })
  let body = null
  try { body = await res.json() } catch { body = null }
  return { status: res.status, body, res }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  console.log('── v81 E2E: Add Storage + iOS kit + Play upload ──')
  execSync('bun scripts/lock-dance.js backup', { cwd: '/home/z/my-project', stdio: 'pipe' })
  let cookie = ''
  try {
    const setup = await fetch(BASE + '/api/lock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setup', pin: '737373' }),
    })
    const sc = setup.headers.getSetCookie ? setup.headers.getSetCookie() : [setup.headers.get('set-cookie')]
    cookie = (sc || []).map(c => c.split(';')[0]).filter(c => c && c !== 'undefined').join('; ')
    check('lock setup → cookie', Boolean(cookie && cookie.length > 20))
  } catch (e) { check('lock setup → cookie', false, String(e)) }

  const cleanupProjects = []
  const artifacts = []

  try {
    // ---- 1. provision status shape ----
    const p0 = await api('/api/sdks/provision', {}, cookie)
    check('GET /api/sdks/provision 200', p0.status === 200 && Array.isArray(p0.body?.jobs))
    const pBad = await api('/api/sdks/provision', { method: 'POST', body: JSON.stringify({}) }, cookie)
    check('POST provision without params → 400', pBad.status === 400)

    // ---- 2. REAL auto-install proof: hide ninja probe, provision a cpp project ----
    const ninjaBin = '/home/z/my-project/sdk/ninja/bin/ninja'
    const ninjaBak = ninjaBin + '.v81bak'
    let ninjaHidden = false
    if (fs.existsSync(ninjaBin)) { fs.renameSync(ninjaBin, ninjaBak); ninjaHidden = true }
    check('ninja probe hidden for install test', ninjaHidden)
    const mkCpp = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v81-cpp-probe', language: 'cpp' }) }, cookie)
    const cppId = mkCpp.body?.project?.id
    check('cpp project created', Boolean(cppId), JSON.stringify(mkCpp.body?.error || '').slice(0, 80))
    if (cppId) cleanupProjects.push(cppId)
    const provResp = mkCpp.body?.provision
    check('create response carries provision', Boolean(provResp) && Array.isArray(provResp?.items), JSON.stringify(provResp || {}).slice(0, 100))
    const ninjaItem = (provResp?.items || []).find(i => i.name === 'ninja')
    check('ninja item installing (real detached spawn)', ninjaItem?.action === 'installing', ninjaItem?.action)
    const cmakeItem = (provResp?.items || []).find(i => i.name === 'cmake')
    check('cmake already-ready (present skipped)', cmakeItem?.action === 'already-ready', cmakeItem?.action)
    // poll until ninja graduates (setup script downloads 2MB binary, usually <60s)
    let ninjaDone = false
    for (let i = 0; i < 30 && !ninjaDone; i++) {
      await sleep(4000)
      const ps = await api(`/api/sdks/provision?projectId=${cppId}`, {}, cookie)
      const it = ps.body?.jobs?.[0]?.items?.find(x => x.name === 'ninja')
      ninjaDone = it?.action === 'installed' || fs.existsSync(ninjaBin)
      if (it && !['installing', 'installed'].includes(it.action)) { console.log(`    ninja status: ${it.action} ${it.detail || ''}`); break }
    }
    check('ninja auto-installed by the engine (probe back)', fs.existsSync(ninjaBin), 'probe missing after 120s')
    if (!fs.existsSync(ninjaBin) && fs.existsSync(ninjaBak)) { fs.renameSync(ninjaBak, ninjaBin); console.log('    (restored ninja from backup)') }
    else if (fs.existsSync(ninjaBak)) fs.rmSync(ninjaBak, { force: true })

    // ---- 3. dart project → already-ready trio ----
    const mkDart = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v81-dart-probe', language: 'dart' }) }, cookie)
    const dartId = mkDart.body?.project?.id
    if (dartId) cleanupProjects.push(dartId)
    const dItems = mkDart.body?.provision?.items || []
    check('dart project provision: flutter/android/jdk all already-ready',
      dItems.length === 3 && dItems.every(i => i.action === 'already-ready'),
      JSON.stringify(dItems.map(i => [i.name, i.action])))

    // ---- 4. zip import sniffing ----
    const zip = new AdmZip()
    zip.addFile('pubspec.yaml', Buffer.from('name: sniffed_app\nenvironment:\n  sdk: ">=3.0.0 <4.0.0"\n'))
    zip.addFile('lib/main.dart', Buffer.from('void main(){}'))
    const imp = await api('/api/projects/import', { method: 'POST', body: JSON.stringify({ name: 'v81-import-probe', zipBase64: zip.toBuffer().toString('base64') }) }, cookie)
    const impId = imp.body?.project?.id
    if (impId) cleanupProjects.push(impId)
    check('zip import ok', imp.status === 200 && imp.body?.ok === true, JSON.stringify(imp.body?.error || '').slice(0, 80))
    check('import sniffed dart → provisioning recorded', imp.body?.provision?.language === 'dart', JSON.stringify(imp.body?.provision || {}).slice(0, 100))
    if (impId) {
      const ps = await api(`/api/sdks/provision?projectId=${impId}`, {}, cookie)
      check('import job visible via status API (source=import)', ps.body?.jobs?.[0]?.source === 'import' && ps.body.jobs[0].language === 'dart')
    }

    // ---- 5. healAll disk-guard honesty ----
    const heal = await api('/api/sdks/provision', { method: 'POST', body: JSON.stringify({ healAll: true }) }, cookie)
    check('healAll ok:true with 13 items', heal.status === 200 && heal.body?.ok === true && heal.body?.items?.length === 13)
    const ndkItem = (heal.body?.items || []).find(i => i.name === 'ndk')
    const ndkPresent = fs.existsSync('/home/z/my-project/sdk/android-sdk/ndk')
    const ndkOk = ndkPresent ? ['already-ready', 'installed'].includes(ndkItem?.action)
      : ['blocked-disk', 'installing', 'failed'].includes(ndkItem?.action)
    check(`ndk report matches disk reality (${ndkPresent ? 'present' : 'absent'})`, ndkOk, ndkItem?.action)

    // ---- 6. ipa-export on the dart project ----
    if (dartId) {
      const ipa = await api('/api/publish', { method: 'POST', body: JSON.stringify({ projectId: dartId, target: 'ipa-export' }) }, cookie)
      check('ipa-export ok (real artifact)', ipa.status === 200 && ipa.body?.ok === true && Boolean(ipa.body?.downloadUrl), (ipa.body?.error || '').slice(0, 100))
      check('ipa-export carries honest note', typeof ipa.body?.note === 'string' && ipa.body.note.includes('honest limitation'))
      const art = `/home/z/my-project/download/${dartId}-ios-export.zip`
      check('ios-export kit file on disk', fs.existsSync(art))
      if (fs.existsSync(art)) {
        artifacts.push(art)
        const zf = new AdmZip(art)
        const names = zf.getEntries().map(e => e.entryName)
        check('kit contains ios/ + guide + codemagic.yaml',
          names.some(n => n.startsWith('ios/')) && names.includes('CLOUD-AGENT-IOS-EXPORT.md') && names.includes('codemagic.yaml'),
          names.slice(0, 6).join(','))
      }
      const dl = await fetch(`${BASE}/api/publish?id=${new URL(ipa.body.downloadUrl, BASE).searchParams.get('id')}`, { headers: { Cookie: cookie } })
      check('ipa-export download 200 + zip bytes', dl.status === 200 && (parseInt(dl.headers.get('content-length') || '0') > 1000))
      await dl.arrayBuffer().catch(() => {})
    }

    // ---- 7. google-play workflow (no credentials, no packageName) ----
    if (dartId) {
      const gp = await api('/api/publish', { method: 'POST', body: JSON.stringify({ projectId: dartId, target: 'google-play' }) }, cookie)
      check('google-play returns workflow guide', gp.status === 200 && gp.body?.ok === true && typeof gp.body?.workflow === 'string')
      check('playConfigured:false surfaced', gp.body?.playConfigured === false)
      check('guide mentions service-account auto-upload', (gp.body?.workflow || '').includes('fully automatic upload'))
    }

    // ---- 8. /api/play credential validation ----
    const pl0 = await api('/api/play', {}, cookie)
    const wasConfigured = pl0.body?.configured === true
    if (!wasConfigured) {
      check('GET /api/play 200 (unconfigured)', pl0.status === 200 && pl0.body?.configured === false)
      const bad1 = await api('/api/play', { method: 'POST', body: JSON.stringify({ action: 'save', json: 'not json' }) }, cookie)
      check('invalid JSON key → 400', bad1.status === 400)
      const bad2 = await api('/api/play', { method: 'POST', body: JSON.stringify({ action: 'save', json: JSON.stringify({ client_email: 'x@x.iam.gserviceaccount.com' }) }) }, cookie)
      check('missing private_key → 400', bad2.status === 400)
      const fakeKey = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKjMzEfYyJWA4dRFo\n-----END PRIVATE KEY-----\n'
      const ok1 = await api('/api/play', { method: 'POST', body: JSON.stringify({ action: 'save', json: JSON.stringify({ client_email: 'v81test@v81test.iam.gserviceaccount.com', private_key: fakeKey }) }) }, cookie)
      check('full-shape key saved', ok1.status === 200 && ok1.body?.ok === true, JSON.stringify(ok1.body).slice(0, 80))
      const pl1 = await api('/api/play', {}, cookie)
      check('configured:true + clientEmail echoed', pl1.body?.configured === true && pl1.body?.clientEmail === 'v81test@v81test.iam.gserviceaccount.com')
      // google-play with packageName + fake creds → honest upstream error (token exchange fails)
      const gp2 = await api('/api/publish', { method: 'POST', body: JSON.stringify({ projectId: dartId, target: 'google-play', packageName: 'com.v81.probe' }) }, cookie)
      check('upload with fake creds fails HONESTLY (no fake success)', gp2.body?.ok === false && typeof gp2.body?.error === 'string' && gp2.body.error.length > 10, (gp2.body?.error || gp2.status).toString().slice(0, 90))
      const clr = await api('/api/play', { method: 'POST', body: JSON.stringify({ action: 'clear' }) }, cookie)
      check('clear ok', clr.status === 200 && clr.body?.ok === true)
      const pl2 = await api('/api/play', {}, cookie)
      check('unconfigured again after clear', pl2.body?.configured === false)
    } else {
      console.log('    (play service account already configured — skipping save/clear test to not disturb operator state)')
    }

    // ---- 9. publish web regression ----
    const mkStatic = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: 'v81-web-probe', language: 'html' }) }, cookie)
    const staticId = mkStatic.body?.project?.id
    if (staticId) cleanupProjects.push(staticId)
    if (staticId) {
      const pub = await api('/api/publish', { method: 'POST', body: JSON.stringify({ projectId: staticId, target: 'web' }) }, cookie)
      check('publish web regression ok', pub.status === 200 && pub.body?.ok === true && Boolean(pub.body?.downloadUrl), (pub.body?.error || '').slice(0, 80))
    }

    // ---- 10. v79 regression: sdk manager intact ----
    const sdks = await api('/api/sdks', {}, cookie)
    check('GET /api/sdks 200 with 13 managed toolchains', sdks.status === 200 && sdks.body?.toolchains?.length === 13)
    check('sdk storage panel intact', sdks.body?.storage?.totalGb > 0)
  } catch (e) {
    check('suite crashed', false, String(e))
  } finally {
    // ---- cleanup ----
    for (const id of cleanupProjects) {
      await api(`/api/projects/${id}`, { method: 'DELETE' }, cookie).catch(() => {})
    }
    for (const a of artifacts) { try { fs.rmSync(a, { force: true }) } catch {} }
    try { fs.rmSync('/home/z/my-project/sdk/.provision', { recursive: true, force: true }) } catch {}
    execSync('bun scripts/lock-dance.js restore', { cwd: '/home/z/my-project', stdio: 'pipe' })
    const armed = await fetch(BASE + '/api/sdks')
    check('lock restored → protected API armed (401)', armed.status === 401, `status=${armed.status}`)
  }

  console.log(`\n${pass}/${pass + fail} checks passed`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
