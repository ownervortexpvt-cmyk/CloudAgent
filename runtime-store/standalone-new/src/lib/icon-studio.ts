/**
 * Icon Studio — project icon pipeline for the New Project flow.
 *
 * Two real sources:
 *   1. User upload  → data URL (png/jpeg/webp) → sharp-normalised
 *   2. AI generated → z-ai-web-dev-sdk images API (REAL generation)
 *
 * Output contract (consumed by pwa.ts writeIcons, project cards and
 * favicon injection):
 *   assets/icon.png           512×512 master
 *   assets/icons/icon-192.png 192×192
 *
 * When a root index.html exists, a <link rel="icon"> is injected so the
 * preview shows the icon in the browser tab immediately.
 */
import * as storage from './storage'
import { safeUpsert } from './ai/tools'

const FAVICON_LINK = /<link[^>]+rel=["']icon["'][^>]*>/i
const HEAD_CLOSE = /<\/head>/i

export interface IconResult {
  files: string[]
  source: 'upload' | 'ai'
}

/** Best-effort DB mirror so file listings know the icon exists (disk is source of truth). */
async function indexBinary(projectId: string, rel: string, size: number) {
  try {
    await safeUpsert({
      where: { projectId_path: { projectId, path: rel } },
      create: { projectId, path: rel, content: `[binary ${size}B]`, isDir: false },
      update: { content: `[binary ${size}B]` },
    })
  } catch { /* disk copy is enough */ }
}

/** Inject (or refresh) a favicon link into a root index.html, preserving everything else. */
export function injectFavicon(projectId: string, iconRel = 'assets/icon.png'): boolean {
  if (!storage.existsFile(projectId, 'index.html')) return false
  const html = storage.readFile(projectId, 'index.html') || ''
  const tag = `<link rel="icon" href="/${iconRel}" type="image/png" />`
  let next: string
  if (FAVICON_LINK.test(html)) {
    next = html.replace(FAVICON_LINK, tag)
  } else if (HEAD_CLOSE.test(html)) {
    next = html.replace(HEAD_CLOSE, `  ${tag}\n</head>`)
  } else {
    return false
  }
  if (next !== html) storage.writeFile(projectId, 'index.html', next)
  return next !== html
}

async function writeIconSet(projectId: string, png: Buffer, source: 'upload' | 'ai'): Promise<IconResult> {
  const sharp = (await import('sharp')).default
  const master = await sharp(png).resize(512, 512, { fit: 'cover', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  const small = await sharp(png).resize(192, 192, { fit: 'cover', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  storage.writeFile(projectId, 'assets/icon.png', master)
  storage.writeFile(projectId, 'assets/icons/icon-192.png', small)
  await indexBinary(projectId, 'assets/icon.png', master.length)
  await indexBinary(projectId, 'assets/icons/icon-192.png', small.length)
  const linked = injectFavicon(projectId)
  return {
    files: ['assets/icon.png (512×512)', 'assets/icons/icon-192.png (192×192)', ...(linked ? ['index.html favicon link injected'] : [])],
    source,
  }
}

/** Validate + normalise an uploaded icon given as a data URL. Throws with a readable message. */
export async function saveUploadedIcon(projectId: string, dataUrl: string): Promise<IconResult> {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '')
  if (!m) throw new Error('Icon must be a base64 data URL of a png, jpg or webp image')
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > 4 * 1024 * 1024) throw new Error('Icon is larger than 4 MB — pick a smaller image')
  if (buf.length < 64) throw new Error('Icon file looks empty')
  const sharp = (await import('sharp')).default
  try {
    const meta = await sharp(buf).metadata()
    if (!meta.width || !meta.height) throw new Error('unreadable image')
    return await writeIconSet(projectId, buf, 'upload')
  } catch (e: any) {
    throw new Error(`Icon could not be decoded as an image (${e?.message || 'unknown'})`)
  }
}

/** Generate a REAL AI icon from the app name/description via the z-ai images API. */
export async function generateProjectIcon(projectId: string, appName: string, description?: string): Promise<IconResult> {
  const idea = [appName, description].filter(Boolean).join(' — ').slice(0, 220)
  const prompt =
    `Modern flat app icon for "${idea}". Bold simple geometric symbol, centered on a rounded-square background, ` +
    `vibrant 2-color gradient, no text, no letters, crisp vector look, high contrast, suitable as a mobile app icon.`
  const ZAI = (await import('z-ai-web-dev-sdk').then(m => (m as any).default || m))
  const zai = await ZAI.create()
  const res = await (zai as any).images.generations.create({ prompt, size: '1024x1024' })
  const b64 = res?.data?.[0]?.base64
  if (!b64) throw new Error('image generation returned no data — try again')
  return writeIconSet(projectId, Buffer.from(b64, 'base64'), 'ai')
}
