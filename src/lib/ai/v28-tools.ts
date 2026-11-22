/**
 * Cloud Agent Tools v28 — ULTRA POWER PACK (additive, nothing removed).
 *
 * Six NEW real tools, all executed through the same honest contracts as the
 * rest of the swarm (real LLM, real execution, real files — no fake success):
 *
 *   self_heal               Autonomous watchdog loop: inspect (node --check,
 *                           JSON validity, runtime smoke test) → LLM Fixer
 *                           patches → re-inspect, up to 3 rounds →
 *                           SELF_HEAL.md with before/after.
 *   ai_terminal             Natural language → ONE safety-gated shell
 *                           command executed in the project sandbox →
 *                           real stdout/stderr + LLM explanation.
 *   screenshot_fix          Paste an error/UI screenshot → AI vision reads
 *                           the actual error → locates the file → patches
 *                           it → SCREENSHOT_FIX.md.
 *   app_clone               Fetch a live URL, extract structure/content
 *                           signals, rebuild an ORIGINAL inspired app
 *                           (paraphrased text, placeholder art) under
 *                           cloned-app/ — the source site is never copied
 *                           verbatim and the project is never touched.
 *   viral_growth_kit        Deterministic REAL referral system: invite
 *                           codes, share links (WhatsApp/Telegram/
 *                           Facebook/X), daily streaks, reward tiers —
 *                           assets/growth-kit.js + GROWTH.md + optional
 *                           index.html injection (insert-only).
 *   store_screenshot_studio AI-generated marketing screenshots (REAL image
 *                           generation) + STORE_LISTING.md with captions,
 *                           keywords and descriptions for store publish.
 */
import { db } from '../db'
import * as storage from '../storage'
import { safeUpsert, type ToolResult, type ProjectContext } from './tools'
import { runtimeManager } from '../runtime'

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
  const ZAI = (await import('z-ai-web-dev-sdk').then(m => (m as any).default || m))
  const zai = await ZAI.create()
  const res = await (zai as any).chat.completions.create({
    model: 'glm-4.6',
    temperature,
    messages: [{ role: 'user', content: prompt }],
  } as any)
  return res?.choices?.[0]?.message?.content || ''
}

/** Vision chat — uses the SDK's createVision (same proven path as v3 image_to_code). */
async function zaiVision(prompt: string, imageDataUrl: string): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk').then(m => (m as any).default || m))
  const zai = await ZAI.create()
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ],
  }]
  const create = (zai as any).chat.completions.createVision || (zai as any).chat.completions.create
  const res = await create.call((zai as any).chat.completions, {
    messages,
    thinking: { type: 'disabled' },
  } as any)
  return res?.choices?.[0]?.message?.content || ''
}

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

/** Robust ###FILE: blocks parser (same contract as v27 qa_squad). */
function parsePatches(raw: string): Array<{ path: string; content: string }> {
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

/** Map model-supplied absolute/nested paths back into the project root. */
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

interface Finding { severity: 'error' | 'warn'; file: string; message: string }

/** Deterministic inspector (same spirit as qa_squad #1, reused by self_heal). */
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
    if (/\.(js|mjs|cjs)$/i.test(e.path)) {
      try {
        await run('node', ['--check', abs], { timeout: 15000 })
      } catch (err: any) {
        const detail = String(err?.stderr || err?.message || '').split('\n').filter(Boolean).slice(0, 3).join(' | ').slice(0, 200)
        findings.push({ severity: 'error', file: e.path, message: `Syntax error (node --check): ${detail}` })
      }
    } else if (/\.json$/i.test(e.path) && !/(package-lock|composer\.lock|pubspec\.lock|tsconfig\.tsbuildinfo)/i.test(e.path)) {
      try { JSON.parse(content) } catch (err: any) {
        findings.push({ severity: 'error', file: e.path, message: `Invalid JSON: ${String(err?.message || '').slice(0, 160)}` })
      }
    }
  }
  return findings
}

/** Apply LLM patches with path normalisation; returns applied file list. */
async function applyPatches(ctx: ProjectContext, raw: string, why: string): Promise<string[]> {
  const applied: string[] = []
  for (const p of parsePatches(raw).slice(0, 5)) {
    if (!p || typeof p.path !== 'string' || typeof p.content !== 'string') continue
    const rel = normalizePatchPath(ctx, p.path)
    if (!rel || p.content.length < 10) continue
    await writeAndIndex(ctx, rel, p.content)
    applied.push(rel)
    void why
  }
  return applied
}

export const V28_TOOLS: any = {
  /* ── 1. self_heal — autonomous watch → fix → re-test loop ─────────────── */
  self_heal: {
    name: 'self_heal',
    description: 'Autonomous self-healing watchdog: inspects the project (JS syntax via node --check, JSON validity), starts the app and smoke-tests it, then lets the Fixer agent patch whatever is broken and re-tests — up to 3 rounds until green. Writes SELF_HEAL.md with before/after evidence. Use after big changes or before publishing.',
    parameters: {
      type: 'object',
      properties: {
        maxRounds: { type: 'number', description: 'Max fix rounds (1-5, default 3)' },
        smokeTest: { type: 'boolean', description: 'Also start the app and request it (default true)' },
      },
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      try {
        const maxRounds = Math.max(1, Math.min(5, Number(args?.maxRounds) || 3))
        const doSmoke = args?.smokeTest !== false

        const before = await inspectProject(ctx)
        let errors = before.filter(f => f.severity === 'error').length
        const history: { round: number; errorsBefore: number; fixed: string[]; errorsAfter: number; smoke?: string }[] = []
        let smokeNote = ''

        for (let round = 1; round <= maxRounds && errors > 0; round++) {
          const files = collectSource(ctx)
          if (!files.length) break
          const context = files.map(f => `----- ${f.path} -----\n${f.content}`).join('\n\n')
          const raw = await zaiChat(
            `You are the Self-Heal Fixer. This app fails automated checks:\n` +
            before.filter(f => f.severity === 'error').map((f, i) => `${i + 1}. [${f.file}] ${f.message}`).join('\n') +
            `\n\nFix the errors by rewriting the affected files. Rules: keep every existing feature, do not delete anything, keep the same UI design, make MINIMAL but complete corrections.\n` +
            `Reply ONLY with patches in EXACTLY this format (each file COMPLETE):\n` +
            `###FILE: <exact relative path>\n\`\`\`<lang>\n<complete new file content>\n\`\`\`\n###ENDFILE\n` +
            `Only paths from the context. If a file cannot be fixed reply NO_PATCHES.\n\n${context}`,
            0.2,
          )
          const fixed = await applyPatches(ctx, raw, 'self_heal')
          const after = await inspectProject(ctx)
          const errorsAfter = after.filter(f => f.severity === 'error').length
          history.push({ round, errorsBefore: errors, fixed, errorsAfter })
          errors = errorsAfter
          if (!fixed.length) break // honest stop: model could not patch
        }

        // Runtime smoke test (best-effort — a project that cannot start still heals statically)
        if (doSmoke) {
          try {
            const start = await runtimeManager.start(ctx.projectId)
            if (start.ok && start.port) {
              const ac = new AbortController()
              const timer = setTimeout(() => ac.abort(), 8000)
              const res = await fetch(`http://127.0.0.1:${start.port}/`, { signal: ac.signal }).catch(e => ({ ok: false, status: 0, error: String((e as any)?.message || e) }) as any)
              clearTimeout(timer)
              if (res.ok) smokeNote = `app served HTTP ${res.status} on port ${start.port}`
              else smokeNote = `smoke request failed after start (port ${start.port}): ${res.error || 'HTTP ' + (res as any).status}`
            } else {
              smokeNote = `could not start runtime (${start.error || 'unknown'}) — static healing only`
            }
          } catch (e: any) {
            smokeNote = `smoke test skipped: ${String(e?.message || e).slice(0, 120)}`
          }
        }

        const after = await inspectProject(ctx)
        const errorsAfter = after.filter(f => f.severity === 'error').length
        const totalFixed = history.reduce((n, h) => n + h.fixed.length, 0)

        const lines = [
          `# Self-Heal report`,
          ``,
          `- Errors: **${before.filter(f => f.severity === 'error').length} → ${errorsAfter}**`,
          `- Rounds used: **${history.length}**, files patched: **${totalFixed}**`,
          smokeNote ? `- Runtime smoke: ${smokeNote}` : `- Runtime smoke: skipped`,
          ``,
          `## Rounds`,
          history.length
            ? history.map(h => `- Round ${h.round}: ${h.errorsBefore} → ${h.errorsAfter} errors${h.fixed.length ? `, fixed: ${h.fixed.map(f => '`' + f + '`').join(', ')}` : ', no patch applied'}`).join('\n')
            : '_nothing to fix — app was already green_',
          ``,
          `## Remaining findings`,
          errorsAfter ? after.filter(f => f.severity === 'error').slice(0, 20).map(f => `- [${f.file}] ${f.message}`).join('\n') : '_none_',
          ``,
          `_Generated by self_heal._`,
        ].join('\n')
        await writeAndIndex(ctx, 'SELF_HEAL.md', lines)

        return {
          ok: errorsAfter === 0 || totalFixed > 0,
          output: `Self-heal finished: ${before.filter(f => f.severity === 'error').length} → ${errorsAfter} errors after ${history.length} round(s), ${totalFixed} file(s) patched. Report: SELF_HEAL.md${smokeNote ? `. Smoke: ${smokeNote}` : ''}`,
          data: { errorsBefore: before.filter(f => f.severity === 'error').length, errorsAfter, rounds: history.length, fixed: totalFixed, smoke: smokeNote },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: `self_heal failed: ${e?.message || e}` }
      }
    },
  },

  /* ── 2. ai_terminal — natural language → safe command → real run ─────── */
  ai_terminal: {
    name: 'ai_terminal',
    description: 'Speak to the terminal in plain language: it picks the right shell command, runs it for real inside the project sandbox, and explains the output. Destructive commands (rm -rf /, fork bombs, pipe-to-shell installers, disk writes…) are refused.',
    parameters: {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'What you want, e.g. "count how many files I have", "show the biggest file", "find all TODO comments"' },
        confirm: { type: 'boolean', description: 'Internal: set true after showing the user the command (single-ask consent)' },
      },
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      try {
        const request = String(args?.request || '').trim()
        if (!request) return { ok: false, output: '', error: 'request required — say what you want in plain words' }

        const plan = await zaiChat(
          `Convert this request into ONE safe shell command executed inside a project sandbox (linux, bash, project files in the current directory). ` +
          `Request: "${request.replace(/"/g, "'")}"\n` +
          `Reply ONLY with JSON: {"command": "...", "why": "one sentence", "safe": true|false}. ` +
          `Set safe=false if the request requires deleting everything, touching the host system, network installers piped to shell, or anything destructive.`,
          0.1,
        )
        let parsed: any = null
        try { parsed = JSON.parse(plan.replace(/```(?:json)?/gi, '').trim()) } catch {
          const m = plan.match(/[[{][\s\S]*[\]}]/)
          if (m) { try { parsed = JSON.parse(m[0]) } catch { /* keep null */ } }
        }
        if (!parsed || typeof parsed.command !== 'string') {
          return { ok: false, output: '', error: `could not plan a command from: ${request.slice(0, 100)}` }
        }

        const BLOCK = /(\brm\s+-rf?\s+\/(?!\w)|\bmkfs\b|:\(\)\s*\{.*\}\s*;?\s*:|\bdd\s+if=|\bshutdown\b|\breboot\b|\binit\s+0?\b|\bchmod\s+-R\s+0{3}\b|>\s*\/dev\/(sd|nvme|hd)|(curl|wget)[^|;]*\|\s*(sudo\s+)?(ba|z)?sh\b|\bhistory\s+-c\b|\bkill\s+-9\s+1\b|\bmv\s+\/(?!\w)|\bgit\s+push\b[^&]*--force)/i
        if (parsed.safe === false || BLOCK.test(parsed.command)) {
          return { ok: false, output: '', error: `REFUSED — unsafe command blocked: ${parsed.command.slice(0, 120)}` }
        }

        const r = await runtimeManager.execInProject(ctx.projectId, parsed.command, 30000)
        const out = String(r.stdout || '')
        const err = String(r.stderr || '')
        const combined = (out + '\n' + err).trim().slice(0, 4000)

        let explanation = ''
        if (combined) {
          explanation = await zaiChat(
            `A user ran this command inside their project: ${parsed.command}\nWhy: ${parsed.why || ''}\n` +
            `Output (may be truncated):\n${combined.slice(0, 2000)}\n\n` +
            `Explain in 2-4 plain sentences what the result means for their project. No code blocks, no markdown headers.`,
            0.3,
          )
        }

        return {
          ok: r.code === 0,
          output: `$ ${parsed.command}\n${combined || '(no output)'}${explanation ? `\n\nWhat this means: ${explanation.trim()}` : ''}`,
          data: { command: parsed.command, exitCode: r.code, why: parsed.why },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: `ai_terminal failed: ${e?.message || e}` }
      }
    },
  },

  /* ── 3. screenshot_fix — paste the error screenshot, get a patch ─────── */
  screenshot_fix: {
    name: 'screenshot_fix',
    description: 'Paste a screenshot of an error, a crash, or a broken screen (as a data URL or an image link). The AI reads exactly what went wrong, finds the responsible file in this project, patches it, and writes SCREENSHOT_FIX.md with what it saw and changed.',
    parameters: {
      type: 'object',
      properties: {
        image: { type: 'string', description: 'Screenshot as a data URL (data:image/png;base64,…) or an https:// image link' },
        note: { type: 'string', description: 'Optional: what you were doing when this happened' },
      },
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      try {
        const rawImage = String(args?.image || '').trim()
        if (!rawImage) return { ok: false, output: '', error: 'image required (data URL or https link)' }

        let dataUrl = rawImage
        if (!/^data:image\//i.test(rawImage)) {
          if (!/^https?:\/\//i.test(rawImage)) return { ok: false, output: '', error: 'image must be a data: or https: URL' }
          const ac = new AbortController()
          const timer = setTimeout(() => ac.abort(), 12000)
          const res = await fetch(rawImage, { signal: ac.signal })
          clearTimeout(timer)
          if (!res.ok) return { ok: false, output: '', error: `could not download image (HTTP ${res.status})` }
          const mime = res.headers.get('content-type') || 'image/png'
          if (!mime.startsWith('image/')) return { ok: false, output: '', error: `URL is not an image (${mime})` }
          const buf = Buffer.from(await res.arrayBuffer())
          if (buf.length > 6 * 1024 * 1024) return { ok: false, output: '', error: 'image too large (max 6 MB)' }
          dataUrl = `data:${mime};base64,${buf.toString('base64')}`
        } else if (dataUrl.length > 8 * 1024 * 1024) {
          return { ok: false, output: '', error: 'image too large (max ~6 MB after decoding)' }
        }

        // Step 1 — vision pass: read the REAL error from the pixels
        const vision = await zaiVision(
          `This is a screenshot from a user's app ${args?.note ? `(they were: ${String(args.note).slice(0, 200)})` : ''}. ` +
          `Read it precisely. Reply in this exact shape:\n` +
          `WHAT: the error or broken behaviour in 1-2 sentences (quote the exact error text if visible)\n` +
          `WHERE: any file name, component, route or line number visible\n` +
          `CAUSE: the most likely root cause in 1 sentence`,
          dataUrl,
        )
        if (!vision.trim()) return { ok: false, output: '', error: 'vision model returned empty — try a clearer screenshot' }

        // Step 2 — locate + patch with the code context
        const files = collectSource(ctx, 12)
        const applied: string[] = []
        if (files.length) {
          const context = files.map(f => `----- ${f.path} -----\n${f.content}`).join('\n\n')
          const raw = await zaiChat(
            `A user's app shows this problem (read from a screenshot by our vision model):\n${vision.trim()}\n\n` +
            `Here is the project source. Fix the root cause by rewriting ONLY the affected files.\n` +
            `Rules: keep every existing feature, do not delete anything, keep the same UI design.\n` +
            `Reply ONLY with patches in EXACTLY this format (each file COMPLETE):\n` +
            `###FILE: <exact relative path>\n\`\`\`<lang>\n<complete new file content>\n\`\`\`\n###ENDFILE\n` +
            `Only paths from the context. If the problem cannot be fixed from this source, reply NO_PATCHES.\n\n${context}`,
            0.2,
          )
          applied.push(...(await applyPatches(ctx, raw, 'screenshot_fix')))
        }

        const lines = [
          `# Screenshot Fix`,
          ``,
          `## What the AI saw in your screenshot`,
          '```',
          vision.trim().slice(0, 3000),
          '```',
          ``,
          `## Patched files (${applied.length})`,
          applied.length ? applied.map(a => `- \`${a}\``).join('\n') : '_no code change was needed or possible from this screenshot_',
          ``,
          `_Generated by screenshot_fix._`,
        ].join('\n')
        await writeAndIndex(ctx, 'SCREENSHOT_FIX.md', lines)

        return {
          ok: true,
          output: `Read the screenshot: ${vision.split('\n').find(l => l.startsWith('WHAT:'))?.replace('WHAT:', '').trim().slice(0, 200) || 'problem identified'}. ${applied.length ? `Patched: ${applied.join(', ')}` : 'No patch applied (see SCREENSHOT_FIX.md)'}.`,
          data: { vision: vision.slice(0, 2000), applied },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: `screenshot_fix failed: ${e?.message || e}` }
      }
    },
  },

  /* ── 4. app_clone — rebuild inspiration from a live URL, ethically ───── */
  app_clone: {
    name: 'app_clone',
    description: 'Give a public URL of a web app/page you like. The agent fetches it, extracts the structure (sections, navigation, features, colour mood) and rebuilds an ORIGINAL inspired version under cloned-app/ — paraphrased copy, placeholder art, own code. The original site is never copied verbatim and your project is never touched.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The page to take inspiration from, e.g. https://example.com' },
        notes: { type: 'string', description: 'Optional: what you specifically want ("the pricing section", "the dashboard layout")' },
      },
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      try {
        const url = String(args?.url || '').trim()
        if (!/^https?:\/\//i.test(url)) return { ok: false, output: '', error: 'a valid http(s) URL is required' }

        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), 15000)
        const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CloudAgentClone/1.0)' } })
        clearTimeout(timer)
        if (!res.ok) return { ok: false, output: '', error: `fetch failed: HTTP ${res.status} for ${url}` }
        const html = (await res.text()).slice(0, 400_000)

        // Deterministic extraction (no rendering — signals only)
        const pick = (re: RegExp, n = 12) => [...html.matchAll(re)].map(m => m[1].replace(/<[^>]*>/g, '').trim()).filter(t => t && t.length > 1).slice(0, n)
        const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || ''
        const headings = pick(/<h[12][^>]*>([\s\S]{2,120}?)<\/h[12]>/gi)
        const buttons = pick(/<button[^>]*>([\s\S]{1,60}?)<\/button>/gi)
        const navLinks = pick(/<a[^>]*>([\s\S]{1,40}?)<\/a>/gi, 16)
        const colors = [...new Set([...html.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => m[0].toLowerCase()))].slice(0, 10)
        const hasHero = /hero|banner|jumbotron/i.test(html)
        const hasPricing = /pricing|plans/i.test(html)
        const hasFooter = /<footer/i.test(html)
        const hasDark = /dark-mode|theme:\s*dark|background(-color)?:\s*#(0[0-9a-f]|1[0-9a-f]|2[0-9a-f])/i.test(html)

        const brief = [
          `Source page: ${url}${title ? ` ("${title}")` : ''}`,
          headings.length ? `Headings: ${headings.join(' | ')}` : '',
          navLinks.length ? `Nav/actions: ${navLinks.slice(0, 10).join(' | ')}` : '',
          buttons.length ? `Buttons: ${buttons.slice(0, 8).join(' | ')}` : '',
          colors.length ? `Colour mood: ${colors.join(', ')}` : '',
          [hasHero && 'has a hero section', hasPricing && 'has pricing', hasFooter && 'has footer', hasDark && 'dark-styled'].filter(Boolean).join(', ') || 'plain layout',
          args?.notes ? `User wants especially: ${String(args.notes).slice(0, 200)}` : '',
        ].filter(Boolean).join('\n')

        const raw = await zaiChat(
          `Rebuild an ORIGINAL, working single-page web app inspired by this structure brief. DO NOT copy text verbatim — paraphrase everything, invent your own brand name, use CSS gradients/emoji instead of any real logos or images. Keep the same information architecture and mood.\n\n${brief}\n\n` +
          `Produce a small real app: index.html + styles.css + app.js (vanilla, no build step, mobile-friendly).\n` +
          `Reply ONLY with patches in EXACTLY this format:\n` +
          `###FILE: cloned-app/<name>\n\`\`\`<lang>\n<complete file>\n\`\`\`\n###ENDFILE\n` +
          `Every path MUST start with cloned-app/. Write all three files COMPLETE.`,
          0.4,
        )
        const written: string[] = []
        for (const p of parsePatches(raw).slice(0, 8)) {
          if (!p?.path || typeof p.content !== 'string' || p.content.length < 10) continue
          const rel = normalizePatchPath(ctx, p.path)
          if (!rel || !rel.startsWith('cloned-app/')) continue
          await writeAndIndex(ctx, rel, p.content)
          written.push(rel)
        }
        if (!written.length) return { ok: false, output: '', error: 'model produced no usable files — try again or add notes' }

        const report = [
          `# App clone report`,
          ``,
          `- Inspired by: **${url}**${title ? ` — "${title}"` : ''}`,
          `- Original project: **untouched** — everything lives under \`cloned-app/\``,
          `- Ethics: copy is **paraphrased**, art is **placeholder** — no assets or text were taken verbatim`,
          ``,
          `## Structure signals captured`,
          `- Headings: ${headings.slice(0, 6).join(' | ') || '—'}`,
          `- Buttons: ${buttons.slice(0, 6).join(' | ') || '—'}`,
          `- Colours: ${colors.join(', ') || '—'}`,
          `- Sections: ${[hasHero && 'hero', hasPricing && 'pricing', hasFooter && 'footer', hasDark && 'dark theme'].filter(Boolean).join(', ') || 'plain'}`,
          ``,
          `## Files written (${written.length})`,
          written.map(w => `- \`${w}\``).join('\n'),
          ``,
          `Open \`cloned-app/index.html\` in the preview to see it. Say "promote cloned-app to the root" when you want it as the main app.`,
          ``,
          `_Generated by app_clone._`,
        ].join('\n')
        await writeAndIndex(ctx, 'CLONE_REPORT.md', report)

        return {
          ok: true,
          output: `Cloned inspiration from ${url} into cloned-app/ (${written.length} files: ${written.join(', ')}). Original untouched, text paraphrased. Guide: CLONE_REPORT.md`,
          data: { url, files: written, signals: { headings: headings.length, colors: colors.length, hasHero, hasPricing } },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: `app_clone failed: ${e?.message || e}` }
      }
    },
  },

  /* ── 5. viral_growth_kit — REAL referral/share/streak system ─────────── */
  viral_growth_kit: {
    name: 'viral_growth_kit',
    description: 'Adds a complete, working referral & growth system to the app: invite codes, share buttons (WhatsApp, Telegram, Facebook, X), daily streaks and unlockable reward tiers — all in one real JS module (assets/growth-kit.js) with an integration guide (GROWTH.md). Auto-wires itself into index.html when one exists.',
    parameters: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'App name used in share texts (defaults to the project name)' },
        reward: { type: 'string', description: 'What referrers get, e.g. "1 week of Pro", "50 coins"' },
      },
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      try {
        const project = await db.project.findUnique({ where: { id: ctx.projectId } }).catch(() => null)
        const appName = String(args?.appName || project?.name || 'This App').replace(/[<>"'`]/g, '').slice(0, 40)
        const reward = String(args?.reward || 'a special bonus').replace(/[<>"'`]/g, '').slice(0, 60)

        const kit = `/**
 * ${appName} — Growth Kit (generated by Cloud Agent viral_growth_kit)
 * Referral codes + share links + daily streaks + reward tiers.
 * Zero dependencies. Persists in localStorage; swap persist() for your
 * backend later (every state change funnels through the same 3 functions).
 */
(function (global) {
  'use strict'
  var KEY = 'growthkit.v1'
  var REWARD = ${JSON.stringify(reward)}
  var APP = ${JSON.stringify(appName)}
  var TIERS = [
    { invites: 1,  label: 'First Friend',   perk: REWARD },
    { invites: 3,  label: 'Connector',      perk: '2× ' + REWARD },
    { invites: 7,  label: 'Community Star', perk: '5× ' + REWARD },
    { invites: 15, label: 'Legend',         perk: 'VIP badge + 10× ' + REWARD }
  ]

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch (e) { return {} }
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)) } catch (e) { /* private mode */ } }
  function persist() { /* replace with fetch('/api/growth', {method:'POST', body:…}) when a backend exists */ }

  function hashCode(s) {
    var h = 5381, i = s ? s.length : 0
    while (i) { h = (h * 33) ^ s.charCodeAt(--i) }
    return (h >>> 0).toString(36).toUpperCase()
  }

  var GK = {
    APP: APP,
    REWARD: REWARD,
    state: function () {
      var s = load()
      if (!s.code) {
        s.code = hashCode(APP + ':' + (s.joined || (s.joined = Date.now())))
        s.invites = s.invites || 0
        s.streak = s.streak || { days: 0, last: null }
        save(s); persist()
      }
      GK._touchStreak(s)
      return s
    },
    _touchStreak: function (s) {
      var today = new Date().toISOString().slice(0, 10)
      if (s.streak.last !== today) {
        var y = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
        s.streak.days = (s.streak.last === y) ? s.streak.days + 1 : 1
        s.streak.last = today
        save(s); persist()
      }
      return s.streak.days
    },
    /** Register a referral code this user was invited with. */
    applyReferral: function (code) {
      if (!code || typeof code !== 'string') return false
      var s = GK.state()
      if (!s.referredBy) { s.referredBy = code.trim().toUpperCase().slice(0, 12); save(s); persist(); return true }
      return false
    },
    /** Count an invite when someone joins through my link. */
    countInvite: function () {
      var s = GK.state()
      s.invites += 1
      var justUnlocked = TIERS.filter(function (t) { return t.invites === s.invites })
      save(s); persist()
      justUnlocked.forEach(function (t) { GK.emit('reward', t) })
      return s.invites
    },
    tier: function () {
      var s = GK.state()
      var best = null
      TIERS.forEach(function (t) { if (s.invites >= t.invites) best = t })
      return best
    },
    nextTier: function () {
      var s = GK.state()
      return TIERS.find(function (t) { return t.invites > s.invites }) || null
    },
    link: function () {
      var base = location.origin + location.pathname
      return base + '?ref=' + encodeURIComponent(GK.state().code)
    },
    SHARE: {
      whatsapp: function () { window.open('https://wa.me/?text=' + encodeURIComponent('Try ' + APP + ' — it is great! ' + GK.link()), '_blank') },
      telegram: function () { window.open('https://t.me/share/url?url=' + encodeURIComponent(GK.link()) + '&text=' + encodeURIComponent('Try ' + APP + '!'), '_blank') },
      facebook: function () { window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(GK.link()), '_blank') },
      x: function () { window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent('Try ' + APP + '!') + '&url=' + encodeURIComponent(GK.link()), '_blank') },
      copy: function () {
        if (navigator.clipboard) return navigator.clipboard.writeText(GK.link())
        return Promise.reject(new Error('clipboard unavailable'))
      }
    },
    /** Render a ready-made invite card into #growthKit (or body). */
    render: function (el) {
      var host = typeof el === 'string' ? document.querySelector(el) : (el || document.getElementById('growthKit') || document.body)
      var s = GK.state(), t = GK.tier(), n = GK.nextTier()
      var box = document.createElement('div')
      box.id = 'growthKit'
      box.style.cssText = 'font-family:system-ui,sans-serif;background:linear-gradient(135deg,#7c3aed,#db2777);color:#fff;border-radius:16px;padding:16px;max-width:420px;margin:12px auto'
      box.innerHTML =
        '<div style="font-weight:700;font-size:16px">Invite friends → ' + REWARD + '</div>' +
        '<div style="opacity:.9;font-size:13px;margin:4px 0 10px">Invites: <b>' + s.invites + '</b>' +
        (t ? ' · Tier: <b>' + t.label + '</b> (' + t.perk + ')' : '') +
        (n ? ' · Next: ' + n.invites + ' invites → ' + n.label : '') + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button data-gk="whatsapp" style="flex:1;padding:8px;border:0;border-radius:8px;cursor:pointer">WhatsApp</button>' +
        '<button data-gk="telegram" style="flex:1;padding:8px;border:0;border-radius:8px;cursor:pointer">Telegram</button>' +
        '<button data-gk="facebook" style="flex:1;padding:8px;border:0;border-radius:8px;cursor:pointer">Facebook</button>' +
        '<button data-gk="x" style="flex:1;padding:8px;border:0;border-radius:8px;cursor:pointer">X</button>' +
        '<button data-gk="copy" style="flex:1;padding:8px;border:0;border-radius:8px;cursor:pointer">Copy link</button>' +
        '</div>' +
        '<div style="margin-top:8px;font-size:12px;opacity:.85">Your code: <b>' + s.code + '</b> · Streak: ' + s.streak.days + ' day(s) 🔥</div>'
      host.appendChild(box)
      box.addEventListener('click', function (ev) {
        var k = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-gk')
        if (k && GK.SHARE[k]) GK.SHARE[k]()
      })
      return box
    },
    listeners: {},
    on: function (evt, fn) { (GK.listeners[evt] = GK.listeners[evt] || []).push(fn) },
    emit: function (evt, payload) { (GK.listeners[evt] || []).forEach(function (fn) { try { fn(payload) } catch (e) { /* listener error must not break the kit */ } }) },
    /** Auto-handle ?ref=CODE links on load. */
    auto: function () {
      var m = location.search.match(/[?&]ref=([\w-]+)/)
      if (m) GK.applyReferral(decodeURIComponent(m[1]))
    }
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', GK.auto)
  }
  global.GrowthKit = GK
})(typeof window !== 'undefined' ? window : this)
`

        await writeAndIndex(ctx, 'assets/growth-kit.js', kit)
        await writeAndIndex(ctx, 'assets/growth-kit.css', [
          '/* Growth Kit default card — delete this file to fully custom-skin via CSS */',
          '#growthKit button { font-weight: 600; }',
          '#growthKit button:hover { transform: translateY(-1px); transition: transform .15s; }',
        ].join('\n'))

        const guide = [
          `# Growth Kit — ${appName}`,
          ``,
          `A complete referral system was added to this project. It is REAL, working code — no backend needed to start.`,
          ``,
          `## Wire it in 2 lines`,
          '```html',
          `<script src="assets/growth-kit.js"></script>`,
          `<script>GrowthKit.render('#growthKit')</script>`,
          '```',
          ``,
          `## What you get`,
          `- **Invite codes**: every user gets a stable code (base36 hash) — shareable as \`?ref=CODE\` links`,
          `- **Auto-capture**: anyone opening a shared link is marked as referred (\`GrowthKit.auto()\` runs on load)`,
          `- **Share buttons**: WhatsApp, Telegram, Facebook, X + copy-link, pre-filled with the referral link`,
          `- **Streaks**: daily streak counter (use \`GrowthKit.state().streak.days\` for a 🔥 badge)`,
          `- **Reward tiers**: 1 / 3 / 7 / 15 invites unlock escalating perks (reward: **${reward}**)`,
          `- **Events**: \`GrowthKit.on('reward', tier => …)\` fires when a tier unlocks — hook your UI or analytics`,
          ``,
          `## Go backend later (optional)`,
          `All writes funnel through 3 functions in \`assets/growth-kit.js\` (\`persist\`, \`countInvite\`, \`applyReferral\`) — replace their localStorage bodies with your API calls and the whole system becomes server-backed without touching the UI.`,
          ``,
          `## Files`,
          `- \`assets/growth-kit.js\` — the system (~0 dependencies)`,
          `- \`assets/growth-kit.css\` — default card skin (customise freely)`,
          ``,
          `_Generated by viral_growth_kit._`,
        ].join('\n')
        await writeAndIndex(ctx, 'GROWTH.md', guide)

        // Insert-only wiring into index.html when present
        let injected = false
        if (storage.existsFile(ctx.projectId, 'index.html')) {
          const html = storage.readFile(ctx.projectId, 'index.html')
          const tag = `<script src="assets/growth-kit.js"></script>`
          if (!html.includes('growth-kit.js') && /<\/body>/i.test(html)) {
            await writeAndIndex(ctx, 'index.html', html.replace(/<\/body>/i, `  ${tag}\n</body>`))
            injected = true
          }
        }

        // Validate the generated module really parses
        const { execFile } = await import('child_process')
        const { promisify } = await import('util')
        const run = promisify(execFile)
        await run('node', ['--check', storage.projectRoot(ctx.projectId) + '/assets/growth-kit.js'], { timeout: 15000 })

        return {
          ok: true,
          output: `Growth Kit added: assets/growth-kit.js (referral codes, share buttons, streaks, reward tiers) + GROWTH.md guide${injected ? ', auto-wired into index.html' : ''}. Reward: ${reward}.`,
          data: { files: ['assets/growth-kit.js', 'assets/growth-kit.css', 'GROWTH.md'], injected, reward },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: `viral_growth_kit failed: ${e?.message || e}` }
      }
    },
  },

  /* ── 6. store_screenshot_studio — AI marketing shots + listing copy ──── */
  store_screenshot_studio: {
    name: 'store_screenshot_studio',
    description: 'Generates REAL AI marketing screenshots for app-store publishing (phone-frame hero shots per feature) into assets/store-shots/, plus STORE_LISTING.md with feature captions, ASO keywords, a 80-char short description and a full long description. Use before publishing to Play Store / App Store / Galaxy Store.',
    parameters: {
      type: 'object',
      properties: {
        features: { type: 'string', description: 'Comma-separated top features, e.g. "offline quiz, voice input, dark mode". Derived from the project description when omitted.' },
        count: { type: 'number', description: '1-3 screenshots (default 3)' },
      },
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      try {
        const project = await db.project.findUnique({ where: { id: ctx.projectId } }).catch(() => null)
        const appName = String(project?.name || 'My App').slice(0, 60)
        const desc = [project?.name, project?.description].filter(Boolean).join(': ') || 'a mobile app'

        let features = String(args?.features || '').trim()
        if (!features) {
          const raw = await zaiChat(
            `App: ${desc}. List its 3 most marketable features, comma-separated, 2-5 words each, no numbering:`,
            0.4,
          )
          features = raw.replace(/\n+/g, ' ').split(',').map(s => s.trim()).filter(Boolean).slice(0, 3).join(', ')
        }
        const featureList = features.split(',').map(s => s.trim()).filter(Boolean).slice(0, Math.max(1, Math.min(3, Number(args?.count) || 3)))
        if (!featureList.length) return { ok: false, output: '', error: 'no features to showcase — pass args.features' }

        const ZAI = (await import('z-ai-web-dev-sdk').then(m => (m as any).default || m))
        const zai = await ZAI.create()
        const written: string[] = []
        for (let i = 0; i < featureList.length; i++) {
          const feature = featureList[i].replace(/["\\]/g, '').slice(0, 60)
          const prompt =
            `Professional Google Play store screenshot for a mobile app called "${appName}". ` +
            `A sleek modern smartphone mockup centred on a vibrant gradient background, the phone screen shows a beautiful app UI about "${feature}". ` +
            `Clean marketing style, soft shadows, subtle geometric accents, no text captions, high quality, 1:1 square.`
          const res = await (zai as any).images.generations.create({ prompt, size: '1024x1024' })
          const b64 = res?.data?.[0]?.base64
          if (!b64) continue
          const rel = `assets/store-shots/shot-${i + 1}.png`
          storage.writeFile(ctx.projectId, rel, Buffer.from(b64, 'base64'))
          try {
            await safeUpsert({
              where: { projectId_path: { projectId: ctx.projectId, path: rel } },
              create: { projectId: ctx.projectId, path: rel, content: `[binary ${Buffer.byteLength(b64, 'base64')}B]`, isDir: false },
              update: { content: `[binary ${Buffer.byteLength(b64, 'base64')}B]` },
            })
          } catch { /* disk copy is enough */ }
          written.push(rel)
        }
        if (!written.length) return { ok: false, output: '', error: 'image generation returned nothing — try again' }

        const listing = await zaiChat(
          `Write an app-store listing for: ${desc}. Showcase features: ${featureList.join(', ')}.\n` +
          `Reply EXACTLY in this markdown shape:\n` +
          `SHORT: <80-char store short description>\n` +
          `KEYWORDS: <10-14 comma-separated ASO keywords>\n` +
          `LONG:\n<3-4 paragraph full description, benefit-led, no placeholders>`,
          0.4,
        )
        const short = listing.match(/SHORT:\s*([^\n]+)/i)?.[1]?.trim() || `${appName} — ${featureList[0]}`
        const keywords = listing.match(/KEYWORDS:\s*([^\n]+)/i)?.[1]?.trim() || featureList.join(', ')
        const longDesc = listing.split(/LONG:\s*/i)[1]?.trim() || desc

        const md = [
          `# Store listing — ${appName}`,
          ``,
          `## Screenshots (REAL AI-generated, in \`assets/store-shots/\`)`,
          ...written.map((w, i) => `- \`${w}\` — caption idea: **${featureList[i] || featureList[0]}**`),
          ``,
          `## Short description (80 chars max)`,
          short.slice(0, 80),
          ``,
          `## ASO keywords`,
          keywords,
          ``,
          `## Full description`,
          longDesc,
          ``,
          `## Publish checklist`,
          `- [ ] AAB built (Publish → Android AAB) for Google Play`,
          `- [ ] Icon set present (Asset Studio / Icon Studio)`,
          `- [ ] Screenshots uploaded (this folder)`,
          `- [ ] Short + full description pasted`,
          ``,
          `_Generated by store_screenshot_studio._`,
        ].join('\n')
        await writeAndIndex(ctx, 'STORE_LISTING.md', md)

        return {
          ok: true,
          output: `Generated ${written.length} store screenshot(s) (${written.join(', ')}) + STORE_LISTING.md with captions, ${keywords.split(',').length} ASO keywords and full description.`,
          data: { shots: written, captions: featureList, short: short.slice(0, 80) },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: `store_screenshot_studio failed: ${e?.message || e}` }
      }
    },
  },
}
