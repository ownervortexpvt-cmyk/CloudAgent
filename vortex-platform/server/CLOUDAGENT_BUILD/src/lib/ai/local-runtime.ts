/**
 * v112 — LOCAL MODEL RUNTIME WATCHDOG (recreated after recycle loss).
 *
 * Makes sure the zero-key open-source model server on :11434 is alive:
 *   1. probe LOCAL_AI_BASE (Ollama OR our node-llama-cpp server both answer)
 *   2. if nothing answers and LOCAL_AI_AUTOSTART_CMD is set → spawn it
 *      (rate-limited to one spawn attempt per minute; the command is
 *      expected to serve OpenAI-compatible /v1/models on :11434)
 *
 * Called from instrumentation boot + the scheduler 30s tick, so a crashed
 * model server self-heals without any human touching the box.
 */
import { LOCAL_AI_BASE } from './local'

let lastSpawnAt = 0
const SPAWN_COOLDOWN_MS = 60_000

async function probe(): Promise<boolean> {
  for (const path of ['/v1/models', '/api/version']) {
    try {
      const r = await fetch(`${LOCAL_AI_BASE}${path}`, { signal: AbortSignal.timeout(1200), cache: 'no-store' })
      if (r.ok) return true
    } catch { /* not up */ }
  }
  return false
}

export async function ensureLocalRuntime(): Promise<{ up: boolean; spawned?: string; error?: string }> {
  if (await probe()) return { up: true }

  const cmd = String(process.env.LOCAL_AI_AUTOSTART_CMD || '').trim()
  if (!cmd) return { up: false, error: 'no LOCAL_AI_AUTOSTART_CMD configured' }

  const now = Date.now()
  if (now - lastSpawnAt < SPAWN_COOLDOWN_MS) return { up: false, error: 'spawn cooldown' }
  lastSpawnAt = now

  try {
    const { spawn } = await import('child_process')
    const logFd = process.env.LOCAL_AI_LOG || '/tmp/local-ai.log'
    const child = spawn('bash', ['-c', `${cmd} >> ${logFd} 2>&1`], {
      detached: true,
      stdio: 'ignore',
      env: process.env as NodeJS.ProcessEnv,
    })
    child.on('error', () => { /* binary absent — status stays honest */ })
    child.unref()
    // give it a short grace period, then report honestly
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 700))
      if (await probe()) return { up: true, spawned: cmd }
    }
    return { up: false, spawned: cmd, error: 'started but not answering yet (check /tmp/local-ai.log)' }
  } catch (e: any) {
    return { up: false, error: e?.message || 'spawn failed' }
  }
}
