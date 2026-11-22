'use client'

import { useState, lazy, Suspense, useRef } from 'react'
import { Plus, Terminal as TerminalIcon, Loader2, Copy, Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

// xterm.js + socket.io only run in the browser — dynamically import to
// avoid SSR issues (xterm references `self` at module eval time).
const TerminalPane = lazy(() => import('./TerminalPane').then(m => ({ default: m.TerminalPane })))

interface TerminalPanelProps {
  projectId: string
}

export function TerminalPanel({ projectId }: TerminalPanelProps) {
  const [panes, setPanes] = useState<string[]>(['pane-1'])
  const [activePane, setActivePane] = useState('pane-1')
  // Full output buffer per pane (accumulated client-side from polling) so
  // Download log / Copy output export REAL terminal content.
  const outputRef = useRef<Record<string, string>>({})

  function addPane() {
    const id = `pane-${Date.now()}`
    setPanes(p => [...p, id])
    setActivePane(id)
  }

  function closePane(id: string) {
    setPanes(p => {
      const next = p.filter(x => x !== id)
      setActivePane(prev => {
        if (prev !== id) return prev
        // Keep pointing at a real pane when the active one closes (previously
        // could point at a removed id → blank terminal area)
        if (next.length === 0) return ''
        if (next.includes(prev)) return prev
        return next[Math.max(0, p.indexOf(id) - 1)] || next[0]
      })
      return next
    })
    delete outputRef.current[id]
  }

  function restartActive() {
    if (!activePane) return
    // Remounting the pane with a new key triggers TerminalPane's unmount
    // cleanup, which kills the old shell session server-side.
    const old = activePane
    const id = `pane-${Date.now()}`
    setPanes(p => p.map(x => (x === old ? id : x)))
    setActivePane(id)
    delete outputRef.current[old]
    toast.success('Terminal restarted')
  }

  function downloadLog() {
    const log = outputRef.current[activePane] || '(no output captured in this pane yet)'
    const blob = new Blob([log], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `terminal-${activePane}.txt`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Terminal log downloaded')
  }

  function copyOutput() {
    const log = outputRef.current[activePane] || ''
    if (!log) {
      toast.info('No output to copy yet')
      return
    }
    navigator.clipboard.writeText(log)
      .then(() => toast.success('Terminal output copied'))
      .catch(() => toast.error('Clipboard unavailable'))
  }

  return (
    <div className="h-full flex flex-col bg-[#0a0e14]">
      <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-card/30">
        <div className="flex items-center gap-1 overflow-x-auto">
          {panes.map(p => (
            <button
              key={p}
              className={`text-xs px-2 py-1 rounded-t-md border-b-2 whitespace-nowrap ${activePane === p ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => setActivePane(p)}
            >
              {p.replace('pane-', 'Term ')}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* v63: the old History button here was a toast stub ("use ↑/↓ keys")
              — command history is now REAL and lives inside each pane's own
              header, where the session id it needs actually exists. */}
          <Button variant="ghost" size="icon" className="h-5 w-5" title="Copy output" onClick={copyOutput}>
            <Copy className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" title="Download log" onClick={downloadLog}>
            <Download className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" title="Restart terminal" onClick={restartActive}>
            <RefreshCw className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={addPane} title="New terminal">
            <Plus className="w-3 h-3" />
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {panes.length === 0 ? (
          <div className="grid place-items-center h-full text-xs text-muted-foreground gap-2">
            <span>No terminal open</span>
            <Button size="sm" variant="outline" onClick={addPane}><Plus className="w-3 h-3 mr-1" />New terminal</Button>
          </div>
        ) : panes.map(p => (
          <div key={p} className={`h-full ${activePane === p ? 'block' : 'hidden'}`}>
            <Suspense fallback={<div className="grid place-items-center h-full"><Loader2 className="w-4 h-4 animate-spin" /></div>}>
              <TerminalPane
                key={p}
                projectId={projectId}
                paneId={p}
                onOutput={(text) => { outputRef.current[p] = (outputRef.current[p] || '') + text; if (outputRef.current[p].length > 2_000_000) outputRef.current[p] = outputRef.current[p].slice(-1_000_000) }}
                onClose={() => closePane(p)}
              />
            </Suspense>
          </div>
        ))}
      </div>
    </div>
  )
}
