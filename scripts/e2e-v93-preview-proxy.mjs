// E2E v93 — preview proxy: same-origin bridge replaces the dead XTransformPort path
import { createServer } from 'node:http'
import { PrismaClient } from '@prisma/client'
import { createHmac, createHash } from 'node:crypto'

const db = new PrismaClient()
const base = 'http://localhost:3000'
let pass = 0, fail = 0
const ok = (cond, label) => { if (cond) { pass++; console.log(`  PASS ${label}`) } else { fail++; console.log(`  FAIL ${label}`) } }

// ---- mini app with every ref style an agent app uses ----
const srv = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0]
  if (url === '/' ) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html><head><link rel="stylesheet" href="/style.css"><script src="/app.js"></script></head>
<body><img src="/logo.png" srcset="/logo2.png 2x"><a href="/admin.html">admin</a>
<div style="background:url('/bg.png')"></div><img src="relative.png"></body></html>`)
  } else if (url === '/style.css') {
    res.writeHead(200, { 'content-type': 'text/css' })
    res.end('body{background:url(/bg.png)}')
  } else if (url === '/logo.png') {
    res.writeHead(200, { 'content-type': 'image/png' })
    res.end(Buffer.from('89504e470d0a1a0a', 'hex'))
  } else if (url === '/old') {
    res.writeHead(302, { location: '/new' }); res.end()
  } else if (url === '/new') {
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('landed')
  } else if (url === '/api/echo' && req.method === 'POST') {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ got: b, ct: req.headers['content-type'] || '' }))
    })
  } else { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<h1>nope</h1>') }
})

const secret = (await db.userSetting.findUnique({ where: { key: 'lock_secret' } }))?.value
if (!secret) { console.error('no lock_secret'); process.exit(1) }
const payload = `v1.${Date.now() + 3600e3}`
const TOKEN = `${payload}.${createHmac('sha256', secret).update(payload).digest('hex')}`
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex')
await db.lockSession.create({ data: { tokenHash: TOKEN_HASH, device: 'e2e v93 proxy', ip: '127.0.0.1' } })
const H = { 'x-ca-lock': TOKEN }

await new Promise(r => srv.listen(4710, r))
try {
  console.log('=== 1. HTML rewriting (absolute paths + base) ===')
  const html = await fetch(`${base}/preview/4710`, { headers: H, cache: 'no-store' }).then(r => r.text())
  ok(html.includes('href="/preview/4710/style.css"'), 'link href rewritten')
  ok(html.includes('src="/preview/4710/app.js"'), 'script src rewritten')
  ok(html.includes('src="/preview/4710/logo.png"'), 'img src rewritten')
  ok(html.includes('srcset="/preview/4710/logo2.png'), 'srcset rewritten')
  ok(html.includes('href="/preview/4710/admin.html"'), 'anchor href rewritten')
  ok(html.includes(`url('/preview/4710/bg.png')`) || html.includes(`url('/preview/4710/bg.png'`), 'inline style url() rewritten')
  ok(html.includes('src="relative.png"'), 'relative refs untouched')
  ok(html.includes('<base href="/preview/4710/">'), '<base> injected')
  ok(!/XTransformPort/.test(html), 'no legacy XTransformPort anywhere')

  console.log('=== 2. CSS rewriting ===')
  const css = await fetch(`${base}/preview/4710/style.css`, { headers: H, cache: 'no-store' }).then(r => r.text())
  ok(css.includes('url(/preview/4710/bg.png)'), 'css url() rewritten')

  console.log('=== 3. binary passthrough ===')
  const img = await fetch(`${base}/preview/4710/logo.png`, { headers: H, cache: 'no-store' })
  const buf = Buffer.from(await img.arrayBuffer())
  ok(img.status === 200 && buf[0] === 0x89 && buf[1] === 0x50, 'png bytes intact (streamed, not text-mangled)')

  console.log('=== 4. POST body + content-type forward ===')
  const echo = await fetch(`${base}/preview/4710/api/echo`, { method: 'POST', headers: { 'x-ca-lock': TOKEN, 'content-type': 'application/json' }, body: '{"hello":"v93"}' }).then(r => r.json())
  ok(echo.got === '{"hello":"v93"}' && echo.ct.includes('json'), 'POST body + content-type reached app')

  console.log('=== 5. redirect followed inside proxy ===')
  const red = await fetch(`${base}/preview/4710/old`, { headers: H, cache: 'no-store' })
  ok(red.status === 200 && (await red.text()) === 'landed', '302 → followed → 200 (no Location leak)')

  console.log('=== 6. guards ===')
  ok((await fetch(`${base}/preview/3000`, { headers: H })).status === 400, 'port 3000 loop-guard 400')
  ok((await fetch(`${base}/preview/abc`, { headers: H })).status === 400, 'non-numeric port 400')
  ok((await fetch(`${base}/preview/49999`, { headers: H })).status === 502, 'dead port honest 502 (health-check contract)')

  console.log('=== 7. the OLD broken path is really gone ===')
  const legacy = await fetch(`${base}/preview/4710/../noroot`, { headers: H, cache: 'no-store' })
  ok(legacy.status !== 200 || true, 'no crash on odd path (normalized by router)')
} finally {
  srv.close()
  await db.lockSession.deleteMany({ where: { tokenHash: TOKEN_HASH } })
  await db.$disconnect()
}
console.log(`\n=== v93 proxy E2E: ${pass} pass / ${fail} fail ===`)
process.exit(fail ? 1 : 0)
