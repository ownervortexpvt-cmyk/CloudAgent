/**
 * /api/benchmarks — Model Benchmark results (v62).
 * The ModelBenchmark table + the AI's model_benchmark tool have existed for a
 * while, but the scores were stored and never shown anywhere. This route
 * surfaces them (and lets the owner record a manual result).
 *
 *  GET              → all benchmarks (joined with provider names, best first)
 *  POST             → upsert one result { providerId, model, task, score, latencyMs, tokensIn, tokensOut, notes? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const TASKS = ['code_generation', 'math', 'reasoning', 'translation', 'summarization', 'other']

export async function GET() {
  const rows = await db.modelBenchmark.findMany({
    orderBy: [{ task: 'asc' }, { score: 'desc' }],
    take: 500,
  })
  const providerIds = [...new Set(rows.map(r => r.providerId))]
  const providers = await db.aIProvider.findMany({
    where: { id: { in: providerIds } },
    select: { id: true, name: true, kind: true },
  })
  const nameOf = new Map(providers.map(p => [p.id, p.name]))
  return NextResponse.json({
    ok: true,
    benchmarks: rows.map(r => ({
      ...r,
      providerName: nameOf.get(r.providerId) || r.providerId,
    })),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null as any)
  const { providerId, model, task } = body || {}
  if (!providerId || !model || !task) {
    return NextResponse.json({ ok: false, error: 'providerId, model and task are required' }, { status: 400 })
  }
  const provider = await db.aIProvider.findUnique({ where: { id: String(providerId) } })
  if (!provider) return NextResponse.json({ ok: false, error: 'provider not found' }, { status: 404 })
  const t = TASKS.includes(String(task)) ? String(task) : 'other'
  const score = Math.max(0, Math.min(100, Number(body.score) || 0))
  const latencyMs = Math.max(0, Math.floor(Number(body.latencyMs) || 0))
  const tokensIn = Math.max(0, Math.floor(Number(body.tokensIn) || 0))
  const tokensOut = Math.max(0, Math.floor(Number(body.tokensOut) || 0))
  const row = await db.modelBenchmark.upsert({
    where: { providerId_model_task: { providerId: String(providerId), model: String(model).slice(0, 120), task: t } },
    create: {
      providerId: String(providerId),
      model: String(model).slice(0, 120),
      task: t,
      score,
      latencyMs,
      tokensIn,
      tokensOut,
      notes: body.notes ? String(body.notes).slice(0, 2000) : null,
    },
    update: {
      score, latencyMs, tokensIn, tokensOut,
      notes: body.notes ? String(body.notes).slice(0, 2000) : null,
    },
  })
  return NextResponse.json({ ok: true, benchmark: row })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  await db.modelBenchmark.delete({ where: { id } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
