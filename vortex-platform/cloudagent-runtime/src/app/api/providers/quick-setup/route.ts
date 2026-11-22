import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/crypto'
import { syncVault } from '@/lib/provider-vault'
import { detectKey, prefixSignature } from '@/lib/ai/key-detect'

/**
 * POST /api/providers/quick-setup
 * Body: {
 *   keys: string[]                    — one or MANY API keys (Quick API Setup paste box)
 *   preverified?: Array<{             — keys ALREADY verified BROWSER-DIRECTLY from the
 *     key: string,                      user's device (some providers Cloudflare-block the
 *     providerKind: string,             server's datacenter IP — the server can never
 *     providerName: string,             verify them itself, so the client did it)
 *     endpoint: string,
 *     models: Array<{ id: string }>,
 *     model?: string,
 *   }>
 * }
 *
 * One-shot "paste keys → everything configured" flow:
 *   1. Dedupes against keys ALREADY in the pool and duplicates inside the payload
 *      (the same key can never be added twice — the same provider with DIFFERENT
 *      keys is always allowed)
 *   2. Saves every preverified (device-verified) key instantly — no re-probing
 *   3. Groups the remaining keys by prefix signature (gsk_ → Groq family, …) and
 *      runs the server detection pipeline once per GROUP (representative key)
 *   4. Saves every key as its own provider row — so with N distinct keys the
 *      AI Army gets N working agents (keys = agents)
 *
 * Returns: { ok, added[], duplicates, failed[], groups[] }
 */

const MAX_KEYS_PER_CALL = 2000

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const rawKeys: unknown = body?.keys
  const rawPreverified: unknown = body?.preverified

  let keys: string[] = Array.isArray(rawKeys)
    ? rawKeys.filter((k: any) => typeof k === 'string')
    : typeof rawKeys === 'string' ? [rawKeys] : []

  const preverified: Array<{
    key: string
    providerKind: string
    providerName: string
    endpoint: string
    models: Array<{ id: string }>
    model?: string
  }> = Array.isArray(rawPreverified)
    ? rawPreverified.filter((p: any) => p && typeof p.key === 'string' && p.key.length >= 10 && typeof p.providerKind === 'string')
    : []

  keys = keys.map(k => k.trim()).filter(k => k.length >= 10)
  if (keys.length === 0 && preverified.length === 0) {
    return NextResponse.json({ ok: false, error: 'No valid API keys provided (each needs 10+ characters)' }, { status: 400 })
  }
  if (keys.length + preverified.length > MAX_KEYS_PER_CALL) {
    return NextResponse.json({ ok: false, error: `Too many keys (${keys.length + preverified.length}). Max ${MAX_KEYS_PER_CALL} per call.` }, { status: 400 })
  }

  // ─── Dedupe: keys already in the pool + repeats inside this payload ────
  const existingKeys = new Set<string>()
  const existingNameCounts = new Map<string, number>()
  try {
    const rows = await db.aIProvider.findMany({ select: { apiKeyEnc: true, name: true } })
    for (const r of rows) {
      if (r.apiKeyEnc) {
        try { existingKeys.add(decrypt(r.apiKeyEnc)) } catch {}
      }
      existingNameCounts.set(r.name, (existingNameCounts.get(r.name) || 0) + 1)
    }
  } catch {}

  const seen = new Set<string>()
  const fresh: string[] = []
  let duplicates = 0
  const failed: Array<{ keyHint: string; error: string }> = []
  const added: Array<{ id: string; name: string; provider: string; kind: string; model: string; modelsCount: number; verified: boolean; via?: string; models?: Array<{ id: string }> }> = []

  /** Save one verified key as its own provider row. Returns the added entry
   *  or pushes into `failed`. Numbering continues from the existing pool. */
  async function saveKey(opts: {
    key: string
    providerKind: string
    providerName: string
    endpoint: string
    models: Array<{ id: string }>
    model?: string
    via: 'device' | 'server'
  }) {
    const baseName = opts.providerName.replace(/\s*\(legacy sk-\)\s*$/, '')
    const start = existingNameCounts.get(baseName) || 0
    const solo = start === 0 && added.filter(a => a.provider === baseName).length === 0
    const name = solo ? baseName : `${baseName} ${start + added.filter(a => a.provider === baseName).length + 1}`
    const model = opts.model || opts.models[0]?.id || 'glm-4.6'
    try {
      const row = await db.aIProvider.create({
        data: {
          name,
          kind: opts.providerKind,
          endpoint: opts.endpoint || null,
          model,
          apiKeyEnc: encrypt(opts.key),
          temperature: 0.7,
          isDefault: false,
        },
      })
      await syncVault()
      existingNameCounts.set(baseName, (existingNameCounts.get(baseName) || 0) + 1)
      added.push({
        id: row.id,
        name,
        provider: baseName,
        kind: opts.providerKind,
        model,
        modelsCount: opts.models.length,
        verified: true,
        via: opts.via,
        models: opts.models.slice(0, 200),
      })
    } catch (e: any) {
      failed.push({ keyHint: `${baseName} key …${opts.key.slice(-4)}`, error: e?.message || 'database write failed' })
    }
  }

  // ─── 1) Device-preverified keys: dedupe + save instantly (no re-probe) ──
  for (const pv of preverified) {
    const k = pv.key.trim()
    if (existingKeys.has(k) || seen.has(k)) { duplicates++; continue }
    seen.add(k)
    await saveKey({
      key: k,
      providerKind: pv.providerKind,
      providerName: pv.providerName,
      endpoint: pv.endpoint || '',
      models: Array.isArray(pv.models) ? pv.models.filter((m: any) => m && typeof m.id === 'string') : [],
      model: pv.model,
      via: 'device',
    })
  }

  for (const k of keys) {
    if (existingKeys.has(k) || seen.has(k)) { duplicates++; continue }
    seen.add(k)
    fresh.push(k)
  }

  if (fresh.length === 0) {
    const bits: string[] = []
    if (added.length) bits.push(`${added.length} key(s) added via YOUR DEVICE — each one is now a working agent in the pool`)
    if (duplicates) bits.push(`${duplicates} duplicate(s) skipped (same key never works twice)`)
    return NextResponse.json({
      ok: true,
      added,
      duplicates,
      failed,
      groups: [],
      summary: bits.join(' · ') || `All ${duplicates} key(s) were duplicates — nothing new added. The same key never works twice.`,
    })
  }

  // ─── Group by prefix signature; detect ONE representative per group ────
  const groups = new Map<string, string[]>()
  for (const k of fresh) {
    const sig = prefixSignature(k)
    if (!groups.has(sig)) groups.set(sig, [])
    groups.get(sig)!.push(k)
  }

  for (const [sig, groupKeys] of groups) {
    const rep = groupKeys[0]
    const det = await detectKey(rep)

    if (!det.ok || !det.detected) {
      // Whole group failed — report with the representative's hint
      failed.push({
        keyHint: det.keyHint || `key starting with ${sig}`,
        error: det.error || 'Could not verify this key with any supported provider',
      })
      continue
    }

    const { providerKind, providerName, endpoint, models, verified } = det.detected

    for (let i = 0; i < groupKeys.length; i++) {
      await saveKey({
        key: groupKeys[i],
        providerKind,
        providerName,
        endpoint: endpoint || '',
        models,
        model: models[0]?.id,
        via: 'server',
      })
    }
    void verified
  }

  const bits: string[] = []
  if (added.length) {
    const viaDevice = added.filter(a => a.via === 'device').length
    bits.push(`${added.length} key(s) detected and added${viaDevice ? ` (${viaDevice} via YOUR DEVICE)` : ''} — each one is now a working agent in the pool`)
  }
  if (duplicates) bits.push(`${duplicates} duplicate(s) skipped (same key never works twice)`)
  if (failed.length) bits.push(`${failed.length} could not be verified`)

  return NextResponse.json({
    ok: true,
    added,
    duplicates,
    failed,
    groups: Array.from(groups.keys()),
    summary: bits.join(' · ') || 'Nothing to add',
  })
}
