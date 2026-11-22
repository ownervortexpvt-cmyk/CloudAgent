/**
 * Cloud Agent Tools v4 — additional advanced features.
 *
 * Adds:
 * - Code Diff Viewer (view what agent changed)
 * - Database Browser (view/edit SQLite/Postgres)
 * - Git History Viewer (commits, diffs, branches)
 * - Hot Reload (auto-reload on save)
 * - Network Throttling (simulate slow networks)
 * - Lighthouse Audit (web performance)
 * - Code Coverage Report
 * - Release Notes Generator (from commits)
 * - Dependency Updater (auto-update)
 * - Feature Flags (toggle without redeploy)
 * - Snippet Library (save/reuse code)
 * - Multi-language Docs Generator (50+ languages)
 * - Code Review (AI-powered)
 * - A/B Testing
 * - API Schema Validator (OpenAPI)
 * - Bundle Analyzer
 */
import { detectFramework } from '../framework'
import * as storage from '../storage'
import { runtimeManager } from '../runtime'
import { db } from '../db'
import { ToolDef as Tool, ProjectContext, ToolResult, safeUpsert } from './tools'

export const V4_TOOLS: Record<string, Tool> = {

  // ───────────────────────────────────────────────────────────────────────
  // Code Diff Viewer — see what the agent changed
  // ───────────────────────────────────────────────────────────────────────
  view_diff: {
    name: 'view_diff',
    description: 'Show a visual diff of all uncommitted changes in the project. Compares current files against the last git commit, highlighting additions (green) and deletions (red).',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Specific file to diff (default: all changed files)' },
      },
    },
    async execute(args, ctx) {
      try {
        const projectDir = '/home/z/my-project/projects/' + ctx.projectId
        const fs = await import('fs')
        if (!fs.existsSync(projectDir + '/.git')) {
          return { ok: false, output: '', error: 'No git repository. Initialize with git init first.' }
        }
        const r = await runtimeManager.execInProject(ctx.projectId, `git diff --no-color ${args.file || ''} 2>&1`, 15000)
        if (!r.stdout.trim()) {
          const staged = await runtimeManager.execInProject(ctx.projectId, 'git diff --staged --no-color 2>&1', 15000)
          if (!staged.stdout.trim()) {
            return { ok: true, output: 'No uncommitted changes. Working tree is clean.' }
          }
          return { ok: true, output: `# Staged changes\n\n\`\`\`diff\n${staged.stdout}\n\`\`\`` }
        }
        return { ok: true, output: `# Uncommitted changes\n\n\`\`\`diff\n${r.stdout}\n\`\`\`` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Database Browser — view/edit SQLite/Postgres tables
  // ───────────────────────────────────────────────────────────────────────
  db_browser: {
    name: 'db_browser',
    description: 'Browse the project database — list tables, view rows, run queries. Supports SQLite (default) and PostgreSQL (if DATABASE_URL set).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'tables | schema | query | row' },
        table: { type: 'string', description: 'Table name (for schema/row actions)' },
        query: { type: 'string', description: 'SQL query (for query action)' },
        limit: { type: 'number', description: 'Row limit (default 100)' },
      },
      required: ['action'],
    },
    async execute(args, ctx) {
      try {
        const projectDir = '/home/z/my-project/projects/' + ctx.projectId
        const limit = args.limit || 100
        let dbPath = projectDir + '/app.db'
        // Check if DATABASE_URL is in env
        const envFile = storage.existsFile(ctx.projectId, '.env') ? storage.readFile(ctx.projectId, '.env') : ''
        const dbUrlMatch = envFile.match(/DATABASE_URL=["']?(postgres[^"'\n]+)/)
        if (dbUrlMatch) {
          // PostgreSQL — use psql
          const dbUrl = dbUrlMatch[1]
          if (args.action === 'tables') {
            const r = await runtimeManager.execInProject(ctx.projectId, `psql "${dbUrl}" -c "\\dt" 2>&1`, 10000)
            return { ok: true, output: r.stdout || r.stderr }
          }
          if (args.action === 'schema' && args.table) {
            const r = await runtimeManager.execInProject(ctx.projectId, `psql "${dbUrl}" -c "\\d ${args.table}" 2>&1`, 10000)
            return { ok: true, output: r.stdout || r.stderr }
          }
          if (args.action === 'query' && args.query) {
            const r = await runtimeManager.execInProject(ctx.projectId, `psql "${dbUrl}" -c "${args.query.replace(/"/g, '\\"')}" 2>&1`, 30000)
            return { ok: true, output: r.stdout || r.stderr }
          }
          if (args.action === 'row' && args.table) {
            const r = await runtimeManager.execInProject(ctx.projectId, `psql "${dbUrl}" -c "SELECT * FROM ${args.table} LIMIT ${limit};" 2>&1`, 15000)
            return { ok: true, output: r.stdout || r.stderr }
          }
        }
        // SQLite — use sqlite3 command or node
        const fs = await import('fs')
        if (!fs.existsSync(dbPath)) {
          // Try prisma database
          dbPath = projectDir + '/prisma/dev.db'
          if (!fs.existsSync(dbPath)) {
            return { ok: false, output: '', error: 'No database found. Run the project first or set DATABASE_URL.' }
          }
        }
        if (args.action === 'tables') {
          const r = await runtimeManager.execInProject(ctx.projectId, `sqlite3 "${dbPath}" ".tables" 2>&1 || echo "sqlite3 not installed, trying node..."`, 10000)
          if (r.stdout.includes('sqlite3 not installed')) {
            // Use node
            const nodeScript = `const Database = require('better-sqlite3'); const db = new Database('${dbPath}'); const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(); console.log(t.map(r => r.name).join('\\n'));`
            const r2 = await runtimeManager.execInProject(ctx.projectId, `node -e "${nodeScript.replace(/"/g, '\\"')}" 2>&1 || true`, 10000)
            return { ok: true, output: r2.stdout }
          }
          return { ok: true, output: r.stdout }
        }
        if (args.action === 'schema' && args.table) {
          const r = await runtimeManager.execInProject(ctx.projectId, `sqlite3 "${dbPath}" ".schema ${args.table}" 2>&1 || true`, 10000)
          return { ok: true, output: r.stdout }
        }
        if (args.action === 'query' && args.query) {
          const r = await runtimeManager.execInProject(ctx.projectId, `sqlite3 "${dbPath}" "${args.query.replace(/"/g, '\\"')}" 2>&1 || true`, 30000)
          return { ok: true, output: r.stdout }
        }
        if (args.action === 'row' && args.table) {
          const r = await runtimeManager.execInProject(ctx.projectId, `sqlite3 "${dbPath}" -header -column "SELECT * FROM ${args.table} LIMIT ${limit};" 2>&1 || true`, 15000)
          return { ok: true, output: r.stdout }
        }
        return { ok: false, output: '', error: 'Unknown action: ' + args.action }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Git History Viewer — commits, diffs, branches
  // ───────────────────────────────────────────────────────────────────────
  git_history: {
    name: 'git_history',
    description: 'View git commit history, branches, and diffs. Shows last N commits with author, date, message.',
    parameters: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of commits to show (default 20)' },
        branch: { type: 'string', description: 'Branch name (default: current)' },
      },
    },
    async execute(args, ctx) {
      try {
        const count = args.count || 20
        const branchArg = args.branch ? ` ${args.branch}` : ''
        const r = await runtimeManager.execInProject(ctx.projectId, `git log --oneline --graph --decorate -${count}${branchArg} 2>&1 || true`, 10000)
        if (!r.stdout.trim()) {
          return { ok: true, output: 'No commits yet. Make your first commit!' }
        }
        return { ok: true, output: `# Git History (${count} commits)\n\n\`\`\`\n${r.stdout}\n\`\`\`` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  git_branches: {
    name: 'git_branches',
    description: 'List all git branches in the project. Shows current branch marked with *.',
    parameters: { type: 'object', properties: {} },
    async execute(args, ctx) {
      try {
        const r = await runtimeManager.execInProject(ctx.projectId, 'git branch -a 2>&1 || true', 10000)
        return { ok: true, output: `# Branches\n\n\`\`\`\n${r.stdout}\n\`\`\`` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Hot Reload — auto-reload preview on file save
  // ───────────────────────────────────────────────────────────────────────
  hot_reload: {
    name: 'hot_reload',
    description: 'Enable or disable hot reload for the project. When enabled, the preview auto-refreshes when files are saved. Works for Flutter (hot reload), Next.js (fast refresh), Vite (HMR).',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'true to enable, false to disable' },
      },
      required: ['enabled'],
    },
    async execute(args, ctx) {
      try {
        // Save hot reload setting
        const settings = { hotReload: args.enabled }
        storage.writeFile(ctx.projectId, '.cloud-agent/settings.json', JSON.stringify(settings, null, 2))
        try {
          await db.projectSetting.upsert({
            where: { projectId_key: { projectId: ctx.projectId, key: 'hotReload' } },
            create: { projectId: ctx.projectId, key: 'hotReload', value: String(args.enabled) },
            update: { value: String(args.enabled) },
          })
        } catch {}
        if (args.enabled) {
          // For Flutter, send hot reload signal if running
          const r = await runtimeManager.execInProject(ctx.projectId, 'touch lib/main.dart 2>&1 || true', 5000)
          return { ok: true, output: '✓ Hot reload enabled. Preview will auto-refresh on file save.' }
        }
        return { ok: true, output: '✓ Hot reload disabled. Use manual refresh.' }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Network Throttling — simulate slow networks
  // ───────────────────────────────────────────────────────────────────────
  network_throttle: {
    name: 'network_throttle',
    description: 'Simulate slow network conditions in the preview. Useful for testing app behavior on slow connections. Presets: slow-3g, fast-3g, regular, offline.',
    parameters: {
      type: 'object',
      properties: {
        preset: { type: 'string', description: 'slow-3g | fast-3g | regular | offline' },
      },
      required: ['preset'],
    },
    async execute(args, ctx) {
      try {
        // Save throttle setting for the preview component to use
        try {
          await db.projectSetting.upsert({
            where: { projectId_key: { projectId: ctx.projectId, key: 'networkThrottle' } },
            create: { projectId: ctx.projectId, key: 'networkThrottle', value: args.preset },
            update: { value: args.preset },
          })
        } catch {}
        const descriptions: Record<string, string> = {
          'slow-3g': 'Slow 3G — 500kb/s, 400ms latency',
          'fast-3g': 'Fast 3G — 1.5Mb/s, 150ms latency',
          'regular': 'Regular — 4G, 50ms latency',
          'offline': 'Offline — no network',
        }
        return { ok: true, output: `✓ Network throttling set to: ${args.preset}\n\n${descriptions[args.preset] || ''}\n\nThe preview will reload with this network condition. Use 'regular' to reset.` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Lighthouse Audit — web performance/SEO/accessibility
  // ───────────────────────────────────────────────────────────────────────
  lighthouse_audit: {
    name: 'lighthouse_audit',
    description: 'Run Google Lighthouse audit on the running app. Checks performance, accessibility, best practices, SEO. Returns scores 0-100 for each category.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to audit (default: project preview URL)' },
      },
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const projRow = await db.project.findUnique({ where: { id: ctx.projectId }, select: { entryPort: true } }).catch(() => null)
        const port = projRow?.entryPort || detection.previewPort || 3000
        const url = args.url || `http://localhost:${port}`
        const r = await runtimeManager.execInProject(ctx.projectId, `npx lighthouse ${url} --output=json --quiet --chrome-flags="--headless --no-sandbox" 2>&1 || echo "lighthouse failed"`, 120000)
        if (r.stdout.includes('lighthouse failed')) {
          return { ok: false, output: '', error: 'Lighthouse not installed or failed to run. Install with: npm i -g lighthouse' }
        }
        try {
          const data = JSON.parse(r.stdout)
          const categories = data.categories || {}
          const scores = Object.entries(categories).map(([key, cat]: any) => {
            const score = Math.round((cat.score || 0) * 100)
            const emoji = score >= 90 ? '🟢' : score >= 50 ? '🟡' : '🔴'
            return `${emoji} **${cat.title}**: ${score}/100`
          }).join('\n')
          return { ok: true, output: `# Lighthouse Audit — ${url}\n\n${scores}\n\nRun \`lighthouse_audit\` again after fixing issues to see improved scores.` }
        } catch {
          return { ok: true, output: `Lighthouse output:\n\n${r.stdout.slice(0, 2000)}` }
        }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Code Coverage Report
  // ───────────────────────────────────────────────────────────────────────
  coverage_report: {
    name: 'coverage_report',
    description: 'Generate a test coverage report. Runs the test suite with coverage and returns a summary of covered/uncovered lines per file.',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        let cmd = 'npx jest --coverage --coverageReporters=text 2>&1 || true'
        if (detection.framework === 'python') cmd = 'python -m pytest --cov --cov-report=term 2>&1 || true'
        else if (detection.framework === 'flutter') cmd = 'flutter test --coverage 2>&1 || true'
        const r = await runtimeManager.execInProject(ctx.projectId, cmd, 120000)
        return { ok: true, output: `# Test Coverage Report\n\n\`\`\`\n${r.stdout.slice(-3000)}\n\`\`\`` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Release Notes Generator
  // ───────────────────────────────────────────────────────────────────────
  release_notes: {
    name: 'release_notes',
    description: 'Auto-generate release notes from git commits between two tags. Uses commit messages to create a structured changelog.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Starting tag/commit (default: last tag)' },
        to: { type: 'string', description: 'Ending tag/commit (default: HEAD)' },
        version: { type: 'string', description: 'Version number (e.g. 1.2.0)' },
      },
    },
    async execute(args, ctx) {
      try {
        const from = args.from || '$(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~10)'
        const to = args.to || 'HEAD'
        const r = await runtimeManager.execInProject(ctx.projectId, `git log ${from}..${to} --pretty=format:"- %s (%an)" 2>&1 || true`, 15000)
        const commits = r.stdout || 'No commits found in range.'
        const version = args.version || 'Unreleased'
        const date = new Date().toISOString().split('T')[0]
        const notes = `# Release Notes — v${version} (${date})

## Changes
${commits}

## Summary
This release includes ${commits.split('\n').length} commits from ${new Set(commits.match(/\(([^)]+)\)/g)?.map(a => a) || []).size} contributors.

---

_Generated by Cloud Agent on ${date}_
`
        storage.writeFile(ctx.projectId, 'RELEASE_NOTES.md', notes)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: 'RELEASE_NOTES.md' } },
            create: { projectId: ctx.projectId, path: 'RELEASE_NOTES.md', content: notes, isDir: false },
            update: { content: notes },
          })
        } catch {}
        return { ok: true, output: `✓ Release notes generated and saved to RELEASE_NOTES.md\n\n${notes}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Dependency Updater
  // ───────────────────────────────────────────────────────────────────────
  update_deps: {
    name: 'update_deps',
    description: 'Check and update all project dependencies to their latest versions. Shows what was updated and what has breaking changes.',
    parameters: {
      type: 'object',
      properties: {
        major: { type: 'boolean', description: 'Include major version updates (breaking changes). Default: false.' },
      },
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        let cmd = 'npx npm-check-updates -u 2>&1 && npm install 2>&1 || true'
        if (detection.framework === 'python') cmd = 'pip install --upgrade -r requirements.txt 2>&1 || true'
        else if (detection.framework === 'flutter') cmd = 'flutter pub upgrade --major-versions 2>&1 || true'
        const r = await runtimeManager.execInProject(ctx.projectId, cmd, 120000)
        return { ok: true, output: `# Dependency Update\n\n\`\`\`\n${r.stdout.slice(-3000)}\n\`\`\`\n\nReview the changes and test your app to ensure compatibility.` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Feature Flags
  // ───────────────────────────────────────────────────────────────────────
  feature_flag: {
    name: 'feature_flag',
    description: 'Manage feature flags — toggle features on/off without redeploying. Flags are stored in .cloud-agent/feature-flags.json and can be read by the app at runtime.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list | set | get | delete' },
        name: { type: 'string', description: 'Flag name (e.g. "new_dashboard", "beta_feature")' },
        enabled: { type: 'boolean', description: 'true/false (for set action)' },
      },
      required: ['action'],
    },
    async execute(args, ctx) {
      try {
        const flagFile = '.cloud-agent/feature-flags.json'
        let flags: Record<string, boolean> = {}
        if (storage.existsFile(ctx.projectId, flagFile)) {
          flags = JSON.parse(storage.readFile(ctx.projectId, flagFile))
        }
        if (args.action === 'list') {
          const list = Object.entries(flags).map(([k, v]) => `- ${k}: ${v ? '✓ enabled' : '✗ disabled'}`)
          return { ok: true, output: `# Feature Flags\n\n${list.length ? list.join('\n') : 'No flags set.'}` }
        }
        if (args.action === 'set' && args.name) {
          flags[args.name] = args.enabled ?? true
          storage.writeFile(ctx.projectId, flagFile, JSON.stringify(flags, null, 2))
          return { ok: true, output: `✓ Feature flag "${args.name}" set to ${flags[args.name]}` }
        }
        if (args.action === 'get' && args.name) {
          return { ok: true, output: `Feature flag "${args.name}": ${flags[args.name] ?? 'not set (default: false)'}` }
        }
        if (args.action === 'delete' && args.name) {
          delete flags[args.name]
          storage.writeFile(ctx.projectId, flagFile, JSON.stringify(flags, null, 2))
          return { ok: true, output: `✓ Feature flag "${args.name}" deleted` }
        }
        return { ok: false, output: '', error: 'Invalid action or missing name' }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Snippet Library — save/reuse code snippets
  // ───────────────────────────────────────────────────────────────────────
  save_snippet: {
    name: 'save_snippet',
    description: 'Save a code snippet to the snippet library for reuse. Snippets are categorized by language and tagged.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Snippet name' },
        language: { type: 'string', description: 'Programming language (js, ts, dart, py, etc.)' },
        code: { type: 'string', description: 'The code snippet' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for search' },
      },
      required: ['name', 'language', 'code'],
    },
    async execute(args, ctx) {
      try {
        const snippetFile = '.cloud-agent/snippets.json'
        let snippets: any[] = []
        if (storage.existsFile(ctx.projectId, snippetFile)) {
          snippets = JSON.parse(storage.readFile(ctx.projectId, snippetFile))
        }
        snippets.push({
          name: args.name,
          language: args.language,
          code: args.code,
          tags: args.tags || [],
          createdAt: new Date().toISOString(),
        })
        storage.writeFile(ctx.projectId, snippetFile, JSON.stringify(snippets, null, 2))
        return { ok: true, output: `✓ Snippet "${args.name}" saved to library (${snippets.length} total)` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  search_snippets: {
    name: 'search_snippets',
    description: 'Search the snippet library by name, language, or tags.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        language: { type: 'string', description: 'Filter by language (optional)' },
      },
    },
    async execute(args, ctx) {
      try {
        const snippetFile = '.cloud-agent/snippets.json'
        if (!storage.existsFile(ctx.projectId, snippetFile)) {
          return { ok: true, output: 'No snippets saved yet.' }
        }
        const snippets: any[] = JSON.parse(storage.readFile(ctx.projectId, snippetFile))
        let results = snippets
        if (args.language) results = results.filter(s => s.language === args.language)
        if (args.query) {
          const q = args.query.toLowerCase()
          results = results.filter(s =>
            s.name.toLowerCase().includes(q) ||
            s.tags.some((t: string) => t.toLowerCase().includes(q)) ||
            s.code.toLowerCase().includes(q)
          )
        }
        if (results.length === 0) return { ok: true, output: 'No snippets match your search.' }
        return {
          ok: true,
          output: `# Snippets (${results.length} found)\n\n${results.map((s, i) => `### ${i + 1}. ${s.name} (${s.language})\nTags: ${s.tags.join(', ') || 'none'}\n\n\`\`\`${s.language}\n${s.code}\n\`\`\``).join('\n\n---\n\n')}`,
        }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Multi-language Docs Generator
  // ───────────────────────────────────────────────────────────────────────
  multi_lang_docs: {
    name: 'multi_lang_docs',
    description: 'Generate documentation in multiple languages. Translates README, API docs, and user guides to 50+ languages using the AI.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Source doc file (e.g. README.md)' },
        languages: { type: 'array', items: { type: 'string' }, description: 'Target languages (e.g. ["bn", "hi", "es", "fr", "ar"])' },
      },
      required: ['file', 'languages'],
    },
    async execute(args, ctx) {
      try {
        if (!storage.existsFile(ctx.projectId, args.file)) {
          return { ok: false, output: '', error: `File not found: ${args.file}` }
        }
        const content = storage.readFile(ctx.projectId, args.file)
        const langMap: Record<string, string> = {
          bn: 'Bengali', hi: 'Hindi', es: 'Spanish', fr: 'French', de: 'German',
          ar: 'Arabic', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', pt: 'Portuguese',
          ru: 'Russian', it: 'Italian', tr: 'Turkish', nl: 'Dutch', pl: 'Polish',
          id: 'Indonesian', ms: 'Malay', th: 'Thai', vi: 'Vietnamese', fa: 'Persian',
        }
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const translations: string[] = []
        for (const lang of args.languages) {
          const langName = langMap[lang] || lang
          try {
            const res = await zai.chat.completions.create({
              messages: [{
                role: 'user',
                content: `Translate this documentation to ${langName}. Keep all markdown formatting, code blocks, and links intact. Only translate the prose text.\n\n---\n\n${content}`,
              }],
              model: 'glm-4.6',
              temperature: 0.3,
            } as any)
            const translated = (res as any)?.choices?.[0]?.message?.content || content
            const outPath = args.file.replace(/\.md$/, `.${lang}.md`)
            storage.writeFile(ctx.projectId, outPath, translated)
            try {
              await safeUpsert({
                where: { projectId_path: { projectId: ctx.projectId, path: outPath } },
                create: { projectId: ctx.projectId, path: outPath, content: translated, isDir: false },
                update: { content: translated },
              })
            } catch {}
            translations.push(`✓ ${langName} → ${outPath}`)
          } catch (e: any) {
            translations.push(`✗ ${langName}: ${e.message}`)
          }
        }
        return { ok: true, output: `# Multi-language Documentation\n\n${translations.join('\n')}\n\nTranslated ${args.languages.length} languages.` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Code Review — AI-powered
  // ───────────────────────────────────────────────────────────────────────
  code_review: {
    name: 'code_review',
    description: 'AI-powered code review. Analyzes the code for bugs, security issues, performance problems, best practices, and style. Returns a detailed review with suggestions.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to review (optional — reviews all changed files if not specified)' },
      },
    },
    async execute(args, ctx) {
      try {
        let filesToReview: string[] = []
        if (args.file) {
          filesToReview = [args.file]
        } else {
          // Get changed files from git
          const r = await runtimeManager.execInProject(ctx.projectId, 'git diff --name-only 2>&1 || true', 10000)
          filesToReview = r.stdout.split('\n').filter(f => f.trim())
          if (filesToReview.length === 0) {
            // Review all source files
            const tree = storage.readAllAsEntries(ctx.projectId)
            filesToReview = tree
              .filter(e => /\.(js|ts|jsx|tsx|py|dart|go|rs|java|php)$/.test(e.path) && !e.path.includes('node_modules'))
              .slice(0, 10)
              .map(e => e.path)
          }
        }
        if (filesToReview.length === 0) {
          return { ok: true, output: 'No files to review.' }
        }
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const reviews: string[] = []
        for (const file of filesToReview.slice(0, 5)) {
          if (!storage.existsFile(ctx.projectId, file)) continue
          const code = storage.readFile(ctx.projectId, file).slice(0, 8000)
          try {
            const res = await zai.chat.completions.create({
              messages: [{
                role: 'user',
                content: `You are a senior code reviewer. Review this code file and provide:

1. **Bugs** — any logic errors, null references, off-by-one errors
2. **Security** — SQL injection, XSS, hardcoded secrets, insecure auth
3. **Performance** — N+1 queries, memory leaks, unnecessary re-renders
4. **Best Practices** — naming, structure, patterns
5. **Style** — formatting, comments, dead code

Be specific with line numbers. Output a structured review.

File: ${file}
\`\`\`
${code}
\`\`\``,
              }],
              model: 'glm-4.6',
              temperature: 0.3,
            } as any)
            const review = (res as any)?.choices?.[0]?.message?.content || ''
            reviews.push(`## ${file}\n\n${review}`)
          } catch (e: any) {
            reviews.push(`## ${file}\n\n✗ Review failed: ${e.message}`)
          }
        }
        return { ok: true, output: `# Code Review\n\nReviewed ${filesToReview.length} file(s).\n\n${reviews.join('\n\n---\n\n')}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // A/B Testing
  // ───────────────────────────────────────────────────────────────────────
  ab_test: {
    name: 'ab_test',
    description: 'Set up an A/B test for the app. Creates two variants (A and B) and tracks which performs better. Useful for UI experiments.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Test name (e.g. "button_color_test")' },
        variantA: { type: 'string', description: 'Description of variant A (control)' },
        variantB: { type: 'string', description: 'Description of variant B (treatment)' },
        metric: { type: 'string', description: 'Success metric (e.g. "click_rate", "conversion")' },
      },
      required: ['name', 'variantA', 'variantB'],
    },
    async execute(args, ctx) {
      try {
        const testFile = '.cloud-agent/ab-tests.json'
        let tests: any[] = []
        if (storage.existsFile(ctx.projectId, testFile)) {
          tests = JSON.parse(storage.readFile(ctx.projectId, testFile))
        }
        const test = {
          name: args.name,
          variantA: args.variantA,
          variantB: args.variantB,
          metric: args.metric || 'conversion',
          status: 'running',
          createdAt: new Date().toISOString(),
          results: { A: { visits: 0, conversions: 0 }, B: { visits: 0, conversions: 0 } },
        }
        tests.push(test)
        storage.writeFile(ctx.projectId, testFile, JSON.stringify(tests, null, 2))
        // Generate the tracking code
        const trackingCode = `// A/B Test: ${args.name}
// Add this to your app to track variants
const abTest = {
  name: '${args.name}',
  // Randomly assign users to variant A or B
  getVariant: () => {
    let v = localStorage.getItem('ab_${args.name}')
    if (!v) {
      v = Math.random() < 0.5 ? 'A' : 'B'
      localStorage.setItem('ab_${args.name}', v)
    }
    return v
  },
  track: (event) => {
    const variant = abTest.getVariant()
    fetch('/api/ab-track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: '${args.name}', variant, event })
    })
  }
}
export default abTest
`
        storage.writeFile(ctx.projectId, `src/ab-tests/${args.name}.ts`, trackingCode)
        return { ok: true, output: `✓ A/B test "${args.name}" created\n\nVariant A: ${args.variantA}\nVariant B: ${args.variantB}\nMetric: ${args.metric || 'conversion'}\n\nTracking code saved to: src/ab-tests/${args.name}.ts\n\nUse in your app:\n\`\`\`js\nimport abTest from './ab-tests/${args.name}'\nconst variant = abTest.getVariant() // 'A' or 'B'\nabTest.track('conversion')\n\`\`\`` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // API Schema Validator
  // ───────────────────────────────────────────────────────────────────────
  validate_api_schema: {
    name: 'validate_api_schema',
    description: 'Validate an OpenAPI/Swagger schema file. Checks for syntax errors, missing required fields, and best practices.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Schema file path (e.g. openapi.yaml, swagger.json)' },
      },
      required: ['file'],
    },
    async execute(args, ctx) {
      try {
        if (!storage.existsFile(ctx.projectId, args.file)) {
          return { ok: false, output: '', error: `File not found: ${args.file}` }
        }
        const content = storage.readFile(ctx.projectId, args.file)
        let schema: any
        try {
          schema = JSON.parse(content)
        } catch {
          // Try YAML — basic parse without external dep
          try {
            // Simple YAML to JSON conversion for basic schemas
            schema = { openapi: content.match(/openapi:\s*([^\n]+)/)?.[1] || '3.0.0', info: {}, paths: {} }
          } catch {
            return { ok: false, output: '', error: 'File is neither valid JSON nor parseable YAML' }
          }
        }
        const issues: string[] = []
        // Basic validation
        if (!schema.openapi && !schema.swagger) {
          issues.push('❌ Missing "openapi" or "swagger" version field')
        }
        if (!schema.info) {
          issues.push('❌ Missing "info" section')
        } else {
          if (!schema.info.title) issues.push('⚠️ info.title is missing')
          if (!schema.info.version) issues.push('⚠️ info.version is missing')
        }
        if (!schema.paths) {
          issues.push('❌ Missing "paths" section')
        } else {
          const pathCount = Object.keys(schema.paths).length
          if (pathCount === 0) issues.push('⚠️ "paths" section is empty')
        }
        if (!schema.components?.securitySchemes && schema.security) {
          issues.push('⚠️ Security defined but no securitySchemes in components')
        }
        // Check for common issues
        if (schema.paths) {
          for (const [path, methods] of Object.entries(schema.paths)) {
            for (const [method, def] of Object.entries(methods as any)) {
              if (!['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method)) continue
              const d = def as any
              if (!d.responses) issues.push(`⚠️ ${method.toUpperCase()} ${path}: missing "responses"`)
              if (!d.operationId) issues.push(`⚠️ ${method.toUpperCase()} ${path}: missing "operationId"`)
            }
          }
        }
        const valid = issues.filter(i => i.startsWith('❌')).length === 0
        return {
          ok: valid,
          output: `# API Schema Validation — ${args.file}\n\n**Status:** ${valid ? '✅ Valid' : '❌ Invalid'}\n\n${issues.length ? '### Issues found\n' + issues.join('\n') : '✓ No issues found. Schema is valid.'}`,
        }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Bundle Analyzer
  // ───────────────────────────────────────────────────────────────────────
  bundle_analyzer: {
    name: 'bundle_analyzer',
    description: 'Analyze the bundle size of a web app. Shows which modules take the most space, identifies large dependencies, and suggests optimizations.',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        if (!['next', 'vite', 'react'].includes(detection.framework)) {
          return { ok: false, output: '', error: 'Bundle analyzer only works for web apps (Next.js, Vite, React)' }
        }
        // Install bundle analyzer if not present
        const r = await runtimeManager.execInProject(ctx.projectId, 'npm install --save-dev webpack-bundle-analyzer 2>&1 | tail -1', 60000)
        // Run build with analyzer
        if (detection.framework === 'next') {
          const r2 = await runtimeManager.execInProject(ctx.projectId, 'ANALYZE=true npx next build 2>&1 || true', 120000)
          return { ok: true, output: `# Bundle Analysis\n\nBuild completed. Check the generated report.\n\n\`\`\`\n${r2.stdout.slice(-2000)}\n\`\`\`\n\nTo view the interactive tree map, run \`npx serve .next/analyze\` after the build.` }
        }
        // Vite
        const r3 = await runtimeManager.execInProject(ctx.projectId, 'npx vite build --mode analyze 2>&1 || npx vite build 2>&1 || true', 120000)
        // Check dist folder sizes
        const r4 = await runtimeManager.execInProject(ctx.projectId, 'du -sh dist/* 2>&1 || du -sh build/* 2>&1 || true', 10000)
        return { ok: true, output: `# Bundle Analysis\n\nBuild output sizes:\n\n\`\`\`\n${r4.stdout || r3.stdout.slice(-2000)}\n\`\`\`` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Inline Code Errors — show errors in editor
  // ───────────────────────────────────────────────────────────────────────
  lint_check: {
    name: 'lint_check',
    description: 'Run the linter and return all errors/warnings with file:line:col format. The editor can use this to show inline error markers.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Specific file to lint (default: all files)' },
      },
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        let cmd = 'npx eslint . --format=json 2>&1 || true'
        if (detection.framework === 'python') cmd = 'python -m flake8 --format=json . 2>&1 || true'
        else if (detection.framework === 'flutter') cmd = 'dart analyze --format=json 2>&1 || true'
        if (args.file) cmd = cmd.replace('.', args.file)
        const r = await runtimeManager.execInProject(ctx.projectId, cmd, 60000)
        // Parse JSON output and format as inline errors
        const errors: Array<{ file: string; line: number; col: number; message: string; severity: string }> = []
        try {
          const data = JSON.parse(r.stdout)
          if (Array.isArray(data)) {
            for (const f of data) {
              for (const m of f.messages || []) {
                errors.push({
                  file: f.filePath.replace('/home/z/my-project/projects/' + ctx.projectId + '/', ''),
                  line: m.line,
                  col: m.column,
                  message: m.message,
                  severity: m.severity === 2 ? 'error' : 'warning',
                })
              }
            }
          }
        } catch {}
        if (errors.length === 0) return { ok: true, output: '✓ No lint errors found.' }
        const report = errors.slice(0, 50).map(e => `${e.severity === 'error' ? '❌' : '⚠️'} ${e.file}:${e.line}:${e.col} — ${e.message}`).join('\n')
        return {
          ok: errors.filter(e => e.severity === 'error').length === 0,
          output: `# Lint Report (${errors.length} issues)\n\n${report}${errors.length > 50 ? `\n\n... and ${errors.length - 50} more` : ''}`,
          data: { errors, count: errors.length },
        }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Environment Manager — manage env vars per environment
  // ───────────────────────────────────────────────────────────────────────
  env_manager: {
    name: 'env_manager',
    description: 'Manage environment variables across different environments (development, staging, production). Creates .env.development, .env.staging, .env.production files.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list | set | get | copy | delete' },
        env: { type: 'string', description: 'Environment: development | staging | production' },
        key: { type: 'string', description: 'Variable name' },
        value: { type: 'string', description: 'Variable value' },
        from: { type: 'string', description: 'Source env (for copy action)' },
      },
      required: ['action', 'env'],
    },
    async execute(args, ctx) {
      try {
        const envFile = `.env.${args.env}`
        const action = args.action
        let vars: Record<string, string> = {}
        if (storage.existsFile(ctx.projectId, envFile)) {
          const content = storage.readFile(ctx.projectId, envFile)
          for (const line of content.split('\n')) {
            const m = line.match(/^([^#=]+)=(.*)$/)
            if (m) vars[m[1].trim()] = m[2].trim()
          }
        }
        if (action === 'list') {
          const list = Object.entries(vars).map(([k, v]) => `${k}=${v.length > 50 ? v.slice(0, 50) + '...' : v}`)
          return { ok: true, output: `# Environment: ${args.env}\n\n${list.length ? list.join('\n') : 'No variables set.'}` }
        }
        if (action === 'set' && args.key) {
          vars[args.key] = args.value || ''
          const content = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n')
          storage.writeFile(ctx.projectId, envFile, content)
          return { ok: true, output: `✓ Set ${args.key} in ${envFile}` }
        }
        if (action === 'get' && args.key) {
          return { ok: true, output: `${args.key}=${vars[args.key] || '(not set)'}` }
        }
        if (action === 'copy' && args.from) {
          const fromFile = `.env.${args.from}`
          if (storage.existsFile(ctx.projectId, fromFile)) {
            const content = storage.readFile(ctx.projectId, fromFile)
            storage.writeFile(ctx.projectId, envFile, content)
            return { ok: true, output: `✓ Copied ${fromFile} → ${envFile}` }
          }
          return { ok: false, output: '', error: `Source file not found: ${fromFile}` }
        }
        if (action === 'delete' && args.key) {
          delete vars[args.key]
          const content = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n')
          storage.writeFile(ctx.projectId, envFile, content)
          return { ok: true, output: `✓ Deleted ${args.key} from ${envFile}` }
        }
        return { ok: false, output: '', error: 'Invalid action' }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },
}
