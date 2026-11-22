/**
 * Generates REAL builder PWA icons (512/192/180 PNG) from an inline SVG
 * using sharp — ">_" terminal mark on a dark rounded square with amber
 * accent. Run: bunx tsx scripts/make-builder-icons.ts
 */
import sharp from 'sharp'
import path from 'path'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0a0e14"/>
  <rect x="26" y="26" width="460" height="460" rx="94" fill="none" stroke="#f59e0b" stroke-opacity="0.28" stroke-width="14"/>
  <path d="M150 176 L242 256 L150 336" fill="none" stroke="#f59e0b" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="282" y="314" width="120" height="42" rx="21" fill="#f59e0b"/>
</svg>`

async function main() {
  const pub = path.join(process.cwd(), 'public')
  for (const size of [512, 192, 180]) {
    const out = path.join(pub, `builder-icon-${size}.png`)
    await sharp(Buffer.from(SVG)).resize(size, size).png().toFile(out)
    console.log('wrote', out)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
