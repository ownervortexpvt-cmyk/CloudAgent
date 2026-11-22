/**
 * v123 — TEMPLATE MARKETPLACE ("nijer bana app share/sell korbo")
 *
 * A listing is a SNAPSHOT of a project's files, zipped into
 * download/market/<listingId>.zip at publish time. Installing a listing
 * creates a BRAND-NEW project for the buyer and unpacks the snapshot into it
 * — the seller's original project is never touched, and later edits on either
 * side never leak across (honest snapshot semantics, like app stores).
 *
 * Money: priceInr > 0 = paid listing. Installs require a successful
 * BillingRecord — until the owner connects Razorpay keys the API answers 402
 * with an honest message. Free listings install for everyone.
 */
import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import * as storage from '@/lib/storage'

const MARKET_DIR = '/home/z/my-project/download/market'

export function listingZipPath(listingId: string): string {
  return path.join(MARKET_DIR, `${listingId}.zip`)
}

export interface PackageResult { ok: boolean; fileCount: number; sizeBytes: number; thumbSvg?: string; error?: string }

/**
 * Snapshot a project into its listing zip. Skips junk (node_modules, .next,
 * build outputs, .git) the same way the source-archive publish does.
 */
export function packageProject(projectId: string, listingId: string): PackageResult {
  try {
    const entries = storage.readAllAsEntries(projectId, 5_000_000).filter((e) => {
      const p = e.path.toLowerCase()
      if (p.startsWith('node_modules/') || p.includes('/node_modules/')) return false
      if (p.startsWith('.next/') || p.includes('/.next/')) return false
      if (p.startsWith('.git/') || p === '.git') return false
      if (p.startsWith('build/') || p.includes('/build/app/outputs/')) return false
      if (p.endsWith('.pack.gz') || p.endsWith('.pack')) return false
      return true
    })
    if (entries.length === 0) return { ok: false, fileCount: 0, sizeBytes: 0, error: 'project has no files to package' }
    const zip = new AdmZip()
    let thumbSvg: string | undefined
    for (const e of entries) {
      zip.addFile(e.path, Buffer.from(e.content, 'utf8'))
      if (!thumbSvg && e.path.toLowerCase().endsWith('.svg') && e.content.includes('<svg')) {
        thumbSvg = e.content.slice(0, 20_000)
      }
    }
    fs.mkdirSync(MARKET_DIR, { recursive: true })
    const buf = zip.toBuffer()
    fs.writeFileSync(listingZipPath(listingId), buf)
    return { ok: true, fileCount: entries.length, sizeBytes: buf.length, thumbSvg }
  } catch (e: any) {
    return { ok: false, fileCount: 0, sizeBytes: 0, error: e?.message || 'packaging failed' }
  }
}

export interface InstallResult { ok: boolean; projectId?: string; projectName?: string; fileCount?: number; error?: string }

/**
 * Install a listing into a fresh project for the buyer.
 * Caller has ALREADY validated purchase/price — this only does the file work.
 */
export async function installListing(opts: {
  listingId: string
  buyerId: string
  buyerName: string
  title: string
}): Promise<InstallResult> {
  const zipPath = listingZipPath(opts.listingId)
  if (!fs.existsSync(zipPath)) return { ok: false, error: 'listing package missing — ask the seller to re-publish' }
  const { db } = await import('@/lib/db')
  const baseName = `${opts.title.slice(0, 24).replace(/[^\w\s-]/g, '').trim() || 'Marketplace app'} (installed)`
  const project = await db.project.create({
    data: { name: baseName, description: `Installed from the CloudAgent Marketplace`, framework: null, userId: opts.buyerId, status: 'stopped' },
  })
  try {
    const zip = new AdmZip(zipPath)
    let count = 0
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue
      const content = entry.getData().toString('utf8')
      storage.writeFile(project.id, entry.entryName, content)
      count++
    }
    if (count === 0) {
      await db.project.delete({ where: { id: project.id } }).catch(() => {})
      return { ok: false, error: 'listing package is empty' }
    }
    // index the files into the File table (same shape the clone flow uses)
    const tree = storage.listTree(project.id, '.')
    const walk = (n: any): Array<{ path: string; isDir: boolean }> => {
      const out: Array<{ path: string; isDir: boolean }> = []
      if (!n) return out
      if (n.type === 'file') out.push({ path: n.path, isDir: false })
      else for (const c of n.children || []) out.push(...walk(c))
      return out
    }
    const entries = walk(tree)
    await db.file.deleteMany({ where: { projectId: project.id } })
    for (const e of entries) {
      await db.file.create({ data: { projectId: project.id, path: e.path, isDir: e.isDir, content: '' } }).catch(() => {})
    }
    return { ok: true, projectId: project.id, projectName: project.name, fileCount: count }
  } catch (e: any) {
    await db.project.delete({ where: { id: project.id } }).catch(() => {})
    return { ok: false, error: e?.message || 'install failed' }
  }
}
