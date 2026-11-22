/**
 * AI Swarm Engine (rebuild of lost v44 + v45 + v46 engine work).
 *
 * The owner's #1 product demand: ALL his agents work TOGETHER, in
 * PARALLEL, on one task — visible, honest, unbreakable.
 *
 * What this module does:
 *   1. PLANNING — the 👑 leader agent (or, on takeover, the next healthy
 *      agent) produces a battle plan. A broken leader key can no longer
 *      shrink the swarm to one agent.
 *   2. ASSIGN — the plan is split into one self-contained brief per agent
 *      (no overlaps, executable in parallel).
 *   3. BUILD — every agent builds AT THE SAME TIME. Streams sharing ONE
 *      provider kind flow through a rate-limit-aware lane (default 4
 *      concurrent per kind); DIFFERENT kinds run fully parallel. Queued
 *      streams are announced, never dropped, never left idle.
 *   4. INTEGRATE — the leader reviews the built files and fixes what is
 *      broken.
 *
 * Contract with the chat stream (asserted in E2E):
 *   - Structured { type:'swarm' } snapshots carry the live board state:
 *     phase (planning → assign → build → integrate → done) + per-agent
 *     { id, name, kind, title, status, files, error }.
 *   - The stream's LAST event is always 'done'.
 *   - Parallel builders' raw tokens are suppressed (they would garble the
 *     chat); real work still streams through as tool_call/tool_result
 *     events, and every stream start/finish is announced as a message.
 *   - ♻️ failover ON (default): a broken stream is rescued down the other
 *     agents' keys, with the built-in Vortex Engine as the silent last resort.
 *     failover OFF (strict): every agent builds with its OWN key only and
 *     failures surface honestly — no rescue, no lies.
 */
import type { AIProvider, ChatMessage } from './providers'
import { runAgent, missingFullProductParts, fullProductAuditMessage } from './agent'
import { explainProviderError } from './status-help'

/** Rate-limit-aware concurrency per provider kind (the scheduler lane cap). */
export const SWARM_PER_PROVIDER_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.SWARM_LANE_CONCURRENCY || '2', 10) || 2,
)

export type SwarmPhase = 'planning' | 'assign' | 'build' | 'integrate' | 'done'
export type SwarmStreamStatus = 'pending' | 'building' | 'done' | 'failed'

export interface SwarmAgent {
  provider: AIProvider
  id: string
  name: string
  kind: string
  isLeader?: boolean
  /** per-agent role template (Provider Manager systemPrompt) */
  systemPrompt?: string
}

export interface SwarmSlotState {
  id: string
  name: string
  kind: string
  title: string
  status: SwarmStreamStatus
  files: string[]
  error?: string
  startedAt?: number
  finishedAt?: number
}

export interface SwarmSnapshot {
  type: 'swarm'
  phase: SwarmPhase
  agents: SwarmSlotState[]
  plan?: string
  content?: string
}

export interface SwarmResult {
  ok: boolean
  plan: string
  files: string[]
  doneCount: number
  failedCount: number
  tokensIn: number
  tokensOut: number
  summary: string
}

export interface SwarmOptions {
  projectId: string
  task: string
  /** Full roster in run order: default → 👑 leader → creation. agents[0] plans. */
  agents: SwarmAgent[]
  /** ♻️ default ON. OFF = strict: own key only, honest failures. */
  failover?: boolean
  signal?: AbortSignal
  /** Lane cap override (tests). Default SWARM_PER_PROVIDER_CONCURRENCY. */
  perProviderConcurrency?: number
  /** NDJSON sink — the same channel runAgent events flow through. */
  onEvent: (e: any) => void
}

/**
 * v117 — trivial-task detector for the single-agent fast lane.
 * Matches SHORT, single-artifact asks where a multi-agent battle plan is
 * pure overhead (and tends to degrade into human-style steps). Deliberately
 * conservative: anything mentioning an app/server/backend/auth/database or
 * multi-part work still gets the full swarm.
 */
export function isTrivialTask(task: string): boolean {
  const t = (task || '').toLowerCase()
  if (t.length > 260) return false // long briefs are real work
  // Any of these words ⇒ real product work, never trivial.
  if (/(app|website|dashboard|server|backend|frontend|database|auth|login|register|api|admin|payment|cart|blog|ecommerce|e-commerce|store|flutter|react|next|node|express|prisma|multi|platform|system|clone|full|complete)/.test(t)) return false
  // Simple page / tiny fix / question patterns.
  if (/(hello world|hello-world|hello)/.test(t)) return true
  if (/(simple|basic|small|tiny|quick|just|only)\s+(html|page|site|button|form|text|css|card|counter|timer|calculator|clock)/.test(t)) return true
  if (/(add|change|update|fix|edit|rename|remove|delete)\s+(a\s+|the\s+)?(button|title|color|colour|text|link|icon|heading|footer|margin|padding|font|label)/.test(t)) return true
  if (/(what|why|how|explain|tell me|kothay|keno|ki bhabe)/.test(t) && !/build|create|make/.test(t)) return true
  return false
}

/**
 * v137 — QUESTION detector: read-only asks (list files, explain code, "why
 * does X", "what is Y") must NEVER reach the battle planner. The planner's
 * system prompt FORCES a FULL-PRODUCT plan onto any input, and when its plan
 * parses to zero numbered packages the fallbackPackages() briefs ("FULL
 * PRODUCT … cart/checkout …") were handed to all 3 builders — i.e. asking
 * "list the files" made the swarm start BUILDING an unrelated e-commerce
 * product inside the user's project. A question is now routed to a
 * single-agent Q&A lane: read-only brief, no planning, no write briefs.
 *
 * Conservative by design: any explicit build/modification imperative wins
 * over a question phrasing, so real work keeps the full swarm.
 */
export function isQuestionTask(task: string): boolean {
  let t = (task || '').toLowerCase().trim()
  if (!t || t.length > 400) return false
  // Politeness wrappers don't change intent — strip them.
  t = t
    .replace(/^(please|kindly|hey|hi|hello|yo|excuse me)\b[,:\s]*/, '')
    .replace(/^(can|could|would|will)\s+(you|u)\s+/, '')
    .replace(/^(cloud\s*agent|ai)\b[,:\s]*/, '')
  // Explicit build/work imperative ⇒ real work, never Q&A.
  const buildVerb =
    /^(build|create|make|add|write|generate|implement|design|develop|fix|update|delete|remove|change|rename|edit|refactor|deploy|install|publish|export|convert|migrate|integrate|improve|extend|optimize|optimise|banao|banaw|likhe dao|kore dao|kore daw|thik kore dao|thik koro|add koro|delete koro|remove koro|update koro)\b/
  if (buildVerb.test(t)) return false
  // Bengali/Frabangla verb-final imperatives ("... add kore dao") ⇒ work.
  if (/\b(kore dao|kore daw|banao|banaw|likhe dao|thik kore dao|add kore dao|delete kore dao|remove kore dao|update kore dao|kore daw)\s*[.?!]*$/.test(t)) return false
  // Question starter ("what/why/how/list/show/explain/bolo…") ⇒ Q&A.
  const qaStart =
    /^(what|why|how|which|where|who|whose|when|is|are|was|were|does|do|did|should|explain|describe|summarize|summarise|review|compare|list|show|tell|read|view|open|find|check\b.*\b(what|why|how|status)|kothay|keno|ki\s|kibhabe|ki bhabe|kemon|koto|bolo|janaw|dekhaw|kothao)\b/
  if (qaStart.test(t)) return true
  // Any short message ending in "?" that didn't start with a work verb.
  if (/\?\s*$/.test(t) && t.length < 300) return true
  return false
}

export async function runSwarm(opts: SwarmOptions): Promise<SwarmResult> {
  const failover = opts.failover !== false
  let agents = opts.agents
  // v117 ULTRA SPEED + QUALITY: trivial tasks ("hello world", "make a simple
  // page", one-file tweaks) do NOT need a 3-agent battle plan — the planning
  // round-trip alone costs 10-20s and on simple asks the leader used to emit
  // human-style steps ("open Notepad, copy-paste, save as") instead of real
  // engineering packages. Those bogus briefs then confused the builders.
  // Small asks now build with the LEADER ALONE: one call, zero planning,
  // straight to write_file — often 2-4x faster end-to-end.
  const trivial = agents.length > 1 && isTrivialTask(opts.task)
  if (trivial) {
    opts.onEvent({ type: 'message', content: `⚡ Small task — single-agent fast lane (no swarm overhead).` })
    agents = agents.slice(0, 1)
  }
  // v137 Q&A GATE: read-only questions (list files / explain / why / what …)
  // never reach the battle planner — a forced FULL-PRODUCT plan (or its
  // fallbackPackages briefs) used to make 3 agents START BUILDING an
  // unrelated product inside the user's project in response to a mere
  // question. Questions are answered by the leader alone with a read-only
  // brief; compute unconditionally so single-agent pools benefit too.
  const question = isQuestionTask(opts.task)
  if (question && agents.length > 1) {
    opts.onEvent({ type: 'message', content: `💬 Question detected — answering directly from your project (no build swarm).` })
    agents = agents.slice(0, 1)
  }
  const slots: SwarmSlotState[] = agents.map(a => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    title: '',
    status: 'pending',
    files: [],
  }))
  const slotOf = new Map<string, SwarmSlotState>(slots.map((s, i) => [agents[i].id, s]))

  let tokensIn = 0
  let tokensOut = 0
  let toolCallsCount = 0

  const snapshot = (phase: SwarmPhase, content?: string) => {
    const ev: SwarmSnapshot = { type: 'swarm', phase, agents: slots.map(s => ({ ...s, files: [...s.files] })) }
    if (content) ev.content = content
    opts.onEvent(ev)
  }
  const announce = (content: string) => opts.onEvent({ type: 'message', content })

  const recordUsage = (tin?: number, tout?: number) => {
    tokensIn += tin || 0
    tokensOut += tout || 0
  }

  /* ── 1. PLANNING (leader plans; takeover on broken key) ─────────────── */
  snapshot('planning', `${agents.length} agents assembling`)
  let plan = ''
  // Single-agent swarms skip planning entirely — the task IS the brief.
  let planningAttempted = false
  let plannerCandidateCount = 0
  if (agents.length > 1) {
    planningAttempted = true
    const plannerCandidates = failover ? agents : agents.slice(0, 1)
    plannerCandidateCount = plannerCandidates.length
    plannerCandidateLoop: for (let ci = 0; ci < plannerCandidates.length; ci++) {
      const cand = plannerCandidates[ci]
      if (opts.signal?.aborted) break
      // v136 — throttling (429) is transient: a shared quota recovers in
      // seconds-to-minutes. The planner used to burn through every candidate
      // in 0.2s and die ("planning failed on all N candidate(s)") — now each
      // candidate gets 30s-backoff retries (same policy agent.ts already
      // uses for worker turns) before the takeover move.
      let candThrottleRetries = 0
      try {
        const planningMessages: ChatMessage[] = [
          { role: 'system', content: `You are the LEADER of a parallel AI swarm of CODING AGENTS. Produce a concise BATTLE PLAN for the task.
HARD REQUIREMENT — the plan MUST cover the FULL PRODUCT, not just one screen:
- work packages for the USER app, a complete ADMIN panel, and the BACKEND server (REST APIs + data) — plus auth shared by both apps, and a final integration/README package.
EVERY package is an ENGINEERING assignment executed by an autonomous coding agent that has write_file/run_project tools — NOT instructions for a human. FORBIDDEN in packages: "open an editor", "copy and paste", "save the file", any manual GUI steps. Each package must name WHAT to build and WHERE (folder/file paths) and WITH WHAT (stack/framework).
Output EXACTLY this format (plain text, one package per line, machine-parsed — no markdown headers around them):
GOAL: one line
1. <work package — self-contained, no overlaps, executable in parallel>
2. <work package>
...5-12 packages total...
CONVENTIONS: one line (framework, folder layout, naming, shared API base path)` },
          { role: 'user', content: opts.task },
        ]
        const res = await cand.provider.chatWithTools(planningMessages, [], { signal: opts.signal, temperature: 0.4 })
        recordUsage(res.tokensIn, res.tokensOut)
        if ((res.content || '').trim()) {
          plan = res.content.trim()
          announce(`👑 ${cand.name} planned the battle — ${slots.length} agents will build in parallel.`)
          break plannerCandidateLoop // plan ready
        }
        // empty answer → treat like a soft failure and take over
        throw new Error('planner returned an empty plan')
      } catch (e: any) {
        const msg = String(e?.message || 'unknown error')
        const why = explainProviderError(cand.name, cand.kind, msg)
        // v136 — transient throttling: back off 30s and retry the SAME
        // candidate up to 3 times (mirrors the worker-turn policy in
        // agent.ts) before moving to the next candidate.
        if (/429|rate.?limit|quota/i.test(msg) && candThrottleRetries < 3) {
          candThrottleRetries++
          announce(`👑 ${cand.name} throttled — waiting 30s and retrying (planner attempt ${candThrottleRetries}/3).`)
          await new Promise(r => setTimeout(r, 30_000))
          ci-- // retry the same candidate
          continue
        }
        if (/429|rate.?limit|quota/i.test(msg)) {
          announce(`👑 ${cand.name} still throttled after 3 backoffs.`)
        }
        if (!failover) {
          announce(`👑 ${why}`)
          break
        }
        announce(`👑 ${cand.name} can't plan — ${why} Next agent takes over the planning.`)
      }
    }
    if (planningAttempted && !plan && !opts.signal?.aborted) {
      // Planning failed everywhere — honest failure, no fake plan.
      const firstErr = `planning failed on all ${plannerCandidateCount} candidate(s)`
      opts.onEvent({ type: 'error', content: firstErr })
      opts.onEvent({ type: 'done', ok: false, content: `Swarm could not start: ${firstErr}.` })
      return { ok: false, plan: '', files: [], doneCount: 0, failedCount: 0, tokensIn, tokensOut, summary: firstErr }
    }
  }

  /* ── 2. ASSIGN — one self-contained brief per agent ─────────────────── */
  // v73 FIX: the old parser ONLY matched lines starting with a bare digit
  // (`1.`/`1)`) — leaders routinely answer with `**1.**`, `- 1.`, or nest
  // numbering, so packages came out EMPTY and EVERY agent received the
  // identical brief "Build your self-contained part of the task" → 40 agents
  // duplicated the same work and ignored the user's intent (the owner's
  // "agent gulo prompt thik babe bujte pare na" bug). Now: markdown-safe
  // parsing + a task-aware FULL-PRODUCT fallback split + per-variant
  // guidance when there are more agents than packages.
  const packages = plan
    ? plan.split('\n').map(l => l.trim())
        .map(l => l.replace(/^[-*•]\s*\*\*/, '').replace(/^\*\*/, ''))
        .filter(l => /^\d+\s*[.)]\s*/.test(l))
        .map(l => l.replace(/^\d+\s*[.)]\s*/, '').replace(/\*\*/g, '').replace(/\s*—\s*$/, '').trim())
        .filter(l => l.length > 3)
    : []
  // Task-aware fallback: ALWAYS ship the full product (user + admin + server)
  const fallbackPackages = (task: string): string[] => {
    const t = task.toLowerCase()
    const mobileish = /flutter|dart|mobile|android|ios|react native|capacitor/.test(t)
    const appWord = mobileish ? 'Flutter app' : 'web app'
    return [
      // v86 FIX (owner: "agent shudhui backend banacche"): package #1 was
      // "BACKEND SERVER first-class" — a 1-agent swarm assigned that brief
      // VERBATIM, so the whole app came out backend-only. #1 now leads with
      // the FULL PRODUCT; the server is one part of it, never the whole job.
      `FULL PRODUCT (all four parts, this is the whole job): build (1) the ${appWord} for END USERS of: ${task.slice(0, 180)} — onboarding/auth, home/browse, detail, core actions, styled + responsive; (2) a complete ADMIN PANEL — admin login (role check), dashboard with real stats, CRUD tables for every entity; (3) the BACKEND SERVER — REST APIs for every entity (auth register/login/JWT, CRUD, admin-only endpoints) with CORS + /health; (4) DATABASE persistence (SQLite/JSON-file DB/Prisma or the user's chosen BaaS) — data survives a restart. User app + admin call the real API via fetch. Folders: app/ (or public/ + src/), admin/, server/, db.`,
      `BACKEND SERVER deep-dive (only if a FULL-PRODUCT package already exists): expand the server (Express/FastAPI per stack) with REST APIs for every entity — auth (register/login/JWT), CRUD, admin-only endpoints. Persist data. Include CORS + a /health endpoint. Folder: server/.`,
      `USER APP extended: remaining user screens — search/filter, cart/checkout or the domain's core workflow, profile, settings, notifications, empty/error/loading states. All data via the server API, no fake hardcoded data. Folder: app/ (Flutter: lib/user/).`,
      `ADMIN PANEL: complete admin app for the SAME product — admin login (role check), dashboard with real stats from the API, CRUD tables for every entity, order/user/content management, settings. Folder: admin/ (Flutter: lib/admin/).`,
      `SHARED INFRA + DOCS: shared API client/util modules both apps import, seed data script, README.md with run commands for server, user app and admin, API list, and seeded admin credentials (admin@local / changeme).`,
    ]
  }
  const effectivePackages = packages.length > 0 ? packages : fallbackPackages(opts.task)
  const briefFor = (i: number): { title: string; brief: string } => {
    // v86 FIX (owner: "agent shudhui backend banacche"): a SINGLE-agent swarm
    // used to receive fallbackPackages[0] — "BACKEND SERVER first-class" — as
    // its ENTIRE assignment. The specific recent brief always beats the
    // generic FULL PRODUCT RULE in the system prompt, so the build came out
    // backend-only. A solo agent now gets the FULL-PRODUCT brief: the owner's
    // original task + the mandatory four-part delivery contract.
    if (agents.length === 1) {
      // v137: QUESTION asks (list files / explain / why / what …) get a
      // READ-ONLY Q&A brief — the sole builder used to receive the FULL
      // PRODUCT four-part contract for a mere question and started writing
      // files the user never asked for.
      if (question) {
        const title = ('Q&A: ' + opts.task).slice(0, 70)
        const brief = [
          `QUESTION-ANSWERING TASK — the user asked ABOUT the existing project. DO NOT build anything. DO NOT write, create, modify or delete any file (write_file/edit_file are forbidden for this run).`,
          `Use read-only inspection (run_project with \`ls\`/ \`cat\`, read_file) when needed, then answer the question directly, concisely and truthfully based on what is ACTUALLY on disk. If the answer is one line, reply with one line.`,
          ``,
          `Question: ${opts.task}`,
        ].join('\n')
        return { title, brief }
      }
      // v117: TRIVIAL asks (hello world, tiny page, small fix) get the task
      // AS-IS — forcing the four-part FULL PRODUCT contract on "make a hello
      // world page" produced absurd over-delivery and wasted minutes.
      // Real product asks keep the mandatory four-part delivery contract.
      if (trivial) {
        const title = opts.task.slice(0, 70)
        const brief = [
          `SMALL TASK — build EXACTLY what is asked, nothing more. No admin app, no server, no database unless explicitly requested.`,
          `Use the right tools (write_file, edit_file) and finish fast.`,
          ``,
          `Task: ${opts.task}`,
        ].join('\n')
        return { title, brief }
      }
      const title = ('FULL PRODUCT: ' + opts.task).slice(0, 70)
      const brief = [
        `YOU ARE THE SOLE BUILDER. Deliver the COMPLETE product — all four parts, in this one assignment:`,
        `1. FRONTEND (USER APP) — the real customer-facing UI for: ${opts.task.slice(0, 180)}`,
        `2. BACKEND SERVER — REST APIs for every entity (auth, CRUD, admin-only) + CORS + /health`,
        `3. DATABASE — real persistence (SQLite / JSON-file DB / Prisma / chosen BaaS); data survives a restart`,
        `4. ADMIN APP — admin login (role check), stats dashboard, CRUD tables for every entity`,
        `The user app and admin app MUST call the real server API with fetch — no in-memory fake data in production screens. A backend-only delivery is a FAILED delivery.`,
        ``,
        `Original task: ${opts.task}`,
      ].join('\n')
      return { title, brief }
    }
    // Round-robin over packages; agents beyond the first cycle get a VARIANT
    // brief (extend/deepen a DIFFERENT aspect — never rewrite the same files).
    const cycle = Math.floor(i / effectivePackages.length)
    const pkg = effectivePackages[i % effectivePackages.length]
    const variantNote = cycle > 0
      ? `\nVARIANT ${cycle + 1}: another agent already built the base version of this package. Go WIDER, not over the same files — add genuinely NEW screens/endpoints/features under this package's area (extra user flows, analytics, pagination, i18n, dark mode…). Use DIFFERENT file paths than base files (suffix -v${cycle + 1} or a submodule folder).`
      : ''
    const title = (pkg || opts.task).slice(0, 70)
    const brief = [
      plan ? `LEADER'S PLAN (follow the conventions; take YOUR work package — do not overlap other agents):\n${plan}` : '',
      `YOUR ASSIGNMENT — work package ${i + 1} of ${agents.length}:`,
      pkg || `Build your self-contained part of the task. Do NOT duplicate other agents' work.`,
      variantNote,
      `Original task: ${opts.task}`,
    ].filter(Boolean).join('\n\n')
    return { title, brief }
  }
  const briefs = agents.map((_, i) => briefFor(i))
  for (let i = 0; i < slots.length; i++) slots[i].title = briefs[i].title
  snapshot('assign')

  /* ── 3. BUILD — everyone, in parallel, rate-limit-aware ──────────────── */
  const laneCap = Math.max(1, opts.perProviderConcurrency || SWARM_PER_PROVIDER_CONCURRENCY)
  const lanes = new Map<string, number[]>() // kind → agent indexes
  agents.forEach((a, i) => {
    const arr = lanes.get(a.kind) || []
    arr.push(i)
    lanes.set(a.kind, arr)
  })
  const queuedKinds = [...lanes.entries()].filter(([, idxs]) => idxs.length > laneCap).map(([k, idxs]) => `${k} (${idxs.length} streams, ${laneCap} at a time)`)
  if (queuedKinds.length > 0) {
    announce(`⏳ Provider lane${queuedKinds.length > 1 ? 's' : ''} full — ${queuedKinds.join(', ')}. Queued streams wait their turn — no stream is dropped.`)
  }

  /** Tracks a stream's write_file calls → real written paths (result-ok verified). */
  function makeEventWrapper(idx: number): { onEvent: (e: any) => void; failMsg: () => string | null } {
    const pending = new Map<string, string>() // toolCallId → path
    let error: string | null = null
    const wrapped = (e: any) => {
      if (e.type === 'tool_call') {
        toolCallsCount++
        if (e.toolName === 'write_file') {
          try {
            const args = typeof e.toolArgs === 'string' ? JSON.parse(e.toolArgs) : (e.toolArgs || {})
            if (args?.path) pending.set(e.toolCallId, String(args.path))
          } catch {}
        }
        opts.onEvent(e)
        return
      }
      if (e.type === 'tool_result') {
        const path = pending.get(e.toolCallId)
        if (path && e.toolResult?.ok) {
          const slot = slotOf.get(agents[idx].id)
          if (slot && !slot.files.includes(path)) slot.files.push(path)
        }
        pending.delete(e.toolCallId)
        opts.onEvent(e)
        return
      }
      // 'status' ticks are honest progress — forward them.
      if (e.type === 'status') { opts.onEvent(e); return }
      // tokens/messages/done/error of PARALLEL builders stay out of the chat:
      // the board + announcements carry the story. 'error' marks the stream
      // failed (runAgent returns normally after a dead provider chain — the
      // error EVENT, not a thrown exception, is the final truth).
      if (e.type === 'error') { error = e.content || 'unknown error'; return }
      // v137: Q&A lane — the answer IS the product. The solo worker's
      // tokens/messages stream straight into the chat, otherwise the user's
      // question got status lines but never the actual answer.
      if (e.type === 'token' || e.type === 'message') {
        if (question) { opts.onEvent(e); return }
        return
      }
      // 'done' from the inner loop — ignored; the swarm emits ONE final done.
    }
    return { onEvent: wrapped, failMsg: () => error }
  }

  async function buildOne(idx: number) {
    const agent = agents[idx]
    const slot = slotOf.get(agent.id)!
    slot.status = 'building'
    slot.startedAt = Date.now()
    snapshot('build')
    announce(`🐝 ${agent.name} (${agent.kind}) starts: ${slot.title}`)

    const { onEvent, failMsg } = makeEventWrapper(idx)
    // ♻️ failover: rescue chain = the OTHER agents' providers (+ the pool's
    // own zai-kind row if any, so agent.ts never constructs a silent real
    // GLM — strict mode empties the chain entirely).
    const others = agents.filter((_, j) => j !== idx).map(a => a.provider)
    const fallbackProviders = failover ? others : []
    try {
      const r = await runAgent({
        projectId: opts.projectId,
        prompt: briefs[idx].brief,
        provider: agent.provider,
        fallbackProviders,
        strictProvider: !failover,
        agentSystemPrompt: agent.systemPrompt,
        swarmWorker: true, // v73: workers never run_project/qa_squad — no port fights, no killed dev servers
        signal: opts.signal,
        maxIterations: 40,
        onEvent,
      })
      recordUsage(r.tokensIn, r.tokensOut)
    } catch (e: any) {
      // runAgent is designed not to throw; belt-and-braces.
      if (!failMsg()) slot.error = e?.message || 'unknown error'
    }
    const err = failMsg()
    slot.finishedAt = Date.now()
    if (err) {
      slot.status = 'failed'
      slot.error = err
      announce(`❌ ${agent.name} failed — ${explainProviderError(agent.name, agent.kind, err)}`)
    } else {
      slot.status = 'done'
      announce(`✅ ${agent.name} finished — ${slot.files.length} file(s) written.`)
    }
    snapshot('build')
  }

  async function runLane(idxs: number[]) {
    let next = 0
    const workers = Array.from({ length: Math.min(laneCap, idxs.length) }, async () => {
      while (true) {
        if (opts.signal?.aborted) return
        const i = next++
        if (i >= idxs.length) return
        await buildOne(idxs[i])
      }
    })
    await Promise.all(workers)
  }
  await Promise.all([...lanes.values()].map(idxs => runLane(idxs)))

  const doneCount = slots.filter(s => s.status === 'done').length
  const failedCount = slots.filter(s => s.status === 'failed').length
  const allFiles = [...new Set(slots.flatMap(s => s.files))]

  /* ── 4. INTEGRATE — the leader reviews and fixes ────────────────────── */
  let summary = ''
  // v137: a Q&A run writes nothing and answers directly — the integrator
  // pass (plus the full-product audit, which would falsely flag "missing
  // parts" for a question) is pure waste, 60-90s of dead time.
  const integrable = doneCount > 0 && !question
  // v86 SWARM FULL-PRODUCT GATE (owner: "agent shudhui backend banacche"):
  // swarm workers were exempt from the single-agent disk audit, so a swarm
  // could stop with only the backend on disk. After BUILD we run the SAME
  // disk audit; missing parts turn the integrator into a FINISHER whose
  // prompt says BUILD THEM — "do not rebuild what works" no longer applies
  // to parts that were never built.
  const missingParts = integrable && !opts.signal?.aborted ? missingFullProductParts(opts.projectId) : []
  if (missingParts.length > 0) {
    announce(`🔎 Full-product audit: the build is MISSING ${missingParts.join(' + ')} — a finisher pass is building them now.`)
  }
  if (integrable && !opts.signal?.aborted) {
    snapshot('integrate')
    const integratorIdx = agents.findIndex((a, i) => slots[i].status === 'done' && (a.isLeader || i === 0))
    const idx = integratorIdx >= 0 ? integratorIdx : agents.findIndex((_, i) => slots[i].status === 'done')
    const agent = agents[idx]
    const { onEvent, failMsg } = makeEventWrapper(idx)
    // v86: two integrator modes — plain review vs FULL-PRODUCT FINISHER.
    const finisherPrompt = [
      `You are the swarm FINISHER. ${doneCount} parallel agents just built files in this project, but the automatic disk audit proves these parts are MISSING: ${missingParts.join(' + ')}.`,
      '',
      fullProductAuditMessage(missingParts),
      '',
      `Already on disk (keep and reuse — wire the missing parts to it, never rebuild it): ${allFiles.slice(0, 30).join(', ') || 'nothing'}.`,
      `Original task: ${opts.task}`,
    ].join('\n')
    const reviewPrompt = `You are the swarm INTEGRATOR. ${doneCount} parallel agents just built files in this project (${allFiles.slice(0, 30).join(', ') || 'none listed'}). Verify the build holds together: read the key files, run/inspect the project where useful, fix real integration errors (imports, naming, missing pieces). Do not rebuild what works. Finish with a one-line verdict.`
    announce(`🧩 ${agent.name} ${missingParts.length > 0 ? 'FINISHES the missing parts (' + missingParts.join(' + ') + ')' : 'integrates the swarm build — verifying ' + allFiles.length + ' file(s) from ' + doneCount + ' agents.'}`)
    try {
      const r = await runAgent({
        projectId: opts.projectId,
        prompt: missingParts.length > 0 ? finisherPrompt : reviewPrompt,
        provider: agents[idx].provider,
        fallbackProviders: failover ? agents.filter((_, j) => j !== idx).map(a => a.provider) : [],
        strictProvider: !failover,
        agentSystemPrompt: agent.systemPrompt,
        signal: opts.signal,
        maxIterations: 30,
        onEvent,
      })
      recordUsage(r.tokensIn, r.tokensOut)
      if (failMsg()) {
        announce(`⚠️ ${missingParts.length > 0 ? 'Finisher' : 'Integration'} pass could not run — ${explainProviderError(agent.name, agent.kind, failMsg() || '')} The built files stay on disk.`)
      } else {
        const still = missingParts.length > 0 ? missingFullProductParts(opts.projectId) : []
        announce(still.length > 0
          ? `⚠️ Finisher pass done, but the disk still lacks: ${still.join(' + ')}. Ask "finish the missing parts" to complete the delivery.`
          : `🧩 ${missingParts.length > 0 ? 'Full product complete — all four parts verified on disk.' : 'Integration pass complete.'}`)
      }
    } catch {}
  }

  snapshot('done')

  const ok = doneCount > 0
  const failedList = slots.filter(s => s.status === 'failed').map(s => `${s.name}: ${s.error?.slice(0, 120) || 'failed'}`)
  summary = question
    ? `💬 Question answered — no build, no files touched.`
    : [
      `🐝 Swarm finished: ${doneCount}/${slots.length} agents done, ${failedCount} failed, ${allFiles.length} file(s) written.`,
      failedList.length ? `Honest failures:\n- ${failedList.join('\n- ')}` : '',
      plan ? `Leader's plan was followed by every agent.` : '',
    ].filter(Boolean).join('\n')

  if (!ok) {
    const firstErr = slots.find(s => s.error)?.error || 'all streams failed'
    opts.onEvent({ type: 'error', content: explainProviderError('swarm', '', firstErr) })
  }
  opts.onEvent({ type: 'done', ok, content: summary, tokensIn, tokensOut })
  return { ok, plan, files: allFiles, doneCount, failedCount, tokensIn, tokensOut, summary }
}
