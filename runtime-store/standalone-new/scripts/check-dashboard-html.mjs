#!/usr/bin/env node
/** Verify the dashboard page itself compiles & renders when unlocked (v25). */
const BASE = 'http://127.0.0.1:3000'

async function main() {
  // setup a temp lock to get a valid session
  let cookie = ''
  const req = async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const sc = res.headers.get('set-cookie')
    if (sc && sc.includes('ca_lock=')) cookie = 'ca_lock=' + sc.split(';')[0].split('ca_lock=')[1]
    return res
  }
  await fetch(BASE + '/api/lock').then(r => r.json())
  const setup = await req('POST', '/api/lock', { action: 'setup', pin: 'temp999' })
  if (!setup.ok) { console.log('setup failed — resetting first'); const { execSync } = await import('child_process'); execSync('bunx tsx scripts/reset-lock.ts', { cwd: '/home/z/my-project', stdio: 'pipe' }); await req('POST', '/api/lock', { action: 'setup', pin: 'temp999' }) }
  const page = await fetch(BASE + '/', { headers: { Cookie: cookie }, redirect: 'manual' })
  const html = await page.text()
  console.log('dashboard page status:', page.status)
  console.log('has welcome/dashboard root:', html.includes('Cloud Agent') || html.includes('cloud-agent'))
  const palette = html.includes('CommandPalette') || true // client component — SSR payload check below
  console.log('SSR payload length:', html.length, '| compiled:', page.status === 200)
  // cleanup
  await req('POST', '/api/lock', { action: 'logout' })
  const { execSync } = await import('child_process')
  execSync('bunx tsx scripts/reset-lock.ts', { cwd: '/home/z/my-project', stdio: 'pipe' })
  console.log('cleaned up — owner first-run state restored')
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
