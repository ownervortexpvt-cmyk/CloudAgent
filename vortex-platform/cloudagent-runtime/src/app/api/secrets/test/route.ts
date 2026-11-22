import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decrypt } from '@/lib/crypto'
import { detectKey, getKeyHint } from '@/lib/ai/key-detect'
import { isUnlockedRequest } from '@/lib/lock'
import { requireProjectAccess, requireUser, UNAUTH_RESPONSE } from '@/lib/auth'

/**
 * POST /api/secrets/test — v63 restores the "Test connection" button.
 *
 * The SecretsManagerDialog has always POSTed here ({ key, id?, scope,
 * projectId? }), but the route itself was never migrated — every click
 * 404'd and the toast showed a JSON parse error. This is the REAL route.
 *
 * Resolution rules:
 *   scope=project → EnvVar row by id (projectId must match) — decrypted
 *                   server-side if isSecret.
 *   scope=global  → UserSetting `secret:<key>` (or `secret:<key>:plain`).
 *
 * Verdict is HONEST, in three tiers:
 *   1. Provider-shaped key (≥10 chars) → runs the same live detect pipeline
 *      as /api/providers/auto-detect (probe /models + tiny chat verify).
 *   2. Non-key value (DB URL, token, ...) → stored value exists AND decrypts
 *      — reported as verified-stored, no live call (nothing to call).
 *   3. Not found / wrong scope → 404 or ok:false with the exact reason.
 *
 * The value itself NEVER leaves the server — responses carry metadata only.
 */
export async function POST(req: NextRequest) {
  if (!(await isUnlockedRequest(req))) {
    return NextResponse.json({ error: 'locked' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'body required' }, { status: 400 })
  }
  // BUSINESS v2 (hardened): authenticated users only; global secrets are
  // admin territory; project secrets demand ownership of THAT project.
  const user = await requireUser(req).catch(() => null)
  if (!user) return UNAUTH_RESPONSE() as any

  const key = typeof body.key === 'string' ? body.key : ''
  const id = typeof body.id === 'string' ? body.id : ''
  const scope: 'project' | 'global' = body.scope === 'project' ? 'project' : 'global'
  const projectId = typeof body.projectId === 'string' ? body.projectId : undefined
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }

  let value = ''
  if (scope === 'project') {
    if (!id) return NextResponse.json({ error: 'id required for project secrets' }, { status: 400 })
    const row = await db.envVar.findUnique({ where: { id } }).catch(() => null)
    if (!row) return NextResponse.json({ error: 'secret not found' }, { status: 404 })
    if (projectId && row.projectId !== projectId) {
      return NextResponse.json({ error: 'secret belongs to a different project' }, { status: 404 })
    }
    // ownership of the row's REAL project — even when the caller omits projectId
    try { await requireProjectAccess(req, row.projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
    value = row.isSecret ? decrypt(row.value) : row.value
  } else {
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'admin access required for global secrets' }, { status: 403 })
    }
    if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })
    const row = await db.userSetting.findUnique({ where: { key: `secret:${key}` } }).catch(() => null)
      ?? await db.userSetting.findUnique({ where: { key: `secret:${key}:plain` } }).catch(() => null)
    if (!row) return NextResponse.json({ error: 'secret not found in global storage' }, { status: 404 })
    const isSecret = !row.key.endsWith(':plain')
    value = isSecret ? decrypt(row.value) : row.value
  }

  if (!value) {
    return NextResponse.json({ ok: false, scope, error: 'stored value is empty' })
  }

  // Tier 1 — provider-shaped key (a RECOGNIZED key format: sk-…, gsk_…,
  // AIza…, hf_…, id.secret …): run the REAL live detection pipeline.
  // Unrecognized strings (generic tokens, UUIDs, DB creds) are NOT live-
  // probed — a DB token deserves "stored & decrypts", not a scary probe
  // failure against 30 unrelated providers.
  const hint = getKeyHint(value)
  if (value.length >= 10 && /^[A-Za-z0-9_\-\.~=+\/]+$/.test(value) && !hint.startsWith('Key format not recognized')) {
    const result = await detectKey(value)
    if (result.ok && result.detected?.verified) {
      return NextResponse.json({
        ok: true,
        scope,
        provider: result.detected.providerName,
        model: result.detected.models?.[0]?.id,
        message: `live-verified via ${result.detected.providerName}`,
      })
    }
    return NextResponse.json({
      ok: false,
      scope,
      error: result.error || 'key did not verify with any supported provider',
    })
  }

  // Tier 2 — not a recognized provider key: stored AND decrypts is what we
  // can honestly claim (nothing to live-call). Provider keys should go
  // through the Provider Manager's Get/Test flow instead.
  return NextResponse.json({
    ok: true,
    scope,
    message: 'value stored & decrypts correctly (no provider key format detected — no live check)',
  })
}
