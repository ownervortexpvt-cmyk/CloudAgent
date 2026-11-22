// Mock provider that simulates a Cloudflare region-blocked AI provider:
// - Server-side calls (no Origin header)  -> 403 Forbidden (blocked)
// - Browser/device calls (Origin present) -> 200 with a valid chat completion
const http = require('http')
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  let body = ''
  req.on('data', c => body += c)
  req.on('end', () => {
    const origin = req.headers.origin
    if (req.url.includes('/models')) {
      if (!origin) { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:{message:'Forbidden'}})); return }
      res.writeHead(200, {'Content-Type':'application/json'})
      res.end(JSON.stringify({data:[{id:'mock-model-1'},{id:'mock-model-2'}]}))
      return
    }
    // chat/completions
    if (!origin) {
      console.log('[mock] server-side call -> 403 (simulated region block)')
      res.writeHead(403, {'Content-Type':'application/json'})
      res.end(JSON.stringify({error:{message:'Forbidden'}}))
      return
    }
    console.log('[mock] BROWSER-device call -> 200 (device accepted!)')
    res.writeHead(200, {'Content-Type':'application/json'})
    res.end(JSON.stringify({
      choices:[{message:{role:'assistant',content:'=== FILE: relay-proof.txt ===\nBROWSER-DIRECT RELAY WORKS — this file was written by an agent whose LLM call was blocked on the server and completed from the user device.\n=== END FILE ==='}}],
      usage:{prompt_tokens:10, completion_tokens:25}
    }))
  })
})
server.listen(3999, () => console.log('mock blocked-provider on :3999'))
