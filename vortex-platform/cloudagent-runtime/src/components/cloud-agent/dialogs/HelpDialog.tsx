'use client'

/**
 * v62 — Getting-started / Help dialog. The builder had a keyboard cheat
 * sheet but no real introduction for a first-time owner. This walks through
 * the 5 things this app actually does, with the buttons that open them.
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/lib/store'
import { Bot, Key, Play, Network, Rocket, HelpCircle, Keyboard, BookOpen, Sparkles } from 'lucide-react'

const STEPS: { icon: any; color: string; title: string; body: string }[] = [
  {
    icon: Key,
    color: 'text-amber-400',
    title: '1 · Add an AI key (30 seconds)',
    body: 'Open AI Providers (the +AI button). Pick any of your 15 providers — Auto-detect even recognises a pasted key on its own. The built-in Vortex Engine works with no key at all. Press "Test all keys" to see which are healthy before you build.',
  },
  {
    icon: Bot,
    color: 'text-primary',
    title: '2 · Chat an app into existence',
    body: 'Create a project, then type what you want in the agent chat — "make a landing page for my bakery". The agent writes the files, you watch them appear in the editor, and Run starts a live preview.',
  },
  {
    icon: Network,
    color: 'text-accent',
    title: '3 · Unleash the AI Army',
    body: 'Big job? Open AI Army and give it one task — a whole swarm of agents (leader + workers) splits it up and builds in parallel, with a live board, progress, ETA and a per-agent cost tally.',
  },
  {
    icon: Play,
    color: 'text-emerald-400',
    title: '4 · Iterate safely',
    body: 'Version history snapshots every file (diff any snapshot against the current one before restoring). Deleted projects go to a Trash you can restore from. Everything auto-saves while you type.',
  },
  {
    icon: Rocket,
    color: 'text-rose-400',
    title: '5 · Ship it',
    body: 'Publish builds a download artifact, GitHub pushes your code to a repo, and Growth Studio adds analytics, PWA install, payment stubs and security scans to the finished app.',
  },
]

export function HelpDialog() {
  const { helpOpen, setHelpOpen, setProviderManagerOpen } = useAppStore()

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><HelpCircle className="w-4 h-4 text-primary" /> Getting started</DialogTitle>
          <DialogDescription>Your personal AI cloud app builder — the 5-minute tour.</DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5">
          {STEPS.map((s, i) => (
            <div key={i} className="flex gap-3 rounded-lg border border-border/60 p-2.5">
              <div className="shrink-0 w-7 h-7 rounded-md bg-muted/50 grid place-items-center">
                <s.icon className={`w-4 h-4 ${s.color}`} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold">{s.title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{s.body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border/60 p-2.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground mb-1">
            <Keyboard className="w-3.5 h-3.5" /> Power tips
          </div>
          <p><kbd className="border rounded px-1 text-[10px]">Ctrl</kbd>+<kbd className="border rounded px-1 text-[10px]">K</kbd> opens the command palette from anywhere — it searches projects, file names, code and every action. <kbd className="border rounded px-1 text-[10px]">?</kbd> inside it shows every keyboard shortcut.</p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="outline" onClick={() => { setHelpOpen(false); useAppStore.getState().setPromptLibraryOpen(true) }}>
            <BookOpen className="w-3.5 h-3.5 mr-1" /> Prompt library
          </Button>
          <Button size="sm" onClick={() => { setHelpOpen(false); setProviderManagerOpen(true) }}>
            <Sparkles className="w-3.5 h-3.5 mr-1" /> Add an AI key now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
