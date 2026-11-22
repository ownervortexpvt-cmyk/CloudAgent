#!/usr/bin/env node
/**
 * END-TO-END JOY STORAGE TEST via VORTEX SERVER (:3200) — v150 rewrite.
 *
 * Root-fix note: the previous version hit console bucket-CRUD paths
 * (/api/v1/storage/buckets/...) that never existed as routes in this repo
 * (git history proof) — the suite was testing a fictional API. The REAL Joy
 * object plane is provider-routed through vsPutObject/vsGetObject:
 *   vortex-website draft upload → joyData.put (SigV4, lazy bucket)
 *   deploy (draft→vN + manifest) → Joy S3
 *   signed download redemption   → joyData.get (SigV4)
 *   /sites/<subdomain>/ serving  → vsGetObject
 * This suite now exercises exactly those surfaces end-to-end.
 *
 * login -> OTP -> session -> provider truth-check -> site create ->
 * object PUT (Joy, lazy bucket) -> deploy (v1+manifest to Joy) ->
 * signed GET (bytes verified) -> public serve (bytes verified).
 * Prints PASS/FAIL steps only. Secrets never printed.
 */
const BASE = 'http://127.0.0.1:3200';
let cookie = '';
const R = [];
const step = (n, ok, d = '') => { R.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
const STAMP = Date.now().toString(36);

async function api(path, opts = {}, useCookie = true, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(useCookie && cookie ? { Cookie: cookie } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeout || 120_000),
      });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
      const sc = res.headers.get('set-cookie') || '';
      const m = sc.match(/vortex_session=[^;]+/); if (m) cookie = m[0];
      return { status: res.status, json };
    } catch (e) {
      if (attempt === retries) return { status: 0, json: { error: String(e.message) } };
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

(async () => {
  // 1-2. console auth (dev code comes back in the mail-log path the server exposes)
  const login = await api('/api/v1/auth/login', { method: 'POST', body: { email: 'admin@vortex.local', password: 'Vortex@2026' } }, false);
  const code = login.json?.devCode || login.json?.code || login.json?.data?.devCode || '';
  step('login+devCode', login.status === 200 && Boolean(code), `code=${code ? String(code).slice(0, 2) + '****' : 'missing'}`);

  const otp = await api('/api/v1/auth/otp', { method: 'POST', body: { email: 'admin@vortex.local', code } }, false);
  step('otp-session', otp.status === 200 && cookie.includes('vortex_session='), `cookie=${cookie ? cookie.slice(0, 22) + '…' : 'none'}`);

  // 3. provider truth-check — Joy S3 SigV4 configured AND live (envelope: {ok,data})
  const st = await api('/api/v1/admin/storage');
  const pool = st.json?.data?.provider || st.json?.provider || {};
  step('storage-provider-joy', st.status === 200 && pool.active === 'joy' && pool.configured === true,
    JSON.stringify({ active: pool.active, configured: pool.configured, endpoint: pool.endpoint }).slice(0, 140));

  // 4. site create (the Joy-backed product surface)
  const mk = await api('/api/v1/vortex-website/sites', { method: 'POST', body: { name: `joy-e2e-${STAMP}`, ownerEmail: 'admin@vortex.local' } });
  const mkData = mk.json?.data || mk.json || {};
  const siteId = mkData.siteId || '';
  const subdomain = (mkData.subdomain || '').replace(/\.vortex\.site$/, '');
  step('site-create', mk.status === 201 && siteId && subdomain, `siteId=${siteId} sub=${subdomain}`);

  // 5. object PUT → vsPutObject → joyData.put (SigV4) — lazy-bucket on first 404
  const marker = `JOY-E2E-OK-${STAMP}`;
  const html = Buffer.from(`<!doctype html><html><body><h1 id="m">${marker}</h1></body></html>`).toString('base64');
  const up = await api(`/api/v1/vortex-website/sites/${siteId}/files`, { method: 'POST', body: { files: [{ path: 'index.html', contentB64: html }] } });
  const upData = up.json?.data || up.json || {};
  step('object-put-joy(lazy-bucket)', up.status === 201 && upData.accepted === 1, JSON.stringify(up.json).slice(0, 120));

  // 6. deploy — draft→v1 copy + manifest.json, all PUTs land on Joy S3
  const dep = await api(`/api/v1/vortex-website/sites/${siteId}/deploy`, { method: 'POST' }, true, 2);
  const depData = dep.json?.data || dep.json || {};
  step('deploy-joy-v1', dep.status === 201 && depData.status === 'SUCCESS' && depData.version === 1,
    `v=${depData.version} files=${depData.files} bytes=${depData.sizeBytes}`);

  // 7. signed download redemption — vsGetObject → Joy S3 GET, byte-level verify
  let dlOk = false, dlDetail = '';
  const dl = await api(`/api/v1/vortex-website/sites/${siteId}/download`);
  const s = dl.json?.data || dl.json || {};
  // the product returns a DIRECT presigned Joy S3 URL (https://nz.in.s3.joy.services/…)
  const target = s.url && s.url.startsWith('http') ? s.url
    : `/api/v1/admin/storage/object?bucket=${encodeURIComponent(s.bucket || '')}&key=${encodeURIComponent(s.key || '')}&exp=${s.exp || ''}&sig=${encodeURIComponent(s.sig || '')}&platform=${encodeURIComponent(s.platform || 'vortex-website')}`;
  if (dl.status === 200 && s.url) {
    const got = await fetch(target, { signal: AbortSignal.timeout(60_000) });
    const body = await got.text();
    dlOk = got.status === 200 && body.includes(marker);
    dlDetail = `http=${got.status} bytes=${body.length} host=${new URL(target).host}`;
  } else dlDetail = `download issue: ${JSON.stringify(dl.json).slice(0, 120)}`;
  step('object-get-joy(signed)', dlOk, dlDetail);

  // 8. public serve — /sites/<subdomain>/ reads back from Joy S3
  let serveOk = false, serveDetail = '';
  for (const p of [`/sites/${subdomain}/`, `/sites/${subdomain}/index.html`, `/sites/${subdomain}.vortex.site/`]) {
    try {
      const res = await fetch(BASE + p, { signal: AbortSignal.timeout(60_000) });
      const body = await res.text();
      if (res.status === 200 && body.includes(marker)) { serveOk = true; serveDetail = `http=${res.status} via=${p} bytes=${body.length}`; break; }
      serveDetail = `http=${res.status} via=${p}`;
    } catch (e) { serveDetail = String(e.message).slice(0, 80); }
  }
  step('public-serve-joy', serveOk, serveDetail);

  // cleanup — informational: no site-delete endpoint exists in the product yet
  console.log(`INFO cleanup — artifact: vortex-websites/<prefix> v1 (~${Buffer.from(html, 'base64').length}B + manifest); no site-delete API exists yet (future work)`);

  const fails = R.filter(r => !r.ok).length;
  console.log(`\nRESULT: ${R.length - fails}/${R.length} passed ${fails ? '❌' : '✅'}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
