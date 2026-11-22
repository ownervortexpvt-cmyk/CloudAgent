/**
 * v117.3 — DB AUTO-HEAL at boot (the platform's #1 recurring failure).
 *
 * The sandbox recycles wipe db/custom.db rows every few hours. Three times
 * now this silently killed the product: the built-in Vortex Engine provider rows
 * vanished (builder looked "broken"), and the QA admin disappeared (every
 * regression suite failed with 401). The owner then had to re-register
 * himself and file "kaj kore na" complaints.
 *
 * ensureDbHeal() runs once per server process at boot and is IDEMPOTENT:
 *   1. re-seeds the 3 built-in Vortex Engine provider rows when they are missing
 *   2. re-creates the QA admin (qa-admin115@qa.local) used by the e2e suites
 *   3. v122: re-creates the OWNER (mdhonabali61@gmail.com) when a recycle
 *      wiped the row — 4th recycle locked the owner out of his own platform
 *      ("admin login hote parsina"). Fresh create uses the password he set in
 *      chat (Owner123). If the row EXISTS its password is NEVER touched; only
 *      a demoted role/plan is restored (admin / ultra_pro_max) so he can
 *      never lose the control room.
 *
 * Failure of the heal itself is contained: every step is wrapped, a failed
 * heal only logs — boot continues.
 */
import crypto from 'crypto'

const QA_EMAIL = 'qa-admin115@qa.local'
const QA_PASSWORD = 'qatester115'

/** The platform owner — restored at boot if a recycle wipes him. */
const OWNER_EMAIL = 'mdhonabali61@gmail.com'
// v150 — keep in sync with the v148/v149 ROTATED owner password (the value
// the owner set in chat and every e2e suite authenticates with). The old
// v122 default 'Owner123' re-locked the owner out after every recycle that
// wiped AuthUser (incident 2026-11-14 10:22 boot: owner row re-seeded with
// Owner123 while all suites used the rotated value → owner-login FAIL).
// v159 — back to Owner123 (owner request: "Owner kaj kore na") — the rotated
// value confused the owner; both accounts stay in sync with fix-all.mjs.
const OWNER_PASSWORD = 'Owner123'

const BUILT_INS = [
  { name: 'GLM 5.3 Flash', kind: 'zai', model: 'glm-5.3-flash', isDefault: true },
  { name: 'GLM 5.3', kind: 'zai', model: 'glm-5.3', isDefault: false },
  { name: 'GLM 4.6', kind: 'zai', model: 'glm-4.6', isDefault: false },
]

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

let healed = false

export async function ensureDbHeal(): Promise<void> {
  if (healed) return
  healed = true
  try {
    const { db } = await import('@/lib/db')

    // 1. built-in Vortex Engine provider rows (global rows — userId is null)
    try {
      const existing = await db.aIProvider.findMany({
        where: { kind: 'zai' },
        select: { name: true },
      })
      const have = new Set(existing.map((r: any) => r.name))
      const missing = BUILT_INS.filter((b) => !have.has(b.name))
      if (missing.length > 0) {
        for (const b of missing) {
          await db.aIProvider.create({ data: { ...b, category: 'free', role: 'work' } as any })
        }
        console.log(`[boot-heal] re-seeded ${missing.length} built-in Vortex Engine provider row(s) after recycle`)
      }
    } catch (e: any) {
      console.error('[boot-heal] provider seed failed:', e?.message)
    }

    // 2. QA admin for the regression suites
    try {
      const qa = await db.authUser.findUnique({ where: { email: QA_EMAIL } })
      if (!qa) {
        await db.authUser.create({
          data: {
            email: QA_EMAIL,
            name: 'QA Admin 115',
            role: 'admin',
            plan: 'ultra_pro_max',
            status: 'active',
            passwordHash: hashPassword(QA_PASSWORD),
          } as any,
        })
        console.log('[boot-heal] re-created QA admin after recycle')
      }
    } catch (e: any) {
      console.error('[boot-heal] qa-admin seed failed:', e?.message)
    }

    // 3. v122 — OWNER self-restore (recycles kept locking him out)
    try {
      const owner = await db.authUser.findUnique({ where: { email: OWNER_EMAIL } })
      if (!owner) {
        await db.authUser.create({
          data: {
            email: OWNER_EMAIL,
            name: 'Md Honabali',
            role: 'admin',
            plan: 'ultra_pro_max',
            planKind: 'admin',
            status: 'active',
            passwordHash: hashPassword(OWNER_PASSWORD),
          } as any,
        })
        console.log('[boot-heal] re-created OWNER account after recycle (default password restored)')
      } else if (owner.role !== 'admin' || owner.plan !== 'ultra_pro_max') {
        await db.authUser.update({
          where: { email: OWNER_EMAIL },
          data: { role: 'admin', plan: 'ultra_pro_max', planKind: 'admin', status: 'active' },
        })
        console.log('[boot-heal] restored OWNER role/plan after recycle (password untouched)')
      }
    } catch (e: any) {
      console.error('[boot-heal] owner seed failed:', e?.message)
    }

    // 4. v123 — PRIVATE GATE key (site stays locked to owner+operator after recycles)
    try {
      const { getGate } = await import('@/lib/gate')
      const gate = await getGate() // seeds UserSetting row on first boot, caches after
      console.log('[boot-heal] private gate active (key seeded)')
      void gate
    } catch (e: any) {
      console.error('[boot-heal] gate seed failed:', e?.message)
    }

    // 5. v124 — ORPHAN PROJECT RE-ATTACH (the recycle data-loss killer).
    // Recycles wipe db/custom.db but every app's SOURCE directory under
    // projects/ survives — users experienced this as "amar app hariye
    // geche / banano kaj kore na" while the files were sitting on disk all
    // along. Here: any projects/<id> folder that has NO live Project row is
    // re-attached to the OWNER, with name + framework recovered from the
    // project's own files. The editor, preview and runs all read from disk
    // (storage.listTree / storage.readFile), so restoring the row alone
    // brings the whole app back. Idempotent: rows that exist are untouched;
    // soft-deleted (trash) rows are respected and NOT resurrected.
    try {
      const fs = await import('fs')
      const path = await import('path')
      const ROOT = '/home/z/my-project/projects'
      const owner = await db.authUser.findUnique({ where: { email: OWNER_EMAIL } })
      if (owner) {
        let folders: string[] = []
        try {
          folders = fs.readdirSync(ROOT, { withFileTypes: true })
            .filter((d) => d.isDirectory() && /^[a-z0-9]{20,}$/i.test(d.name))
            .map((d) => d.name)
        } catch { /* projects/ may not exist yet on a truly fresh box */ }
        const reAttached: string[] = []
        for (const id of folders.slice(0, 300)) {
          try {
            const existing = await db.project.findFirst({ where: { id }, select: { id: true, deletedAt: true } })
            if (existing) continue // live OR trashed — do not resurrect trash
            const dir = path.join(ROOT, id)
            // Recover a human name from the project's own files.
            let name = `Recovered project ${id.slice(-6)}`
            try {
              const pkgRaw = fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
              const pkgName = JSON.parse(pkgRaw)?.name
              if (pkgName && typeof pkgName === 'string' && pkgName.trim()) name = pkgName.trim()
            } catch { /* no package.json */ }
            if (name.startsWith('Recovered project')) {
              try {
                const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
                const t = html.match(/<title>([^<]{1,60})<\/title>/i)?.[1]?.trim()
                if (t) name = t
              } catch { /* no index.html */ }
            }
            // Recover framework/language so Run picks the right command.
            let framework: string | null = null
            let language: string | null = null
            try {
              const { detectFramework } = await import('@/lib/framework')
              const det = detectFramework(id)
              if (det?.framework && det.framework !== 'unknown') { framework = det.framework; language = det.language || null }
            } catch { /* detection is best-effort */ }
            await db.project.create({
              data: {
                id,
                name,
                userId: owner.id,
                status: 'stopped',
                framework,
                language,
                description: 'Auto-recovered after a sandbox recycle — source files were re-attached from disk.',
              } as any,
            })
            reAttached.push(`${name} (${framework || 'unknown'})`)
          } catch (e: any) {
            console.error(`[boot-heal] orphan re-attach failed for ${id}:`, e?.message)
          }
        }
        if (reAttached.length > 0) {
          console.log(`[boot-heal] re-attached ${reAttached.length} orphan project(s) after recycle: ${reAttached.join('; ')}`)
        }
      } else {
        console.error('[boot-heal] orphan re-attach skipped — owner row missing (step 3 failed)')
      }
    } catch (e: any) {
      console.error('[boot-heal] orphan project re-attach failed:', e?.message)
    }

    // 6. v124 — ORPHAN RUNNING BUILDS (the eternal-spinner killer, real
    // incident): an APK/EXE build is fire-and-forget INSIDE the server
    // process. When that process dies mid-build (OOM from gradle, sandbox
    // recycle, dev restart), the Build row stays 'running' forever and the
    // Export dialog spins eternally with no way out from the UI. At boot no
    // build can honestly still be running — a fresh process owns nothing —
    // so every leftover 'running' row is marked failed with a truthful log
    // line. Idempotent: only touches 'running' rows.
    try {
      const r = await db.build.updateMany({
        where: { status: 'running' },
        data: {
          status: 'failed',
          logs: 'build orphaned — the server restarted while the build was running (sandbox recycle or OOM). Press Build again; the run preview is stopped automatically first.',
          finishedAt: new Date(),
        },
      })
      if (r.count > 0) console.log(`[boot-heal] marked ${r.count} orphaned 'running' build(s) as failed (eternal-spinner fix)`)
    } catch (e: any) {
      console.error('[boot-heal] orphan build cleanup failed:', e?.message)
    }
  } catch (e: any) {
    console.error('[boot-heal] db heal skipped:', e?.message)
  }
}
