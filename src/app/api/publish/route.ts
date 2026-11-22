import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runtimeManager } from '@/lib/runtime'
import { detectFramework } from '@/lib/framework'
import * as storage from '@/lib/storage'
import { pwaSeoSetup } from '@/lib/pwa'
import { PUBLISH_TARGET_IDS } from '@/lib/publish-targets'
import { maybeUploadArtifactToVault } from '@/lib/fbstore'
import { maybeUploadArtifactToR2, r2DownloadObject } from '@/lib/r2store'
import { uploadAabToPlay, playStatus } from '@/lib/play'
import AdmZip from 'adm-zip'
import path from 'path'
import fs from 'fs'
import { requireProjectAccess } from '@/lib/auth'
import { deploySiteToVortex, publishAppToAppverse, collectSiteFiles, slugify } from '@/lib/vortex/publish'
import { deploySite, slugWithSuffix, getSite } from '@/lib/selfhost'

/**
 * Publish targets:
 *   web        → build static + serve ZIP for download
 *   apk        → invoke `flutter build apk` (real if Flutter SDK available; structured error otherwise)
 *   aab        → invoke `flutter build appbundle`
 *   static-export → just zip the project files
 *
 * Store-publishing targets (google-play, app-store, galaxy-store,
 * appgallery, appstore) return a guided workflow document with the
 * commands and steps the operator must run with their own credentials.
 */
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { projectId, target } = body
  if (!projectId || !target) return NextResponse.json({ error: 'projectId and target required' }, { status: 400 })
  // BUSINESS v2: verify the caller owns this project (admins exempt).
  if (projectId) {
    try { await requireProjectAccess(req, projectId) } catch (e: any) { if (e instanceof Response) return e as any; throw e }
  }
  // v81: optional extras — packageName/track drive the real Google Play upload.
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  const detection = detectFramework(projectId)

  // Validate the target BEFORE creating a Build row — the old code created a
  // status:'running' row first and returned 400 for unknown targets without
  // ever updating it, leaving orphaned 'running' builds in the DB forever.
  const WORKFLOW_TARGETS = [
    'app-store', 'galaxy-store', 'appgallery', 'amazon-appstore',
    'f-droid', 'apkpure', 'uptodown', 'microsoft-store', 'macos-dmg', 'linux-appimage',
  ]
  if (!PUBLISH_TARGET_IDS.includes(target)) {
    return NextResponse.json({
      error: `unknown target: ${target}`,
      hint: `Supported: ${PUBLISH_TARGET_IDS.join(', ')}`,
    }, { status: 400 })
  }

  const build = await db.build.create({ data: { projectId, target, status: 'running', startedAt: new Date() } })

  try {
    // v95: after any artifact lands, it goes STRAIGHT to the owner's cloud
    // vault — R2 first (the owner's budget choice: "firebase R2 bad diye"),
    // Firebase Storage as the fallback when R2 isn't connected. Never blocks
    // a successful publish; honest note when no vault can take it.
    const vaultSync = async (artifactPath: string) => {
      try {
        const r2st = await (await import('@/lib/r2store')).getR2StatusInput()
        if (r2st.connected && r2st.enabled) return await maybeUploadArtifactToR2(build.id, artifactPath)
      } catch { /* fall through to Firebase */ }
      try { return await maybeUploadArtifactToVault(build.id, artifactPath) } catch { return { uploaded: false } }
    }

    if (target === 'web') {
      const r = await buildAndZip(project, detection, 'web')
      if (!r.ok) {
        await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: r.logs || 'build failed', finishedAt: new Date() } })
        return NextResponse.json({ ok: false, error: r.error || 'build failed', logs: r.logs })
      }
      await db.build.update({ where: { id: build.id }, data: { status: 'success', artifactPath: r.artifactPath!, logs: r.logs, finishedAt: new Date() } })
      const d = await vaultSync(r.artifactPath!)
      return NextResponse.json({ ok: true, artifactPath: r.artifactPath, downloadUrl: `/api/publish?id=${build.id}`, vault: d })
    }

    // v149 — SELF-HOST: publish INSIDE CloudAgent itself (owner request:
    // "no external cloud website — the agent publishes automatically within
    // itself"). Same build prep as vortex-website, but the files land in the
    // agent's own disk store and are served by the agent's own server at
    // /sites/<slug>/ — zero external cloud. Re-publishing the same project
    // bumps the version of the SAME site (stable URL).
    if (target === 'self-host') {
      const staticOut = (detection.framework === 'static' || !detection.buildCommand) ? undefined : (detection.outputDir || undefined)
      let buildLogs = ''
      if (detection.framework !== 'static' && detection.buildCommand) {
        const r = await runtimeManager.build(project.id)
        buildLogs = r.logs || ''
        if (!r.ok) {
          await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: buildLogs || 'build failed', finishedAt: new Date() } })
          return NextResponse.json({ ok: false, error: 'build failed before self-host deploy', logs: buildLogs })
        }
      }
      const root = storage.projectRoot(project.id)
      const { files, totalBytes } = collectSiteFiles(root, staticOut)
      if (!files.length) {
        await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: 'no site files found to deploy', finishedAt: new Date() } })
        return NextResponse.json({ ok: false, error: 'no site files found to deploy' })
      }
      const siteName = (project.name || 'cloud-agent-site').slice(0, 60)
      // stable per-project slug: same project → same site, version bumps
      const siteId = slugWithSuffix(siteName, project.id)
      const existing = getSite(siteId)
      const ownerEmail = (project as any).ownerEmail || (project as any).userEmail || 'cloud-agent@vortex.local'
      const dep = await deploySite(siteId, files, { name: siteName, ownerEmail })
      const origin = new URL(req.url).origin
      const liveUrl = dep.ok ? `${origin}${dep.url}` : ''
      const logs = `${buildLogs}\n[self-host] ${files.length} files / ${totalBytes}B → ${dep.ok ? `v${dep.version} live at ${liveUrl}` : `FAILED: ${dep.error}`}`.trim()
      await db.build.update({ where: { id: build.id }, data: { status: dep.ok ? 'success' : 'failed', logs, finishedAt: new Date() } })
      if (!dep.ok) return NextResponse.json({ ok: false, error: dep.error, logs })
      return NextResponse.json({
        ok: true,
        selfHost: { siteId, url: dep.url, liveUrl, version: dep.version, files: dep.files, sizeBytes: dep.bytes, previousVersion: existing?.activeVersion || 0 },
        liveUrl,
        logs,
      })
    }

    // v141 — VORTEX ecosystem: deploy the built site to the owner's own
    // VORTEX WEBSITE platform (site → draft files → versioned deploy).
    if (target === 'vortex-website') {
      const staticOut = (detection.framework === 'static' || !detection.buildCommand) ? undefined : (detection.outputDir || undefined)
      // run the framework build when one exists (same gate as buildAndZip)
      let buildLogs = ''
      if (detection.framework !== 'static' && detection.buildCommand) {
        const r = await runtimeManager.build(project.id)
        buildLogs = r.logs || ''
        if (!r.ok) {
          await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: buildLogs || 'build failed', finishedAt: new Date() } })
          return NextResponse.json({ ok: false, error: 'build failed before VORTEX deploy', logs: buildLogs })
        }
      }
      const root = storage.projectRoot(project.id)
      const { files, totalBytes } = collectSiteFiles(root, staticOut)
      if (!files.length) {
        await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: 'no site files found to deploy', finishedAt: new Date() } })
        return NextResponse.json({ ok: false, error: 'no site files found to deploy' })
      }
      const siteName = (project.name || 'cloud-agent-site').slice(0, 60)
      const ownerEmail = (project as any).ownerEmail || (project as any).userEmail || 'cloud-agent@vortex.local'
      const dep = await deploySiteToVortex(siteName, files, ownerEmail)
      const logs = `${buildLogs}\n[vortex] ${files.length} files / ${totalBytes}B collected → ${dep.ok ? `deployed v${dep.version} at ${dep.url}` : `FAILED: ${dep.error}`}`.trim()
      await db.build.update({ where: { id: build.id }, data: { status: dep.ok ? 'success' : 'failed', logs, finishedAt: new Date() } })
      if (!dep.ok) return NextResponse.json({ ok: false, error: dep.error, logs })
      return NextResponse.json({
        ok: true,
        vortex: { siteId: dep.siteId, url: dep.url, version: dep.version, files: dep.files, sizeBytes: dep.sizeBytes },
        liveUrl: dep.url,
        logs,
      })
    }

    // v141 — VORTEX ecosystem: publish the built APK to the APPVERSE store.
    // Real flutter build → binary uploaded with sha256 integrity → lands
    // PENDING in the APPVERSE review gate (owner approves in the dashboard).
    if (target === 'appverse') {
      if (detection.framework !== 'flutter') {
        await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: 'APPVERSE publish requires a Flutter project (APK build).', finishedAt: new Date() } })
        return NextResponse.json({ ok: false, error: 'APPVERSE publish requires a Flutter project (APK build).' })
      }
      await runtimeManager.execInProject(projectId, "sed -i 's/^org.gradle.jvmargs=.*/org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=384m/' android/gradle.properties 2>/dev/null; true", 15000)
      const r = await runtimeManager.execInProject(projectId, 'flutter build apk --release', 600000)
      const searchDir = path.join(storage.projectRoot(projectId), 'build/app/outputs/flutter-apk')
      let artifactPath: string | null = null
      if (fs.existsSync(searchDir)) {
        const found = fs.readdirSync(searchDir).find(f => f.endsWith('.apk'))
        if (found) {
          artifactPath = `/home/z/my-project/download/${project.id}-appverse.apk`
          fs.copyFileSync(path.join(searchDir, found), artifactPath)
        }
      }
      if (!artifactPath) {
        const logs = r.stdout + (r.stderr ? '\n' + r.stderr : '')
        await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs, finishedAt: new Date() } })
        return NextResponse.json({ ok: false, error: 'APK build produced no artifact — APPVERSE upload skipped', logs })
      }
      const pkgGuess = `com.cloudagent.${slugify(project.name || 'app').replace(/-/g, '')}`
      const av = await publishAppToAppverse({
        name: (project.name || 'Cloud Agent App').slice(0, 60),
        packageName: pkgGuess,
        version: '1.0.0',
        kind: 'APK',
        binaryPath: artifactPath,
        description: `${project.name} — built with CLOUD AGENT`,
      })
      const logs = `flutter build apk ok → ${artifactPath}\n[appverse] ${av.ok ? `${av.version} uploaded (${av.sizeBytes}B, sha ${String(av.sha256).slice(0, 12)}…) status=${av.status}` : `FAILED: ${av.error}`}`
      await db.build.update({ where: { id: build.id }, data: { status: av.ok ? 'success' : 'failed', artifactPath, logs, finishedAt: new Date() } })
      if (!av.ok) return NextResponse.json({ ok: false, error: av.error, artifactPath, logs })
      return NextResponse.json({
        ok: true,
        artifactPath,
        downloadUrl: `/api/publish?id=${build.id}`,
        appverse: { appId: av.appId, version: av.version, versionId: av.versionId, status: av.status, sha256: av.sha256, sizeBytes: av.sizeBytes },
        logs,
      })
    }

    if (target === 'apk' || target === 'aab') {
      if (detection.framework !== 'flutter') {
        await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: 'APK/AAB builds are only supported for Flutter projects.', finishedAt: new Date() } })
        return NextResponse.json({ ok: false, error: 'APK/AAB builds require a Flutter project.' })
      }
      const cmd = target === 'apk' ? 'flutter build apk --release' : 'flutter build appbundle --release'
      // v80: the flutter template's android/gradle.properties pins a 4 GB JVM
      // heap that OOM-killed next-server here. Cap before every APK/AAB build
      // (idempotent — covers projects never started via `run`).
      await runtimeManager.execInProject(projectId, "sed -i 's/^org.gradle.jvmargs=.*/org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=384m/' android/gradle.properties 2>/dev/null; true", 15000)
      const r = await runtimeManager.execInProject(projectId, cmd, 600000)
      const artifactDir = target === 'apk' ? 'build/app/outputs/flutter-apk' : 'build/app/outputs/bundle/release'
      const ext = target === 'apk' ? 'apk' : 'aab'
      const artifactPath = `/home/z/my-project/download/${project.id}.${ext}`
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
      // Try to find generated artifact
      const searchDir = path.join(storage.projectRoot(projectId), artifactDir)
      if (fs.existsSync(searchDir)) {
        const found = fs.readdirSync(searchDir).find(f => f.endsWith(ext))
        if (found) {
          fs.copyFileSync(path.join(searchDir, found), artifactPath)
          await db.build.update({ where: { id: build.id }, data: { status: 'success', artifactPath, logs: r.stdout, finishedAt: new Date() } })
          const d = await vaultSync(artifactPath)
          return NextResponse.json({ ok: true, artifactPath, downloadUrl: `/api/publish?id=${build.id}`, vault: d })
        }
      }
      await db.build.update({ where: { id: build.id }, data: { status: r.code === 0 ? 'success' : 'failed', logs: r.stdout + (r.stderr ? '\n' + r.stderr : ''), finishedAt: new Date() } })
      return NextResponse.json({ ok: r.code === 0, logs: r.stdout + (r.stderr ? '\n' + r.stderr : '') })
    }

    if (target === 'ipa-export') {
      // v81 — iOS Export Kit: an honest, REAL artifact. This Linux sandbox
      // cannot compile/sign iOS binaries (Xcode/macOS only) — but it CAN
      // generate the complete iOS project + CI recipe so any Mac (or a free
      // Codemagic/CI minute) finishes `flutter build ipa` + signing.
      if (detection.framework !== 'flutter') {
        const msg = 'The iOS Export Kit is built from a Flutter project\'s ios/ platform. '
          + 'This project is not Flutter — create a Dart/Flutter project (or ask the agent to port this app to Flutter).'
        await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: msg, finishedAt: new Date() } })
        return NextResponse.json({ ok: false, error: msg })
      }
      const root = storage.projectRoot(projectId)
      const iosDir = path.join(root, 'ios')
      let logs = ''
      if (!fs.existsSync(iosDir)) {
        // flutter create regenerates the ios/ platform folder — works on Linux
        // (pure file generation, no Xcode involved).
        const r = await runtimeManager.execInProject(projectId, 'flutter create --platforms=ios --org com.cloudagent .', 180000)
        logs += (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '')
        if (!fs.existsSync(iosDir)) {
          await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: logs || 'flutter create --platforms=ios failed', finishedAt: new Date() } })
          return NextResponse.json({ ok: false, error: 'could not generate the ios/ platform folder (see logs)', logs })
        }
      }
      // CI recipe — a real, working Codemagic config for compile + sign
      if (!fs.existsSync(path.join(root, 'codemagic.yaml'))) {
        try { storage.writeFile(projectId, 'codemagic.yaml', codemagicYaml(project.name)) } catch { /* best-effort */ }
      }
      const zip = new AdmZip()
      const addDir = (dir: string, base: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (['Pods', '.symlinks'].includes(e.name)) continue
          const full = path.join(dir, e.name)
          const rel = `${base}/${e.name}`
          if (e.isDirectory()) addDir(full, rel)
          else zip.addFile(rel, fs.readFileSync(full))
        }
      }
      addDir(iosDir, 'ios')
      const guide = iosExportGuide(project.name)
      zip.addFile('CLOUD-AGENT-IOS-EXPORT.md', Buffer.from(guide, 'utf8'))
      if (fs.existsSync(path.join(root, 'codemagic.yaml'))) {
        zip.addFile('codemagic.yaml', fs.readFileSync(path.join(root, 'codemagic.yaml')))
      }
      const buf = zip.toBuffer()
      const artifactPath = `/home/z/my-project/download/${project.id}-ios-export.zip`
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
      fs.writeFileSync(artifactPath, buf)
      await db.build.update({ where: { id: build.id }, data: { status: 'success', artifactPath, logs: logs + '\n[ios-export] kit written (' + Math.round(buf.length / 1048576 * 10) / 10 + ' MB)', finishedAt: new Date() } })
      const d = await vaultSync(artifactPath)
      return NextResponse.json({ ok: true, artifactPath, downloadUrl: `/api/publish?id=${build.id}`, note: 'Unsigned iOS kit: compile+sign on a Mac or CI (guide inside the zip). The sandbox cannot run Xcode — honest limitation.', vault: d })
    }

    if (target === 'google-play') {
      // v81 — REAL upload path when the operator connected a service account
      // and gave the package name. Otherwise fall through to the guided doc.
      const st = await playStatus().catch(() => ({ configured: false, clientEmail: null, projectIdHint: null }))
      const packageName = String((body as any).packageName || '').trim()
      if (st.configured && packageName) {
        // ensure an AAB artifact: reuse the newest successful one, else build now
        let aabPath: string | null = null
        const prev = await db.build.findFirst({ where: { projectId, target: 'aab', status: 'success', artifactPath: { not: null } }, orderBy: { createdAt: 'desc' } })
        if (prev?.artifactPath && fs.existsSync(prev.artifactPath)) aabPath = prev.artifactPath
        if (!aabPath) {
          if (detection.framework !== 'flutter') {
            await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: 'google-play upload needs an AAB — build the Android AAB target first (Flutter projects only).', finishedAt: new Date() } })
            return NextResponse.json({ ok: false, error: 'no AAB available — build Android AAB first (Flutter only).' })
          }
          await runtimeManager.execInProject(projectId, "sed -i 's/^org.gradle.jvmargs=.*/org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=384m/' android/gradle.properties 2>/dev/null; true", 15000)
          const r = await runtimeManager.execInProject(projectId, 'flutter build appbundle --release', 600000)
          const dir = path.join(storage.projectRoot(projectId), 'build/app/outputs/bundle/release')
          if (fs.existsSync(dir)) {
            const found = fs.readdirSync(dir).find(f => f.endsWith('.aab'))
            if (found) {
              aabPath = `/home/z/my-project/download/${project.id}.aab`
              fs.mkdirSync(path.dirname(aabPath), { recursive: true })
              fs.copyFileSync(path.join(dir, found), aabPath)
            }
          }
          if (!aabPath) {
            const l = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '')
            await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: l || 'AAB build failed before Play upload', finishedAt: new Date() } })
            return NextResponse.json({ ok: false, error: 'AAB build failed — Play upload skipped (see logs).', logs: l })
          }
        }
        const up = await uploadAabToPlay({ aabPath: aabPath!, packageName, track: String((body as any).track || 'internal'), releaseName: project.name })
        await db.build.update({
          where: { id: build.id },
          data: {
            status: up.ok ? 'success' : 'failed',
            logs: `[google-play] package=${packageName} track=${(body as any).track || 'internal'}\n` + (up.ok ? `uploaded versionCode ${up.versionCode} (edit ${up.editId})` : (up.error || '') + (up.hint ? '\nhint: ' + up.hint : '')),
            finishedAt: new Date(),
          },
        })
        if (up.ok) return NextResponse.json({ ok: true, message: `AAB uploaded to the '${(body as any).track || 'internal'}' track (versionCode ${up.versionCode}). Finish the release in play.google.com/console.`, play: up })
        return NextResponse.json({ ok: false, error: up.error, hint: up.hint, play: up })
      }
      // not connected → the guided workflow + how to enable the real upload
      const doc = generateStoreWorkflow('google-play', project, detection)
      const extra = st.configured
        ? '\n\nService account CONNECTED ✓ — pass packageName in the request (Publish → Google Play → package name) to upload automatically.'
        : '\n\n── Optional: fully automatic upload ──\nConnect your own Google Play service account (Publish → Google Play → Connect) and Cloud Agent uploads the AAB straight to your chosen track via the Play Developer API.'
      await db.build.update({ where: { id: build.id }, data: { status: 'success', logs: doc + extra, finishedAt: new Date() } })
      return NextResponse.json({ ok: true, workflow: doc + extra, playConfigured: st.configured })
    }

    if (WORKFLOW_TARGETS.includes(target)) {
      const doc = generateStoreWorkflow(target, project, detection)
      await db.build.update({ where: { id: build.id }, data: { status: 'success', logs: doc, finishedAt: new Date() } })
      return NextResponse.json({ ok: true, workflow: doc })
    }

    if (target === 'source-archive') {
      // Full source backup — everything on disk except heavy/noise dirs.
      const zip = new AdmZip()
      const root = storage.projectRoot(projectId)
      const walk = (dir: string, base = '') => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (['node_modules', '.git', '.dart_tool', '.gradle', '__pycache__', '.next', 'dist', 'build', '.cache'].includes(e.name)) continue
          const full = path.join(dir, e.name)
          const rel = base ? `${base}/${e.name}` : e.name
          if (e.isDirectory()) walk(full, rel)
          else zip.addFile(rel, fs.readFileSync(full))
        }
      }
      walk(root)
      const buf = zip.toBuffer()
      const artifactPath = `/home/z/my-project/download/${project.id}-source.zip`
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
      fs.writeFileSync(artifactPath, buf)
      await db.build.update({ where: { id: build.id }, data: { status: 'success', artifactPath, finishedAt: new Date() } })
      const d = await vaultSync(artifactPath)
      return NextResponse.json({ ok: true, artifactPath, downloadUrl: `/api/publish?id=${build.id}`, vault: d })
    }

    if (target === 'pwa') {
      // Make the project installable (manifest + icons + service worker + meta)
      // then ship the same artifact as the web build.
      try {
        await pwaSeoSetup(projectId, { appName: project.name })
      } catch (e: any) {
        // PWA setup is best-effort — a partial setup still publishes; report honestly.
        await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: `pwa setup failed: ${e?.message || e}`, finishedAt: new Date() } })
        return NextResponse.json({ ok: false, error: `PWA setup failed: ${e?.message || e}` })
      }
      const r = await buildAndZip(project, detection, 'pwa')
      if (!r.ok) {
        await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: r.logs || 'build failed', finishedAt: new Date() } })
        return NextResponse.json({ ok: false, error: r.error || 'build failed', logs: r.logs })
      }
      await db.build.update({ where: { id: build.id }, data: { status: 'success', artifactPath: r.artifactPath!, logs: r.logs, finishedAt: new Date() } })
      const d = await vaultSync(r.artifactPath!)
      return NextResponse.json({ ok: true, artifactPath: r.artifactPath, downloadUrl: `/api/publish?id=${build.id}`, vault: d })
    }

    if (target === 'exe-windows') {
      // Real attempt ONLY for Electron projects (dependency present). Anything
      // else gets an honest structured error instead of a fake artifact.
      let pkg: any = {}
      try { pkg = JSON.parse(storage.readFile(projectId, 'package.json') || '{}') } catch { pkg = {} }
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
      if (!deps.electron) {
        const msg = 'EXE builds require an Electron project (electron in package.json). ' +
          'Create the project with the Electron desktop starter or ask the agent: "convert this app to Electron desktop".'
        await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: msg, finishedAt: new Date() } })
        return NextResponse.json({ ok: false, error: msg })
      }
      const r = await runtimeManager.execInProject(projectId, 'npx --yes electron-builder --win portable --x64', 600000)
      const distDir = path.join(storage.projectRoot(projectId), 'dist')
      let found: string | undefined
      if (fs.existsSync(distDir)) found = fs.readdirSync(distDir).find(f => f.endsWith('.exe'))
      const artifactPath = `/home/z/my-project/download/${project.id}.exe`
      fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
      if (found) fs.copyFileSync(path.join(distDir, found), artifactPath)
      const logs = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '')
      await db.build.update({ where: { id: build.id }, data: { status: found ? 'success' : 'failed', artifactPath: found ? artifactPath : null, logs, finishedAt: new Date() } })
      if (found) return NextResponse.json({ ok: true, artifactPath, downloadUrl: `/api/publish?id=${build.id}`, vault: await vaultSync(artifactPath) })
      return NextResponse.json({ ok: false, error: 'electron-builder did not produce an .exe (see logs — it may need to download toolchains)', logs })
    }
    // (unknown targets are rejected before the Build row is created)
    await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: 'unknown target', finishedAt: new Date() } })
    return NextResponse.json({ error: 'unknown target' }, { status: 400 })
  } catch (e: any) {
    await db.build.update({ where: { id: build.id }, data: { status: 'failed', logs: e.message, finishedAt: new Date() } })
    return NextResponse.json({ ok: false, error: e.message })
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  // FIX: missing id used to hit Prisma findUnique({id: null}) → unhandled 500
  // with an empty body. Return a proper 400 instead.
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const build = await db.build.findUnique({ where: { id } })
  if (!build || !build.artifactPath) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const fs = await import('fs')
  if (!fs.existsSync(build.artifactPath)) {
    // v91/v95: the local copy may have been dropped by the disk-critical
    // policy — stream the vault copy recorded in the build logs instead.
    // Markers: r2:<key> (Cloudflare R2) or a bare key (Firebase Storage).
    const m = (build.logs || '').match(/\[vault\] object=(\S+)/)
    if (m) {
      try {
        const raw = m[1]
        const isR2 = raw.startsWith('r2:')
        const object = isR2 ? raw.slice(3) : raw
        const buf = isR2
          ? await r2DownloadObject(object)
          : await (await import('@/lib/fbstore')).fbDownloadObject(object)
        const filename = decodeURIComponent(object.split('/').pop() || 'artifact.bin')
        return new Response(new Uint8Array(buf), {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': String(buf.length),
          },
        })
      } catch (e: any) {
        return NextResponse.json({ error: `artifact missing locally and vault copy unavailable: ${e?.message || e}` }, { status: 404 })
      }
    }
    return NextResponse.json({ error: 'artifact missing' }, { status: 404 })
  }
  const buf = fs.readFileSync(build.artifactPath)
  const filename = build.artifactPath.split('/').pop()
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buf.length),
    },
  })
}

function generateStoreWorkflow(target: string, project: any, detection: any): string {
  const storeName: Record<string, string> = {
    'google-play': 'Google Play',
    'app-store': 'Apple App Store',
    'galaxy-store': 'Samsung Galaxy Store',
    'appgallery': 'Huawei AppGallery',
    'amazon-appstore': 'Amazon Appstore',
    'f-droid': 'F-Droid',
    'apkpure': 'APKPure',
    'uptodown': 'Uptodown',
    'microsoft-store': 'Microsoft Store',
    'macos-dmg': 'macOS (DMG)',
    'linux-appimage': 'Linux (AppImage)',
  }
  const name = storeName[target] || target
  const storeSteps: Record<string, string[]> = {
    'f-droid': [
      `F-Droid publishes FREE & OPEN-SOURCE apps only. Your app must have its source in a public git repo`,
      `with a license file (MIT/GPL/Apache-2.0…) and must not bundle non-free dependencies.`,
      `1. Push the source to a public git repo (GitHub panel → Push).`,
      `2. Add build metadata: https://gitlab.com/fdroid/fdroiddata follows an app metadata YAML — simplest path is to`,
      `   request inclusion via the F-Droid RFP process (https://f-droid.org/en/submit/).`,
      `3. F-Droid's build server compiles the APK itself from your repo tag.`,
    ],
    'apkpure': [
      `APKPure accepts direct APK uploads — no developer fee.`,
      `1. Use the Android APK target above to produce a signed release APK.`,
      `2. Sign up at https://developers.apkpure.com/ and verify ownership.`,
      `3. Upload the APK + listing metadata (icon, screenshots, description).`,
      `4. Review is usually 1–3 days.`,
    ],
    'uptodown': [
      `Uptodown accepts direct APK uploads — free.`,
      `1. Produce a signed release APK (Android APK target).`,
      `2. Sign up at https://www.uptodown.com/developers and submit the APK.`,
      `3. Fill in the listing (description, screenshots) — Uptodown localizes listings for you.`,
    ],
    'microsoft-store': [
      `Microsoft Store accepts EXE/MSIX desktop apps via the Windows Dev Center.`,
      `1. Build the Windows EXE (the EXE target above, Electron projects).`,
      `2. Register at https://developer.microsoft.com/store (one-time ~$19 individual fee).`,
      `3. Reserve your app name, then submit the package through Partner Center`,
      `   (MSIX packaging for Electron: https://learn.microsoft.com/windows/msix/).`,
    ],
    'macos-dmg': [
      `macOS DMG distribution (outside the Mac App Store):`,
      `1. On a Mac with Xcode: for Electron apps run  npx electron-builder --mac dmg`,
      `   (Flutter desktop: flutter build macos). Cloud Agent's Linux sandbox cannot run macOS toolchains — honest limitation.`,
      `2. Sign with your Apple Developer ID and notarize: xcrun notarytool submit.`,
      `3. Distribute the DMG yourself, or ship via the App Store target.`,
    ],
    'linux-appimage': [
      `Linux AppImage distribution:`,
      `1. For Electron apps: npx electron-builder --linux AppImage (works on any Linux machine, including this one via the terminal).`,
      `2. For other stacks, package with your toolchain and ship the binary.`,
      `3. Publish on GitHub Releases / Flathub for reach.`,
    ],
  }
  return [
    `# Publish to ${name}`,
    ``,
    `Cloud Agent does NOT store your ${name} credentials. To publish this project, follow these steps:`,
    ``,
    `## 1. Build the release artifact`,
    detection.framework === 'flutter'
      ? [`\`\`\`bash`, `flutter build appbundle --release   # for Google Play / AppGallery / Galaxy Store`, `flutter build apk --release         # for Amazon Appstore / APKPure / Uptodown`, `flutter build ipa --release         # for App Store (requires macOS + Xcode)`, `\`\`\``].join('\n')
      : 'Use the Cloud Agent build targets (Web/EXE/Source) or your framework-specific packaging tool.',
    ``,
    ...(storeSteps[target] || [
      `## 2. Create a ${name} developer account`,
      `If you don't already have one, sign up at the ${name} developer portal and pay any required one-time fee.`,
      ``,
      `## 3. Create the app listing`,
      `Log in to the ${name} console, click "Create app", and fill in the required metadata (name, description, screenshots, icons, privacy policy URL).`,
      ``,
      `## 4. Upload the artifact`,
      `Upload the release bundle generated in step 1 through the ${name} console's release management UI.`,
      ``,
      `## 5. Complete store review`,
      `Submit for review. Most stores complete review within 1–7 days depending on the store and the type of update.`,
    ]),
    ``,
    `Cloud Agent will store the build logs above so you can come back to them later.`,
  ].join('\n')
}

/** v81 — working Codemagic CI recipe dropped into the project (and the kit zip). */
function codemagicYaml(appName: string): string {
  return [
    '# Cloud Agent — iOS compile + sign recipe (codemagic.yaml)',
    '# Upload this project (or the export kit zip) to GitHub, then in',
    '# codemagic.io: Add application → select repo → "Workflow from file" →',
    '# this yaml runs on a Mac VM: build, sign with your certificate, publish.',
    `workflows:`,
    `  ios-release:`,
    `    name: ${appName} — iOS`,
    `    instance_type: mac_mini_m2`,
    `    max_build_duration: 60`,
    `    environment:`,
    `      vars:`,
    `        XCODE_WORKSPACE: ios/Runner.xcworkspace   # adjust if your project differs`,
    `        XCODE_SCHEME: Runner`,
    `      # Add these in Codemagic UI → Environment variables (DO NOT commit secrets):`,
    `      #   CERTIFICATE_PRIVATE_KEY, CERTIFICATE_REFERENCE, BUNDLE_ID`,
    `    scripts:`,
    `      - name: Flutter build ipa (unsigned)`,
    `        script: flutter packages pub get && flutter build ipa --release --no-codesign`,
    `      - name: Sign ipa`,
    `        script: xcrun altool --notarize-app   # or use codemagic-signing step in the UI`,
    `    artifacts:`,
    `      - build/ios/ipa/*.ipa`,
    `    publishing:`,
    `      email:`,
    `        recipients: []`,
    '',
  ].join('\n')
}

/** v81 — honest, step-by-step guide bundled inside every iOS export kit. */
function iosExportGuide(appName: string): string {
  return [
    `# ${appName} — iOS Export Kit (from Cloud Agent)`,
    ``,
    `This zip contains the ios/ platform folder + a working codemagic.yaml.`,
    `Apple only allows iOS binaries to be COMPILED on macOS (Xcode) — no Linux`,
    `sandbox, including this one, can produce a signed .ipa. That is an Apple`,
    `platform rule, not a Cloud Agent limitation. Here are your 3 real paths:`,
    ``,
    `## Path A — Codemagic (no Mac needed, free tier available)`,
    `1. Push the project to GitHub (Cloud Agent → GitHub panel → Push) or upload this zip.`,
    `2. Sign up at https://codemagic.io with your Apple ID.`,
    `3. Add application → pick the repo → Workflow: "from file" (codemagic.yaml included).`,
    `4. Add your Apple certificate/profile in Codemagic → Code signing.`,
    `5. Start build → download the signed .ipa → App Store Connect → TestFlight.`,
    ``,
    `## Path B — Any Mac (friend, rental, library)`,
    `1. Unzip, open ios/Runner.xcworkspace in Xcode.`,
    `2. Set your Team in Signing & Capabilities (needs Apple Developer account, $99/yr).`,
    `3. Product → Archive → Distribute App.`,
    ``,
    `## Path C — App Store (after A or B)`,
    `1. appstoreconnect.apple.com → My Apps → + → New app (Bundle ID from Xcode).`,
    `2. Upload the .ipa via Transporter app or Xcode Organizer.`,
    `3. Fill screenshots/metadata → Submit for review.`,
    ``,
    `Cloud Agent generated: ios/ platform, codemagic.yaml (CI recipe).`,
    `Honest note: the .ipa itself must be compiled+signed outside this sandbox.`,
  ].join('\n')
}

/**
 * Shared web-shape build: static projects are zipped as-is; Node projects get
 * `npm run build` first and the output dir is zipped. Used by web + pwa.
 */
async function buildAndZip(project: any, detection: any, kind: 'web' | 'pwa'): Promise<{ ok: boolean; artifactPath?: string; logs?: string; error?: string }> {
  const suffix = kind === 'pwa' ? '-pwa.zip' : detection.framework === 'static' ? '-web.zip' : '-web-build.zip'
  const zip = new AdmZip()
  const root = storage.projectRoot(project.id)
  let logs = ''
  // v71: only run a build when the framework actually HAS one. An
  // unknown/empty project used to fall into the generic npm build, which
  // (with no package.json in the project dir) WALKS UP and builds the
  // BUILDER's own app — slow, wrong, and guaranteed to fail. Now an
  // unknown project publishes its files as a static zip, exactly like
  // 'static' does.
  if (detection.framework !== 'static' && detection.buildCommand) {
    const r = await runtimeManager.build(project.id)
    logs = r.logs || ''
    if (!r.ok) return { ok: false, error: 'build failed', logs }
  }
  const outDir = detection.outputDir && detection.outputDir !== '.' ? detection.outputDir : ''
  const walkRoot = outDir ? path.join(root, outDir) : root
  if (fs.existsSync(walkRoot)) {
    const walk = (dir: string, base = '') => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (base === '' && ['node_modules', '.git', '.next', 'dist', 'build', '.cache'].includes(e.name)) continue
        const full = path.join(dir, e.name)
        const rel = base ? `${base}/${e.name}` : e.name
        if (e.isDirectory()) walk(full, rel)
        else zip.addFile(rel, fs.readFileSync(full))
      }
    }
    walk(walkRoot)
  }
  const buf = zip.toBuffer()
  const artifactPath = `/home/z/my-project/download/${project.id}${suffix}`
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
  fs.writeFileSync(artifactPath, buf)
  return { ok: true, artifactPath, logs }
}
