/**
 * BUSINESS v2 — subscription plans (monthly, INR ₹).
 *
 * Five paid tiers + a small free tier so new signups can try the builder.
 * Prices are the owner's published rates; activation happens through
 * Razorpay checkout (UPI / cards / netbanking) with HMAC verification.
 *
 * v111 — LIFETIME REMOVED by owner decision: nobody is ever granted
 * permanent access. Every plan is a rolling 30-day subscription —
 * revenue stays recurring and every active user renews monthly.
 * (Legacy planKind='lifetime' rows in the DB keep working read-only,
 * but no new lifetime purchase can ever be created.)
 */

export type PlanId = 'free' | 'pro' | 'pro_plus' | 'ultra' | 'pro_max' | 'ultra_pro_max'

export interface PlanDef {
  id: PlanId
  name: string
  priceINR: number
  tagline: string
  maxProjects: number // -1 = unlimited
  maxRunsPerMonth: number
  maxSwarmAgents: number
  maxTokensPerMonth: number
  highlight?: boolean
  features: string[]
}

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: 'free',
    name: 'Free',
    priceINR: 0,
    tagline: 'Big Billion Day only — 1st of every month, 8 AM–12 PM IST',
    maxProjects: 1,
    maxRunsPerMonth: 10,
    maxSwarmAgents: 2,
    maxTokensPerMonth: 100_000,
    features: ['Big Billion Day: 4 free hours every month (1st, 8 AM–12 PM IST)', 'Pro-level power during the window', 'No card needed', 'Keep what you build', 'Upgrade anytime from ₹1,999/mo'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceINR: 1999,
    tagline: 'For solo builders',
    maxProjects: 5,
    maxRunsPerMonth: 100,
    maxSwarmAgents: 20,
    maxTokensPerMonth: 2_000_000,
    features: ['5 projects', '100 AI runs / month', '20-agent swarm', '2M tokens / month', 'Terminal + deploy', 'Email support'],
  },
  pro_plus: {
    id: 'pro_plus',
    name: 'Pro Plus',
    priceINR: 2999,
    tagline: 'For growing makers',
    maxProjects: 15,
    maxRunsPerMonth: 300,
    maxSwarmAgents: 50,
    maxTokensPerMonth: 6_000_000,
    features: ['15 projects', '300 AI runs / month', '50-agent swarm', '6M tokens / month', 'Scheduled runs', 'Priority support'],
  },
  ultra: {
    id: 'ultra',
    name: 'Ultra',
    priceINR: 3999,
    tagline: 'For serious shipping',
    maxProjects: 40,
    maxRunsPerMonth: 800,
    maxSwarmAgents: 120,
    maxTokensPerMonth: 15_000_000,
    highlight: true,
    features: ['40 projects', '800 AI runs / month', '120-agent swarm', '15M tokens / month', 'All toolchains', 'Priority support'],
  },
  pro_max: {
    id: 'pro_max',
    name: 'Pro Max',
    priceINR: 4999,
    tagline: 'For power teams',
    maxProjects: 100,
    maxRunsPerMonth: 2000,
    maxSwarmAgents: 300,
    maxTokensPerMonth: 40_000_000,
    features: ['100 projects', '2000 AI runs / month', '300-agent swarm', '40M tokens / month', 'Custom domains', 'Dedicated support'],
  },
  ultra_pro_max: {
    id: 'ultra_pro_max',
    name: 'Ultra Pro Max',
    priceINR: 6000,
    tagline: 'Unlimited power',
    maxProjects: 400,
    maxRunsPerMonth: 10_000,
    maxSwarmAgents: 1000,
    maxTokensPerMonth: 150_000_000,
    features: ['400 projects', '10,000 AI runs / month', '1000-agent swarm', '150M tokens / month', 'Everything unlocked', 'Direct line to the owner'],
  },
}

export const PAID_PLAN_ORDER: PlanId[] = ['pro', 'pro_plus', 'ultra', 'pro_max', 'ultra_pro_max']

// v111: the one-time Lifetime offer is GONE — subscriptions only.
// /api/billing/order rejects kind='lifetime' outright, so this can never
// come back through the checkout path either.

export function getPlan(id: string | null | undefined): PlanDef {
  return PLANS[(id as PlanId)] || PLANS.free
}

export function formatINR(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`
}
