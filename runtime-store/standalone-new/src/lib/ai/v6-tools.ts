/**
 * Cloud Agent Tools v6 — Ultra High-Level Text Generation Engine.
 *
 * This is the "text generation next ultra high level" engine — 20+ AI-powered
 * generators that create code, configs, docs, and explanations from natural
 * language descriptions.
 *
 * Categories:
 * - Ultra Code Generation (multi-style: clean/enterprise/startup/minimal)
 * - Code Style Transfer
 * - Smart Completion
 * - Code Explanation
 * - Auto Documentation
 * - Commit/PR Message Generator
 * - Code Translation (JS↔Py↔Dart↔Go↔Rust)
 * - Regex/SQL/CSS Generator
 * - Regex Tester
 * - Error Explainer
 * - Log Analyzer
 * - Config Generator (Docker, Nginx, CI/CD, Env)
 * - Migration Script Generator
 */
import { detectFramework } from '../framework'
import * as storage from '../storage'
import { runtimeManager } from '../runtime'
import { db } from '../db'
import { ToolDef as Tool, ProjectContext, ToolResult, safeUpsert } from './tools'

// ─── Shared AI call helper ─────────────────────────────────────────────────
async function callAI(prompt: string, temperature = 0.3, maxTokens = 8000): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
  const zai = await ZAI.create()
  const res = await zai.chat.completions.create({
    messages: [{ role: 'user', content: prompt }],
    model: 'glm-4.6',
    temperature,
    max_tokens: maxTokens,
  } as any)
  return ((res as any)?.choices?.[0]?.message?.content || '').replace(/```(?:[a-z]*\n?)?/g, '').replace(/```$/g, '')
}

export const V6_TOOLS: Record<string, Tool> = {

  // ═══════════════════════════════════════════════════════════════════════
  // ULTRA CODE GENERATION ENGINE
  // ═══════════════════════════════════════════════════════════════════════

  ultra_generate: {
    name: 'ultra_generate',
    description: 'ULTRA code generation engine. Generates complete, production-ready code in 4 styles: clean (minimal), enterprise (full patterns), startup (fast MVP), production (optimized). Best for "build X" requests with quality requirements.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What to build (e.g. "user authentication with JWT, refresh tokens, role-based access")' },
        style: { type: 'string', description: 'clean | enterprise | startup | production (default: production)' },
        language: { type: 'string', description: 'js | ts | py | dart | go | rs | php (default: auto-detect)' },
        includeTests: { type: 'boolean', description: 'Also generate tests (default: false)' },
        includeDocs: { type: 'boolean', description: 'Also generate documentation (default: false)' },
      },
      required: ['description'],
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const style = args.style || 'production'
        const lang = args.language || detection.language || 'ts'
        const stylePrompts: Record<string, string> = {
          clean: 'Write CLEAN, MINIMAL code. No unnecessary abstractions. Simple, readable, well-named. Like a senior dev would write for a small team.',
          enterprise: 'Write ENTERPRISE code. Full design patterns (Repository, Factory, Strategy). Dependency injection. Interfaces. SOLID principles. Logging. Metrics. Configuration management. Error boundaries. Like Fortune 500 codebase.',
          startup: 'Write STARTUP code. Fast MVP. Pragmatic. Skip abstractions. Use libraries instead of building. Get it working NOW. Like a YC startup rushing to launch.',
          production: 'Write PRODUCTION code. Clean + tested + documented. Error handling. Logging. Metrics. Performance optimized. Security hardened. Like a Series B company.',
        }
        let prompt = `You are an ULTRA code generator. ${stylePrompts[style]}

Generate COMPLETE code for: ${args.description}

Language: ${lang}
Framework: ${detection.framework}

Requirements:
- Complete file content (no placeholders, no "...")
- Include all imports
- Include error handling
- Include types (if TS/Python)
- Follow ${style} style
- Include JSDoc/docstring comments for public APIs

Output ONLY the code, no explanation.`
        if (args.includeTests) prompt += '\n\nAlso generate comprehensive tests after the main code, separated by "// --- TESTS ---".'
        if (args.includeDocs) prompt += '\n\nAlso generate documentation after the code, separated by "--- DOCS ---".'

        const code = await callAI(prompt, 0.3, 16000)
        // Split into main code, tests, docs
        const parts = code.split(/\/\/ --- TESTS ---|--- DOCS ---/)
        const mainCode = parts[0].trim()
        const tests = args.includeTests && parts[1] ? parts[1].trim() : null
        const docs = args.includeDocs && (parts[2] || parts[1]) ? (parts[2] || parts[1]).trim() : null

        // Determine output file
        const ext = lang === 'py' ? 'py' : lang === 'dart' ? 'dart' : lang === 'go' ? 'go' : lang === 'rs' ? 'rs' : 'tsx'
        const fileName = `generated-${Date.now()}.${ext}`
        storage.writeFile(ctx.projectId, fileName, mainCode)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: fileName } },
            create: { projectId: ctx.projectId, path: fileName, content: mainCode, isDir: false },
            update: { content: mainCode },
          })
        } catch {}

        let output = `✓ ULTRA code generated (${style} style)\n\nFile: ${fileName}\nLanguage: ${lang}\nLines: ${mainCode.split('\n').length}\nChars: ${mainCode.length}\n`

        if (tests) {
          const testFile = fileName.replace(`.${ext}`, `.test.${ext}`)
          storage.writeFile(ctx.projectId, testFile, tests)
          try {
            await safeUpsert({
              where: { projectId_path: { projectId: ctx.projectId, path: testFile } },
              create: { projectId: ctx.projectId, path: testFile, content: tests, isDir: false },
              update: { content: tests },
            })
          } catch {}
          output += `\nTests: ${testFile} (${tests.split('\n').length} lines)\n`
        }
        if (docs) {
          const docsFile = fileName.replace(`.${ext}`, '.md')
          storage.writeFile(ctx.projectId, docsFile, docs)
          output += `\nDocs: ${docsFile}\n`
        }
        return { ok: true, output }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CODE STYLE TRANSFER
  // ═══════════════════════════════════════════════════════════════════════

  transfer_style: {
    name: 'transfer_style',
    description: 'Convert code from one style/pattern to another. E.g. class-based to functional, callback to async/await, imperative to declarative, OOP to functional.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to transform' },
        to: { type: 'string', description: 'Target style: functional | class-based | async | hooks | composition | reactive' },
      },
      required: ['file', 'to'],
    },
    async execute(args, ctx) {
      try {
        if (!storage.existsFile(ctx.projectId, args.file)) {
          return { ok: false, output: '', error: `File not found: ${args.file}` }
        }
        const code = storage.readFile(ctx.projectId, args.file).slice(0, 12000)
        const transformed = await callAI(`Transform this code to ${args.to} style. Keep the same functionality but change the pattern.

Original file: ${args.file}
Target style: ${args.to}

Output ONLY the transformed code, no explanation.

\`\`\`
${code}
\`\`\``, 0.3, 16000)
        storage.writeFile(ctx.projectId, args.file, transformed)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: args.file } },
            create: { projectId: ctx.projectId, path: args.file, content: transformed, isDir: false },
            update: { content: transformed },
          })
        } catch {}
        return { ok: true, output: `✓ Style transferred: ${args.file} → ${args.to} style\n\nOriginal: ${code.length} chars\nTransformed: ${transformed.length} chars` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SMART CODE COMPLETION
  // ═══════════════════════════════════════════════════════════════════════

  smart_complete: {
    name: 'smart_complete',
    description: 'AI-powered smart code completion. Given a partial function/class, generates the complete implementation. Better than basic autocomplete — understands context and intent.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File containing partial code' },
        cursorLine: { type: 'number', description: 'Line number where cursor is (1-based)' },
      },
      required: ['file'],
    },
    async execute(args, ctx) {
      try {
        if (!storage.existsFile(ctx.projectId, args.file)) {
          return { ok: false, output: '', error: `File not found: ${args.file}` }
        }
        const code = storage.readFile(ctx.projectId, args.file).slice(0, 8000)
        const lines = code.split('\n')
        const cursor = args.cursorLine || lines.length
        const before = lines.slice(0, cursor).join('\n')
        const after = lines.slice(cursor).join('\n')
        const completion = await callAI(`Complete this code. The cursor is at line ${cursor}. Generate the completion that should go at the cursor position.

Before cursor:
\`\`\`
${before.slice(-2000)}
\`\`\`

After cursor:
\`\`\`
${after.slice(0, 1000)}
\`\`\`

Generate ONLY the code that should be inserted at the cursor. No explanation.`, 0.2, 4000)
        return { ok: true, output: `# Smart Completion\n\nInsert at line ${cursor}:\n\n\`\`\`\n${completion}\n\`\`\`` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CODE EXPLANATION
  // ═══════════════════════════════════════════════════════════════════════

  explain_code: {
    name: 'explain_code',
    description: 'Explain code in plain language. Breaks down what the code does, step by step, with examples. Good for onboarding new developers.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to explain' },
        level: { type: 'string', description: 'beginner | intermediate | expert (default: intermediate)' },
      },
      required: ['file'],
    },
    async execute(args, ctx) {
      try {
        if (!storage.existsFile(ctx.projectId, args.file)) {
          return { ok: false, output: '', error: `File not found: ${args.file}` }
        }
        const code = storage.readFile(ctx.projectId, args.file).slice(0, 10000)
        const level = args.level || 'intermediate'
        const explanation = await callAI(`Explain this code in plain language at ${level} level.

Break down:
1. What the code does (high-level)
2. How it works (step by step)
3. Key concepts used
4. Potential issues
5. How to use it

Use examples where helpful.

File: ${args.file}
\`\`\`
${code}
\`\`\``, 0.4, 8000)
        return { ok: true, output: `# Code Explanation — ${args.file}\n\n${explanation}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // AUTO DOCUMENTATION
  // ═══════════════════════════════════════════════════════════════════════

  auto_document: {
    name: 'auto_document',
    description: 'Auto-generate documentation for a file. Creates JSDoc/PyDoc/DartDoc comments for all functions, classes, and modules. Updates the file in place.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to document' },
      },
      required: ['file'],
    },
    async execute(args, ctx) {
      try {
        if (!storage.existsFile(ctx.projectId, args.file)) {
          return { ok: false, output: '', error: `File not found: ${args.file}` }
        }
        const code = storage.readFile(ctx.projectId, args.file).slice(0, 12000)
        const documented = await callAI(`Add comprehensive documentation to this code. Use JSDoc for JS/TS, docstring for Python, /// for Dart.

For each function/class:
- Description
- @param with types
- @returns with type
- @throws if applicable
- @example if helpful

Keep the code exactly the same — only ADD comments. Output the complete documented file.

File: ${args.file}
\`\`\`
${code}
\`\`\``, 0.3, 16000)
        storage.writeFile(ctx.projectId, args.file, documented)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: args.file } },
            create: { projectId: ctx.projectId, path: args.file, content: documented, isDir: false },
            update: { content: documented },
          })
        } catch {}
        return { ok: true, output: `✓ Documentation added to ${args.file}\n\nOriginal: ${code.length} chars\nDocumented: ${documented.length} chars\nAdded: ${documented.length - code.length} chars of comments` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // COMMIT & PR MESSAGE GENERATOR
  // ═══════════════════════════════════════════════════════════════════════

  generate_commit_msg: {
    name: 'generate_commit_msg',
    description: 'Generate a conventional commit message from the current git diff. Follows conventional commits format: type(scope): description',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute(args, ctx) {
      try {
        const r = await runtimeManager.execInProject(ctx.projectId, 'git diff --staged 2>&1 || git diff 2>&1 || true', 10000)
        if (!r.stdout.trim()) return { ok: true, output: 'No changes to commit.' }
        const diff = r.stdout.slice(0, 5000)
        const msg = await callAI(`Generate a conventional commit message for this git diff.

Format: type(scope): description

Types: feat, fix, docs, style, refactor, perf, test, chore, build, ci

Output ONLY the commit message, nothing else.

Diff:
\`\`\`
${diff}
\`\`\``, 0.3, 500)
        return { ok: true, output: `# Generated Commit Message\n\n\`\`\`\n${msg.trim()}\n\`\`\`\n\nCopy and use: \`git commit -m "${msg.trim().replace(/"/g, '\\"')}"\`` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  generate_pr_desc: {
    name: 'generate_pr_desc',
    description: 'Generate a pull request description from commits. Creates a structured PR with summary, changes, testing, and checklist.',
    parameters: {
      type: 'object',
      properties: {
        base: { type: 'string', description: 'Base branch (default: main)' },
        head: { type: 'string', description: 'Head branch (default: current)' },
      },
    },
    async execute(args, ctx) {
      try {
        const base = args.base || 'main'
        const head = args.head || 'HEAD'
        const r = await runtimeManager.execInProject(ctx.projectId, `git log ${base}..${head} --oneline 2>&1 || git log --oneline -10 2>&1 || true`, 10000)
        const commits = r.stdout || 'No commits found.'
        const desc = await callAI(`Generate a pull request description from these commits.

Format:
## Summary
[1-2 sentence summary]

## Changes
- [bullet list of changes]

## Testing
- [how to test]

## Checklist
- [ ] Tests pass
- [ ] Code reviewed
- [ ] Documentation updated

Commits:
${commits}`, 0.4, 2000)
        return { ok: true, output: `# Pull Request Description\n\n${desc}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CODE TRANSLATION
  // ═══════════════════════════════════════════════════════════════════════

  translate_code: {
    name: 'translate_code',
    description: 'Translate code from one language to another. Supports JS↔TS↔Python↔Dart↔Go↔Rust↔PHP. Preserves functionality and adapts to target language idioms.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Source file' },
        to: { type: 'string', description: 'Target language: js | ts | py | dart | go | rs | php' },
      },
      required: ['file', 'to'],
    },
    async execute(args, ctx) {
      try {
        if (!storage.existsFile(ctx.projectId, args.file)) {
          return { ok: false, output: '', error: `File not found: ${args.file}` }
        }
        const code = storage.readFile(ctx.projectId, args.file).slice(0, 12000)
        const extMap: Record<string, string> = { js: 'js', ts: 'ts', py: 'py', dart: 'dart', go: 'go', rs: 'rs', php: 'php' }
        const targetExt = extMap[args.to] || 'txt'
        const translated = await callAI(`Translate this code to ${args.to}. 

Rules:
- Preserve functionality
- Use ${args.to} idioms and best practices
- Adapt types (TS interfaces → Python dataclasses, etc.)
- Use standard libraries where possible
- Include all necessary imports

Output ONLY the translated code.

Source:
\`\`\`
${code}
\`\`\``, 0.3, 16000)
        const outFile = args.file.replace(/\.[^.]+$/, `.${targetExt}`)
        storage.writeFile(ctx.projectId, outFile, translated)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: outFile } },
            create: { projectId: ctx.projectId, path: outFile, content: translated, isDir: false },
            update: { content: translated },
          })
        } catch {}
        return { ok: true, output: `✓ Code translated: ${args.file} → ${outFile}\n\nFrom: ${code.length} chars\nTo: ${translated.length} chars` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // REGEX GENERATOR
  // ═══════════════════════════════════════════════════════════════════════

  generate_regex: {
    name: 'generate_regex',
    description: 'Generate a regular expression from a natural language description. Includes explanation and test cases.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What the regex should match (e.g. "match email addresses")' },
        testCases: { type: 'array', items: { type: 'string' }, description: 'Sample strings to test (optional)' },
      },
      required: ['description'],
    },
    async execute(args, ctx) {
      try {
        const tests = args.testCases ? `\n\nTest cases:\n${args.testCases.map(t => `- "${t}"`).join('\n')}` : ''
        const result = await callAI(`Generate a regular expression for: ${args.description}${tests}

Output format:
REGEX: <the regex>
EXPLANATION: <how it works>
TESTS: <which test cases match/don't match>`, 0.3, 2000)
        return { ok: true, output: `# Regex Generator\n\n${result}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  test_regex: {
    name: 'test_regex',
    description: 'Test a regular expression against sample strings. Shows which strings match and capture groups.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern' },
        flags: { type: 'string', description: 'Regex flags (g, i, m, etc.)' },
        samples: { type: 'array', items: { type: 'string' }, description: 'Strings to test' },
      },
      required: ['pattern', 'samples'],
    },
    async execute(args, ctx) {
      try {
        const flags = args.flags || 'g'
        let regex: RegExp
        try { regex = new RegExp(args.pattern, flags) }
        catch (e: any) { return { ok: false, output: '', error: `Invalid regex: ${e.message}` } }
        const results = args.samples.map(s => {
          const matches = s.match(regex)
          return {
            string: s,
            matches: !!matches,
            groups: matches ? Array.from(matches) : null,
          }
        })
        const report = results.map(r => `${r.matches ? '✅' : '❌'} "${r.string}"${r.groups ? ` → matched: ${JSON.stringify(r.groups)}` : ''}`).join('\n')
        const matchCount = results.filter(r => r.matches).length
        return { ok: true, output: `# Regex Test\n\nPattern: /${args.pattern}/${flags}\nResults: ${matchCount}/${results.length} matched\n\n${report}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SQL GENERATOR
  // ═══════════════════════════════════════════════════════════════════════

  generate_sql: {
    name: 'generate_sql',
    description: 'Generate SQL query from a natural language description. Supports SELECT, INSERT, UPDATE, DELETE, JOIN, aggregation, window functions.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What the query should do (e.g. "get top 10 customers by total order amount")' },
        dialect: { type: 'string', description: 'postgres | mysql | sqlite | sqlserver (default: postgres)' },
        schema: { type: 'string', description: 'Table schema (optional, helps generate better queries)' },
      },
      required: ['description'],
    },
    async execute(args, ctx) {
      try {
        const schema = args.schema ? `\nSchema:\n${args.schema}\n` : ''
        const sql = await callAI(`Generate a ${args.dialect || 'postgres'} SQL query for: ${args.description}${schema}

Output ONLY the SQL query, formatted nicely. Add comments for complex parts.`, 0.3, 2000)
        return { ok: true, output: `# SQL Query\n\n\`\`\`sql\n${sql}\n\`\`\`` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CSS GENERATOR
  // ═══════════════════════════════════════════════════════════════════════

  generate_css: {
    name: 'generate_css',
    description: 'Generate CSS from a description. Supports plain CSS, Tailwind, SCSS, and styled-components. Includes responsive design and animations.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What the CSS should do (e.g. "card with hover effect, shadow, rounded corners, mobile responsive")' },
        type: { type: 'string', description: 'css | tailwind | scss | styled (default: css)' },
      },
      required: ['description'],
    },
    async execute(args, ctx) {
      try {
        const css = await callAI(`Generate ${args.type || 'css'} for: ${args.description}

Include:
- Responsive design (mobile-first)
- Hover/focus states
- Smooth transitions
- Modern best practices
- Accessibility (focus-visible)

Output ONLY the CSS code.`, 0.3, 4000)
        return { ok: true, output: `# Generated CSS\n\n\`\`\`css\n${css}\n\`\`\`` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ERROR EXPLAINER
  // ═══════════════════════════════════════════════════════════════════════

  explain_error: {
    name: 'explain_error',
    description: 'Explain an error message in plain language. Tells you what went wrong, why, and how to fix it. Supports all major languages.',
    parameters: {
      type: 'object',
      properties: {
        error: { type: 'string', description: 'The error message' },
        language: { type: 'string', description: 'Programming language (optional, helps with context)' },
      },
      required: ['error'],
    },
    async execute(args, ctx) {
      try {
        const lang = args.language ? ` (in ${args.language})` : ''
        const explanation = await callAI(`Explain this error${lang} in plain language:

1. **What went wrong** — simple explanation
2. **Why it happened** — root cause
3. **How to fix** — specific steps with code examples

Error:
\`\`\`
${args.error}
\`\`\``, 0.4, 3000)
        return { ok: true, output: `# Error Explanation\n\n${explanation}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // LOG ANALYZER
  // ═══════════════════════════════════════════════════════════════════════

  analyze_logs: {
    name: 'analyze_logs',
    description: 'Analyze application logs and find issues. Detects errors, warnings, patterns, anomalies, and trends. Summarizes what happened.',
    parameters: {
      type: 'object',
      properties: {
        logs: { type: 'string', description: 'Log content to analyze' },
        file: { type: 'string', description: 'Log file path (alternative to logs)' },
      },
    },
    async execute(args, ctx) {
      try {
        let logs = args.logs
        if (!logs && args.file) {
          if (storage.existsFile(ctx.projectId, args.file)) {
            logs = storage.readFile(ctx.projectId, args.file).slice(0, 20000)
          }
        }
        if (!logs) {
          // Get runtime logs
          logs = runtimeManager.getLogs(ctx.projectId).slice(-20000)
        }
        if (!logs || !logs.trim()) {
          return { ok: true, output: 'No logs to analyze.' }
        }
        const analysis = await callAI(`Analyze these application logs and provide:

1. **Summary** — what happened
2. **Errors** — list of errors with frequency
3. **Warnings** — list of warnings
4. **Patterns** — recurring issues
5. **Anomalies** — unexpected events
6. **Recommendations** — how to fix issues

Logs:
\`\`\`
${logs}
\`\`\``, 0.4, 4000)
        return { ok: true, output: `# Log Analysis\n\n${analysis}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIG GENERATORS
  // ═══════════════════════════════════════════════════════════════════════

  generate_dockerfile: {
    name: 'generate_dockerfile',
    description: 'Generate an optimized Dockerfile for the project. Supports Node, Python, Flutter, Go, Rust. Multi-stage builds, small images, security best practices.',
    parameters: {
      type: 'object',
      properties: {
        baseImage: { type: 'string', description: 'Base image (optional — auto-detected)' },
        port: { type: 'number', description: 'App port (default: 3000)' },
      },
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const port = args.port || 3000
        let dockerfile: string
        if (detection.framework === 'python') {
          dockerfile = `# Python Dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE ${port}
CMD ["python", "main.py"]
`
        } else if (detection.framework === 'flutter') {
          dockerfile = `# Flutter Web Dockerfile
FROM ghcr.io/cirruslabs/flutter:3.24.0 AS build
WORKDIR /app
COPY pubspec.* ./
RUN flutter pub get
COPY . .
RUN flutter build web --release

FROM nginx:alpine
COPY --from=build /app/build/web /usr/share/nginx/html
EXPOSE ${port}
CMD ["nginx", "-g", "daemon off;"]
`
        } else if (detection.framework === 'go') {
          dockerfile = `# Go Dockerfile (multi-stage)
FROM golang:1.22-alpine AS build
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o app .

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=build /app/app .
EXPOSE ${port}
CMD ["./app"]
`
        } else if (detection.framework === 'rust') {
          dockerfile = `# Rust Dockerfile (multi-stage)
FROM rust:1.75 AS build
WORKDIR /app
COPY Cargo.* ./
RUN cargo build --release
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/release/app .
EXPOSE ${port}
CMD ["./app"]
`
        } else {
          // Node
          dockerfile = `# Node Dockerfile (multi-stage)
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
EXPOSE ${port}
CMD ["node", "dist/index.js"]
`
        }
        storage.writeFile(ctx.projectId, 'Dockerfile', dockerfile)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: 'Dockerfile' } },
            create: { projectId: ctx.projectId, path: 'Dockerfile', content: dockerfile, isDir: false },
            update: { content: dockerfile },
          })
        } catch {}
        // Also generate .dockerignore
        const dockerignore = `node_modules
.next
.git
*.log
.env
.env.local
dist
build
.cache
`
        storage.writeFile(ctx.projectId, '.dockerignore', dockerignore)
        return { ok: true, output: `✓ Dockerfile generated for ${detection.framework}\n\nImage size optimized with multi-stage build.\nPort: ${port}\n\nBuild: \`docker build -t myapp .\`\nRun: \`docker run -p ${port}:${port} myapp\`` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  generate_cicd: {
    name: 'generate_cicd',
    description: 'Generate GitHub Actions CI/CD workflow. Supports test, build, deploy to Vercel/Netlify/AWS/Docker. Includes caching and parallel jobs.',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'deploy target: vercel | netlify | aws | docker | none (default: none, just test+build)' },
        branches: { type: 'array', items: { type: 'string' }, description: 'Branches to run on (default: ["main", "develop"])' },
      },
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const platform = args.platform || 'none'
        const branches = args.branches || ['main', 'develop']
        let installStep = 'npm ci'
        if (detection.framework === 'python') installStep = 'pip install -r requirements.txt'
        else if (detection.framework === 'flutter') installStep = 'flutter pub get'
        else if (detection.framework === 'go') installStep = 'go mod download'
        else if (detection.framework === 'rust') installStep = 'cargo build --release'

        let buildStep = 'npm run build'
        if (detection.framework === 'python') buildStep = 'python -m py_compile main.py'
        else if (detection.framework === 'flutter') buildStep = 'flutter build web'
        else if (detection.framework === 'go') buildStep = 'go build ./...'
        else if (detection.framework === 'rust') buildStep = 'cargo build --release'

        let testStep = 'npm test'
        if (detection.framework === 'python') testStep = 'pytest'
        else if (detection.framework === 'flutter') testStep = 'flutter test'
        else if (detection.framework === 'go') testStep = 'go test ./...'
        else if (detection.framework === 'rust') testStep = 'cargo test'

        let deployStep = ''
        if (platform === 'vercel') deployStep = `
  deploy:
    needs: [test, build]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: \${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: \${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: \${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'`
        else if (platform === 'netlify') deployStep = `
  deploy:
    needs: [test, build]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: nwtgck/actions-netlify@v2.0
        with:
          publish-dir: './dist'
          production-branch: main
        env:
          NETLIFY_AUTH_TOKEN: \${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: \${{ secrets.NETLIFY_SITE_ID }}`
        else if (platform === 'docker') deployStep = `
  deploy:
    needs: [test, build]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          username: \${{ secrets.DOCKER_USERNAME }}
          password: \${{ secrets.DOCKER_PASSWORD }}
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: myapp:\${{ github.sha }}`

        const workflow = `name: CI/CD

on:
  push:
    branches: [${branches.map(b => '"' + b + '"').join(', ')}]
  pull_request:
    branches: [${branches.map(b => '"' + b + '"').join(', ')}]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        if: contains('${detection.framework}', 'node') || contains('${detection.framework}', 'next') || contains('${detection.framework}', 'react')
        with:
          node-version: 20
          cache: 'npm'
      - run: ${installStep}
      - run: ${testStep}

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: ${installStep}
      - run: ${buildStep}
      - uses: actions/upload-artifact@v4
        with:
          name: build
          path: |
            dist
            build
            .next
${deployStep}
`
        const filePath = '.github/workflows/ci.yml'
        storage.writeFile(ctx.projectId, filePath, workflow)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: filePath } },
            create: { projectId: ctx.projectId, path: filePath, content: workflow, isDir: false },
            update: { content: workflow },
          })
        } catch {}
        return { ok: true, output: `✓ CI/CD workflow generated\n\nFile: ${filePath}\nPlatform: ${platform}\nBranches: ${branches.join(', ')}\n\nJobs: test → build${platform !== 'none' ? ' → deploy' : ''}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  generate_nginx: {
    name: 'generate_nginx',
    description: 'Generate nginx configuration for the app. Supports reverse proxy, SSL, caching, gzip, rate limiting, and load balancing.',
    parameters: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain name (e.g. myapp.com)' },
        port: { type: 'number', description: 'App port (default: 3000)' },
        ssl: { type: 'boolean', description: 'Enable SSL with Let\'s Encrypt (default: true)' },
      },
      required: ['domain'],
    },
    async execute(args, ctx) {
      try {
        const port = args.port || 3000
        const ssl = args.ssl !== false
        const conf = `# nginx configuration for ${args.domain}
server {
    listen 80;
    server_name ${args.domain} www.${args.domain};
    ${ssl ? `return 301 https://$host$request_uri;` : ''}

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
${ssl ? `
server {
    listen 443 ssl http2;
    server_name ${args.domain} www.${args.domain};

    # SSL
    ssl_certificate /etc/letsencrypt/live/${args.domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${args.domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';" always;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    location / {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static files caching
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        proxy_pass http://127.0.0.1:${port};
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}` : ''}`
        const filePath = 'nginx.conf'
        storage.writeFile(ctx.projectId, filePath, conf)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: filePath } },
            create: { projectId: ctx.projectId, path: filePath, content: conf, isDir: false },
            update: { content: conf },
          })
        } catch {}
        return { ok: true, output: `✓ nginx config generated\n\nDomain: ${args.domain}\nPort: ${port}\nSSL: ${ssl ? 'enabled (Let\\u0027s Encrypt)' : 'disabled'}\n\nFile: ${filePath}\n\nInstall: \`sudo cp nginx.conf /etc/nginx/sites-available/${args.domain}\`\nSSL: \`sudo certbot --nginx -d ${args.domain}\`` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  validate_env: {
    name: 'validate_env',
    description: 'Validate environment variables. Checks if all required vars are set, if values are valid (URLs, emails, keys), and if any are missing.',
    parameters: {
      type: 'object',
      properties: {
        required: { type: 'array', items: { type: 'string' }, description: 'Required env var names' },
      },
    },
    async execute(args, ctx) {
      try {
        const required: string[] = args.required || []
        // Load .env file
        let envVars: Record<string, string> = {}
        if (storage.existsFile(ctx.projectId, '.env')) {
          const content = storage.readFile(ctx.projectId, '.env')
          for (const line of content.split('\n')) {
            const m = line.match(/^([^#=]+)=(.*)$/)
            if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
          }
        }
        const issues: string[] = []
        const set: string[] = []
        const missing: string[] = []
        for (const key of required) {
          if (envVars[key]) {
            set.push(key)
            // Validate value format
            const value = envVars[key]
            if (key.includes('URL') && !/^https?:\/\//.test(value) && !value.startsWith('postgres')) {
              issues.push(`⚠️ ${key} should be a URL but is "${value.slice(0, 30)}..."`)
            }
            if (key.includes('EMAIL') && !/^[^@]+@[^@]+\.[^@]+$/.test(value)) {
              issues.push(`⚠️ ${key} should be an email but is "${value}"`)
            }
            if ((key.includes('KEY') || key.includes('SECRET') || key.includes('TOKEN')) && value.length < 10) {
              issues.push(`⚠️ ${key} seems too short (${value.length} chars)`)
            }
            if (value === '[PLACEHOLDER]' || value.startsWith('[get')) {
              issues.push(`⚠️ ${key} is still a placeholder — fill in the real value`)
            }
          } else {
            missing.push(key)
          }
        }
        let report = `# Environment Validation\n\n**Set:** ${set.length}/${required.length}\n**Missing:** ${missing.length}\n\n`
        if (missing.length > 0) report += `## ❌ Missing Variables\n${missing.map(k => `- ${k}`).join('\n')}\n\n`
        if (set.length > 0) report += `## ✅ Set Variables\n${set.map(k => `- ${k}`).join('\n')}\n\n`
        if (issues.length > 0) report += `## ⚠️ Issues\n${issues.join('\n')}\n\n`
        if (missing.length === 0 && issues.length === 0) report += `✓ All environment variables are valid!`
        return { ok: missing.length === 0, output: report }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  generate_migration: {
    name: 'generate_migration',
    description: 'Generate a database migration script. Supports adding/removing columns, creating tables, changing types, and data backfills.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What the migration does (e.g. "add email column to users table")' },
        type: { type: 'string', description: 'prisma | knex | sqlalchemy | django (default: prisma)' },
      },
      required: ['description'],
    },
    async execute(args, ctx) {
      try {
        const type = args.type || 'prisma'
        const migration = await callAI(`Generate a ${type} database migration for: ${args.description}

Include:
- Up migration (apply changes)
- Down migration (rollback)
- Data backfill if needed
- Index updates if needed

Output ONLY the migration code.`, 0.3, 4000)
        const ext = type === 'prisma' ? 'sql' : type === 'knex' ? 'js' : type === 'sqlalchemy' ? 'py' : 'py'
        const fileName = `migrations/${Date.now()}_${args.description.replace(/\s+/g, '_').slice(0, 50)}.${ext}`
        storage.writeFile(ctx.projectId, fileName, migration)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: fileName } },
            create: { projectId: ctx.projectId, path: fileName, content: migration, isDir: false },
            update: { content: migration },
          })
        } catch {}
        return { ok: true, output: `✓ Migration generated\n\nType: ${type}\nFile: ${fileName}\n\nRun with: ${type === 'prisma' ? 'npx prisma migrate dev' : type === 'knex' ? 'npx knex migrate:latest' : 'your migration command'}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ULTRA TEXT GENERATION (non-code)
  // ═══════════════════════════════════════════════════════════════════════

  generate_app_name: {
    name: 'generate_app_name',
    description: 'Generate creative app names from a description. Provides 10+ name ideas with domain availability check suggestions.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What the app does' },
      },
      required: ['description'],
    },
    async execute(args, ctx) {
      try {
        const names = await callAI(`Generate 15 creative app names for: ${args.description}

Categories:
1. **Short & punchy** (1-2 syllables, like "Vercel", "Notion")
2. **Descriptive** (clear, like "CloudAgent")
3. **Made-up words** (unique, like "Google")
4. **Compound** (two words, like "Facebook")
5. **Brandable** (memorable, like "Slack")

For each name:
- Name
- Why it works
- Domain suggestion (.com / .io / .app)

Output as a markdown list.`, 0.7, 3000)
        return { ok: true, output: `# App Name Ideas\n\n${names}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  generate_tagline: {
    name: 'generate_tagline',
    description: 'Generate catchy taglines and slogans for an app. Provides 10+ options in different tones (professional, playful, bold, minimalist).',
    parameters: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'App name' },
        description: { type: 'string', description: 'What the app does' },
      },
      required: ['appName', 'description'],
    },
    async execute(args, ctx) {
      try {
        const taglines = await callAI(`Generate 15 taglines for ${args.appName} — ${args.description}.

Tones:
1. **Professional** — corporate, trustworthy
2. **Playful** — fun, friendly
3. **Bold** — confident, ambitious
4. **Minimalist** — simple, elegant
5. **Technical** — for developers

Each tagline: 3-7 words.

Output as a categorized list.`, 0.7, 2000)
        return { ok: true, output: `# Taglines for ${args.appName}\n\n${taglines}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  generate_landing_copy: {
    name: 'generate_landing_copy',
    description: 'Generate complete landing page copy. Includes hero, features, benefits, testimonials, pricing, FAQ, CTA. Ready to paste into a landing page.',
    parameters: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'App name' },
        description: { type: 'string', description: 'What the app does' },
        audience: { type: 'string', description: 'Target audience (e.g. "developers", "small businesses")' },
      },
      required: ['appName', 'description'],
    },
    async execute(args, ctx) {
      try {
        const copy = await callAI(`Generate complete landing page copy for ${args.appName}.

Description: ${args.description}
Target audience: ${args.audience || 'general users'}

Generate:
1. **Hero section** — headline, subheadline, CTA
2. **Features** — 3-5 key features with descriptions
3. **Benefits** — why users should use it
4. **Social proof** — testimonials (3 fake but realistic)
5. **Pricing** — 3 tiers (Free, Pro, Enterprise)
6. **FAQ** — 5 common questions
7. **Footer CTA** — final call to action

Output as markdown with clear section headers.`, 0.5, 6000)
        storage.writeFile(ctx.projectId, 'LANDING_COPY.md', copy)
        return { ok: true, output: `# Landing Page Copy\n\nSaved to LANDING_COPY.md\n\n---\n\n${copy}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },
}
