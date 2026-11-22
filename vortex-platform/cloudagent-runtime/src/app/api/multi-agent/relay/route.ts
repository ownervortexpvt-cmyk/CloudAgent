import { NextRequest, NextResponse } from 'next/server'
import { resolveRelay } from '@/lib/ai/relay-registry'
import { requireUser } from '@/lib/auth'

/**
 * POST /api/multi-agent/relay
 *
 * The BROWSER-DIRECT relay answer endpoint. During a swarm run, when a
 * provider Cloudflare-blocks the server (Groq → 403 for every key), the run
 * streams `{type:'llm_request', reqId, …}` to the browser; the browser calls
 * the provider FROM THE USER'S DEVICE and POSTs the answer here. This endpoint
 * resolves the parked request inside /api/multi-agent so the blocked agent
 * continues its work.
 *
 * Body: {
 *   reqId: string
 *   ok: boolean
 *   status?: number          // HTTP status from the provider
 *   content?: string         // assistant text on success
 *   error?: string           // error text on failure
 *   tokensIn?: number
 *   tokensOut?: number
 * }
 */
export async function POST(req: NextRequest) {
  // v138 SECURITY FIX — this endpoint resolves parked swarm LLM requests
  // (and can inject content into a running swarm), so it must never answer
  // anonymous callers. Require a signed-in session.
  try {
    await requireUser(req)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    return NextResponse.json({ ok: false, error: 'signed out — please log in' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body.reqId !== 'string') {
    return NextResponse.json({ ok: false, error: 'reqId required' }, { status: 400 })
  }

  const resolved = resolveRelay(body.reqId, {
    ok: !!body.ok,
    status: typeof body.status === 'number' ? body.status : undefined,
    content: typeof body.content === 'string' ? body.content : undefined,
    error: typeof body.error === 'string' ? body.error : undefined,
    tokensIn: typeof body.tokensIn === 'number' ? body.tokensIn : undefined,
    tokensOut: typeof body.tokensOut === 'number' ? body.tokensOut : undefined,
    via: 'device',
  })

  // Unknown/expired reqIds are fine — the relay may have timed out already
  return NextResponse.json({ ok: true, resolved })
}
