#!/usr/bin/env node
/**
 * Mock OpenAI-compatible provider for the "real vs demo" proof E2E.
 *  GET  /v1/models              → messy list, JUNK first (proves ranking)
 *  POST /v1/chat/completions    → UNIQUE reply per call: MOCK-<rand>-ECHO <prompt-snippet>
 *                                 + logs every call to stdout (proof the swarm really called it)
 * CORS enabled so the browser (device-first detection) can call it directly.
 */
const http = require('http')
const crypto = require('crypto')

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-api-key',
}

const MODELS = {
  data: [
    { id: 'veo-3.1-lite-generate-preview' },
    { id: 'gemini-3.5-live-translate-preview' },
    { id: 'text-embedding-3-large' },
    { id: 'whisper-large-v3' },
    { id: 'mistral-7b-instruct' },
    { id: 'llama-3.3-70b-versatile' },
    { id: 'llama-3.2-1b-preview' },
    { id: 'qwen-2.5-72b-instruct' },
  ],
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  const auth = req.headers['authorization'] || ''
  if (!auth.startsWith('Bearer mock-sk-')) {
    console.log(`[mock] REJECTED ${req.method} ${req.url} (auth=${auth.slice(0, 20)}…)`)
    res.writeHead(401, { ...CORS, 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: { message: 'Invalid key' } }))
  }
  if (req.url === '/v1/models' && req.method === 'GET') {
    console.log('[mock] 200 GET /v1/models')
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
    return res.end(JSON.stringify(MODELS))
  }
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      let snippet = ''
      try { snippet = (JSON.parse(body).messages || []).map(m => m.content).join(' ').slice(0, 70) } catch {}
      const token = `MOCK-${crypto.randomBytes(4).toString('hex').toUpperCase()}-ECHO`
      const content = `${token} "${snippet}"`
      console.log(`[mock] 200 CHAT ${token} prompt="${snippet.slice(0, 50)}…"`)
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 9, completion_tokens: 14 } }))
    })
    return
  }
  console.log(`[mock] 404 ${req.method} ${req.url}`)
  res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
}).listen(4547, () => console.log('mock provider (proof) on :4547'))
