/**
 * v123 — COLLABORATION UI.
 *
 * CollabPresence — invisible heartbeat component: while a project is open it
 * polls /collab/sync every 6s, keeps the peer list in the store, and toasts +
 * refreshes the file tree when a teammate saves/creates/deletes a file.
 *
 * CollabDialog — invite by email (registered CloudAgent users), peer list with
 * live avatars, remove collaborators (owner only).
 */
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Users, UserPlus, Loader2, Trash2, Circle } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'
import * as collabStore from '@/lib/collab-store'

export function CollabPresence() {
  const { activeProject, bumpTree, view } = useAppStore()
  const since = useRef(0)
  const lastPath = useRef('')

  useEffect(() => {
    since.current = 0
    lastPath.current = ''
    if (!activeProject || typeof window === 'undefined') return
    const projectId = activeProject.id
    let stopped = false

    const tick = async (leaving = false) => {
      if (stopped) return
      try {
        const st = useAppStore.getState()
        const tab = st.activeTabPath || ''
        const r = await fetch(`/api/projects/${projectId}/collab/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab, since: since.current, leaving }),
        })
        if (!r.ok) return
        const d = await r.json()
        if (stopped) return
        collabStore.setOnline(d?.online || [])
        if (typeof d?.cursor === 'number') since.current = Math.max(since.current, d.cursor)
        for (const ev of d?.events || []) {
          const key = `${ev.byUserId}:${ev.path}:${ev.action}`
          if (key === lastPath.current) continue // echo of my own poll cycle
          lastPath.current = key
          const verb = ev.action === 'save' ? 'saved' : ev.action === 'delete' ? 'deleted' : 'renamed'
          toast(`${ev.byName} ${verb} ${ev.path}`, { description: 'File tree refreshing…' })
          bumpTree()
        }
      } catch { /* offline tick — next beat retries */ }
    }

    const onLeave = () => { void tick(true) }
    window.addEventListener('beforeunload', onLeave)
    void tick()
    const iv = setInterval(() => void tick(), 6000)
    return () => {
      stopped = true
      clearInterval(iv)
      window.removeEventListener('beforeunload', onLeave)
      collabStore.setOnline([])
      void onLeave()
    }
  }, [activeProject?.id, bumpTree, view])

  return null
}

interface Collab { userId: string; name: string; email: string; role: string }

export function CollabDialog() {
  const { collabOpen, setCollabOpen, activeProject } = useAppStore()
  const online = collabStore.useOnline()
  const [rows, setRows] = useState<Collab[]>([])
  const [isOwner, setIsOwner] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!activeProject) return
    setLoading(true)
    try {
      const r = await fetch(`/api/projects/${activeProject.id}/collab`)
      const d = await r.json()
      if (d?.ok) {
        setRows(d.collaborators || [])
        setIsOwner(!!d.isOwner)
      }
    } catch { /* dialog still renders */ }
    setLoading(false)
  }, [activeProject?.id])

  useEffect(() => { if (collabOpen) void load() }, [collabOpen, load])

  const invite = async () => {
    if (!email.trim() || busy || !activeProject) return
    setBusy(true)
    try {
      const r = await fetch(`/api/projects/${activeProject.id}/collab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      })
      const d = await r.json()
      if (d?.ok) {
        toast.success(`${email} ekhon collaborator!`)
        setEmail('')
        void load()
      } else toast.error(d?.error || 'invite failed')
    } catch { toast.error('invite failed') }
    setBusy(false)
  }

  const remove = async (userId: string) => {
    if (!activeProject) return
    try {
      const r = await fetch(`/api/projects/${activeProject.id}/collab?userId=${userId}`, { method: 'DELETE' })
      const d = await r.json()
      if (d?.ok) { toast.success('Removed'); void load() }
    } catch { toast.error('remove failed') }
  }

  if (!activeProject) return null

  return (
    <Dialog open={collabOpen} onOpenChange={setCollabOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600" /> Collaborate — {activeProject.name}
          </DialogTitle>
          <DialogDescription>
            Registered CloudAgent user-der email diye invite korun — sobai eki app e kaj korte parbe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border p-3">
            <p className="text-xs font-medium mb-2 flex items-center gap-1.5">
              <Circle className="w-2.5 h-2.5 fill-emerald-500 text-emerald-500" /> Online now ({online.length})
            </p>
            {online.length === 0 ? (
              <p className="text-xs text-muted-foreground">Shudhu apni online.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {online.map((p) => (
                  <span key={p.userId} className="inline-flex items-center gap-1 text-xs rounded-full pl-1 pr-2 py-0.5 border" style={{ background: `${p.color}18` }}>
                    <span className="w-4 h-4 rounded-full text-[9px] flex items-center justify-center text-white font-bold" style={{ background: p.color }}>
                      {(p.name || '?').slice(0, 1).toUpperCase()}
                    </span>
                    {p.name}{p.tab ? <span className="text-muted-foreground">· {p.tab.split('/').pop()}</span> : null}
                  </span>
                ))}
              </div>
            )}
          </div>

          {isOwner && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-xs font-medium flex items-center gap-1.5"><UserPlus className="w-3.5 h-3.5" /> Invite collaborator</p>
              <div className="flex gap-2">
                <Input placeholder="friend@cloudagent.user" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') invite() }} className="h-9" />
                <select value={role} onChange={(e) => setRole(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm">
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <Button size="sm" className="h-9" onClick={invite} disabled={busy || !email.trim()}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Invite'}
                </Button>
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-medium mb-2">Team ({rows.length})</p>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            {!loading && rows.length === 0 && <p className="text-xs text-muted-foreground">Ekhono keu invite hoy nai.</p>}
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {rows.map((c) => (
                <div key={c.userId} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
                  <span className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-700 text-[10px] font-bold flex items-center justify-center">
                    {(c.name || c.email).slice(0, 1).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{c.email}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{c.role}</Badge>
                  {isOwner && (
                    <button onClick={() => remove(c.userId)} title="Remove" className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
