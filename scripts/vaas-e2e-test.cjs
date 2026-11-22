#!/usr/bin/env node
/** CLOUD AGENT VaaS provision test: login → POST /api/projects/:id/vaas → verify keys + snippet → data-plane write/read. */
const BASE = 'http://localhost:3000';
const VX = 'http://127.0.0.1:3200';
const PROJECT_ID = 'cmwa09izs001kpmxbb785tn0i';

async function api(path, { method = 'GET', body, cookie, key, vxKey } = {}, base = BASE) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(vxKey ? { 'x-vx-key': vxKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 160) }; }
  return { status: res.status, json, setCookie: res.headers.get('set-cookie') || '' };
}

(async () => {
  const R = [];
  const step = (n, ok, d = '') => { R.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };

  const login = await api('/api/auth/login', { method: 'POST', body: { email: 'mdhonabali61@gmail.com', password: 'Owner123' } });
  const cookie = (login.setCookie.match(/[^=;\s]+=[^;]+/) || [''])[0];
  step('login', Boolean(cookie) && login.json?.ok === true);

  // 1. provision (POST) — collections: users/posts/settings default
  const p1 = await api(`/api/projects/${PROJECT_ID}/vaas`, { method: 'POST', cookie, body: { collections: ['users', 'posts', 'settings'] } });
  const v = p1.json || {};
  step('vaas-provision', p1.status === 200 && v.ok === true && Boolean(v.vaasProjectId) && Boolean(v.clientKey),
    `projectId=${v.vaasProjectId || '-'} clientKey=${v.clientKey ? String(v.clientKey).slice(0, 10) + '…' : '-'} adminKey=${v.adminKey ? 'shown-once' : '-'}`);
  if (!v.ok) { console.log('detail:', JSON.stringify(p1.json).slice(0, 300)); process.exit(1); }

  // 2. idempotent re-POST
  const p2 = await api(`/api/projects/${PROJECT_ID}/vaas`, { method: 'POST', cookie, body: {} });
  step('vaas-idempotent', p2.json?.provisioned === true && p2.json?.vaasProjectId === v.vaasProjectId, `same projectId=${p2.json?.vaasProjectId === v.vaasProjectId}`);

  // 3. GET status (keys masked)
  const g = await api(`/api/projects/${PROJECT_ID}/vaas`, { cookie });
  const gk = JSON.stringify(g.json);
  const adminLeak = v.adminKey && gk.includes(v.adminKey);
  step('vaas-status-masked', g.status === 200 && g.json?.provisioned === true && !adminLeak, `adminKeyLeaked=${adminLeak}`);

  // 4. DATA PLANE — write via client key: create a record in users collection
  const c = v.clientKey;
  const write = await api(`/api/vaas/v1/data/users`, { method: 'POST', vxKey: c, body: { data: { name: 'E2E Probe', email: `probe-${Date.now()}@test.vn` } } }, VX);
  step('vaas-unauth-write-denied', write.status === 403, `HTTP ${write.status} (writeRule=auth denies anonymous — security-correct)`);

  // 5. public read (readRule=public) — exercised after records exist in step 7
  // (moved below the authed write)

  // 6. OTP auth flow (the "verification OTP system" promise)
  const otpReq = await api(`/api/vaas/v1/auth/otp-request`, { method: 'POST', vxKey: c, body: { email: 'enduser@test.vn' } }, VX);
  const devCode = otpReq.json?.devCode || otpReq.json?.data?.devCode;
  step('vaas-otp-request', otpReq.status === 200 || otpReq.status === 201, `HTTP ${otpReq.status} delivery=${otpReq.json?.delivery || otpReq.json?.data?.delivery || '-'} devCode=${devCode ? 'returned(dev)' : '-'}`);
  let idToken = '';
  if (devCode) {
    const otpVer = await api(`/api/vaas/v1/auth/otp-verify`, { method: 'POST', vxKey: c, body: { email: 'enduser@test.vn', code: devCode } }, VX);
    idToken = otpVer.json?.idToken || otpVer.json?.data?.idToken || '';
    step('vaas-otp-verify-token', otpVer.status === 200 && Boolean(idToken), `uid=${otpVer.json?.uid || otpVer.json?.data?.uid || '-'} idToken=${String(idToken).slice(0, 12)}…`);
  }

  // 7. AUTHED data write — end-user token passes writeRule=auth
  if (idToken) {
    const aw = await api(`/api/vaas/v1/data/users`, { method: 'POST', vxKey: c, key: idToken, body: { data: { name: 'Authed Probe', note: `otp-flow-${Date.now()}` } } }, VX);
    step('vaas-authed-write', aw.status === 200 || aw.status === 201, `HTTP ${aw.status} ${JSON.stringify(aw.json).slice(0, 100)}`);
    const al = await api(`/api/vaas/v1/data/users`, { vxKey: c, key: idToken }, VX);
    const ab = JSON.stringify(al.json);
    step('vaas-authed-list', al.status === 200 && ab.includes('Authed Probe'), `HTTP ${al.status}, visible=${ab.includes('Authed Probe')}`);
    const pubList = await api(`/api/vaas/v1/data/users`, { vxKey: c }, VX);
    const pubStr = JSON.stringify(pubList.json);
    step('vaas-public-read', pubList.status === 200 && pubStr.includes('Authed Probe'), `HTTP ${pubList.status}, public-visible=${pubStr.includes('Authed Probe')}`);
  }

  const fails = R.filter(r => !r.ok).length;
  console.log(`\nRESULT: ${R.length - fails}/${R.length} passed ${fails ? '' : 'ALL GREEN'}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
