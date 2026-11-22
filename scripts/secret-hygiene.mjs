#!/usr/bin/env node
// v167.1 secret hygiene — remove live credentials from tracked source files.
// Literals are read from /home/z/my-project/.secrets/vortex-secrets.json at
// runtime (the script itself never embeds secret values — safe to commit).
import fs from 'fs'
import path from 'path'

const BASE = '/home/z/my-project'
const SEC = JSON.parse(fs.readFileSync(path.join(BASE, '.secrets/vortex-secrets.json'), 'utf8'))

const LITS = [
  { lit: `'${SEC.cfToken}'`, rep: `(SECRETS.cfToken || '')` },
  { lit: `'${SEC.cfAccount}'`, rep: `(SECRETS.cfAccount || '')` },
  { lit: `'${SEC.joyAccessKey}'`, rep: `(SECRETS.joyAccessKey || '')` },
  { lit: `'${SEC.joySecretKey}'`, rep: `(SECRETS.joySecretKey || '')` },
]

const LOADER_CJS = `// v167.1 secret hygiene — live credentials load from .secrets (never committed)
let SECRETS = {}
try { SECRETS = JSON.parse(fs.readFileSync('/home/z/my-project/.secrets/vortex-secrets.json', 'utf8')) } catch {}
`

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
    'scripts/tunnel-keeper.js',
    'scripts/joy-put.cjs',
    'scripts/joy-sigv4-check.cjs',
    'scripts/fix-all.mjs',
    'scripts/save-joy-storage.js',
    'scripts/set-joy-service-keys.cjs',
    'scripts/vortex-setup.cjs',
    'vortex-platform/server/CLOUDAGENT_BUILD/scripts/tunnel-keeper.js',
    'vortex-platform/server/CLOUDAGENT_BUILD/scripts/joy-put.cjs',
    'vortex-platform/server/CLOUDAGENT_BUILD/scripts/joy-sigv4-check.cjs',
    'vortex-platform/server/CLOUDAGENT_BUILD/scripts/fix-all.mjs',
    'vortex-platform/server/CLOUDAGENT_BUILD/scripts/save-joy-storage.js',
    'vortex-platform/server/CLOUDAGENT_BUILD/scripts/set-joy-service-keys.cjs',
    'vortex-platform/server/CLOUDAGENT_BUILD/scripts/vortex-setup.cjs',
    'runtime-store/standalone-new/scripts/tunnel-keeper.js',
    'runtime-store/standalone-new/scripts/joy-put.cjs',
    'runtime-store/standalone-new/scripts/joy-sigv4-check.cjs',
    'runtime-store/standalone-new/scripts/fix-all.mjs',
    'runtime-store/standalone-new/scripts/save-joy-storage.js',
    'runtime-store/standalone-new/scripts/set-joy-service-keys.cjs',
    'runtime-store/standalone-new/scripts/vortex-setup.cjs',
    'vortex-platform/cloudagent-runtime/scripts/tunnel-keeper.js',
    'vortex-platform/cloudagent-runtime/scripts/joy-put.cjs',
    'vortex-platform/cloudagent-runtime/scripts/joy-sigv4-check.cjs',
    'vortex-platform/cloudagent-runtime/scripts/fix-all.mjs',
    'vortex-platform/cloudagent-runtime/scripts/save-joy-storage.js',
    'vortex-platform/cloudagent-runtime/scripts/set-joy-service-keys.cjs',
    'vortex-platform/cloudagent-runtime/scripts/vortex-setup.cjs',
  ]

let changed = 0
for (const rel of files) {
  const p = path.join(BASE, rel)
  if (!fs.existsSync(p)) continue
  let src = fs.readFileSync(p, 'utf8')
  const before = src
  let hit = false
  for (const { lit, rep } of LITS) {
    if (src.includes(lit)) { src = src.split(lit).join(rep); hit = true }
  }
  if (!hit) continue
  if (src.includes('SECRETS') && !src.includes('let SECRETS')) {
    if (/\bconst fs = require\(['"]fs['"]\)|\bvar fs = require\(['"]fs['"]\)|\bimport fs from ['"]fs['"]/.test(src)) {
      src = src.replace(/(const fs = require\(['"]fs['"]\)|var fs = require\(['"]fs['"]\)|import fs from ['"]fs['"];?)/, `$1\n${LOADER_CJS}`)
    } else {
      if (rel.endsWith('.mjs')) src = `import fs from 'fs'\n${LOADER_CJS}${src}`
      else src = `const fs = require('fs')\n${LOADER_CJS}${src}`
    }
  }
  fs.writeFileSync(p, src)
  changed++
  console.log(`patched: ${rel}`)
}
console.log(`done — ${changed} files cleaned`)
