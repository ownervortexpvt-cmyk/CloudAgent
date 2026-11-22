#!/usr/bin/env node
/**
 * VORTEX ECOSYSTEM — full end-to-end publish test (mirrors CloudAgent exactly).
 * Uses the REAL platform keys from CloudAgent .env (never printed).
 * Flow: create site → upload files → deploy → fetch from /sites/ (public) → verify.
 * Also validates the Joy S3 data plane (provider=joy) via the deployed bytes.
 */
const fs = require('fs');

const BASE = 'http://127.0.0.1:3200';
function envKey(name) {
  const line = fs.readFileSync('/home/z/my-project/.env', 'utf8').split('\n').find(l => l.startsWith(name + '='));
  return line ? line.slice(name.length + 1).trim() : '';
}
const WEB_KEY = envKey('VORTEX_WEBSITE_KEY');
const APPVERSE_KEY = envKey('VORTEX_APPVERSE_KEY');
const CA_KEY = envKey('VORTEX_PLATFORM_KEY');

async function api(path, { method = 'GET', key, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

(async () => {
  const R = [];
  const step = (name, ok, detail = '') => { R.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

  if (!WEB_KEY) { console.log('FATAL: VORTEX_WEBSITE_KEY missing from .env'); process.exit(1); }

  const stamp = Date.now().toString(36);
  const siteName = `CloudAgent E2E ${stamp}`;
  const sub = `cloudagent-e2e-${stamp}`;

  // 1. create site
  const created = await api('/api/v1/vortex-website/sites', { method: 'POST', key: WEB_KEY, body: { name: siteName, subdomain: sub, ownerEmail: 'cloud-agent@vortex.local' } });
  const siteId = created.json?.data?.siteId;
  step('site-create', Boolean(siteId), `siteId=${siteId || JSON.stringify(created.json).slice(0, 100)}`);

  // 2. upload files (index.html + style.css) — goes through vsPutObject → joyData.put (Joy S3)
  const indexHtml = `<!doctype html><html><head><meta charset="utf-8"><title>E2E ${stamp}</title><link rel="stylesheet" href="style.css"></head><body><h1 id="m">joy-e2e-${stamp}</h1></body></html>`;
  const styleCss = `body{background:#0a0a14;color:#7dd3fc}h1{font-family:monospace}`;
  const up = await api(`/api/v1/vortex-website/sites/${siteId}/files`, { method: 'POST', key: WEB_KEY, body: {
    files: [
      { path: 'index.html', contentB64: Buffer.from(indexHtml).toString('base64') },
      { path: 'style.css', contentB64: Buffer.from(styleCss).toString('base64') },
    ],
  } });
  step('files-upload-joy-s3', up.status === 200 || up.status === 201, JSON.stringify(up.json?.data || up.json).slice(0, 140));

  // 3. deploy (versioned)
  const dep = await api(`/api/v1/vortex-website/sites/${siteId}/deploy`, { method: 'POST', key: WEB_KEY, body: {} });
  const version = dep.json?.data?.version;
  const url = dep.json?.data?.url;
  step('deploy-versioned', dep.status === 200 || dep.status === 201, `v${version} url=${url || JSON.stringify(dep.json).slice(0, 120)}`);

  // 4. public fetch — /sites/<sub>/index.html (vsGetObject → Joy S3 get path)
  const pub = await fetch(`${BASE}/sites/${sub}/`, { signal: AbortSignal.timeout(60_000) });
  const pubBody = await pub.text();
  step('public-serve-index', pub.status === 200 && pubBody.includes(`joy-e2e-${stamp}`), `HTTP ${pub.status}, ${pubBody.length}B, marker=${pubBody.includes(`joy-e2e-${stamp}`)}`);

  // 5. public fetch — css asset
  const pubCss = await fetch(`${BASE}/sites/${sub}/style.css`, { signal: AbortSignal.timeout(60_000) });
  const cssBody = await pubCss.text();
  step('public-serve-css', pubCss.status === 200 && cssBody.includes('#0a0a14'), `HTTP ${pubCss.status}, ${cssBody.length}B`);

  // 6. content-type correctness
  const ct = pub.headers.get('content-type') || '';
  step('mime-text-html', ct.includes('text/html'), ct);

  // 7. APPVERSE — register app + version (with a tiny fake APK payload; real APK build test happens via CloudAgent publish)
  if (APPVERSE_KEY) {
    const pkg = `com.cloudagent.e2e.${stamp}`;
    const avCreated = await api('/api/v1/appverse/apps', { method: 'POST', key: APPVERSE_KEY, body: { name: `E2E ${stamp}`, packageName: pkg, category: 'general', description: 'CloudAgent e2e' } });
    const appId = avCreated.json?.data?.appId;
    step('appverse-app-create', Boolean(appId), `appId=${appId || JSON.stringify(avCreated.json).slice(0, 100)}`);
    if (appId) {
      const fakeApk = Buffer.alloc(2048, 7); // real pipeline test comes from flutter build
      const avVer = await api(`/api/v1/appverse/apps/${appId}/versions`, { method: 'POST', key: APPVERSE_KEY, timeout: 300_000, body: { version: '1.0.0', kind: 'APK', contentB64: fakeApk.toString('base64'), changelog: 'e2e' } });
      step('appverse-version-upload', avVer.status === 200 || avVer.status === 201, `status=${avVer.json?.data?.status || JSON.stringify(avVer.json).slice(0, 100)}`);
    }
  }

  // 8. cloud-agent namespace — projects list (key exchange sanity)
  if (CA_KEY) {
    const ov = await api('/api/v1/cloud-agent/projects', { key: CA_KEY });
    step('cloud-agent-key-auth', ov.status === 200 && ov.json?.ok === true, `HTTP ${ov.status} ${JSON.stringify(ov.json).slice(0, 100)}`);
  }

  const fails = R.filter(r => !r.ok).length;
  console.log(`\nRESULT: ${R.length - fails}/${R.length} passed ${fails ? '' : 'ALL GREEN'}`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
