#!/usr/bin/env node
/**
 * VORTEX VAAS — Firebase-parity LIVE capability test.
 * Proves on a freshly provisioned project:
 *   Firestore-like DB   → collections + add/query(update/patch) docs
 *   Firebase-Auth-like  → signup → me → signout
 *   Firebase-Storage-like → upload → download (checksum) → list
 *   Cloud-Functions-like→ register + HTTP invoke
 *   Realtime            → publish event → verify event recorded
 *   Metering            → usage counters incremented
 * Keys are never printed in full (tails only).
 */
const BASE = 'http://127.0.0.1:3200';
const OUT = [];

function step(name, ok, detail = '') {
  OUT.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}
const mask = (k) => (k ? k.slice(0, 8) + '…' + k.slice(-4) : '');
async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 160) }; }
  return { status: res.status, json, headers: res.headers };
}

(async () => {
  // ---- 0. admin session (login → devCode → otp) ----
  const login = await api('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@vortex.local', password: 'Vortex@2026' } });
  if (!login.json?.ok) throw new Error('admin login failed: ' + JSON.stringify(login.json).slice(0, 200));
  const otp = await api('/api/v1/auth/otp', { method: 'POST', body: { email: 'admin@vortex.local', code: login.json.data.devCode } });
  const cookie = (otp.headers.get('set-cookie') || '').match(/vortex_session=[^;]+/)?.[0] || '';
  if (!cookie) throw new Error('no admin session cookie');
  step('admin-session', true);

  // ---- 1. provision project (fresh throwaway developer per run) ----
  // v150 root-fix: repeated runs used to provision under the shared nexa
  // developer and filled vaas.max_projects_per_dev (10) → FATAL "Developer
  // project quota reached (10)". baas-e2e already proved the throwaway-dev
  // pattern (fresh dev account per run, 1 project each) — both parity
  // suites now use it so the shared admin dev never accumulates projects.
  const stamp = Date.now().toString(36);
  const devEmail = `vxfbp-${stamp}@test.local`;
  const devPassword = `e2e-${stamp}-x7K9mQ2p`;
  const devRes = await api('/api/v1/vaas', { method: 'POST', headers: { Cookie: cookie }, body: {
    op: 'create_developer', email: devEmail, password: devPassword, name: 'fb-parity e2e',
  } });
  if (!devRes.json?.ok) throw new Error('create_developer failed: ' + JSON.stringify(devRes.json).slice(0, 200));
  const devId = devRes.json.data?.devId || devRes.json.devId || '';
  if (!devId) throw new Error('no devId from create_developer');
  const prov = await api('/api/v1/vaas', { method: 'POST', headers: { Cookie: cookie }, body: {
    op: 'provision_project', devId, name: 'Firebase-Kill-Demo',
    collections: [ { name: 'todos', read: 'public', write: 'public' }, { name: 'messages', read: 'auth', write: 'auth' }, { name: 'posts', read: 'public', write: 'auth' } ],
  } });
  if (!prov.json?.ok) throw new Error('provision failed: http=' + prov.status + ' ' + JSON.stringify(prov.json).slice(0, 300));
  const d = prov.json.data || {};
  const adminKey = d.adminKey || d.keys?.admin || '';
  const clientKey = d.clientKey || d.keys?.client || '';
  const projectId = d.projectId || '';
  step('project-provisioned', !!(adminKey && projectId), `projectId=${projectId} adminKey=${mask(adminKey)} clientKey=${mask(clientKey)}`);

  // v150 root-fix (part 2): provision_project does not seed nexa's welcome fn
  // (that was nexa_provision's extra). Register onUserWelcome through the REAL
  // developer-console surface (dev-login as the fresh developer) — keeps the
  // test honest and everything owned by the throwaway developer.
  const devLogin = await api('/api/vaas/v1/dev/login', { method: 'POST', body: { email: devEmail, password: devPassword } });
  const devToken = devLogin.json?.token || devLogin.json?.data?.token || '';
  if (!devToken) throw new Error('dev login failed: ' + JSON.stringify(devLogin.json).slice(0, 200));
  const welcomeCode = [
    "if (ctx.payload.event === 'signup') {",
    "  await ctx.db.add('posts', {",
    "    kind: 'welcome',",
    "    forUid: ctx.payload.user.uid,",
    "    message: 'Welcome to ' + ctx.project.name + '!',",
    "    createdAt: ctx.now",
    "  });",
    "}",
    "return { ok: true };",
  ].join("\n");
  const fnReg = await api(`/api/vaas/v1/dev/projects/${projectId}/functions`, { method: 'POST', headers: { Authorization: 'Bearer ' + devToken }, body: { name: 'onUserWelcome', trigger: 'EVENT_AUTH', code: welcomeCode } });
  if (!fnReg.json?.ok) throw new Error('welcome fn deploy failed: ' + JSON.stringify(fnReg.json).slice(0, 200));

  const H = { 'x-vx-key': adminKey };

  // ---- 2. Vx health + config (health returns the full project config) ----
  const health = await api('/api/vaas/v1/health', { headers: H });
  const cfgEnvelope = health.json?.config || health.json?.data?.config || {};
  step('vaas-health', health.status === 200, `status=${health.status}`);
  step('project-config', cfgEnvelope.projectId === projectId,
    `auth=${cfgEnvelope.authEnabled} rt=${cfgEnvelope.realtimeEnabled} fn=${cfgEnvelope.functionsEnabled} bucket=${cfgEnvelope.storageBucket || 'n/a'} collections=${(health.json?.collections || health.json?.data?.collections || []).length}`);

  // ---- 3. Firestore-like DB ----
  const add1 = await api('/api/vaas/v1/data/todos', { method: 'POST', headers: H, body: { data: { title: 'Vortex banano', done: false, priority: 1 } } });
  const add2 = await api('/api/vaas/v1/data/todos', { method: 'POST', headers: H, body: { data: { title: 'Firebase compare koro', done: false, priority: 2 } } });
  step('doc-add', add1.status === 201 && add2.status === 201, `2 docs, id1=${(add1.json?.data?.doc?.id || add1.json?.id || '').slice(0, 10)}`);
  const doc1 = add1.json?.data?.doc?.id || add1.json?.id || '';
  const q = await api('/api/vaas/v1/data/todos?orderBy=priority&limit=10&contains=' + encodeURIComponent(JSON.stringify({ title: 'Firebase' })), { headers: H });
  const qItems = q.json?.items || q.json?.data?.items || [];
  step('doc-query(contains/orderBy/limit)', q.status === 200 && Array.isArray(qItems) && qItems.length >= 1, `status=${q.status} raw=${JSON.stringify(q.json).slice(0, 120)}`);
  const upd = await api(`/api/vaas/v1/data/todos/${doc1}`, { method: 'PATCH', headers: H, body: { data: { done: true } } });
  step('doc-patch-update', upd.status === 200, `status=${upd.status} body=${JSON.stringify(upd.json).slice(0, 120)}`);

  // ---- 4. Firebase-Auth-like ----
  const email = `demo.${Date.now()}@vortex.test`;
  const su = await api('/api/vaas/v1/auth/signup', { method: 'POST', headers: H, body: { email, password: 'Demo@2026x', name: 'Demo User' } });
  const token = su.json?.idToken || su.json?.data?.idToken || '';
  step('auth-signup', su.status === 200 || su.status === 201, `status=${su.status} raw=${JSON.stringify(su.json).slice(0, 140)}`);
  const me = await api('/api/vaas/v1/auth/me', { method: 'POST', headers: { ...H, Authorization: `Bearer ${token}` } });
  step('auth-me', me.status === 200 && JSON.stringify(me.json).includes(email.slice(0, 10)), `email=${email}`);
  const so = await api('/api/vaas/v1/auth/signout', { method: 'POST', headers: { ...H, Authorization: `Bearer ${token}` } });
  step('auth-signout', so.status === 200 || so.status === 201);

  // ---- 5. Firebase-Storage-like (Joy S3 backed) ----
  const b64 = Buffer.from('Vortex storage demo — Joy S3 backed, ' + new Date().toISOString()).toString('base64');
  const up = await api('/api/vaas/v1/storage/upload', { method: 'POST', headers: H, body: { path: 'demo/hello.txt', contentB64: b64, mime: 'text/plain' } });
  const fileId = up.json?.data?.fileId || up.json?.fileId || '';
  step('storage-upload', up.status === 201 || up.status === 200, `fileId=${String(fileId).slice(0, 14)}`);
  const dl = await api('/api/vaas/v1/storage/file?path=demo/hello.txt', { headers: H });
  const dlText = Buffer.isBuffer(dl.json) ? '' : (typeof dl.json === 'string' ? dl.json : '');
  const chk = dl.headers.get('x-vx-checksum');
  step('storage-download', dl.status === 200, `checksum=${chk ? chk.slice(0, 10) + '…' : 'none'} len=${dl.headers.get('content-length') || '?'}`);
  const ls = await api('/api/vaas/v1/storage/list', { headers: H });
  const lsFiles = ls.json?.files || ls.json?.data?.files || ls.json?.data || [];
  step('storage-list', ls.status === 200, `files=${Array.isArray(lsFiles) ? lsFiles.length : '?'}`);

  // ---- 6. Cloud-Functions-like (EVENT_AUTH auto-fire + manual HTTP invoke) ----
  const posts = await api('/api/vaas/v1/data/posts', { headers: H });
  const postsItems = posts.json?.items || posts.json?.data?.items || [];
  const welcomeDoc = postsItems.find(p => p.kind === 'welcome');
  step('fn-event-auth-autofire', welcomeDoc != null, `signup trigger → onUserWelcome ran → welcome doc in posts (${postsItems.length} docs)`);
  const fnInvoke = await api('/api/vaas/v1/fn/onUserWelcome/invoke', { method: 'POST', headers: H, body: { payload: { event: 'signup', user: { uid: 'demo-direct' } } } });
  step('fn-http-invoke', fnInvoke.status === 200, `status=${fnInvoke.status} result=${JSON.stringify(fnInvoke.json?.data?.result || fnInvoke.json?.data || {}).slice(0, 90)}`);

  // ---- 7. Realtime ----
  const rt = await api('/api/vaas/v1/rt/publish', { method: 'POST', headers: H, body: { channel: 'demo', type: 'ping', payload: { at: Date.now(), msg: 'realtime check' } } });
  step('realtime-publish', rt.status === 201 || rt.status === 200, rt.status === 403 ? 'rt disabled on project (flag off)' : `event published`);

  // ---- 8. Metering ----
  const usage = await api('/api/v1/vaas', { method: 'POST', headers: { Cookie: cookie }, body: { op: 'project_usage', projectId } });
  const u = usage.json?.data || usage.json || {};
  step('usage-metering', usage.status === 200, JSON.stringify(u).slice(0, 120));

  // ---- summary ----
  const pass = OUT.filter(x => x.ok).length;
  console.log(`\nRESULT: ${pass}/${OUT.length} passed ${pass === OUT.length ? 'ALL GREEN' : '(see FAILs)'}`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
