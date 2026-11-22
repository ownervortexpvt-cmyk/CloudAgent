// Mock provider to verify 402/404 friendly errors + model fallback:
// - /models is PUBLIC (200, junk key included) — like DeepInfra/OpenRouter
// - /chat/completions:
//     * model "paid-model"     → 402 (out of credit)
//     * model "renamed-gone"   → 404 (model not found)
//     * any other model        → 200 (works)
const http = require('http')
const PORT = 4571
http.createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ data: [{ id: 'paid-model' }, { id: 'renamed-gone' }, { id: 'free-model' }] }))
  }
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const model = (() => { try { return JSON.parse(body).model } catch { return '' } })()
      if (model === 'paid-model') { res.writeHead(402, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Insufficient credit' } })) }
      if (model === 'renamed-gone') { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Model not found' } })) }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: `MOCK-OK via ${model}` } }] }))
    })
    return
  }
  res.writeHead(404); res.end()
}).listen(PORT, () => console.log(`mock 402/404 provider on :${PORT}`))
