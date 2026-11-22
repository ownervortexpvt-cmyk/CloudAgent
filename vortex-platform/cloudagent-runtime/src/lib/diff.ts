/**
 * v62 — tiny dependency-free line diff (LCS based).
 *
 * Used by the version-history "Diff vs current" view. Snapshots and current
 * files are plain text, so a classic LCS table over lines is plenty — sizes
 * are capped by the caller (see /api/versions action:'diff') to keep the
 * O(n·m) table honest.
 */

export interface DiffLine {
  t: ' ' | '+' | '-' // context | added | removed
  s: string // the line text (no trailing newline)
}

const MAX_LCS = 4000 // per side — bigger files fall back to naive block diff

export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split('\n')
  const B = b.split('\n')
  const n = A.length
  const m = B.length

  // Drop the common prefix/suffix first — huge win for edited files and keeps
  // the LCS table within the cap for most real edits.
  let start = 0
  while (start < n && start < m && A[start] === B[start]) start++
  let endA = n - 1
  let endB = m - 1
  while (endA >= start && endB >= start && A[endA] === B[endB]) { endA--; endB-- }

  const pre: DiffLine[] = A.slice(0, start).map(s => ({ t: ' ' as const, s }))
  const midA = A.slice(start, endA + 1)
  const midB = B.slice(start, endB + 1)
  const suf: DiffLine[] = A.slice(endA + 1).map(s => ({ t: ' ' as const, s }))

  const N = midA.length
  const M = midB.length
  if (N === 0 && M === 0) return [...pre, ...suf]

  if (N === 0) return [...pre, ...midB.map(s => ({ t: '+' as const, s })), ...suf]
  if (M === 0) return [...pre, ...midA.map(s => ({ t: '-' as const, s })), ...suf]

  if (N > MAX_LCS || M > MAX_LCS) {
    // File too big for the LCS table — honest coarse diff: show the whole
    // middle as one removed block + one added block.
    return [
      ...pre,
      ...midA.map(s => ({ t: '-' as const, s })),
      ...midB.map(s => ({ t: '+' as const, s })),
      ...suf,
    ]
  }

  // LCS DP table
  const dp: Uint32Array[] = []
  for (let i = 0; i <= N; i++) dp.push(new Uint32Array(M + 1))
  for (let i = N - 1; i >= 0; i--) {
    for (let j = M - 1; j >= 0; j--) {
      dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  // Walk the table
  const mid: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < N && j < M) {
    if (midA[i] === midB[j]) { mid.push({ t: ' ', s: midA[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { mid.push({ t: '-', s: midA[i] }); i++ }
    else { mid.push({ t: '+', s: midB[j] }); j++ }
  }
  while (i < N) { mid.push({ t: '-', s: midA[i] }); i++ }
  while (j < M) { mid.push({ t: '+', s: midB[j] }); j++ }

  return [...pre, ...mid, ...suf]
}

/** Collapse long runs of context lines around changes (GitHub-style). */
export function collapseContext(lines: DiffLine[], keep = 3): { line: DiffLine; skippedBefore?: number }[] {
  // indices of changed lines
  const changed = new Set<number>()
  lines.forEach((l, i) => { if (l.t !== ' ') changed.add(i) })
  if (changed.size === 0) return lines.slice(0, keep).map(line => ({ line })) // no changes → show head only
  const keepSet = new Set<number>()
  for (const c of changed) {
    for (let k = Math.max(0, c - keep); k <= Math.min(lines.length - 1, c + keep); k++) keepSet.add(k)
  }
  const out: { line: DiffLine; skippedBefore?: number }[] = []
  let skipped = 0
  for (let i = 0; i < lines.length; i++) {
    if (keepSet.has(i)) {
      if (skipped > 0) { out.push({ line: { t: ' ', s: `⋯ ${skipped} unchanged line${skipped !== 1 ? 's' : ''}` } }); skipped = 0 }
      out.push({ line: lines[i] })
    } else {
      skipped++
    }
  }
  if (skipped > 0) out.push({ line: { t: ' ', s: `⋯ ${skipped} unchanged line${skipped !== 1 ? 's' : ''}` } })
  return out
}
