#!/usr/bin/env node
/**
 * Final integration E2E:
 *  1. Deploy the VORTEX WEBSITE hub (the zip's static site) through its OWN
 *     pipeline (dogfooding) → served at /sites/vortex-hub
 *  2. Verify the CloudAgent .env APPVERSE key path (the exact calls
 *     publishAppToAppverse makes) with a small dummy binary
 */
const fs = require('fs');
const path = require('path');

const VS = 'http://127.0.0.1:3200';
const env = Object.fromEntries(fs.readFileSync('/home/z/my-project/.env', 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
let pass = 0, fail = 0;
const ok = (n, x) => { pass++; console.log(`  + ${n}${x ? ` - ${x}` : ''}`); };
const bad = (n, x) => { fail++; console.log(`  x ${n}${x ? ` - ${x}` : ''}`); };

async function vxApi(p, body, key, method = 'POST') {
  const res = await fetch(VS + p, { method, headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, j };
}

(async () => {
  // ---------- 1. hub deploy ----------
  const hubDir = '/home/z/my-project/vortex-platform/website/vortex-website';
  const files = [];
  const walk = (dir, base = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (base === '' && ['.git', 'node_modules'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walk(full, rel);
      else files.push({ path: rel, buf: fs.readFileSync(full) });
    }
  };
  walk(hubDir);
  const idx = files.find(f => f.path === 'index.html');
  idx ? ok('hub files collected', `${files.length} files, ${files.length ? (files.reduce((a, f) => a + f.buf.length, 0) / 1024).toFixed(0) + 'KB' : ''}`) : bad('hub files', 'index.html missing');

  // login as owner to create the hub site under the owner identity? Platform key suffices.
  const list = await vxApi('/api/v1/vortex-website/sites', undefined, env.VORTEX_WEBSITE_KEY, 'GET');
  let siteId = list.j?.data?.sites?.find(s => s.subdomain?.startsWith('vortex-hub'))?.siteId;
  if (!siteId) {
    const created = await vxApi('/api/v1/vortex-website/sites', { name: 'VORTEX Hub', subdomain: 'vortex-hub', ownerEmail: 'owner@vortex.local' }, env.VORTEX_WEBSITE_KEY);
    siteId = created.j?.data?.siteId;
    created.j?.ok ? ok('hub site created', siteId) : bad('hub site created', JSON.stringify(created.j).slice(0, 100));
  } else ok('hub site reused', siteId);

  const up = await vxApi(`/api/v1/vortex-website/sites/${siteId}/files`, { files: files.map(f => ({ path: f.path, contentB64: f.buf.toString('base64') })) }, env.VORTEX_WEBSITE_KEY);
  up.j?.ok ? ok('hub files uploaded', `${up.j.data?.accepted} accepted`) : bad('hub files upload', JSON.stringify(up.j).slice(0, 100));

  const dep = await vxApi(`/api/v1/vortex-website/sites/${siteId}/deploy`, {}, env.VORTEX_WEBSITE_KEY);
  dep.j?.ok ? ok('hub deployed', `v${dep.j.data?.version} → ${dep.j.data?.url}`) : bad('hub deploy', JSON.stringify(dep.j).slice(0, 150));

  // fetch the hub through the public site server
  const hubRes = await fetch(`${VS}/sites/vortex-hub`);
  const hubHtml = await hubRes.text();
  hubRes.status === 200 && hubHtml.includes('<!DOCTYPE') ? ok('hub LIVE at /sites/vortex-hub', `${(hubHtml.length / 1024).toFixed(0)}KB, status ${hubRes.status}`) : bad('hub live', `status ${hubRes.status}`);

  // ---------- 2. appverse key path (same calls as publishAppToAppverse) ----------
  const appName = `CloudAgent E2E ${Date.now().toString(36)}`;
  const pkg = `com.cloudagent.e2e${Date.now().toString(36).slice(-6)}`;
  const apps = await vxApi('/api/v1/appverse/apps', undefined, env.VORTEX_APPVERSE_KEY, 'GET');
  apps.j?.ok ? ok('appverse apps list (env key works)', `${apps.j.data?.apps?.length} apps`) : bad('appverse list', JSON.stringify(apps.j).slice(0, 100));
  const created = await vxApi('/api/v1/appverse/apps', { name: appName, packageName: pkg, category: 'general', description: 'integration E2E' }, env.VORTEX_APPVERSE_KEY);
  const appId = created.j?.data?.appId;
  created.j?.ok ? ok('appverse app created', appId) : bad('appverse create', JSON.stringify(created.j).slice(0, 100));
  const dummyApk = Buffer.from(`PK\x03\x04 dummy apk for integration e2e ${Date.now()}`.repeat(64));
  const ver = await vxApi(`/api/v1/appverse/apps/${appId}/versions`, { version: '1.0.0', kind: 'APK', contentB64: dummyApk.toString('base64'), changelog: 'integration test' }, env.VORTEX_APPVERSE_KEY);
  ver.j?.ok && ver.j.data?.status === 'PENDING' ? ok('appverse version uploaded → PENDING review', `sha=${String(ver.j.data?.sha256).slice(0, 10)}…`) : bad('appverse version', JSON.stringify(ver.j).slice(0, 120));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
