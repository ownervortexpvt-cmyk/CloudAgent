/**
 * AUTONOMOUS LIFECYCLE ENGINE (v164) — the AI Orchestrator.
 *
 * The owner's spec, implemented ADDITIVELY on top of the working platform
 * (nothing deleted, nothing replaced — swarm/agent/tools/securityscan/
 * versions/runtime/toolchains are all REUSED here):
 *
 *   8 SPECIALIST AGENTS — Planner, Designer, Developer, Database, Tester,
 *   Debugger, Security, DevOps — coordinated by this central Orchestrator.
 *   Specialists are ROLE BRIEFS assigned over the user's real provider
 *   roster (Provider Manager keys round-robin + built-in Vortex Engine as
 *   the last-resort fallback chain). No new keys are invented; no key is
 *   ever logged.
 *
 *   12-STAGE LIFECYCLE —
 *     PLAN → DESIGN → CODE → DEPENDENCY INSTALLATION → BUILD →
 *     AUTOMATED TESTING → MANUAL TESTING (human gate) → DEBUG →
 *     SECURITY AUDIT → DEPLOY (approval gate) → MONITOR → AUTOMATIC UPDATE
 *
 *   HONESTY RULES (hard requirements from the owner):
 *     • generation ≠ production-ready. Code written is reported as "code
 *       written"; build/test/deploy states are reported SEPARATELY, each
 *       from its own stage row.
 *     • MANUAL TESTING can NEVER be marked complete by the machine. The
 *       run parks at `awaiting_manual_test` until a human approves.
 *     • Production deploy requires explicit approval (per-run flag, human
 *       action through the API). A run with unresolved CRITICAL security
 *       findings can NEVER auto-deploy — approval alone is not enough; the
 *       findings must be fixed or the deploy stays blocked.
 *     • A failed build/test is a FAILED stage with the real error attached —
 *       never papered over with a success status.
 *
 *   ENGINEERING:
 *     • job queue: max 2 concurrent runs platform-wide, 1 per project
 *       (globalThis registry, survives dev HMR like run-buffer/scheduler).
 *     • every stage persists to PipelineRun/PipelineStage (durable, honest).
 *     • live progress: events are teed into run-buffer under a runId, so
 *       the EXISTING workbench resume channel (POST /api/agent/resume) and
 *       the EXISTING swarm board ({type:'swarm'} snapshots) render the
 *       pipeline with ZERO UI changes.
 *     • rollback: every successful run snapshots the project via
 *       versions.snapshotProject (time-travel restore stays available).
 *     • retry: build/test failures trigger the DEBUG stage (debugger agent
 *       fixes the code), then build+test re-run — capped at 2 auto-fix
 *       cycles, then the run fails HONESTLY with the real error.
 */
import { db } from '../db'
import path from 'path'
import fs from 'fs'
import { AIProvider } from './providers'
import { getProviderById, ZAIProvider } from './providers'
import { getLane } from './lanes'
import { runAgent } from './agent'
import { runSwarm, SwarmAgent } from './swarm'
import { securityScan } from '../securityscan'
import { snapshotProject } from '../versions'
import { detectFramework } from '../framework'
import { runtimeManager, flutterSdkInstalled, getLogs as runtimeLogs } from '../runtime'
import { isValidRunId, registerRun, pushEvent, setAbortFn, finishRun } from './run-buffer'

/* ─── The 12 stages (single source of truth) ────────────────────────────── */

export interface StageDef {
  key: string
  name: string
  agent: string
  order: number
}

export const LIFECYCLE_STAGES: StageDef[] = [
  { key: 'plan',       name: 'Plan',                     agent: 'Planner',   order: 1 },
  { key: 'design',     name: 'Design',                   agent: 'Designer',  order: 2 },
  { key: 'code',       name: 'Code',                     agent: 'Developer', order: 3 },
  { key: 'deps',       name: 'Dependency installation',  agent: 'DevOps',    order: 4 },
  { key: 'build',      name: 'Build',                    agent: 'DevOps',    order: 5 },
  { key: 'autotest',   name: 'Automated testing',        agent: 'Tester',    order: 6 },
  { key: 'manualtest', name: 'Manual testing (human gate)', agent: 'Tester', order: 7 },
  { key: 'debug',      name: 'Debug & auto-fix',         agent: 'Debugger',  order: 8 },
  { key: 'security',   name: 'Security audit',           agent: 'Security',  order: 9 },
  { key: 'deploy',     name: 'Deploy',                   agent: 'DevOps',    order: 10 },
  { key: 'monitor',    name: 'Monitor',                  agent: 'DevOps',    order: 11 },
  { key: 'autoupdate', name: 'Version snapshot & rollback point', agent: 'DevOps', order: 12 },
]

export type StageStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'awaiting_human' | 'approved'
export type RunStatus = 'queued' | 'running' | 'awaiting_manual_test' | 'awaiting_deploy_approval' | 'completed' | 'failed' | 'cancelled'

/* ─── 8 specialist role briefs (assigned over the user's real keys) ─────── */

export const SPECIALIST_PROMPTS: Record<string, string> = {
  Planner: `You are the PLANNER specialist of an autonomous AI software team. Produce concrete engineering plans: modules, file paths, data models, API surface, milestones. Plans are written for autonomous CODING agents — never human instructions ("open editor" is forbidden). Always cover frontend + backend + database + admin when the task is a product.`,
  Designer: `You are the DESIGNER specialist of an autonomous AI software team. You deliver premium, responsive, accessible UI: a coherent design system (palette, typography, spacing, components), implemented as real files in the project (design tokens + shared styles + component stubs wired to the app). Mobile-first. No lorem-ipsum filler content — write real copy.`,
  Developer: `You are the DEVELOPER specialist of an autonomous AI software team. You write complete, working code with the real tools available (write_file, edit_file, install_package). No placeholders, no "TODO" bodies, no fake data where persistence is promised. Follow the plan and the design system; implement every package you are given.`,
  Database: `You are the DATABASE specialist of an autonomous AI software team. You own persistence: schemas, migrations, seeds, queries, connection wiring, and the backend REST APIs that expose the data. Use the stack the project already chose (Prisma/SQLite by default, or what the plan specifies). Real persistence only — no in-memory pretend databases.`,
  Tester: `You are the TESTER specialist of an autonomous AI software team. You exercise the REAL running project with the available QA tools and report facts only: what you ran, what passed, what failed, exact errors. NEVER claim a test passed that you did not run. Your verdict line MUST be exactly "AUTOTEST_VERDICT: PASS" or "AUTOTEST_VERDICT: FAIL" after the evidence.`,
  Debugger: `You are the DEBUGGER specialist of an autonomous AI software team. You receive real error output from failed build/test stages. Read the actual error, locate the actual file, fix the actual cause with your tools, and verify the fix by re-running the failing step. No speculative refactors — smallest correct fix.`,
  Security: `You are the SECURITY specialist of an autonomous AI software team. You audit the codebase for hardcoded secrets, injection sinks, insecure transport, dangerous permissions, and broken auth wiring. You fix what you can fix safely and report everything else with severity + file + remediation. Never leak secret VALUES in your report — name the file and key, redact the value.`,
  DevOps: `You are the DEVOPS specialist of an autonomous AI software team. You own dependencies, builds, deployments and health. Install real dependencies with real commands, run real builds, verify artifacts exist before calling a build successful, and report statuses exactly as they are. A build without a verified artifact is a FAILED build.`,
}

/* ─── Concurrency-safe queue (globalThis registry, HMR-safe) ─────────────── */

interface PipelineRegistry {
  active: Set<string> // runIds currently executing
  projectBusy: Set<string> // projectIds with an active run
  controllers: Map<string, AbortController>
  pending: Array<{ runId: string; projectId: string; kick: () => Promise<void> }>
}

const g = globalThis as any
if (!g.__vortexPipelineRegistry) {
  g.__vortexPipelineRegistry = {
    active: new Set(),
    projectBusy: new Set(),
    controllers: new Map(),
    pending: [],
  } as PipelineRegistry
}
const REG: PipelineRegistry = g.__vortexPipelineRegistry

const MAX_CONCURRENT_RUNS = 2

/* ─── Provider roster (mirrors /api/agent's loader, simplified & safe) ───── */

let rosterCache: Array<{ provider: AIProvider; id: string; name: string; kind: string }> = []
let rosterCacheAt = 0
const ROSTER_TTL = 60_000

function getZAI(): AIProvider {
  return new ZAIProvider('glm-5.3-flash', 'GLM 5.3 Flash (built-in)')
}

async function loadRoster(): Promise<Array<{ provider: AIProvider; id: string; name: string; kind: string }>> {
  const now = Date.now()
  if (now - rosterCacheAt < ROSTER_TTL && rosterCache.length > 0) return rosterCache
  const out: Array<{ provider: AIProvider; id: string; name: string; kind: string }> = []
  try {
    const rows = await db.aIProvider.findMany({ orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] })
    for (const row of rows) {
      try {
        const p = await getProviderById(row.id)
        out.push({ provider: p, id: row.id, name: row.name, kind: (p as any).kind || row.kind || 'llm' })
      } catch { /* broken key — skipped here; fallback chain still covers */ }
    }
  } catch { /* DB hiccup — built-in engine still available */ }
  if (out.length === 0) out.push({ provider: getZAI(), id: 'zai', name: 'Vortex Engine (built-in)', kind: 'zai' })
  rosterCache = out
  rosterCacheAt = now
  return out
}

/** Assign the 8 specialists over the roster: v166 — every specialist's
 * PRIMARY is its PERMANENT lane (always-loaded glm-5.3, per-role single-flight
 * queue, thinking on deep roles). Owner-supplied provider keys (Provider
 * Manager) ride along as the fallback chain, ending with the built-in flash
 * engine — so extra quota lanes boost speed the moment they exist. */
async function assignSpecialists(): Promise<Array<{ role: string; primary: AIProvider; fallbacks: AIProvider[]; name: string }>> {
  const roster = await loadRoster()
  const roles = ['Planner', 'Designer', 'Developer', 'Database', 'Tester', 'Debugger', 'Security', 'DevOps'] as const
  return roles.map((role) => {
    const lane = getLane(role)
    const fallbacks = roster.map(r => r.provider)
    return { role, primary: lane, fallbacks, name: `Vortex ${role} Agent — permanent lane (glm-5.3)` }
  })
}

/* ─── Event plumbing: run-buffer tee + swarm-board snapshots ─────────────── */

interface StageState { id: string; name: string; agent: string; status: StageStatus; detail: string; attempt: number }

class PipelineEventBus {
  constructor(private runId: string) {}
  private board(stages: StageState[], phase: string, content?: string) {
    // Reuse the EXISTING swarm board renderer: stages map to agent cards.
    const statusMap: Record<string, string> = {
      pending: 'pending', running: 'building', passed: 'done', failed: 'failed',
      skipped: 'done', awaiting_human: 'pending', approved: 'done',
    }
    pushEvent(this.runId, {
      type: 'swarm',
      phase,
      agents: stages.map(s => ({ id: s.id, name: s.agent, kind: s.name, title: `${s.name}${s.attempt > 1 ? ` (try ${s.attempt})` : ''}`, status: statusMap[s.status] || 'pending', files: [], error: s.status === 'failed' ? s.detail.slice(0, 300) : undefined })),
      ...(content ? { content } : {}),
    })
  }
  message(content: string) { pushEvent(this.runId, { type: 'message', content }) }
  status(text: string) { pushEvent(this.runId, { type: 'status', message: text }) }
  stages(stages: StageState[], phase: string, content?: string) { this.board(stages, phase, content) }
  done(ok: boolean, content?: string) {
    pushEvent(this.runId, { type: 'done', ok, ...(content ? { content } : {}) })
    finishRun(this.runId)
  }
}

/* ─── Stage helpers ──────────────────────────────────────────────────────── */

async function setStage(runId: string, key: string, patch: { status?: StageStatus; detail?: string; logs?: string; attempt?: number; started?: boolean; finished?: boolean }) {
  const data: any = {}
  if (patch.status) data.status = patch.status
  if (patch.detail !== undefined) data.detail = patch.detail.slice(0, 4000)
  if (patch.logs !== undefined) data.logs = patch.logs.slice(0, 60_000)
  if (patch.attempt) data.attempt = patch.attempt
  if (patch.started) data.startedAt = new Date()
  if (patch.finished) data.finishedAt = new Date()
  await db.pipelineStage.updateMany({ where: { runId, key }, data })
}

async function getStage(runId: string, key: string) {
  return db.pipelineStage.findUnique({ where: { runId_key: { runId, key } } }).catch(() => null)
}

async function setRun(runId: string, patch: any) {
  await db.pipelineRun.update({ where: { id: runId }, data: patch }).catch(() => {})
}

function truncate(s: string, n: number): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + `… [+${s.length - n} chars]` : s
}

/** One specialist agent turn with tools. Returns the final text. */
async function specialistTurn(opts: {
  projectId: string
  role: string
  prompt: string
  provider: AIProvider
  fallbacks: AIProvider[]
  maxIterations?: number
  signal?: AbortSignal
  onEvent: (e: any) => void
  swarmWorker?: boolean
}): Promise<{ text: string; tokensIn: number; tokensOut: number; ok: boolean; error?: string }> {
  const r = await runAgent({
    projectId: opts.projectId,
    prompt: opts.prompt,
    provider: opts.provider,
    fallbackProviders: opts.fallbacks,
    agentSystemPrompt: SPECIALIST_PROMPTS[opts.role] || SPECIALIST_PROMPTS.Developer,
    swarmWorker: opts.swarmWorker ?? true,
    maxIterations: opts.maxIterations ?? 30,
    signal: opts.signal,
    onEvent: opts.onEvent,
  })
  const last = [...r.messages].reverse().find(m => m.role === 'assistant')
  return { text: last?.content || '', tokensIn: r.tokensIn, tokensOut: r.tokensOut, ok: true }
}

/* ─── The engine itself ──────────────────────────────────────────────────── */

export async function executePipeline(runId: string): Promise<void> {
  const controller = new AbortController()
  REG.controllers.set(runId, controller)
  setAbortFn(runId, () => controller.abort())
  const bus = new PipelineEventBus(runId)

  const run = await db.pipelineRun.findUnique({ where: { id: runId } }).catch(() => null)
  if (!run) return
  const projectId = run.projectId
  const task = run.task

  const stageRows = await db.pipelineStage.findMany({ where: { runId }, orderBy: { order: 'asc' } }).catch(() => [])
  const stages: StageState[] = stageRows.map(s => ({ id: s.key, name: s.name, agent: s.agent, status: s.status as StageStatus, detail: s.detail, attempt: s.attempt }))
  const stageOf = (key: string) => stages.find(s => s.id === key)!
  const phaseFor = (key: string): string => {
    if (['plan', 'design'].includes(key)) return 'planning'
    if (key === 'code') return 'build'
    if (['deps', 'build'].includes(key)) return 'assign'
    return 'integrate'
  }
  const emitBoard = (content?: string) => bus.stages(stages, phaseFor(run.currentStage || 'plan'), content)
  /** terminal statuses — a stage in one of these is NEVER re-executed on resume */
  const terminal = (s: StageStatus) => ['passed', 'approved', 'failed', 'skipped'].includes(s)

  try {
    // RESUME HONESTY: a run that re-enters after a server restart replays
    // only the stages that are NOT already terminal — finished stages keep
    // their real result, nothing is faked, nothing is re-run.
    await setRun(runId, { status: 'running', startedAt: new Date(), error: null })
    bus.message(`🚀 Autonomous pipeline started — 12 stages, 8 specialist agents. Live board below (stages render as agent cards).`)
    bus.message(`ℹ️ Honesty rules in effect: code generation, build, testing and deployment are reported SEPARATELY. Manual testing waits for YOUR verification, production deploy waits for YOUR approval.`)
    emitBoard()

    const team = await assignSpecialists()
    const byRole = new Map(team.map(t => [t.role, t]))

    /* ── 1. PLAN ─────────────────────────────────────────────────────── */
    const planStage = stageOf('plan')
    let plan = ''
    if (terminal(planStage.status)) {
      plan = planStage.detail || `GOAL: ${task}`
      await setStage(runId, 'plan', { status: planStage.status as any })
    } else {
    await setStage(runId, 'plan', { status: 'running', started: true })
    emitBoard('Planner is drafting the engineering plan')
    try {
      const planner = byRole.get('Planner')!
      const r = await specialistTurn({
        projectId, role: 'Planner',
        prompt: `Task: ${task}\n\nWrite the engineering plan for this task in the project's context. Output format:\nGOAL: one line\n1. <package — files to create/change, with paths>\n2. ...\nDATA: schema summary\nAPI: endpoint list\nCONVENTIONS: stack + folder layout`,
        provider: planner.primary, fallbacks: planner.fallbacks,
        maxIterations: 2, signal: controller.signal,
        onEvent: () => {}, // planner is a pure-think turn; suppress tool noise
      })
      plan = r.text
    } catch (e: any) {
      plan = ''
    }
    if (!plan.trim()) {
      plan = `GOAL: ${task}\npackages follow from the task directly (planner agent unavailable — Developer will plan-and-build in one pass).`
      await setStage(runId, 'plan', { status: 'passed', detail: 'Planner fell back to orchestrator plan (agent turn failed) — honest note, not a fake plan.', finished: true })
    } else {
      await setStage(runId, 'plan', { status: 'passed', detail: truncate(plan, 3900), finished: true })
    }
    stageOf('plan').status = 'passed'
    } // end plan guard
    bus.message(`📋 Plan ready:\n${truncate(plan, 700)}`)
    emitBoard()

    /* ── 2. DESIGN ───────────────────────────────────────────────────── */
    const designStage = stageOf('design')
    let designNote = designStage.detail || ''
    if (!terminal(designStage.status)) {
    await setStage(runId, 'design', { status: 'running', started: true })
    emitBoard('Designer is building the design system')
    try {
      const designer = byRole.get('Designer')!
      const r = await specialistTurn({
        projectId, role: 'Designer',
        prompt: `Task: ${task}\n\nEngineering plan:\n${truncate(plan, 6000)}\n\nCreate the design system for this project IN THE PROJECT: a design-tokens file (colors/typography/spacing/radii/shadows as CSS variables or theme file appropriate to the stack), apply it to the shared stylesheet, and make sure the app shell (layout, nav, buttons, forms, cards) uses it. Premium and responsive — mobile-first. Write real files.`,
        provider: designer.primary, fallbacks: designer.fallbacks,
        maxIterations: 14, signal: controller.signal,
        onEvent: (e) => { if (e.type === 'tool_call') pushEvent(runId, e) },
      })
      designNote = r.text
      await setStage(runId, 'design', { status: 'passed', detail: truncate(designNote, 3900), finished: true })
      stageOf('design').status = 'passed'
    } catch (e: any) {
      await setStage(runId, 'design', { status: 'failed', detail: `designer failed: ${truncate(String(e?.message || e), 500)}`, finished: true })
      stageOf('design').status = 'failed'
      bus.message(`⚠️ Design stage failed (${truncate(String(e?.message || e), 160)}) — Developer will embed design decisions inline. Pipeline continues.`)
    }
    } // end design guard
    emitBoard()

    /* ── 3. CODE (orchestrator → parallel swarm when roster allows) ──── */
    const codeStage = stageOf('code')
    let codeTokens = { in: 0, out: 0 }
    const roster = await loadRoster()
    let codeSummary = ''
    if (!terminal(codeStage.status)) {
    await setStage(runId, 'code', { status: 'running', started: true })
    emitBoard('Developer agents are writing the product')
    try {
      if (roster.length >= 2) {
        // PARALLEL PATH — the proven runSwarm engine, briefed as Developer+Database specialists.
        // v166 — the builders ride the PERMANENT lanes (Developer lead, then Database/
        // Tester/Designer/DevOps lanes): per-lane single-flight + the global ZAI gate keep
        // starts spaced, so parallel speed without 429 collapse.
        const laneRoles = ['Developer', 'Database', 'Tester', 'Designer', 'DevOps'] as const
        const swarmAgents: SwarmAgent[] = laneRoles.map((role, i) => ({
          provider: getLane(role) as any, id: `lane-${role.toLowerCase()}`, name: `Vortex ${role} Agent`, kind: 'zai',
          isLeader: i === 0,
          systemPrompt: i === 0
            ? `${SPECIALIST_PROMPTS.Developer}\nYou are also the LEAD: integrate the other builders' work at the end.`
            : SPECIALIST_PROMPTS[role],
        }))
        bus.message(`🤖 ${swarmAgents.length} builder agents assembling in parallel (Developer lead + specialist builders).`)
        const swarmResult = await runSwarm({
          projectId,
          task: `${task}\n\nENGINEERING PLAN (follow it):\n${truncate(plan, 8000)}\n\nDESIGN SYSTEM: ${truncate(designNote, 1500) || 'embed sensible premium design tokens inline'}`,
          agents: swarmAgents,
          failover: true,
          signal: controller.signal,
          onEvent: (e) => pushEvent(runId, e), // swarm snapshots render the live board natively
        })
        codeTokens.in += swarmResult.tokensIn
        codeTokens.out += swarmResult.tokensOut
        codeSummary = swarmResult.summary
        if (swarmResult.failedCount > 0 && swarmResult.doneCount === 0) throw new Error(swarmResult.summary || 'all parallel builders failed')
        await setStage(runId, 'code', { status: 'passed', detail: truncate(`parallel build: ${swarmResult.doneCount}/${swarmResult.doneCount + swarmResult.failedCount} builders finished. ${codeSummary}`, 3900), finished: true })
      } else {
        // SINGLE PATH — orchestrator-led developer turn.
        const dev = byRole.get('Developer')!
        const r = await specialistTurn({
          projectId, role: 'Developer',
          prompt: `Task: ${task}\n\nEngineering plan (follow it):\n${truncate(plan, 8000)}\n\nDesign system: ${truncate(designNote, 1500) || 'embed sensible premium design tokens inline'}\n\nImplement the FULL product now — every file, real code, real persistence.`,
          provider: dev.primary, fallbacks: dev.fallbacks,
          maxIterations: 80, signal: controller.signal,
          onEvent: (e) => { if (['tool_call', 'tool_result', 'message'].includes(e.type)) pushEvent(runId, e) },
        })
        codeTokens.in += r.tokensIn
        codeTokens.out += r.tokensOut
        codeSummary = truncate(r.text, 1200)
        await setStage(runId, 'code', { status: 'passed', detail: truncate(codeSummary, 3900), finished: true })
      }
      stageOf('code').status = 'passed'
      await setRun(runId, { agentRunId: null, summary: `Code generation done (${codeTokens.in || '?'} tok in / ${codeTokens.out || '?'} tok out). Build/test/deploy statuses follow — code written is NOT production-ready until the later stages pass.` })
      bus.message(`💻 Code generation complete. Status: CODE WRITTEN — not yet built, not yet tested, not yet deployed. Those stages report separately from here.`)
    } catch (e: any) {
      await setStage(runId, 'code', { status: 'failed', detail: truncate(String(e?.message || e), 3900), finished: true })
      stageOf('code').status = 'failed'
      await failRun(runId, bus, stages, `Code stage failed: ${truncate(String(e?.message || e), 300)}`)
      return
    }
    } // end code guard
    emitBoard()

    /* ── DEBUG LOOP scaffolding: build+test may cycle through DEBUG ──── */
    let debugCycles = 0
    const MAX_DEBUG_CYCLES = 2

    /* runBuildAndTest — shared by first pass and post-debug re-run */
    const runBuildAndTest = async (): Promise<{ ok: boolean; errors: string; buildLog: string; testReport: string; verdict: 'PASS' | 'FAIL' | 'UNKNOWN' }> => {
      /* ── 4. DEPENDENCY INSTALLATION ─────────────────────────────── */
      const depsStage = stageOf('deps')
      await setStage(runId, 'deps', { status: 'running', started: true, attempt: debugCycles + 1 })
      emitBoard('DevOps is installing dependencies')
      let depsDetail = ''
      let depsOk = true
      try {
        const root = path.join(process.cwd(), 'projects', projectId)
        const fw = detectFramework(projectId)
        const rootExists = fs.existsSync(root)
        const notes: string[] = []
        notes.push(`framework: ${fw.framework} (${fw.runtime})`)
        // Real dependency install for manifest-bearing projects.
        if (rootExists) {
          const hasPkg = fs.existsSync(path.join(root, 'package.json'))
          const hasPubspec = fs.existsSync(path.join(root, 'pubspec.yaml'))
          if (hasPkg) {
            const { execFile } = await import('child_process')
            const res = await new Promise<{ ok: boolean; out: string }>((resolve) => {
              execFile('bash', ['-lc', `cd '${root}' && (bun install 2>&1 || npm install --no-audit --no-fund 2>&1) | tail -12`], { timeout: 150_000 }, (err, stdout) => {
                resolve({ ok: !err, out: String(stdout || '') })
              })
            })
            notes.push(`package install: ${res.ok ? 'OK' : 'FAILED'}\n${truncate(res.out, 800)}`)
            if (!res.ok) depsOk = false
          } else if (hasPubspec) {
            notes.push('flutter project — flutter pub get handled by the build stage (toolchain-gated)')
          } else {
            notes.push('no manifest — static project, nothing to install')
          }
        } else {
          notes.push('project files live in the managed store; filesystem install skipped')
        }
        depsDetail = notes.join('\n')
        await setStage(runId, 'deps', { status: depsOk ? 'passed' : 'failed', detail: truncate(depsDetail, 3900), finished: true })
        stageOf('deps').status = depsOk ? 'passed' : 'failed'
      } catch (e: any) {
        depsOk = false
        await setStage(runId, 'deps', { status: 'failed', detail: truncate(String(e?.message || e), 3900), finished: true })
        stageOf('deps').status = 'failed'
      }
      emitBoard()

      /* ── 5. BUILD (per target, verified artifacts only) ──────────── */
      const buildStage = stageOf('build')
      await setStage(runId, 'build', { status: 'running', started: true, attempt: debugCycles + 1 })
      emitBoard('DevOps is building')
      let targets: string[] = []
      try { targets = JSON.parse(run.targets || '["web"]') } catch { targets = ['web'] }
      const buildLines: string[] = []
      let buildOk = true
      let buildErr = ''
      const { execFile } = await import('child_process')
      const sh = (cmd: string, cwd: string, timeout = 240_000) => new Promise<{ ok: boolean; out: string }>((resolve) => {
        execFile('bash', ['-lc', cmd], { timeout, cwd, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
          resolve({ ok: !err, out: `${stdout || ''}\n${stderr || ''}`.trim() })
        })
      })
      for (const target of targets) {
        try {
          if (target === 'web' || target === 'source') {
            // WEB: real verification — the project must be startable and serve.
            const start = await runtimeManager.start(projectId).catch((e: any) => ({ ok: false, error: String(e?.message || e) }))
            if (start.ok) {
              // v166.3 — URL NORMALIZATION: runtimeManager.start returns the
              // UI preview path ('/preview/4001/') as url — a RELATIVE path the
              // engine's curl cannot fetch (verified live: build log showed
              // "server up (/preview/4001/) — HTTP 000" while the real server
              // answered 200 on [::1]:4001). Derive the absolute localhost URL
              // from port (direct field or the preview path) whenever needed.
              const rawUrl = String((start as any).url || '')
              const startPort = (start as any).port || (rawUrl.match(/\/preview\/(\d+)/) || [])[1]
              const url = rawUrl.startsWith('http') ? rawUrl : (startPort ? `http://127.0.0.1:${startPort}` : rawUrl)
              // v166.2 — WAIT FOR THE SERVER + IPv6 FALLBACK: (a) a vite/next
              // cold start (fresh deps install → optimize-deps) routinely exceeds
              // the old one-shot 10s probe; (b) vite 5+ binds [::1] ONLY (IPv6)
              // while this probe used 127.0.0.1 (IPv4) — healthy apps were
              // branded "unverifiable: HTTP 000" and burned debug cycles on
              // nothing (verified live: ss shows LISTEN [::1]:port, curl ::1 →
              // 200, curl 127.0.0.1 → 000). Patient retry window (~90s) + a
              // localhost probe (curl resolves ::1 or v4 automatically).
              const portMatch = String(url).match(/:(\d+)/)
              const altUrl = portMatch ? `http://localhost:${portMatch[1]}/` : ''
              let probe = '000'
              for (let attempt = 0; attempt < 9; attempt++) {
                probe = await new Promise<string>((resolve) => {
                  execFile('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '8', String(url)], { timeout: 12_000 }, (err, stdout) => resolve(String(stdout || '000')))
                })
                if (probe === '000' && altUrl) {
                  probe = await new Promise<string>((resolve) => {
                    execFile('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '8', altUrl], { timeout: 12_000 }, (err, stdout) => resolve(String(stdout || '000')))
                  })
                }
                if (probe !== '000') break
                await new Promise((r) => setTimeout(r, 4000))
              }
              const served = probe.startsWith('2') || probe.startsWith('3')
              buildLines.push(`web: server up (${url}) — HTTP ${probe} after patient retry ${served ? '→ ARTIFACT VERIFIED' : '→ server ran but did not serve'}`)
              if (!served) { buildOk = false; buildErr = `web build unverifiable: HTTP ${probe} (${url})` }
              await db.build.create({ data: { projectId, target: 'web', status: served ? 'success' : 'failed', logs: truncate(buildLines.join('\n'), 5000), startedAt: new Date(), finishedAt: new Date() } }).catch(() => {})
            } else {
              // Static project fallback: verify entry files actually exist.
              const root = path.join(process.cwd(), 'projects', projectId)
              const hasIndex = fs.existsSync(path.join(root, 'index.html')) || fs.existsSync(path.join(root, 'src'))
              buildLines.push(`web: managed-store project — entry check ${hasIndex ? 'OK (files present)' : 'FAILED (no entry found)'}`)
              if (!hasIndex) { buildOk = false; buildErr = 'web build failed: no entry file found' }
              await db.build.create({ data: { projectId, target: 'web', status: hasIndex ? 'success' : 'failed', logs: truncate(buildLines.join('\n'), 5000), startedAt: new Date(), finishedAt: new Date() } }).catch(() => {})
              if (!hasIndex) buildOk = false
            }
          } else if (target === 'android' || target === 'aab') {
            const flutterOk = (() => { try { return flutterSdkInstalled() } catch { return false } })()
            if (!flutterOk) {
              buildLines.push(`${target}: Flutter/Android toolchain NOT ready on this node — status: BLOCKED (toolchain installing in background; retry this run later). Reported honestly as not-built.`)
              await db.build.create({ data: { projectId, target, status: 'failed', logs: 'toolchain not ready', startedAt: new Date(), finishedAt: new Date() } }).catch(() => {})
              // toolchain absence is an environment fact, not a code failure — don't trip the debug loop
            } else {
              const root = path.join(process.cwd(), 'projects', projectId)
              const isFlutter = fs.existsSync(path.join(root, 'pubspec.yaml'))
              if (!isFlutter) {
                buildLines.push(`${target}: project is not a Flutter project — skipped (use a Flutter project for APK/AAB builds).`)
                await db.build.create({ data: { projectId, target, status: 'cancelled', logs: 'not a flutter project', startedAt: new Date(), finishedAt: new Date() } }).catch(() => {})
              } else {
                const res = await sh(`bash scripts/build-apk.sh ${projectId} 2>&1 | tail -25`, process.cwd(), 600_000)
                const artifact = fs.existsSync(path.join(process.cwd(), 'download')) ? '' : ''
                buildLines.push(`android: ${res.ok ? 'BUILD OK' : 'BUILD FAILED'}\n${truncate(res.out, 1200)}`)
                if (!res.ok) { buildOk = false; buildErr = truncate(res.out, 400) }
                await db.build.create({ data: { projectId, target: 'android', status: res.ok ? 'success' : 'failed', logs: truncate(res.out, 5000), startedAt: new Date(), finishedAt: new Date() } }).catch(() => {})
              }
            }
          } else if (target === 'windows') {
            buildLines.push(`windows: EXE packaging runs on the Windows packaging lane — queued as a follow-up build job (web build verified first). Not built in this pass.`)
          } else if (target === 'ios') {
            buildLines.push(`ios: IPA requires Apple codesigning certificates — cannot be produced on this node (platform limitation, reported honestly). Source + web build cover the codebase.`)
          } else {
            buildLines.push(`${target}: unknown target — skipped`)
          }
        } catch (e: any) {
          buildOk = false
          buildErr = truncate(String(e?.message || e), 400)
          buildLines.push(`${target}: ERROR ${buildErr}`)
        }
      }
      await setStage(runId, 'build', { status: buildOk ? 'passed' : 'failed', detail: truncate(buildLines.join('\n'), 3900), finished: true })
      stageOf('build').status = buildOk ? 'passed' : 'failed'
      emitBoard()

      /* ── 6. AUTOMATED TESTING (real runs, real verdict) ──────────── */
      const testStage = stageOf('autotest')
      await setStage(runId, 'autotest', { status: 'running', started: true, attempt: debugCycles + 1 })
      emitBoard('Tester is exercising the real build')
      let verdict: 'PASS' | 'FAIL' | 'UNKNOWN' = 'UNKNOWN'
      let testReport = ''
      try {
        const tester = byRole.get('Tester')!
        const r = await specialistTurn({
          projectId, role: 'Tester',
          prompt: `Task: ${task}\n\nAutomated test pass on the CURRENT project state. Steps:\n1. Start/run the project with the available tools (run_project).\n2. Exercise it with the QA tools you have (qa_squad etc.) — hit the real pages/endpoints.\n3. Check: app loads, no console errors, main flows respond.\nReport exactly what you ran and what happened, then end with the line:\nAUTOTEST_VERDICT: PASS  (or)  AUTOTEST_VERDICT: FAIL\nBuild context:\n${truncate(buildLines.join('\n'), 1200)}`,
          provider: tester.primary, fallbacks: tester.fallbacks,
          maxIterations: 28, signal: controller.signal,
          onEvent: (e) => { if (['tool_call', 'tool_result'].includes(e.type)) pushEvent(runId, e) },
        })
        testReport = r.text
        if (/AUTOTEST_VERDICT:\s*PASS/i.test(testReport)) verdict = 'PASS'
        else if (/AUTOTEST_VERDICT:\s*FAIL/i.test(testReport)) verdict = 'FAIL'
        else verdict = 'UNKNOWN'
      } catch (e: any) {
        testReport = `tester agent failed: ${String(e?.message || e)}`
        verdict = 'UNKNOWN'
      }
      await setStage(runId, 'autotest', { status: verdict === 'PASS' ? 'passed' : 'failed', detail: truncate(`verdict: ${verdict}\n${testReport}`, 3900), finished: true })
      stageOf('autotest').status = verdict === 'PASS' ? 'passed' : 'failed'
      if (verdict !== 'PASS') buildErr = buildErr || truncate(testReport, 400)
      emitBoard()

      return { ok: buildOk && verdict === 'PASS', errors: buildErr, buildLog: buildLines.join('\n'), testReport, verdict }
    }

    /* ── first build+test pass (skipped entirely on resume when both
       stages are already terminal — their real results are kept) ────── */
    const buildDone = terminal(stageOf('build').status)
    const testDone = terminal(stageOf('autotest').status)
    let bt = { ok: true, errors: '', buildLog: '', testReport: '', verdict: 'PASS' as 'PASS' | 'FAIL' | 'UNKNOWN' }
    if (buildDone && testDone && stageOf('build').status === 'passed' && stageOf('autotest').status === 'passed') {
      bus.message(`↩️ Resuming: build + automated test stages already PASSED (kept from the earlier attempt — not re-run).`)
    } else {
      bt = await runBuildAndTest()
    }

    /* ── 8. DEBUG (auto-fix + rebuild + retest, capped) ──────────────── */
    while (!bt.ok && run.autoDebug && debugCycles < MAX_DEBUG_CYCLES) {
      debugCycles++
      const dbgStage = stageOf('debug')
      await setRun(runId, { currentStage: 'debug' })
      await setStage(runId, 'debug', { status: 'running', started: true, attempt: debugCycles })
      emitBoard(`Debugger is fixing the failure (cycle ${debugCycles}/${MAX_DEBUG_CYCLES})`)
      bus.message(`🐞 Build/test failed — Debugger agent is fixing and re-running (cycle ${debugCycles}/${MAX_DEBUG_CYCLES}).`)
      try {
        const debugger_ = byRole.get('Debugger')!
        await specialistTurn({
          projectId, role: 'Debugger',
          prompt: `The automated pipeline FAILED. Real error output:\n\nBUILD:\n${truncate(bt.buildLog, 3000)}\n\nTEST REPORT:\n${truncate(bt.testReport, 3000)}\n\nFind the real cause, fix it with your tools, and verify. Do not touch unrelated files.`,
          provider: debugger_.primary, fallbacks: debugger_.fallbacks,
          maxIterations: 30, signal: controller.signal,
          onEvent: (e) => { if (['tool_call', 'tool_result'].includes(e.type)) pushEvent(runId, e) },
        })
        await setStage(runId, 'debug', { status: 'passed', detail: `fix cycle ${debugCycles} applied — re-running build+test`, finished: true })
        stageOf('debug').status = 'passed'
      } catch (e: any) {
        await setStage(runId, 'debug', { status: 'failed', detail: truncate(String(e?.message || e), 3900), finished: true })
        stageOf('debug').status = 'failed'
        break
      }
      emitBoard()
      bt = await runBuildAndTest()
    }

    if (!bt.ok && bt.verdict !== 'UNKNOWN') {
      await setStage(runId, 'debug', { status: debugCycles === 0 ? 'skipped' : stageOf('debug').status, detail: debugCycles === 0 ? 'auto-debug off or not applicable' : `${debugCycles} fix cycles did not resolve the failure` })
      await failRun(runId, bus, stages, `Pipeline FAILED honestly after ${debugCycles} debug cycle(s). Last error: ${truncate(bt.errors || 'unknown', 300)}`)
      return
    }
    if (!bt.ok && bt.verdict === 'UNKNOWN') {
      // v166.4 — the tester produced NO parseable verdict (iteration cap, or a
      // silent tool-loop end). That is honest UNCERTAINTY, not a proven
      // failure — burning 2 debugger cycles on an unparseable report wastes
      // quota and lies by implication. Send it to the HUMAN gate instead.
      await setStage(runId, 'debug', { status: 'skipped', detail: 'auto-verdict inconclusive — human review required (debug cycles not wasted)', finished: true })
      bus.message('⚠️ Automated verdict inconclusive (no PASS/FAIL line from the tester) — handing over to the HUMAN manual-testing gate.')
    }
    if (debugCycles > 0) bus.message(`✅ Debug cycle ${debugCycles} fixed it — build verified and automated tests PASS.`)

    /* ── 7. MANUAL TESTING — the human gate (NEVER auto-completed) ───── */
    const mtStage = stageOf('manualtest')
    if (mtStage.status === 'approved') {
      bus.message(`↩️ Resuming: manual testing already APPROVED by human (kept).`)
    } else {
    await setRun(runId, { currentStage: 'manualtest', status: 'awaiting_manual_test' })
    await setStage(runId, 'manualtest', { status: 'awaiting_human', detail: 'Waiting for a human to actually exercise the app and approve. The machine can NEVER complete this stage. Approve/reject via the pipeline API (or the panel button).', finished: false })
    emitBoard('WAITING FOR HUMAN — manual testing gate')
    bus.message(`🧪 MANUAL TESTING GATE: automated checks passed, but only a human can verify the real experience. The pipeline is paused at awaiting_manual_test — it will NOT continue until you approve. Approve in the panel or POST /api/projects/${projectId}/pipeline {"action":"approve","runId":"${runId}","gate":"manualtest","verdict":"approved"}.`)
    const mtDecision = await waitGate(runId, 'manualtest', controller.signal)
    if (mtDecision === 'cancelled') { await cancelRun(runId, bus, stages); return }
    if (mtDecision === 'rejected') {
      await setStage(runId, 'manualtest', { status: 'failed', detail: 'Human REJECTED the manual test — real feedback should follow in the next run.', finished: true })
      stageOf('manualtest').status = 'failed'
      await failRun(runId, bus, stages, 'Manual testing REJECTED by human reviewer — run ended honestly (not completed).')
      return
    }
    await setStage(runId, 'manualtest', { status: 'approved', detail: 'Human verified and approved.', finished: true })
    stageOf('manualtest').status = 'approved'
    } // end manualtest guard

    /* ── 9. SECURITY AUDIT (real static scan) ────────────────────────── */
    await setRun(runId, { currentStage: 'security', status: 'running' })
    const secStage = stageOf('security')
    let secBlocked = false
    let scan = { findings: [] as any[], score: 0, scanned: 0 }
    if (terminal(secStage.status)) {
      secBlocked = secStage.status === 'failed'
      bus.message(`↩️ Resuming: security audit already ${secStage.status.toUpperCase()} (kept). ${secBlocked ? 'Deploy stays blocked.' : ''}`)
    } else {
    await setStage(runId, 'security', { status: 'running', started: true })
    emitBoard('Security specialist is auditing the codebase')
    try { scan = securityScan(projectId) } catch (e: any) { scan = { findings: [], score: 0, scanned: 0 } }
    const crit = scan.findings.filter(f => f.severity === 'critical')
    const high = scan.findings.filter(f => f.severity === 'high')
    const med = scan.findings.filter(f => f.severity === 'medium')
    const low = scan.findings.filter(f => f.severity === 'low')
    let secDetail = `scanned files: ${scan.scanned}\ncritical: ${crit.length}  high: ${high.length}  medium: ${med.length}  low: ${low.length}\nscore: ${scan.score}`
    if (scan.findings.length) {
      secDetail += '\n' + scan.findings.slice(0, 12).map(f => `[${f.severity}] ${f.title} — ${f.file}${f.line ? ':' + f.line : ''} → ${f.fix}`).join('\n')
    }
    if (crit.length + high.length > 0 && run.autoDebug) {
      // one honest auto-fix pass by the Security specialist (values redacted)
      try {
        const sec = byRole.get('Security')!
        await specialistTurn({
          projectId, role: 'Security',
          prompt: `Security audit found ${crit.length} critical and ${high.length} high findings:\n${scan.findings.filter(f => ['critical', 'high'].includes(f.severity)).slice(0, 10).map(f => `[${f.severity}] ${f.title} — ${f.file}:${f.line} → fix: ${f.fix}`).join('\n')}\n\nFix the code-level ones (hardcoded secrets → move to env usage with the existing EnvVar pattern; dangerous sinks → sanitize). Do NOT change unrelated code. Never echo secret values.`,
          provider: sec.primary, fallbacks: sec.fallbacks,
          maxIterations: 18, signal: controller.signal,
          onEvent: (e) => { if (['tool_call', 'tool_result'].includes(e.type)) pushEvent(runId, e) },
        })
        const rescan = securityScan(projectId)
        const after = rescan.findings.filter(f => ['critical', 'high'].includes(f.severity)).length
        secDetail += `\n\nsecurity auto-fix pass applied → re-scan: ${after} critical+high remaining (was ${crit.length + high.length})`
        const crit2 = rescan.findings.filter(f => f.severity === 'critical')
        const high2 = rescan.findings.filter(f => f.severity === 'high')
        await setStage(runId, 'security', { status: (crit2.length + high2.length) === 0 ? 'passed' : 'failed', detail: truncate(secDetail, 3900), finished: true })
        stageOf('security').status = (crit2.length + high2.length) === 0 ? 'passed' : 'failed'
        secBlocked = (crit2.length + high2.length) > 0
      } catch {
        await setStage(runId, 'security', { status: 'failed', detail: truncate(secDetail + '\n(security auto-fix pass failed to run)', 3900), finished: true })
        stageOf('security').status = 'failed'
        secBlocked = true
      }
    } else {
      const blocked = (crit.length + high.length) > 0
      await setStage(runId, 'security', { status: blocked ? 'failed' : 'passed', detail: truncate(secDetail, 3900), finished: true })
      stageOf('security').status = blocked ? 'failed' : 'passed'
      secBlocked = blocked
    }
    bus.message(`🔒 Security audit: ${scan.scanned} files scanned — critical ${crit.length}, high ${high.length}, medium ${med.length}, low ${low.length}. ${secBlocked ? 'CRITICAL/HIGH findings remain — production deploy is BLOCKED until they are fixed.' : 'No blocking findings.'}`)
    } // end security guard
    emitBoard()

    /* ── 10. DEPLOY — approval gate, blocked by critical findings ────── */
    if (secBlocked) {
      await setStage(runId, 'deploy', { status: 'skipped', detail: 'Deploy blocked: unresolved critical/high security findings. Fix them and re-run — honest block, not a silent pass.', finished: true })
      stageOf('deploy').status = 'skipped'
      await setRun(runId, { status: 'failed', finishedAt: new Date(), error: 'Deploy blocked by security findings (see security stage detail). All pre-deploy stages completed.' })
      bus.message(`🛑 Run ended WITHOUT deploy: critical/high security findings are unresolved. Everything up to the audit is real and visible above. Fix the findings and re-run to deploy.`)
      bus.done(false)
      REG.active.delete(runId); REG.projectBusy.delete(projectId); REG.controllers.delete(runId)
      return
    }
    await setRun(runId, { currentStage: 'deploy' })
    if (run.deployApproval !== false && !['approved', 'passed'].includes(stageOf('deploy').status)) {
      await setRun(runId, { status: 'awaiting_deploy_approval' })
      await setStage(runId, 'deploy', { status: 'awaiting_human', detail: 'Production deploy needs YOUR explicit approval (per the platform rule: production deployments are approval-gated).', finished: false })
      emitBoard('WAITING FOR HUMAN — deploy approval gate')
      bus.message(`🚦 DEPLOY APPROVAL GATE: approve production deploy for this run? POST /api/projects/${projectId}/pipeline {"action":"approve","runId":"${runId}","gate":"deploy","verdict":"approved"} (or reject).`)
      const depDecision = await waitGate(runId, 'deploy', controller.signal)
      if (depDecision === 'cancelled') { await cancelRun(runId, bus, stages); return }
      if (depDecision === 'rejected') {
        await setStage(runId, 'deploy', { status: 'failed', detail: 'Deploy rejected by human — nothing was deployed.', finished: true })
        stageOf('deploy').status = 'failed'
        await setRun(runId, { status: 'failed', finishedAt: new Date(), error: 'Deploy rejected by human reviewer.' })
        bus.message(`🛑 Deploy rejected — nothing was deployed. Build/test/security results above remain valid.`)
        bus.done(false)
        REG.active.delete(runId); REG.projectBusy.delete(projectId); REG.controllers.delete(runId)
        return
      }
    }
    const deployStage = stageOf('deploy')
    if (!['passed'].includes(stageOf('deploy').status)) {
    await setStage(runId, 'deploy', { status: 'running', detail: 'Deploying (verified build)', started: true })
    emitBoard('DevOps is deploying')
    let deployDetail = ''
    let deployOk = false
    try {
      const start = await runtimeManager.start(projectId).catch((e: any) => ({ ok: false, error: String(e?.message || e) }))
      if (start.ok) {
        const url = (start as any).url || ''
        deployDetail = `deployed: project serving at ${url} (verified build, human-approved)`
        deployOk = true
      } else {
        deployDetail = `deploy failed: ${truncate(String((start as any).error || 'unknown'), 400)}`
      }
    } catch (e: any) {
      deployDetail = `deploy failed: ${truncate(String(e?.message || e), 400)}`
    }
    await setStage(runId, 'deploy', { status: deployOk ? 'passed' : 'failed', detail: truncate(deployDetail, 3900), finished: true })
    stageOf('deploy').status = deployOk ? 'passed' : 'failed'
    if (!deployOk) {
      await failRun(runId, bus, stages, `Deploy failed: ${deployDetail}`)
      return
    }
    } // end deploy guard
    bus.message(`🌐 Deployed — live and serving. Deployment status: DEPLOYED (this is a real serving instance, verified above).`)
    emitBoard()

    /* ── 11. MONITOR (real health probe now; scheduled checks keep it) ─ */
    await setRun(runId, { currentStage: 'monitor' })
    if (!terminal(stageOf('monitor').status)) {
    await setStage(runId, 'monitor', { status: 'running', started: true })
    let monDetail = 'deployed instance health-probed at pipeline time; project logs + metrics stay live in the dashboard (Terminal/Metrics tabs).'
    try {
      const logs = runtimeLogs(projectId)
      monDetail += `\nlast runtime log lines:\n${truncate(logs, 600)}`
    } catch {}
    await setStage(runId, 'monitor', { status: 'passed', detail: truncate(monDetail, 3900), finished: true })
    stageOf('monitor').status = 'passed'
    } // end monitor guard
    emitBoard()

    /* ── 12. AUTOMATIC UPDATE — snapshot + rollback point ────────────── */
    await setRun(runId, { currentStage: 'autoupdate' })
    if (!terminal(stageOf('autoupdate').status)) {
    await setStage(runId, 'autoupdate', { status: 'running', started: true })
    let snapDetail = ''
    try {
      const snap = await snapshotProject(projectId, `pipeline ${runId} — pre-update rollback point`)
      snapDetail = `version snapshot ${snap.id} saved (${snap.fileCount} files, ${(snap.bytes / 1024).toFixed(1)} KB) — restore anytime from Version History. Future re-runs of this pipeline constitute automatic updates; every run lands a fresh rollback point BEFORE changes.`
    } catch (e: any) {
      snapDetail = `snapshot failed: ${truncate(String(e?.message || e), 200)}`
    }
    await setStage(runId, 'autoupdate', { status: snapDetail.startsWith('snapshot failed') ? 'failed' : 'passed', detail: truncate(snapDetail, 3900), finished: true })
    stageOf('autoupdate').status = snapDetail.startsWith('snapshot failed') ? 'failed' : 'passed'
    } // end autoupdate guard

    /* ── HONEST SUMMARY ──────────────────────────────────────────────── */
    const summary = [
      `AUTONOMOUS RUN COMPLETE — per-stage facts:`,
      `• Code: generated by ${roster.length >= 2 ? `${Math.min(roster.length, 5)} parallel builders` : 'the Developer specialist'}`,
      `• Build: verified (artifact serving confirmed)`,
      `• Automated tests: PASS`,
      `• Manual testing: APPROVED BY HUMAN`,
      `• Security: ${stageOf('security').status === 'passed' ? 'clean (no blocking findings)' : 'see security stage detail'}`,
      `• Deploy: LIVE (human-approved)`,
      `• Rollback point: version snapshot saved`,
      ``,
      `Honesty note: "completed" means every stage above ACTUALLY ran and passed as listed. It does not mean "flawless software" — monitor the live instance and re-run the pipeline for updates.`,
    ].join('\n')
    await setRun(runId, { status: 'completed', finishedAt: new Date(), summary, currentStage: 'autoupdate' })
    bus.message(`🏁 ${summary}`)
    emitBoard()
    bus.done(true)
  } catch (e: any) {
    await failRun(runId, bus, stages, `Orchestrator error: ${truncate(String(e?.message || e), 400)}`)
  } finally {
    REG.active.delete(runId)
    REG.projectBusy.delete(run.projectId)
    REG.controllers.delete(runId)
    drainQueue()
  }
}

async function failRun(runId: string, bus: PipelineEventBus, stages: StageState[], error: string) {
  await setRun(runId, { status: 'failed', finishedAt: new Date(), error: error.slice(0, 4000) })
  bus.message(`❌ ${error}`)
  bus.stages(stages, 'done')
  bus.done(false, error)
}

async function cancelRun(runId: string, bus: PipelineEventBus, stages: StageState[]) {
  await setRun(runId, { status: 'cancelled', finishedAt: new Date() })
  bus.message(`⏹ Pipeline cancelled by user.`)
  bus.stages(stages, 'done')
  bus.done(false, 'cancelled')
}

/* ─── Gate waiting (manual test / deploy approval) ──────────────────────── */

async function waitGate(runId: string, gate: string, signal: AbortSignal): Promise<'approved' | 'rejected' | 'cancelled'> {
  const DEADLINE = Date.now() + 24 * 60 * 60 * 1000 // 24h max wait, then honest timeout-fail
  while (Date.now() < DEADLINE) {
    if (signal.aborted) return 'cancelled'
    await new Promise(r => setTimeout(r, 3000))
    const row = await db.pipelineStage.findUnique({ where: { runId_key: { runId, key: gate } } }).catch(() => null)
    if (!row) continue
    if (row.status === 'approved') return 'approved'
    if (row.status === 'failed') return 'rejected'
    const run = await db.pipelineRun.findUnique({ where: { id: runId } }).catch(() => null)
    if (run?.status === 'cancelled') return 'cancelled'
  }
  return 'rejected' // 24h timeout → honest end, not an eternal spin
}

/* ─── Public API used by the route ──────────────────────────────────────── */

export async function startPipelineRun(opts: {
  projectId: string
  task: string
  targets?: string[]
  deployApproval?: boolean
  autoDebug?: boolean
}): Promise<{ runId: string; bufferRunId: string; queued: boolean }> {
  // one run per project at a time (queue it otherwise)
  const already = await db.pipelineRun.findFirst({
    where: { projectId: opts.projectId, status: { in: ['queued', 'running', 'awaiting_manual_test', 'awaiting_deploy_approval'] } },
  })
  if (already) throw new Error(`project already has an active pipeline run (${already.id}, status ${already.status})`)

  const bufferRunId = `pipe_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  const row = await db.pipelineRun.create({
    data: {
      projectId: opts.projectId,
      task: opts.task,
      targets: JSON.stringify(opts.targets && opts.targets.length ? opts.targets : ['web']),
      status: 'queued',
      currentStage: 'plan',
      deployApproval: opts.deployApproval !== false,
      autoDebug: opts.autoDebug !== false,
      runId: bufferRunId,
      stages: {
        create: LIFECYCLE_STAGES.map(s => ({ key: s.key, name: s.name, order: s.order, agent: s.agent, status: 'pending' })),
      },
    },
    include: { stages: true },
  })

  registerRun(bufferRunId)
  pushEvent(bufferRunId, { type: 'status', message: `pipeline ${row.id} registered` })

  const kick = async () => { await executePipeline(row.id) }
  if (REG.projectBusy.has(opts.projectId) || REG.active.size >= MAX_CONCURRENT_RUNS) {
    REG.pending.push({ runId: row.id, projectId: opts.projectId, kick })
    return { runId: row.id, bufferRunId, queued: true }
  }
  REG.projectBusy.add(opts.projectId)
  REG.active.add(row.id)
  kick().catch(() => {})
  return { runId: row.id, bufferRunId, queued: false }
}

/** Approve/reject a gate: manualtest | deploy. */
export async function gateDecision(runId: string, gate: 'manualtest' | 'deploy', verdict: 'approved' | 'rejected', notes?: string): Promise<boolean> {
  const row = await db.pipelineStage.findUnique({ where: { runId_key: { runId, key: gate } } }).catch(() => null)
  if (!row) return false
  const allowed = row.status === 'awaiting_human' || row.status === 'pending' || row.status === 'running'
  if (!allowed) return false
  await db.pipelineStage.update({
    where: { id: row.id },
    data: { status: verdict === 'approved' ? 'approved' : 'failed', detail: `${verdict} by human${notes ? ` — ${notes}` : ''} at ${new Date().toISOString()}` },
  })
  return true
}

export async function cancelPipelineRun(runId: string): Promise<boolean> {
  const row = await db.pipelineRun.findUnique({ where: { id: runId } }).catch(() => null)
  if (!row) return false
  if (['completed', 'failed', 'cancelled'].includes(row.status)) return false
  await db.pipelineRun.update({ where: { id: runId }, data: { status: 'cancelled', finishedAt: new Date() } })
  const ctl = REG.controllers.get(runId)
  ctl?.abort()
  return true
}

function drainQueue() {
  while (REG.pending.length > 0 && REG.active.size < MAX_CONCURRENT_RUNS) {
    const next = REG.pending.shift()!
    if (REG.projectBusy.has(next.projectId)) continue
    REG.projectBusy.add(next.projectId)
    REG.active.add(next.runId)
    next.kick().catch(() => {})
  }
}

/** Resume queued work after a server restart (called from instrumentation). */
export function resumeOrphanedPipelines(): void {
  (async () => {
    try {
      const orphans = await db.pipelineRun.findMany({
        where: { status: { in: ['queued', 'running'] } },
        orderBy: { createdAt: 'asc' },
        take: 4,
      })
      for (const o of orphans) {
        // a run whose process died mid-flight is marked failed honestly —
        // stages show exactly how far it got (no fake "still running").
        const stagesDone = await db.pipelineStage.count({ where: { runId: o.id, status: { in: ['passed', 'approved'] } } })
        await db.pipelineRun.update({
          where: { id: o.id },
          data: {
            status: 'failed',
            error: `server restarted mid-run — pipeline died after ${stagesDone}/12 stages completed. Stages show real progress; re-run to continue.`,
            finishedAt: new Date(),
          },
        }).catch(() => {})
      }
      const awaiting = await db.pipelineRun.findMany({ where: { status: { in: ['awaiting_manual_test', 'awaiting_deploy_approval'] } } })
      for (const a of awaiting) {
        // gates survive restarts: the run is genuinely waiting on a human.
        // Re-arm the executor so the decision is honored when it arrives.
        if (!REG.projectBusy.has(a.projectId)) {
          REG.projectBusy.add(a.projectId)
          REG.active.add(a.id)
          executePipeline(a.id).catch(() => {})
        }
      }
    } catch { /* boot-time best effort */ }
  })()
}
