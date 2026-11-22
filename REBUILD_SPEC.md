# REBUILD SPEC — v31–v49 (lost to environment reset on Sep 2, 2026)

> **DISASTER**: The sandbox was reset to the Task-37 snapshot (v30 era). All commits v31→v49,
> all E2E suites v31+, all `scripts/e2e-v3x–v4x*` files, `src/lib/ai/{swarm,checkpoint,status-help}.ts`,
> and ALL DB provider rows (the owner's API keys) were LOST. The 16 projects + their files SURVIVE.
> `run-buffer.ts` + `/api/agent/{abort,resume}` + `/api/multi-agent/relay` survived (Task ≤37 era).
>
> This file is the authoritative rebuild spec, reconstructed from the worklog entries that were
> preserved in conversation context (v46/v47/v48/v49 verbatim; v42–v45 summarized). Follow it
> top-down: r1 engine → r2 board UI → r3 provider manager → r4 checkpoint → r5 army board.
> Rebuild with the same discipline: additive only, real implementations, E2E per step.

## Baseline that still exists (Task 37 / v30 tree)
- `src/lib/ai/run-buffer.ts` — registerRun/pushEvent/subscribeRun/detachViewer/abortRun/setAbortFn, 8k events cap, 60 runs, 15-min TTL, globalThis HMR-safe.
- `/api/agent` (356 lines) — single-agent NDJSON stream, run_started, run-buffer tee (needs verifying), browser relay, abort/resume wired.
- `/api/agent/abort`, `/api/agent/resume` — rejoin replays buffered events + live-tails to done.
- `src/lib/ai/agent.ts` (495 lines) — `runAgent(opts)` only, no swarm, no agentSystemPrompt, no strictProvider.
- `/api/multi-agent` (871 lines) — army route: pool+dedupe, sticky key↔agent, leaders plan (max 4), 5 phases (leader→setup→feature→writers→quality→coordinate), runAgentOnce rotation loop (maxAttempts = max(3, min(pool,50))), writeAgentFiles `=== FILE: path ===` parser, relay park, `cancel()` currently ABORTS on client disconnect (v50+ must fix: survive disconnect like chat screen).
- Components: AgentPanel 776L (no board), MultiAgentPanel 726L (no army board), ProviderManagerDialog 1235L (11 curated providers, no key guide/health).

## r1 → ship as v50 — SWARM ENGINE CORE (was v44+v45)
`src/lib/ai/swarm.ts` (~510 lines when lost):
- `SwarmSlot { id, name, kind, title, brief, status: pending|building|done|failed, files: string[], error?, systemPrompt? }`
- `SwarmOptions { providers: PoolEntry-ish[], task, projectId?, failover (default ON), agentSystemPrompt? , strictProvider? }`
- `runSwarm(...)` AsyncGenerator or event-emitter driving the SAME AgentEvent NDJSON contract:
  - Planning phase: leader agent produces plan; splits into N stream briefs (one per available agent/provider).
  - ALL streams run in PARALLEL (v44) — not sequentially. Broken-key leader → takeover: if the leader's key 401s, another healthy agent takes over planning; the swarm NEVER shrinks to 1 agent.
  - Rate-limit-aware scheduler (v46): streams sharing ONE provider kind flow through a lane of `SWARM_PER_PROVIDER_CONCURRENCY` (default 4) concurrent builds; DIFFERENT kinds fully parallel; queued streams announced ("⏳ … provider lane full — no stream is dropped"); every stream still runs.
  - Each stream: runAgent with tools; builtFiles = real tool_call written paths; announce progress as chat `message` events; final per-agent snapshot.
  - Integrator phase at the end (unless failover OFF and its stream failed → fail loudly).
  - Emits `{ type:'swarm' }` structured snapshots (phase: planning → assign → build → integrate) carrying per-agent `{ id, name, kind, title, status, files, error }`.
  - CONTRACT: the stream's LAST event stays `done`. (asserted in E2E)
  - failover ON (default): broken stream rescued down the fallback chain, silent built-in Z.ai last resort. failover OFF (v47 strict): workers get fallbackProviders [], planner candidates = slots[0] only, no Z.ai rescue, stream announces "♻️ failover is OFF — every agent builds with its own key only".
- `agent.ts` additive: `AgentRunOptions.agentSystemPrompt` (prepends to base system briefing; devmode systemOverride still wins) + `strictProvider` (primary ONLY — skips fallback chain AND silent built-in Z.ai).
- `/api/agent` wiring: `loadProvidersFast` caches role/isDefault/createdAt/systemPrompt, sorts default → leader → creation order (👑 leaders plan first + lead single-agent runs); body.providerId moves chosen agent to front = leader (per-run picker); body.failover plumbed into runSwarm and runAgent; 4s heartbeat events during silent LLM turns (v45); body.providerId optional (absent = all-agent swarm, default).
- E2E (lost suites to recreate): engine suite under stub LLMs (real production stack): board events/phases/agents/kinds/statuses/files, LAST-event-is-done contract, scheduler cap timing proofs (cap=2 → max concurrency 2 with 8 streams; separate kinds side-by-side), no-drop, no-idle padding, takeover proof, strict-mode honest 401 + fallback NEVER called, source asserts. Live suite vs production server with real built-in Z.ai: run_started, ~4s heartbeats, resume cursor.

## r2 → ship as v51 — SWARM BOARD UI + chat-screen parity (was v45+v46 UI)
`AgentPanel.tsx` (776 → ~1300 lines):
- SwarmBoard component: live per-agent cards from `{type:'swarm'}` snapshots — amber building / emerald done / red failed; role icons (Crown/ShieldCheck/SearchCheck/FileCode2/Wrench); ↑/↓ toggle header with live counts (N agents · R running · D done · F failed · files); per-agent file counters fed by real tool_call paths.
- ↑/↓ collapse buttons on code walls (v45) + COLLAPSE MEMORY — choice persists per payload across reloads (foldKeyOf → localStorage, key prefix `ca:fold:`).
- RUN HISTORY: real summaries persisted per project (time · finished/failed · duration · files · tokens) in 🕘 header dropdown (localStorage per project).
- Hidden-tab NOTIFICATION: run finished/failed pings via Notification API when document.hidden.
- Transcript windowing: render last 300 messages + "Show earlier messages (N hidden)" one-tap widen (200-agent floods stay smooth).
- Auto-rejoin CONFIRMS recovery: "Reconnected — every missed event was replayed" banner.
- Per-run agent picker (v47): compact run-controls row — "🌐 All agents (N) — parallel swarm" (default) or any saved agent (👑/🤖 name · model); persists per project (`ca:runpick:`); pool fetched from /api/providers.
- Failover toggle chip (v47): "♻️ failover ON / OFF · strict" (emerald/amber), persisted (`ca:failover:`), disabled while running.
- Badge → `build NN · N providers · swarm board`.

## r3 → ship as v52 — PROVIDER MANAGER rebuild (was v46 PM + v47 role chips)
`ProviderManagerDialog.tsx`:
- Dropdown = owner's EXACT 11 in his order + 4 FREE appended: Auto → Custom → Gemini → GROQ → GPT → OpenRouter → SambaNova → DeepInfra → DeepSeek → AI/ML → Z.ai → Cerebras (free) → Hugging Face (free) → Together (free credit) → Mistral (free tier) = 15. NOTHING removed, order untouched. Full catalog Q_PROVIDERS (26 entries incl. xAI, Claude, Perplexity, Cohere, Moonshot, Qwen, ModelScope, GitHub Models, MiniMax, Venice, DeepInfra, Ollama, LM Studio, Petals, Fireworks, SiliconFlow, Novita, Nebius) still loads/saves/tests already-saved rows.
- KEY GUIDE: real signup steps + free-tier truth + provider's own key-page link, for selected provider AND collapsible all-15 list.
- KEY HEALTH: every real Test verdict (device or server, pass or 401/402 fail) remembered + "Last Test on X: PASSED/FAILED · N min ago".
- ROLE TEMPLATE CHIPS (v47): 8 one-tap chips above system prompt — 🧩 General (clears), 🎨 Frontend, ⚙️ Backend, 🗄️ Database, 🧪 QA/Tester, 🔍 Reviewer, 📚 Docs, 🔧 DevOps — fill system prompt; active chip highlights.
- BUILT-IN Z.ai row: NO API key needed, pick model, Save (glm-4.6/4.5/4-flash/4v/4-air/4-airx).
- Owner's keys MUST be re-added by the OWNER (lost from DB) — his ModelScope `ms-…` key was the only real one.

## r4 → ship as v53 — CHECKPOINT RESUME 断点续跑 (was v48)
`src/lib/ai/checkpoint.ts`:
- v1 schema `{ prompt, plannerName, failover, streams: [{ title, brief, files, status: pending|done|failed, builtFiles (REAL written paths), error }] }`.
- `saveCheckpoint` (serialized through a promise chain so parallel finishes never interleave), `loadCheckpoint` (validates v===1), `clearCheckpoint`, `countsOf`, `checkpointSummary`; ALL writes best-effort — a checkpoint problem can never break a run.
- Store in DB ProjectSetting (projectId+key unique) — survives restarts, zero file-tree pollution.
- `swarm.ts` integration: runOne records each stream's FINAL truth — the 'error' EVENT (not just catch) marks failed (runAgent never throws on provider failure — it emits error and returns); per-stream persist right after each finishes; resolution BEFORE integrator (last event stays done); fully recovered → cleared + "🧾 checkpoint cleared"; still-unfinished → kept + "🔁 N stream(s) still unfinished — checkpoint saved".
- Resume mode: plan restored from checkpoint (planner SKIPPED entirely), done streams KEPT (never re-queued, files byte-identical), failed/pending rebuild with same briefs, integrator gets RESUMED-build context line.
- `/api/agent/resume-run`: GET ?projectId → resumable summary (drives UI chip); POST { projectId, providerId?, failover? } → same NDJSON contract (run_started, heartbeats, rejoin via /api/agent/resume, abort, done last); providerId = leader of resumed build (picker parity); honest 404 "No unfinished run found".
- AgentPanel: 🔁 chip "Resume last run — X/Y streams built, Z to rebuild →" (sky); refresh on project open AND after every run; ✕ dismiss hides locally (server checkpoint stays).

## r5 → ship as v54 — ARMY BOARD + army unbreakable parity (was v49 + v50-plan)
`MultiAgentPanel.tsx` (726 → ~950 lines):
- BoardAgent ledger fed by 7 new setBoard wirings ALONGSIDE untouched addLog calls: agent_start→running card, agent_update→live lastUpdate, files_written→counter+lastPath, provider_switch→🔁 counter, agent_result→done/failed+provider/model/duration/tokens/error+viaDevice, relay_ok→⚡ badge, relay_fail→note.
- ArmyBoard mirrors SwarmBoard visual language + filter chips (all/running/done/failed, live counts) + BOARD_RENDER_CAP=60 + "… and N more" footer (5000-agent army never melts DOM). TWO mounts sharing one open state: live between stat cards and feed DURING run, post-run above Leader battle plan. Board resets every launch. Log feed, stat cards, roster, presets, leader plan/summary, stop, relay — byte-untouched.
- Unbreakable parity (planned v50-pre-reset, include here): `/api/multi-agent` cancel() must NOT abort on client disconnect (detachViewer + keep buffering instead — mirror chat screen); 4s heartbeat; `/api/multi-agent/rejoin` replay route; run history + hidden-tab notification.
- E2E pattern (v49): throwaway production server on :3010 with DATABASE_URL → byte-COPY of app DB with provider rows stripped IN THE COPY; pool = 2 stub rows with DISTINCT keys (identical encrypted keys collapse to 1 via pool deduper); prove sticky-key 401 → provider_switch → same agent finishes on next key; a failed AGENT never fails the RUN; ledger reconstruction = exact ArmyBoard logic.

## Rebuild order & version numbering
Ship as v50, v51, v52, v53, v54 (NEW numbers — do NOT reuse v31–v49). Each: tsc 0 errors + NEW E2E suite + full regression of all existing suites + commit `vNN: rebuild … (was vXX, lost to env reset)` + worklog Task ID continuing from 50.

## Ops notes (hard-won, still true)
- `next build` standalone does NOT include .next/static — copy `cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/` or every page 404s its hydration chunks ("Application error: a client-side exception").
- This environment kills servers between tool-call sessions; start servers as a CHILD of the E2E script in the SAME invocation (see scripts/run-browser-e2e.sh pattern — recreate it).
- E2E stub pattern: rule-based stub LLMs keyed by stream-title matching, one-shot per rule — turn-count stubs race under parallelism.
- Z.ai platform 429 / Groq 403 are external; owner's real keys: only ModelScope `ms-…` worked; 401/402 from other providers is EXPECTED and must be self-explained (status-help — v43, rebuild opportunistically into r1/r2: 401 → key invalid/steps, 402 → no credit/free-tier link).
