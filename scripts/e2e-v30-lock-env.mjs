/**
 * E2E — v30 LOCK ENVIRONMENT. The "lock kaj korsena" fix:
 *
 *   1. UA classifier unit tests — Instagram / Facebook / WhatsApp / LINE /
 *      TikTok / Telegram in-app browsers, Android WebView, iOS WKWebView are
 *      ALL detected; real Chrome / Safari / Firefox are NOT.
 *   2. passkeyEnvironmentIssue ordering — in-app beats iframe beats unsupported.
 *   3. Lock API regression on the public surface — status, publicCount,
 *      auth-options without passkeys → 404, register-options requires unlock.
 *   4. Shipped client chunks carry the new guidance strings.
 *
 * Run: node scripts/e2e-v30-lock-env.mjs
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.BASE || 'http://127.0.0.1:3000'
const db = new PrismaClient()
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`) }
}

const UAS = {
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36 Instagram 320.1.0.0.109 Android',
  instagramIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 322.0.0.0 (iPhone13,2; iOS 17_4)',
  facebookAndroid: 'Mozilla/5.0 (Linux; Android 12; SM-A528B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/450.0.0.0]',
  whatsappAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.5.75',
  androidWebView: 'Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36',
  iosWKWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  lineAndroid: 'Mozilla/5.0 (Linux; Android 13; SM-E236B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/121.0.0.0 Mobile Safari/537.36 Line/14.10.1',
  tiktokIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 TikTok 34.5.0 BytedanceApp',
  telegramAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/123.0.0.0 Mobile Safari/537.36 Telegram-Android/10.6.0',
  realChromeDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  realChromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36',
  realSafariIOS: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  realFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
}

async function main() {
  console.log(`\n=== v30 LOCK ENVIRONMENT E2E @ ${BASE} ===\n`)

  // ── 1. UA classifier (bun probe with navigator shim) ──────────────────────
  const probe = `
    globalThis.navigator = { userAgent: '' }
    const m = await import('${process.cwd()}/src/lib/webauthn-client.ts')
    const cases = ${JSON.stringify(UAS)}
    const out = {}
    for (const [k, ua] of Object.entries(cases)) {
      out[k] = m.inAppBrowserName(ua)
    }
    console.log('__PROBE__' + JSON.stringify({ names: out, instagramBool: m.isInAppBrowser(cases.instagramAndroid) }))
  `
  let probeOut = ''
  try {
    probeOut = execFileSync('bun', ['-e', probe], { encoding: 'utf8', timeout: 60000 })
  } catch (e) { console.error('probe failed:', String(e?.stderr || e).slice(0, 300)) }
  const jLine = probeOut.split('\n').find(l => l.includes('__PROBE__')) || ''
  const names = jLine ? JSON.parse(jLine.split('__PROBE__')[1]).names : null

  if (names) {
    const expectedInApp = {
      instagramAndroid: 'Instagram in-app browser',
      instagramIOS: 'Instagram in-app browser',
      facebookAndroid: 'Facebook in-app browser',
      whatsappAndroid: 'WhatsApp in-app browser',
      androidWebView: 'Android WebView',
      iosWKWebView: 'iOS in-app browser (WKWebView)',
      lineAndroid: 'LINE in-app browser',
      tiktokIOS: 'TikTok in-app browser',
      telegramAndroid: 'Telegram in-app browser',
    }
    for (const [k, want] of Object.entries(expectedInApp)) {
      ok(`detect ${k}`, names[k] === want, `${names[k] || 'null'}`)
    }
    for (const k of ['realChromeDesktop', 'realChromeAndroid', 'realSafariIOS', 'realFirefox']) {
      ok(`real browser NOT flagged: ${k}`, names[k] === null, `${names[k] || 'null'}`)
    }
  } else {
    ok('UA probe ran', false, 'no output')
  }

  // ── 2. issue ordering (iframe < in-app < unsupported) ─────────────────────
  const probe2 = `
    const m = await import('${process.cwd()}/src/lib/webauthn-client.ts')
    globalThis.navigator = { userAgent: ${JSON.stringify(UAS.instagramAndroid)} }
    const inApp = m.passkeyEnvironmentIssue()
    // iframe case: accessing window.top throws cross-origin (like a real frame)
    const win = new Proxy({}, { get(t, p) { if (p === 'top') throw new Error('cross-origin'); if (p === 'self') return t } })
    globalThis.window = win
    globalThis.navigator = { userAgent: ${JSON.stringify(UAS.realChromeDesktop)} }
    const framed = m.passkeyEnvironmentIssue()
    // unsupported browser: top-level (self === top, same object like a real window), no credentials
    const same = {}
    globalThis.window = { self: same, top: same }
    globalThis.navigator = { userAgent: ${JSON.stringify(UAS.realFirefox)} }
    const unsupported = m.passkeyEnvironmentIssue()
    // clean environment: chrome UA + credentials + genuinely same-frame
    const same2 = {}
    globalThis.window = { self: same2, top: same2, PublicKeyCredential: function P() {} }
    globalThis.navigator = { userAgent: ${JSON.stringify(UAS.realChromeDesktop)}, credentials: {} }
    const clean = m.passkeyEnvironmentIssue()
    console.log('__PROBE2__' + JSON.stringify({ inApp, framed, unsupported, clean }))
  `
  let p2 = null
  try {
    const out2 = execFileSync('bun', ['-e', probe2], { encoding: 'utf8', timeout: 60000 })
    const line = out2.split('\n').find(l => l.includes('__PROBE2__'))
    if (line) p2 = JSON.parse(line.split('__PROBE2__')[1])
  } catch (e) { console.error('probe2 failed:', String(e?.stderr || e).slice(0, 300)) }
  if (p2) {
    ok('issue: in-app browser wins', p2.inApp === 'Instagram in-app browser', p2.inApp)
    ok('issue: framed chrome → iframe', p2.framed === 'Embedded preview iframe', p2.framed)
    ok('issue: no credentials → unsupported', p2.unsupported === 'Browser without passkey support', p2.unsupported)
    ok('issue: clean chrome → null (allowed)', p2.clean === null, String(p2.clean))
  } else {
    ok('issue-order probe ran', false)
  }

  // ── 3. lock API public-surface regression ─────────────────────────────────
  const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
  const status = await (await fetch(`${BASE}/api/lock`)).json()
  ok('GET /api/lock configured', status.ok === true && status.configured === true, `configured=${status.configured}`)

  const count = await (await fetch(`${BASE}/api/lock/passkey?publicCount=1`)).json()
  ok('passkey publicCount shape', count.ok === true && typeof count.count === 'number', `count=${count.count}`)

  const authOpts = await (await fetch(`${BASE}/api/lock/passkey`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auth-options' }) })).json()
  ok('auth-options w/o passkeys → clean 404', authOpts.ok === false && !!authOpts.error, authOpts.error?.slice(0, 60))
  if (count.count > 0) {
    ok('auth-options WITH passkeys → challenge', !!authOpts.challenge, 'challenge issued')
  }

  const regOpts = await (await fetch(`${BASE}/api/lock/passkey`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'register-options' }) })).json()
  ok('register-options while locked → 401', regOpts.ok === false, regOpts.error?.slice(0, 60))

  // signed-session flows still work (token channel)
  function signToken(secret, now = Date.now()) {
    const expiry = now + 30 * 24 * 60 * 60 * 1000
    const payload = `v1.${expiry}`
    const mac = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    return `${payload}.${mac}`
  }
  const TOKEN = signToken(secret)
  await db.lockSession.upsert({
    where: { tokenHash: crypto.createHash('sha256').update(TOKEN).digest('hex') },
    update: { lastSeenAt: new Date() },
    create: { tokenHash: crypto.createHash('sha256').update(TOKEN).digest('hex'), device: 'E2E v30 lock-env', ip: '127.0.0.1' },
  })
  const verify = await (await fetch(`${BASE}/api/lock`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ca-lock': TOKEN }, body: JSON.stringify({ action: 'verify' }) })).json()
  ok('token channel verify', verify.valid === true)

  const regOptsAuthed = await (await fetch(`${BASE}/api/lock/passkey`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ca-lock': TOKEN }, body: JSON.stringify({ action: 'register-options' }) })).json()
  ok('register-options unlocked → options', regOptsAuthed.ok === true && !!regOptsAuthed.options?.challenge, 'rpId ' + (regOptsAuthed.options?.rp?.id || regOptsAuthed.options?.rpId || 'n/a'))
  const challengeOk = regOptsAuthed.ok && regOptsAuthed.challenge
  if (challengeOk) {
    // feed a forged registration — must be refused (no real authenticator here)
    const forged = await (await fetch(`${BASE}/api/lock/passkey`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ca-lock': TOKEN }, body: JSON.stringify({ action: 'register', challenge: regOptsAuthed.challenge, clientDataJSON: 'e30', attestationObject: 'e30' }) })).json()
    ok('forged registration refused', forged.ok === false, (forged.error || '').slice(0, 60))
  }

  // ── 4. shipped chunks carry the new guidance ──────────────────────────────
  // Warm the main app page with the token so the server compiles the fresh
  // SettingsDialog chunk (client chunks are request-driven in dev).
  await fetch(`${BASE}/`, { headers: { 'x-ca-lock': TOKEN }, signal: AbortSignal.timeout(90000) }).catch(() => {})
  const nextDir = '/home/z/my-project/.next'
  let hit = 0, scanned = 0
  const needles = ['in-app browser', 'Open in Chrome', 'screen lock (PIN / pattern / fingerprint)']
  // dev builds live under .next/dev, prod under .next/static — scan what exists
  const roots = ['.next/dev', '.next/static'].map(r => path.join('/home/z/my-project', r)).filter(r => fs.existsSync(r))
  if (roots.length) {
    for (const rootDir of roots) {
      ;(function walk(d) {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name)
          if (e.isDirectory()) walk(p)
          else if (/\.(js|mjs)$/.test(e.name) && /chunk|static|page|app/.test(p)) {
            if (scanned > 900) return
            scanned++
            try {
              const s = fs.readFileSync(p, 'utf8')
              if (needles.every(n => s.includes(n))) hit++
            } catch { /* skip unreadable */ }
          }
        }
      })(rootDir)
    }
  }
  ok('shipped chunks carry v30 guidance', hit >= 1, `${hit} chunks contain all 3 strings (scanned ${scanned})`)

  await db.lockSession.deleteMany({ where: { device: 'E2E v30 lock-env' } })
  console.log(`\n${pass} PASS / ${fail} FAIL`)
  await db.$disconnect()
  process.exit(fail ? 1 : 0)
}

main().catch(async (e) => {
  console.error('E2E crashed:', e)
  await db.$disconnect().catch(() => {})
  process.exit(1)
})
