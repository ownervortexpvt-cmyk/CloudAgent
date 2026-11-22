import { NextRequest, NextResponse } from 'next/server'
import { detectKey } from '@/lib/ai/key-detect'

/**
 * POST /api/providers/auto-detect
 * Body: { apiKey: string, endpoint?: string }
 *
 * When the user enters just an API key and clicks "Get", this route:
 *   1. Checks the key PREFIX to narrow down which provider it belongs to
 *   2. Probes ALL candidate providers' /models endpoints IN PARALLEL (fast)
 *   3. VERIFIES the winning candidate with a tiny chat completion
 *   4. Returns the provider name + ALL available models for that key
 *
 * v3 — logic moved to the shared lib src/lib/ai/key-detect.ts so
 * /api/providers/quick-setup can reuse the exact same detection pipeline.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const { apiKey, endpoint } = body || {}

  if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 10) {
    return NextResponse.json({ ok: false, error: 'API key is required (min 10 characters)' }, { status: 400 })
  }

  const result = await detectKey(apiKey, endpoint)
  return NextResponse.json(result, { status: result.ok ? 200 : 200 })
}
