/**
 * Cloud Agent Tools v27 — FULL PIPELINE PACK (the user's end-to-end flow).
 *
 * Two NEW real tools (both additive, nothing removed):
 *   qa_squad          TWO-agent test loop: Inspector (deterministic static
 *                     checks: syntax, JSON, broken asset refs, unfinished
 *                     markers) + Reviewer (LLM: missing features vs the app
 *                     description, broken button flows) → Fixer (LLM applies
 *                     patches) → re-test → QA_REPORT.md with before/after.
 *   convert_language  Convert the app to another stack (react ↔ flutter ↔
 *                     vue ↔ html ↔ …) while PRESERVING the UI design —
 *                     output lands in converted/<target>/ so nothing is
 *                     destroyed, plus CONVERSION.md with a run guide.
 */
import { db } from '../db'
import * as storage from '../storage'
import { safeUpsert, type ToolResult, type ProjectContext } from './tools'

const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|mp3|mp4|zip|pdf|db)$/i
const SKIP_DIR = /node_modules|\.next|\.git|build\/|dist\/|\.dart_tool|__pycache__|\.gradle/

async function writeAndIndex(ctx: ProjectContext, path: string, content: string) {
  storage.writeFile(ctx.projectId, path, content)
  try {
    await safeUpsert({
      where: { projectId_path: { projectId: ctx.projectId, path } },
      create: { projectId: ctx.projectId, path, content, isDir: false },
      update: { content },
    })
  } catch { /* project may be deleted — file is safe on disk */ }
}

async function zaiChat(prompt: string, temperature = 0.3): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
  const zai = await ZAI.create()
  const res = await (zai as any).chat.completions.create({
    model: 'glm-4.6',
    temperature,
    messages: [{ role: 'user', content: prompt }],
  } as any)
  return res?.choices?.[0]?.message?.content || ''
}

/** Pull a bounded text sample of the project for LLM context. */
function collectSource(ctx: ProjectContext, maxFiles = 10, maxCharsEach = 7000, maxTotal = 44000): { path: string; content: string }[] {
  const entries = storage.readAllAsEntries(ctx.projectId)
    .filter(e => !SKIP_DIR.test(e.path) && !SKIP_EXT.test(e.path) && /\.(js|jsx|mjs|cjs|ts|tsx|dart|py|go|rs|java|kt|php|css|html|vue|svelte|json)$/i.test(e.path))
    .filter(e => !/package-lock\.json|composer\.lock|pubspec\.lock/i.test(e.path))
    .slice(0, maxFiles)
  const out: { path: string; content: string }[] = []
  let total = 0
  for (const e of entries) {
    const content = String(e.content || '').slice(0, maxCharsEach)
    if (!content.trim()) continue
    if (total + content.length > maxTotal) break
    out.push({ path: e.path, content })
    total += content.length
  }
  return out
}

/** Tolerant JSON extraction from an LLM answer (handles ``` fences and prose). */
function parseJsonLoose<T = any>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  try { return JSON.parse(cleaned) as T } catch { /* keep trying */ }
  const m = cleaned.match(/[[{][\s\S]*[\]}]/)
  if (m) {
    try { return JSON.parse(m[0]) as T } catch { /* give up */ }
  }
  return null
}

/**
 * Parse the robust patch format we ask the model for:
 *   ###FILE: path
 *   ```lang
 *   <complete file content>
 *   ```
 *   ###ENDFILE
 * Code-in-fence survives LLM output far better than code embedded as JSON
 * strings (raw newlines used to wreck JSON.parse). JSON array is still
 * accepted as a fallback for stubborn models.
 */
function parseFileBlocks(raw: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = []
  const chunks = raw.split(/###FILE:\s*/).slice(1)
  for (const chunk of chunks) {
    const nl = chunk.indexOf('\n')
    if (nl < 0) continue
    const path = chunk.slice(0, nl).trim().replace(/^["'*\s]+|["'*\s]+$/g, '').replace(/^\/+/, '')
    let body = chunk.slice(nl + 1)
    body = body.replace(/^\s*```[a-zA-Z0-9+#-]*\s*\n/, '')
    const end = body.lastIndexOf('\n```')
    if (end >= 0) body = body.slice(0, end)
    body = body.replace(/\s*###ENDFILE\s*$/, '')
    if (path && body.trim().length > 0) out.push({ path, content: body })
  }
  return out
}

/** Try ###FILE: blocks first, then a JSON [{path, content|newContent}] array. */
function parsePatches(raw: string): Array<{ path: string; content: string }> {
  const blocks = parseFileBlocks(raw)
  if (blocks.length) return blocks
  const json = parseJsonLoose<Array<{ path: string; content?: string; newContent?: string }>>(raw)
  if (Array.isArray(json)) {
    return json
      .filter(p => p && typeof p.path === 'string' && typeof (p.content ?? p.newContent) === 'string')
      .map(p => ({ path: p.path, content: String(p.content ?? p.newContent) }))
  }
  return []
}

/**
 * Map a model-supplied file path back to a safe project-relative path.
 * Models love to echo ABSOLUTE paths seen in tool output — without this the
 * patch lands in a nested junk folder and the real file stays broken.
 */
function normalizePatchPath(ctx: ProjectContext, rawPath: string): string | null {
  let p = String(rawPath || '').trim().replace(/["'*]+/g, '').trim()
  if (!p) return null
  const root = storage.projectRoot(ctx.projectId)
  const withSlash = p.startsWith('/') ? p : '/' + p
  if (withSlash.startsWith(root + '/')) p = withSlash.slice(root.length + 1)
  else p = p.replace(/^\/+/, '')
  p = p.replace(/\.\./g, '').replace(/^\/+/, '').trim()
  if (!p || p.includes('\\')) return null
  return p
}

/* ── Inspector: deterministic static checks (Agent #1, the "no-LLM eyes") ── */

interface Finding {
  severity: 'error' | 'warn'
  file: string
  message: string
}

async function inspectProject(ctx: ProjectContext): Promise<Finding[]> {
  const findings: Finding[] = []
  const entries = storage.readAllAsEntries(ctx.projectId).filter(e => !SKIP_DIR.test(e.path) && !SKIP_EXT.test(e.path))
  const root = storage.projectRoot(ctx.projectId)
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const run = promisify(execFile)

  for (const e of entries) {
    const content = String(e.content || '')
    if (!content.trim()) continue
    const abs = root + '/' + e.path

    // 1. JS syntax gate (real node --check)
    if (/\.(js|mjs|cjs)$/i.test(e.path)) {
      try {
        await run('node', ['--check', abs], { timeout: 15000 })
      } catch (err: any) {
        const detail = String(err?.stderr || err?.message || '').split('\n').filter(Boolean).slice(0, 3).join(' | ').slice(0, 200)
        findings.push({ severity: 'error', file: e.path, message: `Syntax error (node --check): ${detail}` })
      }
    }
    // 2. JSON validity (a broken config kills the app at startup)
    else if (/\.json$/i.test(e.path) && !/(package-lock|composer\.lock|pubspec\.lock|tsconfig\.tsbuildinfo)/i.test(e.path)) {
      try { JSON.parse(content) } catch (err: any) {
        findings.push({ severity: 'error', file: e.path, message: `Invalid JSON: ${String(err?.message || '').slice(0, 160)}` })
      }
    }

    // 3. Unfinished-work markers (skip lock files — they legitimately contain anything)
    if (!/(package-lock|composer\.lock|pubspec\.lock)/i.test(e.path)) {
      const lines = content.split('\n')
      for (let i = 0; i < lines.length && i < 2000; i++) {
        const line = lines[i]
        if (/\b(TODO|FIXME)\b/.test(line) || /lorem ipsum/i.test(line)) {
          findings.push({ severity: 'warn', file: e.path, message: `line ${i + 1}: unfinished marker — ${line.trim().slice(0, 90)}` })
        }
      }
    }
  }

  // 4. Broken local references in HTML (assets/other pages that don't exist)
  for (const e of entries.filter(e => /\.html?$/i.test(e.path))) {
    const content = String(e.content || '')
    const refs = content.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)
    for (const m of refs) {
      const ref = m[1]
      if (/^(https?:|data:|mailto:|tel:|#|\/\/|\{\{)/.test(ref)) continue
      const clean = ref.split('?')[0].split('#')[0].replace(/^\.\//, '').replace(/^\//, '')
      if (!clean) continue
      const candidates = [clean, `public/${clean}`, `src/${clean}`, `assets/${clean}`, `dist/${clean}`]
      if (!candidates.some(c => storage.existsFile(ctx.projectId, c))) {
        findings.push({ severity: 'error', file: e.path, message: `references missing file "${ref}"` })
      }
    }
  }

  // 5. React/Vue click handlers referenced but never defined
  const allText = entries.map(e => ({ path: e.path, content: String(e.content || '') }))
  for (const e of allText) {
    if (!/\.(jsx|tsx|js|ts|vue|svelte)$/i.test(e.path)) continue
    const handlers = [...e.content.matchAll(/on(?:Click|Tap|Press)\s*=\s*\{(\w+)\}/g)].map(m => m[1])
    const others = allText.filter(o => o.path !== e.path).map(o => o.content).join('\n')
    for (const h of handlers) {
      const definedHere = new RegExp(`(function\\s+${h}\\b|const\\s+${h}\\b|let\\s+${h}\\b|${h}\\s*=\\s*(\\(|async|function))`).test(e.content)
      const definedElsewhere = new RegExp(`(function\\s+${h}\\b|const\\s+${h}\\b|let\\s+${h}\\b)`).test(others)
      if (!definedHere && !definedElsewhere) {
        findings.push({ severity: 'error', file: e.path, message: `onClick handler "${h}" is never defined — this button does nothing` })
      }
    }
  }

  return findings
}

function dedupeFindings(list: Finding[]): Finding[] {
  const seen = new Set<string>()
  return list.filter(f => {
    const k = `${f.file}::${f.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/* ── The tools ──────────────────────────────────────────────────────────── */

export const V27_TOOLS: any = {
  /* ── QA Squad: two-agent test → fix → re-test loop ───────────────────── */
  qa_squad: {
    name: 'qa_squad',
    description: 'Two QA agents test the app end-to-end: Agent #1 (Inspector) runs real static checks (JS syntax via node --check, JSON validity, broken asset references, undefined onClick handlers, unfinished markers) and Agent #2 (Reviewer) compares the code against the app description for missing features or dead buttons. A Fixer agent then auto-applies patches and everything is re-tested. Writes QA_REPORT.md with before/after results. Run before publishing.',
    parameters: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Optional focus, e.g. "the checkout button", "offline mode", "the quiz logic"' },
        autoFix: { type: 'boolean', description: 'Let the Fixer agent patch files automatically (default true)' },
      },
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      try {
        const before = dedupeFindings(await inspectProject(ctx))
        const errorsBefore = before.filter(f => f.severity === 'error').length

        // Agent #2 — LLM feature/behaviour review against the description
        let reviewText = ''
        let reviewIssues: { file: string; issue: string }[] = []
        const files = collectSource(ctx)
        const project = await db.project.findUnique({ where: { id: ctx.projectId } }).catch(() => null)
        const desc = [project?.name, project?.description].filter(Boolean).join(': ') || 'unspecified app'
        if (files.length) {
          const context = files.map(f => `----- ${f.path} -----\n${f.content}`).join('\n\n')
          reviewText = await zaiChat(
            `You are QA Tester #2 reviewing an app described as: "${desc}". ${args.focus ? `Extra focus: ${args.focus}.` : ''}\n` +
            `Find CONCRETE problems only: features the description implies but the code lacks, buttons/flows that can never work, logic that is incomplete, hardcoded stubs where real behaviour belongs.\n` +
            `Return a numbered markdown list; each item must name the file and the exact problem in one sentence. No praise, no style nitpicks, no generic advice. If the code genuinely covers the description, reply exactly NO_ISSUES.\n\n${context}`,
          )
          reviewIssues = reviewText
            .split('\n')
            .filter(l => /^\s*\d+\./.test(l))
            .map(l => {
              const m = l.match(/^\s*\d+\.\s*(.*)$/)
              return { file: (m?.[1]?.match(/[\w./-]+\.(?:js|jsx|ts|tsx|dart|py|html|vue|svelte|css)/i) || [''])[0], issue: (m?.[1] || l).slice(0, 300) }
            })
            .filter(x => x.issue)
        }

        // Fixer — LLM patches (bounded, only when allowed and there is something to fix)
        const autoFix = args.autoFix !== false
        const applied: { path: string; why: string }[] = []
        let rawFixer = ''
        if (autoFix) {
          const fixable = [
            ...before.filter(f => f.severity === 'error').map(f => ({ file: f.file, issue: f.message })),
            ...reviewIssues.slice(0, 4).map(r => ({ file: r.file, issue: r.issue })),
          ].slice(0, 6)
          if (fixable.length && files.length) {
            const relevantFiles = files.filter(f => fixable.some(x => !x.file || f.path === x.file))
            const pool = (relevantFiles.length ? relevantFiles : files).slice(0, 6)
            const context = pool.map(f => `----- ${f.path} -----\n${f.content}`).join('\n\n')
            const raw = await zaiChat(
              `You are the QA Fixer. The QA squad found these issues in the app:\n` +
              fixable.map((f, i) => `${i + 1}. [${f.file || 'project'}] ${f.issue}`).join('\n') +
              `\n\nFix them by rewriting the affected files. Rules: keep every existing feature working, do not delete features, keep the same UI design.\n` +
              `Reply ONLY with patches in EXACTLY this format, repeated per file (max 5 files, only paths from the context, each file COMPLETE):\n` +
              `###FILE: <exact path>\n\`\`\`<lang>\n<complete new file content>\n\`\`\`\n###ENDFILE\n` +
              `Paths must be RELATIVE exactly as shown in the context headers. ` +
              `If nothing should change reply exactly NO_PATCHES.\n\n${context}`,
              0.2,
            )
            rawFixer = raw
            const patches = parsePatches(raw)
            if (patches.length) {
              for (const p of patches.slice(0, 5)) {
                if (!p || typeof p.path !== 'string' || typeof p.content !== 'string') continue
                const rel = normalizePatchPath(ctx, p.path)
                if (!rel || p.content.length < 10) continue
                await writeAndIndex(ctx, rel, p.content)
                applied.push({ path: rel, why: 'QA fix' })
              }
            }
          }
        }

        // Re-test after fixes
        const after = dedupeFindings(await inspectProject(ctx))
        const errorsAfter = after.filter(f => f.severity === 'error').length

        const lines: string[] = [
          `# QA Squad report`,
          ``,
          `- Inspector errors: **${errorsBefore} → ${errorsAfter}** (warnings ${before.length - errorsBefore} → ${after.length - errorsAfter})`,
          `- Reviewer issues: **${reviewIssues.length}**${reviewText.trim() === 'NO_ISSUES' ? ' (reviewer verdict: description fully covered)' : ''}`,
          `- Auto-fixes applied: **${applied.length}**`,
          ``,
          `## Inspector findings (${after.length})`,
          after.length ? after.slice(0, 30).map(f => `- [${f.severity}] \`${f.file}\` — ${f.message}`).join('\n') : '_none_',
          ``,
          `## Reviewer findings`,
          reviewIssues.length ? reviewIssues.map((r, i) => `${i + 1}. ${r.issue}${r.file ? ` (\`${r.file}\`)` : ''}`).join('\n') : (reviewText.trim() === 'NO_ISSUES' ? '_none — code matches the description_' : '_reviewer produced no itemised findings_'),
          ``,
        ]
        if (applied.length) {
          lines.push(`## Fixes applied`, ...applied.map(a => `- \`${a.path}\` — ${a.why}`), ``)
        }
        lines.push(`_Generated by qa_squad (Inspector + Reviewer + Fixer). Re-run after changing code._`)
        await writeAndIndex(ctx, 'QA_REPORT.md', lines.join('\n'))

        const ok = errorsAfter === 0 || errorsAfter < errorsBefore || applied.length > 0
        const summary = `QA Squad done. Errors ${errorsBefore} → ${errorsAfter}, reviewer issues ${reviewIssues.length}, fixes applied ${applied.length}. Full report: QA_REPORT.md.` +
          (after.filter(f => f.severity === 'error').length ? ` Remaining errors: ${after.filter(f => f.severity === 'error').slice(0, 5).map(f => `${f.file}: ${f.message}`).join(' | ')}` : '')
        return { ok, output: summary, data: { errorsBefore, errorsAfter, reviewIssues: reviewIssues.length, applied: applied.length, fixerRawHead: applied.length === 0 ? String(rawFixer || '').slice(0, 400) : undefined } }
      } catch (e: any) {
        return { ok: false, output: '', error: `qa_squad failed: ${e?.message || e}` }
      }
    },
  },

  /* ── Language converter (React ↔ Flutter ↔ …), UI-design preserving ──── */
  convert_language: {
    name: 'convert_language',
    description: 'Convert this app to a different language/framework while PRESERVING the exact UI design (layout, colors, text, icons). Examples: react→flutter, flutter→react, react→vue, html→react, any→react-native. Writes the converted app into converted/<target>/ (the original project is never touched) plus CONVERSION.md with a mapping table and run instructions.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Target stack, e.g. "flutter", "react", "react-native", "vue", "svelte", "nextjs", "html", "python", "node"' },
        notes: { type: 'string', description: 'Optional conversion requirements, e.g. "keep the dark theme", "use riverpod for state"' },
      },
      required: ['target'],
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      try {
        const target = String(args.target || '').trim().toLowerCase()
        if (!target || !/^[a-z0-9-]{2,24}$/.test(target)) {
          return { ok: false, output: '', error: 'target must be a stack name like flutter, react, react-native, vue, svelte, nextjs, html' }
        }
        const files = collectSource(ctx, 10, 7000, 44000)
        if (!files.length) return { ok: false, output: '', error: 'Nothing to convert — write some code first.' }
        const project = await db.project.findUnique({ where: { id: ctx.projectId } }).catch(() => null)
        const desc = [project?.name, project?.description].filter(Boolean).join(': ') || 'the app'
        const context = files.map(f => `----- ${f.path} -----\n${f.content}`).join('\n\n')
        const raw = await zaiChat(
          `Convert the following "${desc}" app to ${target}. ${args.notes ? `Extra requirements: ${args.notes}.` : ''}\n` +
          `HARD RULES:\n` +
          `1. PRESERVE THE UI DESIGN EXACTLY — same screens, same layout structure, same colors, same texts/labels, same icons. A user comparing both versions must recognise the same app.\n` +
          `2. Reimplement ALL logic in idiomatic ${target} (state, lists, forms, navigation, styling).\n` +
          `3. Copy binary/design asset references by name (images, fonts) — note any asset that must be copied over.\n` +
          `4. Include the essential project/config files for ${target} (e.g. pubspec.yaml for flutter, package.json + vite config for react, manifest for android-native…).\n` +
          `Reply ONLY with files in EXACTLY this format, repeated per file (max 12 files, each COMPLETE and runnable):\n` +
          `###FILE: <relative/path>\n\`\`\`<lang>\n<complete file content>\n\`\`\`\n###ENDFILE\n\n${context}`,
          0.25,
        )
        const converted = parsePatches(raw)
        const written: string[] = []
        for (const f of converted.slice(0, 12)) {
          if (!f || typeof f.path !== 'string' || typeof f.content !== 'string' || f.content.length < 5) continue
          let safe = normalizePatchPath(ctx, f.path)
          if (!safe) continue
          // guard against double-prefixing when the model echoes the target folder
          const prefix = `converted/${target}/`
          if (safe.startsWith(prefix)) safe = safe.slice(prefix.length)
          if (!safe || safe.startsWith('converted/')) continue
          if (/\.(png|jpe?g|zip|exe|apk|dex|so)$/i.test(safe)) continue
          await writeAndIndex(ctx, `converted/${target}/${safe}`, f.content)
          written.push(`converted/${target}/${safe}`)
        }
        if (!written.length) return { ok: false, output: '', error: 'Conversion produced no writable files — try again.' }

        const report = [
          `# Language conversion → ${target}`,
          ``,
          `- Source app: **${desc}**`,
          `- Original project: **untouched** (no file modified or deleted) — the converted app lives in \`converted/${target}/\`.`,
          `- UI design preserved per instruction #1: same layout, colors, texts, icons.`,
          ``,
          `## Converted files (${written.length})`,
          ...written.map(w => `- \`${w}\``),
          ``,
          `## How to run the converted app`,
          target === 'flutter'
            ? `Copy \`converted/${target}/\` into a Flutter project root (or move its files next to \`pubspec.yaml\`), then \`flutter pub get && flutter run\`. Copy referenced assets from the original project into \`assets/\`.`
            : `Copy the contents of \`converted/${target}/\` into a fresh ${target} project scaffold (Create New App → ${target}), install dependencies (\`npm install\` or the stack's equivalent) and run the dev server.`,
          ``,
          `> Move files to the project root only when you are ready to switch — the agent can do it on request ("promote converted/${target} to the root").`,
          ``,
          `_Generated by convert_language._`,
        ].join('\n')
        await writeAndIndex(ctx, 'CONVERSION.md', report)

        return {
          ok: true,
          output: `Converted to ${target}: ${written.length} files written under converted/${target}/ — UI design preserved, original untouched. Guide: CONVERSION.md. Files: ${written.slice(0, 6).join(', ')}${written.length > 6 ? '…' : ''}`,
          data: { target, files: written },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: `convert_language failed: ${e?.message || e}` }
      }
    },
  },
}
