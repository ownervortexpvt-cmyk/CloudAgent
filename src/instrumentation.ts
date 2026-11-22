/**
 * Next.js instrumentation hook — runs once per server process at boot.
 * v58: starts the ⏰ scheduled-runs tick so the army fires on time even
 * before anyone opens the UI. Idempotent (globalThis-guarded in the
 * scheduler itself).
 *
 * v78 sdk-doctor auto-heal: sandbox restarts keep wiping sdk/ (the
 * snapshot does not keep ~6.5G of SDK binaries while src/ survives — seen
 * 3 times now). On every boot we therefore spawn scripts/sdk-doctor.sh
 * DETACHED: it audits all 12 toolchains (jdk/flutter/android/ndk/dotnet/
 * gradle/kotlin/cmake/go/php/maven/rust) and re-installs whatever is
 * missing, resumable, single-instance (script-owned lock), logging to
 * sdk-doctor.log. Fast path when everything is present: a few stat()
 * calls, zero downloads, does not block boot.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // v117.3 — DB AUTO-HEAL: sandbox recycles keep wiping the built-in AI
    // provider rows + QA admin (the real cause of the owner's recurring
    // "app banano kaj kore na" reports). Idempotent, fire-and-forget.
    try {
      const { ensureDbHeal } = await import('@/lib/boot-heal')
      await ensureDbHeal()
    } catch (e) {
      console.error('[boot-heal] failed:', (e as any)?.message)
    }

    const { ensureScheduler } = await import('@/lib/scheduler')
    ensureScheduler()

    // v166 — PERMANENT SPECIALIST LANES: the 8 pipeline AI agents (Planner,
    // Designer, Developer, Database, Tester, Debugger, Security, DevOps) are
    // constructed HERE, once per process — always loaded, never cold-started.
    // Each lane runs glm-5.3 (strongest built-in), deep roles with SDK
    // thinking, and a per-role single-flight queue so the same lane can
    // never burst the upstream quota. Idempotent via globalThis guard.
    try {
      const { warmSpecialistLanes } = await import('@/lib/ai/lanes')
      const lanes = warmSpecialistLanes()
      console.log(`[ai-lanes] boot warm-up: ${lanes.length} lanes ready — ${lanes.map(l => `${l.role}(${l.thinking === 'enabled' ? 'think' : 'fast'})`).join(', ')}`)
    } catch (e) {
      console.error('[ai-lanes] warm-up failed:', (e as any)?.message)
    }

    // v164 — AUTONOMOUS PIPELINE RECOVERY: a server restart must never leave
    // a lifecycle run stuck on "running" (dishonest) nor drop a parked human
    // gate (manual test / deploy approval). Runs mid-flight at restart are
    // failed honestly with real progress counts; runs waiting at a gate
    // re-arm so the human decision is honored when it arrives.
    try {
      const { resumeOrphanedPipelines } = await import('@/lib/ai/lifecycle')
      resumeOrphanedPipelines()
    } catch (e) {
      console.error('[pipeline-recovery] failed:', (e as any)?.message)
    }

    // BUSINESS v2 — 4x performance: SQLite WAL journal + bigger page cache.
    // WAL removes the reader/writer lock thrash that slowed every list API
    // under concurrent runs; NORMAL sync is safe for app data and ~4x faster
    // than the default FULL on commit-heavy paths.
    try {
      const { db } = await import('@/lib/db')
      await db.$queryRawUnsafe('PRAGMA journal_mode=WAL;')
      await db.$queryRawUnsafe('PRAGMA synchronous=NORMAL;')
      await db.$queryRawUnsafe('PRAGMA cache_size=-16000;')
      await db.$queryRawUnsafe('PRAGMA busy_timeout=5000;')
    } catch (e) {
      console.error('[perf] sqlite pragmas failed:', (e as any)?.message)
    }

    // v78: SDK auto-heal (fire-and-forget — never blocks or crashes boot)
    // DISK-GUARD PATCH: sdk-doctor reinstalls up to ~4GB of toolchains
    // (jdk/flutter/android/ndk/dotnet/gradle/...) on every boot when sdk/ is
    // missing — on the 10GB rootfs that silently filled the disk to 100% and
    // killed bun install + the dev server (the "NoSpaceLeft" boot failures).
    // Auto-heal now runs ONLY when the marker file .sdk-autoheal exists.
    // Re-enable anytime: touch /home/z/my-project/.sdk-autoheal
    // Manual install when needed: bash scripts/sdk-doctor.sh
    try {
      const fs = await import('fs')
      const { spawn } = await import('child_process')
      if (!fs.existsSync('/home/z/my-project/.sdk-autoheal')) {
        fs.appendFileSync(
          '/home/z/my-project/sdk-doctor.log',
          `[${new Date().toISOString()}] server boot — sdk-doctor SKIPPED (disk-guard: .sdk-autoheal marker absent)\n`
        )
      } else {
      fs.appendFileSync(
        '/home/z/my-project/sdk-doctor.log',
        `[${new Date().toISOString()}] server boot — spawning sdk-doctor (pid ${process.pid})\n`
      )
      const child = spawn('bash', ['/home/z/my-project/scripts/sdk-doctor.sh'], {
        cwd: '/home/z/my-project',
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, SDK_DOCTOR_AUTORUN: '1' },
      })
      child.on('error', (e) => {
        try { fs.appendFileSync('/home/z/my-project/sdk-doctor.log', `sdk-doctor spawn error: ${e}\n`) } catch {}
      })
      child.unref()
      } // close .sdk-autoheal guard
    } catch {}

    // v80: boot-guard — (1) re-enforce the gradle JVM memory ceiling
    // (snapshot restores can regenerate sdk/ WITHOUT gradle-home; an
    // un-capped gradle build is exactly what OOM-killed next-server during
    // publish) and (2) ensure the dev-watchdog (:3000 probe + cold
    // recovery) is alive. Single-instance + idempotent, fire-and-forget.
    try {
      const { spawn } = await import('child_process')
      const g = spawn('bash', ['/home/z/my-project/scripts/boot-guard.sh'], {
        cwd: '/home/z/my-project',
        detached: true,
        stdio: 'ignore',
      })
      g.on('error', () => {})
      g.unref()
    } catch {}

    // v146 WATCHDOG RE-ARM — this server process is a boot-tree child and
    // therefore immortal, but the dev-watchdog it spawns can still be
    // reaped mid-session (sandbox reaper sweeps stray setsid processes;
    // incident 06:42: watchdog + :3200 both dead while :3000 stayed up).
    // Every 5 min: if the watchdog lock is missing or stale (>150 s), spawn
    // boot-guard again — it is single-instance (lock-owned) so re-running is
    // always safe. Any child of THIS process survives the reaper.
    try {
      const fs = await import('fs')
      const { spawn } = await import('child_process')
      const rearm = () => {
        try {
          const LOCK = '/home/z/my-project/.dev-watchdog.lock'
          let stale = true
          try {
            const age = (Date.now() - fs.statSync(LOCK).mtimeMs) / 1000
            stale = age > 150
          } catch {}
          if (stale) {
            const g = spawn('bash', ['/home/z/my-project/scripts/boot-guard.sh'], {
              cwd: '/home/z/my-project',
              detached: true,
              stdio: 'ignore',
            })
            g.on('error', () => {})
            g.unref()
          }
        } catch {}
      }
      rearm()
      const t: any = setInterval(rearm, 300_000)
      try { t.unref() } catch {}
    } catch {}

    // v111: LOCAL AI SYNC — detect the on-server open-source model runtime
    // (Ollama / llama.cpp on :11434) and auto-provision an AIProvider row for
    // every installed model, so users can build apps with zero API keys.
    // Fire-and-forget with a hard timeout: a dead model server costs one
    // refused localhost fetch, never boot time.
    try {
      const { syncLocalProviders } = await import('@/lib/ai/local')
      Promise.race([
        syncLocalProviders(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('local-ai sync timeout')), 8000)),
      ])
        .then((r: any) => {
          if (r?.up && r?.created) console.log(`[local-ai] provisioned ${r.created} open-source model(s) — no API key needed`)
          else if (r?.up) console.log(`[local-ai] ${r.models?.length || 0} local model(s) already provisioned`)
        })
        .catch(() => {})
    } catch {}

    // v111: local model RUNTIME watchdog at boot — if this host has Ollama or
    // a configured LOCAL_AI_AUTOSTART_CMD, make sure the zero-key model
    // server is alive before the first user asks for it.
    try {
      const { ensureLocalRuntime } = await import('@/lib/ai/local-runtime')
      ensureLocalRuntime().then((r) => {
        if (r.up) console.log('[local-ai] runtime up — open-source models ready (no API key needed)')
        else if (r.spawned) console.log(`[local-ai] runtime starting via ${r.spawned}`)
      }).catch(() => {})
    } catch {}

    // v160 PUBLIC TUNNEL — keep ONE stable public https URL
    // (https://vortexagent.loca.lt → :3000) alive as a child of THIS
    // process, so the Cloudflare Pages proxy
    // (vortex-cloud-agent.pages.dev → tunnel) always has a live backend,
    // on this boot and every future boot. Idempotent: globalThis guard +
    // pid lock (scripts/tunnel-keeper.js re-checks and self-exits).
    try {
      const fs = await import('fs')
      const { spawn } = await import('child_process')
      const g = globalThis as unknown as { __caTunnelSpawned?: boolean }
      if (!g.__caTunnelSpawned) {
        g.__caTunnelSpawned = true
    // v162: project-RELATIVE path (cwd is /home/z/my-project) — Next 16's
    // server tracer rejects absolute spawn paths outside the project root.
    const child = spawn('node', ['scripts/tunnel-keeper.js'], {
          cwd: '/home/z/my-project',
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, TUNNEL_PORT: '3000' },
        })
        child.on('error', () => {})
        child.unref()
        console.log('[tunnel] keeper spawned (public URL keeper for the Pages proxy)')
      }
    } catch (e) {
      console.error('[tunnel] keeper spawn failed:', (e as any)?.message)
    }
  }
}
