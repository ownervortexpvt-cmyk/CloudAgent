'use client'

/**
 * v62 — Prompt Library dialog.
 * The PromptLibrary table existed from day one (the AI's own
 * prompt_library_create tool writes into it) but the owner could never SEE
 * those prompts. This dialog lists them, lets the owner add their own, and
 * ships any prompt straight into the agent chat or the AI Army input.
 */
import { useCallback, useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BookOpen, Loader2, Plus, Trash2, Copy, MessageSquare, Network, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'

interface Prompt {
  id: string
  title: string
  prompt: string
  category: string
  tags: string
  useCount: number
  updatedAt: string
}

const CATEGORIES = ['general', 'code', 'debug', 'design', 'architecture', 'review']

export function PromptLibraryDialog() {
  const { promptLibraryOpen, setPromptLibraryOpen, setMultiAgentOpen, setMultiAgentPrompt, setAIAgentOpen, activeProject, setPendingChatPrompt } = useAppStore()
  const [prompts, setPrompts] = useState<Prompt[] | null>(null)
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('all')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [cat, setCat] = useState('general')

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/prompts?q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`, { cache: 'no-store' })
      const j = await r.json()
      setPrompts(j.prompts || [])
    } catch { setPrompts([]) }
  }, [q, category])

  useEffect(() => {
    if (promptLibraryOpen) load()
  }, [promptLibraryOpen, load])

  async function create() {
    if (!title.trim() || !text.trim()) { toast.error('Title and prompt are both required'); return }
    setBusy(true)
    try {
      const r = await fetch('/api/prompts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), prompt: text.trim(), category: cat }),
      })
      const j = await r.json()
      if (j.ok) { toast.success('Prompt saved'); setTitle(''); setText(''); setCat('general'); setAdding(false); load() }
      else toast.error(j.error || 'Save failed')
    } catch { toast.error('Network error') } finally { setBusy(false) }
  }

  async function remove(p: Prompt) {
    if (!confirm(`Delete prompt "${p.title}"?`)) return
    try {
      const r = await fetch(`/api/prompts?id=${p.id}`, { method: 'DELETE' })
      const j = await r.json()
      if (j.ok) { toast.success('Prompt deleted'); load() } else toast.error(j.error || 'Delete failed')
    } catch { toast.error('Network error') }
  }

  async function useInChat(p: Prompt) {
    bumpUse(p)
    setPromptLibraryOpen(false)
    // v63: hand the prompt through the STORE, not a window event — the old
    // ca:use-prompt event only worked when AgentPanel was already mounted
    // (dashboard). On the welcome screen the toast claimed success while the
    // prompt silently vanished; now it survives until the chat mounts.
    setPendingChatPrompt(p.prompt)
    setAIAgentOpen(true)
    toast.success(`"${p.title}" queued for the agent chat${activeProject ? '' : ' — opens with your next project'}`)
  }

  function useInArmy(p: Prompt) {
    bumpUse(p)
    if (!activeProject) {
      // v63: the Army panel only exists inside a project — the old code set
      // flags nothing was reading and claimed success. Honest guard now.
      toast.error('Open a project first — the AI Army lives inside a project')
      return
    }
    setMultiAgentPrompt(p.prompt)
    setMultiAgentOpen(true)
    setPromptLibraryOpen(false)
    toast.success(`"${p.title}" pre-filled the AI Army`)
  }

  function bumpUse(p: Prompt) {
    fetch('/api/prompts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, use: true }),
    }).catch(() => {})
  }

  async function copy(p: Prompt) {
    bumpUse(p)
    try { await navigator.clipboard.writeText(p.prompt); toast.success('Prompt copied to clipboard') }
    catch { toast.error('Copy failed') }
  }

  return (
    <Dialog open={promptLibraryOpen} onOpenChange={setPromptLibraryOpen}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-emerald-400" /> Prompt library</DialogTitle>
          <DialogDescription>Reusable prompts — yours and the ones the AI saved while working. Send one to the chat, the Army, or the clipboard.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input className="h-8 pl-7 text-xs" placeholder="Search prompts…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setAdding(a => !a)} title="Add a prompt">
            {adding ? 'Close' : <><Plus className="w-3.5 h-3.5 mr-1" /> New</>}
          </Button>
        </div>

        {adding && (
          <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
              <div>
                <Label className="text-[10px]">Title</Label>
                <Input className="h-8 text-xs" placeholder="e.g. Refactor this file cleanly" value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <div>
                <Label className="text-[10px]">Category</Label>
                <Select value={cat} onValueChange={setCat}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-[10px]">Prompt</Label>
              <Textarea className="text-xs min-h-[70px]" placeholder="Write the prompt you want to reuse…" value={text} onChange={e => setText(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <Button size="sm" disabled={busy} onClick={create}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Plus className="w-3.5 h-3.5 mr-1" /> Save prompt</>}
              </Button>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 -mx-1 px-1">
          {prompts === null && <div className="text-xs text-muted-foreground py-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>}
          {prompts?.length === 0 && (
            <div className="text-xs text-muted-foreground py-8 text-center flex flex-col items-center gap-1.5">
              <BookOpen className="w-6 h-6 opacity-40" />
              No prompts yet — add your first reusable prompt above.
            </div>
          )}
          {prompts?.map(p => (
            <div key={p.id} className="rounded-lg border border-border/60 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{p.title}</div>
                  <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 whitespace-pre-wrap">{p.prompt}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Badge variant="outline" className="text-[9px]">{p.category}</Badge>
                    <span className="text-[9px] text-muted-foreground">used {p.useCount}×</span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => useInChat(p)} title="Send to the agent chat">
                    <MessageSquare className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => useInArmy(p)} title="Pre-fill the AI Army">
                    <Network className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copy(p)} title="Copy to clipboard">
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => remove(p)} title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
