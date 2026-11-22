import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ALL_TEMPLATES, getTemplate } from '@/lib/templates'
import { ensureProjectDir, writeMany } from '@/lib/storage'
import { detectFramework } from '@/lib/framework'
import { triggerProvisioning } from '@/lib/provision'
import { requireUser } from '@/lib/auth'
import { assertProjectCreate } from '@/lib/plan-guard'

/**
 * /api/templates — Template Marketplace.
 *  GET  → all framework starters + ready-made apps (grouped info)
 *  POST { templateId, name } → create a project seeded from the template
 * (creation is done INLINE — identical logic to POST /api/projects — so the
 * middleware can't block an internal hop and no extra HTTP hop happens).
 */
export async function GET() {
  const list = ALL_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    framework: t.framework,
    runtime: t.runtime,
    description: t.description,
    icon: t.icon,
    fileCount: t.files.length,
  }))
  return NextResponse.json({ ok: true, templates: list, count: list.length })
}

export async function POST(req: NextRequest) {
  let user
  try {
    user = await requireUser(req)
    await assertProjectCreate(user)
  } catch (e: any) {
    if (e instanceof Response) return e as any
    throw e
  }

  const body = await req.json().catch(() => null)
  const templateId = String((body as any)?.templateId || '')
  const name = String((body as any)?.name || '').trim()
  if (!templateId) return NextResponse.json({ error: 'templateId required' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const tpl = getTemplate(templateId)
  if (!tpl) {
    return NextResponse.json({ error: `unknown template: ${templateId}`, hint: 'GET /api/templates lists every id' }, { status: 404 })
  }

  const project = await db.project.create({
    data: {
      name,
      description: tpl.description || null,
      framework: tpl.framework || null,
      runtime: tpl.runtime || null,
      userId: user.id,
    },
  })

  ensureProjectDir(project.id)
  writeMany(project.id, tpl.files)
  for (const f of tpl.files) {
    await db.file.upsert({
      where: { projectId_path: { projectId: project.id, path: f.path } },
      create: { projectId: project.id, path: f.path, content: f.content, isDir: false },
      update: { content: f.content },
    }).catch(() => {})
  }

  const detection = detectFramework(project.id)
  await db.project.update({
    where: { id: project.id },
    data: { framework: detection.framework, runtime: detection.runtime, language: detection.language },
  }).catch(() => {})

  // v81 — background toolchain provisioning (never blocks the create).
  try {
    triggerProvisioning({ projectId: project.id, projectName: name, language: detection.language, source: 'create' })
  } catch { /* best-effort */ }

  return NextResponse.json({ ok: true, project, filesWritten: tpl.files.length })
}
