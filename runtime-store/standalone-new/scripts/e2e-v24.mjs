#!/usr/bin/env node
/**
 * E2E — v24 ULTRA PACK (on the LIVE server, lock included):
 *  1. lock: setup → 401 while locked → unlock → 200
 *  2. templates: list (10 ready-made apps) → create project from app-ecommerce
 *  3. files on disk (ShopLite storefront)
 *  4. analytics: beacon hits → aggregate
 *  5. analytics_setup tool → beacon present in HTML on disk
 *  6. payment/push/database tools → real files on disk
 *  7. security scan: planted findings detected → score drops
 *  8. PWA setup: manifest + service worker + 192/512 icons + meta tags
 *  9. versions: snapshot → modify → restore (content reverted)
 * 10. APK publish on a static project → honest structured error
 * 11. ASO listing (AI) — attempted, non-fatal on AI/network failure
 * 12. Asset generation (AI image) — attempted, non-fatal on failure
 * 13. cleanup: test project removed from DB + disk
 */
const BASE = 'http://127.0.0.1:3000'
let cookie = ''
let pass = 0, fail = 0
const ok = (b, name) => { if (b) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}`) } }

async function req(method, path, body, useCookie = true) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(useCookie && cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie && setCookie.includes('ca_lock=')) {
    cookie = setCookie.split(';')[0]
  }
  let data = null
  try { data = await res.json() } catch { /* non-json */ }
  return { status: res.status, data }
}

console.log('── 1. LOCK ─────────────────────────────────────')
{
  const anon = await req('GET', '/api/projects', null, false)
  ok(anon.status === 401, `locked without cookie (401, got ${anon.status})`)
  const cfg = await req('POST', '/api/lock', { action: 'setup', pin: 'e2e-temp-9981' }, false)
  if (cfg.status === 400) {
    // already configured — unlock with the temp pin from a previous run, else reset via unlock attempt
    const unl = await req('POST', '/api/lock', { action: 'unlock', pin: 'e2e-temp-9981' }, false)
    ok(unl.status === 200, 'unlock with existing E2E pin')
  } else {
    ok(cfg.status === 200, 'lock setup (first run)')
  }
  const after = await req('GET', '/api/projects')
  ok(after.status === 200, `unlocked access (200, got ${after.status})`)
}

let projectId = ''
console.log('── 2-3. TEMPLATES + FILES ──────────────────────')
{
  const list = await req('GET', '/api/templates')
  const tpls = list.data?.templates || []
  const apps = tpls.filter(t => t.kind === 'app')
  ok(list.status === 200 && apps.length >= 10, `template list: ${tpls.length} total, ${apps.length} ready-made apps`)
  const created = await req('POST', '/api/templates', { templateId: 'app-ecommerce', name: `E2E Shop ${Date.now() % 100000}` })
  projectId = created.data?.project?.id || ''
  ok(!!projectId, `project created from template (id=${projectId.slice(0, 8)}…)`)
  if (projectId) {
    const fs = await import('fs')
    const idx = fs.readFileSync(`/home/z/my-project/projects/${projectId}/index.html`, 'utf8')
    ok(idx.includes('ShopLite') && idx.includes('Wireless Headphones'), 'storefront HTML on disk with real products')
  }
}

console.log('── 4-5. ANALYTICS ──────────────────────────────')
{
  if (projectId) {
    for (const p of ['/', '/product/1']) {
      await fetch(BASE + '/api/analytics/hit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p: projectId, path: p, r: 'https://google.com' }) })
    }
    const agg = await req('GET', `/api/analytics?projectId=${projectId}&days=7`)
    ok(agg.data?.totalViews >= 2, `aggregate counts hits (${agg.data?.totalViews})`)
    ok((agg.data?.referrers || []).some(r => r.name === 'google.com'), 'referrer captured')
    const ana = await req('POST', '/api/growth-tools', { projectId, tool: 'analytics_setup', args: {} })
    ok(ana.data?.ok === true, 'analytics_setup tool ran')
    const fs = await import('fs')
    const idx = fs.readFileSync(`/home/z/my-project/projects/${projectId}/index.html`, 'utf8')
    ok(idx.includes('data-ca-analytics="1"') && idx.includes(projectId), 'beacon injected into index.html on disk')
  }
}

console.log('── 6. PAYMENT / PUSH / DATABASE TOOLS ──────────')
{
  if (projectId) {
    const pay = await req('POST', '/api/growth-tools', { projectId, tool: 'payment_setup', args: { product: 'Pro Plan', amount: 9.99 } })
    ok(pay.data?.ok === true, 'payment_setup ran (demo mode)')
    const push = await req('POST', '/api/growth-tools', { projectId, tool: 'push_notification_setup', args: { appTitle: 'ShopLite' } })
    ok(push.data?.ok === true, 'push_notification_setup ran')
    const dbt = await req('POST', '/api/growth-tools', { projectId, tool: 'database_builder', args: { table: 'orders', fields: ['name', 'email', 'plan'] } })
    ok(dbt.data?.ok === true, 'database_builder ran')
    const fs = await import('fs')
    const root = `/home/z/my-project/projects/${projectId}`
    ok(fs.existsSync(`${root}/checkout.html`) && fs.readFileSync(`${root}/checkout.html`, 'utf8').includes('Demo mode'), 'checkout.html (demo) on disk')
    ok(fs.existsSync(`${root}/push-sw.js`) && fs.existsSync(`${root}/notifications.html`), 'push scaffolding on disk')
    const dblayer = fs.readFileSync(`${root}/orders.db.js`, 'utf8')
    ok(dblayer.includes("DB_KEY = 'db_orders'") && dblayer.includes('insert('), 'orders.db.js data layer on disk')
    const admin = fs.readFileSync(`${root}/orders-admin.html`, 'utf8')
    ok(admin.includes("DB['orders']") && admin.includes('r.name'), 'orders-admin.html renders fields correctly')
  }
}

console.log('── 7. SECURITY SCAN ────────────────────────────')
{
  if (projectId) {
    const fs = await import('fs')
    fs.writeFileSync(`/home/z/my-project/projects/${projectId}/evil.js`, `const key = "sk-abcdefghijklmnop1234567890";\nconst cfg = "AKIAIOSFODNN7EXAMPLE";\neval(userInput);\ndocument.write(html);`)
    const scan = await req('POST', '/api/security-scan', { projectId })
    const ids = (scan.data?.findings || []).map(f => f.id)
    ok(scan.data?.score < 100, `score dropped (${scan.data?.score}/100)`)
    ok(ids.includes('secret-openai'), 'planted OpenAI-style key detected')
    ok(ids.includes('secret-aws'), 'planted AWS key detected')
    ok(ids.includes('eval'), 'eval() detected')
    ok(ids.includes('doc-write'), 'document.write detected')
    fs.unlinkSync(`/home/z/my-project/projects/${projectId}/evil.js`)
  }
}

console.log('── 8. PWA + SEO ────────────────────────────────')
{
  if (projectId) {
    const pwa = await req('POST', '/api/pwa-setup', { projectId })
    ok(pwa.data?.ok === true, 'pwa_seo_setup ran')
    const fs = await import('fs')
    const root = `/home/z/my-project/projects/${projectId}`
    ok(fs.existsSync(`${root}/manifest.webmanifest`), 'manifest.webmanifest written')
    ok(fs.existsSync(`${root}/sw.js`), 'service worker written')
    ok(fs.existsSync(`${root}/assets/icons/icon-192.png`) && fs.existsSync(`${root}/assets/icons/icon-512.png`), 'real 192/512px icons generated (sharp)')
    const idx = fs.readFileSync(`${root}/index.html`, 'utf8')
    ok(idx.includes('rel="manifest"') && idx.includes('og:title'), 'meta + OG tags injected')
  }
}

console.log('── 9. VERSIONS ─────────────────────────────────')
{
  if (projectId) {
    const fs = await import('fs')
    const p = `/home/z/my-project/projects/${projectId}/index.html`
    const snap = await req('POST', '/api/versions', { projectId, action: 'snapshot', label: 'e2e restore point' })
    ok(snap.data?.ok === true, `snapshot created (${snap.data?.snapshot?.fileCount} files)`)
    const before = fs.readFileSync(p, 'utf8')
    fs.writeFileSync(p, before + '\n<!-- MODIFIED AFTER SNAPSHOT -->')
    const list = await req('GET', `/api/versions?projectId=${projectId}`)
    const newest = (list.data?.versions || [])[0]
    const restored = await req('POST', '/api/versions', { projectId, action: 'restore', id: newest?.id })
    ok(restored.data?.ok === true, 'restore ran')
    const afterContent = fs.readFileSync(p, 'utf8')
    ok(!afterContent.includes('MODIFIED AFTER SNAPSHOT'), 'time-travel: content reverted to snapshot')
  }
}

console.log('── 10. APK (honest error path) ─────────────────')
{
  if (projectId) {
    const apk = await req('POST', '/api/publish', { projectId, target: 'apk' })
    ok(apk.status === 200 && apk.data?.ok === false && (apk.data?.error || '').length > 0, `honest structured response (${JSON.stringify(apk.data?.error || apk.data?.ok).slice(0, 60)})`)
  }
}

console.log('── 11-12. AI FEATURES (non-fatal) ──────────────')
{
  if (projectId) {
    const aso = await req('POST', '/api/aso-listing', { projectId })
    ok(aso.data?.ok === true, `ASO listing generated (${aso.data?.error || 'STORE_LISTING.md written'})`)
    const asset = await req('POST', '/api/assets/generate', { projectId, prompt: 'minimal shopping bag logo, flat, emerald green on dark navy', kind: 'logo' })
    ok(asset.data?.ok === true, `AI asset generated (${asset.data?.error || 'assets/logo-*.png'})`)
    const fs = await import('fs')
    if (aso.data?.ok) ok(fs.existsSync(`/home/z/my-project/projects/${projectId}/STORE_LISTING.md`), 'STORE_LISTING.md on disk')
    if (asset.data?.ok) {
      const files = fs.readdirSync(`/home/z/my-project/projects/${projectId}/assets`).filter(f => f.startsWith('logo-'))
      ok(files.length > 0, `AI PNG on disk: ${files.join(', ')}`)
    }
  }
}

console.log('── 13. CLEANUP ─────────────────────────────────')
{
  if (projectId) {
    const del = await req('DELETE', `/api/projects/${projectId}`)
    ok(del.status === 200 || del.status === 204, `test project deleted (${del.status})`)
    const fs = await import('fs')
    ok(!fs.existsSync(`/home/z/my-project/projects/${projectId}`), 'project files removed from disk')
  }
}

console.log('────────────────────────────────────────────────')
console.log(`RESULT: ${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
