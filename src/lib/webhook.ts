/**
 * v60 — Run-finished webhook (owner-controlled run alerts).
 *
 * When set (Settings → Usage → Run alerts), EVERY finished run — single agent
 * OR swarm, launched from the app, the scheduler, or a reattached phone —
 * POSTs one JSON summary to the owner's webhook URL. Fire-and-forget with a
 * 5s timeout: a slow/broken webhook can NEVER delay or break a run.
 *
 * Security: when a secret is configured the request carries
 *   X-CA-Signature: sha256=<hex HMAC-SHA256 of the raw body with the secret>
 * so the receiver can prove the call came from this app. No keys/tokens or
 * project file contents ever travel — only run metadata + a short summary.
 */
import crypto from 'crypto'
import { db } from '@/lib/db'

export const WEBHOOK_URL_KEY = 'notify_webhook_url'
export const WEBHOOK_SECRET_KEY = 'notify_webhook_secret'

export interface RunFinishedPayload {
  event: 'run.finished'
  kind: 'single' | 'swarm'
  runId: string
  projectId: string
  status: 'completed' | 'failed' | 'stopped'
  ok: boolean
  prompt: string
  summary: string
  tokensIn?: number
  tokensOut?: number
  files?: number
  finishedAt: string
}

async function readSetting(key: string): Promise<string> {
  try {
    return (await db.userSetting.findUnique({ where: { key } }).catch(() => null))?.value || ''
  } catch {
    return ''
  }
}

/** Fire-and-forget webhook — never throws, never blocks the run path. */
export function notifyRunFinishedWebhook(p: Omit<RunFinishedPayload, 'event' | 'finishedAt'>): void {
  void (async () => {
    try {
      const url = (await readSetting(WEBHOOK_URL_KEY)).trim()
      if (!url || !/^https?:\/\//i.test(url)) return
      const secret = (await readSetting(WEBHOOK_SECRET_KEY)).trim()
      const body = JSON.stringify({ event: 'run.finished', finishedAt: new Date().toISOString(), ...p })
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (secret) {
        headers['X-CA-Signature'] = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
      }
      await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(5000) })
    } catch {
      // alerting must NEVER break a run — swallow everything, incl. DNS fails
    }
  })()
}
