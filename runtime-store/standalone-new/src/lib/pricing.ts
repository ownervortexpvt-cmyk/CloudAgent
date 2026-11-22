/**
 * v55 — rough cost estimation for the usage dashboard.
 *
 * HONESTY RULE: these are BLENDED approximations (US$ per 1M tokens, in+out
 * averaged) from public rate cards, used only to give the owner a ball-park
 * feeling of spend. They are NOT invoices. The UI must always label them
 * "≈ / rough estimate". Free tiers are NOT deducted here — the estimate
 * simply reports what the burned tokens WOULD cost at list price.
 */

const RATES: Record<string, number> = {
  // $ per 1M tokens (blended in+out)
  zai: 0,
  'Vortex Engine (built-in)': 0,
  gemini: 0.15,
  groq: 0.35,
  cerebras: 0.60,
  sambanova: 0.50,
  openai: 2.50,
  claude: 6.00,
  anthropic: 6.00,
  openrouter: 1.00,
  'openrouter-free': 0,
  deepseek: 0.35,
  huggingface: 0.20,
  together: 0.60,
  'together-free': 0,
  mistral: 0.90,
  modelscope: 0.90,
  siliconflow: 0.30,
  novita: 0.40,
  nebius: 0.50,
  fireworks: 0.55,
  perplexity: 1.00,
  cohere: 0.80,
  xai: 2.20,
  github: 0,
  'petals-unc': 0,
  venice: 0.60,
  'openai-compatible': 0.70,
  custom: 0.70,
}

/** Fallback for providers missing from the table — a mid-range blend. */
const DEFAULT_RATE = 0.70

export function rateFor(provider: string): number {
  const key = String(provider || '').toLowerCase().trim()
  if (key in RATES) return RATES[key]
  // fuzzy: providers often appear as "Groq", "groq/llama…", "OpenRouter (paid)"
  for (const [k, v] of Object.entries(RATES)) {
    if (k && key.includes(k)) return v
  }
  return DEFAULT_RATE
}

/** Rough US$ cost of the given token counts on this provider. */
export function estimateCostUSD(provider: string, tokensIn: number, tokensOut: number): number {
  const tokens = Math.max(0, tokensIn || 0) + Math.max(0, tokensOut || 0)
  if (tokens === 0) return 0
  return (tokens / 1_000_000) * rateFor(provider)
}

export const PRICING_NOTE = 'Rough estimate from public list prices (blended in+out per 1M tokens). Free tiers and promotions NOT deducted — real billing comes from each provider.'
