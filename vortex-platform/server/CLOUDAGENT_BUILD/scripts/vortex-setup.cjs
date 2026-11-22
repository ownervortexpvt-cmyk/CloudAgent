#!/usr/bin/env node
/**
 * VORTEX SERVER — one-time setup via API:
 * 1. owner login (email+password) -> OTP devCode -> verify -> session cookie
 * 2. configure JOY credentials (access+secret; api_token arrives later)
 * 3. issue platform keys: cloud-agent, vortex-website, appverse
 * Raw keys are written straight into CloudAgent .env (never printed fully).
 */
const BASE = 'http://127.0.0.1:3200';

async function api(path, opts = {}, cookie = '', retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method: opts.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
      const setCookie = res.headers.get('set-cookie') || '';
      return { status: res.status, json, setCookie };
    } catch (e) {
      if (attempt === retries) throw e;
      // server may have died mid-sequence — give the watchdog time, then retry
      await new Promise(r => setTimeout(r, 15000));
    }
  }
}

(async () => {
  const results = { steps: [] };
  const step = (name, data) => { results.steps.push({ name, ...data }); console.log(`[ok] ${name}`); };

  // 1. login
  const login = await api('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@vortex.local', password: 'Vortex@2026' } });
  if (!login.json || !login.json.ok) throw new Error('login failed: ' + JSON.stringify(login).slice(0, 300));
  const devCode = login.json.data.devCode;
  if (!devCode) throw new Error('no devCode returned — SMTP may be configured');
  step('login', { delivery: login.json.data.delivery });

  // 2. otp verify -> session cookie
  const otp = await api('/api/v1/auth/otp', { method: 'POST', body: { email: 'admin@vortex.local', code: devCode } });
  if (!otp.json || !otp.json.ok) throw new Error('otp verify failed: ' + JSON.stringify(otp).slice(0, 300));
  const m = otp.setCookie && otp.setCookie.match(/vortex_session=[^;]+/);
  if (!m) throw new Error('no session cookie in response: ' + JSON.stringify(otp.json).slice(0, 200));
  const cookie = m[0];
  step('otp-session', { cookieName: 'vortex_session' });

  // 3. overview sanity
  const ov = await api('/api/v1/admin/overview', {}, cookie);
  if (!ov.json || !ov.json.ok) throw new Error('overview failed: ' + JSON.stringify(ov.json).slice(0, 200));
  step('admin-overview', { platforms: (ov.json.data.platforms || []).length, storageProvider: ov.json.data.storage?.provider });

  // 4. joy credentials (all 3 — api_token now provided by user)
  // NOTE: the real S3 endpoint is nz.in.s3.joy.services (reported by the Joy
  // REST v1 /storage response) — the default s3.joy.services host is NOT
  // reachable and times out on the data plane.
  const joy = await api('/api/v1/admin/storage/joy/configure', { method: 'POST', body: {
    accessKey: (SECRETS.joyAccessKey || ''),
    secretKey: (SECRETS.joySecretKey || ''),
    apiToken: 'joy_22f711ba86b7.61be075f0b18d478f819ec414501c049604ebb67',
    endpoint: 'https://nz.in.s3.joy.services',
  } }, cookie);
  step('joy-configure', { status: joy.status, ok: joy.json && joy.json.ok });

  const st = await api('/api/v1/admin/storage', {}, cookie);
  results.storage = st.json && st.json.data && st.json.data.provider;
  console.log('[storage provider]', JSON.stringify(results.storage));

  // 5. issue platform keys
  const fs = require('fs')
// v167.1 secret hygiene — live credentials load from .secrets (never committed)
let SECRETS = {}
try { SECRETS = JSON.parse(fs.readFileSync('/home/z/my-project/.secrets/vortex-secrets.json', 'utf8')) } catch {}
;
  const envPath = '/home/z/my-project/.env';
  let env = fs.readFileSync(envPath, 'utf8');
  const keyMap = {
    'cloud-agent': 'VORTEX_PLATFORM_KEY',
    'vortex-website': 'VORTEX_WEBSITE_KEY',
    'appverse': 'VORTEX_APPVERSE_KEY',
  };
  results.keys = {};
  for (const [platform, envName] of Object.entries(keyMap)) {
    const issued = await api(`/api/v1/admin/platforms/${platform}/keys`, { method: 'POST', body: { name: `cloud-agent integration (${platform})` } }, cookie);
    if (!issued.json || !issued.json.ok) { console.log(`[FAIL] ${platform}: ${JSON.stringify(issued.json).slice(0, 200)}`); results.keys[platform] = { error: issued.json && issued.json.error }; continue; }
    const raw = issued.json.data.raw;
    results.keys[platform] = { keyId: issued.json.data.keyId, scopes: issued.json.data.scopes, rawTail: raw.slice(-6) };
    // upsert into CloudAgent .env (replace existing line if present)
    const line = `${envName}=${raw}`;
    const re = new RegExp(`^${envName}=.*$`, 'm');
    env = re.test(env) ? env.replace(re, line) : env + (env.endsWith('\n') ? '' : '\n') + line + '\n';
    fs.writeFileSync(envPath, env);
    console.log(`[key] ${platform} -> ${envName} (…${raw.slice(-6)})`);
  }
  step('platform-keys', Object.keys(results.keys));

  fs.writeFileSync('/home/z/my-project/scripts/vortex-setup-result.json', JSON.stringify(results, null, 2));
  console.log('SETUP COMPLETE');
})().catch(e => { console.error('SETUP FAILED:', e.message); process.exit(1); });
