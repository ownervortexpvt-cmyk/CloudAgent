#!/usr/bin/env node
/**
 * VORTEX VAAS v2 — BEYOND-Firebase capability test (v147 features).
 * Plays the REAL browser side of Web Push end-to-end:
 *   1. vapid-public        → applicationServerKey fetch (unauthenticated)
 *   2. sw.js               → drop-in service worker served unauthenticated
 *   3. register            → real subscription JSON (client-generated P-256 keys)
 *   4. send                → server encrypts (RFC 8291) + signs VAPID (RFC 8290)
 *   5. local receiver      → catches the actual encrypted POST
 *   6. client-side DECRYPT → ECDH + HKDF + AES-GCM → title/body must survive
 *   7. prune               → 410 endpoint → token auto-deleted
 *   8. query operators     → gte / ne / in (Firestore-grade)
 *   9. batch rollback      → failed batch leaves NO partial writes
 *  10. sse stream          → live event received on rt/stream
 *  11. scheduled tick      → /tick endpoint answers with the tick secret
 * Keys are never printed in full (tails only).
 */
const BASE = 'http://127.0.0.1:3200';
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const mask = (k) => (k ? k.slice(0, 8) + '…' + k.slice(-4) : '');
const OUT = [];
function step(name, ok, detail = '') { OUT.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); }

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

// ---- local push receiver (acts as the "push service") ----
const RECEIVED = [];
const EXPIRE_PATHS = new Set();
const receiver = http.createServer((rq, rs) => {
  const chunks = [];
  rq.on('data', (c) => chunks.push(c));
  rq.on('end', () => {
    RECEIVED.push({ url: rq.url, headers: rq.headers, body: Buffer.concat(chunks) });
    rs.writeHead(EXPIRE_PATHS.has(rq.url) ? 410 : 201, { 'x-receiver': 'vx-test' });
    rs.end('');
  });
});

(async () => {
  // 0. admin session
  const login = await api('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@vortex.local', password: 'Vortex@2026' } });
  if (!login.json?.ok) throw new Error('admin login failed');
  const otp = await api('/api/v1/auth/otp', { method: 'POST', body: { email: 'admin@vortex.local', code: login.json.data.devCode } });
  const cookie = (otp.headers.get('set-cookie') || '').match(/vortex_session=[^;]+/)?.[0] || '';
  if (!cookie) throw new Error('no admin session cookie');

  // 1. provision fresh project (fresh throwaway developer per run)
  // v150 root-fix: repeated runs filled the shared nexa developer's project
  // quota (vaas.max_projects_per_dev=10) → FATAL "Developer project quota
  // reached (10)". Both parity suites now create a throwaway developer per
  // run (baas-e2e's proven pattern) so the admin dev stays clean.
  const stamp = Date.now().toString(36);
  const devRes = await api('/api/v1/vaas', { method: 'POST', headers: { Cookie: cookie }, body: {
    op: 'create_developer', email: `vxpv2-${stamp}@test.local`, password: `e2e-${stamp}-x7K9mQ2p`, name: 'parity-v2 e2e',
  } });
  if (!devRes.json?.ok) throw new Error('create_developer failed: ' + JSON.stringify(devRes.json).slice(0, 200));
  const devId = devRes.json.data?.devId || devRes.json.devId || '';
  if (!devId) throw new Error('no devId from create_developer');
  const prov = await api('/api/v1/vaas', { method: 'POST', headers: { Cookie: cookie }, body: {
    op: 'provision_project', devId, name: 'Beyond-Firebase v147',
    collections: [ { name: 'todos', read: 'public', write: 'public' }, { name: 'notes', read: 'public', write: 'auth' } ],
  } });
  if (!prov.json?.ok) throw new Error('provision failed: http=' + prov.status + ' ' + JSON.stringify(prov.json).slice(0, 200));
  const d = prov.json.data || {};
  const adminKey = d.adminKey || d.keys?.admin || '';
  const clientKey = d.clientKey || d.keys?.client || '';
  const projectId = d.projectId || '';
  step('provision', !!(adminKey && clientKey && projectId), `projectId=${projectId} adminKey=${mask(adminKey)}`);
  const HA = { 'x-vx-key': adminKey };
  const HC = { 'x-vx-key': clientKey };

  // ---- 2. vapid-public (unauthenticated) ----
  await new Promise((r) => receiver.listen(3999, '127.0.0.1', r));
  const vp = await api(`/api/vaas/v1/push/vapid-public?projectId=${encodeURIComponent(projectId)}`);
  const vapidPub = vp.json?.publicKey || '';
  step('vapid-public', vp.status === 200 && /^[A-Za-z0-9_-]{80,120}$/.test(vapidPub), `len=${vapidPub.length}`);

  // ---- 3. sw.js (unauthenticated, JS served) ----
  const sw = await fetch(BASE + '/api/vaas/v1/push/sw.js');
  const swText = await sw.text();
  step('sw.js', sw.status === 200 && swText.includes("addEventListener('push'") && (sw.headers.get('content-type') || '').includes('javascript'), `${swText.length}B ${sw.headers.get('content-type') || ''}`);

  // ---- 4. register a REAL subscription (client plays browser) ----
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const clientPubRaw = ecdh.getPublicKey();
  const authSecret = crypto.randomBytes(16);
  const subscription = { endpoint: 'http://127.0.0.1:3999/push/inbox-1', keys: { p256dh: b64u(clientPubRaw), auth: b64u(authSecret) } };
  const reg = await api('/api/vaas/v1/push/register', { method: 'POST', headers: HC, body: { token: JSON.stringify(subscription), platform: 'web-push' } });
  const regData = reg.json?.data || reg.json || {};
  step('push-register(web-push)', reg.status === 201 && regData.platform === 'web-push', `platform=${regData.platform}`);

  // ---- 5. send → real protocol delivery ----
  const send1 = await api('/api/vaas/v1/push/send', { method: 'POST', headers: HA, body: { title: 'VORTEX beats FCM', body: 'self-hosted, standard protocol, zero Google', data: { url: '/inbox' } } });
  const got1 = RECEIVED.find((r) => r.url === '/push/inbox-1');
  const s1 = send1.json?.data || send1.json || {};
  const sentOk = send1.status === 200 && s1.delivered >= 1;
  step('push-send(real)', sentOk && !!got1, `delivered=${s1.delivered} transport=${s1.transport || '?'}`);
  step('push-vapid-header', !!got1 && /^vapid t=[^,]+, k=/.test(got1.headers['authorization'] || '') && got1.headers['content-encoding'] === 'aes128gcm', got1 ? `auth=${(got1.headers['authorization'] || '').slice(0, 24)}…` : 'no request captured');

  // ---- 6. CLIENT-SIDE DECRYPT — the protocol proof ----
  let decrypted = null, decryptErr = '';
  try {
    if (got1) {
      const body = got1.body;
      const salt = body.subarray(0, 16);
      const rs = body.readUInt32BE(16);
      const idlen = body[20];
      const keyid = body.subarray(21, 21 + idlen);
      const serverPubRaw = fromB64u(keyid.toString('utf8'));
      const ct = body.subarray(21 + idlen);
      const shared = ecdh.computeSecret(serverPubRaw);
      const info = Buffer.concat([Buffer.from('WebPush: info\u0000'), clientPubRaw, serverPubRaw]);
      const prk = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, info, 32));
      const cek = Buffer.from(crypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: aes128gcm\u0000'), 16));
      const nonce = Buffer.from(crypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: nonce\u0000'), 12));
      const tag = ct.subarray(ct.length - 16);
      const data = ct.subarray(0, ct.length - 16);
      const dec = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
      dec.setAuthTag(tag);
      const plain = Buffer.concat([dec.update(data), dec.final()]);
      const payload = JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
      decrypted = payload;
    }
  } catch (e) { decryptErr = e.message; }
  step('payload-decrypt(rfc8291)', !!decrypted && decrypted.title === 'VORTEX beats FCM' && decrypted.body === 'self-hosted, standard protocol, zero Google', decryptErr || `title="${decrypted?.title}"`);
  step('rs-header(rfc8188)', !!got1 && got1.body.readUInt32BE(16) === 4096, `rs=${got1 ? got1.body.readUInt32BE(16) : '?'}`);

  // ---- 7. auto-prune on 410/404 ----
  const ecdh2 = crypto.createECDH('prime256v1'); ecdh2.generateKeys();
  const sub2 = { endpoint: 'http://127.0.0.1:3999/expire/gone', keys: { p256dh: b64u(ecdh2.getPublicKey()), auth: b64u(crypto.randomBytes(16)) } };
  EXPIRE_PATHS.add('/expire/gone');
  await api('/api/vaas/v1/push/register', { method: 'POST', headers: HC, body: { token: JSON.stringify(sub2), platform: 'web-push' } });
  const send2 = await api('/api/vaas/v1/push/send', { method: 'POST', headers: HA, body: { title: 'prune test', body: 'x' } });
  const s2 = send2.json?.data || send2.json || {};
  step('push-prune(410→deleted)', send2.status === 200 && s2.pruned >= 1, `pruned=${s2.pruned}`);

  // ---- 8. Firestore-grade query operators ----
  await api('/api/vaas/v1/data/todos', { method: 'POST', headers: HC, body: { data: { title: 'low', priority: 1, done: false, tag: 'a' } } });
  await api('/api/vaas/v1/data/todos', { method: 'POST', headers: HC, body: { data: { title: 'mid', priority: 2, done: false, tag: 'b' } } });
  await api('/api/vaas/v1/data/todos', { method: 'POST', headers: HC, body: { data: { title: 'high', priority: 3, done: true, tag: 'c' } } });
  const q1 = await api('/api/vaas/v1/data/todos?where=' + encodeURIComponent(JSON.stringify({ priority: { gte: 2 } })), { headers: HC });
  const q2 = await api('/api/vaas/v1/data/todos?where=' + encodeURIComponent(JSON.stringify({ done: { ne: true }, priority: { lt: 3 } })), { headers: HC });
  const q3 = await api('/api/vaas/v1/data/todos?where=' + encodeURIComponent(JSON.stringify({ tag: { in: ['a', 'c'] } })), { headers: HC });
  const titles = (r) => (r.json?.items || r.json?.data?.items || []).map((x) => x.title).sort().join(',');
  step('query-gte', q1.status === 200 && titles(q1) === 'high,mid', `items=${titles(q1)}`);
  step('query-ne+lt(compound)', q2.status === 200 && titles(q2) === 'low,mid', `items=${titles(q2)}`);
  step('query-in', q3.status === 200 && titles(q3) === 'high,low', `items=${titles(q3)}`);

  // ---- 9. batch rollback (all-or-nothing) ----
  const before = await api('/api/vaas/v1/data/todos?limit=100', { headers: HC });
  const nBefore = (before.json?.items || before.json?.data?.items || []).length;
  const badBatch = await api('/api/vaas/v1/data/batch', { method: 'POST', headers: HC, body: { ops: [
    { op: 'add', collection: 'todos', data: { title: 'should-rollback', priority: 9 } },
    { op: 'delete', collection: 'todos', docId: 'vxd_doesnotexist' },
  ] } });
  const after = await api('/api/vaas/v1/data/todos?limit=100', { headers: HC });
  const nAfter = (after.json?.items || after.json?.data?.items || []).length;
  step('batch-atomic-rollback', badBatch.status >= 400 && nAfter === nBefore, `http=${badBatch.status} docs ${nBefore}→${nAfter}`);

  // ---- 10. SSE stream receives a live event ----
  const sseGot = await (async () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(BASE + '/api/vaas/v1/rt/stream?channel=test', { headers: HC, signal: ctl.signal });
      const reader = res.body.getReader();
      const publishPromise = api('/api/vaas/v1/rt/publish', { method: 'POST', headers: HC, body: { channel: 'test', type: 'ping', payload: { hello: 'vortex' } } });
      let buf = '', found = false;
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline && !found) {
        const chunk = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({}), 1500))]);
        if (!chunk || chunk.done) break;
        buf += new TextDecoder().decode(chunk.value || new Uint8Array());
        if (buf.includes('ping') && buf.includes('vortex')) found = true;
      }
      ctl.abort();
      await publishPromise.catch(() => {});
      return found;
    } catch { return false; } finally { clearTimeout(timer); }
  })();
  step('sse-stream-live', sseGot, 'event received on rt/stream');

  // ---- 11. scheduled-functions tick (localhost + secret) ----
  const secret = fs.readFileSync('/home/z/my-project/vortex-platform/server/VORTEX_SERVER/.tick-secret', 'utf8').trim();
  const tick = await api('/api/vaas/v1/tick', { headers: { 'x-vx-tick': secret } });
  step('scheduled-tick', tick.status === 200 && tick.json?.ok !== false, `http=${tick.status}`);

  receiver.close();
  const fails = OUT.filter((r) => !r.ok).length;
  console.log(`\nRESULT: ${OUT.length - fails}/${OUT.length} passed ${fails ? '' : 'ALL GREEN'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); try { receiver.close(); } catch {} process.exit(1); });
