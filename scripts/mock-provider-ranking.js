#!/usr/bin/env node
/**
 * Mock OpenAI-compatible provider for E2E:
 *  GET  /v1/models  → messy list with JUNK first (veo/live/embedding) to prove client-side ranking
 *  POST /v1/chat/completions → tiny reply (proves the Test button)
 * CORS enabled so the browser can call it directly (device-first detection).
 */
const http = require('http')

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-api-key',
}

const MODELS = {
  data: [
    { id: 'veo-3.1-lite-generate-preview' },                    // junk video
    { id: 'gemini-3.5-live-translate-preview' },                // junk live/translate
    { id: 'text-embedding-3-large' },                           // junk embedding
    { id: 'whisper-large-v3' },                                 // junk audio
    { id: 'mistral-7b-instruct' },                              // meh
    { id: 'llama-3.3-70b-versatile' },                          // GOOD default
    { id: 'llama-3.2-1b-preview' },                             // weak
    { id: 'qwen-2.5-72b-instruct' },                            // decent
  ],
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
  const auth = req.headers['authorization'] || ''
  if (!auth.startsWith('Bearer mock-sk-')) {
    res.writeHead(401, { ...CORS, 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: { message: 'Invalid key' } }))
  }
  if (req.url === '/v1/models' && req.method === 'GET') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
    return res.end(JSON.stringify(MODELS))
  }
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'OK from mock provider' } }] }))
    })
    return
  }
  res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
}).listen(4546, () => console.log('mock provider on :4546'))
