'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  ChevronRight, ChevronDown, File as FileIcon, Folder, FolderOpen,
  FilePlus, FolderPlus, RefreshCw, Search, Trash2, Download, Pencil, X,
  FileCode, FileText, FileJson, Image, Settings, Terminal, Database,
  Braces, Hash, FileType, Container, Book, Cog, Upload, Eye,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
  ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuLabel,
} from '@/components/ui/context-menu'
import { toast } from 'sonner'
import ReactMarkdown from 'react-markdown'
import { useAppStore, langFromPath } from '@/lib/store'
import type { TreeNode } from '@/lib/storage'

/**
 * Returns a VS Code-like file icon and color based on the file extension.
 * Uses inline color so we don't need to bundle an icon font.
 */
function fileIconFor(node: { name: string; type: 'file' | 'dir' }): { Icon: any; color: string } {
  if (node.type === 'dir') return { Icon: Folder, color: '#f5b942' }
  const ext = node.name.split('.').pop()?.toLowerCase()
  const name = node.name.toLowerCase()
  // Special filenames first
  if (name === 'package.json' || name === 'package-lock.json') return { Icon: FileJson, color: '#8ec5c5' }
  if (name === 'tsconfig.json') return { Icon: FileJson, color: '#5ec8c8' }
  if (name === 'readme.md' || name === 'license') return { Icon: Book, color: '#94a3b8' }
  if (name === '.gitignore' || name === '.env' || name.startsWith('.env')) return { Icon: Settings, color: '#ef4444' }
  if (name === 'dockerfile' || name.endsWith('.dockerfile')) return { Icon: Container, color: '#5ec8c8' }
  if (name === 'makefile') return { Icon: Cog, color: '#94a3b8' }
  // Extension-based
  switch (ext) {
    case 'js': return { Icon: FileCode, color: '#f5b942' }       // JavaScript — yellow
    case 'jsx': return { Icon: FileCode, color: '#5ec8c8' }      // React JSX — cyan
    case 'ts': return { Icon: FileCode, color: '#5ec8c8' }       // TypeScript — blue-ish
    case 'tsx': return { Icon: FileCode, color: '#5ec8c8' }       // TSX — cyan
    case 'json': return { Icon: FileJson, color: '#f5b942' }      // JSON — yellow
    case 'html': return { Icon: FileType, color: '#ef6b3b' }      // HTML — orange
    case 'css': return { Icon: Hash, color: '#5ec8c8' }           // CSS — blue
    case 'scss':
    case 'sass': return { Icon: Hash, color: '#c084fc' }          // SCSS — pink
    case 'md': return { Icon: Book, color: '#94a3b8' }            // Markdown — gray
    case 'py': return { Icon: FileCode, color: '#5ec8c8' }       // Python — blue
    case 'dart': return { Icon: FileCode, color: '#5ec8c8' }     // Dart — blue
    case 'java': return { Icon: FileCode, color: '#ef6b3b' }     // Java — orange
    case 'kt': return { Icon: FileCode, color: '#c084fc' }        // Kotlin — purple
    case 'go': return { Icon: FileCode, color: '#5ec8c8' }        // Go — cyan
    case 'rs': return { Icon: FileCode, color: '#ef6b3b' }       // Rust — orange
    case 'c':
    case 'cpp':
    case 'h': return { Icon: FileCode, color: '#5ec8c8' }        // C/C++ — blue
    case 'sh':
    case 'bash': return { Icon: Terminal, color: '#10b981' }     // Shell — green
    case 'yml':
    case 'yaml': return { Icon: Settings, color: '#5ec8c8' }     // YAML — blue
    case 'toml': return { Icon: Settings, color: '#ef6b3b' }     // TOML — orange
    case 'xml': return { Icon: FileCode, color: '#ef6b3b' }      // XML — orange
    case 'sql': return { Icon: Database, color: '#c084fc' }       // SQL — purple
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg': return { Icon: Image, color: '#c084fc' }         // Images — purple
    case 'lock': return { Icon: FileLock, color: '#94a3b8' }      // Lock files
    case 'env': return { Icon: Settings, color: '#ef4444' }      // .env — red
    case 'txt': return { Icon: FileText, color: '#94a3b8' }       // Text — gray
    default: return { Icon: FileText, color: '#94a3b8' }
  }
}

// Simple lock icon (FileLock is not in lucide; reuse a generic one)
function FileLock({ className }: { className?: string }) {
  return <FileIcon className={className} />
}

// v62 — image extensions get a real visual preview instead of raw text
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'])
function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
    bmp: 'image/bmp', avif: 'image/avif', pdf: 'application/pdf',
  }
  return map[ext] || 'application/octet-stream'
}

interface FileTreeProps {
  projectId: string
}

export function FileTree({ projectId }: FileTreeProps) {
  const { openTab, activeTabPath, treeVersion, bumpTree } = useAppStore()
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['.']))
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ path: string; line: number; preview: string }> | null>(null)
  const [creating, setCreating] = useState<null | { type: 'file' | 'folder'; parent: string }>(null)
  const [creatingName, setCreatingName] = useState('')
  const [renaming, setRenaming] = useState<null | { path: string }>(null)
  const [renamingName, setRenamingName] = useState('')
  // Code preview shown at the bottom of the Files panel
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  // v62: preview kind — text | image | markdown
  const [previewKind, setPreviewKind] = useState<'text' | 'image' | 'markdown'>('text')
  const uploadTargetRef = useRef<string>('.')
  const uploadInputRef = useRef<HTMLInputElement>(null)

  // Recursively expand all folders in the tree
  function expandAll(node: TreeNode | null) {
    if (!node) return
    const next = new Set<string>(['.'])
    const walk = (n: TreeNode) => {
      if (n.type === 'dir') {
        next.add(n.path)
        for (const c of n.children || []) walk(c)
      }
    }
    walk(node)
    setExpanded(next)
  }

  // When a file is clicked, show its content in the preview pane
  // AND open it in the editor tab.
  async function openFile(path: string) {
    try {
      const name = path.split('/').pop() || path
      const ext = name.split('.').pop()?.toLowerCase() || ''
      const isImage = IMAGE_EXTS.has(ext)
      // Images still open an editor tab (hex-ish text view) but the inline
      // preview renders the real bytes via the base64 endpoint.
      const res = await fetch(`/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`)
      const data = await res.json()
      if (data.error) {
        toast.error(data.error)
        return
      }
      openTab({
        path,
        name,
        content: data.content ?? '',
        dirty: false,
        language: langFromPath(path),
      })
      // Also show preview inline in the Files panel
      setPreviewPath(path)
      setPreviewKind(isImage ? 'image' : ext === 'md' ? 'markdown' : 'text')
      if (isImage) {
        const r2 = await fetch(`/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}&encoding=base64`)
        const d2 = await r2.json()
        if (d2.error) { toast.error(d2.error); return }
        setPreviewContent(`data:${mimeFor(name)};base64,${d2.content}`)
      } else {
        setPreviewContent((data.content ?? '').slice(0, isImage ? 0 : 8000))
      }
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/files/${projectId}`)
      const data = await res.json()
      setTree(data.tree)
    } catch {
      toast.error('Failed to load file tree')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load, treeVersion])

  async function createItem(type: 'file' | 'folder', parent: string) {
    setCreating({ type, parent })
    setCreatingName('')
  }

  async function submitCreate() {
    if (!creating) return
    const name = creatingName.trim()
    if (!name) { setCreating(null); return }
    const parent = creating.parent === '.' ? '' : creating.parent
    const path = parent ? `${parent}/${name}` : name
    try {
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          path: creating.type === 'folder' ? path : path,
          content: '',
          op: creating.type === 'folder' ? 'createFolder' : 'write',
        }),
      })
      const data = await res.json()
      if (data.ok) {
        toast.success(`Created ${creating.type} ${name}`)
        bumpTree()
        if (creating.type === 'file') {
          openFile(path)
        }
      } else {
        toast.error(data.error || 'create failed')
      }
    } catch (e: any) { toast.error(e.message) }
    setCreating(null)
  }

  async function deleteItem(path: string) {
    if (!confirm(`Delete ${path}?`)) return
    try {
      await fetch('/api/files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, path, op: 'delete' }),
      })
      toast.success(`Deleted ${path}`)
      bumpTree()
    } catch (e: any) { toast.error(e.message) }
  }

  async function downloadItem(path: string) {
    const name = path.split('/').pop() || 'file'
    const ext = name.split('.').pop()?.toLowerCase() || ''
    // v62: binaries (images etc.) go through the base64 endpoint and are
    // re-assembled with the right MIME type — utf8 JSON used to corrupt them.
    if (IMAGE_EXTS.has(ext) || ext === 'pdf') {
      const res = await fetch(`/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}&encoding=base64`)
      const data = await res.json()
      if (data.error) { toast.error(data.error); return }
      const bin = atob(data.content)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: mimeFor(name) })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      return
    }
    const res = await fetch(`/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`)
    const data = await res.json()
    const blob = new Blob([data.content || ''], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  // v62: upload files (from the toolbar or a folder's context menu) — text
  // files go through the plain write op, binaries through writeBase64 so
  // they land on disk byte-perfect.
  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const parent = uploadTargetRef.current === '.' ? '' : uploadTargetRef.current + '/'
    let ok = 0
    let failed = 0
    for (const f of Array.from(files)) {
      if (f.size > 8 * 1024 * 1024) { toast.error(`${f.name}: over 8 MB — skipped`); failed++; continue }
      try {
        const buf = new Uint8Array(await f.arrayBuffer())
        // Binary sniff — NUL byte in the first 8 KB means binary
        const isBinary = buf.subarray(0, 8192).includes(0)
        let res: Response
        if (isBinary) {
          let b64 = ''
          const chunk = 0x8000
          for (let i = 0; i < buf.length; i += chunk) {
            b64 += String.fromCharCode(...buf.subarray(i, i + chunk))
          }
          res = await fetch('/api/files', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, path: parent + f.name, op: 'writeBase64', contentBase64: btoa(b64) }),
          })
        } else {
          res = await fetch('/api/files', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, path: parent + f.name, content: new TextDecoder().decode(buf) }),
          })
        }
        if (res.ok) ok++
        else { failed++; toast.error(`${f.name}: HTTP ${res.status}`) }
      } catch {
        failed++
      }
    }
    if (ok > 0) toast.success(`Uploaded ${ok} file${ok !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}`)
    bumpTree()
  }

  async function submitRename() {
    if (!renaming) return
    const newName = renamingName.trim()
    if (!newName || !renaming) { setRenaming(null); return }
    const to = renaming.path.split('/').slice(0, -1).concat(newName).join('/')
    try {
      await fetch('/api/files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, path: renaming.path, op: 'move', to }),
      })
      toast.success(`Renamed to ${newName}`)
      bumpTree()
    } catch (e: any) { toast.error(e.message) }
    setRenaming(null)
  }

  async function runSearch() {
    if (!search.trim()) { setSearchResults(null); return }
    try {
      // Search is served by GET /api/search (the files API has no search op —
      // the old extra POST here just 400'd as noise)
      const r = await fetch(`/api/search?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(search)}`)
      const data = await r.json()
      setSearchResults(data.results || [])
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  function toggleDir(path: string) {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(path)) n.delete(path)
      else n.add(path)
      return n
    })
  }

  function renderNode(node: TreeNode, depth = 0): React.ReactNode {
    const isActive = activeTabPath === node.path
    if (node.type === 'file') {
      const { Icon, color } = fileIconFor(node)
      return (
        <ContextMenu key={node.path}>
          <ContextMenuTrigger asChild>
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 text-xs cursor-pointer rounded hover:bg-accent/20 group ${isActive ? 'bg-primary/15 text-primary' : ''}`}
              style={{ paddingLeft: depth * 12 + 8 }}
              onClick={() => openFile(node.path)}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} />
              <span className="truncate">{node.name}</span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => openFile(node.path)}>Open</ContextMenuItem>
            <ContextMenuItem onClick={() => { setRenaming({ path: node.path }); setRenamingName(node.name) }}>
              <Pencil className="w-3.5 h-3.5 mr-2" />Rename
            </ContextMenuItem>
            <ContextMenuItem onClick={() => downloadItem(node.path)}>
              <Download className="w-3.5 h-3.5 mr-2" />Download
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive" onClick={() => deleteItem(node.path)}>
              <Trash2 className="w-3.5 h-3.5 mr-2" />Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )
    }
    const isExpanded = expanded.has(node.path) || node.path === '.'
    const { Icon: FolderIconCmp, color: folderColor } = fileIconFor(node)
    const FolderIcon = isExpanded ? FolderOpen : (FolderIconCmp || Folder)
    return (
      <ContextMenu key={node.path}>
        <ContextMenuTrigger asChild>
          <div
            className="flex items-center gap-1.5 px-2 py-0.5 text-xs cursor-pointer rounded hover:bg-accent/20 select-none"
            style={{ paddingLeft: depth * 12 + 4 }}
            onClick={() => toggleDir(node.path)}
          >
            {isExpanded ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
            {<FolderIcon className="w-3.5 h-3.5" style={{ color: folderColor }} />}
            <span className="truncate font-medium">{node.name}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuSub>
            <ContextMenuSubTrigger><FilePlus className="w-3.5 h-3.5 mr-2" />New</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onClick={() => createItem('file', node.path)}>File</ContextMenuItem>
              <ContextMenuItem onClick={() => createItem('folder', node.path)}>Folder</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onClick={() => { uploadTargetRef.current = node.path; uploadInputRef.current?.click() }}>
            <Upload className="w-3.5 h-3.5 mr-2" />Upload files here
          </ContextMenuItem>
          {node.path !== '.' && (
            <>
              <ContextMenuItem onClick={() => { setRenaming({ path: node.path }); setRenamingName(node.name) }}>
                <Pencil className="w-3.5 h-3.5 mr-2" />Rename
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem className="text-destructive" onClick={() => deleteItem(node.path)}>
                <Trash2 className="w-3.5 h-3.5 mr-2" />Delete
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
        {isExpanded && (
          <div>
            {creating?.parent === node.path && (
              <div className="flex items-center gap-1 px-2 py-0.5 text-xs" style={{ paddingLeft: (depth + 1) * 12 + 4 }}>
                {creating.type === 'file' ? <FileIcon className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
                <Input
                  autoFocus
                  value={creatingName}
                  onChange={(e) => setCreatingName(e.target.value)}
                  onBlur={submitCreate}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCreate()
                    if (e.key === 'Escape') setCreating(null)
                  }}
                  className="h-5 text-xs px-1 py-0"
                />
              </div>
            )}
            {(node.children || []).map(c => renderNode(c, depth + 1))}
          </div>
        )}
      </ContextMenu>
    )
  }

  return (
    <div className="h-full flex flex-col bg-sidebar/30">
      <div className="px-2 py-2 border-b border-border flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Files</span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => createItem('file', '.')} title="New file">
            <FilePlus className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => createItem('folder', '.')} title="New folder">
            <FolderPlus className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { uploadTargetRef.current = '.'; uploadInputRef.current?.click() }} title="Upload files">
            <Upload className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={load} title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>
      <div className="px-2 py-1.5 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {searchResults ? (
          <div className="text-xs">
            <div className="px-2 py-1 flex items-center justify-between">
              <span className="text-muted-foreground">{searchResults.length} results</span>
              <Button variant="ghost" size="sm" className="h-5 px-2 text-xs" onClick={() => setSearchResults(null)}>Clear</Button>
            </div>
            {searchResults.map((r, i) => (
              <div
                key={i}
                className="px-2 py-1 cursor-pointer hover:bg-accent/20"
                onClick={() => openFile(r.path)}
              >
                <div className="text-foreground truncate">{r.path}:{r.line}</div>
                <div className="text-muted-foreground truncate">{r.preview}</div>
              </div>
            ))}
          </div>
        ) : (
          tree ? (
            <>
              <div className="px-2 py-1 flex items-center gap-1 border-b border-border mb-1">
                <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px]" onClick={() => expandAll(tree)}>
                  <ChevronDown className="w-2.5 h-2.5 mr-1" />Expand all
                </Button>
                <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px]" onClick={() => setExpanded(new Set(['.']))}>
                  <ChevronRight className="w-2.5 h-2.5 mr-1" />Collapse all
                </Button>
              </div>
              {renderNode(tree)}
            </>
          ) : <div className="text-xs text-muted-foreground p-4">Loading...</div>
        )}
      </div>

      {/* Code / image / markdown preview — shows the selected file inline at
          the bottom of the Files panel. Images render as real <img> (base64
          endpoint), .md renders rendered markdown, everything else shows text.
          This makes the Files section useful on its own without needing to
          switch to the Editor tab. */}
      {previewContent !== null && (
        <div className="border-t border-border max-h-1/2 flex flex-col" style={{ height: '40%' }}>
          <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-muted/30 shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              {(() => {
                const { Icon, color } = fileIconFor({ name: (previewPath || '').split('/').pop() || '', type: 'file' })
                return <Icon className="w-3 h-3 shrink-0" style={{ color }} />
              })()}
              <span className="text-xs font-mono truncate">{previewPath}</span>
              {previewKind === 'image' && <span className="text-[9px] text-muted-foreground shrink-0">image preview</span>}
              {previewKind === 'markdown' && <span className="text-[9px] text-muted-foreground shrink-0"><Eye className="w-2.5 h-2.5 inline mr-0.5" />rendered</span>}
            </div>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setPreviewContent(null)} title="Close preview">
              {/* v63: this was a Pencil icon that only CLOSED the preview —
                  an edit affordance for an action that doesn't exist. */}
              <X className="w-3 h-3" />
            </Button>
          </div>
          {previewKind === 'image' ? (
            <div className="flex-1 overflow-auto p-2 bg-[repeating-conic-gradient(#1f2430_0%_25%,#11161e_0%_50%)] bg-[length:16px_16px] grid place-items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewContent} alt={previewPath || ''} className="max-w-full max-h-full object-contain rounded" />
            </div>
          ) : previewKind === 'markdown' ? (
            <div className="flex-1 overflow-auto p-3 prose prose-sm prose-invert max-w-none text-sm [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:rounded [&_a]:text-primary [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground">
              <ReactMarkdown>{previewContent}</ReactMarkdown>
            </div>
          ) : (
            <pre className="flex-1 overflow-auto p-2 text-[10px] font-mono leading-tight bg-background text-muted-foreground">
              <code>{previewContent}</code>
            </pre>
          )}
        </div>
      )}

      {/* Hidden input backing the upload buttons (toolbar = root, context menu = folder) */}
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => { uploadFiles(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
