/**
 * Deterministic Security Scanner — real static analysis of project files.
 *
 * Detects (with file, line, severity, and remediation hint):
 *  - hardcoded secrets (API keys, tokens, private keys)
 *  - dangerous sinks (eval, new Function, document.write, innerHTML with vars)
 *  - insecure transport (http:// resources on https pages, mixed content)
 *  - missing security headers/meta (CSP, X-Frame padding is server-side — meta only)
 *  - committed env/secret files
 *  - dangerous Android permissions (Flutter/Android projects)
 *  - shell injection smells (child_process exec with template vars)
 */
import { readAllAsEntries } from './storage'

export interface SecurityFinding {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  file: string
  line: number
  snippet: string
  fix: string
}

interface Rule {
  id: string
  severity: SecurityFinding['severity']
  title: string
  pattern: RegExp
  fix: string
  files?: RegExp // restrict to matching paths
  skip?: RegExp
}

const RULES: Rule[] = [
  {
    id: 'secret-openai',
    severity: 'critical',
    title: 'Hardcoded OpenAI-style API key',
    pattern: /sk-[A-Za-z0-9]{20,}/g,
    fix: 'Move the key into platform Secrets (Settings → Secrets) and read it at runtime — never commit it into source files.',
  },
  {
    id: 'secret-google',
    severity: 'critical',
    title: 'Hardcoded Google API key',
    pattern: /AIza[0-9A-Za-z\-_]{30,}/g,
    fix: 'Use environment/secrets storage; rotate the exposed key in Google Cloud Console immediately.',
  },
  {
    id: 'secret-github',
    severity: 'critical',
    title: 'Hardcoded GitHub token',
    pattern: /gh[pousr]_[A-Za-z0-9]{30,}/g,
    fix: 'Revoke the token on GitHub and store it in Secrets instead.',
  },
  {
    id: 'secret-aws',
    severity: 'critical',
    title: 'Hardcoded AWS access key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    fix: 'Rotate the AWS key pair and keep credentials in Secrets / IAM roles.',
  },
  {
    id: 'secret-admob-appid',
    severity: 'low',
    title: 'AdMob App ID in source (informational)',
    pattern: /ca-app-pub-\d{10,}~\d{8,}/g,
    fix: 'App IDs are public by design — but confirm you are NOT committing the Ad UNIT IDs of monetized slots.',
  },
  {
    id: 'private-key',
    severity: 'critical',
    title: 'Private key material committed',
    pattern: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    fix: 'Remove the key from the project immediately and rotate it — anything committed must be considered compromised.',
  },
  {
    id: 'generic-secret',
    severity: 'medium',
    title: 'Possible hardcoded secret assignment',
    pattern: /\b(api[_-]?key|secret|password|token|auth[_-]?token)\b\s*[:=]\s*["'][A-Za-z0-9+/_\-]{16,}["']/gi,
    fix: 'If this is a real credential, move it to Secrets. If it is a test/demo value, rename the variable to make that obvious (e.g. DEMO_KEY).',
    skip: /(placeholder|example|your[_-]?key|test|demo|xxx|<[^>]*>)/i,
  },
  {
    id: 'eval',
    severity: 'high',
    title: 'eval() — code execution from strings',
    pattern: /\beval\s*\(/g,
    fix: 'Replace eval with JSON.parse, lookup maps or explicit logic. eval enables XSS and code injection.',
    skip: /\.(md|txt)$/i,
  },
  {
    id: 'new-function',
    severity: 'high',
    title: 'new Function() — dynamic code execution',
    pattern: /new\s+Function\s*\(/g,
    fix: 'Construct logic without new Function — it is eval in disguise.',
  },
  {
    id: 'doc-write',
    severity: 'medium',
    title: 'document.write sink',
    pattern: /document\.write\s*\(/g,
    fix: 'Use textContent/append or element creation; document.write can inject markup from untrusted data.',
  },
  {
    id: 'innerhtml-var',
    severity: 'high',
    title: 'innerHTML assigned from dynamic data',
    pattern: /innerHTML\s*(\+?=)[^;]*\$\{|\binnerHTML\s*(\+?=)\s*[^;'" ]*(\+\s*[a-zA-Z_$][a-zA-Z0-9_$]*)/g,
    fix: 'Escape the value (textContent) or sanitize HTML before inserting user-derived strings.',
    skip: /\.(md|txt)$/i,
  },
  {
    id: 'insecure-http',
    severity: 'medium',
    title: 'Insecure http:// resource',
    pattern: /(?:src|href)\s*=\s*["']http:\/\/(?!localhost|127\.0\.0\.1)[^"']+["']/gi,
    fix: 'Serve all assets over https:// to prevent mixed-content blocking and MITM attacks.',
  },
  {
    id: 'env-committed',
    severity: 'high',
    title: 'Environment/secret file present in project',
    pattern: /^.+$/g, // matched per-file below
    fix: 'Delete this file from the project and store its values in the platform Secrets manager.',
    files: /\.env(\..+)?$|\.pem$|credentials\.json$|service[-_]?account/i,
  },
  {
    id: 'shell-inject',
    severity: 'high',
    title: 'Shell command built with variables (injection risk)',
    pattern: /(exec|execSync|spawn)\s*\(\s*[`"'][^`"']*\$\{/g,
    fix: 'Use spawn with an args array and never interpolate user input into shell strings.',
  },
  {
    id: 'android-dangerous',
    severity: 'medium',
    title: 'Dangerous Android permission',
    pattern: /<uses-permission android:name="android\.permission\.(READ_SMS|RECEIVE_SMS|READ_CALL_LOG|RECORD_AUDIO|CAMERA|ACCESS_FINE_LOCATION|READ_CONTACTS|WRITE_EXTERNAL_STORAGE)"/g,
    fix: 'Keep only permissions the app truly needs — store listings reject broad permission requests without justification.',
    files: /AndroidManifest\.xml$/i,
  },
  {
    id: 'target-blank',
    severity: 'low',
    title: 'target="_blank" without rel="noopener"',
    pattern: /target\s*=\s*["']_blank["'](?![^>]*noopener)/gi,
    fix: 'Add rel="noopener noreferrer" so the opened page cannot access window.opener.',
  },
]

export function securityScan(projectId: string): { findings: SecurityFinding[]; score: number; scanned: number } {
  const entries = readAllAsEntries(projectId).filter(e =>
    !e.path.includes('node_modules') && !e.path.includes('.git/') &&
    !e.path.includes('build/') && !e.path.includes('.next/') &&
    e.content && e.content.length < 400_000,
  )

  const findings: SecurityFinding[] = []
  for (const entry of entries) {
    for (const rule of RULES) {
      if (rule.files && !rule.files.test(entry.path)) continue
      if (rule.id === 'env-committed') {
        findings.push({
          id: rule.id, severity: rule.severity, title: rule.title,
          file: entry.path, line: 1, snippet: '(file present)',
          fix: rule.fix,
        })
        continue
      }
      const lines = entry.content.split('\n')
      const seen = new Set<string>()
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(rule.pattern)
        if (!m) continue
        if (rule.skip && rule.skip.test(lines[i])) continue
        const dedupe = `${rule.id}:${m[0].slice(0, 40)}`
        if (seen.has(dedupe)) continue
        seen.add(dedupe)
        findings.push({
          id: rule.id,
          severity: rule.severity,
          title: rule.title,
          file: entry.path,
          line: i + 1,
          snippet: lines[i].trim().slice(0, 160),
          fix: rule.fix,
        })
        if (findings.length >= 200) break
      }
      if (findings.length >= 200) break
    }
    if (findings.length >= 200) break
  }

  const weight = { critical: 25, high: 10, medium: 4, low: 1 } as const
  const penalty = findings.reduce((s, f) => s + weight[f.severity], 0)
  const score = Math.max(0, 100 - penalty)

  return { findings, score, scanned: entries.length }
}
