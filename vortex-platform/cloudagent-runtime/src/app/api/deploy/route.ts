import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runtimeManager } from '@/lib/runtime'
import { detectFramework } from '@/lib/framework'
import * as storage from '@/lib/storage'
import { requireProjectAccess } from '@/lib/auth'
import { collectSiteFiles } from '@/lib/vortex/publish'
import { deploySite, slugWithSuffix } from '@/lib/selfhost'

/**
 * POST /api/deploy — v157: ONE publish path, INSIDE the platform.
 *
 * OWNER DECISION (final, no exceptions): Vortex Cloud Agent IS the hosting,
 * the app builder, the server — everything. Nothing is ever published through
 * a third-party platform. The old CLI targets (Vercel / Netlify / Cloudflare
 * Pages / GitHub Pages) are REMOVED; their ids are still accepted so old
 * callers and old agent runs keep working, but they are transparently
 * redirected into the same in-platform flow. The site goes LIVE on THIS
 * platform's own URL: /sites/<slug>/ — served by the platform itself.
 */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { projectId, target } = body
  if (!projectId || !target) return NextResponse.json({ error: 'projectId and target required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }

  const project = await db.project.findUnique({ where: { id: projectId } }).catch(() => null)
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  // Legacy third-party ids are accepted only as aliases for the in-platform
  // self-host flow — no external command is ever run.
  const LEGACY = ['vercel', 'netlify', 'cloudflare', 'github-pages']
  if (target !== 'self-host' && !LEGACY.includes(target)) {
    return NextResponse.json({ ok: false, error: `Unknown deploy target: ${target}` }, { status: 400 })
  }
  const redirected = LEGACY.includes(target)

  const build = await db.build.create({ data: { projectId, target: 'self-host', status: 'running', startedAt: new Date() } })

  try {
    const detection = detectFramework(projectId)
    const staticOut = (detection.framework === 'static' || !detection.buildCommand) ? undefined : (detection.outputDir || undefined)
    let logs = redirected
      ? `[vortex] "${target}" is a third-party host — removed by owner decision. Vortex publishes INSIDE the platform only; running the in-platform publish instead.\n`
      : ''
    if (detection.framework !== 'static' && detection.buildCommand) {
      const r = await runtimeManager.build(projectId)
      logs += r.logs || ''
      if (!r.ok) {
        await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: logs || 'build failed', finishedAt: new Date() } })
        return NextResponse.json({ ok: false, error: 'build failed before self-host deploy', logs })
      }
    }
    const root = storage.projectRoot(projectId)
    const { files, totalBytes } = collectSiteFiles(root, staticOut)
    if (!files.length) {
      await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: logs + '\nno site files found to deploy', finishedAt: new Date() } })
      return NextResponse.json({ ok: false, error: 'no site files found to deploy', logs })
    }
    const siteName = (project.name || 'vortex-site').slice(0, 60)
    // stable per-project slug: same project → same site, version bumps
    const siteId = slugWithSuffix(siteName, project.id)
    const ownerEmail = (project as any).ownerEmail || (project as any).userEmail || 'cloud-agent@vortex.local'
    const dep = await deploySite(siteId, files, { name: siteName, ownerEmail })
    // v157.3 — RELATIVE live URL: baking `new URL(req.url).origin` produced
    // http://0.0.0.0:3000/… whenever the server bound 0.0.0.0, so the owner's
    // publish toast/anchor pointed at a dead link. A relative /sites/<id>/
    // path is origin-correct everywhere: the browser resolves it against the
    // URL the owner is actually on (platform URL, gateway, future domain).
    const liveUrl = dep.ok ? dep.url : ''
    logs += `\n[self-host] ${files.length} files / ${totalBytes}B → ${dep.ok ? `v${dep.version} LIVE at ${liveUrl}` : `FAILED: ${dep.error}`}`.trim()
    await db.build.update({ where: { id: build.id }, data: { status: dep.ok ? 'success' : 'failed', logs, finishedAt: new Date() } })
    if (!dep.ok) return NextResponse.json({ ok: false, error: dep.error, logs })
    return NextResponse.json({
      ok: true,
      target: 'self-host',
      redirected,
      siteId,
      version: dep.version,
      files: dep.files,
      liveUrl,
      logs,
    })
  } catch (e: any) {
    await db.build.update({
      where: { id: build.id },
      data: { status: 'failed', logs: e.message, finishedAt: new Date() },
    })
    return NextResponse.json({ ok: false, error: e.message })
  }
}

/** GET — the only deploy target: LIVE inside the platform itself. */
export async function GET() {
  return NextResponse.json({
    targets: [
      { id: 'self-host', label: 'Live INSIDE Vortex', hint: 'Published on this platform at /sites/<slug>/ — served by Vortex itself. No third-party hosting, ever.' },
    ],
    note: 'Third-party hosting (Vercel / Netlify / Cloudflare / GitHub Pages) was removed by owner decision. Legacy target ids are auto-redirected to the in-platform publish.',
  })
}
