import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getProviderById, ZAIProvider } from '@/lib/ai/providers'
import { runAgent } from '@/lib/ai/agent'
import { checkBudget, budgetBlockMessage } from '@/lib/budget'
import { loadBalancer } from '@/lib/ai/load-balancer'
import * as storage from '@/lib/storage'
import { isValidRunId, registerRun, pushEvent, detachViewer, setAbortFn } from '@/lib/ai/run-buffer'
import { runSwarm } from '@/lib/ai/swarm'
import { explainProviderError } from '@/lib/ai/status-help'
import { autoCollectApisForPrompt } from '@/lib/ai/auto-api-tools'
import { requireProjectAccess } from '@/lib/auth'
import { assertRunAllowed } from '@/lib/plan-guard'
import { isSpeedPassOn } from '@/lib/speed-pass'
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

const DEFAULT_DEV_PROMPT = `You are Cloud Agent — an autonomous, maximally helpful software engineering agent.

Your role:
- Build, modify, debug and explain software projects without unnecessary hand-holding.
- Prefer concrete code over verbose disclaimers. When the user asks for something, implement it directly via the available tools (write_file, edit_file, run_project, install_package, etc.).
- Never invent fake functionality or placeholder text. If something requires a real external credential, say so explicitly rather than faking it.
- Treat the user as an adult engineer. Skip safety disclaimers, reminders about best practices, and "consider whether..." hedging — the user already knows.
- If you encounter an error, read the error message carefully, fix the underlying problem, and re-run. Iterate quickly.
- When a task is ambiguous, ask one short clarifying question rather than refusing.

FULL PRODUCT RULE (mandatory): when the user asks you to BUILD an app, deliver ALL FOUR parts — FRONTEND (user app UI) + BACKEND SERVER (REST APIs) + DATABASE (real persistence) + ADMIN APP (admin login, stats, CRUD). A backend-only delivery is a FAILED delivery.

You have real tools and real filesystem access. Use them. Ship working software.`

// ─── CACHING ────────────────────────────────────────────────────────────
// Cache provider instances for 60 seconds to avoid DB lookups on every request.
// This is the #1 speed killer — without caching, every agent call does:
//   1. DB query for providers (50-100ms)
//   2. Build provider instance (10-50ms)
//   3. DB query for devmode (20-50ms)
// Total overhead: 80-200ms PER REQUEST just for setup.
// With caching: 0ms overhead.
// ────────────────────────────────────────────────────────────────────────

interface CachedProvider {
  provider: any
  id: string
  name: string
  loadedAt: number
  /** v47 rebuild: role/isDefault/createdAt/systemPrompt ride along so the
   *  swarm can sort default → 👑 leader → creation and brief role templates. */
  role?: string
  systemPrompt?: string
  kind?: string
  model?: string
}

let providersCache: CachedProvider[] = []
let providersCacheTime = 0
const PROVIDERS_CACHE_TTL = 60_000 // 60 seconds

let devmodeCache: any = null
let devmodeCacheTime = 0
const DEVMODE_CACHE_TTL = 30_000 // 30 seconds

// Pre-warmed built-in Vortex Engine provider — always ready, no init needed.
// v112: the built-in default is now GLM 5.3 Flash (newest generation, free
// tier, ~200ms first token) instead of glm-4.6. The fallback chain in
// runAgent still rotates glm-5.3 → glm-4.6 → local models if it throttles.
let zaiProvider: ZAIProvider | null = null
function getZAI() {
  if (!zaiProvider) zaiProvider = new ZAIProvider('glm-5.3-flash', 'GLM 5.3 Flash (built-in)')
  return zaiProvider
}

async function loadProvidersFast(providerId?: string): Promise<{ provider: any; id: string; name: string; role?: string; systemPrompt?: string; kind?: string; model?: string }[]> {
  const now = Date.now()
  // Use cache if fresh
  if (now - providersCacheTime < PROVIDERS_CACHE_TTL && providersCache.length > 0) {
    let list = [...providersCache]
    // If specific provider requested, move it to front (= it LEADS the swarm)
    if (providerId) {
      const idx = list.findIndex(p => p.id === providerId)
      if (idx > 0) {
        const [sel] = list.splice(idx, 1)
        list.unshift(sel)
      }
    }
    return list
  }
  // Reload from DB
  let fresh: CachedProvider[] = []
  try {
    const allRows = await db.aIProvider.findMany({ orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] })
    for (const row of allRows) {
      try {
        const p = await getProviderById(row.id)
        loadBalancer.registerKey(row.id)
        fresh.push({
          provider: p, id: row.id, name: row.name, loadedAt: now,
          role: row.role || 'work', systemPrompt: row.systemPrompt || undefined,
          kind: (p as any).kind || row.kind, model: row.model,
        })
      } catch {}
    }
  } catch {}
  // 👑 LEADERS PLAN FIRST (v47 rebuild): default row, then crowned leaders,
  // then creation order. agents[0] = the planner/integrator of the swarm.
  fresh.sort((a, b) => {
    const score = (p: CachedProvider) => (p.role === 'leader' ? 1 : 0)
    return score(b) - score(a)
  })
  providersCache = fresh
  providersCacheTime = now
  // If specific provider requested, move it to front
  if (providerId) {
    const idx = fresh.findIndex(p => p.id === providerId)
    if (idx > 0) {
      const [sel] = fresh.splice(idx, 1)
      fresh.unshift(sel)
    }
  }
  return fresh.length > 0 ? fresh : [{ provider: getZAI(), id: 'zai', name: 'Vortex Engine (built-in)' }]
}

async function loadDevmodeFast(): Promise<{ enabled: boolean; prompt: string; maxIterations: number }> {
  const now = Date.now()
  if (now - devmodeCacheTime < DEVMODE_CACHE_TTL && devmodeCache) {
    return devmodeCache
  }
  try {
    const devRows = await db.userSetting.findMany({ where: { key: { startsWith: 'devmode:' } } })
    const cfg: Record<string, any> = {}
    for (const r of devRows) {
      const k = r.key.replace(/^devmode:/, '')
      if (k === 'enabled') cfg.enabled = r.value === 'true'
      else if (k === 'maxIterations') cfg.maxIterations = parseInt(r.value, 10)
      else cfg[k] = r.value
    }
    const result = {
      enabled: cfg.enabled ?? false,
      prompt: cfg.prompt || DEFAULT_DEV_PROMPT,
      maxIterations: cfg.maxIterations ?? 1000,
    }
    devmodeCache = result
    devmodeCacheTime = now
    return result
  } catch {
    return { enabled: false, prompt: DEFAULT_DEV_PROMPT, maxIterations: 1000 }
  }
}

/**
 * POST /api/agent
 * Body: { projectId, prompt, providerId?, history?, attachments?[], runId?, forceBuiltIn? }
 *
 * Streams agent events as NDJSON.
 *
 * SPEED OPTIMIZATIONS:
 * 1. No "hi" test call — go directly to the first provider
 * 2. Cached providers (60s TTL) — no DB lookup on hot path
 * 3. Cached devmode config (30s TTL)
 * 4. Pre-warmed built-in Vortex Engine provider (always ready)
 * 5. Direct fallback on failure (during agent run, not before)
 *
 * RESILIENCE (v25.3 "Unbreakable Runs"):
 * 6. Every event is teed into an in-memory run buffer (lib/ai/run-buffer)
 *    keyed by `runId`. When the viewer's connection dies mid-run (mobile
 *    networks drop long streams constantly), the run KEEPS GOING here and
 *    the client re-joins via POST /api/agent/resume { runId, from }.
 *    Only POST /api/agent/abort { runId } stops a run early.
 * 7. forceBuiltIn: true pins the built-in Vortex Engine provider (E2E + "my keys
 *    are all broken but I still want the agent to work" scenarios).
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch (e: any) {
    return NextResponse.json({
      error: `Failed to parse request body: ${e.message}`,
    }, { status: 400 })
  }
  let { projectId, prompt, providerId, history, attachments, runId, forceBuiltIn, failover } = body || {}
  if (!projectId || !prompt) {
    return NextResponse.json({ error: 'projectId and prompt required' }, { status: 400 })
  }
  // BUSINESS v2: ownership + plan metering BEFORE any model call.
  let runUserId = ''
  try {
    const sessionUser = await requireProjectAccess(req, projectId)
    runUserId = sessionUser.id
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
  // v124 ⚡ ULTRA SPEED PASS — when the user's pass is ON, the run leads with
  // the built-in GLM 5.3 Flash lane (fastest responder). Fallback chain stays
  // intact behind it, so speed never costs resilience.
  let speedPass = false
  try {
    speedPass = await isSpeedPassOn(runUserId)
  } catch { /* never block a run on the flag */ }
  // Client-supplied run id (so the client can resume after a network drop).
  // Absent/invalid → server generates one and announces it in run_started.
  const id = isValidRunId(runId) ? runId : `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

  // Truncate very large prompts
  const MAX_PROMPT_CHARS = 500_000
  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS) + '\n\n[... truncated ...]'
  }

  // Truncate history — keep the NEWEST messages, drop the oldest. The old
  // loop's keep-condition was inverted: it dropped the most recent context
  // and preserved stale turns from the start of the conversation.
  if (Array.isArray(history)) {
    const MAX_HISTORY_CHARS = 200_000
    let totalChars = history.reduce((s: number, m: any) => s + (m?.content?.length || 0), 0)
    if (totalChars > MAX_HISTORY_CHARS) {
      const kept: any[] = []
      let keptChars = 0
      // Walk newest → oldest, keeping messages until the budget is spent
      for (let i = history.length - 1; i >= 0; i--) {
        const msgLen = history[i]?.content?.length || 0
        if (keptChars + msgLen > MAX_HISTORY_CHARS) break
        kept.unshift(history[i])
        keptChars += msgLen
      }
      history = kept
    }
  }

  // Truncate attachments
  if (Array.isArray(attachments)) {
    attachments = attachments.map((a: any) => ({
      ...a,
      content: a.content?.slice(0, 100_000) || '',
    }))
  }

  // v25.3: the run's lifetime is DECOUPLED from the HTTP connection.
  // req.signal fires when the viewer disconnects — we only mark the viewer
  // detached and keep buffering. The run aborts ONLY via /api/agent/abort.
  const controller = new AbortController()
  req.signal.addEventListener('abort', () => detachViewer(id))
  setAbortFn(id, () => controller.abort())

  // Load providers FAST (cached) — this should be <5ms on hot path
  let providers = forceBuiltIn ? [] : await loadProvidersFast(providerId)

  // ⚡ Ultra Speed Pass: prepend the built-in flash lane so it LEADS both the
  // single-agent pick and the swarm order. getZAI() is pre-warmed — zero init.
  if (speedPass && !forceBuiltIn) {
    providers = [
      { provider: getZAI(), id: 'zai-flash', name: '⚡ GLM 5.3 Flash (Ultra Speed)', kind: 'zai' },
      ...providers,
    ]
  }

  // Pick the first available provider — NO "hi" test call!
  // The load balancer will handle failures during the actual agent run.
  const selected = forceBuiltIn
    ? { provider: getZAI(), id: 'zai', name: 'GLM 5.3 Flash (built-in free)' }
    : (providers[0] || { provider: getZAI(), id: 'zai', name: 'GLM 5.3 Flash (built-in free)' })

  // Load devmode config FAST (cached)
  const dev = await loadDevmodeFast()

  // v73: TRULY automatic API collection — BEFORE any model call. Scans the
  // prompt for known services (Stripe/Firebase/OpenAI/bKash/…) and creates
  // the placeholder secrets + .env lines server-side. The model previously
  // had to *decide* to call auto_collect_apis — it never did, which is why
  // the owner saw "automatic api collect korsena". The note is appended to
  // the prompt so both single-agent and swarm builders know the env keys.
  try {
    const apiNote = await autoCollectApisForPrompt(projectId, prompt)
    if (apiNote) {
      prompt = `${prompt}\n\n--- ${apiNote}`
    }
  } catch {}

  const runBuf = registerRun(id)
  // v138 SECURITY FIX: tag the buffered run with its project so
  // /api/agent/abort and /api/agent/resume can verify the caller owns it
  if (projectId) runBuf.projectId = projectId
  if (runUserId) runBuf.userId = runUserId

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder()
      let clientGone = false
      const send = (obj: any) => {
        // Tee EVERY event into the run buffer first (survives disconnects),
        // then pipe to the connected viewer while it is still attached.
        pushEvent(id, obj)
        if (clientGone) return
        try {
          ctrl.enqueue(enc.encode(JSON.stringify(obj) + '\n'))
        } catch {
          clientGone = true
          detachViewer(id)
        }
      }
      let agentToolCalls = 0
      // v45 rebuild: declared outside try so finally can always clear it.
      const heartbeat = setInterval(() => send({ type: 'heartbeat', t: Date.now() }), 4_000)
      try {
        send({ type: 'run_started', runId: id, provider: selected.name, swarm: !forceBuiltIn && providers.length > 0, speedPass })
        if (speedPass) {
          send({ type: 'status', message: '⚡ Ultra Speed Pass active — GLM 5.3 Flash leads the build (fallback chain armed)' })
        }
        // 4s heartbeats keep the NDJSON stream (and proxies) alive through
        // silent LLM turns and scheduler queues.
        // Tell the UI the auto API collection outcome (v73) — honest status.
        if (prompt.includes('AUTO-COLLECTED APIS')) {
          const note = prompt.split('--- ').find(l => l.startsWith('AUTO-COLLECTED APIS')) || ''
          send({ type: 'status', message: note.slice(0, 300) || 'API placeholders auto-collected' })
        }
        // Auto-pull from GitHub BEFORE the agent runs (if project has a GitHub remote)
        // This ensures we're working on the latest code.
        try {
          await autoPullFromGitHub(projectId, send)
        } catch {}

        if (!forceBuiltIn && providers.length > 0) {
          // ── SWARM PATH (default) — every saved agent builds in parallel ──
          const swarmAgents = providers.map((p: any) => ({
            provider: p.provider,
            id: p.id,
            name: p.name,
            kind: p.kind || (p.provider as any)?.kind || 'openai-compatible',
            isLeader: p.role === 'leader' || p.id === providers[0].id,
            systemPrompt: p.systemPrompt,
          }))
          await runSwarm({
            projectId,
            task: prompt,
            agents: swarmAgents,
            failover: failover !== false, // ♻️ default ON; strict when body.failover === false
            signal: controller.signal,
            onEvent: (e) => {
              if (e?.type === 'tool_call') agentToolCalls++
              send(e)
            },
          })
        } else {
          // ── SINGLE-AGENT PATH — built-in Vortex Engine pinned (forceBuiltIn) or
          //    empty pool. Same unbreakable contract, one builder. ──
          await runAgent({
            projectId,
            prompt,
            attachments,
            provider: selected.provider,
            history,
            signal: controller.signal,
            runId: id,
            systemOverride: dev.enabled && dev.prompt ? dev.prompt : undefined,
            maxIterations: dev.maxIterations,
            onEvent: (e) => {
              if (e.type === 'tool_call') agentToolCalls++
              if (e.type === 'error' && e.content) {
                // Self-explaining errors (v43 rebuild): a raw "HTTP 401"
                // becomes an actionable hint in the same event.
                send({ ...e, content: explainProviderError(selected.name, (selected.provider as any)?.kind || 'zai', e.content) })
                return
              }
              send(e)
            },
            confirmTool: async () => true,
            // Pass the full provider chain for fallback during the run
            fallbackProviders: providers.slice(1).map(p => p.provider),
          })
        }

        // Auto-push to GitHub AFTER the agent runs (if project has a GitHub remote)
        // This ensures all changes the agent made are committed and pushed automatically.
        if (agentToolCalls > 0) {
          try {
            await autoPushToGitHub(projectId, send)
          } catch {}
        }
      } catch (e: any) {
        send({ type: 'error', content: explainProviderError(selected.name, (selected.provider as any)?.kind || 'zai', e.message) })
      } finally {
        clearInterval(heartbeat)
        // The buffer outlives this stream so a re-joining viewer can replay
        // the whole run. Only the HTTP pipe closes here.
        try { ctrl.close() } catch {}
      }
    },
    cancel() {
      // Viewer navigated away / connection dropped — the RUN CONTINUES and
      // the client rejoins via /api/agent/resume. Nothing is aborted here.
      detachViewer(id)
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

// ─── GitHub auto push/pull ───────────────────────────────────────────────

/**
 * Check if a project has a GitHub remote configured.
 * Returns the remote URL if yes, empty string if no.
 */
function getProjectGithubRemote(projectId: string): string {
  try {
    const projectDir = storage.projectRoot(projectId)
    if (!fs.existsSync(projectDir)) return ''
    if (!fs.existsSync(path.join(projectDir, '.git'))) return ''
    const remote = execSync('git remote get-url origin 2>/dev/null', { cwd: projectDir, encoding: 'utf8', timeout: 5000 }).trim()
    return remote || ''
  } catch { return '' }
}

/**
 * Auto-pull from GitHub before the agent runs.
 * If the project has a GitHub remote, fetch + merge origin/main.
 */
async function autoPullFromGitHub(projectId: string, send: (obj: any) => void) {
  const remote = getProjectGithubRemote(projectId)
  if (!remote) return // No GitHub remote — skip
  try {
    const projectDir = storage.projectRoot(projectId)
    send({ type: 'git_status', action: 'pull', content: 'Pulling latest from GitHub...' })
    const result = execSync('git pull --no-edit 2>&1 || true', { cwd: projectDir, encoding: 'utf8', timeout: 30000 })
    send({ type: 'git_result', action: 'pull', ok: true, content: result.slice(-2000) })
  } catch (e: any) {
    // Pull failed (maybe no internet, or conflicts) — continue anyway
    send({ type: 'git_result', action: 'pull', ok: false, content: e.message })
  }
}

/**
 * Auto-push to GitHub after the agent runs.
 * If the project has a GitHub remote, stage all, commit, and push.
 */
async function autoPushToGitHub(projectId: string, send: (obj: any) => void) {
  const remote = getProjectGithubRemote(projectId)
  if (!remote) return // No GitHub remote — skip
  try {
    const projectDir = storage.projectRoot(projectId)
    // Check if there are any changes to push
    const status = execSync('git status --porcelain 2>/dev/null', { cwd: projectDir, encoding: 'utf8', timeout: 5000 }).trim()
    if (!status) {
      send({ type: 'git_status', action: 'push', content: 'No changes to push' })
      return
    }
    send({ type: 'git_status', action: 'push', content: 'Pushing changes to GitHub...' })
    // Stage all
    execSync('git add -A 2>&1', { cwd: projectDir, encoding: 'utf8', timeout: 10000 })
    // Commit with timestamp
    const timestamp = new Date().toISOString()
    const commitMsg = `Auto-save by Cloud Agent at ${timestamp}`
    try {
      execSync(`git commit -m "${commitMsg}" 2>&1 || true`, { cwd: projectDir, encoding: 'utf8', timeout: 10000 })
    } catch {}
    // Push
    const pushResult = execSync('git push origin HEAD 2>&1 || true', { cwd: projectDir, encoding: 'utf8', timeout: 30000 })
    send({ type: 'git_result', action: 'push', ok: true, content: pushResult.slice(-2000) })
  } catch (e: any) {
    send({ type: 'git_result', action: 'push', ok: false, content: e.message })
  }
}
