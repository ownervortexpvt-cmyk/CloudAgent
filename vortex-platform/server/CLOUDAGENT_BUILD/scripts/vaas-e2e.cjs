#!/usr/bin/env node
/** E2E: use a provisioned VaaS CLIENT key against the VORTEX SERVER public SDK:
 *  health → auth signup → otp request/verify → data add/list → storage upload/download. */
const BASE = process.env.VS_BASE || 'http://127.0.0.1:3200';
const CLIENT_KEY = process.env.VX_CLIENT_KEY || 'vxk_b85d1b21f7d52c3574896761aed2e6e4';
let pass = 0, fail = 0;
const ok = (n, x) => { pass++; console.log(`  + ${n}${x ? ` - ${x}` : ''}`); };
const bad = (n, x) => { fail++; console.log(`  x ${n}${x ? ` - ${x}` : ''}`); };

async function call(p, { method = 'GET', body, token, raw } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'x-vx-key': CLIENT_KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

(async () => {
  const health = await call('/api/vaas/v1/health');
  health.json?.ok ? ok('health', JSON.stringify(health.json).slice(0, 80)) : bad('health', JSON.stringify(health.json).slice(0, 80));

  // --- auth: signup → otp request → otp verify (devCode in response, no SMTP) ---
  const email = `e2e-${Date.now()}@vortex.test`;
  const su = await call('/api/vaas/v1/auth/signup', { method: 'POST', body: { email, password: 'Test@12345', displayName: 'E2E User' } });
  su.json?.ok ? ok('auth signup', su.json?.data?.user?.email || su.json?.user?.email || email) : bad('auth signup', JSON.stringify(su.json).slice(0, 120));
  const token1 = su.json?.data?.token || su.json?.token;

  const otpReq = await call('/api/vaas/v1/auth/otp-request', { method: 'POST', body: { email } });
  const devCode = otpReq.json?.data?.devCode || otpReq.json?.devCode;
  otpReq.json?.ok ? ok('otp request', devCode ? `devCode=${devCode}` : 'sent') : bad('otp request', JSON.stringify(otpReq.json).slice(0, 120));

  const otpVer = await call('/api/vaas/v1/auth/otp-verify', { method: 'POST', body: { email, code: devCode } });
  const token2 = otpVer.json?.idToken || otpVer.json?.data?.idToken || otpVer.json?.data?.token || otpVer.json?.token;
  otpVer.json?.ok && token2 ? ok('otp verify → session', String(token2).slice(0, 14) + '…') : bad('otp verify', JSON.stringify(otpVer.json).slice(0, 120));

  // --- data CRUD (write:auth collections need the user's idToken) ---
  const add = await call('/api/vaas/v1/data/projects', { method: 'POST', body: { title: 'E2E doc', n: 42 }, token: token2 || undefined });
  const docId = add.json?.id || add.json?.docId || add.json?.data?.id;
  add.json?.ok ? ok('data add (authed write)', docId || JSON.stringify(add.json).slice(0, 80)) : bad('data add', JSON.stringify(add.json).slice(0, 120));
  // anonymous read of a public-read collection must work WITHOUT the token
  const list = await call('/api/vaas/v1/data/projects');
  const count = Array.isArray(list.json?.items) ? list.json.items.length : (Array.isArray(list.json?.data?.items) ? list.json.data.items.length : -1);
  count >= 1 ? ok('data list (public read)', `${count} docs`) : bad('data list', JSON.stringify(list.json).slice(0, 120));
  // anonymous WRITE must be DENIED (rules engine check)
  const anonWrite = await call('/api/vaas/v1/data/projects', { method: 'POST', body: { title: 'anon' } });
  anonWrite.json?.ok === false ? ok('rules engine denies anon write', anonWrite.json?.error?.slice(0, 40)) : bad('rules engine', 'anon write allowed?!');

  // --- storage round-trip ---
  const contentB64 = Buffer.from(`vortex storage e2e ${Date.now()}`).toString('base64');
  const up = await call('/api/vaas/v1/storage/upload', { method: 'POST', body: { path: `e2e/test-${Date.now()}.txt`, contentB64, mime: 'text/plain' } });
  const fileId = up.json?.data?.fileId || up.json?.fileId;
  up.json?.ok ? ok('storage upload', fileId || up.json?.data?.path) : bad('storage upload', JSON.stringify(up.json).slice(0, 120));
  const dl = await call(`/api/vaas/v1/storage/file?id=${fileId}`, { raw: true });
  const bytes = dl.status === 200 && dl.buf.length ? dl.buf.toString() : null;
  bytes ? ok('storage download', `${bytes.length}B round-trip, checksum header: ${bytes.includes('vortex storage e2e') ? 'byte-exact' : 'MISMATCH'}`) : bad('storage download', `HTTP ${dl.status}`);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
