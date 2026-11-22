'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Plus, FolderOpen, Rocket, Settings as SettingsIcon, Key, Lock,
  Users, Upload, Sparkles, Terminal, ShieldCheck, FileCode2, CornerDownLeft, FileSearch, Keyboard, History, BookOpen, HelpCircle, Store, Smartphone,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore, langFromPath, type ProjectMeta } from '@/lib/store'
import { clearLockToken } from '@/lib/lock-client'

interface Cmd {
  id: string
  label: string
  hint?: string
  icon: React.ComponentType<{ className?: string }>
  keywords?: string
  needsProject?: boolean
  run: () => void
}

/**
 * v25 — Command Palette (Ctrl/Cmd + K).
 * Quick actions + instant project switcher, available on every screen.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [idx, setIdx] = useState(0)
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  // v55: live code search inside the active project (path:line hits)
  const [codeHits, setCodeHits] = useState<{ path: string; line: number; preview: string }[]>([])
  // v62: quick-open mode (Ctrl+P) — lists the ACTIVE PROJECT'S FILES by name
  const [fileHits, setFileHits] = useState<{ path: string }[]>([])
  const [filesMode, setFilesMode] = useState(false)
  // v56: keyboard shortcut cheat sheet (press ? while the palette is open)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    activeProject, openProject, closeProject, setSettingsOpen, setProviderManagerOpen,
    setPublishDialogOpen, setGithubPanelOpen, setMultiAgentOpen, setGrowthStudioOpen,
    setSecretsOpen, setAIAgentOpen, openTab, setVersionHistoryOpen,
    setPromptLibraryOpen, setHelpOpen, setMarketOpen, setCollabOpen, setExportDialogOpen,
  } = useAppStore()

  // global toggle + v62 wiring for the editor's quick-open / project-search
  // events (these USED to fire into the void — the cheat sheet advertised
  // Ctrl+P and Ctrl+Shift+F but nothing listened)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    function onQuickOpen() { setFilesMode(true); setOpen(true) }
    function onSearchProject() { setFilesMode(false); setOpen(true) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('ca:quick-open', onQuickOpen)
    window.addEventListener('ca:search-project', onSearchProject)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('ca:quick-open', onQuickOpen)
      window.removeEventListener('ca:search-project', onSearchProject)
    }
  }, [])

  // load projects + focus input when opening
  useEffect(() => {
    if (!open) return
    setQuery(''); setIdx(0); setCodeHits([])
    fetch('/api/projects', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setProjects(d.projects || d || []))
      .catch(() => setProjects([]))
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  // v62: quick-open — flatten the active project's file tree and filter by
  // name as the owner types (file-name search, NOT full-text)
  useEffect(() => {
    if (!open || !filesMode || !activeProject) { setFileHits([]); return }
    const term = query.trim().toLowerCase()
    const t = setTimeout(() => {
      fetch(`/api/files/${activeProject.id}`, { cache: 'no-store' })
        .then(r => r.json())
        .then(d => {
          const files: string[] = []
          const walk = (n: any) => {
            if (!n) return
            if (n.type === 'file') files.push(n.path)
            else (n.children || []).forEach(walk)
          }
          walk(d.tree)
          const hits = (term ? files.filter(f => f.toLowerCase().includes(term)) : files)
            .slice(0, 12)
            .map(p => ({ path: p }))
          setFileHits(hits)
        })
        .catch(() => setFileHits([]))
    }, 120)
    return () => clearTimeout(t)
  }, [open, filesMode, query, activeProject])

  // v55: debounced code search inside the active project — every keystroke
  // greps the project files (path + line + preview) via /api/search
  useEffect(() => {
    if (!open || !activeProject) return
    const term = query.trim()
    if (term.length < 2) { setCodeHits([]); return }
    const t = setTimeout(() => {
      fetch(`/api/search?projectId=${encodeURIComponent(activeProject.id)}&q=${encodeURIComponent(term)}`, { cache: 'no-store' })
        .then(r => r.json())
        .then(d => setCodeHits((d.results || []).slice(0, 8)))
        .catch(() => setCodeHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [open, query, activeProject])

  // v55: open a code hit in the editor tab
  async function openCodeHit(hit: { path: string; line: number; preview: string }) {
    if (!activeProject) return
    try {
      const res = await fetch(`/api/files?projectId=${encodeURIComponent(activeProject.id)}&path=${encodeURIComponent(hit.path)}`)
      const data = await res.json()
      if (data.error) { toast.error(data.error); return }
      openTab({
        path: hit.path,
        name: hit.path.split('/').pop() || hit.path,
        content: data.content ?? '',
        dirty: false,
        language: langFromPath(hit.path),
      })
      setOpen(false)
    } catch (e: any) {
      toast.error(e?.message || 'Could not open file')
    }
  }

  const importZip = useCallback(async (file: File) => {
    if (!/\.zip$/i.test(file.name)) { toast.error('Choose a .zip file'); return }
    if (file.size > 20 * 1024 * 1024) { toast.error('ZIP must be under 20 MB'); return }
    const toastId = toast.loading('Importing project from ZIP…')
    try {
      const buf = await file.arrayBuffer()
      let b64 = ''
      const bytes = new Uint8Array(buf)
      const chunk = 0x8000
      for (let i = 0; i < bytes.length; i += chunk) {
        b64 += String.fromCharCode(...bytes.subarray(i, i + chunk))
      }
      const res = await fetch('/api/projects/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name.replace(/\.zip$/i, ''), zipBase64: btoa(b64) }),
      })
      const d = await res.json()
      if (d.ok && d.project) {
        toast.success(`Imported "${d.project.name}" — ${d.fileCount} files`, { id: toastId })
        openProject(d.project)
        setOpen(false)
      } else {
        toast.error(d.error || 'Import failed', { id: toastId })
      }
    } catch {
      toast.error('Import failed — could not read the ZIP', { id: toastId })
    }
  }, [openProject])

  const cmds: Cmd[] = useMemo(() => [
    {
      id: 'new', label: 'New project', hint: 'back to start screen', icon: Plus, keywords: 'create app',
      run: () => { closeProject(); setOpen(false) },
    },
    {
      id: 'import', label: 'Import project from ZIP', icon: Upload, keywords: 'upload backup restore',
      run: () => { setOpen(false); fileRef.current?.click() },
    },
    {
      id: 'swarm', label: 'Open multi-agent swarm', icon: Users, needsProject: true, keywords: 'agents build',
      run: () => { setMultiAgentOpen(true); setOpen(false) },
    },
    {
      id: 'studio', label: 'Open Growth Studio', icon: Sparkles, needsProject: true, keywords: 'monetize analytics assets security',
      run: () => { setGrowthStudioOpen(true); setOpen(false) },
    },
    {
      id: 'publish', label: 'Publish / deploy project', icon: Rocket, needsProject: true, keywords: 'deploy live apk web',
      run: () => { setPublishDialogOpen(true); setOpen(false) },
    },
    {
      id: 'github', label: 'GitHub panel', icon: FileCode2, needsProject: true, keywords: 'push repo export',
      run: () => { setGithubPanelOpen(true); setOpen(false) },
    },
    {
      id: 'market', label: 'Marketplace — share / sell / install apps', icon: Store, needsProject: false, keywords: 'market store sell buy install template v123',
      run: () => { setMarketOpen(true); setOpen(false) },
    },
    {
      id: 'collab', label: 'Collaborate — invite teammates (live)', icon: Users, needsProject: true, keywords: 'team invite multiplayer together collab',
      run: () => { setCollabOpen(true); setOpen(false) },
    },
    {
      id: 'apk', label: 'Download Android APK', icon: Smartphone, needsProject: true, keywords: 'android apk app store install phone',
      run: () => { setExportDialogOpen(true); setOpen(false) },
    },
    {
      id: 'agent', label: 'Open AI agent chat', icon: Terminal, needsProject: true, keywords: 'assistant chat',
      run: () => { setAIAgentOpen(true); setOpen(false) },
    },
    {
      id: 'versions', label: 'Version history (snapshot / restore / diff)', icon: History, needsProject: true, keywords: 'time travel snapshot restore backup files diff changes',
      run: () => { setVersionHistoryOpen(true); setOpen(false) },
    },
    {
      id: 'prompts', label: 'Prompt library', icon: BookOpen, keywords: 'prompts snippets reusable library',
      run: () => { setPromptLibraryOpen(true); setOpen(false) },
    },
    {
      id: 'help', label: 'Getting started / help', icon: HelpCircle, keywords: 'tour guide how to begin onboarding',
      run: () => { setHelpOpen(true); setOpen(false) },
    },
    {
      id: 'secrets', label: 'Project secrets', icon: ShieldCheck, needsProject: true, keywords: 'env api keys',
      run: () => { setSecretsOpen(true); setOpen(false) },
    },
    {
      id: 'providers', label: 'AI providers & keys', icon: Key, keywords: 'api gemini groq openrouter',
      run: () => { setProviderManagerOpen(true); setOpen(false) },
    },
    {
      id: 'settings', label: 'Settings', icon: SettingsIcon, keywords: 'preferences security lock usage',
      run: () => { setSettingsOpen(true); setOpen(false) },
    },
    {
      id: 'shortcuts', label: 'View keyboard shortcuts', hint: '?', icon: Keyboard, keywords: 'keys hotkeys help cheat sheet',
      run: () => { setOpen(false); setShowShortcuts(true) },
    },
    {
      id: 'lock', label: 'Sign out', hint: 'back to login', icon: Lock, keywords: 'logout security account',
      run: async () => {
        setOpen(false)
        try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {}
        clearLockToken() // v25.1: drop the embedded-header token too
        window.location.href = '/login'
      },
    },
  ], [closeProject, setMultiAgentOpen, setGrowthStudioOpen, setPublishDialogOpen, setGithubPanelOpen, setAIAgentOpen, setSecretsOpen, setProviderManagerOpen, setSettingsOpen, setVersionHistoryOpen, setPromptLibraryOpen, setHelpOpen, setMarketOpen, setCollabOpen, setExportDialogOpen])

  const q = query.trim().toLowerCase()

  const filteredCmds = useMemo(() => cmds.filter(c =>
    !q || c.label.toLowerCase().includes(q) || (c.keywords || '').includes(q),
  ), [cmds, q])

  const filteredProjects = useMemo(() => {
    if (!q) return projects.slice(0, 6)
    return projects.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8)
  }, [projects, q])

  const rows = useMemo(() => [
    ...filteredProjects.map(p => ({ kind: 'project' as const, p })),
    ...fileHits.map(f => ({ kind: 'file' as const, f })),
    ...codeHits.map(h => ({ kind: 'code' as const, h })),
    ...filteredCmds.map(c => ({ kind: 'cmd' as const, c })),
  ], [filteredProjects, filteredCmds, codeHits, fileHits])

  function exec(row: (typeof rows)[number]) {
    if (row.kind === 'project') {
      if (!row.p) return
      openProject(row.p)
      setOpen(false)
    } else if (row.kind === 'file') {
      void openCodeHit({ path: row.f.path, line: 0, preview: '' })
    } else if (row.kind === 'code') {
      void openCodeHit(row.h)
    } else {
      if (row.c.needsProject && !activeProject) {
        toast.error('Open a project first')
        return
      }
      row.c.run()
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(rows.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)) }
    else if (e.key === '?') { e.preventDefault(); setShowShortcuts(true) }
    else if (e.key === 'Enter') { e.preventDefault(); rows[idx] && exec(rows[idx]) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  // v56 — the REAL shortcuts only (everything below is actually wired up:
  // palette keydown handler, CodeEditor addCommand registrations, palette nav).
  const shortcutsOverlay = showShortcuts ? (
    <div
      className="fixed inset-0 z-[95] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[14vh] px-4"
      onMouseDown={() => setShowShortcuts(false)}
    >
      <div
        className="w-full max-w-md rounded-xl border bg-card shadow-2xl overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Keyboard className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">Keyboard shortcuts</span>
          <kbd className="ml-auto text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div className="px-4 py-3 space-y-2 max-h-[60vh] overflow-y-auto">
          {[
            { keys: ['Ctrl', 'K'], label: 'Command palette — jump to any project, file or action' },
            { keys: ['Ctrl', 'S'], label: 'Format + save the file you are editing' },
            { keys: ['Ctrl', 'Shift', 'F'], label: 'Search across the whole project' },
            { keys: ['Ctrl', 'P'], label: 'Quick-open a file' },
            { keys: ['↑', '↓'], label: 'Navigate palette results' },
            { keys: ['⏎'], label: 'Run the selected palette result' },
            { keys: ['Esc'], label: 'Close the palette / this cheat sheet' },
            { keys: ['?'], label: 'This cheat sheet (while the palette is open)' },
          ].map((s, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-1 shrink-0 min-w-[110px]">
                {s.keys.map((k, j) => (
                  <span key={j} className="flex items-center gap-1">
                    {j > 0 && <span className="text-[10px] text-muted-foreground">+</span>}
                    <kbd className="text-[11px] border rounded px-1.5 py-0.5 bg-muted/60 font-mono">{k}</kbd>
                  </span>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground pt-1.5 border-t border-border">
            Ctrl means ⌘ Cmd on Mac. Editor shortcuts (Ctrl+S / Ctrl+Shift+F / Ctrl+P) work while the code editor has focus.
          </p>
        </div>
        <div className="border-t border-border px-4 py-2 flex justify-end">
          <button
            type="button"
            className="text-xs px-2.5 py-1 rounded-md border hover:bg-muted/60"
            onClick={() => setShowShortcuts(false)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  ) : null

  useEffect(() => {
    if (!showShortcuts) return
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowShortcuts(false)
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [showShortcuts])

  if (!open) {
    return (
      <>
        <input
          ref={fileRef} type="file" accept=".zip" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) importZip(f); e.target.value = '' }}
        />
        {shortcutsOverlay}
      </>
    )
  }

  return (
    <>
      <input
        ref={fileRef} type="file" accept=".zip" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) importZip(f); e.target.value = '' }}
      />
      {shortcutsOverlay}
      <div
        className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
        onMouseDown={() => setOpen(false)}
      >
        <div
          className="w-full max-w-lg rounded-xl border bg-card shadow-2xl overflow-hidden"
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 px-3 border-b border-border">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setIdx(0) }}
              onKeyDown={onKeyDown}
              placeholder="Type a command, search projects or code…"
              className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="text-[10px] text-muted-foreground border rounded px-1.5 py-0.5 shrink-0">Esc</kbd>
          </div>

          <div className="max-h-[46vh] overflow-y-auto p-1.5">
            {rows.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-6">Nothing matches “{query}”</div>
            )}

            {filteredProjects.length > 0 && (
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pt-1.5 pb-1">Projects</div>
            )}
            {filteredProjects.map((p, i) => (
              <Row key={`p-${p.id}`} active={idx === i} onClick={() => exec({ kind: 'project', p })} onMouseEnter={() => setIdx(i)}>
                <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="truncate">{p.name}</span>
                {activeProject?.id === p.id && <span className="text-[10px] text-emerald-500 ml-auto shrink-0">open</span>}
              </Row>
            ))}

            {fileHits.length > 0 && (
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pt-2 pb-1 flex items-center gap-1"><Search className="w-3 h-3" /> Files in {activeProject?.name}</div>
            )}
            {fileHits.map((f, i) => {
              const rowIdx = filteredProjects.length + i
              return (
                <Row key={`f-${f.path}-${i}`} active={idx === rowIdx} onClick={() => exec({ kind: 'file', f })} onMouseEnter={() => setIdx(rowIdx)}>
                  <FileCode2 className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="truncate font-mono text-xs">{f.path}</span>
                </Row>
              )
            })}

            {codeHits.length > 0 && (
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pt-2 pb-1 flex items-center gap-1"><FileSearch className="w-3 h-3" /> Code in {activeProject?.name}</div>
            )}
            {codeHits.map((h, i) => {
              const rowIdx = filteredProjects.length + fileHits.length + i
              return (
                <Row key={`c-${h.path}-${h.line}-${i}`} active={idx === rowIdx} onClick={() => exec({ kind: 'code', h })} onMouseEnter={() => setIdx(rowIdx)}>
                  <FileCode2 className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="truncate min-w-0">
                    <span className="font-medium">{h.path}</span>
                    <span className="text-muted-foreground">:{h.line}</span>
                    <span className="block text-[10px] text-muted-foreground truncate">{h.preview}</span>
                  </span>
                </Row>
              )
            })}

            {filteredCmds.length > 0 && (
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pt-2 pb-1">Commands</div>
            )}
            {filteredCmds.map((c, i) => {
              const rowIdx = filteredProjects.length + fileHits.length + codeHits.length + i
              return (
                <Row
                  key={c.id}
                  active={idx === rowIdx}
                  onClick={() => exec({ kind: 'cmd', c })}
                  onMouseEnter={() => setIdx(rowIdx)}
                >
                  <c.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{c.label}</span>
                  {c.hint && <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{c.hint}</span>}
                  {idx === rowIdx && <CornerDownLeft className="w-3 h-3 ml-auto shrink-0 text-muted-foreground" />}
                </Row>
              )
            })}
          </div>

          <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground flex gap-3">
            <span>↑↓ navigate</span><span>⏎ run</span><span>Ctrl/⌘+K toggle</span><span>? shortcuts</span>
          </div>
        </div>
      </div>
    </>
  )
}

function Row({ active, onClick, onMouseEnter, children }: {
  active: boolean
  onClick: () => void
  onMouseEnter: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-left transition ${active ? 'bg-primary/15 text-foreground' : 'hover:bg-muted/60'}`}
    >
      {children}
    </button>
  )
}
