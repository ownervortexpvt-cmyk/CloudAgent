/**
 * CloudAgent local-ai server (v113) — OpenAI-compatible GGUF inference on :11434.
 *
 * Recreate-proof: THIS FILE IS GIT-TRACKED. After a sandbox recycle, restore is:
 *   bash scripts/setup-local-ai.sh     (deps + models, resumable)
 *
 * Endpoints (the shapes src/lib/ai/local.ts probes):
 *   GET  /api/version           → Ollama-style {"version":"cloudagent-local-ai"}
 *   GET  /v1/models             → OpenAI-style model list (from local-ai/models/*.gguf)
 *   POST /v1/chat/completions   → stream (SSE) or JSON, OpenAI body format
 *
 * Design: one model resident at a time (LRU, 10-min idle unload), FIFO
 * request lanes (2 CPU cores can't multiplex GGUF inference), per-request
 * sequence disposal (the v112 leak fix — sequences must be disposed or the
 * context pool exhausts and every later call errors).
 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = Number(process.env.LOCAL_AI_PORT || 11434)
const MODELS_DIR = path.join(__dirname, 'models')
const IDLE_UNLOAD_MS = 10 * 60 * 1000

let llama = null // lazy node-llama-cpp handle
let resident = null // { name, model, context, loadedAt, lastUsed }
let chain = Promise.resolve() // FIFO lane
const shuttingDown = false

function log(...a) { console.log(`[local-ai ${new Date().toISOString()}]`, ...a) }

function listGgufs() {
  try {
    return fs.readdirSync(MODELS_DIR).filter((f) => f.toLowerCase().endsWith('.gguf'))
  } catch { return [] }
}

function modelName(file) {
  // "Qwen2.5-Coder-0.5B-Instruct.Q4_K_M.gguf" → "qwen2.5-coder-0.5b-instruct"
  return file.replace(/\.gguf$/i, '').replace(/\.[A-Za-z0-9_]+$/, '').toLowerCase()
}

async function getLlama() {
  if (!llama) {
    const mod = await import('node-llama-cpp')
    llama = await mod.getLlama({ build: 'never', logger: 'warn' })
  }
  return llama
}

async function loadResident(file) {
  if (resident && resident.file === file) {
    resident.lastUsed = Date.now()
    return resident
  }
  await unloadResident()
  const L = await getLlama()
  log('loading model', file)
  const model = await L.loadModel({ modelPath: path.join(MODELS_DIR, file) })
  const context = await model.createContext({ contextSize: 4096 })
  resident = { file, name: modelName(file), model, context, lastUsed: Date.now() }
  log('model ready', file)
  return resident
}

async function unloadResident() {
  if (!resident) return
  try { await resident.model.dispose() } catch {}
  log('unloaded model', resident.file)
  resident = null
}

setInterval(() => {
  if (resident && Date.now() - resident.lastUsed > IDLE_UNLOAD_MS) unloadResident()
}, 60 * 1000).unref()

/* ───────────────── request handling ───────────────── */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (c) => { buf += c })
    req.on('end', () => resolve(buf))
    req.on('error', reject)
  })
}

function sse(res, event, data) {
  res.write(`data: ${JSON.stringify({ ...(event ? { event } : {}), ...data })}\n\n`)
}

async function handleChat(req, res, body) {
  let parsed
  try { parsed = JSON.parse(body || '{}') } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: { message: 'invalid JSON' } }))
  }
  const requested = String(parsed.model || '')
  const files = listGgufs()
  if (!files.length) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: { message: 'no GGUF models installed in local-ai/models — run scripts/setup-local-ai.sh' } }))
  }
  const file = files.find((f) => modelName(f).includes(requested.toLowerCase()) && requested) || files[0]
  const stream = parsed.stream === true
  const messages = Array.isArray(parsed.messages) ? parsed.messages : []
  const historyText = messages.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n')

  const task = (async () => {
    let r
    try {
      r = await loadResident(file)
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: { message: `model load failed: ${e.message}` } }))
    }
    const { LlamaChatSession } = await import('node-llama-cpp')
    const sequence = r.context.getSequence()
    try {
      if (stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        sse(res, null, { id: 'local', model: r.name, created: Math.floor(Date.now() / 1000), choices: [{ delta: { role: 'assistant' } }] })
      }
      const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: '' })
      let full = ''
      await session.prompt(historyText, {
        maxTokens: Math.min(Number(parsed.max_tokens) || 2048, 4096),
        temperature: Number(parsed.temperature ?? 0.7),
        onTextChunk: (chunk) => {
          full += chunk
          if (stream) {
            sse(res, null, { id: 'local', model: r.name, created: Math.floor(Date.now() / 1000), choices: [{ delta: { content: chunk } }] })
          }
        },
      })
      if (stream) {
        sse(res, null, { id: 'local', model: r.name, created: Math.floor(Date.now() / 1000), choices: [{ delta: {} }], finish_reason: 'stop' })
        res.write('data: [DONE]\n\n')
        res.end()
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          id: 'local', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: r.name,
          choices: [{ index: 0, message: { role: 'assistant', content: full }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }))
      }
    } catch (e) {
      log('inference error:', e.message)
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: e.message } }))
      } else {
        try { res.end() } catch {}
      }
    } finally {
      try { await sequence.dispose() } catch {} // v112 fix: dispose EVERY request sequence
    }
  })()

  chain = chain.then(() => task).catch(() => {}) // FIFO: one inference at a time
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || '').split('?')[0]
  try {
    if (req.method === 'GET' && (url === '/api/version' || url === '/api/tags')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ version: 'cloudagent-local-ai/1.0', models: listGgufs().map((f) => ({ name: modelName(f), file: f })) }))
    }
    if (req.method === 'GET' && url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ object: 'list', data: listGgufs().map((f) => ({ id: modelName(f), object: 'model', owned_by: 'local' })) }))
    }
    if (req.method === 'POST' && url === '/v1/chat/completions') {
      return await handleChat(req, res, await readBody(req))
    }
    if (req.method === 'POST' && (url === '/unload' || url === '/api/unload')) {
      await unloadResident()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ ok: true }))
    }
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: `unknown route ${req.method} ${url}` } }))
  } catch (e) {
    log('handler error:', e.message)
    if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: { message: e.message } })) }
  }
})

server.listen(PORT, '127.0.0.1', () => log(`local-ai server on :${PORT} · models dir ${MODELS_DIR} · ${listGgufs().length} gguf(s) present`))
process.on('SIGTERM', () => { unloadResident().finally(() => process.exit(0)) })
