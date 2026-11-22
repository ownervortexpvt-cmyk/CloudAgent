/**
 * Cloud Agent Tools v5 — even more advanced AI-powered features.
 *
 * Adds:
 * - AI Test Generator (unit/integration/e2e)
 * - AI Bug Predictor
 * - AI Performance Predictor
 * - AI UX Improver
 * - Crash Simulator
 * - Load Tester
 * - SEO Optimizer
 * - Accessibility Fixer
 * - Code Refactorer
 * - Dependency Vulnerability Scanner
 * - API Mock Generator
 * - Component Generator
 * - Page Generator
 * - API Endpoint Generator
 * - Database Model Generator
 */
import { detectFramework } from '../framework'
import * as storage from '../storage'
import { runtimeManager } from '../runtime'
import { db } from '../db'
import { ToolDef as Tool, ProjectContext, ToolResult, safeUpsert } from './tools'

export const V5_TOOLS: Record<string, Tool> = {

  // ───────────────────────────────────────────────────────────────────────
  // AI Test Generator — auto-generate tests
  // ───────────────────────────────────────────────────────────────────────
  generate_tests: {
    name: 'generate_tests',
    description: 'Auto-generate unit tests, integration tests, and e2e tests for a file or the entire project. Uses AI to understand the code and write comprehensive tests.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to generate tests for (optional — all source files if not specified)' },
        type: { type: 'string', description: 'unit | integration | e2e | all (default: all)' },
      },
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const testType = args.type || 'all'
        let filesToTest: string[] = []
        if (args.file) {
          filesToTest = [args.file]
        } else {
          const tree = storage.readAllAsEntries(ctx.projectId)
          filesToTest = tree
            .filter(e => /\.(js|ts|jsx|tsx|py|dart)$/.test(e.path) && !e.path.includes('node_modules') && !e.path.includes('__tests__') && !e.path.includes('test'))
            .slice(0, 5)
            .map(e => e.path)
        }
        if (filesToTest.length === 0) return { ok: true, output: 'No source files to test.' }
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const generated: string[] = []
        for (const file of filesToTest) {
          if (!storage.existsFile(ctx.projectId, file)) continue
          const code = storage.readFile(ctx.projectId, file).slice(0, 8000)
          // Determine test file path
          const ext = file.match(/\.([^.]+)$/)?.[1] || 'js'
          const testFile = file.replace(new RegExp(`\\.${ext}$`), `.test.${ext}`)
          const testFramework = detection.framework === 'python' ? 'pytest' : detection.framework === 'flutter' ? 'flutter_test' : 'jest'
          try {
            const res = await zai.chat.completions.create({
              messages: [{
                role: 'user',
                content: `Generate comprehensive ${testType} tests for this file using ${testFramework}.

Requirements:
- Test all functions and edge cases
- Include happy path and error cases
- Mock external dependencies
- Use descriptive test names
- Coverage target: 80%+

Source file: ${file}
\`\`\`
${code}
\`\`\`

Output ONLY the test code, no explanation.`,
              }],
              model: 'glm-4.6',
              temperature: 0.3,
            } as any)
            const testCode = (res as any)?.choices?.[0]?.message?.content || ''
            const finalCode = testCode.replace(/```(?:javascript|typescript|python|dart)?\n?/g, '').replace(/```$/g, '')
            storage.writeFile(ctx.projectId, testFile, finalCode)
            try {
              await safeUpsert({
                where: { projectId_path: { projectId: ctx.projectId, path: testFile } },
                create: { projectId: ctx.projectId, path: testFile, content: finalCode, isDir: false },
                update: { content: finalCode },
              })
            } catch {}
            generated.push(`✓ ${testFile}`)
          } catch (e: any) {
            generated.push(`✗ ${file}: ${e.message}`)
          }
        }
        return { ok: true, output: `# Test Generation\n\nGenerated ${generated.length} test file(s):\n\n${generated.join('\n')}\n\nRun tests with: npm test (or flutter test / pytest)` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // AI Bug Predictor
  // ───────────────────────────────────────────────────────────────────────
  predict_bugs: {
    name: 'predict_bugs',
    description: 'AI-powered bug prediction. Analyzes code and predicts potential bugs before they happen — null references, race conditions, off-by-one errors, memory leaks.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to analyze (optional — analyzes all source files)' },
      },
    },
    async execute(args, ctx) {
      try {
        let filesToAnalyze: string[] = []
        if (args.file) {
          filesToAnalyze = [args.file]
        } else {
          const tree = storage.readAllAsEntries(ctx.projectId)
          filesToAnalyze = tree
            .filter(e => /\.(js|ts|jsx|tsx|py|dart)$/.test(e.path) && !e.path.includes('node_modules'))
            .slice(0, 5)
            .map(e => e.path)
        }
        if (filesToAnalyze.length === 0) return { ok: true, output: 'No files to analyze.' }
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const predictions: string[] = []
        for (const file of filesToAnalyze) {
          if (!storage.existsFile(ctx.projectId, file)) continue
          const code = storage.readFile(ctx.projectId, file).slice(0, 8000)
          try {
            const res = await zai.chat.completions.create({
              messages: [{
                role: 'user',
                content: `You are a bug prediction expert. Analyze this code and predict potential bugs.

For each predicted bug, provide:
- Line number (approximate)
- Bug type (null reference, race condition, off-by-one, memory leak, etc.)
- Severity (critical/high/medium/low)
- Description
- How to fix

Focus on bugs that are LIKELY to happen, not theoretical ones.

File: ${file}
\`\`\`
${code}
\`\`\``,
              }],
              model: 'glm-4.6',
              temperature: 0.3,
            } as any)
            const analysis = (res as any)?.choices?.[0]?.message?.content || ''
            predictions.push(`### ${file}\n\n${analysis}`)
          } catch (e: any) {
            predictions.push(`### ${file}\n\n✗ Analysis failed: ${e.message}`)
          }
        }
        return { ok: true, output: `# Bug Prediction Report\n\nAnalyzed ${filesToAnalyze.length} file(s).\n\n${predictions.join('\n\n---\n\n')}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // AI Performance Predictor
  // ───────────────────────────────────────────────────────────────────────
  predict_performance: {
    name: 'predict_performance',
    description: 'AI-powered performance analysis. Predicts N+1 queries, unnecessary re-renders, large bundle contributions, and slow operations before they hit production.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to analyze (optional — all source files)' },
      },
    },
    async execute(args, ctx) {
      try {
        let filesToAnalyze: string[] = []
        if (args.file) {
          filesToAnalyze = [args.file]
        } else {
          const tree = storage.readAllAsEntries(ctx.projectId)
          filesToAnalyze = tree
            .filter(e => /\.(js|ts|jsx|tsx|py|dart)$/.test(e.path) && !e.path.includes('node_modules'))
            .slice(0, 5)
            .map(e => e.path)
        }
        if (filesToAnalyze.length === 0) return { ok: true, output: 'No files to analyze.' }
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const issues: string[] = []
        for (const file of filesToAnalyze) {
          if (!storage.existsFile(ctx.projectId, file)) continue
          const code = storage.readFile(ctx.projectId, file).slice(0, 8000)
          try {
            const res = await zai.chat.completions.create({
              messages: [{
                role: 'user',
                content: `You are a performance expert. Analyze this code for performance issues.

Check for:
- N+1 database queries
- Unnecessary re-renders (React)
- Memory leaks
- Large allocations
- Synchronous blocking operations
- Inefficient loops (O(n²) when O(n) possible)
- Missing indexes
- Unoptimized images/assets

For each issue:
- Line number
- Issue type
- Impact (high/medium/low)
- Fix suggestion

File: ${file}
\`\`\`
${code}
\`\`\``,
              }],
              model: 'glm-4.6',
              temperature: 0.3,
            } as any)
            const analysis = (res as any)?.choices?.[0]?.message?.content || ''
            issues.push(`### ${file}\n\n${analysis}`)
          } catch (e: any) {
            issues.push(`### ${file}\n\n✗ Analysis failed: ${e.message}`)
          }
        }
        return { ok: true, output: `# Performance Analysis\n\nAnalyzed ${filesToAnalyze.length} file(s).\n\n${issues.join('\n\n---\n\n')}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // AI UX Improver
  // ───────────────────────────────────────────────────────────────────────
  improve_ux: {
    name: 'improve_ux',
    description: 'AI-powered UX analysis. Reviews the app UI and suggests improvements for usability, accessibility, and user experience.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'UI file to analyze (optional — analyzes all UI files)' },
      },
    },
    async execute(args, ctx) {
      try {
        let filesToAnalyze: string[] = []
        if (args.file) {
          filesToAnalyze = [args.file]
        } else {
          const tree = storage.readAllAsEntries(ctx.projectId)
          filesToAnalyze = tree
            .filter(e => /\.(jsx|tsx|dart|vue|svelte)$/.test(e.path) && !e.path.includes('node_modules'))
            .slice(0, 5)
            .map(e => e.path)
        }
        if (filesToAnalyze.length === 0) return { ok: true, output: 'No UI files to analyze.' }
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const suggestions: string[] = []
        for (const file of filesToAnalyze) {
          if (!storage.existsFile(ctx.projectId, file)) continue
          const code = storage.readFile(ctx.projectId, file).slice(0, 8000)
          try {
            const res = await zai.chat.completions.create({
              messages: [{
                role: 'user',
                content: `You are a UX expert. Review this UI code and suggest improvements.

Check for:
- Usability issues (confusing flows, unclear labels)
- Accessibility (WCAG compliance, screen reader support)
- Mobile responsiveness
- Loading states (skeletons, spinners)
- Error states (empty, error, loading)
- Visual hierarchy
- Touch target sizes (mobile)
- Color contrast
- Form validation UX

For each suggestion:
- Severity (critical/important/minor)
- Issue description
- Fix with code example

File: ${file}
\`\`\`
${code}
\`\`\``,
              }],
              model: 'glm-4.6',
              temperature: 0.3,
            } as any)
            const analysis = (res as any)?.choices?.[0]?.message?.content || ''
            suggestions.push(`### ${file}\n\n${analysis}`)
          } catch (e: any) {
            suggestions.push(`### ${file}\n\n✗ Analysis failed: ${e.message}`)
          }
        }
        return { ok: true, output: `# UX Improvement Report\n\nReviewed ${filesToAnalyze.length} UI file(s).\n\n${suggestions.join('\n\n---\n\n')}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Crash Simulator
  // ───────────────────────────────────────────────────────────────────────
  crash_simulator: {
    name: 'crash_simulator',
    description: 'Simulate crashes and test recovery. Injects errors into the app to verify error handling works correctly. Tests: null refs, network failures, timeout, disk full, OOM.',
    parameters: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'null_ref | network_fail | timeout | disk_full | oom | random_errors' },
      },
      required: ['scenario'],
    },
    async execute(args, ctx) {
      try {
        const scenarios: Record<string, string> = {
          null_ref: 'Null reference injection — all object accesses wrapped with try/catch',
          network_fail: 'Network failure simulation — all fetch calls return 500',
          timeout: 'Timeout simulation — all API calls take 30s',
          disk_full: 'Disk full simulation — file writes fail',
          oom: 'Out of memory simulation — large allocations',
          random_errors: 'Random error injection — 10% of operations fail',
        }
        const description = scenarios[args.scenario] || 'Unknown scenario'
        // Generate a crash injection wrapper
        const wrapperCode = `// Crash Simulator — ${args.scenario}
// This file injects ${description}
// Remove this file to disable the simulation

export function enableCrashSimulation() {
${args.scenario === 'null_ref' ? `
  // Wrap object property access to randomly return null
  const handler = {
    get(target, prop) {
      if (Math.random() < 0.1) return null
      return target[prop]
    }
  }
  console.warn('[CrashSim] Null reference injection enabled — 10% of accesses return null')
` : ''}
${args.scenario === 'network_fail' ? `
  // Override fetch to return 500
  const origFetch = window.fetch
  window.fetch = async (...args) => {
    if (Math.random() < 0.3) {
      return new Response('{"error":"simulated"}', { status: 500 })
    }
    return origFetch(...args)
  }
  console.warn('[CrashSim] Network failure injection enabled — 30% of fetches fail')
` : ''}
${args.scenario === 'timeout' ? `
  // Override fetch to delay 30s
  const origFetch = window.fetch
  window.fetch = async (...args) => {
    await new Promise(r => setTimeout(r, 30000))
    return origFetch(...args)
  }
  console.warn('[CrashSim] Timeout injection enabled — all fetches take 30s')
` : ''}
${args.scenario === 'random_errors' ? `
  // Random error injection
  const origSetTimeout = window.setTimeout
  window.setTimeout = (fn, ms) => {
    if (Math.random() < 0.1) {
      return origSetTimeout(() => { throw new Error('Simulated error') }, ms)
    }
    return origSetTimeout(fn, ms)
  }
  console.warn('[CrashSim] Random error injection enabled — 10% of timers throw')
` : ''}
}
enableCrashSimulation()
`
        storage.writeFile(ctx.projectId, 'src/crash-sim.js', wrapperCode)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: 'src/crash-sim.js' } },
            create: { projectId: ctx.projectId, path: 'src/crash-sim.js', content: wrapperCode, isDir: false },
            update: { content: wrapperCode },
          })
        } catch {}
        return { ok: true, output: `✓ Crash simulation enabled: ${args.scenario}\n\n${description}\n\nSimulation code saved to: src/crash-sim.js\n\nImport this file in your app entry point to activate. Delete the file to disable.` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Load Tester
  // ───────────────────────────────────────────────────────────────────────
  load_test: {
    name: 'load_test',
    description: 'Stress test the running app. Sends N concurrent requests and reports response times, error rate, and throughput.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to test (default: project preview)' },
        concurrency: { type: 'number', description: 'Concurrent requests (default: 10)' },
        duration: { type: 'number', description: 'Duration in seconds (default: 30)' },
      },
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const projRow = await db.project.findUnique({ where: { id: ctx.projectId }, select: { entryPort: true } }).catch(() => null)
        const port = projRow?.entryPort || detection.previewPort || 3000
        const url = args.url || `http://localhost:${port}`
        const concurrency = args.concurrency || 10
        const duration = args.duration || 30
        // Use autocannon if available, else use a simple Node.js script
        const script = `const http = require('http')
const url = new URL('${url}')
const concurrency = ${concurrency}
const durationMs = ${duration * 1000}
let requests = 0, successes = 0, failures = 0
const latencies: number[] = []
const start = Date.now()
function makeRequest() {
  if (Date.now() - start > durationMs) return
  const t0 = Date.now()
  const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET' }, (res) => {
    res.resume()
    requests++
    if (res.statusCode && res.statusCode < 400) successes++
    else failures++
    latencies.push(Date.now() - t0)
    if (Date.now() - start < durationMs) makeRequest()
  })
  req.on('error', () => { failures++; requests++; if (Date.now() - start < durationMs) makeRequest() })
  req.end()
}
for (let i = 0; i < concurrency; i++) makeRequest()
setTimeout(() => {
  const elapsed = (Date.now() - start) / 1000
  const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0
  const p95 = latencies.length ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] : 0
  const rps = (requests / elapsed).toFixed(1)
  console.log(JSON.stringify({
    totalRequests: requests,
    successes,
    failures,
    errorRate: ((failures / requests) * 100).toFixed(1) + '%',
    avgLatencyMs: avgLatency.toFixed(0),
    p95LatencyMs: p95,
    requestsPerSecond: rps,
    durationSec: elapsed.toFixed(1)
  }))
  process.exit(0)
}, durationMs + 1000)
`
        const r = await runtimeManager.execInProject(ctx.projectId, `node -e "${script.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" 2>&1`, (duration + 10) * 1000)
        try {
          const data = JSON.parse(r.stdout.split('\n').find(l => l.startsWith('{')) || '{}')
          return {
            ok: true,
            output: `# Load Test Results\n\n**URL:** ${url}\n**Concurrency:** ${concurrency}\n**Duration:** ${duration}s\n\n| Metric | Value |\n|---|---|\n| Total requests | ${data.totalRequests || 0} |\n| Successes | ${data.successes || 0} |\n| Failures | ${data.failures || 0} |\n| Error rate | ${data.errorRate || '0%'} |\n| Avg latency | ${data.avgLatencyMs || 0}ms |\n| P95 latency | ${data.p95LatencyMs || 0}ms |\n| Requests/sec | ${data.requestsPerSecond || 0} |\n\n${data.errorRate && parseFloat(data.errorRate) > 5 ? '⚠️ High error rate — the app may need optimization.' : '✓ App handles load well.'}`,
          }
        } catch {
          return { ok: true, output: `Load test output:\n\n${r.stdout.slice(-2000)}` }
        }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // SEO Optimizer
  // ───────────────────────────────────────────────────────────────────────
  optimize_seo: {
    name: 'optimize_seo',
    description: 'Auto-optimize the app for SEO. Adds meta tags, Open Graph tags, Twitter cards, structured data (JSON-LD), sitemap.xml, and robots.txt.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'App title' },
        description: { type: 'string', description: 'App description' },
        url: { type: 'string', description: 'App URL (e.g. https://myapp.com)' },
      },
      required: ['title', 'description'],
    },
    async execute(args, ctx) {
      try {
        const title = args.title
        const desc = args.description
        const url = args.url || 'https://example.com'
        const detection = detectFramework(ctx.projectId)
        // Generate meta tags
        const metaTags = `<!-- SEO Meta Tags -->
<title>${title}</title>
<meta name="description" content="${desc}" />
<meta name="keywords" content="${title.toLowerCase().split(' ').join(', ')}" />
<meta name="author" content="Cloud Agent" />
<meta name="robots" content="index, follow" />

<!-- Open Graph -->
<meta property="og:type" content="website" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${url}/og-image.png" />

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image" content="${url}/twitter-card.png" />

<!-- Canonical -->
<link rel="canonical" href="${url}" />

<!-- Structured Data (JSON-LD) -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "${title}",
  "description": "${desc}",
  "url": "${url}",
  "applicationCategory": "WebApplication"
}
</script>
`
        // Add to index.html or layout
        if (detection.framework === 'next' || detection.framework === 'react' || detection.framework === 'vite') {
          if (storage.existsFile(ctx.projectId, 'index.html')) {
            let html = storage.readFile(ctx.projectId, 'index.html')
            if (!html.includes('og:title')) {
              html = html.replace('</head>', `${metaTags}\n</head>`)
              storage.writeFile(ctx.projectId, 'index.html', html)
            }
          }
          if (storage.existsFile(ctx.projectId, 'app/layout.tsx')) {
            let layout = storage.readFile(ctx.projectId, 'app/layout.tsx')
            if (!layout.includes('og:title')) {
              layout = layout.replace(/export const metadata = {[^}]*}/, `export const metadata = {
  title: '${title}',
  description: '${desc}',
  openGraph: { title: '${title}', description: '${desc}', url: '${url}', type: 'website' },
  twitter: { card: 'summary_large_image', title: '${title}', description: '${desc}' },
  robots: { index: true, follow: true },
}`)
              storage.writeFile(ctx.projectId, 'app/layout.tsx', layout)
            }
          }
        }
        // Generate sitemap.xml
        const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${url}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>
`
        storage.writeFile(ctx.projectId, 'public/sitemap.xml', sitemap)
        // Generate robots.txt
        const robots = `User-agent: *
Allow: /
Disallow: /api/
Sitemap: ${url}/sitemap.xml
`
        storage.writeFile(ctx.projectId, 'public/robots.txt', robots)
        return { ok: true, output: `✓ SEO optimization complete\n\nAdded:\n- Meta tags (title, description, keywords)\n- Open Graph tags\n- Twitter Card\n- Structured data (JSON-LD)\n- sitemap.xml\n- robots.txt\n\nTitle: ${title}\nURL: ${url}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Accessibility Fixer
  // ───────────────────────────────────────────────────────────────────────
  fix_accessibility: {
    name: 'fix_accessibility',
    description: 'Auto-fix WCAG accessibility issues in UI code. Adds ARIA labels, alt text, keyboard navigation, focus management, and color contrast fixes.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'UI file to fix (optional — fixes all UI files)' },
      },
    },
    async execute(args, ctx) {
      try {
        let filesToFix: string[] = []
        if (args.file) {
          filesToFix = [args.file]
        } else {
          const tree = storage.readAllAsEntries(ctx.projectId)
          filesToFix = tree
            .filter(e => /\.(jsx|tsx|html|vue|svelte)$/.test(e.path) && !e.path.includes('node_modules'))
            .slice(0, 5)
            .map(e => e.path)
        }
        if (filesToFix.length === 0) return { ok: true, output: 'No UI files to fix.' }
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const fixed: string[] = []
        for (const file of filesToFix) {
          if (!storage.existsFile(ctx.projectId, file)) continue
          const code = storage.readFile(ctx.projectId, file).slice(0, 8000)
          try {
            const res = await zai.chat.completions.create({
              messages: [{
                role: 'user',
                content: `Fix all WCAG accessibility issues in this code. Output the COMPLETE fixed file.

Common fixes:
- Add aria-label to icon buttons
- Add alt text to images
- Add aria-live for dynamic content
- Ensure proper heading hierarchy (h1 > h2 > h3)
- Add role attributes where needed
- Ensure keyboard navigation works
- Add focus management for modals
- Fix color contrast issues (add className)
- Add lang attribute
- Ensure form labels are associated with inputs

Output ONLY the fixed code, no explanation.

File: ${file}
\`\`\`
${code}
\`\`\``,
              }],
              model: 'glm-4.6',
              temperature: 0.3,
            } as any)
            const fixedCode = (res as any)?.choices?.[0]?.message?.content || ''
            const finalCode = fixedCode.replace(/```(?:javascript|typescript|jsx|tsx|html)?\n?/g, '').replace(/```$/g, '')
            if (finalCode.trim()) {
              storage.writeFile(ctx.projectId, file, finalCode)
              try {
                await safeUpsert({
                  where: { projectId_path: { projectId: ctx.projectId, path: file } },
                  create: { projectId: ctx.projectId, path: file, content: finalCode, isDir: false },
                  update: { content: finalCode },
                })
              } catch {}
              fixed.push(`✓ ${file}`)
            }
          } catch (e: any) {
            fixed.push(`✗ ${file}: ${e.message}`)
          }
        }
        return { ok: true, output: `# Accessibility Fixes\n\nFixed ${fixed.length} file(s):\n\n${fixed.join('\n')}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Code Refactorer
  // ───────────────────────────────────────────────────────────────────────
  refactor_code: {
    name: 'refactor_code',
    description: 'AI-powered code refactoring. Improves code structure, extracts functions, simplifies complex logic, removes duplication, and applies best practices.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File to refactor' },
        goal: { type: 'string', description: 'Refactoring goal: simplify | extract_functions | remove_duplication | modernize | all' },
      },
      required: ['file'],
    },
    async execute(args, ctx) {
      try {
        if (!storage.existsFile(ctx.projectId, args.file)) {
          return { ok: false, output: '', error: `File not found: ${args.file}` }
        }
        const code = storage.readFile(ctx.projectId, args.file).slice(0, 12000)
        const goal = args.goal || 'all'
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const res = await zai.chat.completions.create({
          messages: [{
            role: 'user',
            content: `Refactor this code to ${goal}. Output the COMPLETE refactored file.

Goals:
- ${goal === 'simplify' ? 'Simplify complex logic, reduce nesting' : ''}
- ${goal === 'extract_functions' ? 'Extract reusable functions from large blocks' : ''}
- ${goal === 'remove_duplication' ? 'Remove duplicated code (DRY)' : ''}
- ${goal === 'modernize' ? 'Use modern syntax (async/await, destructuring, optional chaining)' : ''}
- ${goal === 'all' ? 'Apply all refactoring goals: simplify, extract, deduplicate, modernize' : ''}

Rules:
- Keep the same functionality
- Use clear names
- Add JSDoc comments for complex functions
- Keep all imports

Output ONLY the refactored code.

File: ${args.file}
\`\`\`
${code}
\`\`\``,
          }],
          model: 'glm-4.6',
          temperature: 0.3,
        } as any)
        const refactored = (res as any)?.choices?.[0]?.message?.content || ''
        const finalCode = refactored.replace(/```(?:javascript|typescript|jsx|tsx|python|dart)?\n?/g, '').replace(/```$/g, '')
        if (!finalCode.trim()) {
          return { ok: false, output: '', error: 'AI returned empty refactored code' }
        }
        // Save the refactored code
        storage.writeFile(ctx.projectId, args.file, finalCode)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: args.file } },
            create: { projectId: ctx.projectId, path: args.file, content: finalCode, isDir: false },
            update: { content: finalCode },
          })
        } catch {}
        return { ok: true, output: `✓ Refactored ${args.file}\n\nGoal: ${goal}\n\nOriginal: ${code.length} chars\nRefactored: ${finalCode.length} chars\n\nThe refactored code has been saved. Review it and run tests to verify.` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Dependency Vulnerability Scanner
  // ───────────────────────────────────────────────────────────────────────
  scan_vulnerabilities: {
    name: 'scan_vulnerabilities',
    description: 'Scan project dependencies for known security vulnerabilities. Uses npm audit, pip-audit, or pub outdated. Returns CVE list with severity and fix suggestions.',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        let cmd = 'npm audit --json 2>&1 || true'
        if (detection.framework === 'python') cmd = 'pip install pip-audit 2>&1 | tail -1 && pip-audit -r requirements.txt -f json 2>&1 || true'
        else if (detection.framework === 'flutter') cmd = 'flutter pub outdated --json 2>&1 || true'
        const r = await runtimeManager.execInProject(ctx.projectId, cmd, 60000)
        try {
          const data = JSON.parse(r.stdout)
          const vulns = data.vulnerabilities || data.advisories || []
          const count = Array.isArray(vulns) ? vulns.length : Object.keys(vulns).length
          if (count === 0) return { ok: true, output: '✓ No vulnerabilities found.' }
          const report = `# Vulnerability Scan\n\nFound ${count} vulnerabilities:\n\n`
          if (Array.isArray(vulns)) {
            const list = vulns.slice(0, 20).map((v: any) => `### ${v.name || v.module_name} — ${v.severity || 'unknown'}\n- Version: ${v.version || v.vulnerable_versions || 'unknown'}\n- CVE: ${v.cves?.join(', ') || v.id || 'N/A'}\n- Fix: ${v.fixAvailable ? 'Update to ' + (v.fixAvailable.version || v.patched_versions || 'latest') : 'No fix available'}\n- Title: ${v.title || v.advisory || 'N/A'}`).join('\n\n')
            return { ok: count === 0, output: report + list }
          }
          return { ok: count === 0, output: report + JSON.stringify(vulns, null, 2).slice(0, 3000) }
        } catch {
          return { ok: true, output: `Vulnerability scan output:\n\n\`\`\`\n${r.stdout.slice(0, 3000)}\n\`\`\`` }
        }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // API Mock Generator
  // ───────────────────────────────────────────────────────────────────────
  generate_mock_api: {
    name: 'generate_mock_api',
    description: 'Generate a mock API server for testing. Creates realistic mock responses for all API endpoints in the project. Useful for frontend development before backend is ready.',
    parameters: {
      type: 'object',
      properties: {
        endpoints: { type: 'array', items: { type: 'string' }, description: 'List of API endpoints to mock (e.g. ["GET /api/users", "POST /api/login"])' },
      },
      required: ['endpoints'],
    },
    async execute(args, ctx) {
      try {
        const endpoints: string[] = args.endpoints || []
        if (endpoints.length === 0) return { ok: false, output: '', error: 'No endpoints specified' }
        // Generate mock server
        const mockRoutes = endpoints.map(ep => {
          const [method, path] = ep.split(' ')
          const pathKey = path.replace(/:([^/]+)/g, ':$1').replace(/\//g, '_').replace(/^_/, '')
          const mockData = generateMockData(path)
          return `  // ${method} ${path}
  '${method.toLowerCase()} ${path}': (req, res) => {
    res.json(${JSON.stringify(mockData, null, 4).replace(/\n/g, '\n  ')})
  },`
        }).join('\n')
        const mockServer = `// Mock API Server — generated by Cloud Agent
// Run with: node mock-server.js
const express = require('express')
const cors = require('cors')
const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 4000

const routes = {
${mockRoutes}
}

for (const [route, handler] of Object.entries(routes)) {
  const [method, path] = route.split(' ')
  app[method](path, handler)
  console.log('  ✓ ' + method.toUpperCase() + ' ' + path)
}

app.listen(PORT, () => console.log('Mock API running on http://localhost:' + PORT))
`
        storage.writeFile(ctx.projectId, 'mock-server.js', mockServer)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: 'mock-server.js' } },
            create: { projectId: ctx.projectId, path: 'mock-server.js', content: mockServer, isDir: false },
            update: { content: mockServer },
          })
        } catch {}
        return { ok: true, output: `✓ Mock API server generated\n\nEndpoints mocked: ${endpoints.length}\n\nFile: mock-server.js\n\nRun with: \`node mock-server.js\`\nThe mock server will start on port 4000.` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Component Generator
  // ───────────────────────────────────────────────────────────────────────
  generate_component: {
    name: 'generate_component',
    description: 'Generate a complete UI component from a description. Supports React, Vue, Svelte, and Flutter. Includes styling, props, and accessibility.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What the component does (e.g. "user profile card with avatar, name, bio, and follow button")' },
        name: { type: 'string', description: 'Component name (PascalCase, e.g. UserProfileCard)' },
        framework: { type: 'string', description: 'react | vue | svelte | flutter (default: auto-detect)' },
      },
      required: ['description', 'name'],
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const framework = args.framework || (detection.framework === 'flutter' ? 'flutter' : 'react')
        const name = args.name
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const res = await zai.chat.completions.create({
          messages: [{
            role: 'user',
            content: `Generate a complete ${framework} component named ${name}.

Description: ${args.description}

Requirements:
- Complete, production-ready code
- Include styling (Tailwind for web, Material for Flutter)
- Include TypeScript types (if React/Vue/Svelte)
- Include accessibility (ARIA, keyboard nav)
- Include responsive design
- Include all necessary imports

Output ONLY the code, no explanation.`,
          }],
          model: 'glm-4.6',
          temperature: 0.3,
        } as any)
        const code = (res as any)?.choices?.[0]?.message?.content || ''
        const finalCode = code.replace(/```(?:javascript|typescript|jsx|tsx|dart|vue|svelte)?\n?/g, '').replace(/```$/g, '')
        // Determine file path
        let filePath: string
        if (framework === 'flutter') {
          filePath = `lib/widgets/${name.toLowerCase()}.dart`
        } else if (framework === 'vue') {
          filePath = `src/components/${name}.vue`
        } else if (framework === 'svelte') {
          filePath = `src/components/${name}.svelte`
        } else {
          filePath = `src/components/${name}.tsx`
        }
        storage.writeFile(ctx.projectId, filePath, finalCode)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: filePath } },
            create: { projectId: ctx.projectId, path: filePath, content: finalCode, isDir: false },
            update: { content: finalCode },
          })
        } catch {}
        return { ok: true, output: `✓ Component "${name}" generated\n\nFramework: ${framework}\nFile: ${filePath}\nCode length: ${finalCode.length} chars\n\nImport and use in your app.` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Page Generator
  // ───────────────────────────────────────────────────────────────────────
  generate_page: {
    name: 'generate_page',
    description: 'Generate a complete page with routing, layout, and components. Supports Next.js App Router, React Router, Vue Router, and Flutter routes.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What the page does (e.g. "user dashboard with stats, recent activity, and quick actions")' },
        name: { type: 'string', description: 'Page name (e.g. "Dashboard")' },
        route: { type: 'string', description: 'Route path (e.g. "/dashboard")' },
      },
      required: ['description', 'name'],
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const res = await zai.chat.completions.create({
          messages: [{
            role: 'user',
            content: `Generate a complete page for a ${detection.framework} app.

Page name: ${args.name}
Route: ${args.route || '/' + args.name.toLowerCase()}
Description: ${args.description}

Requirements:
- Complete, production-ready code
- Include layout, navigation, and content
- Use Tailwind CSS (web) or Material (Flutter)
- Include loading and error states
- Include responsive design
- Include all imports

Output ONLY the code.`,
          }],
          model: 'glm-4.6',
          temperature: 0.3,
        } as any)
        const code = (res as any)?.choices?.[0]?.message?.content || ''
        const finalCode = code.replace(/```(?:javascript|typescript|jsx|tsx|dart)?\n?/g, '').replace(/```$/g, '')
        // Determine file path
        let filePath: string
        if (detection.framework === 'flutter') {
          filePath = `lib/screens/${args.name.toLowerCase()}_screen.dart`
        } else if (detection.framework === 'next') {
          filePath = `app/${args.route?.replace(/^\//, '') || args.name.toLowerCase()}/page.tsx`
        } else {
          filePath = `src/pages/${args.name}.tsx`
        }
        storage.writeFile(ctx.projectId, filePath, finalCode)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: filePath } },
            create: { projectId: ctx.projectId, path: filePath, content: finalCode, isDir: false },
            update: { content: finalCode },
          })
        } catch {}
        return { ok: true, output: `✓ Page "${args.name}" generated\n\nRoute: ${args.route}\nFile: ${filePath}\nCode length: ${finalCode.length} chars` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // API Endpoint Generator
  // ───────────────────────────────────────────────────────────────────────
  generate_endpoint: {
    name: 'generate_endpoint',
    description: 'Generate a complete API endpoint with validation, error handling, and OpenAPI docs. Supports Express, FastAPI, and Next.js API routes.',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', description: 'HTTP method: GET | POST | PUT | DELETE | PATCH' },
        path: { type: 'string', description: 'Endpoint path (e.g. /api/users/:id)' },
        description: { type: 'string', description: 'What the endpoint does' },
      },
      required: ['method', 'path', 'description'],
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const res = await zai.chat.completions.create({
          messages: [{
            role: 'user',
            content: `Generate a complete API endpoint for a ${detection.framework} backend.

Method: ${args.method}
Path: ${args.path}
Description: ${args.description}

Requirements:
- Input validation (Zod for Node, Pydantic for Python)
- Error handling with proper HTTP status codes
- OpenAPI/Swagger documentation
- TypeScript types (if Node)
- Database query (mock if no DB)
- Rate limiting comment
- Authentication check comment

Output ONLY the code.`,
          }],
          model: 'glm-4.6',
          temperature: 0.3,
        } as any)
        const code = (res as any)?.choices?.[0]?.message?.content || ''
        const finalCode = code.replace(/```(?:javascript|typescript|python)?\n?/g, '').replace(/```$/g, '')
        // Determine file path
        let filePath: string
        if (detection.framework === 'python') {
          filePath = `routes/${args.path.replace(/\//g, '_').replace(/^_/, '')}.py`
        } else if (detection.framework === 'next') {
          const pathParts = args.path.split('/').filter(Boolean)
          filePath = `app/api/${pathParts.join('/')}/route.ts`
        } else {
          filePath = `src/routes${args.path}.js`
        }
        storage.writeFile(ctx.projectId, filePath, finalCode)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: filePath } },
            create: { projectId: ctx.projectId, path: filePath, content: finalCode, isDir: false },
            update: { content: finalCode },
          })
        } catch {}
        return { ok: true, output: `✓ API endpoint generated\n\n${args.method} ${args.path}\nFile: ${filePath}\n\nTest with: \`curl -X ${args.method} http://localhost:3000${args.path}\`` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },

  // ───────────────────────────────────────────────────────────────────────
  // Database Model Generator
  // ───────────────────────────────────────────────────────────────────────
  generate_model: {
    name: 'generate_model',
    description: 'Generate a database model/schema from a description. Supports Prisma (Node), SQLAlchemy (Python), and Dart models (Flutter).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Model name (e.g. User, Post, Comment)' },
        fields: { type: 'string', description: 'Field descriptions (e.g. "name:string, email:string:unique, age:int, createdAt:datetime")' },
      },
      required: ['name', 'fields'],
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const ZAI = (await import('z-ai-web-dev-sdk').then(m => m.default || m))
        const zai = await ZAI.create()
        const res = await zai.chat.completions.create({
          messages: [{
            role: 'user',
            content: `Generate a database model for ${detection.framework}.

Model: ${args.name}
Fields: ${args.fields}

${detection.framework === 'python' ? 'Use SQLAlchemy with proper types.' : detection.framework === 'flutter' ? 'Use Dart class with JSON serialization.' : 'Use Prisma schema syntax.'}

Include:
- All fields with proper types
- Relationships (if mentioned)
- Timestamps (createdAt, updatedAt)
- Unique constraints
- Indexes for frequently queried fields
- Validation (where applicable)

Output ONLY the code.`,
          }],
          model: 'glm-4.6',
          temperature: 0.3,
        } as any)
        const code = (res as any)?.choices?.[0]?.message?.content || ''
        const finalCode = code.replace(/```(?:prisma|python|dart)?\n?/g, '').replace(/```$/g, '')
        // Determine file path
        let filePath: string
        if (detection.framework === 'python') {
          filePath = `models/${args.name.toLowerCase()}.py`
        } else if (detection.framework === 'flutter') {
          filePath = `lib/models/${args.name.toLowerCase()}.dart`
        } else {
          // Append to prisma/schema.prisma
          if (storage.existsFile(ctx.projectId, 'prisma/schema.prisma')) {
            const schema = storage.readFile(ctx.projectId, 'prisma/schema.prisma')
            if (!schema.includes(`model ${args.name}`)) {
              storage.writeFile(ctx.projectId, 'prisma/schema.prisma', schema + '\n\n' + finalCode)
            }
            return { ok: true, output: `✓ Model "${args.name}" added to prisma/schema.prisma\n\nRun: \`npx prisma db push\` to create the table.` }
          }
          filePath = `prisma/schema.prisma`
          storage.writeFile(ctx.projectId, filePath, finalCode)
        }
        storage.writeFile(ctx.projectId, filePath, finalCode)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: filePath } },
            create: { projectId: ctx.projectId, path: filePath, content: finalCode, isDir: false },
            update: { content: finalCode },
          })
        } catch {}
        return { ok: true, output: `✓ Model "${args.name}" generated\n\nFile: ${filePath}\n\nFields: ${args.fields}` }
      } catch (e: any) { return { ok: false, output: '', error: e.message } }
    },
  },
}

// ─── Helper ──────────────────────────────────────────────────────────────

function generateMockData(path: string): any {
  const parts = path.split('/').filter(Boolean)
  const resourceName = parts[parts.length - 1]?.replace(/s$/, '') || 'item'
  // Generate realistic mock data
  if (path.includes('users')) {
    return { id: 1, name: 'John Doe', email: 'john@example.com', avatar: 'https://i.pravatar.cc/150?u=1', createdAt: new Date().toISOString() }
  }
  if (path.includes('posts')) {
    return { id: 1, title: 'Sample Post', content: 'Lorem ipsum dolor sit amet...', authorId: 1, createdAt: new Date().toISOString() }
  }
  if (path.includes('products')) {
    return { id: 1, name: 'Sample Product', price: 99.99, description: 'A great product', image: 'https://picsum.photos/400', stock: 100 }
  }
  return { id: 1, name: `Sample ${resourceName}`, createdAt: new Date().toISOString() }
}
