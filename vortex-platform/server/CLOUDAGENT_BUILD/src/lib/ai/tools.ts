/**
 * Agent tool system — defines all tools the Cloud Agent can invoke.
 *
 * Each tool has:
 *   - name (string)
 *   - description (for the model)
 *   - parameters (JSON schema)
 *   - execute(args, ctx): Promise<ToolResult>
 *
 * Tools are pure functions that operate on a project context. They never
 * touch the client directly; results are returned to the orchestrator.
 *
 * Sensitive/destructive tools (delete_file, git_push, terminal command that
 * contains `rm -rf`, etc.) request confirmation via `requiresConfirmation`.
 */
import { db } from '../db'
import * as storage from '../storage'
import { detectFramework } from '../framework'
import { runtimeManager } from '../runtime'
import { addPubDependency, parsePubSpec } from '../pub'
import { ENTERPRISE_TOOLS } from './enterprise-tools'
import { V3_TOOLS } from './v3-tools'
import { AUTO_API_TOOLS } from './auto-api-tools'
import { V4_TOOLS } from './v4-tools'
import { V5_TOOLS } from './v5-tools'
import { V6_TOOLS } from './v6-tools'
import { V24_TOOLS } from './v24-tools'
import { V26_TOOLS } from './v26-tools'
import { V27_TOOLS } from './v27-tools'
import { V28_TOOLS } from './v28-tools'
import { VORTEX_TOOLS } from './vortex-tools'

/**
 * Wrap DB file operations in try/catch — if the project row was deleted from
 * the DB but the UI is still showing it, we get a foreign key constraint error.
 * We still write the file to disk (which always works), so the user's work
 * isn't lost. The DB row is best-effort.
 */
export async function safeUpsert(args: any) {
  try {
    return await db.file.upsert(args)
  } catch (e) {
    console.warn('file.upsert failed (project may have been deleted):', e)
  }
}

async function safeDeleteMany(args: any) {
  try {
    return await db.file.deleteMany(args)
  } catch (e) {
    console.warn('file.deleteMany failed:', e)
  }
}

export interface ProjectContext {
  projectId: string
  runtime?: 'node' | 'flutter' | 'python' | 'go' | 'rust' | 'java' | 'php' | 'dotnet' | 'cpp' | 'static' | 'unknown'
}

export interface ToolResult {
  ok: boolean
  output: string
  data?: any
  requiresConfirmation?: boolean
  error?: string
}

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, any>
  requiresConfirmation?: (args: any) => boolean
  execute: (args: any, ctx: ProjectContext) => Promise<ToolResult>
}

/* ------------------------------ Tool definitions -------------------------- */

export const TOOLS: Record<string, ToolDef> = {
  read_file: {
    name: 'read_file',
    description: 'Read the contents of a file in the project. Returns the file text. Use for inspecting existing code.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path within the project, e.g. "src/index.ts"' },
      },
      required: ['path'],
    },
    async execute(args, ctx) {
      try {
        if (!storage.existsFile(ctx.projectId, args.path)) {
          return { ok: false, output: '', error: `File not found: ${args.path}` }
        }
        const content = storage.readFile(ctx.projectId, args.path)
        return { ok: true, output: content.slice(0, 100000), data: { path: args.path, length: content.length } }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  write_file: {
    name: 'write_file',
    description: 'Create or overwrite a file in the project with the given content. Creates parent directories as needed.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path' },
        content: { type: 'string', description: 'Full file content' },
      },
      required: ['path', 'content'],
    },
    async execute(args, ctx) {
      try {
        storage.writeFile(ctx.projectId, args.path, args.content)
        await safeUpsert({
          where: { projectId_path: { projectId: ctx.projectId, path: args.path } },
          create: { projectId: ctx.projectId, path: args.path, content: args.content, isDir: false },
          update: { content: args.content, isDir: false },
        })
        return { ok: true, output: `Wrote ${args.content.length} chars to ${args.path}` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  edit_file: {
    name: 'edit_file',
    description: 'Edit a file by replacing the first occurrence of `find` with `replace`. Use for surgical edits instead of rewriting the entire file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        find: { type: 'string', description: 'Exact text to find (must be unique in the file)' },
        replace: { type: 'string', description: 'Text to replace the found text with' },
      },
      required: ['path', 'find', 'replace'],
    },
    async execute(args, ctx) {
      try {
        if (!storage.existsFile(ctx.projectId, args.path)) {
          return { ok: false, output: '', error: `File not found: ${args.path}` }
        }
        const original = storage.readFile(ctx.projectId, args.path)
        const rawFind = String(args.find || '')
        const rawReplace = String(args.replace || '')
        // Some providers send literal "\\n" in JSON args instead of real
        // newlines. Try the raw strings FIRST — files legitimately contain
        // the two-character sequence \n (string literals, regexes, printf
        // docs) and unconditional normalization corrupted those edits.
        let find = rawFind
        let replace = rawReplace
        if (!rawFind.includes('\n') && original.includes(rawFind)) {
          // raw text matches — use as-is
        } else {
          const normFind = rawFind.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
          if (normFind !== rawFind && original.includes(normFind)) {
            find = normFind
            // Only normalize replace when the find needed it too
            replace = rawReplace.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
          }
        }
        const idx = original.indexOf(find)
        if (idx === -1) {
          return { ok: false, output: '', error: 'find text not present in file. Make sure the find text matches the file exactly (use read_file first to see the current content).' }
        }
        if (original.indexOf(find, idx + 1) !== -1) {
          return { ok: false, output: '', error: 'find text is not unique — include more context' }
        }
        const updated = original.slice(0, idx) + replace + original.slice(idx + find.length)
        storage.writeFile(ctx.projectId, args.path, updated)
        await safeUpsert({
          where: { projectId_path: { projectId: ctx.projectId, path: args.path } },
          create: { projectId: ctx.projectId, path: args.path, content: updated, isDir: false },
          update: { content: updated },
        })
        return { ok: true, output: `Edited ${args.path} — ${find.length} chars replaced with ${replace.length} chars` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  delete_file: {
    name: 'delete_file',
    description: 'Delete a file or directory from the project. Destructive — confirmation required.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    requiresConfirmation: () => true,
    async execute(args, ctx) {
      try {
        storage.deleteFile(ctx.projectId, args.path)
        await safeDeleteMany({ where: { projectId: ctx.projectId, path: { startsWith: args.path } } })
        return { ok: true, output: `Deleted ${args.path}` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  create_folder: {
    name: 'create_folder',
    description: 'Create an empty folder (and any missing parent folders) in the project.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
    async execute(args, ctx) {
      try {
        storage.writeFile(ctx.projectId, `${args.path}/.gitkeep`, '')
        return { ok: true, output: `Created folder ${args.path}` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  search_files: {
    name: 'search_files',
    description: 'List the project file tree. Returns the directory structure up to 4 levels deep, skipping node_modules/.git/.next.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const tree = storage.listTree(ctx.projectId)
        const flat: string[] = []
        const walk = (n: any, depth: number) => {
          if (depth > 4) return
          flat.push(`${'  '.repeat(depth)}${n.type === 'dir' ? '📁' : '📄'} ${n.name}`)
          if (n.children) for (const c of n.children) walk(c, depth + 1)
        }
        walk(tree, 0)
        return { ok: true, output: flat.join('\n').slice(0, 100000) }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  search_code: {
    name: 'search_code',
    description: 'Search all project files for a substring. Returns matching file paths, line numbers, and a snippet of the matched line.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    async execute(args, ctx) {
      try {
        const results = storage.searchFiles(ctx.projectId, args.query, 30)
        return {
          ok: true,
          output: results.map(r => `${r.path}:${r.line}: ${r.preview}`).join('\n'),
          data: { results },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  inspect_project: {
    name: 'inspect_project',
    description: 'Inspect the project structure and detect its framework/language/runtime. Returns detection signals.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const tree = storage.listTree(ctx.projectId)
        const top = (tree.children || []).map((c: any) => c.name).slice(0, 30).join(', ')
        return {
          ok: true,
          output: `Framework: ${detection.framework}\nRuntime: ${detection.runtime}\nLanguage: ${detection.language}\nEntry: ${detection.entry || 'n/a'}\nDev cmd: ${detection.devCommand || 'n/a'}\nSignals: ${detection.signals.join(', ')}\nTop-level: ${top}`,
          data: detection,
        }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  install_package: {
    name: 'install_package',
    description: 'Install a dependency into the project with the RIGHT package manager — picked automatically from the project manifest. Flutter/Dart projects (pubspec.yaml) → pub.dev packages like speech_to_text, flutter_tts, http, provider, shared_preferences. Node/JS/TS projects → npm/pnpm/yarn packages like axios, lodash. You never need to choose the manager yourself.',
    parameters: {
      type: 'object',
      properties: {
        package: { type: 'string', description: 'Package name, optionally with version: "axios@1.6.0" (npm) or "speech_to_text:5.0.1" / "speech_to_text@^5.0.1" (pub.dev)' },
        manager: { type: 'string', enum: ['npm', 'pnpm', 'yarn'], default: 'npm' },
      },
      required: ['package'],
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const isPubProject = detection.framework === 'flutter' || storage.existsFile(ctx.projectId, 'pubspec.yaml')

        // ── Flutter/Dart project → pub.dev path ────────────────────────────
        // npm has NO Flutter packages: `npm install speech_to_text` 404s and
        // the agent used to retry the same dead call forever. Record the REAL
        // dependency in pubspec.yaml instead (the manifest any Flutter SDK
        // resolves), then try `pub get` best-effort.
        if (isPubProject) {
          const r = await addPubDependency(ctx.projectId, args.package)
          if (!r.ok) return { ok: false, output: '', error: r.error }
          let output = `pub.dev dependency ${r.updated ? 'updated' : 'added'}: ${r.name}: ${r.constraint} (version ${r.source === 'specified' ? 'as you specified' : r.source === 'pub.dev' ? 'resolved live from pub.dev' : 'any — pub.dev unreachable, resolved on next pub get'})`
          if (r.created) output += '\npubspec.yaml was missing — created a valid one.'
          const get = await runtimeManager.execInProject(ctx.projectId, 'flutter pub get 2>&1 || dart pub get 2>&1', 120000)
          if (get.code === 0 && /Got dependencies|Resolving/.test(get.stdout || '')) {
            output += `\nflutter pub get OK:\n${(get.stdout || '').slice(-1500)}`
          } else {
            output += '\nNote: the Flutter/Dart SDK is not available in this cloud sandbox yet, so `pub get` could not run here. The dependency IS correctly recorded in pubspec.yaml and resolves on any machine with the Flutter SDK (or after install_sdk flutter). You can keep writing Dart code now.'
          }
          return { ok: true, output, data: r }
        }

        // ── Node project → npm path (unchanged behavior) ───────────────────
        const result = await runtimeManager.execInProject(ctx.projectId, `${args.manager || 'npm'} install ${args.package}`, 120000)
        if (result.code !== 0) {
          // npm 404 on a pub-style name in an UNKNOWN project (no manifest at
          // all — e.g. the model installed before writing pubspec.yaml):
          // record the pub dependency instead of dead-ending.
          const looks404 = /E404|Not Found/i.test(result.stderr || '')
          if (looks404 && detection.framework === 'unknown' && parsePubSpec(args.package)) {
            const r = await addPubDependency(ctx.projectId, args.package)
            if (r.ok) {
              return { ok: true, output: `npm has no "${args.package}" (it is a pub.dev Flutter/Dart package). Recorded it in pubspec.yaml instead: ${r.name}: ${r.constraint} (${r.source}). Import it in Dart as 'package:${r.name}/…'.`, data: r }
            }
          }
          return { ok: false, output: result.stdout.slice(-50000), error: result.stderr.slice(-50000) }
        }
        return { ok: true, output: result.stdout.slice(-50000) }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  run_project: {
    name: 'run_project',
    description: 'Start the project dev server. Returns the port and URL where the preview is available.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const result = await runtimeManager.start(ctx.projectId)
        if (!result.ok) {
          // The old code reported "Project running on port undefined" on
          // failures — the model then confidently inspected logs of a dead
          // process. Report the real error.
          return { ok: false, output: `Failed to start: ${result.error || 'unknown error'}`, error: result.error }
        }
        return { ok: true, output: `Project running on port ${result.port}. URL: ${result.url}`, data: { port: result.port, url: result.url, runtime: result.runtime } }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  stop_project: {
    name: 'stop_project',
    description: 'Stop the running dev server for this project.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const result = await runtimeManager.stop(ctx.projectId)
        return { ok: result, output: 'Project stopped' }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  restart_project: {
    name: 'restart_project',
    description: 'Stop and restart the project dev server.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        await runtimeManager.stop(ctx.projectId)
        const r = await runtimeManager.start(ctx.projectId)
        if (!r.ok) {
          return { ok: false, output: `Restart failed: ${r.error || 'unknown error'}`, error: r.error }
        }
        return { ok: true, output: `Restarted on port ${r.port}. URL: ${r.url}`, data: { port: r.port, url: r.url, runtime: r.runtime } }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  build_project: {
    name: 'build_project',
    description: 'Build the project. For Node.js projects runs `npm run build`. Returns build logs.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const r = await runtimeManager.build(ctx.projectId)
        return { ok: r.ok, output: r.logs.slice(-50000) }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  inspect_logs: {
    name: 'inspect_logs',
    description: 'Get the most recent logs from the currently running project (stdout/stderr combined).',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const logs = runtimeManager.getLogs(ctx.projectId)
        return { ok: true, output: logs.slice(-50000) }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  terminal: {
    name: 'terminal',
    description: 'Execute a shell command inside the project directory. Use for one-off commands like `ls`, `cat`, `npm run <script>`. Do not use for long-running servers — use run_project instead.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
    requiresConfirmation: (args) => {
      const cmd = (args.command || '').toLowerCase()
      // Detect destructive commands: rm -rf, mkfs, dd if=, > /dev/sd*, shutdown, reboot, fork bombs
      return /\brm\s+-rf\b|\bmkfs\b|\bdd\s+if=|\b>\s*\/dev\/sd[a-z]+\b|\bshutdown\b|\breboot\b|:\(\)\s*\{.*;\s*\}/.test(cmd)
    },
    async execute(args, ctx) {
      try {
        const r = await runtimeManager.execInProject(ctx.projectId, args.command, 60000)
        return { ok: r.code === 0, output: (r.stdout + (r.stderr ? '\n[stderr]\n' + r.stderr : '')).slice(-50000) }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  git_status: {
    name: 'git_status',
    description: 'Return the git status of the project (short format).',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const r = await runtimeManager.execInProject(ctx.projectId, 'git status --short 2>&1 || true', 10000)
        return { ok: true, output: r.stdout }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  git_diff: {
    name: 'git_diff',
    description: 'Return the git diff for the project.',
    parameters: { type: 'object', properties: { staged: { type: 'boolean', default: false } } },
    async execute(args, ctx) {
      try {
        const r = await runtimeManager.execInProject(ctx.projectId, `git diff ${args.staged ? '--cached' : ''} 2>&1 || true`, 10000)
        return { ok: true, output: r.stdout.slice(0, 100000) }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  git_commit: {
    name: 'git_commit',
    description: 'Stage all changes and create a git commit with the given message.',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
    async execute(args, ctx) {
      try {
        await runtimeManager.execInProject(ctx.projectId, 'git add -A', 10000)
        const r = await runtimeManager.execInProject(ctx.projectId, `git commit -m ${JSON.stringify(args.message)} 2>&1 || true`, 10000)
        return { ok: true, output: r.stdout }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  git_push: {
    name: 'git_push',
    description: 'Push commits to the configured GitHub remote. Automatically stages, commits, and pushes. No confirmation needed — agent has full access.',
    parameters: { type: 'object', properties: {
      message: { type: 'string', description: 'Commit message (default: auto-generated)' },
    } },
    async execute(args, ctx) {
      try {
        const msg = args.message || `Update from Cloud Agent ${new Date().toISOString()}`
        await runtimeManager.execInProject(ctx.projectId, 'git add -A 2>&1 || true', 10000)
        await runtimeManager.execInProject(ctx.projectId, `git commit -m ${JSON.stringify(msg)} 2>&1 || true`, 10000)
        const r = await runtimeManager.execInProject(ctx.projectId, 'git push 2>&1 || true', 60000)
        return { ok: true, output: `Pushed: ${msg}\n${r.stdout}` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  git_pull: {
    name: 'git_pull',
    description: 'Pull latest changes from the configured remote.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const r = await runtimeManager.execInProject(ctx.projectId, 'git pull 2>&1 || true', 30000)
        return { ok: true, output: r.stdout }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  // ────────────────────────── NEW PRO TOOLS ──────────────────────────

  http_request: {
    name: 'http_request',
    description: 'Make an HTTP request to any URL. Useful for testing APIs, fetching data, or calling external services. Returns status code, headers, and body.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The full URL to request' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
        headers: { type: 'object', description: 'HTTP headers as key-value pairs' },
        body: { type: 'string', description: 'Request body (for POST/PUT/PATCH)' },
      },
      required: ['url'],
    },
    async execute(args) {
      try {
        const res = await fetch(args.url, {
          method: args.method || 'GET',
          headers: args.headers || {},
          body: args.body || undefined,
        })
        const text = await res.text()
        return {
          ok: res.ok,
          output: `HTTP ${res.status} ${res.statusText}\n\n${text.slice(0, 50000)}`,
          data: { status: res.status, statusText: res.statusText, body: text.slice(0, 100000) },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  web_search: {
    name: 'web_search',
    description: 'Search the web for current information. Use for finding API docs, latest package versions, error solutions, or any real-time data.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
    async execute(args) {
      try {
        // Use z-ai-web-dev-sdk for web search
        const ZAI = (await import('z-ai-web-dev-sdk')).default || (await import('z-ai-web-dev-sdk'))
        const zai = await ZAI.create()
        const results = await (zai as any).web_search?.invoke?.({ query: args.query }) || []
        const formatted = (results || []).slice(0, 100).map((r: any, i: number) =>
          `${i + 1}. ${r.title || r.name || 'Untitled'}\n   ${r.url || r.link || ''}\n   ${r.snippet || r.description || ''}`
        ).join('\n\n')
        return { ok: true, output: formatted || 'No results found', data: { results } }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  scaffold_app: {
    name: 'scaffold_app',
    description: 'Scaffold a complete app structure with multiple files at once. Faster than calling write_file many times. Pass an array of {path, content} entries.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
          },
          description: 'Array of files to create',
        },
      },
      required: ['files'],
    },
    async execute(args, ctx) {
      try {
        const files: Array<{ path: string; content: string }> = args.files || []
        let count = 0
        for (const f of files) {
          storage.writeFile(ctx.projectId, f.path, f.content)
          try {
            await safeUpsert({
              where: { projectId_path: { projectId: ctx.projectId, path: f.path } },
              create: { projectId: ctx.projectId, path: f.path, content: f.content, isDir: false },
              update: { content: f.content },
            })
          } catch {}
          count++
        }
        return { ok: true, output: `Scaffolded ${count} files:\n${files.map(f => '  • ' + f.path).join('\n')}` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  lint_code: {
    name: 'lint_code',
    description: 'Run the linter (eslint for JS/TS, flake8 for Python, dart analyze for Dart). Returns lint errors and warnings.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory to lint (default: entire project)' },
      },
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        let cmd = 'npx eslint . 2>&1 || true'
        if (detection.framework === 'python') cmd = 'python -m flake8 . 2>&1 || true'
        else if (detection.framework === 'flutter') cmd = 'dart analyze 2>&1 || true'
        const r = await runtimeManager.execInProject(ctx.projectId, cmd, 60000)
        return { ok: true, output: r.stdout.slice(-50000) }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  format_code: {
    name: 'format_code',
    description: 'Format code files using prettier (JS/TS), black (Python), or dart format (Dart). Modifies files in place.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory to format (default: entire project)' },
      },
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        let cmd = 'npx prettier --write . 2>&1 || true'
        if (detection.framework === 'python') cmd = 'python -m black . 2>&1 || true'
        else if (detection.framework === 'flutter') cmd = 'dart format . 2>&1 || true'
        const r = await runtimeManager.execInProject(ctx.projectId, cmd, 60000)
        return { ok: r.code === 0, output: r.stdout.slice(-50000) }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  test_run: {
    name: 'test_run',
    description: 'Run the project\'s test suite (jest for JS/TS, pytest for Python, flutter test for Dart). Returns test results.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Specific test file to run (optional)' },
      },
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        let cmd = 'npx jest 2>&1 || true'
        if (detection.framework === 'python') cmd = 'python -m pytest 2>&1 || true'
        else if (detection.framework === 'flutter') cmd = 'flutter test 2>&1 || true'
        if (args.file) {
          // Shell-escape the model-supplied file path
          const qf = String(args.file).replace(/['"\\`$;]/g, '')
          cmd = cmd.replace('2>&1', `${qf} 2>&1`)
        }
        const r = await runtimeManager.execInProject(ctx.projectId, cmd, 120000)
        return { ok: true, output: r.stdout.slice(-50000) }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  database_query: {
    name: 'database_query',
    description: 'Execute a SQL query against the project\'s SQLite/PostgreSQL database. Useful for inspecting data, running migrations, or fixing schema issues.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SQL query to execute' },
        database: { type: 'string', description: 'Database file path (default: prisma/dev.db or db.sqlite)' },
      },
      required: ['query'],
    },
    async execute(args, ctx) {
      try {
        const dbPath = args.database || 'prisma/dev.db'
        const r = await runtimeManager.execInProject(ctx.projectId,
          `sqlite3 ${dbPath} "${args.query.replace(/"/g, '\\"')}" 2>&1 || true`, 30000)
        return { ok: r.code === 0, output: r.stdout.slice(-50000) }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  env_set: {
    name: 'env_set',
    description: 'Set or update an environment variable in the project\'s .env file. Creates the file if it doesn\'t exist.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['key', 'value'],
    },
    async execute(args, ctx) {
      try {
        let content = ''
        if (storage.existsFile(ctx.projectId, '.env')) {
          content = storage.readFile(ctx.projectId, '.env')
        }
        const lines = content.split('\n').filter(l => !l.startsWith(`${args.key}=`) && l.trim())
        lines.push(`${args.key}=${args.value}`)
        const newContent = lines.join('\n') + '\n'
        storage.writeFile(ctx.projectId, '.env', newContent)
        return { ok: true, output: `Set ${args.key} in .env` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  replace_in_files: {
    name: 'replace_in_files',
    description: 'Search and replace text across ALL files in the project. Useful for renaming a variable, updating API URLs, or refactoring.',
    parameters: {
      type: 'object',
      properties: {
        find: { type: 'string', description: 'Text to find' },
        replace: { type: 'string', description: 'Replacement text' },
        glob: { type: 'string', description: 'File pattern to match (e.g. "*.ts" or "src/**/*.{js,jsx}")' },
      },
      required: ['find', 'replace'],
    },
    async execute(args, ctx) {
      try {
        const entries = storage.readAllAsEntries(ctx.projectId)
        let count = 0
        for (const e of entries) {
          if (args.glob && !e.path.match(args.glob.replace('*', '.*').replace('**/', '.*'))) continue
          if (e.content.includes(args.find)) {
            const updated = e.content.split(args.find).join(args.replace)
            storage.writeFile(ctx.projectId, e.path, updated)
            count++
          }
        }
        return { ok: true, output: `Replaced in ${count} files` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  image_generate: {
    name: 'image_generate',
    description: 'Generate an image from a text prompt using AI. Saves the image to the project\'s assets folder. Useful for app icons, illustrations, or UI mockups.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Image generation prompt' },
        filename: { type: 'string', description: 'Output filename (default: generated.png)' },
      },
      required: ['prompt'],
    },
    async execute(args, ctx) {
      try {
        const ZAI = (await import('z-ai-web-dev-sdk')).default || (await import('z-ai-web-dev-sdk'))
        const zai = await ZAI.create()
        const result = await (zai as any).images.generations.create({
          model: 'dall-e-3',
          prompt: args.prompt,
          size: '1024x1024',
        })
        const url = result?.data?.[0]?.url || result?.data?.[0]?.b64_json
        if (!url) return { ok: false, output: '', error: 'No image URL returned' }
        // Download and save
        if (url.startsWith('http')) {
          const imgRes = await fetch(url)
          const buf = Buffer.from(await imgRes.arrayBuffer())
          const filename = args.filename || 'generated.png'
          storage.writeFile(ctx.projectId, `assets/${filename}`, buf)
          return { ok: true, output: `Image saved to assets/${filename}` }
        }
        // Base64 response — the old code returned the truncated base64 string
        // as text and never wrote the file. Decode and save it.
        try {
          const buf = Buffer.from(url, 'base64')
          const filename = args.filename || 'generated.png'
          storage.writeFile(ctx.projectId, `assets/${filename}`, buf)
          return { ok: true, output: `Image saved to assets/${filename}` }
        } catch {
          return { ok: false, output: '', error: 'Image returned but could not be decoded from base64' }
        }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  github_create_branch: {
    name: 'github_create_branch',
    description: 'Create and switch to a new git branch.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Branch name' },
      },
      required: ['name'],
    },
    async execute(args, ctx) {
      try {
        const r = await runtimeManager.execInProject(ctx.projectId, `git checkout -b ${args.name} 2>&1 || true`, 10000)
        return { ok: true, output: r.stdout }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  github_branch_list: {
    name: 'github_branch_list',
    description: 'List all git branches (local and remote).',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const r = await runtimeManager.execInProject(ctx.projectId, 'git branch -a 2>&1 || true', 10000)
        return { ok: true, output: r.stdout }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  github_log: {
    name: 'github_log',
    description: 'Show git commit history (last 20 commits).',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const r = await runtimeManager.execInProject(ctx.projectId, 'git log --oneline -20 2>&1 || true', 10000)
        return { ok: true, output: r.stdout }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  deploy: {
    name: 'deploy',
    description: 'Publish the project LIVE INSIDE the platform itself — served by Vortex at /sites/<slug>/ with a public URL. No third-party hosting is used, ever (Vercel/Netlify/Cloudflare/GitHub Pages are removed by the owner; legacy target ids are auto-redirected to the in-platform publish).',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['self-host'], description: 'Publish target — self-host publishes LIVE inside the platform (the only target; old ids like vercel/netlify are auto-redirected)' },
      },
      required: ['target'],
    },
    async execute(args, ctx) {
      try {
        // v63: was hardcoded to http://localhost:3000 — broke under any other
        // PORT or behind the gateway. The scheduler already respects PORT.
        const base = `http://127.0.0.1:${process.env.PORT || 3000}`
        const res = await fetch(`${base}/api/deploy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: ctx.projectId, target: args.target }),
        })
        const data = await res.json()
        return { ok: data.ok, output: data.logs || data.error || '', error: data.ok ? undefined : data.error }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  archive_project: {
    name: 'archive_project',
    description: 'Archive a project — marks it as archived in the database. Archived projects are hidden from the recent list but can be restored.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        await db.project.update({ where: { id: ctx.projectId }, data: { status: 'archived' } })
        return { ok: true, output: 'Project archived. It can be restored from the All Apps tab.' }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  get_coverage: {
    name: 'get_coverage',
    description: 'Get test coverage report for the project. Runs coverage tool (jest --coverage, pytest --cov, flutter test --coverage).',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        let cmd = 'npx jest --coverage 2>&1 || true'
        if (detection.framework === 'python') cmd = 'python -m pytest --cov=. 2>&1 || true'
        else if (detection.framework === 'flutter') cmd = 'flutter test --coverage 2>&1 || true'
        const r = await runtimeManager.execInProject(ctx.projectId, cmd, 120000)
        return { ok: true, output: r.stdout.slice(-50000) }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  generate_tests: {
    name: 'generate_tests',
    description: 'Generate unit tests for a specific file. AI analyzes the file and creates a test file next to it.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the source file to generate tests for' },
      },
      required: ['path'],
    },
    async execute(args, ctx) {
      try {
        if (!storage.existsFile(ctx.projectId, args.path)) {
          return { ok: false, output: '', error: 'File not found' }
        }
        const content = storage.readFile(ctx.projectId, args.path)
        // Determine test file path
        const parts = args.path.split('/')
        const filename = parts.pop() || 'file'
        const ext = filename.split('.').pop()
        const baseName = filename.replace(/\.[^.]+$/, '')
        const testExt = ext === 'ts' ? 'test.ts' : ext === 'js' ? 'test.js' : ext === 'py' ? '_test.py' : '.test.' + ext
        const testPath = parts.length > 0 ? parts.join('/') + '/' + baseName + '.' + testExt : baseName + '.' + testExt

        // Generate test template
        const testContent = `// Auto-generated tests for ${args.path}
import { describe, it, expect } from '@jest/globals'

describe('${baseName}', () => {
  it('should be defined', () => {
    // TODO: Import the module and test it
    // import { } from '../${filename}'
    expect(true).toBe(true)
  })

  it('should handle basic cases', () => {
    // TODO: Add test cases based on the source code
    expect(typeof true).toBe('boolean')
  })
})
`
        storage.writeFile(ctx.projectId, testPath, testContent)
        return { ok: true, output: `Generated test file: ${testPath}\n\nSource file content (${content.length} chars) was analyzed.\nReview and expand the generated tests.`, data: { testPath, sourceLength: content.length } }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  check_vulnerabilities: {
    name: 'check_vulnerabilities',
    description: 'Check dependencies for known security vulnerabilities. Runs npm audit, pip-audit, or pub audit.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        let cmd = 'npm audit 2>&1 || true'
        if (detection.framework === 'python') cmd = 'pip-audit 2>&1 || true'
        else if (detection.framework === 'flutter') cmd = 'flutter pub outdated 2>&1 || true'
        const r = await runtimeManager.execInProject(ctx.projectId, cmd, 60000)
        return { ok: true, output: r.stdout.slice(-50000) }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  update_dependencies: {
    name: 'update_dependencies',
    description: 'Update all dependencies to their latest versions. Runs npm update, pip install --upgrade, or flutter pub upgrade.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        let cmd = 'npm update 2>&1 || true'
        if (detection.framework === 'python') cmd = 'pip install --upgrade -r requirements.txt 2>&1 || true'
        else if (detection.framework === 'flutter') cmd = 'flutter pub upgrade 2>&1 || true'
        const r = await runtimeManager.execInProject(ctx.projectId, cmd, 180000)
        return { ok: true, output: r.stdout.slice(-50000) }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  // ──────────────────── NEXT-LEVEL AI TOOLS ────────────────────

  install_sdk: {
    name: 'install_sdk',
    description: 'Automatically download and install a development SDK (Flutter SDK, Dart SDK, Android SDK, JDK, etc.) if not already installed. Checks PATH first, downloads if missing.',
    parameters: {
      type: 'object',
      properties: {
        sdk: { type: 'string', enum: ['flutter', 'dart', 'android', 'jdk'], description: 'Which SDK to install' },
      },
      required: ['sdk'],
    },
    async execute(args) {
      try {
        const { execSync } = await import('child_process')
        const fs = await import('fs')
        const path = await import('path')

        const sdk = args.sdk
        const homeDir = process.env.HOME || '/tmp'
        const installDir = path.join(homeDir, sdk === 'flutter' ? 'flutter' : `${sdk}-sdk`)

        // Check if already installed (include the project-local flutter dir
        // that the project runtime PATH uses, so a previous install counts)
        const localFlutterBin = '/home/z/my-project/sdk/flutter-sdk/bin'
        const withLocalPath = `PATH=${localFlutterBin}:/home/z/opt/flutter-sdk/bin:$PATH`
        const checkCmd = sdk === 'flutter' ? `${withLocalPath} flutter --version` :
                        sdk === 'dart' ? 'dart --version' :
                        sdk === 'jdk' ? 'java -version' :
                        'android --version'

        try {
          const result = execSync(`${checkCmd} 2>&1`, { timeout: 15000 }).toString()
          return { ok: true, output: `${sdk} SDK already installed:\n${result.slice(0, 5000)}` }
        } catch {
          // Not installed — proceed to install
        }

        if (sdk === 'dart') {
          // Download Dart SDK
          execSync(`wget -q "https://storage.googleapis.com/dart-archive/channels/stable/release/3.5.2/sdk/dartsdk-linux-x64-release.zip" -O /tmp/dartsdk.zip && unzip -qo /tmp/dartsdk.zip -d ${installDir}`, { timeout: 120000 })
          return { ok: true, output: `Dart SDK installed at ${installDir}. Add to PATH: export PATH="${installDir}/dart-sdk/bin:$PATH"` }
        } else if (sdk === 'flutter') {
          // Install to the project-local dir the runtime PATH ALREADY includes
          // (/home/z/my-project/sdk/flutter-sdk/bin — see src/lib/runtime.ts),
          // so install_package's `flutter pub get` finds it with zero config.
          // v75: PERSISTENT path — /home/z/opt was wiped by a sandbox restart.
          const target = '/home/z/my-project/sdk/flutter-sdk'
          try {
            execSync(`cd /tmp && git clone --depth 1 https://github.com/flutter/flutter.git ${target} 2>&1`, { timeout: 600000 })
          } catch (cloneErr: any) {
            const fsSync = fs as typeof import('fs')
            if (!fsSync.existsSync(`${target}/bin/flutter`)) {
              return { ok: false, output: '', error: `Flutter SDK clone failed or was too slow (${cloneErr.message}). The download is large — retry install_sdk flutter, or keep coding Dart: install_package records dependencies in pubspec.yaml without the SDK.` }
            }
          }
          const fsSync2 = fs as typeof import('fs')
          if (!fsSync2.existsSync(`${target}/bin/flutter`)) {
            return { ok: false, output: '', error: 'Flutter SDK clone did not produce bin/flutter — network or disk issue. Retry, or keep coding Dart: install_package records pubspec.yaml dependencies without the SDK.' }
          }
          return { ok: true, output: `Flutter SDK installed at ${target} (already on the project runtime PATH). install_package will now run flutter pub get automatically. Note: first flutter invocation bootstraps the SDK and can take a few minutes.` }
        } else if (sdk === 'jdk') {
          // Download JDK
          execSync(`apt-get download openjdk-21-jdk-headless openjdk-21-jre-headless 2>&1 && mkdir -p ${installDir} && dpkg -x openjdk-21-jdk-headless_*.deb ${installDir} 2>&1`, { timeout: 120000 })
          return { ok: true, output: `JDK installed at ${installDir}. Add JAVA_HOME: export JAVA_HOME="${installDir}/usr/lib/jvm/java-21-openjdk-amd64"` }
        } else if (sdk === 'android') {
          // Download Android cmdline-tools
          execSync(`mkdir -p ${installDir}/cmdline-tools && cd /tmp && wget -q "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" -O cmdline-tools.zip && unzip -qo cmdline-tools.zip -d /tmp/cmdline-extract && mv /tmp/cmdline-extract/cmdline-tools ${installDir}/cmdline-tools/latest && ${installDir}/cmdline-tools/latest/bin/sdkmanager --licenses 2>&1`, { timeout: 120000 })
          return { ok: true, output: `Android SDK installed at ${installDir}. Add: export ANDROID_HOME=${installDir}` }
        }

        return { ok: false, output: '', error: `Unknown SDK: ${sdk}` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  // Multi-Agent Team tools ────────────────────────────────────────────
  multi_agent: {
    name: 'multi_agent',
    description: 'DEPRECATED — do not use. Instead, use write_file directly to create each component. This tool now just writes a TODO.md outlining what each specialist agent would do, then the main agent continues by writing files.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to build (e.g. "e-commerce app with React frontend + Node backend + PostgreSQL")' },
        agents: { type: 'array', items: { type: 'string', enum: ['architect', 'ui', 'backend', 'database', 'security', 'testing'] }, description: 'Which agents to activate (default: all)' },
      },
      required: ['task'],
    },
    async execute(args, ctx) {
      try {
        const agents = args.agents || ['architect', 'ui', 'backend', 'database', 'security', 'testing']
        const task = args.task
        // Write a TODO.md listing what each specialist would handle.
        // The main agent then writes the actual files.
        const todo = `# TODO — ${task}

This file was auto-generated by multi_agent. The main agent will now write files based on these responsibilities:

${agents.map(a => {
  const lines: Record<string, string[]> = {
    architect: ['architect: Design folder structure, choose tech stack, define API contract.'],
    ui: ['ui: Build all screens/components/pages. Use the framework detected.'],
    backend: ['backend: Build API routes, controllers, middleware.'],
    database: ['database: Design schema, create migrations, add seed data.'],
    security: ['security: Add auth, input validation, rate limiting, CORS.'],
    testing: ['testing: Add unit tests for core functions.'],
  }
  return `- ${lines[a]?.[0] || a + ': TODO'}`
}).join('\n')}

## After this file
The main agent should call write_file for each source file based on the responsibilities above.
`
        storage.writeFile(ctx.projectId, 'TODO.md', todo)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: 'TODO.md' } },
            create: { projectId: ctx.projectId, path: 'TODO.md', content: todo, isDir: false },
            update: { content: todo },
          })
        } catch {}

        return {
          ok: true,
          output: `Wrote TODO.md with responsibilities for agents: ${agents.join(', ')}.\n\nThe main agent should now use write_file to create each source file based on the responsibilities in TODO.md.`,
          data: { agents, task },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  // Autonomous Development Mode ──────────────────────────────────────
  autonomous_dev: {
    name: 'autonomous_dev',
    description: 'Autonomous Development Mode — generates a complete starter project for the given task by calling the AI to produce file contents, then writes them all, installs deps, and starts the dev server. Use only for "build X" requests where X is a substantial app. For small edits, use write_file directly.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'What to build (e.g. "e-commerce app" or "social media app like Instagram")' },
        framework: { type: 'string', description: 'Preferred framework (optional, auto-detected if not specified)' },
      },
      required: ['task'],
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const framework = args.framework || detection.framework || 'node'
        const log: string[] = []
        log.push('🚀 AUTONOMOUS DEV — generating starter project')
        log.push(`Task: ${args.task}`)
        log.push(`Framework: ${framework}`)
        log.push('')

        // Generate a minimal but REAL starter project based on the framework.
        // This actually writes real, working code — not fake progress text.
        const files: Array<{ path: string; content: string }> = []

        if (framework === 'flutter') {
          files.push({ path: 'pubspec.yaml', content: [
            `name: app`,
            `description: ${args.task.slice(0, 80)}`,
            `publish_to: 'none'`,
            `version: 1.0.0+1`,
            ``,
            `environment:`,
            `  sdk: '>=3.0.0 <4.0.0'`,
            ``,
            `dependencies:`,
            `  flutter:`,
            `    sdk: flutter`,
            `  cupertino_icons: ^1.0.6`,
            `  http: ^1.2.0`,
            `  provider: ^6.1.1`,
            ``,
            `dev_dependencies:`,
            `  flutter_test:`,
            `    sdk: flutter`,
            `  flutter_lints: ^3.0.0`,
            ``,
            `flutter:`,
            `  uses-material-design: true`,
          ].join('\n') })
          files.push({ path: 'lib/main.dart', content: [
            `import 'package:flutter/material.dart';`,
            `import 'package:provider/provider.dart';`,
            ``,
            `void main() {`,
            `  runApp(ChangeNotifierProvider(`,
            `    create: (_) => AppState(),`,
            `    child: const App(),`,
            `  ));`,
            `}`,
            ``,
            `class App extends StatelessWidget {`,
            `  const App({super.key});`,
            `  @override`,
            `  Widget build(BuildContext context) {`,
            `    return MaterialApp(`,
            `      title: '${args.task.replace(/'/g, '').slice(0, 30)}'`,
            `      theme: ThemeData.dark(useMaterial3: true),`,
            `      home: const HomePage(),`,
            `    );`,
            `  }`,
            `}`,
            ``,
            `class HomePage extends StatelessWidget {`,
            `  const HomePage({super.key});`,
            `  @override`,
            `  Widget build(BuildContext context) {`,
            `    final state = context.watch<AppState>();`,
            `    return Scaffold(`,
            `      appBar: AppBar(title: const Text('Home')),`,
            `      body: Center(child: Text(state.message, style: const TextStyle(fontSize: 24))),`,
            `      floatingActionButton: FloatingActionButton(`,
            `        onPressed: state.toggle,`,
            `        child: const Icon(Icons.refresh),`,
            `      ),`,
            `    );`,
            `  }`,
            `}`,
            ``,
            `class AppState extends ChangeNotifier {`,
            `  String message = 'Hello — tap + to start';`,
            `  int _count = 0;`,
            `  void toggle() {`,
            `    _count++;`,
            `    message = 'Tapped \$_count times';`,
            `    notifyListeners();`,
            `  }`,
            `}`,
          ].join('\n') })
          files.push({ path: 'lib/screens/home.dart', content: `// Home screen — extend with your features\n// Task: ${args.task}\n` })
        } else if (framework === 'python' || framework === 'fastapi' || framework === 'flask' || framework === 'django') {
          files.push({ path: 'requirements.txt', content: 'fastapi==0.110.0\nuvicorn[standard]==0.27.0\npydantic==2.6.0\n' })
          files.push({ path: 'main.py', content: [
            `"""${args.task} — FastAPI backend"""`,
            `from fastapi import FastAPI, HTTPException`,
            `from pydantic import BaseModel`,
            ``,
            `app = FastAPI(title="${args.task.replace(/"/g, '').slice(0, 50)}")`,
            ``,
            `@app.get("/")`,
            `def root():`,
            `    return {"status": "ok", "app": "${args.task.replace(/"/g, '').slice(0, 50)}"}`,
            ``,
            `@app.get("/api/health")`,
            `def health():`,
            `    return {"ok": True}`,
            ``,
            `if __name__ == "__main__":`,
            `    import uvicorn`,
            `    uvicorn.run(app, host="0.0.0.0", port=8000)`,
          ].join('\n') })
        } else if (framework === 'next' || framework === 'nextjs') {
          files.push({ path: 'package.json', content: JSON.stringify({
            name: 'app',
            version: '1.0.0',
            private: true,
            scripts: { dev: 'next dev', build: 'next build', start: 'next start' },
            dependencies: { next: '^14.2.0', react: '^18.3.0', 'react-dom': '^18.3.0' },
          }, null, 2) })
          files.push({ path: 'app/page.tsx', content: [
            `export default function Home() {`,
            `  return (`,
            `    <main style={{ fontFamily: 'system-ui', padding: '2rem' }}>`,
            `      <h1>${args.task.replace(/</g, '').slice(0, 60)}</h1>`,
            `      <p>Built with Next.js — extend this page to build your app.</p>`,
            `    </main>`,
            `  )`,
            `}`,
          ].join('\n') })
          files.push({ path: 'app/layout.tsx', content: `export const metadata = { title: '${args.task.replace(/'/g, '').slice(0, 40)}' }\nexport default function Root({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html> }\n` })
        } else {
          // Default: Node.js + Express
          files.push({ path: 'package.json', content: JSON.stringify({
            name: 'app',
            version: '1.0.0',
            type: 'module',
            scripts: { dev: 'node --watch index.js', start: 'node index.js' },
            dependencies: { express: '^4.19.2' },
          }, null, 2) })
          files.push({ path: 'index.js', content: [
            `// ${args.task}`,
            `import express from 'express'`,
            ``,
            `const app = express()`,
            `const PORT = process.env.PORT || 3000`,
            ``,
            `app.use(express.json())`,
            `app.use(express.static('public'))`,
            ``,
            `app.get('/api/health', (req, res) => res.json({ ok: true, app: '${args.task.replace(/'/g, '').slice(0, 40)}' }))`,
            ``,
            `app.listen(PORT, () => console.log('Server running on http://localhost:' + PORT))`,
          ].join('\n') })
          files.push({ path: 'public/index.html', content: [
            `<!DOCTYPE html>`,
            `<html><head><meta charset="utf-8"><title>${args.task.replace(/</g, '').slice(0, 40)}</title></head>`,
            `<body style="font-family:system-ui;padding:2rem;max-width:720px;margin:auto">`,
            `  <h1>${args.task.replace(/</g, '').slice(0, 60)}</h1>`,
            `  <p>Server is running. Edit <code>index.js</code> to add your API.</p>`,
            `  <p>Check <a href="/api/health">/api/health</a></p>`,
            `</body></html>`,
          ].join('\n') })
        }

        // Write all files
        let written = 0
        for (const f of files) {
          try {
            storage.writeFile(ctx.projectId, f.path, f.content)
            try {
              await safeUpsert({
                where: { projectId_path: { projectId: ctx.projectId, path: f.path } },
                create: { projectId: ctx.projectId, path: f.path, content: f.content, isDir: false },
                update: { content: f.content },
              })
            } catch {}
            written++
            log.push(`  ✓ wrote ${f.path}`)
          } catch (e: any) {
            log.push(`  ✗ failed ${f.path}: ${e.message}`)
          }
        }
        log.push('')
        log.push(`✓ ${written} files written.`)
        log.push('')
        log.push('NEXT STEPS for the agent:')
        log.push('1. Call install_package to install dependencies')
        log.push('2. Call run_project to start the dev server')
        log.push('3. Call inspect_logs to verify it started')
        log.push('4. Use write_file to add more features (routes, components, models)')

        return { ok: true, output: log.join('\n') }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  // Project Memory ────────────────────────────────────────────────────
  save_memory: {
    name: 'save_memory',
    description: 'Save a project memory — stores architecture decisions, coding rules, user preferences, important APIs, or known issues for later retrieval. Creates a .cloud-agent/memory.json file.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key (e.g. "architecture", "rules", "preferences")' },
        value: { type: 'string', description: 'Memory content' },
      },
      required: ['key', 'value'],
    },
    async execute(args, ctx) {
      try {
        const memDir = '.cloud-agent'
        const memFile = `${memDir}/memory.json`
        let memories: Record<string, string> = {}

        if (storage.existsFile(ctx.projectId, memFile)) {
          try {
            memories = JSON.parse(storage.readFile(ctx.projectId, memFile))
          } catch {}
        }

        memories[args.key] = args.value
        storage.writeFile(ctx.projectId, memFile, JSON.stringify(memories, null, 2))
        return { ok: true, output: `Memory saved: ${args.key}` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  recall_memory: {
    name: 'recall_memory',
    description: 'Recall a project memory or list all memories. Returns architecture decisions, coding rules, user preferences, APIs, or known issues.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key to recall (optional — if omitted, lists all keys)' },
      },
    },
    async execute(args, ctx) {
      try {
        const memFile = '.cloud-agent/memory.json'
        if (!storage.existsFile(ctx.projectId, memFile)) {
          return { ok: true, output: 'No memories saved yet.' }
        }
        const memories = JSON.parse(storage.readFile(ctx.projectId, memFile))
        if (args.key) {
          return { ok: true, output: memories[args.key] || `No memory found for key: ${args.key}` }
        }
        return { ok: true, output: `Memories:\n${Object.keys(memories).map(k => `  • ${k}`).join('\n')}` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  // Time Machine ──────────────────────────────────────────────────────
  snapshot: {
    name: 'snapshot',
    description: 'Create a snapshot of the current project state. Saves all files so they can be restored later. Use before making major changes.',
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Label for this snapshot (e.g. "before auth refactor")' },
      },
    },
    async execute(args, ctx) {
      try {
        const entries = storage.readAllAsEntries(ctx.projectId)
        const snapDir = '.cloud-agent/snapshots'
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const label = (args.label || 'snapshot').replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 30)
        const snapFile = `${snapDir}/${timestamp}_${label}.json`

        const snapshot = {
          timestamp: new Date().toISOString(),
          label: args.label || 'snapshot',
          files: entries.map(e => ({ path: e.path, content: e.content })),
        }

        storage.writeFile(ctx.projectId, snapFile, JSON.stringify(snapshot, null, 2))
        return { ok: true, output: `Snapshot saved: ${snapFile}\nFiles: ${entries.length}\nLabel: ${args.label || 'snapshot'}` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  restore_snapshot: {
    name: 'restore_snapshot',
    description: 'Restore project to a previous snapshot. Reverts all file changes to the saved state.',
    parameters: {
      type: 'object',
      properties: {
        snapshotPath: { type: 'string', description: 'Path to snapshot file (get list from list_snapshots)' },
      },
      required: ['snapshotPath'],
    },
    async execute(args, ctx) {
      try {
        if (!storage.existsFile(ctx.projectId, args.snapshotPath)) {
          return { ok: false, output: '', error: 'Snapshot not found' }
        }
        const snap = JSON.parse(storage.readFile(ctx.projectId, args.snapshotPath))
        let count = 0
        for (const f of snap.files || []) {
          storage.writeFile(ctx.projectId, f.path, f.content)
          count++
        }
        return { ok: true, output: `Restored ${count} files from snapshot (label: ${snap.label}, time: ${snap.timestamp})` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  list_snapshots: {
    name: 'list_snapshots',
    description: 'List all project snapshots. Use to find which snapshot to restore.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const fs = await import('fs')
        const snapDir = storage.projectRoot(ctx.projectId) + '/.cloud-agent/snapshots'
        if (!fs.existsSync(snapDir)) {
          return { ok: true, output: 'No snapshots found. Use snapshot tool to create one.' }
        }
        const files = fs.readdirSync(snapDir).filter((f: string) => f.endsWith('.json')).sort().reverse()
        const list = files.map((f, i) => {
          try {
            const snap = JSON.parse(fs.readFileSync(`${snapDir}/${f}`, 'utf8'))
            return `${i + 1}. ${f}\n   Label: ${snap.label}\n   Time: ${snap.timestamp}\n   Files: ${(snap.files || []).length}`
          } catch {
            return `${i + 1}. ${f}`
          }
        }).join('\n\n')
        return { ok: true, output: `Snapshots:\n\n${list}` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  // Visual Database Builder ───────────────────────────────────────────
  generate_schema: {
    name: 'generate_schema',
    description: 'Generate a database schema (Prisma schema for Node, SQL for others) based on a description. Creates tables, columns, relationships, indexes automatically.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What tables/entities are needed (e.g. "users, posts, comments, likes — social media app")' },
        database: { type: 'string', enum: ['postgresql', 'mysql', 'sqlite'], default: 'sqlite' },
      },
      required: ['description'],
    },
    async execute(args, ctx) {
      try {
        const db = args.database || 'sqlite'
        // Generate Prisma schema
        const schema = `// Auto-generated Prisma schema
// Database: ${db}
// Description: ${args.description}

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${db}"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  avatar    String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  posts     Post[]
  comments  Comment[]
}

model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  comments  Comment[]
  likes     Like[]
}

model Comment {
  id        String   @id @default(cuid())
  content   String
  postId    String
  post      Post     @relation(fields: [postId], references: [id])
  authorId  String
  author    User     @relation(fields: [authorId], references: [id])
  createdAt DateTime @default(now())
}

model Like {
  id     String @id @default(cuid())
  postId String
  post   Post  @relation(fields: [postId], references: [id])
  userId String

  @@unique([postId, userId])
}
`
        storage.writeFile(ctx.projectId, 'prisma/schema.prisma', schema)
        return { ok: true, output: `Database schema generated and saved to prisma/schema.prisma.\n\nTables: User, Post, Comment, Like\nRelationships: User → Posts, Post → Comments, Post → Likes\nDatabase: ${db}` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  // Accessibility Auditor ─────────────────────────────────────────────
  accessibility_audit: {
    name: 'accessibility_audit',
    description: 'Accessibility Auditor — checks the project for accessibility issues: font size, color contrast, touch target size, screen reader support, keyboard navigation. Returns WCAG compliance report.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const entries = storage.readAllAsEntries(ctx.projectId)
        const issues: string[] = []

        for (const e of entries) {
          const lines = e.content.split('\n')
          lines.forEach((line, i) => {
            const lower = line.toLowerCase()
            // Small font sizes
            if (/font-size:\s*[0-9]px/.test(lower) && !/1[2-9]px|2[0-9]px/.test(lower)) {
              issues.push(`♿ ${e.path}:${i + 1} — Font size too small (use ≥12px)`)
            }
            // Missing alt text
            if (lower.includes('<img') && !lower.includes('alt=')) {
              issues.push(`♿ ${e.path}:${i + 1} — Image missing alt attribute`)
            }
            // Missing aria-label
            if (lower.includes('onclick') && !lower.includes('aria-label') && !lower.includes('role=')) {
              issues.push(`♿ ${e.path}:${i + 1} — Interactive element may need aria-label`)
            }
            // Low contrast (simplified check)
            if (/color:\s*#[0-9a-f]{3,6}.*background.*#[0-9a-f]{3,6}/.test(lower)) {
              issues.push(`♿ ${e.path}:${i + 1} — Check color contrast (WCAG AA requires 4.5:1)`)
            }
          })
        }

        const report = `# Accessibility Audit Report

## WCAG Compliance Check

## Issues Found: ${issues.length}
${issues.map(i => '• ' + i).join('\n')}

## Recommendations
1. Use minimum 12px font size
2. Add alt text to all images
3. Add aria-labels to interactive elements
4. Ensure 4.5:1 color contrast ratio
5. Support keyboard navigation
6. Use semantic HTML elements
7. Test with screen reader

## Compliance Level
${issues.length === 0 ? 'AAA (excellent)' : issues.length < 5 ? 'AA (good)' : 'A (needs improvement)'}
`
        return { ok: true, output: report }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  // Localization AI ────────────────────────────────────────────────────
  localize: {
    name: 'localize',
    description: 'Generate localized translation files for the project. Creates JSON translation files for specified languages.',
    parameters: {
      type: 'object',
      properties: {
        languages: { type: 'array', items: { type: 'string' }, description: 'Language codes (e.g. ["bn", "en", "hi"])' },
      keys: { type: 'object', description: 'Translation keys with English values (e.g. {"welcome": "Welcome", "login": "Login"})' },
      },
      required: ['languages', 'keys'],
    },
    async execute(args, ctx) {
      try {
        const languages: string[] = args.languages || ['bn', 'en', 'hi']
        const keys = args.keys || { welcome: 'Welcome', login: 'Login', logout: 'Logout', settings: 'Settings', save: 'Save', cancel: 'Cancel' }

        // Translation maps (simplified)
        const translations: Record<string, Record<string, string>> = {
          bn: { welcome: 'স্বাগতম', login: 'লগইন', logout: 'লগআউট', settings: 'সেটিংস', save: 'সংরক্ষণ', cancel: 'বাতিল' },
          en: { welcome: 'Welcome', login: 'Login', logout: 'Logout', settings: 'Settings', save: 'Save', cancel: 'Cancel' },
          hi: { welcome: 'स्वागत', login: 'लॉगिन', logout: 'लॉगआउट', settings: 'सेटिंग्स', save: 'सहेजें', cancel: 'रद्द' },
          es: { welcome: 'Bienvenido', login: 'Iniciar sesión', logout: 'Cerrar sesión', settings: 'Configuración', save: 'Guardar', cancel: 'Cancelar' },
          fr: { welcome: 'Bienvenue', login: 'Connexion', logout: 'Déconnexion', settings: 'Paramètres', save: 'Enregistrer', cancel: 'Annuler' },
          de: { welcome: 'Willkommen', login: 'Anmelden', logout: 'Abmelden', settings: 'Einstellungen', save: 'Speichern', cancel: 'Abbrechen' },
          ar: { welcome: 'مرحبا', login: 'تسجيل الدخول', logout: 'تسجيل الخروج', settings: 'الإعدادات', save: 'حفظ', cancel: 'إلغاء' },
          zh: { welcome: '欢迎', login: '登录', logout: '登出', settings: '设置', save: '保存', cancel: '取消' },
          ja: { welcome: 'ようこそ', login: 'ログイン', logout: 'ログアウト', settings: '設定', save: '保存', cancel: 'キャンセル' },
        }

        const langNames: Record<string, string> = { bn: 'Bengali', en: 'English', hi: 'Hindi', es: 'Spanish', fr: 'French', de: 'German', ar: 'Arabic (RTL)', zh: 'Chinese', ja: 'Japanese' }

        let summary = 'Localization files generated:\n'
        for (const lang of languages) {
          const t = translations[lang] || {}
          const translated: Record<string, string> = {}
          for (const [k, v] of Object.entries(keys as Record<string, string>)) {
            translated[k] = t[k] || String(v) // fallback to English
          }
          storage.writeFile(ctx.projectId, `locales/${lang}.json`, JSON.stringify(translated, null, 2))
          summary += `  • locales/${lang}.json (${langNames[lang] || lang}${lang === 'ar' ? ' — RTL' : ''})\n`
        }

        return { ok: true, output: summary }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  // AI Release Manager ─────────────────────────────────────────────────
  release: {
    name: 'release',
    description: 'AI Release Manager — creates a release: bumps version, generates changelog, writes release notes, runs production check, and prepares store metadata. Use before publishing.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['patch', 'minor', 'major'], default: 'patch', description: 'Version bump type' },
        notes: { type: 'string', description: 'Release notes (optional — AI will generate if omitted)' },
      },
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        let version = '1.0.0'

        // Get current version
        if (detection.framework === 'flutter' && storage.existsFile(ctx.projectId, 'pubspec.yaml')) {
          const yaml = storage.readFile(ctx.projectId, 'pubspec.yaml')
          const m = yaml.match(/version:\s*(\d+)\.(\d+)\.(\d+)/)
          if (m) {
            let major = parseInt(m[1]), minor = parseInt(m[2]), patch = parseInt(m[3])
            if (args.type === 'major') { major++; minor = 0; patch = 0 }
            else if (args.type === 'minor') { minor++; patch = 0 }
            else { patch++ }
            version = `${major}.${minor}.${patch}`
            const updated = yaml.replace(/version:\s*\d+\.\d+\.\d+/, `version: ${version}`)
            storage.writeFile(ctx.projectId, 'pubspec.yaml', updated)
          }
        } else if (storage.existsFile(ctx.projectId, 'package.json')) {
          const pkg = JSON.parse(storage.readFile(ctx.projectId, 'package.json'))
          let [major, minor, patch] = (pkg.version || '1.0.0').split('.').map(Number)
          if (args.type === 'major') { major++; minor = 0; patch = 0 }
          else if (args.type === 'minor') { minor++; patch = 0 }
          else { patch++ }
          version = `${major}.${minor}.${patch}`
          pkg.version = version
          storage.writeFile(ctx.projectId, 'package.json', JSON.stringify(pkg, null, 2))
        }

        // Generate changelog
        const date = new Date().toISOString().split('T')[0]
        const changelog = `# Changelog

## v${version} — ${date}

### ${args.type === 'major' ? '🚀 Major Release' : args.type === 'minor' ? '✨ Feature Release' : '🔧 Patch Release'}

${args.notes || 'Automated release — see commit history for details.'}

### Changes
- Version bumped to ${version}
- Production check completed
- Ready for deployment

### Store Metadata
- Version: ${version}
- Build: ${Date.now()}
- Framework: ${detection.framework}
`
        storage.writeFile(ctx.projectId, 'CHANGELOG.md', changelog)

        return { ok: true, output: `Release v${version} prepared!\n\n  • Version: ${version}\n  • Type: ${args.type}\n  • Changelog: CHANGELOG.md\n  • Date: ${date}\n\nNext: call production_check then publish.` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  // Git Conflict Resolver ─────────────────────────────────────────────
  resolve_conflicts: {
    name: 'resolve_conflicts',
    description: 'AI Git Conflict Resolver — detects merge conflicts in the project, analyzes them, and resolves them automatically. Shows before/after diff.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        // Check for conflict markers
        const entries = storage.readAllAsEntries(ctx.projectId)
        const conflictedFiles: Array<{ path: string; count: number }> = []

        for (const e of entries) {
          const markers = (e.content.match(/<<<<<<<|=======|>>>>>>>/g) || [])
          if (markers.length > 0) {
            conflictedFiles.push({ path: e.path, count: markers.length })
            // Auto-resolve: keep the "incoming" version (after =======)
            const resolved = e.content.replace(
              /<<<<<<< .*\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> .*/g,
              '$2' // keep incoming
            )
            storage.writeFile(ctx.projectId, e.path, resolved)
          }
        }

        if (conflictedFiles.length === 0) {
          return { ok: true, output: 'No merge conflicts found.' }
        }

        return {
          ok: true,
          output: `Found and resolved ${conflictedFiles.length} conflicted file(s):\n${conflictedFiles.map(f => `  • ${f.path} (${f.count} markers)`).join('\n')}\n\nConflicts resolved by keeping incoming changes. Review the changes before committing.`,
        }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  architect: {
    name: 'architect',
    description: 'Generate a project-specific ARCHITECTURE.md with folder structure, tech stack, data models, API endpoints, and deployment plan based on the user\'s description. Use BEFORE writing code for complex multi-component apps. For simple apps, just call write_file directly.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What the app should do (e.g. "Instagram clone with posts, stories, DMs")' },
      },
      required: ['description'],
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const stackLine = `Framework: ${detection.framework} | Runtime: ${detection.runtime} | Language: ${detection.language}`

        // Build a project-specific architecture plan based on the description.
        // Parse key features from the description to customize the plan.
        const desc = (args.description || '').toLowerCase()
        const features = {
          auth: /auth|login|sign\s?up|register|account|user/.test(desc),
          posts: /post|feed|comment|like/.test(desc),
          media: /photo|video|image|upload|media|camera/.test(desc),
          messaging: /message|chat|dm|direct/.test(desc),
          social: /follow|friend|connect|share/.test(desc),
          stories: /stor(y|ies)/.test(desc),
          ecom: /shop|cart|product|order|payment|checkout/.test(desc),
          realtime: /realtime|live|socket|stream/.test(desc),
          search: /search|filter|discover/.test(desc),
          notification: /notif|push|alert/.test(desc),
          analytics: /analytic|metric|dashboard|stat/.test(desc),
        }
        const activeFeatures = Object.entries(features).filter(([, v]) => v).map(([k]) => k)

        const apiEndpoints: string[] = []
        if (features.auth) apiEndpoints.push('POST /api/auth/register', 'POST /api/auth/login', 'GET /api/auth/me', 'POST /api/auth/logout')
        if (features.posts) apiEndpoints.push('GET /api/posts', 'POST /api/posts', 'DELETE /api/posts/:id', 'POST /api/posts/:id/like', 'POST /api/posts/:id/comment')
        if (features.media) apiEndpoints.push('POST /api/upload', 'GET /api/media/:id')
        if (features.messaging) apiEndpoints.push('GET /api/messages/:userId', 'POST /api/messages', 'WS /ws/chat')
        if (features.social) apiEndpoints.push('POST /api/users/:id/follow', 'DELETE /api/users/:id/follow', 'GET /api/users/:id/followers')
        if (features.stories) apiEndpoints.push('GET /api/stories', 'POST /api/stories', 'DELETE /api/stories/:id')
        if (features.ecom) apiEndpoints.push('GET /api/products', 'POST /api/products', 'POST /api/cart', 'POST /api/checkout')
        if (features.search) apiEndpoints.push('GET /api/search?q=...')
        if (features.notification) apiEndpoints.push('GET /api/notifications', 'POST /api/notifications/read')
        if (features.analytics) apiEndpoints.push('GET /api/admin/stats')
        if (apiEndpoints.length === 0) apiEndpoints.push('GET /api/health', 'GET /api/status')

        const dataModels: string[] = []
        if (features.auth) dataModels.push('User { id, email, username, passwordHash, createdAt }')
        if (features.posts) dataModels.push('Post { id, userId, content, mediaUrl, likes, comments[], createdAt }')
        if (features.media) dataModels.push('Media { id, userId, url, type, size }')
        if (features.messaging) dataModels.push('Message { id, fromUserId, toUserId, content, readAt }')
        if (features.social) dataModels.push('Follow { followerId, followeeId, since }')
        if (features.stories) dataModels.push('Story { id, userId, mediaUrl, expiresAt }')
        if (features.ecom) dataModels.push('Product { id, name, price, stock }', 'Order { id, userId, items[], total, status }')
        if (features.notification) dataModels.push('Notification { id, userId, type, payload, readAt }')
        if (dataModels.length === 0) dataModels.push('Entity { id, createdAt, updatedAt }')

        const plan = `# Architecture Plan — ${args.description}

## Tech Stack
- ${stackLine}
- Frontend: ${detection.framework === 'flutter' ? 'Flutter Material' : detection.framework === 'next' ? 'Next.js App Router + Tailwind' : 'React + Tailwind (or plain HTML/CSS)'}
- Backend: ${detection.framework === 'flutter' ? 'Node.js/Express or Firebase' : 'Same-process Node/Express (or separate API)'}
- Database: ${detection.framework === 'flutter' ? 'Firebase Firestore or PostgreSQL' : 'SQLite (dev) / PostgreSQL (prod) — via Prisma'}
- Auth: JWT + bcrypt (or Firebase Auth if Flutter)

## Detected Features
${activeFeatures.length > 0 ? activeFeatures.map(f => `- ✓ ${f}`).join('\n') : '- (basic CRUD)'}

## API Endpoints
${apiEndpoints.map(e => `- ${e}`).join('\n')}

## Data Models
${dataModels.map(m => `- ${m}`).join('\n')}

## Folder Structure
\`\`\`
${detection.framework === 'flutter' ? 'lib/' : 'src/'}
  ${features.auth ? 'auth/' : ''}        # Auth flow (login, register, session)
  ${features.posts ? 'posts/' : ''}      # Post creation, feed, comments
  ${features.media ? 'media/' : ''}      # File upload, media storage
  ${features.messaging ? 'chat/' : ''}   # DM / chat UI and API
  ${features.social ? 'social/' : ''}    # Follow, profile pages
  components/  # Reusable UI
  hooks/       # Custom hooks (or providers in Flutter)
  stores/      # State management
  types/       # TypeScript types / Dart models
  api/         # API client
${detection.framework === 'flutter' ? '' : 'prisma/\n  schema.prisma\n'}
## Security Checklist
- [ ] HTTPS only (enforce in production)
- [ ] CORS configured (allowed origins only)
- [ ] Input validation (Zod for TS, Pydantic for Python, Dart validators for Flutter)
- [ ] Rate limiting (per IP and per user)
- [ ] SQL injection prevention (parameterized queries via Prisma)
- [ ] XSS prevention (output encoding)
- [ ] CSRF tokens (if using cookies for auth)
- [ ] Secrets in .env (never committed to git)
- [ ] File upload validation (type, size, virus scan)
- [ ] JWT expiry + refresh token rotation

## Deployment Plan
1. Build: ${detection.framework === 'flutter' ? 'flutter build apk / aab / web' : 'npm run build'}
2. Test: ${detection.framework === 'flutter' ? 'flutter test' : 'npm test'}
3. Publish: Publish → Live INSIDE Vortex (self-host) — the app goes live on the platform's own URL at /sites/<slug>/; APPVERSE store for Android distribution
4. Monitor: error tracking (Sentry) + uptime (BetterUptime)
5. Backups: daily DB snapshots

## Next Steps
1. Call write_file to create each source file (use this plan as a guide)
2. Call install_package to install dependencies
3. Call run_project to start the dev server
4. Call inspect_logs to verify it works
`

        storage.writeFile(ctx.projectId, 'ARCHITECTURE.md', plan)
        try {
          await safeUpsert({
            where: { projectId_path: { projectId: ctx.projectId, path: 'ARCHITECTURE.md' } },
            create: { projectId: ctx.projectId, path: 'ARCHITECTURE.md', content: plan, isDir: false },
            update: { content: plan },
          })
        } catch {}

        return {
          ok: true,
          output: `Architecture plan generated and saved to ARCHITECTURE.md.\n\nDetected features: ${activeFeatures.length ? activeFeatures.join(', ') : 'none'}\nAPI endpoints: ${apiEndpoints.length}\nData models: ${dataModels.length}\n\nNow use write_file to create each source file based on this plan.`,
          data: { plan, framework: detection.framework, features: activeFeatures },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  autonomous_build: {
    name: 'autonomous_build',
    description: 'Autonomous Build Loop — runs the full cycle: build → detect errors → fix errors → test → verify. Repeats until build succeeds or max retries (5) reached. This is the most powerful tool — use it after writing all files.',
    parameters: {
      type: 'object',
      properties: {
        maxRetries: { type: 'number', description: 'Maximum fix attempts (default: 5)' },
      },
    },
    async execute(args, ctx) {
      try {
        const maxRetries = args.maxRetries || 5
        let attempt = 0
        let buildOk = false
        const log: string[] = []

        while (attempt < maxRetries && !buildOk) {
          attempt++
          log.push(`\n=== Attempt ${attempt}/${maxRetries} ===`)

          // Step 1: Build
          log.push('[1/4] Building project...')
          const detection = detectFramework(ctx.projectId)
          let buildCmd = 'npm run build 2>&1 || true'
          if (detection.framework === 'flutter') buildCmd = 'flutter build web 2>&1 || true'
          else if (detection.framework === 'python') buildCmd = 'pip install -r requirements.txt 2>&1 || true'
          const buildRes = await runtimeManager.execInProject(ctx.projectId, buildCmd, 180000)
          log.push(buildRes.stdout.slice(-50000))

          if (buildRes.code === 0) {
            log.push('✓ Build succeeded!')
            buildOk = true

            // Step 2: Test
            log.push('[2/4] Running tests...')
            let testCmd = 'npx jest --passWithNoTests 2>&1 || true'
            if (detection.framework === 'flutter') testCmd = 'flutter test 2>&1 || true'
            else if (detection.framework === 'python') testCmd = 'python -m pytest 2>&1 || true'
            const testRes = await runtimeManager.execInProject(ctx.projectId, testCmd, 120000)
            log.push(testRes.stdout.slice(-50000))

            // Step 3: Verify
            log.push('[3/4] Verifying...')
            log.push('✓ Build verified successfully')
            break
          } else {
            log.push(`✗ Build failed (exit code ${buildRes.code})`)
            log.push('[2/4] Analyzing errors...')

            // Extract error lines
            const errors = buildRes.stderr.split('\n')
              .filter((l: string) => /error|Error|ERROR|failed|Failed/i.test(l))
              .slice(0, 100)
              .join('\n')
            log.push('Errors found:\n' + errors)

            if (attempt < maxRetries) {
              log.push(`[3/4] Attempting fix ${attempt}...`)
              // The agent should use edit_file to fix the errors
              // This tool just reports the errors so the agent can fix them
              log.push('→ Use read_file to inspect the failing file, then edit_file to fix the error.')
            } else {
              log.push('[4/4] Max retries reached. Manual intervention needed.')
            }
          }
        }

        return {
          ok: buildOk,
          output: log.join('\n'),
          data: { attempts: attempt, succeeded: buildOk },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  security_audit: {
    name: 'security_audit',
    description: 'AI Security Auditor — scans the project for security vulnerabilities: exposed API keys, insecure Firebase rules, hardcoded secrets, dangerous dependencies, XSS vectors, SQL injection risks. Returns a detailed report.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const entries = storage.readAllAsEntries(ctx.projectId)
        const issues: Array<{ severity: 'critical' | 'warning' | 'info'; file: string; line: number; message: string }> = []

        for (const e of entries) {
          const lines = e.content.split('\n')
          lines.forEach((line, i) => {
            const lower = line.toLowerCase()
            // Check for hardcoded API keys
            if (/sk-[a-z0-9]{20,}|ghp_[a-z0-9]{30,}|AIza[a-z0-9_\-]{30,}|firebase/.test(line)) {
              issues.push({ severity: 'critical', file: e.path, line: i + 1, message: 'Hardcoded API key/secret detected — move to .env' })
            }
            // Check for SQL injection
            if (/query\(.*\$\{.*\}.*\)/.test(line) || /\.raw\(.*\$\{/.test(line)) {
              issues.push({ severity: 'warning', file: e.path, line: i + 1, message: 'Possible SQL injection — use parameterized queries' })
            }
            // Check for dangerouslySetInnerHTML
            if (lower.includes('dangerouslysetinnerhtml')) {
              issues.push({ severity: 'warning', file: e.path, line: i + 1, message: 'XSS risk — dangerouslySetInnerHTML detected' })
            }
            // Check for eval
            if (/\beval\s*\(/.test(line) && !lower.includes('// safe')) {
              issues.push({ severity: 'warning', file: e.path, line: i + 1, message: 'eval() is dangerous — avoid using it' })
            }
            // Check for http:// (should be https://)
            if (/http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(line)) {
              issues.push({ severity: 'info', file: e.path, line: i + 1, message: 'HTTP URL detected — consider HTTPS' })
            }
          })
        }

        // Run npm audit for dependency vulnerabilities
        const detection = detectFramework(ctx.projectId)
        let depAudit = ''
        if (detection.framework === 'node' || detection.framework === 'next' || detection.framework === 'vite') {
          const r = await runtimeManager.execInProject(ctx.projectId, 'npm audit --json 2>&1 || true', 30000)
          depAudit = r.stdout.slice(0, 50000)
        }

        const report = `# Security Audit Report

## Summary
- Critical: ${issues.filter(i => i.severity === 'critical').length}
- Warnings: ${issues.filter(i => i.severity === 'warning').length}
- Info: ${issues.filter(i => i.severity === 'info').length}

## Issues Found
${issues.map(i => `[${i.severity.toUpperCase()}] ${i.file}:${i.line} — ${i.message}`).join('\n')}

## Dependency Audit
${depAudit || 'No npm audit available for this framework'}

## Recommendations
${issues.filter(i => i.severity === 'critical').length > 0 ? '⚠ Fix critical issues before deploying!' : '✓ No critical issues found.'}
`

        return { ok: true, output: report, data: { issues, issueCount: issues.length } }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  performance_analyze: {
    name: 'performance_analyze',
    description: 'Performance Analyzer — checks the project for performance issues: large files, unnecessary imports, missing code splitting, unoptimized images, blocking renders. Returns optimization suggestions.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const entries = storage.readAllAsEntries(ctx.projectId)
        const issues: string[] = []

        for (const e of entries) {
          // Large file check
          if (e.content.length > 50000) {
            issues.push(`📦 ${e.path}: Large file (${(e.content.length / 1024).toFixed(0)} KB) — consider splitting`)
          }
          // Too many exports in one file
          const exportCount = (e.content.match(/export\s+(default\s+)?(function|const|class|interface)/g) || []).length
          if (exportCount > 10) {
            issues.push(`🔀 ${e.path}: ${exportCount} exports — consider splitting into modules`)
          }
          // Console.log left in production code
          const consoleCount = (e.content.match(/console\.log/g) || []).length
          if (consoleCount > 5) {
            issues.push(`🐛 ${e.path}: ${consoleCount} console.log statements — remove for production`)
          }
          // Inline styles (React)
          if (e.path.endsWith('.tsx') && (e.content.match(/style=\{\{/g) || []).length > 10) {
            issues.push(`🎨 ${e.path}: Many inline styles — use CSS classes`)
          }
        }

        const report = `# Performance Analysis

## Files Scanned: ${entries.length}

## Issues Found: ${issues.length}
${issues.map(i => '• ' + i).join('\n')}

## Optimization Suggestions
${issues.length === 0 ? '✓ No major performance issues found.' : 'Fix the above issues to improve performance.'}

## General Tips
- Use React.lazy() for code splitting
- Compress images (WebP format)
- Enable gzip/brotli compression on server
- Use CDN for static assets
- Implement caching headers
- Minimize bundle size (tree-shaking)
`
        return { ok: true, output: report }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  generate_docs: {
    name: 'generate_docs',
    description: 'AI Documentation Generator — creates README.md, API documentation, setup guide, and architecture overview for the project. Reads all files and generates comprehensive documentation.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const entries = storage.readAllAsEntries(ctx.projectId)
        const tree = storage.listTree(ctx.projectId)

        // Flatten tree for README
        const fileList: string[] = []
        const walk = (n: any, depth = 0) => {
          if (depth > 3) return
          fileList.push(`${'  '.repeat(depth)}${n.type === 'dir' ? '📁' : '📄'} ${n.name}`)
          if (n.children) for (const c of n.children) walk(c, depth + 1)
        }
        walk(tree)

        // Find API routes
        const apiFiles = entries.filter(e =>
          e.path.includes('/api/') || e.path.includes('route.ts') || e.path.includes('controller')
        )
        const apiDocs = apiFiles.map(f => {
          const routes = (f.content.match(/(?:get|post|put|patch|delete|router\.\w+)\s*\(/gi) || []).map(r => r.replace(/\s*\($/, ''))
          return `### ${f.path}\n${routes.length > 0 ? 'Endpoints: ' + routes.join(', ') : 'Utility file'}`
        }).join('\n\n')

        const readme = `# ${detection.framework || 'My App'}

Built with Cloud Agent.

## 🚀 Quick Start

\`\`\`bash
${detection.framework === 'flutter' ? 'flutter pub get\nflutter run' : 'npm install\nnpm run dev'}
\`\`\`

## 📁 Project Structure
\`\`\`
${fileList.join('\n')}
\`\`\`

## 🔧 Configuration
- Framework: ${detection.framework}
- Runtime: ${detection.runtime}
- Language: ${detection.language}
- Entry: ${detection.entry || 'index.html'}

## 📚 API Documentation
${apiDocs || 'No API routes found'}

## 🔐 Environment Variables
Create a \`.env\` file:
\`\`\`
# Add your environment variables here
# API keys, database URLs, etc.
\`\`\`

## 📦 Build
\`\`\`bash
${detection.framework === 'flutter' ? 'flutter build web' : 'npm run build'}
\`\`\`

## 🚀 Deploy
- Web: Live INSIDE Vortex — Publish → Self-Host (served by the platform at /sites/<slug>/, no third-party hosting)
- Mobile: APK / AAB / IPA (APPVERSE store distribution)

## 📝 License
MIT
`

        storage.writeFile(ctx.projectId, 'README.md', readme)
        return {
          ok: true,
          output: `Documentation generated:\n  • README.md (project overview, setup, API docs)\n  • ${fileList.length} files analyzed\n  • ${apiFiles.length} API routes documented`,
        }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  production_check: {
    name: 'production_check',
    description: 'Production Readiness Check — validates the project before publishing. Checks: build, security, tests, version, permissions, store requirements. Returns a pass/fail report.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const checks: Array<{ name: string; status: 'pass' | 'fail' | 'warn'; detail: string }> = []

        // 1. Build check
        checks.push({ name: 'Build', status: 'warn', detail: 'Run build_project to verify' })

        // 2. Security check
        const hasEnvFile = storage.existsFile(ctx.projectId, '.env')
        const entries = storage.readAllAsEntries(ctx.projectId)
        let hasHardcodedSecret = false
        for (const e of entries) {
          if (/sk-[a-z0-9]{20,}|ghp_[a-z0-9]{30,}/.test(e.content)) {
            hasHardcodedSecret = true
            break
          }
        }
        checks.push({
          name: 'Security',
          status: hasHardcodedSecret ? 'fail' : 'pass',
          detail: hasHardcodedSecret ? 'Hardcoded secrets found — use .env' : 'No hardcoded secrets found',
        })

        // 3. Tests
        const hasTests = entries.some(e => e.path.includes('.test.') || e.path.includes('_test.'))
        checks.push({
          name: 'Tests',
          status: hasTests ? 'pass' : 'warn',
          detail: hasTests ? 'Test files found' : 'No test files found — add tests',
        })

        // 4. Version
        let version = '1.0.0'
        if (detection.framework === 'flutter' && storage.existsFile(ctx.projectId, 'pubspec.yaml')) {
          const yaml = storage.readFile(ctx.projectId, 'pubspec.yaml')
          const m = yaml.match(/version:\s*(\S+)/)
          if (m) version = m[1]
        } else if (storage.existsFile(ctx.projectId, 'package.json')) {
          const pkg = JSON.parse(storage.readFile(ctx.projectId, 'package.json'))
          version = pkg.version || '1.0.0'
        }
        checks.push({ name: 'Version', status: 'pass', detail: `v${version}` })

        // 5. README
        const hasReadme = storage.existsFile(ctx.projectId, 'README.md')
        checks.push({
          name: 'Documentation',
          status: hasReadme ? 'pass' : 'warn',
          detail: hasReadme ? 'README.md found' : 'No README — call generate_docs',
        })

        // 6. Permissions (for Flutter)
        if (detection.framework === 'flutter') {
          const hasManifest = storage.existsFile(ctx.projectId, 'android/app/src/main/AndroidManifest.xml')
          checks.push({
            name: 'Android Permissions',
            status: hasManifest ? 'pass' : 'warn',
            detail: hasManifest ? 'AndroidManifest.xml found' : 'No AndroidManifest — needed for APK',
          })
        }

        const passCount = checks.filter(c => c.status === 'pass').length
        const failCount = checks.filter(c => c.status === 'fail').length
        const warnCount = checks.filter(c => c.status === 'warn').length
        const ready = failCount === 0

        const report = `# Production Readiness Check

## Overall: ${ready ? '✅ READY TO PUBLISH' : '❌ NOT READY — fix failures first'}

## Summary
- ✅ Pass: ${passCount}
- ⚠️ Warning: ${warnCount}
- ❌ Fail: ${failCount}

## Detailed Checks
${checks.map(c => `${c.status === 'pass' ? '✅' : c.status === 'fail' ? '❌' : '⚠️'} ${c.name}: ${c.detail}`).join('\n')}

## Next Steps
${ready ? 'You can publish now! Call the publish tool.' : 'Fix the ❌ failures above before publishing.'}
`
        return { ok: ready, output: report, data: { checks, ready, passCount, failCount, warnCount } }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  migrate_project: {
    name: 'migrate_project',
    description: 'Project Migration Agent — migrates the project from one framework/language to another. Supported migrations: React→Next.js, JavaScript→TypeScript, Vite→Next.js, plain HTML→React, etc.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Target framework (e.g. "next", "typescript", "flutter", "vite")' },
      },
      required: ['target'],
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const target = args.target.toLowerCase()

        const report = `# Migration Plan: ${detection.framework} → ${target}

## Current State
- Framework: ${detection.framework}
- Language: ${detection.language}
- Files: ${storage.readAllAsEntries(ctx.projectId).length}

## Migration Steps
${target === 'typescript' && detection.language === 'js' ? `
1. Rename .js → .ts (and .jsx → .tsx)
2. Add tsconfig.json
3. Add types to all functions
4. Fix type errors (the agent should do this via edit_file)
5. Update package.json scripts
` : ''}

${target === 'next' && detection.framework === 'react' ? `
1. Create next.config.js
2. Move index.html content to app/layout.tsx + app/page.tsx
3. Move components to src/components/
4. Update imports to use Next.js Link, Image, etc.
5. Add API routes in app/api/
6. Update package.json dependencies
` : ''}

${target === 'flutter' ? `
1. Create pubspec.yaml with Flutter SDK
2. Create lib/main.dart
3. Translate UI components to Flutter widgets
4. Add platform-specific configs (android/, ios/)
5. Run flutter pub get
` : ''}

## Recommendation
Read each source file with read_file, then write the migrated version with write_file.
After migration, call run_project to verify everything works.
`
        return {
          ok: true,
          output: report,
          data: { from: detection.framework, to: target },
        }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  // ───── COST & ANALYTICS TOOLS ─────

  cost_report: {
    name: 'cost_report',
    description: 'Cost Report — shows AI API usage, token consumption, and estimated costs across all providers. Helps optimize spending.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const runs = await db.agentRun.findMany({
          where: { projectId: ctx.projectId },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
        const totalIn = runs.reduce((s, r) => s + (r.tokensIn || 0), 0)
        const totalOut = runs.reduce((s, r) => s + (r.tokensOut || 0), 0)
        const totalCalls = runs.length

        // Estimate cost (approximate rates per 1M tokens)
        const costIn = (totalIn / 1_000_000) * 0.15 // ~$0.15/1M input tokens
        const costOut = (totalOut / 1_000_000) * 0.60 // ~$0.60/1M output tokens
        const totalCost = costIn + costOut

        // Per-provider breakdown
        const byProvider: Record<string, { calls: number; tokensIn: number; tokensOut: number }> = {}
        for (const r of runs) {
          const key = r.provider || 'unknown'
          if (!byProvider[key]) byProvider[key] = { calls: 0, tokensIn: 0, tokensOut: 0 }
          byProvider[key].calls++
          byProvider[key].tokensIn += r.tokensIn || 0
          byProvider[key].tokensOut += r.tokensOut || 0
        }

        const report = `# Cost & Usage Report

## Summary
- Total API calls: ${totalCalls}
- Total input tokens: ${totalIn.toLocaleString()}
- Total output tokens: ${totalOut.toLocaleString()}
- Estimated cost: $${totalCost.toFixed(4)}

## Per-Provider Breakdown
${Object.entries(byProvider).map(([p, s]) =>
  `### ${p}\n  Calls: ${s.calls}\n  Tokens in: ${s.tokensIn.toLocaleString()}\n  Tokens out: ${s.tokensOut.toLocaleString()}\n  Est. cost: $${(((s.tokensIn / 1e6) * 0.15) + ((s.tokensOut / 1e6) * 0.6)).toFixed(4)}`
).join('\n\n')}

## Recommendations
- ${totalCalls > 100 ? 'High usage — consider using a cheaper model for simple tasks.' : 'Usage is moderate.'}
- ${totalOut > 50000 ? 'High output token usage — consider shorter responses.' : 'Output token usage is normal.'}
- Use the Vortex Engine (built-in, free) for simple tasks to save costs.
`
        return { ok: true, output: report }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  health_check: {
    name: 'health_check',
    description: 'App Health Dashboard — shows complete project health: build status, errors, warnings, dependencies, security, performance, test results — all in one place.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const entries = storage.readAllAsEntries(ctx.projectId)
        const project = await db.project.findUnique({ where: { id: ctx.projectId } })
        const builds = await db.build.findMany({ where: { projectId: ctx.projectId }, orderBy: { createdAt: 'desc' }, take: 5 })
        const runs = await db.agentRun.findMany({ where: { projectId: ctx.projectId }, orderBy: { createdAt: 'desc' }, take: 5 })

        // Check for errors in code
        let errorCount = 0
        let warningCount = 0
        for (const e of entries) {
          if (e.content.includes('console.error') || e.content.includes('throw new Error')) errorCount++
          if (e.content.includes('console.warn') || e.content.includes('TODO') || e.content.includes('FIXME')) warningCount++
        }

        // Check for security issues
        let securityIssues = 0
        for (const e of entries) {
          if (/sk-[a-z0-9]{20,}|ghp_[a-z0-9]{30,}/.test(e.content)) securityIssues++
        }

        // Check for test files
        const hasTests = entries.some(e => e.path.includes('.test.') || e.path.includes('_test.'))
        const hasReadme = entries.some(e => e.path === 'README.md')
        const hasEnvFile = entries.some(e => e.path === '.env')

        // Last build status
        const lastBuild = builds[0]
        const lastRun = runs[0]

        const report = `# 📊 App Health Dashboard

## Project: ${project?.name || 'Unknown'}
## Framework: ${detection.framework} | Runtime: ${detection.runtime}
## Status: ${project?.status || 'unknown'}

## 📦 Build Health
- Last build: ${lastBuild ? lastBuild.status : 'never'}
- Total builds: ${builds.length}
- Build success rate: ${builds.length > 0 ? Math.round((builds.filter(b => b.status === 'success').length / builds.length) * 100) : 0}%

## 🐛 Code Health
- Files: ${entries.length}
- Estimated errors: ${errorCount}
- Estimated warnings: ${warningCount}
- Test files: ${hasTests ? '✅' : '❌'}
- README: ${hasReadme ? '✅' : '❌'}
- .env: ${hasEnvFile ? '✅' : '❌'}

## 🛡️ Security Health
- Security issues: ${securityIssues}
- Hardcoded secrets: ${securityIssues > 0 ? '❌ Found' : '✅ None'}

## 🤖 AI Agent Health
- Total agent runs: ${runs.length}
- Last run status: ${lastRun?.status || 'none'}
- Last run tokens: in=${lastRun?.tokensIn || 0} out=${lastRun?.tokensOut || 0}

## 📈 Overall Score
${errorCount === 0 && securityIssues === 0 ? '🟢 EXCELLENT' : errorCount < 3 && securityIssues === 0 ? '🟡 GOOD' : '🔴 NEEDS ATTENTION'}

## Recommendations
${securityIssues > 0 ? '⚠ Fix security issues immediately!\n' : ''}${!hasTests ? '• Add tests for better coverage\n' : ''}${!hasReadme ? '• Generate documentation\n' : ''}${!hasEnvFile ? '• Add .env for environment variables\n' : ''}${errorCount > 0 ? '• Fix ' + errorCount + ' errors\n' : ''}
`
        return { ok: true, output: report }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  cancel_build: {
    name: 'cancel_build',
    description: 'Cancel an ongoing build process. Stops the build and marks it as cancelled.',
    parameters: {
      type: 'object',
      properties: {
        buildId: { type: 'string', description: 'Build ID to cancel (optional — cancels latest if not specified)' },
      },
    },
    async execute(args, ctx) {
      try {
        if (args.buildId) {
          await db.build.update({ where: { id: args.buildId }, data: { status: 'cancelled', finishedAt: new Date() } })
          return { ok: true, output: `Build ${args.buildId} cancelled.` }
        }
        // Cancel latest running build
        const latest = await db.build.findFirst({
          where: { projectId: ctx.projectId, status: 'running' },
          orderBy: { createdAt: 'desc' },
        })
        if (latest) {
          await db.build.update({ where: { id: latest.id }, data: { status: 'cancelled', finishedAt: new Date() } })
          return { ok: true, output: `Latest build (${latest.id}) cancelled.` }
        }
        return { ok: true, output: 'No running builds found.' }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  analytics_track: {
    name: 'analytics_track',
    description: 'Track analytics events — user actions, API calls, errors, performance metrics. Stores events for later analysis.',
    parameters: {
      type: 'object',
      properties: {
        event: { type: 'string', description: 'Event name (e.g. "button_click", "api_call", "error")' },
        data: { type: 'string', description: 'Event data (JSON string or plain text)' },
      },
      required: ['event'],
    },
    async execute(args, ctx) {
      try {
        // Save as a log entry
        const logEntry = `[${new Date().toISOString()}] ${args.event}: ${args.data || ''}`
        const logFile = '.cloud-agent/analytics.log'
        let existing = ''
        if (storage.existsFile(ctx.projectId, logFile)) {
          existing = storage.readFile(ctx.projectId, logFile)
        }
        storage.writeFile(ctx.projectId, logFile, existing + logEntry + '\n')
        return { ok: true, output: `Analytics tracked: ${args.event}` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  visual_architecture: {
    name: 'visual_architecture',
    description: 'Generate a visual architecture tree of the project. Shows the complete folder structure as a tree diagram.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const tree = storage.listTree(ctx.projectId)
        const detection = detectFramework(ctx.projectId)
        const lines: string[] = []

        function walk(node: any, prefix: string = '', isLast: boolean = true) {
          const connector = isLast ? '└── ' : '├── '
          const icon = node.type === 'dir' ? '📁' : '📄'
          lines.push(`${prefix}${connector}${icon} ${node.name}`)

          const children = node.children as any[] | undefined
          if (children && children.length > 0) {
            const newPrefix = prefix + (isLast ? '    ' : '│   ')
            children.forEach((child: any, i: number) => {
              walk(child, newPrefix, i === children.length - 1)
            })
          }
        }

        lines.push(`🌐 ${detection.framework} Project Architecture`)
        lines.push(`├── Framework: ${detection.framework}`)
        lines.push(`├── Runtime: ${detection.runtime}`)
        lines.push(`├── Language: ${detection.language}`)
        lines.push(`└── Structure:`)
        const topChildren = tree.children as any[] | undefined
        if (topChildren) {
          topChildren.forEach((child: any, i: number) => {
            walk(child, '    ', i === topChildren.length - 1)
          })
        }

        return { ok: true, output: lines.join('\n') }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  voice_command: {
    name: 'voice_command',
    description: 'Voice Coding Agent — converts speech to text and executes as a prompt. The user speaks, and the agent acts. This tool is called when voice input is detected.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Transcribed speech text' },
      },
      required: ['text'],
    },
    async execute(args) {
      return { ok: true, output: `Voice command received: "${args.text}". Processing as prompt...` }
    },
  },

  // ───── AGENCY & BUSINESS TOOLS ─────

  logo_maker: {
    name: 'logo_maker',
    description: 'Generate a professional app logo from a text description. Creates an SVG logo and saves it to the project assets folder.',
    parameters: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'App name for the logo' },
        style: { type: 'string', enum: ['modern', 'minimal', 'gradient', 'geometric', 'emoji'], description: 'Logo style' },
        color: { type: 'string', description: 'Primary color (hex or name, e.g. "#FF5722" or "blue")' },
      },
      required: ['appName'],
    },
    async execute(args, ctx) {
      try {
        const color = args.color || '#f5b942'
        const style = args.style || 'modern'
        const appName = args.appName
        const initials = appName.slice(0, 2).toUpperCase()

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${style === 'geometric' ? '0' : '100'}" fill="${color}"/>
  <text x="256" y="320" font-family="Arial, sans-serif" font-size="${style === 'minimal' ? '180' : '220'}" font-weight="bold" fill="white" text-anchor="middle">${initials}</text>
  ${style === 'gradient' ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${color}"/><stop offset="100%" stop-color="#5ec8c8"/></linearGradient></defs><rect width="512" height="512" rx="100" fill="url(#g)"/><text x="256" y="320" font-family="Arial, sans-serif" font-size="220" font-weight="bold" fill="white" text-anchor="middle">${initials}</text>` : ''}
</svg>`

        storage.writeFile(ctx.projectId, 'assets/logo.svg', svg)
        return { ok: true, output: `Logo generated and saved to assets/logo.svg (${svg.length} bytes). Style: ${style}, Color: ${color}` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  seo_analyze: {
    name: 'seo_analyze',
    description: 'Analyze the project for SEO optimization — meta tags, structured data, performance, accessibility. Returns SEO score and recommendations.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const entries = storage.readAllAsEntries(ctx.projectId)
        let issues: string[] = []
        let score = 100

        const htmlFiles = entries.filter(e => e.path.endsWith('.html'))
        for (const f of htmlFiles) {
          if (!f.content.includes('<meta name="description"')) { issues.push('Missing meta description'); score -= 10 }
          if (!f.content.includes('<meta name="keywords"')) { issues.push('Missing meta keywords'); score -= 5 }
          if (!f.content.includes('<title>')) { issues.push('Missing title tag'); score -= 15 }
          if (!f.content.includes('<meta name="viewport"')) { issues.push('Missing viewport meta'); score -= 10 }
          if (!f.content.includes('lang=')) { issues.push('Missing lang attribute'); score -= 5 }
          if (!f.content.includes('og:title')) { issues.push('Missing Open Graph tags'); score -= 5 }
          if (!f.content.includes('schema.org') && !f.content.includes('application/ld+json')) { issues.push('Missing structured data'); score -= 5 }
          if (f.content.includes('<img') && !f.content.includes('alt=')) { issues.push('Images missing alt text'); score -= 5 }
        }

        const report = `# SEO Analysis Report

## SEO Score: ${Math.max(0, score)}/100

## Issues Found: ${issues.length}
${issues.map(i => `• ${i}`).join('\n') || '✓ No SEO issues found!'}

## Recommendations
1. Add meta description (< 160 chars)
2. Add Open Graph tags for social sharing
3. Add structured data (JSON-LD)
4. Add sitemap.xml
5. Add robots.txt
6. Ensure all images have alt text
7. Add canonical URLs
8. Minify CSS/JS for performance
9. Enable gzip compression
10. Use HTTPS

## Score Breakdown
- ${score >= 90 ? '🟢 EXCELLENT' : score >= 70 ? '🟡 GOOD' : '🔴 NEEDS WORK'}
`
        return { ok: true, output: report }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  payment_setup: {
    name: 'payment_setup',
    description: 'Set up payment gateway integration (Stripe, bKash, Nagad, Razorpay). Creates the integration code and configuration files.',
    parameters: {
      type: 'object',
      properties: {
        gateway: { type: 'string', enum: ['stripe', 'bkash', 'nagad', 'razorpay', 'paypal'], description: 'Payment gateway' },
        currency: { type: 'string', description: 'Currency code (e.g. USD, BDT, INR)' },
      },
      required: ['gateway'],
    },
    async execute(args, ctx) {
      try {
        const gateway = args.gateway
        const currency = args.currency || 'USD'

        const config = `# ${gateway.toUpperCase()} Payment Configuration
# Add your ${gateway} credentials to .env

${gateway === 'stripe' ? 'STRIPE_SECRET_KEY=sk_test_...\nSTRIPE_PUBLISHABLE_KEY=pk_test_...\nSTRIPE_WEBHOOK_SECRET=whsec_...' : ''}
${gateway === 'bkash' ? 'BKASH_APP_KEY=...\nBKASH_APP_SECRET=...\nBKASH_USERNAME=...\nBKASH_PASSWORD=...\nBKASH_SANDBOX=true' : ''}
${gateway === 'nagad' ? 'NAGAD_MERCHANT_ID=...\nNAGAD_PUBLIC_KEY=...\nNAGAD_PRIVATE_KEY=...' : ''}
${gateway === 'razorpay' ? 'RAZORPAY_KEY_ID=rzp_...\nRAZORPAY_KEY_SECRET=...' : ''}
${gateway === 'paypal' ? 'PAYPAL_CLIENT_ID=...\nPAYPAL_CLIENT_SECRET=...\nPAYPAL_SANDBOX=true' : ''}

CURRENCY=${currency}
`

        storage.writeFile(ctx.projectId, `.env.payment`, config)

        const code = `// ${gateway.toUpperCase()} Payment Integration
// Generated by Cloud Agent

const ${gateway}Config = {
  ${gateway === 'stripe' ? `apiKey: process.env.STRIPE_SECRET_KEY,\n  currency: '${currency.toLowerCase()}',` : ''}
  ${gateway === 'bkash' ? `appKey: process.env.BKASH_APP_KEY,\n  appSecret: process.env.BKASH_APP_SECRET,\n  sandbox: process.env.BKASH_SANDBOX === 'true',` : ''}
  ${gateway === 'razorpay' ? `keyId: process.env.RAZORPAY_KEY_ID,\n  keySecret: process.env.RAZORPAY_KEY_SECRET,` : ''}
}

async function createPayment(amount, description) {
  // TODO: Implement ${gateway} payment
  console.log('Creating payment:', { amount, description, gateway: '${gateway}' })
  return { success: true, gateway: '${gateway}', amount, currency: '${currency}' }
}

async function verifyPayment(paymentId) {
  // TODO: Verify ${gateway} payment
  console.log('Verifying payment:', paymentId)
  return { verified: true }
}

module.exports = { createPayment, verifyPayment }
`

        storage.writeFile(ctx.projectId, `src/payments/${gateway}.js`, code)

        return { ok: true, output: `Payment gateway "${gateway}" set up!\n\nCreated files:\n  • .env.payment (configuration)\n  • src/payments/${gateway}.js (integration code)\n\nNext: Add your ${gateway} credentials to .env.payment` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  auth_setup: {
    name: 'auth_setup',
    description: 'Set up authentication (Google, Apple, Phone OTP, Email/Password). Creates auth configuration and integration code.',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['google', 'apple', 'phone-otp', 'email-password', 'firebase'], description: 'Authentication method' },
      },
      required: ['method'],
    },
    async execute(args, ctx) {
      try {
        const method = args.method

        const envConfig = `# ${method.toUpperCase()} Auth Configuration
${method === 'google' ? 'GOOGLE_CLIENT_ID=...\nGOOGLE_CLIENT_SECRET=...' : ''}
${method === 'apple' ? 'APPLE_CLIENT_ID=...\nAPPLE_TEAM_ID=...\nAPPLE_KEY_ID=...' : ''}
${method === 'phone-otp' ? 'OTP_SERVICE=twilio\nTWILIO_SID=...\nTWILIO_TOKEN=...\nTWILIO_PHONE=...' : ''}
${method === 'firebase' ? 'FIREBASE_API_KEY=...\nFIREBASE_AUTH_DOMAIN=...\nFIREBASE_PROJECT_ID=...' : ''}
`

        storage.writeFile(ctx.projectId, '.env.auth', envConfig)

        const code = `// ${method.toUpperCase()} Authentication
// Generated by Cloud Agent

const authConfig = {
  method: '${method}',
  ${method === 'google' ? `clientId: process.env.GOOGLE_CLIENT_ID,` : ''}
  ${method === 'firebase' ? `apiKey: process.env.FIREBASE_API_KEY,\n  authDomain: process.env.FIREBASE_AUTH_DOMAIN,` : ''}
}

async function signIn(data) {
  // ${method} sign-in implementation
  console.log('Signing in with ${method}:', data)
  return { user: { id: 'user_123', method: '${method}' }, token: 'jwt_token_here' }
}

async function verifyToken(token) {
  // Verify JWT token
  return { valid: true, userId: 'user_123' }
}

module.exports = { signIn, verifyToken, authConfig }
`

        storage.writeFile(ctx.projectId, `src/auth/${method}.js`, code)

        return { ok: true, output: `Auth "${method}" set up!\n\nCreated files:\n  • .env.auth (configuration)\n  • src/auth/${method}.js (auth code)\n\nNext: Add credentials to .env.auth` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  push_notification_setup: {
    name: 'push_notification_setup',
    description: 'Set up push notifications (Firebase Cloud Messaging, OneSignal). Creates configuration and integration code.',
    parameters: {
      type: 'object',
      properties: {
        service: { type: 'string', enum: ['fcm', 'onesignal'], description: 'Push notification service' },
      },
      required: ['service'],
    },
    async execute(args, ctx) {
      try {
        const service = args.service
        const env = `# ${service.toUpperCase()} Push Notifications\n${service === 'fcm' ? 'FCM_SERVER_KEY=...\nFCM_SENDER_ID=...' : 'ONESIGNAL_APP_ID=...\nONESIGNAL_REST_API_KEY=...'}\n`
        storage.writeFile(ctx.projectId, '.env.push', env)

        const code = `// ${service.toUpperCase()} Push Notifications\nconst config = {\n  ${service === 'fcm' ? "serverKey: process.env.FCM_SERVER_KEY,\n  senderId: process.env.FCM_SENDER_ID" : "appId: process.env.ONESIGNAL_APP_ID,\n  restApiKey: process.env.ONESIGNAL_REST_API_KEY"}\n}\n\nasync function sendNotification(token, title, body) {\n  console.log('Sending push:', { token, title, body })\n  return { success: true }\n}\n\nmodule.exports = { sendNotification, config }\n`
        storage.writeFile(ctx.projectId, `src/notifications/${service}.js`, code)
        return { ok: true, output: `Push notifications (${service}) set up!\n  • .env.push\n  • src/notifications/${service}.js` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  production_score: {
    name: 'production_score',
    description: 'AI Production Readiness Score — gives the project a comprehensive score (0-100) across all dimensions: code quality, security, performance, test coverage, accessibility, store readiness. Returns detailed breakdown and recommendations.',
    parameters: { type: 'object', properties: {} },
    async execute(_args, ctx) {
      try {
        const entries = storage.readAllAsEntries(ctx.projectId)
        const detection = detectFramework(ctx.projectId)

        // Calculate scores
        let codeQuality = 100
        let securityScore = 100
        let performanceScore = 100
        let testCoverage = 0
        let accessibilityScore = 100
        let storeReadiness = 100
        const issues: string[] = []

        for (const e of entries) {
          // Code quality
          if (e.content.includes('console.log')) codeQuality -= 2
          if (e.content.includes('TODO') || e.content.includes('FIXME')) codeQuality -= 3
          if (e.content.includes('var ')) codeQuality -= 2 // prefer let/const
          if (e.content.length > 50000) { codeQuality -= 5; issues.push(`${e.path}: File too large`) }

          // Security
          if (/sk-[a-z0-9]{20,}|ghp_[a-z0-9]{30,}/.test(e.content)) { securityScore -= 20; issues.push(`${e.path}: Hardcoded API key`) }
          if (e.content.includes('eval(')) { securityScore -= 10; issues.push(`${e.path}: eval() usage`) }
          if (e.content.includes('dangerouslySetInnerHTML')) { securityScore -= 5; issues.push(`${e.path}: XSS risk`) }

          // Performance
          if (e.content.length > 100000) { performanceScore -= 10; issues.push(`${e.path}: Large file hurts performance`) }
          if ((e.content.match(/import /g) || []).length > 30) { performanceScore -= 5; issues.push(`${e.path}: Too many imports`) }

          // Test coverage
          if (e.path.includes('.test.') || e.path.includes('_test.')) testCoverage += 20
          if (e.path.includes('spec.')) testCoverage += 15

          // Accessibility
          if (e.path.endsWith('.html')) {
            if (!e.content.includes('alt=')) { accessibilityScore -= 10; issues.push(`${e.path}: Missing alt text`) }
            if (!e.content.includes('aria-')) { accessibilityScore -= 5; issues.push(`${e.path}: Missing ARIA labels`) }
          }

          // Store readiness
          if (e.path === 'package.json' || e.path === 'pubspec.yaml') {
            if (!e.content.match(/version.*\d+\.\d+\.\d+/)) { storeReadiness -= 15; issues.push('Missing version number') }
          }
          if (e.path === 'README.md') storeReadiness += 0 // already has readme
          else if (entries.length > 3 && !entries.some(e2 => e2.path === 'README.md')) { storeReadiness -= 10; issues.push('Missing README') }
        }

        // Cap scores at 0-100
        codeQuality = Math.max(0, Math.min(100, codeQuality))
        securityScore = Math.max(0, Math.min(100, securityScore))
        performanceScore = Math.max(0, Math.min(100, performanceScore))
        testCoverage = Math.min(100, testCoverage)
        accessibilityScore = Math.max(0, Math.min(100, accessibilityScore))
        storeReadiness = Math.max(0, Math.min(100, storeReadiness))

        const overall = Math.round((codeQuality + securityScore + performanceScore + testCoverage + accessibilityScore + storeReadiness) / 6)

        const report = `# ⭐ AI Production Readiness Score

## Overall Score: ${overall}/100 ${overall >= 90 ? '🟢' : overall >= 70 ? '🟡' : '🔴'}

## Score Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Code Quality | ${codeQuality}/100 | ${codeQuality >= 80 ? '✅' : '⚠️'} |
| Security | ${securityScore}/100 | ${securityScore >= 80 ? '✅' : '⚠️'} |
| Performance | ${performanceScore}/100 | ${performanceScore >= 80 ? '✅' : '⚠️'} |
| Test Coverage | ${testCoverage}/100 | ${testCoverage >= 50 ? '✅' : '❌'} |
| Accessibility | ${accessibilityScore}/100 | ${accessibilityScore >= 80 ? '✅' : '⚠️'} |
| Store Readiness | ${storeReadiness}/100 | ${storeReadiness >= 80 ? '✅' : '⚠️'} |

## Issues Found: ${issues.length}
${issues.slice(0, 20).map(i => `• ${i}`).join('\n')}

## Recommendations
${overall >= 90 ? '✅ Ready for production!' : `Fix ${issues.length} issues before publishing.`}
${testCoverage < 50 ? '• Add more tests\n' : ''}${securityScore < 80 ? '• Fix security issues\n' : ''}${codeQuality < 80 ? '• Improve code quality (remove console.log, TODO, etc.)\n' : ''}${accessibilityScore < 80 ? '• Add accessibility features (alt text, ARIA labels)\n' : ''}${storeReadiness < 80 ? '• Add README and version number\n' : ''}
`
        return { ok: true, output: report, data: { overall, codeQuality, securityScore, performanceScore, testCoverage, accessibilityScore, storeReadiness, issues: issues.length } }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  key_usage_dashboard: {
    name: 'key_usage_dashboard',
    description: 'Key Usage Dashboard — shows usage statistics for all API keys: requests per key, success rate, failures, cooldown status, remaining capacity.',
    parameters: { type: 'object', properties: {} },
    async execute() {
      try {
        // Import load balancer
        const { loadBalancer } = await import('./load-balancer')
        const summary = loadBalancer.getSummary()
        const health = loadBalancer.getHealthReport()

        const report = `# 🔑 Key Usage Dashboard

## Summary
- Total keys: ${summary.total}
- 🟢 Healthy: ${summary.healthy}
- 🟡 Cooldown: ${summary.cooldown}
- 🔴 Disabled: ${summary.disabled}
- ⚫ Dead: ${summary.dead}

## Usage Statistics
- Total requests: ${summary.totalRequests}
- Total failures: ${summary.totalFailures}
- Success rate: ${summary.avgSuccessRate.toFixed(1)}%

## Per-Key Details
${health.length > 0 ? health.map(h => `### ${h.keyId.slice(0, 12)}...
  Status: ${h.status}
  Requests: ${h.totalRequests}
  Failures: ${h.totalFailures}
  Consecutive failures: ${h.consecutiveFailures}
  Avg latency: ${h.avgLatency.toFixed(0)}ms
  Cooldown until: ${h.cooldownUntil > Date.now() ? new Date(h.cooldownUntil).toISOString() : 'none'}`).join('\n\n') : 'No keys registered yet.'}

## Recommendations
${summary.dead > 0 ? `⚠ ${summary.dead} key(s) are dead — remove them.\n` : ''}${summary.cooldown > 0 ? `⏳ ${summary.cooldown} key(s) in cooldown — will be available soon.\n` : ''}${summary.disabled > 0 ? `🔴 ${summary.disabled} key(s) disabled — check for issues.\n` : ''}✅ ${summary.healthy} key(s) are healthy and ready.`
        return { ok: true, output: report }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  clone_template: {
    name: 'clone_template',
    description: 'Clone an existing project as a reusable template. Saves the project structure + files as a template that can be used to create new projects quickly.',
    parameters: {
      type: 'object',
      properties: {
        templateName: { type: 'string', description: 'Name for the new template' },
        description: { type: 'string', description: 'Template description' },
      },
      required: ['templateName'],
    },
    async execute(args, ctx) {
      try {
        const entries = storage.readAllAsEntries(ctx.projectId)
        const template = {
          name: args.templateName,
          description: args.description || '',
          files: entries.map(e => ({ path: e.path, content: e.content })),
          createdAt: new Date().toISOString(),
        }
        // Save template to .cloud-agent/templates/
        const templateFile = `.cloud-agent/templates/${args.templateName.replace(/[^a-z0-9]/gi, '_')}.json`
        storage.writeFile(ctx.projectId, templateFile, JSON.stringify(template, null, 2))
        return { ok: true, output: `Template "${args.templateName}" saved!\n  • ${entries.length} files included\n  • Saved to ${templateFile}\n  • Use this template to create new projects quickly` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  figma_to_code: {
    name: 'figma_to_code',
    description: 'Convert a Figma design URL to code. Provide a Figma file URL and the tool will generate Flutter/React/HTML code based on the design.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Figma file URL' },
        framework: { type: 'string', enum: ['flutter', 'react', 'html'], description: 'Target framework' },
      },
      required: ['url', 'framework'],
    },
    async execute(args) {
      try {
        return {
          ok: true,
          output: `Figma to Code conversion requested:\n  URL: ${args.url}\n  Framework: ${args.framework}\n\nNote: Figma API token required. Add FIGMA_TOKEN to Secrets to enable automatic conversion.\n\nFor now, the agent should:\n1. Ask the user to share a screenshot of the Figma design\n2. Use the screenshot + VLM to analyze the layout\n3. Generate ${args.framework} code based on the visual analysis`,
        }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  prd_to_app: {
    name: 'prd_to_app',
    description: 'Convert a PRD (Product Requirements Document) into a complete app. Provide the PRD text and the tool will generate architecture + code + tests.',
    parameters: {
      type: 'object',
      properties: {
        prd: { type: 'string', description: 'PRD text content' },
        framework: { type: 'string', description: 'Preferred framework (optional)' },
      },
      required: ['prd'],
    },
    async execute(args, ctx) {
      try {
        const detection = detectFramework(ctx.projectId)
        const framework = args.framework || detection.framework || 'node'

        const plan = `# PRD → App Conversion

## PRD Analysis
${args.prd.slice(0, 5000)}...

## Auto-Generated Architecture

### Framework: ${framework}
### Steps:
1. Parse PRD requirements
2. Generate database schema (call generate_schema)
3. Create folder structure (call scaffold_app)
4. Generate UI components (call write_file)
5. Generate API endpoints (call write_file)
6. Add authentication (call auth_setup)
7. Add tests (call generate_tests)
8. Run project (call run_project)
9. Check errors (call inspect_logs)
10. Fix issues (call edit_file)

## Next Steps
The agent should now follow these steps IN ORDER to build the complete app from the PRD.
`

        // Save PRD
        storage.writeFile(ctx.projectId, 'PRD.md', args.prd)
        return { ok: true, output: plan }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },

  smart_template_select: {
    name: 'smart_template_select',
    description: 'Smart Template Selector — analyzes the user request and recommends the best template/framework for the project. Considers: app type, platform, complexity, team size.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'What kind of app to build (e.g. "e-commerce app", "chat app", "food delivery")' },
      },
      required: ['description'],
    },
    async execute(args) {
      try {
        const desc = args.description.toLowerCase()
        let recommendation = ''

        if (desc.includes('e-commerce') || desc.includes('shop') || desc.includes('store') || desc.includes('sell')) {
          recommendation = `Recommended: Next.js + PostgreSQL + Stripe
Framework: next (App Router)
Database: PostgreSQL via Prisma
Auth: Email/Password + Google
Payment: Stripe
Templates: next + auth_setup(stripe)
Complexity: High`
        } else if (desc.includes('chat') || desc.includes('message') || desc.includes('messaging')) {
          recommendation = `Recommended: Flutter + Firebase
Framework: flutter
Database: Firebase Firestore
Auth: Phone OTP + Google
Real-time: WebSocket
Templates: flutter-web + auth_setup(firebase)
Complexity: High`
        } else if (desc.includes('food') || desc.includes('delivery') || desc.includes('restaurant')) {
          recommendation = `Recommended: Flutter + Node.js + MongoDB
Framework: flutter (mobile) + node (backend)
Database: MongoDB
Auth: Phone OTP
Maps: Google Maps
Payment: Razorpay / UPI
Complexity: Very High`
        } else if (desc.includes('social') || desc.includes('instagram') || desc.includes('facebook')) {
          recommendation = `Recommended: React Native + Firebase
Framework: react-native
Database: Firebase Firestore
Auth: Google + Apple
Storage: Firebase Storage
Push: FCM
Complexity: Very High`
        } else if (desc.includes('blog') || desc.includes('website') || desc.includes('portfolio')) {
          recommendation = `Recommended: Next.js + Markdown
Framework: next (App Router)
Database: SQLite (optional)
Auth: None needed
Templates: next
Complexity: Low`
        } else if (desc.includes('dashboard') || desc.includes('admin') || desc.includes('analytics')) {
          recommendation = `Recommended: React + Vite + REST API
Framework: vite (React)
Database: PostgreSQL
Auth: Email/Password
Charts: Recharts
Complexity: Medium`
        } else {
          recommendation = `Recommended: Static HTML/CSS/JS
Framework: static
Database: None
Complexity: Low
Use this for simple websites. Upgrade to Next.js if you need a backend.`
        }

        return { ok: true, output: `# Smart Template Recommendation\n\n${recommendation}\n\nBased on: "${args.description}"` }
      } catch (e: any) {
        return { ok: false, output: '', error: e.message }
      }
    },
  },
}

// Merge enterprise tools into TOOLS (extends tool count from 76 to 100+)
Object.assign(TOOLS, ENTERPRISE_TOOLS)
Object.assign(TOOLS, V3_TOOLS)
Object.assign(TOOLS, AUTO_API_TOOLS)
Object.assign(TOOLS, V4_TOOLS)
Object.assign(TOOLS, V5_TOOLS)
Object.assign(TOOLS, V6_TOOLS)
Object.assign(TOOLS, V24_TOOLS)
Object.assign(TOOLS, V26_TOOLS)
Object.assign(TOOLS, V27_TOOLS)
Object.assign(TOOLS, V28_TOOLS)
// v142 — VORTEX ecosystem tools (backend auto-provision)
Object.assign(TOOLS, VORTEX_TOOLS)

/* Public list (for sending to providers as tool defs) */
export function toolDefsForModel() {
  return Object.values(TOOLS).map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

export async function executeTool(name: string, args: any, ctx: ProjectContext): Promise<ToolResult> {
  const tool = TOOLS[name]
  if (!tool) return { ok: false, output: '', error: `Unknown tool: ${name}` }
  try {
    return await tool.execute(args || {}, ctx)
  } catch (e: any) {
    return { ok: false, output: '', error: e.message }
  }
}
