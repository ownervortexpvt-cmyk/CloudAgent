/**
 * /api/prompts — Prompt Library (v62).
 * The PromptLibrary table existed since early versions (and the AI's own
 * prompt_library_create tool writes into it) but there was NO way for the
 * owner to see or manage those prompts. This route + the PromptLibraryDialog
 * finally surface them.
 *
 *  GET    ?q=&category=     → list prompts (most-used first)
 *  POST   { title, prompt, category?, tags? } → create
 *  PATCH  { id, title?, prompt?, category?, use? } → edit / bump useCount
 *  DELETE ?id=              → delete
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  const category = (req.nextUrl.searchParams.get('category') || '').trim()
  const prompts = await db.promptLibrary.findMany({
    where: {
      AND: [
        q ? { OR: [{ title: { contains: q } }, { prompt: { contains: q } }] } : {},
        category && category !== 'all' ? { category } : {},
      ],
    },
    orderBy: [{ useCount: 'desc' }, { updatedAt: 'desc' }],
    take: 200,
  })
  return NextResponse.json({ ok: true, prompts })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null as any)
  const { title, prompt, category, tags } = body || {}
  if (!title || !String(title).trim()) return NextResponse.json({ ok: false, error: 'title required' }, { status: 400 })
  if (!prompt || !String(prompt).trim()) return NextResponse.json({ ok: false, error: 'prompt required' }, { status: 400 })
  const created = await db.promptLibrary.create({
    data: {
      title: String(title).slice(0, 200),
      prompt: String(prompt).slice(0, 20_000),
      category: String(category || 'general').slice(0, 40),
      tags: JSON.stringify(Array.isArray(tags) ? tags.slice(0, 10) : []),
    },
  })
  return NextResponse.json({ ok: true, prompt: created })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null as any)
  const { id } = body || {}
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.slice(0, 200)
  if (typeof body.prompt === 'string' && body.prompt.trim()) data.prompt = body.prompt.slice(0, 20_000)
  if (typeof body.category === 'string' && body.category.trim()) data.category = body.category.slice(0, 40)
  if (body.use) data.useCount = { increment: 1 }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400 })
  }
  const updated = await db.promptLibrary.update({ where: { id }, data }).catch(() => null)
  if (!updated) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true, prompt: updated })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  await db.promptLibrary.delete({ where: { id } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
