/**
 * /api/providers/health-record — KEY HEALTH memory (v52 rebuild, was v46).
 *
 * Every REAL test verdict (Get or Test, device or server, pass or
 * 401/402/403 fail) is remembered here so the Provider Manager can show
 * "Last Test on X: PASSED/FAILED · N min ago" — even after the dialog is
 * closed or the page reloaded. Storage: UserSetting KV "health_verdicts"
 * (JSON array, newest first, capped at 200 — a verdict log can never grow
 * unbounded or break the builder).
 *
 * Additive: nothing reads this except the Provider Manager health chips.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const KV_KEY = 'health_verdicts'
const CAP = 200

export interface KeyHealthVerdict {
  id: string
  name: string
  kind: string
  endpoint: string | null
  model?: string
  ok: boolean
  status?: number
  error?: string
  via: string // 'device' | 'server' | 'get-device' | 'get-server'
  at: number // epoch ms
}

async function readAll(): Promise<KeyHealthVerdict[]> {
  try {
    const row = await db.userSetting.findUnique({ where: { key: KV_KEY } })
    if (!row?.value) return []
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writeAll(list: KeyHealthVerdict[]): Promise<void> {
  await db.userSetting.upsert({
    where: { key: KV_KEY },
    update: { value: JSON.stringify(list.slice(0, CAP)) },
    create: { key: KV_KEY, value: JSON.stringify(list.slice(0, CAP)) },
  })
}

export async function GET() {
  return NextResponse.json({ ok: true, verdicts: await readAll() })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null as any)
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'JSON body required' }, { status: 400 })
  const name = String(body.name || '').trim()
  const kind = String(body.kind || '').trim()
  if (!name || !kind) return NextResponse.json({ ok: false, error: 'name and kind required' }, { status: 400 })
  const clean = (v: unknown, max: number) => String(v ?? '').slice(0, max)

  const verdict: KeyHealthVerdict = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: clean(name, 80),
    kind: clean(kind, 40),
    endpoint: body.endpoint ? clean(body.endpoint, 200) : null,
    model: body.model ? clean(body.model, 120) : undefined,
    ok: !!body.ok,
    status: typeof body.status === 'number' ? body.status : undefined,
    error: body.error ? clean(body.error, 300) : undefined,
    via: clean(body.via || 'device', 16),
    at: Date.now(),
  }
  const list = await readAll()
  list.unshift(verdict) // newest first
  await writeAll(list)
  return NextResponse.json({ ok: true, verdict, verdicts: list.slice(0, CAP) })
}
