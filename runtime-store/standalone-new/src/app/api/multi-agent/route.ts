import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { buildProvider, ZAIProvider, type ChatResponse } from '@/lib/ai/providers'
import { loadBalancer } from '@/lib/ai/load-balancer'
import { recordUsage } from '@/lib/usage'
import { checkBudget, budgetBlockMessage } from '@/lib/budget'
import { notifyRunFinishedWebhook } from '@/lib/webhook'
import { parkRelay, failRelaysOfRun } from '@/lib/ai/relay-registry'
import * as storage from '@/lib/storage'
import { registerRun, pushEvent, subscribeRun, detachViewer, getRun, isValidRunId } from '@/lib/ai/run-buffer'
import { autoCollectApisForPrompt } from '@/lib/ai/auto-api-tools'
import { requireProjectAccess } from '@/lib/auth'
import { assertRunAllowed, capSwarmAgents } from '@/lib/plan-guard'

/**
 * POST /api/multi-agent
 * Body: {
 *   projectId: string,
 *   task: string,                          // main task
 *   action?: 'start' | 'stop' | 'rejoin',  // default 'start'
 *   runId?: string,                        // required for action='stop'/'rejoin'
 *   from?: number,                         // rejoin: replay buffer from this event index
 *   config?: {
 *     coordinatorCount: number,            // default 1
 *     qualityCheckerCount: number,         // default 10
 *     featureCheckerCount: number,         // default 15
 *     codeWriterCount: number,             // default 970
 *     setupAgentCount: number,             // default 4
 *     maxConcurrency: number,              // default 8, max 64 — how many agents
 *                                          // run in parallel at once (the rest queue)
 *     agentTimeoutMs: number,              // default 180000
 *   }
 * }
 *
 * Launches the multi-agent system:
 *   (A) Coordinator — receives updates from all other agents, distributes tasks
 *   (B) Quality Checkers — audit code for bugs/fakes/demos
 *   (C) Feature Checkers — audit which features/buttons work
 *   (D) Code Writers — write the actual code in parallel chunks
 *   (E) Setup Agents — install SDKs (Flutter, JDK, etc.)
 *
 * EVERY agent runs through the whole provider pool: when a provider fails or
 * hits its rate limit, the agent automatically switches to the next healthy
 * key (round-robin + circuit breaker via the shared load balancer). This is
 * what makes "thousands of AIs working together" actually possible — the pool
 * absorbs rate limits instead of dying on the first 429.
 *
 * Returns NDJSON stream of agent events.
 */

interface AgentRole {
  role: 'coordinator' | 'quality' | 'feature' | 'writer' | 'setup'
  id: string
  index: number
  task: string
  systemPrompt: string
  // Sticky 1:1 key↔agent mapping: agent #i prefers pool key #i. With N keys
  // and N agents, EVERY key works simultaneously — exactly what the user
  // asked for ("10 keys → 10 agents, 50 keys → 50 agents").
  assignedKeyId?: string
  isLeader?: boolean
}

interface PoolEntry {
  id: string
  name: string
  model: string
  provider: any
  // Extra fields for BROWSER-DIRECT relay: when the server's IP is
  // Cloudflare-blocked by the provider (Groq/OpenAI → HTTP 403), the same
  // LLM call is re-issued from the user's device. The relay needs the raw
  // request ingredients (kind/endpoint/key/model).
  kind: string
  endpoint: string
  apiKey: string
}

/** Default OpenAI-compatible base endpoints per kind (used when the row has
 *  no endpoint — mirrors buildProvider's internal defaults). */
const KIND_DEFAULT_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  'openrouter-free': 'https://openrouter.ai/api/v1',
  'openrouter-uncensored': 'https://openrouter.ai/api/v1',
  mistral: 'https://api.mistral.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  together: 'https://api.together.xyz/v1',
  'together-free': 'https://api.together.xyz/v1',
  'together-uncensored': 'https://api.together.xyz/v1',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  'fireworks-free': 'https://api.fireworks.ai/inference/v1',
  perplexity: 'https://api.perplexity.ai',
  cohere: 'https://api.cohere.com/v1',
  ai21: 'https://api.ai21.com/v1',
  novita: 'https://api.novita.ai/v3/openai',
  nebius: 'https://api.studio.nebius.ai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  xai: 'https://api.x.ai/v1',
  huggingface: 'https://api-inference.huggingface.co/v1',
  replicate: 'https://api.replicate.com/v1',
  anyscale: 'https://api.endpoints.anyscale.com/v1',
  lepton: 'https://api.lepton.ai/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  claude: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
}

/** Detect the SERVER-REGION-BLOCK signature: providers behind Cloudflare
 *  (Groq, OpenAI…) answer 403 "Forbidden" to a datacenter IP for EVERY key,
 *  valid or not. When we see it, the same call is relayed through the user's
 *  device (browser-direct), which is NOT blocked. */
function isRegionBlock(msg: string): boolean {
  return /403|forbidden|cloudflare|blocked|unusual activity|region/i.test(msg)
}

/** Build the exact HTTP request the BROWSER should perform for one LLM call
 *  (browser-direct relay). Returns null for providers that cannot be relayed
 *  (the built-in GLM SDK only exists server-side). */
function buildDirectChat(entry: PoolEntry, messages: Array<{ role: string; content: string }>, opts: { temperature: number; maxTokens: number }) {
  const system = messages.find(m => m.role === 'system')?.content || ''
  const rest = messages.filter(m => m.role !== 'system')
  if (entry.kind === 'zai') return null

  if (entry.kind === 'claude') {
    const base = (entry.endpoint || KIND_DEFAULT_ENDPOINTS.claude).replace(/\/$/, '')
    return {
      url: `${base}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': entry.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: {
        model: entry.model,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        ...(system ? { system } : {}),
        messages: rest.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      },
      style: 'claude' as const,
    }
  }

  if (entry.kind === 'gemini') {
    const base = (entry.endpoint || KIND_DEFAULT_ENDPOINTS.gemini).replace(/\/$/, '')
    return {
      url: `${base}/models/${encodeURIComponent(entry.model)}:generateContent?key=${encodeURIComponent(entry.apiKey)}`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: rest.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { temperature: opts.temperature, maxOutputTokens: opts.maxTokens },
      },
      style: 'gemini' as const,
    }
  }

  // Everything else is OpenAI-compatible /chat/completions with Bearer auth
  const base = (entry.endpoint || KIND_DEFAULT_ENDPOINTS[entry.kind] || 'https://api.openai.com/v1').replace(/\/$/, '')
  return {
    url: `${base}/chat/completions`,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${entry.apiKey}` },
    body: {
      model: entry.model,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
    },
    style: 'openai' as const,
  }
}

const ROLE_PROMPTS: Record<string, string> = {
  coordinator: `You are the COORDINATOR AGENT — the brain of a 1000-agent team.

Your job:
1. Receive status updates from all other agents
2. Decide what each agent should work on next
3. Detect when an agent is stuck or repeating itself
4. Distribute work evenly across the team
5. Track overall progress and report to the user

You have 4 specialist teams reporting to you:
- (B) Quality Checkers — they audit code for bugs, fakes, demos
- (C) Feature Checkers — they audit which features/buttons work
- (D) Code Writers — they write the actual code in parallel
- (E) Setup Agents — they install SDKs (Flutter, JDK, etc.)

When you receive an update, decide:
- ACK (continue) — agent should continue its current task
- REDIRECT — agent should switch to a different task (specify which)
- PAUSE — agent should pause and wait for further instructions
- ESCALATE — agent has hit a blocker that needs user input

Output: a JSON decision like {"action": "ACK|REDIRECT|PAUSE|ESCALATE", "target": "agent-id", "newTask": "...", "reason": "..."}`,

  quality: `You are a QUALITY CHECKER AGENT — part of a large team.

Your job:
1. Read the code that Code Writers have produced
2. Check for: bugs, syntax errors, fake/demo code, TODO comments, placeholder text
3. Check for: security vulnerabilities (hardcoded secrets, SQL injection, XSS)
4. Check for: performance issues (N+1 queries, memory leaks)
5. Report findings to the Coordinator

For each file you audit, output:
- File path
- Issues found (with line numbers)
- Severity (critical/high/medium/low)
- Suggested fix

If you find fake or demo code (e.g. "// TODO: implement", "return null", hardcoded test data), flag it as CRITICAL.`,

  feature: `You are a FEATURE CHECKER AGENT — part of a large team.

Your job:
1. Read the project's UI code (components, pages, screens)
2. Check which features/buttons are actually implemented vs. just stubs
3. Check which features are referenced but missing
4. Identify what buttons/UI elements need to be added
5. Report findings to the Coordinator

For each feature you audit, output:
- Feature name
- Status: implemented | partial | stub | missing
- Files involved
- What's needed to complete it

Focus on user-visible features: login, signup, navigation, forms, lists, search, etc.`,

  writer: `You are a CODE WRITER AGENT — part of a large parallel team.

Your job:
1. Receive a specific file or component to write from the Coordinator
2. Write COMPLETE, production-ready code — no placeholders, no TODOs
3. Follow the project's existing patterns and conventions
4. Include proper error handling and edge cases
5. Report back to the Coordinator when done

FULL PRODUCT RULE: the team ships the WHOLE product — USER app + ADMIN panel + BACKEND server (REST APIs + data). If your assignment is the backend, build real endpoints and persistence; if it's a user-facing part, call the real API endpoints, never fake data.
FLUTTER RULE: a runnable Flutter project needs AT MINIMUM pubspec.yaml (with flutter sdk dep + cupertino_icons) AND lib/main.dart (complete widget tree with void main() => runApp). If your package touches a Flutter app, ensure those files exist COMPLETE.

OUTPUT FORMAT — ABSOLUTE, NON-NEGOTIABLE (the platform parses your reply and writes the files to disk):
For EVERY file you produce, emit exactly:

=== FILE: relative/path/to/file.ext ===
<complete file content>
=== END FILE ===

Multiple files = multiple blocks. NO other fencing around them.
You may add ONE short status line before the blocks.

🚫 FORBIDDEN: step-by-step narration or instructions like "Navigate to…", "Open the file…", "Locate the h1…", "I will now…", "Run this command". You ARE the machine that writes files — NEVER describe what a human should do; EMIT the final, complete file content yourself inside the blocks. A reply without at least one === FILE: block counts as a FAILED assignment.

✅ The only acceptable reply shape (example):

=== FILE: index.html ===
<!DOCTYPE html>
<html><body><h1>Hello</h1></body></html>
=== END FILE ===
Keep each response to 1-3 files — a response cut mid-file is LOST (the block without === END FILE === is discarded). Prefer splitting big files into modules across multiple batches.

IMPORTANT:
- Write the FULL file content, not just snippets
- Use the project's framework (React/Flutter/Next.js/etc.)
- Include all imports
- Add comments for complex logic
- Test mentally: will this code actually run?`,

  setup: `You are a SETUP AGENT — part of a large team.

Your job:
1. Detect what SDKs/tools the project needs (Flutter, JDK, Python, Node, etc.)
2. Install them via terminal commands
3. Configure environment variables
4. Verify the installation worked
5. Report to the Coordinator

Common setups:
- Flutter: flutter doctor, flutter pub get, Android SDK
- Java: JDK installation, JAVA_HOME, Maven/Gradle
- Python: pip install, virtualenv, requirements.txt
- Node: npm install, package.json scripts
- React Native: react-native-cli, iOS/Android SDK

Always verify with a version check after install.`,
}

/* ────────────────────────── Active run registry ───────────────────────────
 * Keeps AbortControllers for every in-flight multi-agent run so a user can
 * stop a 1000-agent swarm mid-flight. Keyed by runId. */
const activeRuns = new Map<string, AbortController>()
// Raised from 64 → 1000: the user explicitly wants every key to run as its own
// parallel agent (10 keys → 10 agents at once, 1000 keys → 1000 at once).
// Node's async I/O handles this fine — provider rate limits are the real
// limiter, and the load balancer absorbs those via rotation.
const MAX_CONCURRENCY_HARD_CAP = 1000

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })

  const action: string = body.action || 'start'

  /* ---- Rejoin a running/finished swarm (v55 Unbreakable Army) ----
   * Same contract as POST /api/agent/resume: the run keeps going server-side
   * even when every viewer leaves, and this endpoint replays the missed
   * buffer window then live-tails until done. */
  if (action === 'rejoin') {
    const runId: string = body.runId
    if (!isValidRunId(runId)) {
      return NextResponse.json({ error: 'runId required' }, { status: 400 })
    }
    const run = getRun(runId)
    if (!run) {
      return NextResponse.json({ error: 'This swarm run is no longer in memory (finished more than 15 minutes ago or the server restarted).' }, { status: 404 })
    }
    const start = Math.max(0, Math.min(Number.isFinite(Number(body.from)) ? Number(body.from) : 0, run.events.length))

    const encoder = new TextEncoder()
    let clientGone = false
    let unsubscribe: (() => void) | null = null
    let heartbeat: ReturnType<typeof setInterval> | null = null

    const stream = new ReadableStream({
      start(ctrl) {
        const send = (obj: any) => {
          if (clientGone) return
          try { ctrl.enqueue(encoder.encode(JSON.stringify(obj) + '\n')) } catch { clientGone = true }
        }

        send({ type: 'resumed', runId, from: start, total: run.events.length, done: run.done })
        for (let i = start; i < run.events.length && !clientGone; i++) send(run.events[i])

        if (run.done || clientGone) {
          if (!clientGone) { try { ctrl.close() } catch {} }
          return
        }

        // Live-tail until the run finishes + heartbeat so the client knows
        // the stream is alive during quiet stretches
        unsubscribe = subscribeRun(runId, (ev) => {
          send(ev)
          if (ev?.type === 'done' || ev?.type === 'error') {
            if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
            if (unsubscribe) { unsubscribe(); unsubscribe = null }
            try { ctrl.close() } catch {}
          }
        })
        // v57: streamOnly stamp — this liveness ping is NOT buffered, so a
        // rejoining client must NOT count it in its replay cursor. (Before
        // this stamp every rejoin heartbeat drifted the cursor forward, so
        // the NEXT rejoin skipped that many real events — progress looked
        // broken after reconnects.)
        heartbeat = setInterval(() => send({ type: 'heartbeat', runId, ts: Date.now(), streamOnly: true }), 4000)

        ;(req.signal as any).addEventListener?.('abort', () => {
          clientGone = true
          if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
          if (unsubscribe) { unsubscribe(); unsubscribe = null }
          detachViewer(runId)
          try { ctrl.close() } catch {}
        }, { once: true })
      },
      cancel() {
        clientGone = true
        if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
        if (unsubscribe) { unsubscribe(); unsubscribe = null }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  /* ---- Stop a running swarm ---- */
  if (action === 'stop') {
    const runId: string = body.runId
    const ctrl = runId ? activeRuns.get(runId) : undefined
    if (!ctrl) {
      // Also allow stopping ALL runs (mobile refresh may lose the runId)
      if (!runId && activeRuns.size > 0) {
        for (const [id, c] of activeRuns.entries()) {
          c.abort()
          // v55: a stopped run ends NOW — no rejoin will answer its parked
          // browser relays, so fail them immediately (no 120s hang)
          failRelaysOfRun(id, 'run stopped by owner')
          pushEvent(id, { type: 'status', content: '⏹ Stop requested by owner — cancelling in-flight agents…' })
        }
        return NextResponse.json({ ok: true, stopped: activeRuns.size })
      }
      return NextResponse.json({ ok: false, error: 'run not found or already finished' }, { status: 404 })
    }
    ctrl.abort()
    // v55: stopped run ends NOW — fail parked relays + tell rejoining viewers
    failRelaysOfRun(runId, 'run stopped by owner')
    pushEvent(runId, { type: 'status', content: '⏹ Stop requested by owner — cancelling in-flight agents…' })
    return NextResponse.json({ ok: true })
  }

  /* ---- Start a new swarm ---- */
  const { projectId, config } = body || {}
  let task: string = body?.task // let: v73 auto-collect may append the API note
  if (!projectId || !task) {
    return NextResponse.json({ error: 'projectId and task required' }, { status: 400 })
  }
  // BUSINESS v2: ownership + plan metering BEFORE any model call.
  let sessionUser
  try {
    sessionUser = await requireProjectAccess(req, projectId)
    await assertRunAllowed(sessionUser)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }
  // v60: monthly budget guard — BEFORE any model call, so an exceeded cap
  // costs zero tokens. '' (no cap) passes instantly.
  const budget = await checkBudget()
  if (budget.blocked) {
    return NextResponse.json({ error: budgetBlockMessage(budget), budgetUSD: budget.budgetUSD, spentUSD: budget.spentUSD }, { status: 402 })
  }

  const counts = {
    coordinator: clampInt(config?.coordinatorCount, 1, 0, 100),
    quality: clampInt(config?.qualityCheckerCount, 10, 0, 5000),
    feature: clampInt(config?.featureCheckerCount, 15, 0, 5000),
    writer: clampInt(config?.codeWriterCount, 970, 0, 100000),
    setup: clampInt(config?.setupAgentCount, 4, 0, 100),
  }

  // BUSINESS v2: clamp the army to the account's plan (announce the honest cap).
  {
    const wanted = counts.coordinator + counts.quality + counts.feature + counts.writer + counts.setup
    const capped = await capSwarmAgents(sessionUser, wanted)
    if (capped < wanted) {
      const scale = capped / wanted
      counts.coordinator = Math.min(counts.coordinator, Math.max(1, Math.round(counts.coordinator * scale)))
      counts.quality = Math.round(counts.quality * scale)
      counts.feature = Math.round(counts.feature * scale)
      counts.writer = Math.max(0, Math.round(counts.writer * scale))
      counts.setup = Math.min(counts.setup, Math.round(counts.setup * scale))
    }
  }

  // v73: automatic API collection — same as /api/agent. Scans the task for
  // known services and creates placeholder secrets BEFORE any model call.
  try {
    const apiNote = await autoCollectApisForPrompt(projectId, task)
    if (apiNote) task = `${task}\n\n--- ${apiNote}`
  } catch {}
  const maxConcurrency = Math.min(clampInt(config?.maxConcurrency, 8, 1, MAX_CONCURRENCY_HARD_CAP), MAX_CONCURRENCY_HARD_CAP)
  const agentTimeoutMs = clampInt(config?.agentTimeoutMs, 180000, 15000, 600000)

  // Load all available API keys from the DB — the full provider pool.
  // Defense-in-depth: skip duplicate keys (same key would still do the work
  // of ONE key). Duplicates are already blocked at add-time, but legacy rows
  // or bulk imports from before that guard may still contain them.
  const providers: PoolEntry[] = []
  let dedupedKeys = 0
  const seenKeys = new Set<string>()
  try {
    const allRows = await db.aIProvider.findMany({ orderBy: { isDefault: 'desc' } })
    for (const row of allRows) {
      try {
        const apiKey = row.apiKeyEnc ? decrypt(row.apiKeyEnc) : ''
        if (apiKey) {
          if (seenKeys.has(apiKey)) { dedupedKeys++; continue }
          seenKeys.add(apiKey)
        }
        const p = buildProvider({
          kind: row.kind as any,
          apiKey,
          model: row.model,
          endpoint: row.endpoint || undefined,
          name: row.name,
        })
        loadBalancer.registerKey(row.id)
        providers.push({ provider: p, id: row.id, name: row.name, model: row.model, kind: row.kind || 'openai-compatible', endpoint: row.endpoint || '', apiKey })
      } catch {}
    }
  } catch {}

  // If no providers, use the built-in Vortex Engine
  if (providers.length === 0) {
    providers.push({ provider: new ZAIProvider(), id: 'zai', name: 'Vortex Engine (built-in)', model: 'glm-4.6', kind: 'zai', endpoint: '', apiKey: '' })
  }

  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const abortCtrl = new AbortController()
  activeRuns.set(runId, abortCtrl)
  // v55 Unbreakable Army: buffer every event so the run OUTLIVES its HTTP
  // connection — a dropped phone network no longer kills the swarm
  const runBuf = registerRun(runId)
  // v138 SECURITY FIX: ownership tag for abort/resume access checks
  if (projectId) runBuf.projectId = projectId

  const poolSummary = providers.reduce<Record<string, number>>((acc, p) => {
    const k = (p.provider as any).kind || 'unknown'
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})

  // Create the agent stream
  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder()
      const send = (obj: any) => {
        // v55: tee every event into the replay buffer (survives disconnects)
        pushEvent(runId, obj)
        try { ctrl.enqueue(enc.encode(JSON.stringify(obj) + '\n')) } catch {}
      }
      const isAborted = () => abortCtrl.signal.aborted

      // Pick the healthiest provider from the pool using the load balancer
      // (round-robin + skips cooldown/dead keys). Every call advances the
      // rotation, so parallel agents naturally spread across ALL keys.
      let lastPicked = -1
      function pickProvider(): PoolEntry {
        const ids = providers.map(p => p.id)
        const chosenId = loadBalancer.getNextKey(ids)
        const idx = chosenId ? providers.findIndex(p => p.id === chosenId) : -1
        const picked = idx >= 0 ? providers[idx] : providers[(lastPicked + 1) % providers.length]
        lastPicked = providers.indexOf(picked)
        loadBalancer.recordRequest(picked.id)
        return picked
      }

      const timers = new Set<ReturnType<typeof setTimeout>>()
      const sleep = (ms: number) => new Promise<void>(r => {
        const t = setTimeout(() => { timers.delete(t); r() }, ms)
        timers.add(t)
      })

      let completed = 0, failed = 0, filesWritten = 0
      let noFileWriters = 0

      // v55: quiet-period heartbeat so rejoining viewers know the stream is
      // alive (also proves the run continues with zero viewers attached)
      const heartbeatTimer = setInterval(() => {
        pushEvent(runId, { type: 'heartbeat', runId, ts: Date.now() })
      }, 4000)
      timers.add(heartbeatTimer as any)

      /** Bounded-concurrency worker pool. Runs `fn` over every item with at
       *  most `maxConcurrency` in flight. Aborts early when stopped. */
      async function runPool<T>(items: T[], fn: (item: T, i: number) => Promise<void>): Promise<void> {
        let next = 0
        const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, async () => {
          while (true) {
            if (isAborted()) return
            const i = next++
            if (i >= items.length) return
            try { await fn(items[i], i) } catch {}
          }
        })
        await Promise.all(workers)
      }

      // v55: DB-backed history — swarm runs now persist like single-agent runs
      let historyId: string | null = null
      try {
        send({ type: 'run_started', runId })
        try {
          const hist = await db.agentRun.create({
            data: {
              projectId,
              prompt: task.slice(0, 4000),
              status: 'running',
              model: 'swarm',
              provider: `pool:${providers.length}`, 
            },
          })
          historyId = hist.id
        } catch {}
        send({
          type: 'status',
          content: `Multi-agent system starting...\n\nTask: ${task}\n\nTeam:\n- ${counts.coordinator} Coordinator\n- ${counts.quality} Quality Checkers\n- ${counts.feature} Feature Checkers\n- ${counts.writer} Code Writers\n- ${counts.setup} Setup Agents\n\nTotal: ${counts.coordinator + counts.quality + counts.feature + counts.writer + counts.setup} agents\n\nProvider pool: ${providers.length} key(s) — ${JSON.stringify(poolSummary)}\nParallel slots: ${maxConcurrency}`,
        })
        send({ type: 'pool', total: providers.length, byKind: poolSummary, maxConcurrency, deduped: dedupedKeys })

        // Build the agent team
        const agents: AgentRole[] = []

        // (A) Coordinator
        for (let i = 0; i < counts.coordinator; i++) {
          agents.push({
            role: 'coordinator',
            id: `coordinator-${i}`,
            index: i,
            task: `Coordinate the team to build: ${task}`,
            systemPrompt: ROLE_PROMPTS.coordinator,
          })
        }

        // (B) Quality Checkers
        for (let i = 0; i < counts.quality; i++) {
          agents.push({
            role: 'quality',
            id: `quality-${i}`,
            index: i,
            task: `Audit code quality for: ${task}`,
            systemPrompt: ROLE_PROMPTS.quality,
          })
        }

        // (C) Feature Checkers
        for (let i = 0; i < counts.feature; i++) {
          agents.push({
            role: 'feature',
            id: `feature-${i}`,
            index: i,
            task: `Audit features for: ${task}`,
            systemPrompt: ROLE_PROMPTS.feature,
          })
        }

        // (D) Code Writers — the bulk of the team
        // Split the task into chunks so each writer works on a different part
        const writerChunks = splitTaskIntoChunks(task, counts.writer)
        for (let i = 0; i < counts.writer; i++) {
          agents.push({
            role: 'writer',
            id: `writer-${i}`,
            index: i,
            task: writerChunks[i] || `Write code for: ${task}`,
            systemPrompt: ROLE_PROMPTS.writer,
          })
        }

        // (E) Setup Agents
        const setupTasks = [
          'Check and install Node.js + npm if needed',
          'Check and install Flutter SDK + Dart if needed',
          'Check and install JDK + Android SDK if needed',
          'Check and install Python + pip if needed',
        ]
        for (let i = 0; i < counts.setup; i++) {
          agents.push({
            role: 'setup',
            id: `setup-${i}`,
            index: i,
            task: setupTasks[i] || `Setup environment for: ${task}`,
            systemPrompt: ROLE_PROMPTS.setup,
          })
        }

        // ─── Sticky key↔agent assignment ────────────────────────────────
        // Agent #i is bound to pool key #i (wraps around if fewer keys than
        // agents). With N keys the first N agents each get their OWN key —
        // all working together in parallel.
        agents.forEach((a, i) => {
          a.assignedKeyId = providers[i % providers.length]?.id
        })

        // ─── Leader agents (MAX 4) ─────────────────────────────────────
        // The user crowns up to 4 agents as LEADERS (in Quick API Setup →
        // Agents, persisted on the provider row; the roster crown mirrors it).
        // EVERY leader runs the planning phase and the plans are merged, so
        // e.g. Gemini+Groq+OpenRouter leaders each shape the battle plan.
        const rawIndexes: number[] = Array.isArray(config?.leaderIndexes) && config.leaderIndexes.length > 0
          ? config.leaderIndexes
          : (config?.leaderIndex !== undefined ? [config.leaderIndex] : [0])
        const leaderIndexes = Array.from(new Set(
          rawIndexes
            .map(i => clampInt(i, 0, 0, Math.max(0, agents.length - 1)))
            .slice(0, 4),
        ))
        const leaders = leaderIndexes.map(i => agents[i]).filter(Boolean)
        for (const l of leaders) l.isLeader = true

        send({
          type: 'status',
          content: `Team assembled: ${agents.length} agents ready. Launching with ${maxConcurrency} parallel slots...\n\n${agents.slice(0, 20).map(a => `  • ${a.id} (${a.role})`).join('\n')}${agents.length > 20 ? `\n  ... and ${agents.length - 20} more` : ''}`,
        })

        // v59: machine-readable team manifest — the UI's live progress bar,
        // ETA math and phase strip are driven by this event (real counts,
        // no text parsing).
        send({
          type: 'team',
          total: agents.length,
          counts: { coordinator: counts.coordinator, quality: counts.quality, feature: counts.feature, writer: counts.writer, setup: counts.setup },
          slots: maxConcurrency,
        })

        /** v55: race a provider chat against the run's abort signal. Some
         *  providers (the GLM SDK) ignore AbortSignal entirely — the owner
         *  presses Stop, the run must stop WAITING immediately even if the
         *  underlying call settles later in the background. */
        function abortableChat<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
          return new Promise<T>((resolve, reject) => {
            if (signal.aborted) { reject(new Error('Run stopped by user')); return }
            const onAbort = () => { cleanup(); reject(new Error('Run stopped by user')) }
            const cleanup = () => signal.removeEventListener('abort', onAbort)
            signal.addEventListener('abort', onAbort, { once: true })
            p.then(
              (v) => { cleanup(); resolve(v) },
              (e) => { cleanup(); reject(e) },
            )
          })
        }

        async function runAgentOnce(agent: AgentRole): Promise<{ ok: boolean; content: string; agentId: string }> {
          if (isAborted()) return { ok: false, content: 'stopped', agentId: agent.id }
          send({ type: 'agent_start', agentId: agent.id, role: agent.role, task: agent.task.slice(0, 100) })

          const tried = new Set<string>()
          let lastError = ''
          // Try EVERY distinct key in the pool before giving up — this is what
          // makes "agents keep working when a key 401s" real. Dead keys are
          // marked instantly by the balancer, so failed attempts are cheap.
          // Capped at 50 attempts for pathological pools.
          const maxAttempts = Math.max(3, Math.min(providers.length, 50))

          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (isAborted()) break

            // Attempt 0: use this agent's own sticky key first (true 1:1
            // key↔agent mapping — N keys = N agents each on their own key)
            let entry: PoolEntry | undefined
            if (attempt === 0 && agent.assignedKeyId) {
              const own = providers.find(p => p.id === agent.assignedKeyId)
              if (own) { entry = own; loadBalancer.recordRequest(own.id) }
            }
            if (!entry) {
              // Pick a provider that we haven't already failed with
              for (let probe = 0; probe < providers.length; probe++) {
                const candidate = pickProvider()
                if (!tried.has(candidate.id)) { entry = candidate; break }
              }
            }
            // No untried key left — the whole pool already failed for this
            // agent. Give up instead of pointlessly retrying a dead key.
            if (!entry) break
            tried.add(entry.id)

            const startedAt = Date.now()
            try {
              const timeoutSignal = AbortSignal.timeout(agentTimeoutMs)
              // Link the run's abort signal with the per-agent timeout AND
              // race the whole call against Stop (v55) — a provider that
              // ignores AbortSignal can no longer keep a stopped run alive
              const res = await abortableChat<ChatResponse>(
                entry.provider.chat(
                  [
                    { role: 'system', content: agent.systemPrompt },
                    { role: 'user', content: agent.task },
                  ],
                  {
                    temperature: 0.7,
                    maxTokens: 4000,
                    signal: abortCtrl.signal.aborted ? timeoutSignal : anySignal([abortCtrl.signal, timeoutSignal]),
                  },
                ),
                abortCtrl.signal,
              )

              loadBalancer.recordSuccess(entry.id, Date.now() - startedAt)
              completed++

              // v25 usage tracking — real provider/model/token numbers
              recordUsage({
                provider: entry.provider.displayName || entry.provider.kind || entry.id,
                model: (entry.provider as { model?: string }).model || '',
                tokensIn: res.tokensIn,
                tokensOut: res.tokensOut,
              }).catch(() => {})

              // v138 FORMAT RESCUE — small models love narrating ("I will now
              // edit…") instead of emitting === FILE: blocks. One strict
              // follow-up call converts their own plan into real file blocks.
              let writerContent = res.content || ''
              if (projectId && agent.role === 'writer' && writerContent && !writerContent.includes('=== FILE:')) {
                try {
                  const rescueSignal = anySignal([abortCtrl.signal, AbortSignal.timeout(60_000)])
                  const rescue = await abortableChat<ChatResponse>(
                    entry.provider.chat(
                      [
                        { role: 'system', content: agent.systemPrompt },
                        { role: 'user', content: agent.task },
                        { role: 'assistant', content: writerContent.slice(0, 6000) },
                        { role: 'user', content: WRITER_RESCUE_INSTRUCTION },
                      ],
                      { temperature: 0.2, maxTokens: 4000, signal: rescueSignal },
                    ),
                    abortCtrl.signal,
                  )
                  if (rescue?.content && rescue.content.includes('=== FILE:')) {
                    writerContent = rescue.content
                    send({ type: 'status', content: `🔧 ${agent.id} was narrating instead of writing files — a strict format-rescue round converted its plan into real file blocks.` })
                  }
                } catch { /* rescue is best-effort; the honesty guard below still reports 0 files */ }
              }

              // Writers previously only produced chat text that was discarded —
              // parse === FILE: path === blocks and write the files to disk.
              let written: string[] = []
              if (projectId && agent.role === 'writer' && writerContent) {
                written = writeAgentFiles(projectId, writerContent)
                warnTruncatedWriter(send, agent, writerContent)
                if (written.length > 0) {
                  filesWritten += written.length
                  send({ type: 'agent_update', agentId: agent.id, role: agent.role, status: 'files_written', content: `${written.length} file(s) written` })
                  send({ type: 'files_written', agentId: agent.id, count: written.length, paths: written.slice(0, 10) })
                } else {
                  // v138 honesty guard: the writer replied, but its output was
                  // prose/instructions with NO parseable file blocks — nothing
                  // landed on disk. Announce it instead of pretending success.
                  noFileWriters++
                  send({ type: 'agent_update', agentId: agent.id, role: agent.role, status: 'no_files', content: `${agent.id} produced NO parseable file blocks — reply was instructions, not === FILE: === content. Nothing was written.` })
                  send({ type: 'status', content: `⚠️ ${agent.id} wrote 0 files — its reply was narration instead of file blocks. The team lead should re-dispatch this package.` })
                }
              }
              // v59: short preview of what the agent actually produced —
              // powers the Agent Board detail popup (real output, capped)
              send({ type: 'agent_result', agentId: agent.id, role: agent.role, ok: true, provider: entry.name, model: entry.model, durationMs: Date.now() - startedAt, tokensOut: res.tokensOut, preview: (writerContent || '').slice(0, 300) })
              return { ok: true, content: writerContent || '', agentId: agent.id }
            } catch (e: any) {
              lastError = e?.message || 'unknown error'
              if (isAborted()) break

              /* ── BROWSER-DIRECT RELAY ─────────────────────────────────
               * The server's datacenter IP is Cloudflare-blocked by some
               * providers (Groq → 403 "Forbidden" for every key). The same
               * call from the USER'S DEVICE succeeds. Park the request, ask
               * the browser to perform it, and continue when it answers. */
              if (isRegionBlock(lastError)) {
                const direct = buildDirectChat(
                  entry,
                  [
                    { role: 'system', content: agent.systemPrompt },
                    { role: 'user', content: agent.task },
                  ],
                  { temperature: 0.7, maxTokens: 4000 },
                )
                if (direct) {
                  const reqId = `${runId}_${agent.id}_${attempt}_${Date.now().toString(36)}`
                  send({
                    type: 'llm_request', reqId, runId,
                    provider: { id: entry.id, name: entry.name, kind: entry.kind, model: entry.model },
                    request: { url: direct.url, headers: direct.headers, body: direct.body, style: direct.style },
                  })
                  const relay = await parkRelay(reqId, runId, entry.name, 120000)
                  if (relay.ok && relay.content !== undefined) {
                    loadBalancer.recordSuccess(entry.id, Date.now() - startedAt)
                    completed++
                    send({ type: 'relay_ok', agentId: agent.id, provider: entry.name, durationMs: Date.now() - startedAt })
                    let written: string[] = []
                    if (projectId && agent.role === 'writer' && relay.content) {
                      written = writeAgentFiles(projectId, relay.content)
                      warnTruncatedWriter(send, agent, relay.content)
                      if (written.length > 0) {
                        filesWritten += written.length
                        send({ type: 'agent_update', agentId: agent.id, role: agent.role, status: 'files_written', content: `${written.length} file(s) written` })
                        send({ type: 'files_written', agentId: agent.id, count: written.length, paths: written.slice(0, 10) })
                      } else {
                        noFileWriters++
                        send({ type: 'agent_update', agentId: agent.id, role: agent.role, status: 'no_files', content: `${agent.id} produced NO parseable file blocks — reply was instructions, not === FILE: === content. Nothing was written.` })
                        send({ type: 'status', content: `⚠️ ${agent.id} wrote 0 files — its reply was narration instead of file blocks. The team lead should re-dispatch this package.` })
                      }
                    }
                    send({ type: 'agent_result', agentId: agent.id, role: agent.role, ok: true, provider: `${entry.name} (via your device)`, model: entry.model, durationMs: Date.now() - startedAt, tokensOut: relay.tokensOut, preview: (relay.content || '').slice(0, 300) })
                    return { ok: true, content: relay.content, agentId: agent.id }
                  }
                  // Relay also failed — record and fall through to the next key
                  lastError = `device relay: ${relay.error || 'failed'}`
                  send({ type: 'relay_fail', agentId: agent.id, provider: entry.name, error: relay.error || 'failed' })
                }
              }

              loadBalancer.recordFailure(entry.id, lastError)
              const rateLimited = /429|rate.*limit|quota|overloaded/i.test(lastError)

              if (attempt < maxAttempts - 1) {
                send({
                  type: 'provider_switch',
                  agentId: agent.id,
                  from: entry.name,
                  reason: rateLimited ? 'rate limit — switching key' : lastError.slice(0, 120),
                })
                // Brief backoff before the next provider attempt
                await sleep(rateLimited ? 800 * (attempt + 1) : 250)
              }
            }
          }

          failed++
          send({ type: 'agent_result', agentId: agent.id, role: agent.role, ok: false, error: lastError.slice(0, 200) })
          return { ok: false, content: `Agent failed: ${lastError}`, agentId: agent.id }
        }

        /** Helper: run a phase through the bounded pool and gather results.
         *  Defined next to runAgentOnce so it resolves it lexically. */
        async function collect(list: AgentRole[]) {
          const out: { ok: boolean; content: string; agentId: string }[] = []
          await runPool(list, async (agent) => {
            const r = await runAgentOnce(agent)
            out.push(r)
          })
          return out
        }

        // ─── Phase 0: The LEADERS plan the battle (max 4) ─────────────────
        // Every crowned leader runs FIRST and produces its own battle plan;
        // the plans are MERGED and handed to every worker agent. If a leader's
        // own key fails, that leader still runs on the next healthy key (same
        // failover as every agent) — the planning phase never stalls.
        let leaderPlan = ''
        if (leaders.length > 0) {
          send({ type: 'phase', phase: 'leader', content: `\n👑 Phase 0: ${leaders.length} LEADER${leaders.length > 1 ? 'S' : ''} (${leaders.map(l => l.id).join(', ')}) ${leaders.length > 1 ? 'are' : 'is'} planning the attack` })
          const planParts: string[] = []
          for (let li = 0; li < leaders.length; li++) {
            const leader = leaders[li]
            if (isAborted()) break
            const planResult = await runAgentOnce({
              ...leader,
              task: `You are LEADER #${li + 1} of ${leaders.length} on a ${agents.length}-agent team. Produce a concise BATTLE PLAN for this task:\n\n${task}\n\nACTUAL PROJECT FILES (the project currently contains EXACTLY these files — plans must reference these real paths, never invented ones):\n${buildProjectFileList(projectId)}\n\nHARD REQUIREMENT${isEditStyleTask(task) ? ' — this is an EDIT/CHANGE task on an EXISTING project: the plan must cover ONLY the exact changes the task asks for. Do NOT invent new apps, panels or backends, do NOT rewrite the whole product — target the real files listed above.' : ' — the plan MUST cover the FULL PRODUCT: work packages for the USER app, a complete ADMIN panel, the BACKEND server (REST APIs + data persistence), shared auth, and a final SHARED INTEGRATION package (shared API client + README + seed data).'}\n\nThe plan is machine-parsed and handed to every worker agent. Output plain text:\nGOAL: one line\n1. <work package — self-contained, no overlaps, executable in parallel>\n2. <work package>\n…5-12 numbered packages, each starting on its own line as "N. text"…\nCONVENTIONS: one line (framework, folder layout, naming, shared API base path)`,
            })
            const part = (planResult.content || '').slice(0, 4000)
            if (part) {
              planParts.push(leaders.length > 1 ? `─── 👑 LEADER ${li + 1} (${leader.id}) ───\n${part}` : part)
              send({ type: 'leader_plan', agentId: leader.id, leaderNumber: li + 1, leaderCount: leaders.length, content: part })
            }
          }
          leaderPlan = planParts.join('\n\n').slice(0, 6000)
        }

        // Phase 1: Setup agents run first — they install SDKs
        send({ type: 'phase', phase: 'setup', content: `\n📦 Phase 1: SETUP (${counts.setup} agents installing SDKs)` })
        let phaseResults = await collect(agents.filter(a => a.role === 'setup'))
        const setupResults = phaseResults

        // Phase 2: Feature checkers run — they audit what's needed
        send({ type: 'phase', phase: 'feature', content: `\n🔍 Phase 2: FEATURE AUDIT (${counts.feature} agents checking features)` })
        const featureAgents = agents.filter(a => a.role === 'feature')
        const featureResults = await collect(featureAgents)
        const featureFindings = featureResults.map(r => r.content).join('\n\n---\n\n')

        if (isAborted()) throw new Error('Run stopped by user')

        // Phase 3: Code writers — bounded-concurrency swarm across ALL keys.
        // Every writer receives the LEADER's plan + ONE concrete work package.
        // v73 FIX: previously the leader plan was only PREPENDED while the
        // assignment stayed the generic static chunk ("Suggested area:
        // Notifications") — writers built code unrelated to the user's app
        // (the owner's "agents don't understand the prompt" bug). Now the
        // plan's numbered packages ARE the assignments (markdown-safe parse,
        // task-aware full-product fallback, variant briefs beyond cycle 1).
        send({ type: 'phase', phase: 'writers', content: `\n✍️ Phase 3: CODE WRITING (${counts.writer} writers, ${maxConcurrency} parallel slots, pool of ${providers.length} keys)` })
        const planPackages = parsePlanPackages(leaderPlan)
        const effPackages = planPackages.length > 0 ? planPackages : fallbackWorkPackages(task)
        const writerAgents = agents
          .filter(a => a.role === 'writer')
          .map((a, i) => {
            const cycle = Math.floor(i / effPackages.length)
            const pkg = effPackages[i % effPackages.length]
            const variantNote = cycle > 0
              ? `\nVARIANT ${cycle + 1}: another agent already built the base of this package. Go WIDER — add NEW screens/endpoints/features in this area with DIFFERENT file paths (suffix -v${cycle + 1} or submodule folder). Never rewrite existing files.`
              : ''
            const assignment = `${planPackages.length > 0 ? `LEADER'S PLAN (follow its conventions):\n${leaderPlan}\n\n` : ''}YOUR ASSIGNMENT — work package ${i + 1} of ${counts.writer}:\n${pkg}${variantNote}\n\nOriginal task: ${task}\n\nACTUAL PROJECT FILES (the project contains EXACTLY these files — edit THESE real paths; never invent paths like "User App/src/…" or "dist/…"):\n${buildProjectFileList(projectId)}`
            return { ...a, task: assignment }
          })
        let writerDone = 0
        await runPool(writerAgents, async (agent) => {
          const r = await runAgentOnce(agent)
          writerDone++
          if (writerDone % 10 === 0 || writerDone === writerAgents.length) {
            send({ type: 'batch_done', completed: writerDone, total: writerAgents.length, filesWritten, failed })
          }
          void r
        })
        const writerCount = writerDone

        if (isAborted()) throw new Error('Run stopped by user')

        // Phase 4: Quality checkers audit the written code
        send({ type: 'phase', phase: 'quality', content: `\n🛡️ Phase 4: QUALITY AUDIT (${counts.quality} agents checking code)` })
        const qualityResults = await collect(agents.filter(a => a.role === 'quality'))
        const qualityIssues = qualityResults.flatMap(r => {
          try {
            return JSON.parse(r.content)?.issues || []
          } catch { return [] }
        })

        // Phase 5: LEADER summarizes (falls back to any coordinator)
        send({ type: 'phase', phase: 'coordinate', content: `\n🎯 Phase 5: FINAL SUMMARY BY THE LEADER` })
        const coordinator = agents.find(a => a.isLeader) || agents.find(a => a.role === 'coordinator')
        if (coordinator) {
          const summaryPrompt = `Summarize the work done by your team:

Task: ${task}

Setup results: ${setupResults.length} agents completed
Feature findings: ${featureFindings.slice(0, 2000)}
Code writers completed: ${writerCount}/${counts.writer}
Quality issues found: ${qualityIssues.length}

Provide a final summary to the user.`
          const summary = await runAgentOnce({ ...coordinator, task: summaryPrompt })
          send({ type: 'coordinator_summary', content: summary.content })
        }

        const summary = `Multi-agent run ${isAborted() ? 'STOPPED' : 'completed'}.\n\n- Setup: ${setupResults.length} agents\n- Features audited: ${featureResults.length}\n- Code writers completed: ${writerCount}/${counts.writer}\n- Files written: ${filesWritten}${noFileWriters > 0 ? `\n- ⚠ Writers that produced NO files: ${noFileWriters} (replies were narration, not file blocks)` : ''}\n- Quality issues: ${qualityIssues.length}\n- Succeeded: ${completed} · Failed: ${failed}\n- Coordinator summary: ${coordinator ? 'provided' : 'skipped'}`
        send({ type: 'done', ok: !isAborted(), content: summary })
      } catch (e: any) {
        send({ type: 'error', content: e.message })
        send({ type: 'done', ok: false, content: `Run ended: ${e.message}` })
      } finally {
        for (const t of timers) clearTimeout(t)
        failRelaysOfRun(runId, 'run finished or stopped')
        activeRuns.delete(runId)
        // v55: finalize the DB history row (honest verdict)
        try {
          const hid = historyId
          if (hid) {
            const finalStatus = isAborted() ? 'stopped' : (failed > 0 && completed === 0 ? 'failed' : 'completed')
            await db.agentRun.update({
              where: { id: hid },
              data: {
                status: finalStatus,
                toolCalls: filesWritten,
                response: `swarm · ${completed} ok / ${failed} failed · ${filesWritten} files`,
              },
            })
            // v60: owner webhook — one fire-and-forget POST per finished run
            notifyRunFinishedWebhook({
              kind: 'swarm',
              runId,
              projectId: String(projectId),
              status: finalStatus,
              ok: finalStatus === 'completed',
              prompt: String(task).slice(0, 500),
              summary: `swarm · ${completed} ok / ${failed} failed · ${filesWritten} files`,
              files: filesWritten,
            })
          }
        } catch {}
        try { ctrl.close() } catch {}
      }
    },
    cancel() {
      // v55 Unbreakable Army: viewer left ≠ run dies. The swarm KEEPS going
      // server-side; viewers rejoin via action:'rejoin' with the runId.
      // Stopping is ONLY possible through the explicit Stop button
      // (action:'stop'), exactly like single-agent runs.
      detachViewer(runId)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

/** Combine multiple AbortSignals (Node 20+/Edge safe). */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  for (const s of signals) {
    if (s.aborted) { ctrl.abort(); break }
    s.addEventListener('abort', onAbort, { once: true })
  }
  return ctrl.signal
}

function clampInt(v: any, def: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def
  return Math.max(min, Math.min(max, n))
}

/**
 * v138 — the strict follow-up for the writer format-rescue round. Fed back
 * to a writer that replied with narration instead of file blocks.
 */
const WRITER_RESCUE_INSTRUCTION = `Your previous reply described STEPS instead of writing files — but you are a CODE WRITER agent: the platform writes files to disk by parsing your reply. Respond NOW with ONLY the complete file block(s), in exactly this format:

=== FILE: relative/path.ext ===
<complete final file content>
=== END FILE ===

One block per file. No steps, no narration, no explanations — ONLY file blocks with the FULL final content. Convert the plan you just described into these blocks now.`

/**
 * v138 — REAL file list of the project, for grounding leaders and writers.
 * Without it the team invents paths ("User App/src/index.html") that never
 * exist on disk, so perfectly-written code lands nowhere.
 */
function buildProjectFileList(projectId: string): string {
  try {
    const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.snapshots'])
    const out: string[] = []
    const walk = (node: any, prefix: string) => {
      const children: any[] = node?.children || []
      for (const c of children) {
        const p = prefix ? `${prefix}/${c.name}` : c.name
        if (c.type === 'dir') {
          if (SKIP.has(c.name)) continue
          walk(c, p)
        } else {
          out.push(p)
        }
      }
    }
    walk(storage.listTree(projectId), '')
    const capped = out.slice(0, 60)
    if (capped.length === 0) return '(the project is EMPTY — create the files it needs)'
    return capped.join('\n') + (out.length > 60 ? `\n… (+${out.length - 60} more files)` : '')
  } catch {
    return '(file list unavailable)'
  }
}

/** v138 — edit/change style tasks get a lean leader plan that touches ONLY
 *  the real files; full-product builds keep the original HARD REQUIREMENT. */
function isEditStyleTask(task: string): boolean {
  const t = (task || '').toLowerCase()
  if (t.length > 600) return false
  return /\b(edit|change|update|fix|modify|rename|replace|remove|delete)\b/.test(t)
}

/**
 * Parse === FILE: path === ... === END FILE === blocks from a writer's
 * response and persist each one to the project (disk + DB mirror).
 * Returns the list of paths successfully written.
 */
function writeAgentFiles(projectId: string, content: string): string[] {
  const written: string[] = []
  const seen = new Set<string>()

  const writeOne = (rawPath: string, fileContent: string) => {
    // strip decorative wrappers the models like to add (**, `, quotes, leading ./)
    const p = String(rawPath)
      .trim()
      .replace(/^\*\*|\*\*$/g, '')
      .replace(/^[`'"\(<]+|[`'"\)>:]+$/g, '')
      .replace(/^\.?\//, '')
      .trim()
    if (!p || p.includes('..') || p.includes('//') || p.toLowerCase().startsWith('http')) return
    if (!/^[A-Za-z0-9][\w./@-]*$/.test(p)) return
    if (seen.has(p)) return
    try {
      storage.writeFile(projectId, p, fileContent)
      db.file.upsert({
        where: { projectId_path: { projectId, path: p } },
        create: { projectId, path: p, content: fileContent, isDir: false },
        update: { content: fileContent },
      }).catch(() => {})
      written.push(p)
      seen.add(p)
    } catch {}
  }

  // 1) Canonical === FILE: path === … === END FILE === blocks (the mandated format)
  const re = /=== FILE:\s*([^=\n]+?)\s*===\n([\s\S]*?)\n=== END FILE ===/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) writeOne(m[1], m[2])
  if (written.length > 0) return written

  // 2) v138 fallback A — a path line immediately followed by a fenced block.
  //    Writers ignoring the canonical format usually emit exactly this shape:
  //    "**index.html**\n```html …```" · "#### lib/main.dart\n```dart …```" · "`app.py`:\n```python …```"
  const fenceA = /(?:^|\n)[^\S\n]*(?:\*\*|#{2,4}\s*|`)([\w./@-]+\.[A-Za-z0-9]{1,8})(?:\*\*|`|:)?\s*:?[^\S\n]*\n+[^\S\n]*```[A-Za-z0-9]*[^\S\n]*\n([\s\S]*?)```/g
  while ((m = fenceA.exec(content)) !== null) writeOne(m[1], m[2])
  if (written.length > 0) return written

  // 3) v138 fallback B — a filepath comment as the first line inside a fence:
  //    ```html\n<!-- filepath: index.html -->\n…   /   ```py\n# file: app.py\n…
  const fenceB = /```[A-Za-z0-9]*[^\S\n]*\n[^\S\n]*(?:\/\/|#|<!--|\/\*)[^\S\n]*(?:filepath|file|path)\s*[:=][^\S\n]*([\w./@-]+\.[A-Za-z0-9]{1,8})\s*(?:-->|\*\/)?[^\S\n]*\n([\s\S]*?)```/g
  while ((m = fenceB.exec(content)) !== null) writeOne(m[1], m[2])

  return written
}

/**
 * v73: honesty guard — a writer whose response was cut by the token cap
 * loses every incomplete `=== FILE:` block (no `=== END FILE ===` closer =
 * silently discarded). Announce it instead of pretending the file landed.
 */
function warnTruncatedWriter(
  send: (obj: any) => void,
  agent: { id: string; role: string },
  content: string,
) {
  try {
    const starts = (content.match(/=== FILE:/g) || []).length
    const ends = (content.match(/=== END FILE ===/g) || []).length
    if (starts > ends) {
      send({
        type: 'status',
        content: `⚠️ ${agent.id}'s output hit the token cap — ${starts - ends} file block(s) were cut off and NOT written. Re-run that agent or ask it to continue (it should split big files into smaller modules).`,
      })
    }
  } catch {}
}

/**
 * v73: markdown-safe numbered-package parser for leader plans.
 * Matches `1. text`, `1) text`, `**1.** text`, `- 1. text` — the old inline
 * filter missed most real leader output, so writers got no plan packages.
 */
function parsePlanPackages(plan: string): string[] {
  if (!plan) return []
  return plan.split('\n').map(l => l.trim())
    .map(l => l.replace(/^[-*•]\s*/, '').replace(/^\*\*/, ''))
    .filter(l => /^\d+\s*[.)]\s*/.test(l))
    .map(l => l.replace(/^\d+\s*[.)]\s*/, '').replace(/\*\*/g, '').replace(/\s*—\s*$/, '').trim())
    .filter(l => l.length > 3 && !/^the goal/i.test(l))
}

/**
 * v73: task-aware FULL-PRODUCT fallback when the leader plan produced no
 * parseable packages. Replaces the old static component list (the first
 * packages now guarantee user app + admin + server, not "Notifications").
 */
function fallbackWorkPackages(task: string): string[] {
  const t = (task || '').toLowerCase()
  const mobileish = /flutter|dart|mobile|android|ios|react native|capacitor/.test(t)
  const appWord = mobileish ? 'Flutter app' : 'web app'
  const extras = [
    'Search/filter functionality',
    'Detail/view page for items',
    'Create/edit form for items',
    'List/grid view with pagination',
    'Real-time chat/messaging',
    'File upload (photos, videos, documents)',
    'Notifications (in-app + push)',
    'Analytics and event tracking',
    'Offline support and caching',
    'State management (store, context, reducers)',
    'Reusable UI components (buttons, inputs, cards, modals)',
    'Error handling and loading states',
  ]
  return [
    `BACKEND SERVER: real server (Express/Next API/FastAPI per stack) with REST APIs for every entity of this product — auth (register/login/JWT), CRUD, admin-only endpoints, data persistence (SQLite/Prisma or JSON file DB), CORS + /health. Folder: server/.`,
    `USER APP core: the ${appWord} for END USERS of: ${task.slice(0, 180)} — onboarding/auth wired to the server API, home/browse, detail, and the core action flow. Complete, styled, responsive. Folder: app/ (Flutter: lib/user/ + pubspec.yaml + lib/main.dart complete).`,
    `ADMIN PANEL: complete admin app for the SAME product — admin login (role check), dashboard with real stats, CRUD tables for every entity, user/order/content management, settings. Folder: admin/ (Flutter: lib/admin/).`,
    `USER APP extended: ${extras.slice(0, 6).join('; ')} — as applicable to this product. All data via the server API, no fake data. Folder: app/ (Flutter: lib/user/).`,
    `SHARED INFRA + DOCS: shared API client both apps import; seed data script; README.md with run commands for server + user app + admin, API list, seeded admin credentials (admin@local / changeme).`,
    ...extras.slice(6).map(x => `${x} — implement for this product (${task.slice(0, 120)}) in the appropriate part (user app, admin, or server).`),
  ]
}

/**
 * Split a large task into N chunks so each code writer works on a different part.
 * This ensures parallel writers don't duplicate work. Works for ANY task —
 * app builds get the suggested component areas; other tasks (docs, tests,
 * refactors) get a "pick your own unique part" instruction.
 */
function splitTaskIntoChunks(task: string, n: number): string[] {
  const chunks: string[] = []
  if (n <= 0) return chunks

  // v73: FULL-PRODUCT component areas — the first four guarantee every app
  // ships user app + admin + server; feature areas follow. (The old list
  // started at "User authentication" and buried admin deep at #13.)
  const components = [
    'BACKEND SERVER: REST API server with auth (register/login/JWT), CRUD endpoints for the product\'s entities, admin-only endpoints, data persistence, CORS, /health — folder server/',
    'USER APP screens: onboarding/login/register + home/browse + detail + the core action flow, all wired to the server API — folder app/ (Flutter: lib/user/)',
    'ADMIN PANEL: admin login (role check) + dashboard with real stats + CRUD tables for every entity + settings — folder admin/ (Flutter: lib/admin/)',
    'SHARED INFRA: API client module both apps import, DB schema/models, seed data, README.md with run commands + API list + admin credentials',
    'User profile page (view, edit, avatar upload)',
    'Navigation (sidebar, bottom nav, routing)',
    'Search functionality (search bar, filters, results)',
    'List/grid view with pagination',
    'Create/edit form for items',
    'Settings page (theme, language, notifications)',
    'Notifications (in-app + push)',
    'Real-time chat/messaging',
    'File upload (photos, videos, documents)',
    'State management (store, context, reducers)',
    'Reusable UI components (buttons, inputs, cards, modals)',
    'Error handling and loading states',
    'Offline support and caching',
    'Analytics and event tracking',
  ]

  for (let i = 0; i < n; i++) {
    const component = components[i % components.length]
    const variant = Math.floor(i / components.length)
    const hint = variant > 0
      ? `Suggested area: ${component} (variant ${variant + 1} — take a genuinely different angle than earlier variants)`
      : `Suggested area: ${component}`
    chunks.push(
      `You are writer #${i + 1} of ${n} on a parallel team. Implement ONE self-contained part of the task below — do NOT duplicate other writers' work.\n\nTask: ${task}\n\n${hint}\n\nIf the suggested area does not apply to this task, choose another part that does and write it COMPLETELY (remember the === FILE: === output format).`
    )
  }

  return chunks
}
