'use client'

import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { TerminalIcon, Trash2, X, Loader2, Keyboard, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

// Inline xterm CSS to avoid Turbopack chunk loading issues
const XTERM_CSS = `
.xterm { font-family: monospace; position: relative; user-select: none; -ms-user-select: none; -webkit-user-select: none; }
.xterm.focus, .xterm:focus { outline: none; }
.xterm .xterm-helpers { position: absolute; z-index: 5; }
.xterm .xterm-helper-textarea { position: absolute; opacity: 0; left: -9999em; top: 0; width: 0; height: 0; z-index: -5; white-space: nowrap; overflow: hidden; resize: none; }
.xterm .composition-view { background: #000; color: #FFF; display: none; position: absolute; white-space: nowrap; z-index: 1; }
.xterm .composition-view.active { display: block; }
.xterm .xterm-viewport { background-color: #000; overflow-y: scroll; cursor: default; position: absolute; right: 0; left: 0; top: 0; bottom: 0; }
.xterm .xterm-screen { position: relative; }
.xterm .xterm-screen canvas { position: absolute; left: 0; top: 0; }
.xterm .xterm-scroll-area { visibility: hidden; }
.xterm-char-measure-element { display: inline-block; visibility: hidden; position: absolute; top: 0; left: -9999em; }
.xterm.enable-mouse-options { cursor: pointer; }
.xterm.xterm-cursor-pointer, .xterm .xterm-cursor-pointer { cursor: pointer; }
.xterm.column-select-focus { cursor: crosshair; }
.xterm .xterm-accessibility:not(:focus), .xterm .xterm-message { position: absolute; left: 0; top: 0; bottom: 0; right: 0; z-index: 10; color: transparent; }
.xterm .live-region { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: hidden; }
.xterm-dim { opacity: 1 !important; }
.xterm-underline-1 { text-decoration: underline; }
.xterm-underline-2 { text-decoration: double underline; }
.xterm-underline-3 { text-decoration: wavy underline; }
.xterm-underline-4 { text-decoration: dotted underline; }
.xterm-underline-5 { text-decoration: dashed underline; }
.xterm-strikethrough { text-decoration: line-through; }
.xterm-screen .xterm-decoration-overview-ruler { z-index: 2; position: absolute; top: 0; right: 0; pointer-events: none; }
.xterm-decoration-overview-ruler-viewport { position: absolute; right: 0; pointer-events: none; }
.xterm-decoration-top { position: relative; width: 100%; z-index: 3; }
.xterm-decoration-bottom { position: relative; width: 100%; z-index: 3; }
.xterm-decoration-left { position: absolute; left: 0; width: 100%; z-index: 3; }
.xterm-decoration-right { position: absolute; right: 0; width: 100%; z-index: 3; }
.xterm-decoration-full-line { width: 100%; position: absolute; z-index: 3; pointer-events: none; }
.xterm-decoration-empty-line { left: 0; width: 0; }
.xterm-decoration-point { width: 1px; height: 1px; position: absolute; z-index: 3; }
.xterm-decoration-bar { height: 1px; z-index: 3; }
.xterm-decoration-wavy-underline { background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 3 3'%3E%3Cpath d='M0 2 L1 1 L2 2 L3 1' fill='none' stroke='%23f00' stroke-width='1'/%3E%3C/svg%3E"); background-position: 0 100%; background-repeat: repeat-x; background-size: 3px 3px; }
`

export interface TerminalPaneProps {
  projectId: string
  paneId: string
  /** Optional callback receiving every chunk written to the pane (for log export) */
  onOutput?: (text: string) => void
  onClose: () => void
}

/**
 * Terminal pane — uses HTTP polling instead of socket.io.
 *
 * On mobile, xterm.js doesn't reliably capture keyboard input from the
 * soft keyboard. To fix this, we add an invisible text input that's always
 * focused when the user taps the terminal. The mobile keyboard sends key
 * events to this input, which we forward to the terminal API.
 *
 * On desktop, xterm handles keyboard input natively.
 */
export function TerminalPane({ projectId, paneId, onOutput, onClose }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const hiddenInputRef = useRef<HTMLInputElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // v102: the terminal session lives in the SERVER'S MEMORY — every platform
  // restart (deploy, watchdog recovery, crash) silently voids it. The pane now
  // self-heals: any 404/410 from the terminal API triggers an automatic
  // reconnect instead of a frozen dead pane that only a page reload fixed.
  // The effect registers the real reconnect fn here; input paths outside the
  // effect call it through this ref.
  const restartRef = useRef<((reason: string) => void) | null>(null)
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>('starting')
  const [errorMsg, setErrorMsg] = useState('')
  const [showMobileInput, setShowMobileInput] = useState(false)
  const [mobileInputValue, setMobileInputValue] = useState('')
  // v63: real per-pane command history (the panel-level button used to be a
  // toast stub). Typed lines accumulate here and persist per project.
  const [history, setHistory] = useState<string[]>([])
  const lineBufRef = useRef('')
  const [shellName, setShellName] = useState('bash')

  // v63: load + persist this project's command history (cap 50)
  function loadHistory(): string[] {
    try {
      const raw = localStorage.getItem(`ca:term-history:${projectId}`)
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr) ? arr.slice(0, 50) : []
    } catch { return [] }
  }
  function pushHistory(cmd: string) {
    const c = cmd.trim()
    if (!c) return
    setHistory(prev => {
      const next = [c, ...prev.filter(x => x !== c)].slice(0, 50)
      try { localStorage.setItem(`ca:term-history:${projectId}`, JSON.stringify(next)) } catch {}
      return next
    })
  }
  /** v102: ONE input path for every caller (xterm onData, mobile bar,
   *  history re-run, ⏎/⌫/Tab/^C buttons). A 404 means the session died with
   *  a server restart, 410 means the shell exited — both now self-heal via
   *  restartRef instead of vanishing into .catch(() => {}) silence. */
  async function postInput(data: string) {
    const sid = sessionIdRef.current
    if (!sid) return
    try {
      const res = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'input', sessionId: sid, data }),
      })
      if (res.status === 404 || res.status === 410) restartRef.current?.('session lost — reconnecting')
    } catch {}
  }

  // Re-run a history line: send it to the shell exactly as if typed + Enter.
  function rerun(cmd: string) {
    postInput(cmd + '\n')
    setShowMobileInput(false)
  }

  useEffect(() => {
    if (!containerRef.current) return
    let disposed = false

    const term = new XTerm({
      fontFamily: 'var(--font-geist-mono), Menlo, Consolas, monospace',
      // v63: Settings → Terminal font size used to write a key nothing read
      fontSize: (typeof window !== 'undefined' && parseInt(localStorage.getItem('ca:termFontSize') || '13', 10)) || 13,
      cursorBlink: true,
      cursorStyle: 'bar',
      convertEol: true,
      theme: {
        background: '#0a0e14',
        foreground: '#cdd3df',
        cursor: '#f5b942',
        selectionBackground: '#2a3142',
        black: '#0a0e14',
        red: '#ff6b6b',
        green: '#8ec5c5',
        yellow: '#f5b942',
        blue: '#5ec8c8',
        magenta: '#c084fc',
        cyan: '#5ec8c8',
        white: '#cdd3df',
        brightBlack: '#3a3f4b',
        brightRed: '#ff8a8a',
        brightGreen: '#a8d8d8',
        brightYellow: '#f5b942',
        brightBlue: '#7ed8d8',
        brightMagenta: '#d4a4ff',
        brightCyan: '#7ed8d8',
        brightWhite: '#ffffff',
      },
    })
    const fit = new FitAddon()
    const links = new WebLinksAddon()
    term.loadAddon(fit)
    term.loadAddon(links)
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    term.writeln('\x1b[33mStarting terminal...\x1b[0m')

    // Route every chunk written to xterm through the optional onOutput
    // callback so the parent can export real terminal logs.
    const termWrite = (text: string) => {
      term.write(text)
      try { onOutput?.(text) } catch {}
    }

    // v102: shared session mint — used by the initial start AND by every
    // self-heal reconnect, so both paths send identical payload (shell pref).
    async function mintSession() {
      const shell = (typeof window !== 'undefined' && localStorage.getItem('ca:shell')) || 'bash'
      const res = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', projectId, shell }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'HTTP ' + res.status }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (disposed) return data
      sessionIdRef.current = data.sessionId
      if (data.shell) setShellName(data.shell)
      setStatus('ready')
      return data
    }

    // v102 SELF-HEAL: the session Map lives in the server process. Any deploy,
    // watchdog recovery or crash wipes it — the old pane polled a dead id
    // forever (GET 404 was silently swallowed) and typing did nothing. Now a
    // 404/410 anywhere re-mints a session and keeps the pane alive — no page
    // reload needed.
    let restarting = false
    function scheduleRestart(reason: string) {
      if (restarting || disposed) return
      restarting = true
      if (pollRef.current) clearInterval(pollRef.current)
      termWrite(`\r\n\x1b[33m[terminal ${reason} — reconnecting…]\x1b[0m\r\n`)
      const attempt = async () => {
        if (disposed) { restarting = false; return }
        try {
          await mintSession()
          termWrite('\x1b[32m[terminal reconnected — type again]\x1b[0m\r\n')
          restarting = false
          startPolling()
        } catch {
          // server probably mid-restart — honest retry, never an infinite spin
          retryTimerRef.current = setTimeout(attempt, 3000)
        }
      }
      attempt()
    }
    restartRef.current = scheduleRestart

    async function startSession() {
      try {
        const data = await mintSession()
        if (disposed) return
        term.write('\x1b[2J\x1b[H') // clear
        term.writeln(`\x1b[32mCloud Agent terminal ready\x1b[0m`)
        term.writeln(`\x1b[2m# cwd: ${data.cwd}\x1b[0m`)
        term.writeln('')
        term.writeln('\x1b[2mTap here and type — or tap the keyboard icon for mobile input.\x1b[0m')
        term.writeln('')

        startPolling()
      } catch (e: any) {
        if (disposed) return
        setStatus('error')
        setErrorMsg(e.message)
        term.writeln(`\x1b[31mFailed to start terminal: ${e.message}\x1b[0m`)
        term.writeln('\x1b[2mRetrying in 3s...\x1b[0m')
        // Clear any previous retry timer and stop retrying after unmount
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
        retryTimerRef.current = setTimeout(() => { if (!disposed) startSession() }, 3000)
      }
    }

    async function pollOutput() {
      const sid = sessionIdRef.current
      if (!sid || disposed) return
      try {
        const res = await fetch(`/api/terminal?sessionId=${sid}`, { signal: AbortSignal.timeout(2000) })
        if (res.status === 404 || res.status === 410) {
          // v102: dead session (server restarted / shell killed) — self-heal.
          scheduleRestart('session lost')
          return
        }
        if (!res.ok) return
        const data = await res.json()
        if (data.output) termWrite(data.output)
        if (data.ended) {
          term.writeln('\x1b[31m[session ended]\x1b[0m')
          if (pollRef.current) clearInterval(pollRef.current)
          // v102: an exited shell no longer bricks the pane — reconnect.
          scheduleRestart('shell exited')
        }
      } catch {}
    }

    function startPolling() {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(pollOutput, 100)
      pollOutput()
    }

    // Desktop keyboard input via xterm native handler
    term.onData((data) => {
      // v102: shared postInput — 404/410 self-heals instead of dying quietly.
      postInput(data)
      // v63: track the typed line so the History button holds REAL commands
      // (Enter commits, Backspace erases, printable chars append).
      if (data === '\r' || data === '\n') {
        if (lineBufRef.current.trim()) pushHistory(lineBufRef.current)
        lineBufRef.current = ''
      } else if (data === '\x7f') {
        lineBufRef.current = lineBufRef.current.slice(0, -1)
      } else if (data === '\x03') {
        lineBufRef.current = ''
      } else if (data.length === 1 && data >= ' ' && data !== '\x1b') {
        lineBufRef.current += data
      } else if (data.length > 1 && !data.startsWith('\x1b')) {
        lineBufRef.current += data
      }
    })

    const resizeObs = new ResizeObserver(() => {
      try { fit.fit() } catch {}
      const sid = sessionIdRef.current
      if (sid) {
        fetch('/api/terminal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resize', sessionId: sid, cols: term.cols, rows: term.rows }),
        }).catch(() => {})
      }
    })
    resizeObs.observe(containerRef.current)

    startSession()

    return () => {
      disposed = true
      resizeObs.disconnect()
      if (pollRef.current) clearInterval(pollRef.current)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      const sid = sessionIdRef.current
      if (sid) {
        fetch('/api/terminal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'kill', sessionId: sid }),
        }).catch(() => {})
      }
      term.dispose()
    }
  }, [projectId, paneId])

  useEffect(() => {
    // v63: history + settings live-follow. The ca:settings-changed broadcast
    // (Settings → Terminal) applies the new font size to every open pane.
    setHistory(loadHistory())
    const onSettings = () => {
      const term = termRef.current
      if (!term) return
      const fs = parseInt(localStorage.getItem('ca:termFontSize') || '13', 10) || 13
      if (term.options.fontSize !== fs) {
        term.options.fontSize = fs
        try { fitRef.current?.fit() } catch {}
      }
    }
    window.addEventListener('ca:settings-changed', onSettings)
    return () => window.removeEventListener('ca:settings-changed', onSettings)
  }, [projectId])

  // Mobile keyboard input handler — when user types in the hidden input,
  // forward each character to the terminal API.
  function handleMobileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const newValue = e.target.value
    const oldValue = mobileInputValue
    const sid = sessionIdRef.current
    if (!sid) return

    if (newValue.length > oldValue.length) {
      // Characters were added
      const added = newValue.slice(oldValue.length)
      // Send the added text to terminal
      postInput(added)
    } else if (newValue.length < oldValue.length) {
      // Backspace was pressed
      const deleted = oldValue.length - newValue.length
      postInput('\x7f'.repeat(deleted))
    }
    setMobileInputValue(newValue)
  }

  function handleMobileKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const sid = sessionIdRef.current
    if (!sid) return
    if (e.key === 'Enter') {
      e.preventDefault()
      // Send newline and clear input
      postInput('\n')
      // NOTE: no local echo — the shell echoes the typed line back via the
      // output poller, so echoing here too duplicated every command line.
      if (mobileInputValue.trim()) pushHistory(mobileInputValue)
      lineBufRef.current = ''
      setMobileInputValue('')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      postInput('\t')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      postInput('\x1b[A')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      postInput('\x1b[B')
    } else if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault()
      postInput('\x03')
      setMobileInputValue('')
      termRef.current?.write('^C')
    }
  }

  function clearTerminal() {
    termRef.current?.clear()
    const sid = sessionIdRef.current
    if (sid) {
      fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear', sessionId: sid }),
      }).catch(() => {})
    }
  }

  function focusTerminal() {
    // Focus xterm for desktop users
    const term = termRef.current as any
    if (term?.textarea) {
      term.textarea.focus()
    } else if (term?.inputRef) {
      term.inputRef.focus()
    }
    // On mobile, also show the mobile input bar
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
      setShowMobileInput(true)
      setTimeout(() => hiddenInputRef.current?.focus(), 100)
    }
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0e14]">
      <style dangerouslySetInnerHTML={{ __html: XTERM_CSS }} />
      <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-card/30">
        <div className="flex items-center gap-1.5">
          <TerminalIcon className="w-3 h-3 text-primary" />
          <span className="text-[10px] font-mono text-muted-foreground">{shellName} — {paneId}</span>
          {status === 'starting' && <Loader2 className="w-3 h-3 animate-spin text-yellow-500" />}
          {status === 'error' && <span className="text-[10px] text-red-500">●</span>}
          {status === 'ready' && <span className="text-[10px] text-green-500">●</span>}
        </div>
        <div className="flex items-center gap-0.5">
          {/* v63: REAL command history — the panel-level button used to fire a
              toast saying "use ↑/↓"; now every pane tracks its own typed
              lines (per project, cap 50) and clicking one re-runs it. */}
          {history.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-5 w-5" title={`Command history (${history.length}) — click to re-run`}>
                  <History className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 max-h-72 overflow-y-auto">
                {history.map((cmd, i) => (
                  <DropdownMenuItem key={i} className="font-mono text-[11px] gap-2" onClick={() => rerun(cmd)}>
                    <span className="text-muted-foreground shrink-0">$</span>
                    <span className="truncate">{cmd}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => {
            setShowMobileInput(!showMobileInput)
            setTimeout(() => hiddenInputRef.current?.focus(), 100)
          }} title="Mobile keyboard input">
            <Keyboard className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={clearTerminal} title="Clear">
            <Trash2 className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClose} title="Close">
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 px-2 py-1"
        onClick={focusTerminal}
        onTouchStart={focusTerminal}
      />
      {/* Mobile keyboard input bar — shows when toggled */}
      {showMobileInput && (
        <div className="border-t border-border bg-card/50 p-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-mono shrink-0">$</span>
            <input
              ref={hiddenInputRef}
              type="text"
              value={mobileInputValue}
              onChange={handleMobileInput}
              onKeyDown={handleMobileKeyDown}
              placeholder="Type here and press Enter..."
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="flex-1 bg-transparent text-sm font-mono text-foreground outline-none border-0 focus:ring-0"
              style={{ caretColor: '#f5b942' }}
            />
            <button
              onClick={() => {
                postInput('\n')
                setMobileInputValue('')
              }}
              className="text-[10px] px-2 py-1 rounded bg-primary/20 text-primary font-mono shrink-0"
            >
              ⏎
            </button>
            <button
              onClick={() => {
                postInput('\x7f')
                setMobileInputValue(v => v.slice(0, -1))
              }}
              className="text-[10px] px-2 py-1 rounded bg-muted text-muted-foreground font-mono shrink-0"
            >
              ⌫
            </button>
            <button
              onClick={() => {
                postInput('\t')
              }}
              className="text-[10px] px-2 py-1 rounded bg-muted text-muted-foreground font-mono shrink-0"
            >
              Tab
            </button>
            <button
              onClick={() => {
                postInput('\x03')
                setMobileInputValue('')
              }}
              className="text-[10px] px-2 py-1 rounded bg-red-500/20 text-red-400 font-mono shrink-0"
            >
              ^C
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
