/**
 * Cloud Agent Tools v26 — WORKSHOP PACK (quality & reach).
 *
 * Four NEW real tools (all additive, nothing removed):
 *   ai_code_review   LLM reviews the project's source files → CODE_REVIEW.md
 *   i18n_builder     AI-translated locales/<lang>.json + drop-in i18n.js helper
 *   theme_studio     AI design-token stylesheet (assets/theme.css) + auto-link
 *   a11y_audit       deterministic accessibility scan (+ LLM fix plan) → A11Y_REPORT.md
 */
import * as storage from '../storage'
import { safeUpsert, type ToolResult, type ProjectContext } from './tools'

const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|mp3|mp4|zip|pdf|db)$/i
const SKIP_DIR = /node_modules|\.next|\.git|build\/|dist\/|\.dart_tool|__pycache__/

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

async function zaiChat(prompt: string, temperature = 0.4): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
  const zai = await ZAI.create()
  const res = await (zai as any).chat.completions.create({
    model: 'glm-4.6',
    temperature,
    messages: [{ role: 'user', content: prompt }],
  } as any)
  return res?.choices?.[0]?.message?.content || ''
}

/** Collect a bounded, text-only sample of the project for LLM context. */
function collectSource(ctx: ProjectContext, maxFiles = 8, maxCharsEach = 6000, maxTotal = 38000): { path: string; content: string }[] {
  const entries = storage.readAllAsEntries(ctx.projectId)
    .filter(e => !SKIP_DIR.test(e.path) && !SKIP_EXT.test(e.path) && /\.(js|jsx|ts|tsx|dart|py|go|rs|java|kt|php|rb|css|html|vue|svelte)$/i.test(e.path))
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

export const V26_TOOLS: any = {
  /* ── AI code review ───────────────────────────────────────────────────── */
  ai_code_review: {
    name: 'ai_code_review',
    description: 'AI senior-engineer review of the project source: bugs, security holes, performance issues and concrete fixes — written to CODE_REVIEW.md. Run after writing a meaningful chunk of code.',
    parameters: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'Optional focus, e.g. "security", "performance", "flutter best practices"' },
      },
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      try {
        const files = collectSource(ctx)
        if (!files.length) return { ok: false, output: '', error: 'No reviewable source files found (js/ts/dart/py/html/css…). Write some code first.' }
        const context = files.map(f => `----- ${f.path} -----\n${f.content}`).join('\n\n')
        const text = await zaiChat(
          `You are a senior engineer doing a rigorous code review. Review these project files and produce markdown with sections: ## Summary (3-5 sentences), ## Critical issues (numbered, each with file, why it breaks, exact fix), ## Security, ## Performance, ## Quick wins (bullets). Reference real symbols/lines from the code — no generic advice, no praise.\n\nFocus: ${args.focus || 'general quality, bugs and security'}\n\n${context}`,
        )
        if (!text.trim()) return { ok: false, output: '', error: 'Model returned an empty review — try again.' }
        await writeAndIndex(ctx, 'CODE_REVIEW.md', `# Code review\n\n${text.trim()}\n`)
        return { ok: true, output: `Code review complete → CODE_REVIEW.md (${files.length} files reviewed: ${files.map(f => f.path).join(', ')}).`, data: { files: files.map(f => f.path) } }
      } catch (e: any) {
        return { ok: false, output: '', error: `Code review failed: ${e?.message || e}` }
      }
    },
  },

  /* ── i18n builder ─────────────────────────────────────────────────────── */
  i18n_builder: {
    name: 'i18n_builder',
    description: 'Make the app multilingual: generates locales/en.json + AI-translated locales for each requested language, plus a drop-in js/i18n.js helper (load, t(key), switch language). Static web apps get auto-wired instructions.',
    parameters: {
      type: 'object',
      properties: {
        languages: { type: 'array', items: { type: 'string' }, description: 'Language codes, first = source. e.g. ["en","bn","hi","ar"]' },
        keys: { type: 'array', items: { type: 'string' }, description: 'UI strings in English, e.g. ["Welcome","Settings","Save changes"] (default: sensible starter set)' },
      },
      required: ['languages'],
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      try {
        const langs = (Array.isArray(args.languages) ? args.languages : []).map((l: unknown) => String(l).toLowerCase().replace(/[^a-z_-]/g, '')).filter(Boolean).slice(0, 8)
        if (langs.length < 2) return { ok: false, output: '', error: 'Provide at least 2 language codes, e.g. ["en","bn"].' }
        const source = langs[0]
        const keys = (Array.isArray(args.keys) && args.keys.length ? args.keys : ['Welcome', 'Get started', 'Settings', 'Save', 'Cancel', 'Search', 'Loading…', 'Error — please try again']).map((k: unknown) => String(k).slice(0, 80)).slice(0, 60)
        const translations: Record<string, Record<string, string>> = { [source]: Object.fromEntries(keys.map(k => [k, k])) }
        for (const lang of langs.slice(1)) {
          const text = await zaiChat(
            `Translate these UI strings to language code "${lang}". Respond with STRICT JSON only: an object mapping each EXACT source string to its natural, UI-appropriate translation (keep placeholders, keep it short). Strings: ${JSON.stringify(keys)}`,
            0.3,
          )
          const jsonText = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
          const parsed = JSON.parse(jsonText)
          translations[lang] = Object.fromEntries(keys.map(k => [k, typeof parsed[k] === 'string' && parsed[k] ? parsed[k] : k]))
        }
        const written: string[] = []
        for (const lang of langs) {
          const rel = `locales/${lang}.json`
          await writeAndIndex(ctx, rel, JSON.stringify(translations[lang], null, 2))
          written.push(rel)
        }
        const helper = [
          '/* Drop-in i18n helper generated by Cloud Agent.',
          ' * Usage:',
          ' *   <script src="js/i18n.js"></script>',
          ' *   await I18N.init("en");            // loads locales/en.json',
          ' *   I18N.t("Welcome");                // translated string',
          ' *   await I18N.setLanguage("bn");     // switch live',
          ' *   I18N.language;                    // current code',
          ' */',
          '(function (global) {',
          '  var dict = {}; var lang = "en"; var cache = {};',
          '  async function load(l) {',
          '    if (cache[l]) { dict = cache[l]; lang = l; return; }',
          '    var res = await fetch("locales/" + l + ".json");',
          '    if (!res.ok) throw new Error("Missing locale file: locales/" + l + ".json");',
          '    dict = await res.json(); cache[l] = dict; lang = l;',
          '  }',
          '  function t(key) { return dict[key] != null ? dict[key] : key; }',
          '  global.I18N = { init: load, setLanguage: load, t: t, get language() { return lang; } };',
          '})(window);',
          '',
        ].join('\n')
        await writeAndIndex(ctx, 'js/i18n.js', helper)
        written.push('js/i18n.js')
        return { ok: true, output: `i18n ready → ${written.join(', ')} (${keys.length} strings × ${langs.length} languages). Wire-up: <script src="js/i18n.js"></script>, then I18N.init("${source}") and I18N.t("Welcome").`, data: { languages: langs, strings: keys.length } }
      } catch (e: any) {
        return { ok: false, output: '', error: `i18n build failed: ${e?.message || e}` }
      }
    },
  },

  /* ── Theme studio ─────────────────────────────────────────────────────── */
  theme_studio: {
    name: 'theme_studio',
    description: 'Generate a complete design-token stylesheet (CSS variables: colors, fonts, radii, shadows, dark mode) from a style description, saved to assets/theme.css and auto-linked from index.html when present.',
    parameters: {
      type: 'object',
      properties: {
        style: { type: 'string', description: 'Style direction, e.g. "dark premium fintech, deep navy + gold, rounded"' },
        brand: { type: 'string', description: 'Brand/app name to honour, optional' },
      },
      required: ['style'],
    },
    async execute(args: any, ctx: ProjectContext): Promise<ToolResult> {
      try {
        const css = await zaiChat(
          `You are a design systems engineer. Produce a COMPLETE design-token stylesheet as raw CSS (no markdown fences, no commentary) for: style="${args.style}"${args.brand ? `, brand="${args.brand}"` : ''}.\n\nRequired shape:\n:root { --color-bg; --color-surface; --color-primary; --color-primary-contrast; --color-accent; --color-text; --color-muted; --color-border; --color-success; --color-warning; --color-danger; --font-heading; --font-body; --font-mono; --radius-sm; --radius-md; --radius-lg; --shadow-sm; --shadow-md; --shadow-lg; --space-1..--space-8; } \n[data-theme="dark"] { overrides }\nbody { background: var(--color-bg); color: var(--color-text); font-family: var(--font-body); margin: 0; }\nh1,h2,h3 { font-family: var(--font-heading); }\n\nRules: web-safe/system font stacks only, WCAG-AA contrast, cohesive palette, values only — no placeholders like "your color".`,
          0.6,
        )
        const clean = css.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
        if (!clean.includes('--color-bg')) return { ok: false, output: '', error: 'Generated stylesheet looked invalid — try again with a more specific style description.' }
        await writeAndIndex(ctx, 'assets/theme.css', clean + '\n')
        let linked = 'assets/theme.css written'
        try {
          const idx = storage.readFile(ctx.projectId, 'index.html')
          if (!idx.includes('assets/theme.css')) {
            const updated = idx.replace(/<head([^>]*)>/i, `<head$1>\n  <link rel="stylesheet" href="assets/theme.css">`)
            if (updated !== idx) {
              await writeAndIndex(ctx, 'index.html', updated)
              linked = 'assets/theme.css written + <link> injected into index.html'
            }
          } else {
            linked = 'assets/theme.css refreshed (already linked in index.html)'
          }
        } catch { /* not a static web app — stylesheet alone is fine */ }
        return { ok: true, output: `Theme ready → ${linked}. Tokens: colors, typography, radii, shadows, spacing scale + dark mode ([data-theme="dark"]).`, data: { file: 'assets/theme.css' } }
      } catch (e: any) {
        return { ok: false, output: '', error: `Theme generation failed: ${e?.message || e}` }
      }
    },
  },

  /* ── Accessibility audit ──────────────────────────────────────────────── */
  a11y_audit: {
    name: 'a11y_audit',
    description: 'Accessibility audit of the project HTML: missing alt text, unlabeled inputs, missing lang/viewport/title, tab-indices, empty buttons/links, contrast-risky inline styles — with severity and exact fixes, written to A11Y_REPORT.md.',
    parameters: { type: 'object', properties: {} },
    async execute(_args: any, ctx: ProjectContext): Promise<ToolResult> {
      try {
        const entries = storage.readAllAsEntries(ctx.projectId).filter(e => /\.html?$/i.test(e.path) && !SKIP_DIR.test(e.path))
        if (!entries.length) return { ok: false, output: '', error: 'No HTML files found to audit.' }
        type F = { file: string; line: number; issue: string; howToFix: string }
        const findings: F[] = []
        for (const e of entries) {
          const lines = String(e.content || '').split('\n')
          const html = lines.join('\n')
          const push = (re: RegExp, issue: string, howToFix: string, skip: (l: string) => boolean = () => false) => {
            lines.forEach((l, i) => { if (re.test(l) && !skip(l)) findings.push({ file: e.path, line: i + 1, issue, howToFix }) })
          }
          if (!/<html[^>]*\slang=/i.test(html)) findings.push({ file: e.path, line: 1, issue: '<html> has no lang attribute', howToFix: 'Add lang="en" (or the app language) to <html>.' })
          if (!/<meta[^>]*name="viewport"/i.test(html)) findings.push({ file: e.path, line: 1, issue: 'No viewport meta tag', howToFix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' })
          push(/<img(?![^>]*\balt=)[^>]*>/i, '<img> without alt', 'Add alt="description" (or alt="" if purely decorative).')
          push(/<input(?![^>]*\b(aria-label|aria-labelledby)=)[^>]*>/i, '<input> without aria-label', 'Add aria-label="…" or a <label for=…> — check it is not inside a <label> first.', l => /type="(hidden|submit|button)"/i.test(l))
          push(/<button[^>]*>\s*<\/button>/i, 'Empty <button>', 'Buttons need visible text or aria-label.')
          push(/<a[^>]*href[^>]*>\s*<\/a>/i, 'Empty <a> link', 'Links need text or aria-label.')
          push(/tabindex=["']?[1-9]/i, 'Positive tabindex', 'Use 0 or -1 only — positive tabindex breaks natural order.')
          push(/<(a|button)[^>]*>\s*(<i[^>]*>|<span[^>]*><\/span>)\s*<\/\1>/i, 'Icon-only control may lack accessible name', 'Add aria-label to the control.')
          push(/style=["'][^"']*color:\s*#[a-f0-9]{3,6}[^"']*background(-color)?:\s*#[a-f0-9]{3,6}/i, 'Inline color+background pair', 'Contrast cannot be verified inline — move to a class and keep ≥4.5:1.')
          if (!/<title>[^<]{3,}<\/title>/i.test(html)) findings.push({ file: e.path, line: 1, issue: 'Missing or short <title>', howToFix: 'Add a descriptive <title> (screen readers + tabs rely on it).' })
        }
        let aiPlan = ''
        if (findings.length) {
          try {
            const sample = findings.slice(0, 25).map(f => `- ${f.file}:${f.line} ${f.issue}`).join('\n')
            aiPlan = await zaiChat(`These accessibility findings came from an automated audit of a web project. Write a concise ordered fix plan (5-8 bullets, most impactful first, concrete code snippets where useful). Findings:\n${sample}`, 0.4)
          } catch { /* plan is optional — deterministic findings are the core */ }
        }
        const byIssue: Record<string, number> = {}
        for (const f of findings) byIssue[f.issue] = (byIssue[f.issue] || 0) + 1
        const md = [
          '# Accessibility report',
          '',
          `Scanned ${entries.length} HTML file(s): ${entries.map(e => e.path).join(', ')}`,
          `Findings: ${findings.length} across ${Object.keys(byIssue).length} issue types.`,
          '',
          '## Summary by type',
          ...Object.entries(byIssue).map(([k, v]) => `- ${k}: ${v}×`),
          '',
          ...(aiPlan ? ['## Fix plan (AI)', '', aiPlan.trim(), ''] : []),
          '## All findings',
          ...findings.map(f => `- **${f.file}:${f.line}** — ${f.issue}. Fix: ${f.howToFix}`),
          '',
        ].join('\n')
        await writeAndIndex(ctx, 'A11Y_REPORT.md', md)
        return { ok: true, output: findings.length ? `Accessibility audit → A11Y_REPORT.md: ${findings.length} finding(s), top issue: "${Object.entries(byIssue).sort((a, b) => b[1] - a[1])[0][0]}". Fix them, then re-run the audit.` : 'Accessibility audit → A11Y_REPORT.md: no issues found — clean HTML!', data: { count: findings.length, byIssue } }
      } catch (e: any) {
        return { ok: false, output: '', error: `Accessibility audit failed: ${e?.message || e}` }
      }
    },
  },
}
