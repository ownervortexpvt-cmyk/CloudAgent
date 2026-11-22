import { NextRequest, NextResponse } from 'next/server'
import * as storage from '@/lib/storage'
import { requireProjectAccess } from '@/lib/auth'

/**
 * GET /api/files/[id] — the file TREE for a project ([id] = projectId).
 * The query-param form (/api/files?projectId=…&path=…) reads individual file
 * contents — this form returns the whole tree for FileTree, CommandPalette
 * quick-open and LivePreview admin detection: { tree: TreeNode }.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try { await requireProjectAccess(req, id) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  try {
    const tree = storage.listTree(id, '.')
    return NextResponse.json({ ok: true, tree })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed to list files' }, { status: 500 })
  }
}
