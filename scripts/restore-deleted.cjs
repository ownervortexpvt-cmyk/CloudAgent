#!/usr/bin/env node
/**
 * restore-deleted.cjs — restore every file the first deploy's D-propagation
 * removed (paths present in the v152 baseline but missing from the v163
 * commit — they had never been committed). Restores are ADD-ONLY: an existing
 * live file is never overwritten (newer content wins). After restore, the
 * caller commits + pushes so they can never be "deleted" by a deploy again.
 *
 * Usage: node scripts/restore-deleted.cjs
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const BASE = '/home/z/my-project'
const BARE = path.join(BASE, 'vortex-git', 'vortex-ecosystem.git')
const NEW = execFileSync('git', ['--git-dir', BARE, 'rev-parse', 'HEAD']).toString().trim()
const OLD = '78875f1' + '0'.repeat(32) // full-ish: resolve below

function resolveOld() {
  const out = execFileSync('git', ['--git-dir', BARE, 'rev-parse', '78875f1']).toString().trim()
  return out
}
const OLDREV = resolveOld()

// NUL-separated "D\0path" pairs — safe for unicode filenames
const raw = execFileSync('git', ['--git-dir', BARE, 'diff', '--name-status', '--diff-filter=D', '-z', OLDREV, NEW], { maxBuffer: 64 * 1024 * 1024 }).toString()
const parts = raw.split('\0')
const deleted = []
for (let i = 0; i < parts.length - 1; i++) {
  if (parts[i] === 'D') deleted.push(parts[i + 1])
}
console.log('deleted-in-diff:', deleted.length)

let restored = 0, skippedExisting = 0, failed = 0, failedList = []
for (const rel of deleted) {
  const abs = path.join(BASE, rel)
  if (!abs.startsWith(BASE + path.sep)) continue
  if (fs.existsSync(abs)) { skippedExisting++; continue }
  try {
    const blob = execFileSync('git', ['--git-dir', BARE, 'show', `${OLDREV}:${rel}`], { maxBuffer: 64 * 1024 * 1024 })
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, blob)
    restored++
  } catch (e) {
    failed++; if (failedList.length < 10) failedList.push(rel)
  }
}
console.log(JSON.stringify({ restored, skippedExisting, failed, failedList }))
