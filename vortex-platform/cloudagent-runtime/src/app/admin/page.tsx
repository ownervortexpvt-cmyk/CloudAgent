'use client'

/**
 * /admin — CLOUD AGENT CONTROL ROOM (v113)
 *
 * One locked place where the owner controls EVERYTHING:
 *   Overview · Razorpay · AI Providers · Local Models · Users · Toolchains · Security
 *
 * Two gates stand in front of it:
 *   1. the normal admin login session (role='admin')
 *   2. THIS room's own PIN (default 100039161924486, changeable in Security)
 * The PIN gate lives here — even an active admin session in a hijacked tab
 * cannot touch payments, keys, users or toolchains without the room PIN.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { afetch, clearAdminToken, getAdminToken, saveAdminToken } from './admin-client'
import { OverviewPanel, RazorpayPanel, UpiPanel, ProvidersPanel, LocalAiPanel, UsersPanel, ToolchainsPanel, SecurityPanel, ControlPanel, DataPanel, ProjectsPanel, EmailPanel, EcosystemPanel, ServerPanel } from './admin-panels'
import { CodePanel } from './code-panel'

type Gate = 'boot' | 'need-login' | 'locked' | 'open'

const TABS = [
  { id: 'overview', label: 'Overview', icon: '◈' },
  { id: 'server', label: 'Server System', icon: '🖥' },
  { id: 'ecosystem', label: 'VORTEX & Updates', icon: '🌀' },
  { id: 'code', label: 'Code Hub', icon: '{ }' },
  { id: 'control', label: 'Control', icon: '⏻' },
  { id: 'razorpay', label: 'Razorpay', icon: '₹' },
  { id: 'upi', label: 'UPI Verify', icon: '🤖' },
  { id: 'email', label: 'Email', icon: '✉' },
  { id: 'providers', label: 'AI Providers', icon: '⬡' },
  { id: 'localai', label: 'Local Models', icon: '⌬' },
  { id: 'users', label: 'Users', icon: '⚇' },
  { id: 'projects', label: 'Projects', icon: '▤' },
  { id: 'data', label: 'Data', icon: '⛁' },
  { id: 'toolchains', label: 'Toolchains', icon: '⚒' },
  { id: 'security', label: 'Security', icon: '⛨' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function AdminPage() {
  const [gate, setGate] = useState<Gate>('boot')
  const [tab, setTab] = useState<TabId>(() => {
    // deep link: /admin?tab=code opens the Code Hub directly
    try {
      const q = new URLSearchParams(window.location.search).get('tab') as TabId | null
      return q && TABS.some((t) => t.id === q) ? q : 'overview'
    } catch { return 'overview' }
  })
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [expiresAt, setExpiresAt] = useState<number | null>(null)

  // keep the URL in sync so a tab can be bookmarked/shared
  const switchTab = useCallback((t: TabId) => {
    setTab(t)
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('tab', t)
      window.history.replaceState(null, '', u.toString())
    } catch { /* SSR-safe */ }
  }, [])

  // Boot: which gate are we behind?
  useEffect(() => {
    ;(async () => {
      try {
        const s = await fetch('/api/admin/panel/session', { credentials: 'include', headers: getAdminToken() ? { 'x-ca-admin': getAdminToken()! } : {} })
        if (s.status === 401 || s.status === 403) { setGate('need-login'); return }
        const j = await s.json().catch(() => ({}))
        if (j.locked === false) { setGate('open'); setExpiresAt(j.expiresAt ?? null) }
        else setGate('locked')
      } catch {
        setGate('need-login')
      }
    })()
  }, [])

  const unlock = useCallback(async () => {
    setBusy(true); setErr('')
    try {
      const j = await afetch('/api/admin/panel/session', { method: 'POST', body: JSON.stringify({ pin }) })
      if (j.token) saveAdminToken(j.token)
      setExpiresAt(j.expiresAt ?? null)
      setPin('')
      setGate('open')
    } catch (e: any) {
      setErr(e.message || 'Unlock failed')
    } finally { setBusy(false) }
  }, [pin])

  const lockNow = useCallback(async () => {
    try { await afetch('/api/admin/panel/session', { method: 'DELETE' }) } catch {}
    clearAdminToken()
    setGate('locked')
  }, [])

  // ───────────────────────── GATES ─────────────────────────
  if (gate === 'boot') {
    return (
      <div className="min-h-screen bg-[#08080a] text-zinc-300 flex items-center justify-center">
        <div className="animate-pulse font-mono text-sm text-zinc-500">CONTROL ROOM · booting…</div>
      </div>
    )
  }

  if (gate === 'need-login') {
    return (
      <div className="min-h-screen bg-[#08080a] text-zinc-300 flex items-center justify-center p-6">
        <div className="max-w-sm w-full border border-zinc-800 rounded-2xl bg-zinc-950 p-8 text-center space-y-4">
          <div className="text-3xl">⛨</div>
          <h1 className="font-semibold text-lg text-zinc-100">Admin sign-in required</h1>
          <p className="text-sm text-zinc-500">Sign in with the owner account first — the control room PIN comes after.</p>
          <Button className="w-full bg-emerald-600 hover:bg-emerald-500" onClick={() => { window.location.href = '/login?next=/admin' }}>
            Go to sign in →
          </Button>
        </div>
      </div>
    )
  }

  if (gate === 'locked') {
    return (
      <div className="min-h-screen bg-[#08080a] text-zinc-300 flex items-center justify-center p-6">
        <div className="max-w-sm w-full border border-zinc-800 rounded-2xl bg-zinc-950 p-8 space-y-5 shadow-2xl">
          <div className="text-center space-y-1">
            <div className="text-3xl">🔒</div>
            <h1 className="font-semibold text-lg text-zinc-100 font-mono tracking-tight">CONTROL ROOM</h1>
            <p className="text-xs text-zinc-500">Owner PIN required · payments, keys, users, toolchains</p>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); if (!busy && pin) unlock() }}
            className="space-y-3"
          >
            <Input
              type="password" inputMode="numeric" autoFocus value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter admin PIN"
              className="bg-black border-zinc-800 text-center font-mono text-lg tracking-[0.3em]"
            />
            {err && <div className="text-xs text-red-400 text-center">{err}</div>}
            <Button type="submit" disabled={busy || !pin} className="w-full bg-emerald-600 hover:bg-emerald-500">
              {busy ? 'Verifying…' : 'Unlock control room'}
            </Button>
          </form>
          <p className="text-[11px] text-zinc-600 text-center">Session auto-locks after 12 hours</p>
        </div>
      </div>
    )
  }

  // ───────────────────────── CONTROL ROOM ─────────────────────────
  return (
    <div className="min-h-screen bg-[#08080a] text-zinc-300">
      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-[#08080a]/95 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-emerald-500 font-mono font-bold">◆</span>
            <span className="font-mono font-semibold text-zinc-100 tracking-tight truncate">VORTEX CLOUD AGENT · CONTROL ROOM</span>
            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-900">
              UNLOCKED{expiresAt ? ` · ${new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors hidden sm:inline">← Builder</a>
            <Button size="sm" variant="outline" className="border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900" onClick={lockNow}>
              Lock now
            </Button>
          </div>
        </div>
        {/* tab strip */}
        <nav className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto pb-2 -mt-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-mono transition-colors border ${
                tab === t.id
                  ? 'bg-emerald-950/50 text-emerald-300 border-emerald-900'
                  : 'bg-transparent text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-zinc-900'
              }`}
            >
              <span className="mr-1.5 opacity-70">{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 pb-24">
        {tab === 'overview' && <OverviewPanel onGoto={setTab} />}
        {tab === 'server' && <ServerPanel />}
        {tab === 'ecosystem' && <EcosystemPanel />}
        {tab === 'code' && <CodePanel />}
        {tab === 'control' && <ControlPanel />}
        {tab === 'razorpay' && <RazorpayPanel />}
        {tab === 'upi' && <UpiPanel />}
        {tab === 'email' && <EmailPanel />}
        {tab === 'providers' && <ProvidersPanel />}
        {tab === 'localai' && <LocalAiPanel />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'projects' && <ProjectsPanel />}
        {tab === 'data' && <DataPanel />}
        {tab === 'toolchains' && <ToolchainsPanel />}
        {tab === 'security' && <SecurityPanel onLocked={() => setGate('locked')} />}
      </main>
    </div>
  )
}
