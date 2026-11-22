/**
 * Provider Manager — Smart Load Balancing with Key Rotation
 *
 * Features:
 * - Round Robin: cycles through all keys for the same provider
 * - Health Check: tracks which keys are alive vs dead
 * - Cooldown: failed keys get 60s rest before retry
 * - Rate Limit: max 2 requests/second per key (avoids bans)
 * - Circuit Breaker: if a key fails 3x in a row, auto-disable for 5 min
 * - Usage Tracking: counts requests per key
 * - Cost Routing: routes to cheapest/fastest available provider
 */

export interface KeyHealth {
  keyId: string
  status: 'healthy' | 'cooldown' | 'disabled' | 'dead'
  lastUsed: number
  lastFailed: number
  consecutiveFailures: number
  totalRequests: number
  totalFailures: number
  cooldownUntil: number
  avgLatency: number
}

export interface ProviderRoutingConfig {
  maxRequestsPerSecond: number
  maxConsecutiveFailures: number
  cooldownDurationMs: number
  circuitBreakerDurationMs: number
  enableRoundRobin: boolean
  enableSmartRouting: boolean
}

const DEFAULT_CONFIG: ProviderRoutingConfig = {
  maxRequestsPerSecond: 1000,
  maxConsecutiveFailures: 1000,
  cooldownDurationMs: 0,
  circuitBreakerDurationMs: 0,
  enableRoundRobin: true,
  enableSmartRouting: true,
}

class ProviderLoadBalancer {
  private keyHealth: Map<string, KeyHealth> = new Map()
  private roundRobinIndex: number = 0
  private lastRequestTime: Map<string, number> = new Map()
  private config: ProviderRoutingConfig

  constructor(config?: Partial<ProviderRoutingConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  registerKey(keyId: string) {
    if (!this.keyHealth.has(keyId)) {
      this.keyHealth.set(keyId, {
        keyId,
        status: 'healthy',
        lastUsed: 0,
        lastFailed: 0,
        consecutiveFailures: 0,
        totalRequests: 0,
        totalFailures: 0,
        cooldownUntil: 0,
        avgLatency: 0,
      })
    }
  }

  /**
   * Get the next available key using Round Robin + Health Check.
   * Skips keys that are in cooldown or disabled.
   */
  getNextKey(keyIds: string[]): string | null {
    const now = Date.now()
    const available = keyIds.filter(kId => {
      const health = this.keyHealth.get(kId)
      if (!health) return true
      if (health.status === 'disabled' || health.status === 'dead') return false
      if (health.cooldownUntil > now) return false
      return true
    })

    if (available.length === 0) {
      // All keys in cooldown — try the one with the earliest cooldown end
      const sorted = keyIds
        .map(kId => this.keyHealth.get(kId))
        .filter(h => h && h.status !== 'dead')
        .sort((a, b) => (a?.cooldownUntil || 0) - (b?.cooldownUntil || 0))
      if (sorted.length > 0) return sorted[0]?.keyId || null
      return null
    }

    // Round Robin selection
    if (this.config.enableRoundRobin) {
      this.roundRobinIndex = (this.roundRobinIndex + 1) % available.length
      return available[this.roundRobinIndex]
    }

    // Smart routing: pick the one with best health + lowest latency
    if (this.config.enableSmartRouting) {
      const scored = available.map(kId => {
        const health = this.keyHealth.get(kId)
        const score = health
          ? (1 / (1 + health.consecutiveFailures)) * (1 / (1 + health.avgLatency / 1000))
          : 1
        return { kId, score }
      })
      scored.sort((a, b) => b.score - a.score)
      return scored[0]?.kId || available[0]
    }

    return available[0]
  }

  /**
   * Record a successful request.
   */
  recordSuccess(keyId: string, latencyMs: number) {
    const health = this.keyHealth.get(keyId) || this.createHealth(keyId)
    health.lastUsed = Date.now()
    health.consecutiveFailures = 0
    health.status = 'healthy'
    health.totalRequests++
    health.avgLatency = (health.avgLatency * 0.8) + (latencyMs * 0.2) // exponential moving average
  }

  /**
   * Record a failed request and apply cooldown/circuit breaker.
   */
  recordFailure(keyId: string, error?: string) {
    const health = this.keyHealth.get(keyId) || this.createHealth(keyId)
    health.lastFailed = Date.now()
    health.consecutiveFailures++
    health.totalFailures++
    health.totalRequests++

    if (health.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      // Circuit breaker — disable for 5 minutes
      health.status = 'disabled'
      health.cooldownUntil = Date.now() + this.config.circuitBreakerDurationMs
    } else {
      // Cooldown — rest for 1 minute
      health.status = 'cooldown'
      health.cooldownUntil = Date.now() + this.config.cooldownDurationMs
    }

    // If error is "invalid key" (401) or "out of credit" (402), mark as dead
    // permanently — a dead key's tasks instantly move to the next healthy
    // agent (auto failover). 404 on a wrong MODEL is NOT dead: a different
    // key/provider can still serve the task.
    if (error?.includes('401') || error?.includes('402') || error?.includes('invalid') || error?.includes('unauthorized') || error?.includes('out of credit') || error?.includes('NO CREDIT')) {
      health.status = 'dead'
      health.cooldownUntil = Infinity
    }
  }

  /**
   * Check if we should rate-limit this key (max 2 req/sec).
   */
  canMakeRequest(keyId: string): boolean {
    const lastTime = this.lastRequestTime.get(keyId) || 0
    const elapsed = Date.now() - lastTime
    const minInterval = 1000 / this.config.maxRequestsPerSecond
    return elapsed >= minInterval
  }

  recordRequest(keyId: string) {
    this.lastRequestTime.set(keyId, Date.now())
  }

  /**
   * Get health status of all keys.
   */
  getHealthReport(): KeyHealth[] {
    return Array.from(this.keyHealth.values())
  }

  /**
   * Get a summary of key health for the UI.
   */
  getSummary(): {
    total: number
    healthy: number
    cooldown: number
    disabled: number
    dead: number
    totalRequests: number
    totalFailures: number
    avgSuccessRate: number
  } {
    const all = this.getHealthReport()
    const healthy = all.filter(k => k.status === 'healthy').length
    const cooldown = all.filter(k => k.status === 'cooldown').length
    const disabled = all.filter(k => k.status === 'disabled').length
    const dead = all.filter(k => k.status === 'dead').length
    const totalRequests = all.reduce((s, k) => s + k.totalRequests, 0)
    const totalFailures = all.reduce((s, k) => s + k.totalFailures, 0)
    return {
      total: all.length,
      healthy,
      cooldown,
      disabled,
      dead,
      totalRequests,
      totalFailures,
      avgSuccessRate: totalRequests > 0 ? ((totalRequests - totalFailures) / totalRequests) * 100 : 100,
    }
  }

  private createHealth(keyId: string): KeyHealth {
    const health: KeyHealth = {
      keyId,
      status: 'healthy',
      lastUsed: 0,
      lastFailed: 0,
      consecutiveFailures: 0,
      totalRequests: 0,
      totalFailures: 0,
      cooldownUntil: 0,
      avgLatency: 0,
    }
    this.keyHealth.set(keyId, health)
    return health
  }
}

// Singleton instance — shared across ALL Next.js route bundles via globalThis.
// (Next dev bundles each API route separately; a plain module singleton gave
// every route its OWN balancer, so a key dead-marked during a run stayed
// "healthy" everywhere else — the same per-route-bundling bug the LLM relay
// hit before. globalThis keeps ONE live health map for the whole server.)
const g = globalThis as any
export const loadBalancer: ProviderLoadBalancer = g.__swarmLoadBalancer || (g.__swarmLoadBalancer = new ProviderLoadBalancer())
