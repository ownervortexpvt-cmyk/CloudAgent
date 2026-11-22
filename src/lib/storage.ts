/**
 * Project file storage layer.
 *
 * In the current sandbox we use the local filesystem under PROJECTS_DIR
 * as the storage backend. The interface is intentionally generic so an
 * S3-compatible adapter can be dropped in later without changing callers.
 *
 * All paths are sandboxed under PROJECTS_DIR/<projectId> — no escaping.
 */
import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'

export const PROJECTS_DIR = process.env.PROJECTS_DIR || '/home/z/my-project/projects'

export function projectRoot(projectId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error('Invalid projectId')
  }
  return path.join(PROJECTS_DIR, projectId)
}

function safeJoin(root: string, rel: string): string {
  // FIX: path.resolve(root, '/index.html') resolves to the ABSOLUTE
  // '/index.html' (leading slash = absolute), which "escapes" every project
  // root — so reading/writing any path with a leading slash 404'd or threw
  // even though the file exists. Strip leading slashes first; keep the
  // traversal guard so ../ still cannot escape.
  const clean = String(rel).replace(/^\/+/, '')
  const joined = path.resolve(root, clean)
  if (!joined.startsWith(root + path.sep) && joined !== root) {
    throw new Error('Path escapes project root: ' + rel)
  }
  return joined
}

export function ensureProjectDir(projectId: string): string {
  const root = projectRoot(projectId)
  fs.mkdirSync(root, { recursive: true })
  return root
}

export function writeFile(projectId: string, relPath: string, content: string | Buffer): void {
  const root = ensureProjectDir(projectId)
  const full = safeJoin(root, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content)
}

/** v97 — streaming write for big imported entries (1GB zip support):
 * same safeJoin/mkdir guarantees as writeFile, but the caller pipes into
 * the returned WriteStream so a 512MB entry never sits in RAM. */
export function writeFileStream(projectId: string, relPath: string): fs.WriteStream {
  const root = ensureProjectDir(projectId)
  const full = safeJoin(root, relPath)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  return fs.createWriteStream(full)
}

export function readFile(projectId: string, relPath: string): string {
  const root = projectRoot(projectId)
  const full = safeJoin(root, relPath)
  return fs.readFileSync(full, 'utf8')
}

export function readBinary(projectId: string, relPath: string): Buffer {
  const root = projectRoot(projectId)
  const full = safeJoin(root, relPath)
  return fs.readFileSync(full)
}

export function existsFile(projectId: string, relPath: string): boolean {
  try {
    const root = projectRoot(projectId)
    const full = safeJoin(root, relPath)
    return fs.existsSync(full)
  } catch {
    return false
  }
}

export function deleteFile(projectId: string, relPath: string): void {
  const root = projectRoot(projectId)
  const full = safeJoin(root, relPath)
  if (fs.existsSync(full)) {
    if (fs.statSync(full).isDirectory()) {
      fs.rmSync(full, { recursive: true })
    } else {
      fs.rmSync(full)
    }
  }
}

export function moveFile(projectId: string, from: string, to: string): void {
  const root = projectRoot(projectId)
  const src = safeJoin(root, from)
  const dst = safeJoin(root, to)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.renameSync(src, dst)
}

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
  size?: number
  mtime?: number
}

export function listTree(projectId: string, relPath = '.'): TreeNode {
  const root = ensureProjectDir(projectId)
  const full = safeJoin(root, relPath)
  const stat = fs.statSync(full)
  if (stat.isFile()) {
    return {
      name: path.basename(relPath),
      path: relPath,
      type: 'file',
      size: stat.size,
      mtime: stat.mtimeMs,
    }
  }
  const node: TreeNode = {
    name: relPath === '.' ? path.basename(root) : path.basename(relPath),
    path: relPath,
    type: 'dir',
    children: [],
  }
  const entries = fs.readdirSync(full, { withFileTypes: true })
  // Respect common ignore patterns so node_modules doesn't drown the tree.
  const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache'])
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue
    const childPath = path.join(relPath === '.' ? '' : relPath, e.name)
    if (e.isDirectory()) {
      node.children!.push(listTree(projectId, childPath))
    } else if (e.isFile()) {
      node.children!.push({
        name: e.name,
        path: childPath,
        type: 'file',
        size: fs.statSync(path.join(full, e.name)).size,
        mtime: fs.statSync(path.join(full, e.name)).mtimeMs,
      })
    }
  }
  node.children!.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return node
}

export function searchFiles(projectId: string, query: string, limit = 1000): Array<{ path: string; line: number; preview: string }> {
  const root = ensureProjectDir(projectId)
  const results: Array<{ path: string; line: number; preview: string }> = []
  const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache'])
  const needle = query.toLowerCase()

  function walk(dir: string) {
    if (results.length >= limit) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (results.length >= limit) return
      if (IGNORE.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile()) {
        // Skip large or binary-looking files.
        const stat = fs.statSync(full)
        if (stat.size > 100_000_000) continue
        const ext = path.extname(e.name).toLowerCase()
        if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip'].includes(ext)) continue
        try {
          const text = fs.readFileSync(full, 'utf8')
          const lines = text.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(needle)) {
              const rel = path.relative(root, full)
              results.push({ path: rel, line: i + 1, preview: lines[i].slice(0, 200) })
              if (results.length >= limit) return
              break // only first match per file
            }
          }
        } catch {
          // skip unreadable
        }
      }
    }
  }
  walk(root)
  return results
}

/**
 * Recursively write a tree of plain {path, content} entries (used by ZIP import
 * and template seeding). Creates parent directories as needed.
 */
export function writeMany(projectId: string, entries: Array<{ path: string; content: string }>): void {
  for (const e of entries) {
    writeFile(projectId, e.path, e.content)
  }
}

export function readAllAsEntries(projectId: string, maxFileBytes = 100_000_000): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = []
  const root = projectRoot(projectId)
  if (!fs.existsSync(root)) return out
  const IGNORE = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache'])
  function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORE.has(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile()) {
        const stat = fs.statSync(full)
        if (stat.size > maxFileBytes) continue
        const ext = path.extname(e.name).toLowerCase()
        if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.lock'].includes(ext)) continue
        try {
          const text = fs.readFileSync(full, 'utf8')
          out.push({ path: path.relative(root, full), content: text })
        } catch {
          // skip binary
        }
      }
    }
  }
  walk(root)
  return out
}

export function genToken(): string {
  return randomBytes(8).toString('hex')
}
