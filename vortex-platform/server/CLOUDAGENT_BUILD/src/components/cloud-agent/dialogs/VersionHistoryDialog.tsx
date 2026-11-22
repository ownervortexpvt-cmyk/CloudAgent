'use client'

/**
 * v60 — Version history (time-travel) dialog for the editor dashboard.
 * Real /api/versions calls only: snapshot now, restore (with confirm),
 * delete. v62 adds a real DIFF view: any snapshot vs the current files,
 * per-file +/- lines, so restore decisions are informed, not blind.
 */
import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { History, Loader2, Plus, RotateCcw, Trash2, Camera, GitCompare } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'

interface Snapshot {
  id: string
  label: string
  fileCount?: number
  createdAt: string
}

interface DiffLine { t: ' ' | '+' | '-'; s: string }
interface FileDiff { path: string; added: number; removed: number; truncated?: boolean; lines: DiffLine[] }
interface DiffResult { changed: number; addedFiles: number; removedFiles: number; files: FileDiff[] }

export function VersionHistoryDialog() {
  const { versionHistoryOpen, setVersionHistoryOpen, activeProject, bumpTree } = useAppStore()
  const projectId = activeProject?.id || ''
  const [versions, setVersions] = useState<Snapshot[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  // v62: diff panel state
  const [diffOf, setDiffOf] = useState<Snapshot | null>(null)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [openFile, setOpenFile] = useState<string | null>(null)

  async function load() {
    if (!projectId) return
    try {
      const r = await fetch(`/api/versions?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store' })
      const j = await r.json()
      setVersions(j.versions || [])
    } catch { setVersions([]) }
  }

  useEffect(() => {
    if (versionHistoryOpen) { load(); setLabel(''); setDiffOf(null); setDiff(null) }
  }, [versionHistoryOpen, projectId])

  async function snapshot() {
    setBusy(true)
    try {
      const r = await fetch('/api/versions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action: 'snapshot', label: label.trim() || 'manual snapshot' }),
      })
      const j = await r.json()
      if (j.ok) { toast.success('Snapshot created'); setLabel(''); load() }
      else toast.error(j.error || 'Snapshot failed')
    } catch { toast.error('Network error') } finally { setBusy(false) }
  }

  async function restore(v: Snapshot) {
    if (!confirm(`Restore "${v.label}"? Current files will be replaced by the snapshot (${v.fileCount ?? '?'} files).`)) return
    setBusy(true)
    try {
      const r = await fetch('/api/versions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action: 'restore', id: v.id }),
      })
      const j = await r.json()
      if (j.ok) { toast.success(`Restored ${j.restored ?? 0} files — tree refreshed`); bumpTree(); load() }
      else toast.error(j.error || 'Restore failed')
    } catch { toast.error('Network error') } finally { setBusy(false) }
  }

  async function remove(v: Snapshot) {
    if (!confirm(`Delete snapshot "${v.label}" permanently?`)) return
    setBusy(true)
    try {
      const r = await fetch('/api/versions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action: 'delete', id: v.id }),
      })
      const j = await r.json()
      if (j.ok) { toast.success('Snapshot deleted'); load() }
      else toast.error(j.error || 'Delete failed')
    } catch { toast.error('Network error') } finally { setBusy(false) }
  }

  // v62: snapshot vs current — the REAL line diff
  async function showDiff(v: Snapshot) {
    setDiffOf(v)
    setDiff(null)
    setOpenFile(null)
    setDiffLoading(true)
    try {
      const r = await fetch('/api/versions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action: 'diff', id: v.id }),
      })
      const j = await r.json()
      if (j.ok) setDiff(j)
      else toast.error(j.error || 'Diff failed')
    } catch { toast.error('Network error') } finally { setDiffLoading(false) }
  }

  return (
    <Dialog open={versionHistoryOpen} onOpenChange={setVersionHistoryOpen}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="w-4 h-4 text-amber-400" /> Version history</DialogTitle>
          <DialogDescription>Time-travel snapshots of every project file. Diff any snapshot against the current files, then restore any point instantly.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            className="h-8 text-xs" placeholder="Snapshot label (optional) — e.g. before big refactor"
            value={label} onChange={e => setLabel(e.target.value)}
          />
          <Button size="sm" disabled={busy || !projectId} onClick={snapshot}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Plus className="w-3.5 h-3.5 mr-1" /> Snapshot now</>}
          </Button>
        </div>

        <div className="max-h-80 overflow-y-auto space-y-1.5">
          {versions === null && <div className="text-xs text-muted-foreground py-4 text-center">Loading…</div>}
          {versions?.length === 0 && (
            <div className="text-xs text-muted-foreground py-6 text-center flex flex-col items-center gap-1">
              <Camera className="w-5 h-5 opacity-40" /> No snapshots yet — take one before risky changes.
            </div>
          )}
          {versions?.map(v => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5">
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{v.label}</div>
                <div className="text-[10px] text-muted-foreground">
                  {new Date(v.createdAt).toLocaleString()}{v.fileCount !== undefined ? ` · ${v.fileCount} files` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy || diffLoading} onClick={() => showDiff(v)} title="Diff this snapshot against the current files">
                  <GitCompare className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => restore(v)} title="Restore this snapshot">
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" disabled={busy} onClick={() => remove(v)} title="Delete snapshot">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {diffOf && (
          <div className="border rounded-lg p-3 bg-muted/10">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-xs font-semibold flex items-center gap-1.5 min-w-0">
                <GitCompare className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">"{diffOf.label}" vs current files</span>
              </div>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => { setDiffOf(null); setDiff(null) }}>Close diff</Button>
            </div>
            {diffLoading && <div className="text-xs text-muted-foreground py-3 text-center"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Diffing…</div>}
            {diff && (
              <>
                <div className="text-[10px] text-muted-foreground mb-2">
                  {diff.changed === 0 ? 'No differences — the project matches this snapshot.' :
                    `${diff.changed} changed file${diff.changed !== 1 ? 's' : ''} · +${diff.files.reduce((a, f) => a + f.added, 0)} added · -${diff.files.reduce((a, f) => a + f.removed, 0)} removed lines`}
                </div>
                <div className="space-y-1">
                  {diff.files.map(f => (
                    <div key={f.path} className="rounded border border-border/50">
                      <button
                        className="w-full flex items-center justify-between gap-2 px-2 py-1 text-[11px] hover:bg-muted/40 text-left"
                        onClick={() => setOpenFile(o => (o === f.path ? null : f.path))}
                      >
                        <span className="font-mono truncate">{f.path}</span>
                        <span className="shrink-0"><span className="text-emerald-500">+{f.added}</span> <span className="text-rose-500">-{f.removed}</span>{f.truncated && <span className="text-muted-foreground"> (truncated)</span>}</span>
                      </button>
                      {openFile === f.path && (
                        <div className="border-t border-border/50 max-h-56 overflow-auto font-mono text-[10px] leading-tight">
                          {f.lines.map((l, i) => (
                            <div key={i} className={
                              l.t === '+' ? 'bg-emerald-500/10 text-emerald-400' :
                              l.t === '-' ? 'bg-rose-500/10 text-rose-400' : 'text-muted-foreground'
                            }>
                              <span className="inline-block w-4 text-center opacity-60 select-none">{l.t}</span>
                              <span className="whitespace-pre-wrap break-all">{l.s || ' '}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
