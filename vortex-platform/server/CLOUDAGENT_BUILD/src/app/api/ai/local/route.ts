/**
 * v111 — GET  /api/ai/local → status of the on-server open-source model
 *                              layer (server kind, installed models, the
 *                              auto-provisioned provider rows, the 6-model
 *                              install catalog). Any signed-in user: this
 *                              is what powers "build without an API key".
 *      POST /api/ai/local → ADMIN actions:
 *             { action: 'sync' }            rescan + (re)provision rows
 *             { action: 'install', model }  `ollama pull <model>` detached
 *             { action: 'remove', model }   `ollama rm` + drop its rows
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, getSessionUser } from '@/lib/auth'
import { detectLocalServer, syncLocalProviders, startOllamaPull, LOCAL_MODEL_CATALOG, LOCAL_AI_BASE } from '@/lib/ai/local'

export async function GET(req: NextRequest) {
  try {
    await requireUser(req)
  } catch (e: any) {
    if (e instanceof Response) return e
    throw e
  }
  const status = await detectLocalServer()
  const rows = await db.aIProvider.findMany({
    where: { kind: 'local' },
    select: { id: true, name: true, model: true, endpoint: true, isDefault: true, role: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({
    ok: true,
    up: status.up,
    server: status.server,
    version: status.version,
    base: LOCAL_AI_BASE,
    installed: status.models,
    error: status.error || null,
    providers: rows,
    catalog: LOCAL_MODEL_CATALOG,
  })
}

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireUser(req)
  } catch (e: any) {
    if (e instanceof Response) return e
    throw e
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'admin access required' }, { status: 403 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }
  const action = String(body?.action || '')

  if (action === 'sync') {
    const r = await syncLocalProviders()
    return NextResponse.json({ ok: true, ...r })
  }

  if (action === 'install' || action === 'remove') {
    const tag = String(body?.model || '')
    const inCatalog = LOCAL_MODEL_CATALOG.some((m) => m.ollamaName === tag)
    if (!tag || (!inCatalog && action === 'install')) {
      return NextResponse.json({ ok: false, error: 'a catalog model tag is required (e.g. qwen2.5-coder:7b)' }, { status: 400 })
    }
    const status = await detectLocalServer()
    if (!status.up) {
      return NextResponse.json({ ok: false, error: 'no local model server is running — run scripts/setup-models.sh on this host' }, { status: 503 })
    }
    if (status.server !== 'ollama') {
      return NextResponse.json(
        { ok: false, error: 'model management needs the Ollama runtime (scripts/setup-models.sh). llama.cpp/vLLM servers are managed by their own process.' },
        { status: 501 }
      )
    }
    if (action === 'install') {
      const pull = await startOllamaPull(tag)
      if (!pull.ok) return NextResponse.json({ ok: false, error: pull.error }, { status: 500 })
      return NextResponse.json({ ok: true, started: true, model: tag, note: 'pulling in the background — press Rescan in a minute' })
    }
    // remove: ollama rm + delete our provider rows for this tag
    const { exec } = await import('child_process')
    await new Promise<void>((resolve) => {
      const p = exec(`ollama rm ${JSON.stringify(tag)}`, { env: { ...process.env, OLLAMA_HOST: LOCAL_AI_BASE }, timeout: 20_000 }, () => resolve())
      p.on('error', () => resolve())
    })
    const gone = await db.aIProvider.deleteMany({ where: { kind: 'local', model: tag } })
    return NextResponse.json({ ok: true, removedRows: gone.count })
  }

  return NextResponse.json({ ok: false, error: 'unknown action — use sync | install | remove' }, { status: 400 })
}
