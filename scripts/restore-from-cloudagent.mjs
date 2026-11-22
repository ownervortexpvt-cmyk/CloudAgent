#!/usr/bin/env node
/**
 * Restore every file that exists in CloudAgent repo but is missing locally.
 * Strictly ADDITIVE — never overwrites a local file (local vortex-ecosystem
 * additions like admin/panel/code-hub stay untouched).
 */
import fs from 'fs'
import path from 'path'

const TOK = process.env.GH_TOK
const ROOT = '/home/z/my-project'
const tree = JSON.parse(fs.readFileSync('/tmp/ca-tree.json', 'utf8')).tree
  .filter((x) => x.type === 'blob')

const prefixes = ['src/', 'scripts/', 'vortex-platform/', 'mini-services/', 'public/', 'prisma/']
const candidates = tree.filter((x) => prefixes.some((p) => x.path.startsWith(p)))

const missing = []
for (const c of candidates) {
  const abs = path.join(ROOT, c.path)
  if (!fs.existsSync(abs)) missing.push(c)
}

console.log(`candidates: ${candidates.length}, missing locally: ${missing.length}`)

let ok = 0, fail = 0
for (const m of missing) {
  const url = `https://raw.githubusercontent.com/alihonab189-bit/CloudAgent/main/${m.path}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOK}` } })
  if (!res.ok) {
    console.log(`FAIL ${res.status} ${m.path}`)
    fail++
    continue
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const abs = path.join(ROOT, m.path)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, buf)
  ok++
  console.log(`restored ${m.path} (${buf.length} B)`)
}
console.log(`\ndone: restored=${ok} failed=${fail}`)
