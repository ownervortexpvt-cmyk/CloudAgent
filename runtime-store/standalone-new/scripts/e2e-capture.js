/** Re-attach to the running swarm40_proof run → capture remaining events. */
const fs = require('fs')
const COOKIE = fs.readFileSync('/home/z/my-project/scripts/.e2e/cookie.txt', 'utf8')
const OUT = '/home/z/my-project/scripts/.e2e/swarm.ndjson'

async function main() {
  const res = await fetch('http://localhost:3000/api/agent/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: JSON.stringify({ runId: 'swarm40_proof', from: 0 }),
  })
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const fd = fs.openSync(OUT, 'w')
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const l of lines) { if (l.trim()) fs.writeSync(fd, l + '\n') }
  }
  if (buf.trim()) fs.writeSync(fd, buf + '\n')
  fs.closeSync(fd)
  console.log('capture closed')
}
main().catch(e => { console.error('ERR', e.message); process.exit(1) })
