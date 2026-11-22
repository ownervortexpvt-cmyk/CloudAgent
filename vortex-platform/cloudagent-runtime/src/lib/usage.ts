/**
 * v25 — AI usage tracking (REAL numbers, recorded at the two choke points
 * every swarm/agent chat call flows through).
 *
 * Aggregated per UTC day + provider + model + kind in UsageDaily, so the
 * Usage tab can show "how many requests/tokens did each provider burn".
 */
import { db } from '@/lib/db'

export interface UsageRecord {
  provider?: string
  model?: string
  kind?: 'chat' | 'image' | 'embed'
  tokensIn?: number
  tokensOut?: number
  error?: boolean
}

export async function recordUsage(r: UsageRecord): Promise<void> {
  try {
    const day = new Date().toISOString().slice(0, 10) // UTC YYYY-MM-DD
    const provider = (r.provider || 'unknown').slice(0, 80)
    const model = (r.model || '').slice(0, 120)
    const kind = r.kind || 'chat'
    const tIn = Math.max(0, Math.floor(r.tokensIn || 0))
    const tOut = Math.max(0, Math.floor(r.tokensOut || 0))
    await db.usageDaily.upsert({
      where: { day_provider_model_kind: { day, provider, model, kind } },
      update: {
        requests: { increment: 1 },
        tokensIn: { increment: tIn },
        tokensOut: { increment: tOut },
        errorCount: { increment: r.error ? 1 : 0 },
      },
      create: {
        day, provider, model, kind,
        requests: 1,
        tokensIn: tIn,
        tokensOut: tOut,
        errorCount: r.error ? 1 : 0,
      },
    })
  } catch {
    // tracking must NEVER break a chat/swarm run
  }
}
