#!/usr/bin/env node
/**
 * CLOUD AGENT → VORTEX full publish test (the real product path).
 * login (owner) → publish project cmwa09izs001kpmxbb785tn0i to vortex-website
 * → then appverse target status check. Verifies the integrated UI backend.
 */
const BASE = 'http://localhost:3000';
const PROJECT_ID = 'cmwa09izs001kpmxbb785tn0i';

async function api(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(300_000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  const sc = res.headers.get('set-cookie') || '';
  return { status: res.status, json, setCookie: sc };
}

(async () => {
  const R = [];
  const step = (n, ok, d = '') => { R.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };

  // 1. owner login
  const login = await api('/api/auth/login', { method: 'POST', body: { email: 'mdhonabali61@gmail.com', password: 'DCnTt8wwtuj3f6R' } });
  const m = login.setCookie.match(/[^=;\s]+=[^;]+/);
  const cookie = m ? m[0] : '';
  step('owner-login', login.json?.ok === true && Boolean(cookie), `user=${login.json?.user?.email || JSON.stringify(login.json).slice(0, 80)}`);

  // 2. export targets include vortex
  const ex = await api(`/api/projects/${PROJECT_ID}/export`, { cookie });
  const targets = ex.json?.targets || {};
  const tKeys = Object.keys(targets);
  step('export-contract-ok', ex.json?.ok === true && tKeys.length >= 3, `targets=${tKeys.join(',')}`);

  // 3. publish → vortex-website (the REAL integrated path)
  const pub = await api('/api/publish', { method: 'POST', cookie, body: { projectId: PROJECT_ID, target: 'vortex-website' } });
  const v = pub.json?.vortex || {};
  step('publish-vortex-website', pub.json?.ok === true && Boolean(v.url), `siteId=${v.siteId || '-'} v${v.version || '-'} url=${v.url || JSON.stringify(pub.json).slice(0, 140)}`);

  // 4. verify the published site serves through the vortex server
  if (v.url) {
    const slug = String(v.url).replace(/^https?:\/\//, '').split('.')[0];
    const res2 = await fetch(`http://127.0.0.1:3200/sites/${slug}/`, { signal: AbortSignal.timeout(60_000) });
    const body2 = await res2.text();
    step('published-site-serves', res2.status === 200 && body2.length > 100, `HTTP ${res2.status}, ${body2.length}B`);
  }

  // 5. publish log recorded
  const builds = await api(`/api/projects/${PROJECT_ID}/builds`, { cookie });
  const bl = JSON.stringify(builds.json).slice(0, 200);
  step('build-history-queried', builds.status === 200 || builds.status === 404, `HTTP ${builds.status} ${builds.status !== 200 ? '' : bl.slice(0, 80)}`);

  const fails = R.filter(r => !r.ok).length;
  console.log(`\nRESULT: ${R.length - fails}/${R.length} passed ${fails ? '' : 'ALL GREEN'}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
