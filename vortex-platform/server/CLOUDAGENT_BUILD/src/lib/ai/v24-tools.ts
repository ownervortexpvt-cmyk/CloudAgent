/**
 * Cloud Agent Tools v24 — ULTRA PACK (growth & monetization).
 *
 * Real tools the swarm/UI can call:
 *   payment_setup          Stripe-style checkout page generator (+ demo mode)
 *   push_notification_setup  web push scaffolding (SW + subscribe page + VAPID guide)
 *   database_builder       instant data layer (localStorage CRUD + admin panel)
 *   analytics_setup        injects the analytics beacon into project HTML
 *   security_scan          deterministic vulnerability scan
 *   pwa_seo_setup          manifest + service worker + icons (sharp) + meta/SEO
 *   asset_generate         AI image generation (logo/icon/hero/banner) via z-ai sdk
 *   aso_listing            AI store-listing copy (title, descriptions, keywords)
 *   version_snapshot       time-travel snapshot of the project
 */
import * as storage from '../storage'
import { safeUpsert, type ToolResult, type ProjectContext } from './tools'
import { injectAnalyticsAll } from '../analytics'
import { securityScan } from '../securityscan'
import { pwaSeoSetup } from '../pwa'
import { snapshotProject } from '../versions'

async function writeAndIndex(ctx: ProjectContext, path: string, content: string) {
  storage.writeFile(ctx.projectId, path, content)
  try {
    await safeUpsert({
      where: { projectId_path: { projectId: ctx.projectId, path } },
      create: { projectId: ctx.projectId, path, content, isDir: false },
      update: { content },
    })
  } catch { /* project may be deleted — file is safe on disk */ }
}

export const V24_TOOLS: any = {
  /* ── Payment integration ─────────────────────────────────────────────── */
  payment_setup: {
    name: 'payment_setup',
    description: 'Generate a real, ready-to-configure checkout flow for the project: Stripe.js checkout page (uses YOUR publishable key) with graceful demo mode when no key is given, plus success/cancel pages. Works for static web apps.',
    parameters: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'Product or plan name shown on checkout' },
        amount: { type: 'number', description: 'Price in USD (e.g. 19.99)' },
        publishableKey: { type: 'string', description: 'Stripe publishable key (pk_...). Optional — omit for demo mode' },
        currency: { type: 'string', description: 'ISO currency code, default usd' },
      },
      required: ['product', 'amount'],
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      const product = String(args.product || 'Product')
      const amount = Number(args.amount) || 0
      const currency = String(args.currency || 'usd').toLowerCase()
      const key = String(args.publishableKey || '')
      const demo = !key
      const page = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Checkout — ${product}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}
.box{background:#1e293b;border:1px solid #334155;border-radius:16px;padding:28px;width:min(420px,94vw)}
h1{font-size:1.3rem;margin-bottom:4px}.price{font-size:2.2rem;font-weight:800;color:#4ade80;margin:10px 0}
button{width:100%;padding:13px;border:none;border-radius:10px;background:#635bff;color:#fff;font-weight:700;font-size:1rem;cursor:pointer;margin-top:14px}
button:hover{filter:brightness(1.1)}small{color:#94a3b8;display:block;text-align:center;margin-top:10px}
.note{background:#334155;border-radius:8px;padding:10px;font-size:.82rem;color:#cbd5e1;margin-top:12px}</style></head>
<body><div class="box"><h1>🧾 ${product}</h1><p style="color:#94a3b8">Secure checkout</p>
<div class="price">$${amount.toFixed(2)} <span style="font-size:.9rem;color:#94a3b8">${currency.toUpperCase()}</span></div>
${demo ? `<div class="note">⚡ <b>Demo mode</b> — add your Stripe publishable key to accept real payments. Configure it via the Growth Studio → Payments tool.</div>` : ''}
<button id="pay">${demo ? 'Buy now (demo)' : 'Pay with card'}</button>
<small>Powered by Stripe · PCI-compliant · no card data touches this server</small></div>
${demo ? `<script>document.getElementById('pay').onclick=()=>location.href='payment-success.html?demo=1'</script>`
: `<script src="https://js.stripe.com/v3/"></script>
<script>const stripe=Stripe('${key}');
document.getElementById('pay').onclick=async()=>{
  const res=await fetch('/api/create-checkout-session',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({product:'${product}',amount:${amount},currency:'${currency}'})}).catch(()=>null);
  if(!res||!res.ok){alert('Backend endpoint /api/create-checkout-session is not available yet — see README-payment.md');return}
  const {sessionId}=await res.json();
  await stripe.redirectToCheckout({sessionId});
}</script>`}
</body></html>`
      const success = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Payment successful</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}h1{color:#4ade80}</style></head>
<body><div><div style="font-size:4rem">✅</div><h1>Payment successful</h1><p style="color:#94a3b8">Thank you! A receipt is on its way.</p><a href="index.html" style="color:#818cf8">← Back to app</a></div></body></html>`
      const cancel = success.replace(/Payment successful/g, 'Payment canceled').replace(/✅/, '↩️').replace(/#4ade80/g, '#fbbf24').replace('Thank you! A receipt is on its way.', 'No charge was made.')
      const readme = demo
        ? `# Payments (demo mode)\n\nThe checkout page works in demo mode. To accept REAL payments:\n1. Create a Stripe account → get your publishable key (pk_...).\n2. Re-run this tool with publishableKey, or edit checkout.html replacing DEMO with Stripe.js code.\n3. For production, create a server endpoint /api/create-checkout-session that calls Stripe's API with your SECRET key (keep the secret OUT of this static site — store it in the platform Secrets manager).`
        : `# Payments (Stripe)\n\ncheckout.html redirects to Stripe Checkout via /api/create-checkout-session.\nImplement that endpoint on your backend using your Stripe SECRET key (server-side only, never in this static site):\n\n  POST /api/create-checkout-session  { product, amount, currency }\n  → { sessionId }\n\nThe secret key belongs in the platform Secrets manager, never in project files.`
      await writeAndIndex(ctx, 'checkout.html', page)
      await writeAndIndex(ctx, 'payment-success.html', success)
      await writeAndIndex(ctx, 'payment-cancel.html', cancel)
      await writeAndIndex(ctx, 'README-payment.md', readme)
      return { ok: true, output: `Checkout flow created (${demo ? 'demo mode — add Stripe publishable key for real payments' : 'Stripe mode'}): checkout.html, payment-success.html, payment-cancel.html, README-payment.md. Product "${product}" at $${amount.toFixed(2)} ${currency.toUpperCase()}.` }
    },
  },

  /* ── Push notifications ──────────────────────────────────────────────── */
  push_notification_setup: {
    name: 'push_notification_setup',
    description: 'Add web push notification support to the project: service worker push handler, subscribe page with permission flow, and a step-by-step VAPID setup guide.',
    parameters: {
      type: 'object',
      properties: {
        appTitle: { type: 'string', description: 'App title used in the subscribe page header' },
      },
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      const title = String(args.appTitle || 'This app')
      const sw = `// PushSW — web push handler (generated by AI App Builder)
self.addEventListener('push', e => {
  let data = { title: '${title}', body: 'You have a new update!' };
  try { data = { ...data, ...e.data.json() }; } catch { if (e.data) data.body = e.data.text(); }
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: 'assets/icons/icon-192.png', badge: 'assets/icons/icon-192.png' }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(list => list.length ? list[0].focus() : clients.openWindow('/')));
});`
      const page = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notifications — ${title}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:16px}
button{padding:12px 26px;border:none;border-radius:10px;background:#6366f1;color:#fff;font-weight:700;font-size:1rem;cursor:pointer;margin-top:16px}</style></head>
<body><div><div style="font-size:3.4rem">🔔</div><h1>Stay in the loop</h1>
<p style="color:#94a3b8;margin-top:6px">${title} will send you important updates.</p>
<button id="en">Enable notifications</button><p id="st" style="color:#64748b;font-size:.85rem;margin-top:10px"></p></div>
<script>if(!('serviceWorker' in navigator)||!('PushManager' in window)){st.textContent='Push is not supported in this browser.'}
else{navigator.serviceWorker.register('push-sw.js');
document.getElementById('en').onclick=async()=>{
  const perm=await Notification.requestPermission();st.textContent='Permission: '+perm;
  if(perm!=='granted')return;
  alert('Subscribed!\\n\\nNext step (README-push.md): send this subscription object to your push server and use web-push with your VAPID keys.');};}</script></body></html>`
      const guide = `# Push notifications — wiring guide\n\nGenerated files:\n- push-sw.js — service worker that shows incoming pushes\n- notifications.html — user-facing subscribe page\n\nTo make pushes REAL you need VAPID keys and a small push server:\n\n1. Generate keys once:  npx web-push generate-vapid-keys\n2. Put the PUBLIC key in notifications.html (subscribe options applicationServerKey).\n3. On subscribe, POST the subscription object to YOUR backend endpoint.\n4. From your backend (keeping the PRIVATE key server-side):\n     npx web-push send-notification <endpoint-json> --vapid-public <pub> --vapid-private <priv>\n   or use the web-push library in Node.\n\nThe private VAPID key must live in the platform Secrets manager — never in project files.`
      await writeAndIndex(ctx, 'push-sw.js', sw)
      await writeAndIndex(ctx, 'notifications.html', page)
      await writeAndIndex(ctx, 'README-push.md', guide)
      return { ok: true, output: 'Push scaffolding added: push-sw.js, notifications.html, README-push.md (VAPID guide inside).' }
    },
  },

  /* ── Database builder ────────────────────────────────────────────────── */
  database_builder: {
    name: 'database_builder',
    description: 'Generate an instant, real data layer for a static web app: schema-driven CRUD store with localStorage persistence, query helpers (find/insert/update/remove) and an admin panel to inspect/edit rows.',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table/entity name, e.g. "tasks", "orders", "customers"' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Field names, e.g. ["title","done","dueDate"]' },
      },
      required: ['table', 'fields'],
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      const table = String(args.table || 'items').toLowerCase().replace(/[^a-z0-9_]/g, '')
      const fields = (Array.isArray(args.fields) ? args.fields : []).map((f: any) => String(f).replace(/[^a-zA-Z0-9_]/g, '')).filter(Boolean).slice(0, 24)
      if (!table || !fields.length) return { ok: false, output: '', error: 'table and at least one field are required' }
      const storeName = `db_${table}`
      const cells = fields.map(f => `<td>\${r.${f} ?? ''}</td>`).join('')
      const layer = `// ${table}.db.js — instant data layer (generated by AI App Builder)
// Real persistence via localStorage. Zero backend needed.
const DB_TABLE = '${table}';
const DB_KEY = '${storeName}';
const DB_FIELDS = ${JSON.stringify(fields)};

const DB = {
  all() { try { return JSON.parse(localStorage.getItem(DB_KEY) || '[]'); } catch { return []; } },
  find(pred) { return DB.all().filter(pred); },
  get(id) { return DB.all().find(r => r.id === id) || null; },
  insert(row) {
    const rows = DB.all();
    const rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), createdAt: new Date().toISOString(),
      ${fields.map(f => `${f}: row.${f} ?? null`).join(', ')} };
    rows.unshift(rec); localStorage.setItem(DB_KEY, JSON.stringify(rows)); return rec;
  },
  update(id, patch) {
    const rows = DB.all(); const i = rows.findIndex(r => r.id === id);
    if (i < 0) return null; rows[i] = { ...rows[i], ...patch }; localStorage.setItem(DB_KEY, JSON.stringify(rows)); return rows[i];
  },
  remove(id) { const rows = DB.all().filter(r => r.id !== id); localStorage.setItem(DB_KEY, JSON.stringify(rows)); },
  count(pred) { return pred ? DB.all().filter(pred).length : DB.all().length; },
};
window.DB = window.DB || {}; window.DB['${table}'] = DB;`
      const admin = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin — ${table}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px}
.wrap{max-width:860px;margin:0 auto}h1{font-size:1.4rem}small{color:#94a3b8}
table{width:100%;border-collapse:collapse;margin-top:14px;font-size:.9rem}
th{background:#1e293b;padding:8px;text-align:left;border:1px solid #334155}td{padding:8px;border:1px solid #334155}
button{cursor:pointer;border:none;border-radius:6px;padding:6px 10px;background:#ef4444;color:#fff;font-weight:600}
form{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}input{background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:8px;padding:8px 10px;flex:1;min-width:120px}
.fbtn{background:#6366f1;min-width:110px}</style></head><body><div class="wrap">
<h1>🗂 ${table} admin</h1><small>${fields.length} fields · live data · edit anything</small>
<form id="f">${fields.map(f => `<input name="${f}" placeholder="${f}" required>`).join('')}<button class="fbtn">Add row</button></form>
<table><thead><tr><th>id</th>${fields.map(f => `<th>${f}</th>`).join('')}<th></th></tr></thead><tbody id="rows"></tbody></table></div>
<script src="${table}.db.js"></script>
<script>const T=DB['${table}'];
function draw(){rows.innerHTML=T.all().map(r=>\`<tr><td><small>\${r.id}</small></td>${cells}<td><button onclick="T.remove('\${r.id}');draw()">Del</button></td></tr>\`).join('') || '<tr><td colspan="99" style="text-align:center;color:#64748b;padding:20px">No rows yet</td></tr>'}
f.onsubmit=e=>{e.preventDefault();const o={};${fields.map(f => `o['${f}']=f['${f}'].value;`).join('')}T.insert(o);f.reset();draw()};
draw();</script></body></html>`
      await writeAndIndex(ctx, `${table}.db.js`, layer)
      await writeAndIndex(ctx, `${table}-admin.html`, admin)
      return { ok: true, output: `Data layer created: ${table}.db.js (DB.${table}.all/find/insert/update/remove/count with localStorage persistence) + ${table}-admin.html admin panel. Fields: ${fields.join(', ')}.` }
    },
  },

  /* ── Analytics setup (beacon injection) ──────────────────────────────── */
  analytics_setup: {
    name: 'analytics_setup',
    description: 'Inject the privacy-friendly analytics beacon into the project HTML files. Page views are then recorded and visible in the Growth Studio → Analytics dashboard.',
    parameters: { type: 'object', properties: {} },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      const { injected } = injectAnalyticsAll(ctx.projectId)
      return { ok: true, output: injected.length ? `Beacon injected into: ${injected.join(', ')}. Views will appear in Analytics after visitors load the site.` : 'No root HTML files found to inject (looked for index.html, src/index.html, dist/index.html, build/web/index.html).' }
    },
  },

  /* ── Security scan ───────────────────────────────────────────────────── */
  security_scan: {
    name: 'security_scan',
    description: 'Scan the project for real security issues: hardcoded API keys/secrets, eval/new Function sinks, innerHTML injection, insecure http:// resources, committed .env files, dangerous Android permissions. Returns findings with severity, file:line and fixes.',
    parameters: { type: 'object', properties: {} },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      const { findings, score, scanned } = securityScan(ctx.projectId)
      const crit = findings.filter(f => f.severity === 'critical').length
      const high = findings.filter(f => f.severity === 'high').length
      const lines = findings.slice(0, 20).map(f => `- [${f.severity.toUpperCase()}] ${f.file}:${f.line} — ${f.title}`)
      return { ok: true, data: { findings, score }, output: `Security score: ${score}/100 (${scanned} files scanned). Critical: ${crit}, High: ${high}. ${lines.length ? '\n' + lines.join('\n') : 'No issues found — clean scan.'}` }
    },
  },

  /* ── PWA + SEO ───────────────────────────────────────────────────────── */
  pwa_seo_setup: {
    name: 'pwa_seo_setup',
    description: 'Make the project an installable PWA with SEO: web manifest, generated 192/512px icons (from your logo or branded fallback), offline service worker, meta/OG/twitter tags, robots.txt and sitemap.xml.',
    parameters: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'App name for the manifest (defaults to <title>)' },
        description: { type: 'string', description: 'Meta description text' },
      },
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      const res = await pwaSeoSetup(ctx.projectId, { appName: args.appName, description: args.description })
      return { ok: true, output: `PWA + SEO ready. Files: ${res.files.join(', ')}. App name: "${res.appName}". The app is now installable and offline-capable.` }
    },
  },

  /* ── AI asset generation ─────────────────────────────────────────────── */
  asset_generate: {
    name: 'asset_generate',
    description: 'Generate a real AI image asset for the project (logo, icon, hero image, banner) and save it into assets/. For icons, also produces 192/512px PWA sizes.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to draw, e.g. "minimal fox logo, flat, orange on dark"' },
        kind: { type: 'string', enum: ['logo', 'icon', 'hero', 'banner'], description: 'Asset type' },
        filename: { type: 'string', description: 'Output filename without extension (optional)' },
      },
      required: ['prompt', 'kind'],
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      const kind = String(args.kind || 'hero')
      const prompt = String(args.prompt || '')
      const base = String(args.filename || `${kind}-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || kind
      const size = kind === 'hero' || kind === 'banner' ? '1344x768' : '1024x1024'
      try {
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const res = await (zai as any).images.generations.create({ prompt, size })
        const b64 = res?.data?.[0]?.base64
        if (!b64) return { ok: false, output: '', error: 'image generation returned no data — try again' }
        const sharp = (await import('sharp')).default
        const png = Buffer.from(b64, 'base64')
        const rel = `assets/${base}.png`
        storage.writeFile(ctx.projectId, rel, png)
        try {
          await safeUpsert({ where: { projectId_path: { projectId: ctx.projectId, path: rel } }, create: { projectId: ctx.projectId, path: rel, content: `[binary ${png.length}B]`, isDir: false }, update: { content: `[binary ${png.length}B]` } })
        } catch { /* disk copy is enough */ }
        const written = [`${rel} (${Math.round(png.length / 1024)} KB)`]
        if (kind === 'icon' || kind === 'logo') {
          for (const s of [192, 512]) {
            const buf = await sharp(png).resize(s, s, { fit: 'cover' }).png().toBuffer()
            const r2 = `assets/icons/icon-${s}.png`
            storage.writeFile(ctx.projectId, r2, buf)
            written.push(`${r2} (${s}×${s})`)
          }
        }
        return { ok: true, output: `Generated ${kind}: ${written.join(', ')} — prompt: "${prompt}".`, data: { files: written } }
      } catch (e: any) {
        return { ok: false, output: '', error: `asset generation failed: ${e?.message || e}` }
      }
    },
  },

  /* ── ASO / store listing ─────────────────────────────────────────────── */
  aso_listing: {
    name: 'aso_listing',
    description: 'Generate App Store / Google Play listing copy (title, subtitle, short & long description, keywords, screenshot captions) from the project context, saved to STORE_LISTING.md + store-listing.json.',
    parameters: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'App name (defaults to project/title detection)' },
        tone: { type: 'string', enum: ['professional', 'playful', 'bold'], description: 'Copy tone' },
      },
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      // Gather lightweight context
      let title = args.appName || 'My App'
      let descHint = ''
      try {
        const idx = storage.readFile(ctx.projectId, 'index.html')
        title = args.appName || idx.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || title
        descHint = idx.match(/<meta name="description" content="([^"]*)"/i)?.[1] || ''
      } catch { /* not a static web app — fine */ }
      const entries = storage.readAllAsEntries(ctx.projectId).filter(e => !e.path.includes('node_modules')).slice(0, 12)
      const context = `App name: ${title}\nExisting description: ${descHint || '(none)'}\nProject files: ${entries.map(e => e.path).join(', ')}`
      try {
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const res = await (zai as any).chat.completions.create({
          model: 'glm-4.6',
          temperature: 0.6,
          messages: [{
            role: 'user',
            content: `You are an App Store Optimization (ASO) copywriter. Produce store listing copy for this app as STRICT JSON with keys: title (30 chars max), subtitle (30), shortDescription (80), longDescription (4000 max, with line breaks), keywords (array of 8 single words), screenshotCaptions (array of 5 short strings).\n\n${context}\n\nTone: ${args.tone || 'professional'}. Respond with ONLY the JSON.`,
          }],
        } as any)
        const text = res?.choices?.[0]?.message?.content || ''
        const jsonText = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
        const listing = JSON.parse(jsonText)
        const md = `# Store listing — ${listing.title}\n\n**Subtitle:** ${listing.subtitle}\n\n**Short description:** ${listing.shortDescription}\n\n## Long description\n\n${listing.longDescription}\n\n## Keywords\n\n${(listing.keywords || []).join(', ')}\n\n## Screenshot captions\n\n${(listing.screenshotCaptions || []).map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}\n`
        await writeAndIndex(ctx, 'STORE_LISTING.md', md)
        await writeAndIndex(ctx, 'store-listing.json', JSON.stringify(listing, null, 2))
        return { ok: true, output: `Store listing generated → STORE_LISTING.md + store-listing.json. Title: "${listing.title}". ${(listing.keywords || []).length} keywords, ${(listing.screenshotCaptions || []).length} screenshot captions.`, data: listing }
      } catch (e: any) {
        return { ok: false, output: '', error: `ASO generation failed: ${e?.message || e}` }
      }
    },
  },

  /* ── Version snapshot ────────────────────────────────────────────────── */
  version_snapshot: {
    name: 'version_snapshot',
    description: 'Create a restore point (snapshot) of all project files. Restore any snapshot later from Growth Studio → Versions.',
    parameters: {
      type: 'object',
      properties: { label: { type: 'string', description: 'Snapshot label, e.g. "before redesign"' } },
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      try {
        const snap = await snapshotProject(ctx.projectId, String(args.label || 'agent snapshot'))
        return { ok: true, output: `Snapshot created (${snap.fileCount} files, ${(snap.bytes / 1024).toFixed(1)} KB). Restore any time from Versions.` }
      } catch (e: any) {
        return { ok: false, output: '', error: e?.message || 'snapshot failed' }
      }
    },
  },
}
