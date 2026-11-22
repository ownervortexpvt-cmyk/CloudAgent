'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2, Save, Settings as SettingsIcon, Terminal, Key, Eye, EyeOff, Palette, Loader2, Smartphone, BarChart3, ExternalLink, Wallet, BellRing , CreditCard, Gift, Users, PartyPopper} from 'lucide-react'
import { toast } from 'sonner'
// v116 — recharts (700KB) left the Settings chunk: the chart lazy-loads only
// when the Usage tab actually has data to show.
import dynamic from 'next/dynamic'
const UsageTokenChart = dynamic(() => import('@/components/cloud-agent/dialogs/UsageTokenChart'), {
  ssr: false,
  loading: () => <div className="h-48 w-full animate-pulse rounded-lg bg-muted/40" />,
})
import { useAppStore } from '@/lib/store'
import { InstallBuilderCard } from '@/components/cloud-agent/dialogs/InstallBuilderCard'
import { formatINR, getPlan } from '@/lib/plans'
import { startCheckout } from '@/lib/checkout'
// v151 — ecosystem i18n (English default / বাংলা / हिन्दी) + one-platform shortcuts
import { useLang, setLang, LANGS } from '@/lib/i18n'
import { platformLinks } from '@/lib/platform-links'
import { Globe } from 'lucide-react'

interface EnvVar {
  id: string
  key: string
  value: string
  isSecret: boolean
}

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen, activeProject, setProviderManagerOpen, settingsTabRequest, setSettingsTabRequest } = useAppStore()
  // v151 — the dialog labels follow the ecosystem language (English default)
  const { t } = useLang()
  // v119 — a pending one-shot deep-link (e.g. UserMenu → Refer & earn) decides
  // the opening tab; normal opens (request consumed = '') start at General.
  const [tab, setTab] = useState(() => useAppStore.getState().settingsTabRequest || 'general')

  // consume the request whenever it arrives — whether the dialog was closed
  // (mount with the right tab) or already open (live tab switch)
  useEffect(() => {
    if (settingsTabRequest) {
      setTab(settingsTabRequest)
      setSettingsTabRequest('')
    }
  }, [settingsTabRequest, setSettingsTabRequest])

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-w-3xl max-h-[85vh] p-0 flex flex-col">
        {/* Responsive height: fixed 600px overflowed off-screen on phones/short
            windows and overflow-hidden made lower settings unreachable */}
        <div className="flex flex-1 min-h-0 h-[600px] max-h-[calc(85vh-3rem)] max-lg:h-auto max-lg:max-h-[calc(85vh-3rem)] max-lg:flex-col">
          {/* Sidebar */}
          <div className="w-48 border-r border-border bg-card/30 p-2 flex flex-col gap-0.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1">{t('settings.title')}</div>
            <SettingsTab active={tab === 'plan'} onClick={() => setTab('plan')} icon={CreditCard}>{t('settings.plan')}</SettingsTab>
            <SettingsTab active={tab === 'refer'} onClick={() => setTab('refer')} icon={Gift}>{t('settings.refer')}</SettingsTab>
            <SettingsTab active={tab === 'general'} onClick={() => setTab('general')} icon={SettingsIcon}>{t('settings.general')}</SettingsTab>
            <SettingsTab active={tab === 'providers'} onClick={() => { setTab('providers'); setProviderManagerOpen(true); setSettingsOpen(false) }} icon={Key}>{t('settings.providers')}</SettingsTab>
            <SettingsTab active={tab === 'editor'} onClick={() => setTab('editor')} icon={Palette}>{t('settings.editor')}</SettingsTab>
            <SettingsTab active={tab === 'terminal'} onClick={() => setTab('terminal')} icon={Terminal}>{t('settings.terminal')}</SettingsTab>
            {/* v122 — SECURITY TAB REMOVED (owner request): its remnant app-lock
                (auto sign-out after idle) locked the whole builder and confused
                real usage. Password change lives in the Admin Control Room →
                Security for the owner; user passwords are resettable from
                Admin → Users. Nothing app-locking remains in Settings. */}
            {/* v116 — SECRET PURGE: Users(admin) / Payments(admin) / Backup tabs REMOVED.
                They leaked the control room's existence to every signed-in user, and the
                backup tab let anyone download the WHOLE platform (source + db + scripts).
                All of it now lives only behind the secret admin room; the backup/restore
                APIs themselves are admin-only gated server-side. */}
            <SettingsTab active={tab === 'usage'} onClick={() => setTab('usage')} icon={BarChart3}>{t('settings.usage')}</SettingsTab>
            <SettingsTab active={tab === 'benchmarks'} onClick={() => setTab('benchmarks')} icon={BarChart3}>{t('settings.benchmarks')}</SettingsTab>
            {activeProject && (
              <>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1 mt-2">{t('settings.project')}</div>
                <SettingsTab active={tab === 'env'} onClick={() => setTab('env')} icon={Key}>{t('settings.env')}</SettingsTab>
                <SettingsTab active={tab === 'info'} onClick={() => setTab('info')} icon={SettingsIcon}>{t('settings.info')}</SettingsTab>
              </>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {tab === 'plan' && <PlanSettings />}
            {tab === 'refer' && <ReferSettings />}
            {/* v116 — users/payments/backup panels deleted: owner-only features moved
                to the secret control room (src/app/admin). No user-facing remnants. */}
            {tab === 'general' && <GeneralSettings />}
            {tab === 'editor' && <EditorSettings />}
            {tab === 'terminal' && <TerminalSettings />}
            {tab === 'usage' && <UsageSettings />}
            {tab === 'benchmarks' && <BenchmarksSettings />}
            {tab === 'env' && activeProject && <EnvVarsSettings projectId={activeProject.id} />}
            {tab === 'info' && activeProject && <ProjectInfo projectId={activeProject.id} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SettingsTab({ children, active, onClick, icon: Icon }: {
  children: React.ReactNode; active: boolean; onClick: () => void; icon: any
}) {
  return (
    <button
      className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition ${active ? 'bg-primary/10 text-primary' : 'hover:bg-muted/40'}`}
      onClick={onClick}
    >
      <Icon className="w-3.5 h-3.5" />
      {children}
    </button>
  )
}

// ─── v124 ⚡ ULTRA SPEED PASS ─────────────────────────────────────────────
// One switch, one honest effect: every AI run this user starts leads with
// the built-in GLM 5.3 Flash fast lane. Saved per-user via /api/speed-pass.
function SpeedPassCard() {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let dead = false
    fetch('/api/speed-pass').then((r) => r.json()).then((d) => { if (!dead) setOn(Boolean(d.on)) }).catch(() => {})
    return () => { dead = true }
  }, [])
  async function flip(next: boolean) {
    setBusy(true)
    setOn(next) // optimistic
    try {
      const r = await fetch('/api/speed-pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: next ? '1' : '0' }),
      })
      const d = await r.json()
      if (!d.ok) setOn(!next)
    } catch { setOn(!next) } finally { setBusy(false) }
  }
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label>⚡ Ultra Speed Pass</Label>
          <p className="text-xs text-muted-foreground">
            Every AI build leads with the GLM 5.3 Flash fast lane — the lowest first-token latency in the stack.
            The full fallback chain stays armed behind it, so speed never costs reliability.
          </p>
        </div>
        <Switch checked={on} disabled={busy} onCheckedChange={flip} />
      </div>
      {on && <Badge variant="outline" className="mt-2 text-[10px]">⚡ Active — your next run leads with GLM 5.3 Flash</Badge>}
    </Card>
  )
}

function GeneralSettings() {
  // Lazy-init from localStorage — avoids the sync set-state-in-effect pattern
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (typeof window !== 'undefined' ? (localStorage.getItem('ca:theme') as 'dark' | 'light' | null) : null) || 'dark')
  const [autoSave, setAutoSave] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('ca:autoSave') !== 'false' : true)
  const [defaultProvider, setDefaultProvider] = useState('')
  // v151 — language + one-platform shortcuts
  const { lang, t } = useLang()
  const links = platformLinks()

  function applyTheme(next: 'dark' | 'light') {
    setTheme(next)
    document.documentElement.classList.remove('dark', 'light')
    document.documentElement.classList.add(next)
    localStorage.setItem('ca:theme', next)
  }

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">{t('general.title')}</h3>
      {/* v151 — ecosystem language: English (global default) / বাংলা / हिन्दी */}
      <Card className="p-3 space-y-3">
        <div>
          <Label className="flex items-center gap-2"><Globe className="w-4 h-4 text-primary" />{t('general.language')}</Label>
          <p className="text-xs text-muted-foreground mt-1">{t('general.languageHint')}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {LANGS.map((l) => (
            <Button key={l.id} variant="outline" size="sm"
              className={lang === l.id ? 'border-primary text-primary bg-primary/10' : ''}
              onClick={() => setLang(l.id)}>
              {l.native}
            </Button>
          ))}
        </div>
      </Card>

      {/* v151 — ONE platform, four modules: one-tap navigation between them */}
      <Card className="p-3 space-y-2">
        <h4 className="text-sm font-medium">{t('shortcuts.title')}</h4>
        <p className="text-xs text-muted-foreground">{t('shortcuts.hint')}</p>
        <div className="grid sm:grid-cols-2 gap-2">
          <Button variant="outline" className="justify-start h-auto py-2" onClick={() => window.open(links.website, '_blank')}>
            <span className="flex flex-col items-start text-left w-full">
              <span className="flex items-center gap-1.5 text-sm font-medium"><Globe className="w-4 h-4" />{t('shortcuts.website')}<ExternalLink className="w-3 h-3 opacity-50" /></span>
              <span className="text-xs text-muted-foreground font-normal">{t('shortcuts.websiteDesc')}</span>
            </span>
          </Button>
          <Button variant="outline" className="justify-start h-auto py-2" onClick={() => window.open(links.server, '_blank')}>
            <span className="flex flex-col items-start text-left w-full">
              <span className="flex items-center gap-1.5 text-sm font-medium"><SettingsIcon className="w-4 h-4" />{t('shortcuts.server')}<ExternalLink className="w-3 h-3 opacity-50" /></span>
              <span className="text-xs text-muted-foreground font-normal">{t('shortcuts.serverDesc')}</span>
            </span>
          </Button>
          <Button variant="outline" className="justify-start h-auto py-2" onClick={() => window.open(links.appverse, '_blank')}>
            <span className="flex flex-col items-start text-left w-full">
              <span className="flex items-center gap-1.5 text-sm font-medium"><Smartphone className="w-4 h-4" />{t('shortcuts.appverse')}<ExternalLink className="w-3 h-3 opacity-50" /></span>
              <span className="text-xs text-muted-foreground font-normal">{t('shortcuts.appverseDesc')}</span>
            </span>
          </Button>
          <Button variant="outline" className="justify-start h-auto py-2" onClick={() => window.open(links.agent, '_blank')}>
            <span className="flex flex-col items-start text-left w-full">
              <span className="flex items-center gap-1.5 text-sm font-medium"><Terminal className="w-4 h-4" />{t('shortcuts.agent')}<ExternalLink className="w-3 h-3 opacity-50" /></span>
              <span className="text-xs text-muted-foreground font-normal">{t('shortcuts.agentDesc')}</span>
            </span>
          </Button>
        </div>
      </Card>

      <InstallBuilderCard />
      <Card className="p-3 space-y-3">
        <div>
          <Label>{t('general.theme')}</Label>
          <div className="flex gap-2 mt-1">
            <Button variant={theme === 'dark' ? 'default' : 'outline'} size="sm" onClick={() => applyTheme('dark')}>{t('general.dark')}</Button>
            <Button variant={theme === 'light' ? 'default' : 'outline'} size="sm" onClick={() => applyTheme('light')}>{t('general.light')}</Button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label>{t('general.autoSave')}</Label>
            <p className="text-xs text-muted-foreground">{t('general.autoSaveHint')}</p>
          </div>
          <Switch checked={autoSave} onCheckedChange={(b) => { setAutoSave(b); localStorage.setItem('ca:autoSave', String(b)); window.dispatchEvent(new Event('ca:settings-changed')) }} />
        </div>
      </Card>

      {/* v124 ⚡ — the utmost-speed run lane, per user */}
      <SpeedPassCard />

      {/* v63: /api/projects/storage existed since forever with NO caller —
          real disk usage is now visible instead of a dead endpoint. */}
      <StorageCard />

      <Card className="p-3">
        <h4 className="text-sm font-medium mb-2">Runtime</h4>
        <p className="text-xs text-muted-foreground mb-2">
          Cloud Agent uses the localhost runtime in this environment. To switch to a Docker-based runtime,
          set <code>CA_RUNTIME=docker</code> on the server and ensure Docker is available.
        </p>
        <Badge variant="outline" className="text-[10px]">Active: localhost</Badge>
      </Card>

      <Card className="p-3">
        <h4 className="text-sm font-medium mb-2">No artificial credit system</h4>
        <p className="text-xs text-muted-foreground">
          Cloud Agent intentionally does not implement a fake AI credit balance or prompt-count limit.
          Your usage is bounded only by your configured AI provider's plan.
        </p>
      </Card>
    </div>
  )
}

// ─── v119: REFER & EARN — the growth engine finally has a face ──────────────
// Personal invite code + one-tap WhatsApp share + honest dual-reward stats.
// Reward engine lives in lib/referral.ts; this tab only reads /api/referral/me.

interface ReferralFriend { name: string; joinedAt: string; plan: string }
interface ReferralData {
  code: string
  link: string
  shareText: string
  rewardDays: number
  rewardPlan: { id: string; name: string; priceINR: number }
  totalReferred: number
  friends: ReferralFriend[]
}

function ReferSettings() {
  const [data, setData] = useState<ReferralData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let dead = false
    fetch('/api/referral/me', { cache: 'no-store' })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((d) => { if (!dead && d?.ok) setData(d as ReferralData) })
      .catch(() => {})
      .finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [])

  async function copyText(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied — now share it!`)
    } catch {
      toast.error('Could not copy — long-press the text instead')
    }
  }

  function shareWhatsApp() {
    if (!data) return
    window.open(`https://wa.me/?text=${encodeURIComponent(data.shareText)}`, '_blank')
  }

  async function shareNative() {
    if (!data) return
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try { await (navigator as any).share({ title: 'CloudAgent — AI App Builder', text: data.shareText }) } catch {}
    } else {
      copyText(data.shareText, 'Invite message')
    }
  }

  if (loading) {
    return <div className="h-48 w-full animate-pulse rounded-lg bg-muted/40" />
  }

  if (!data) {
    return (
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Refer & Earn</h3>
        <Card className="p-4 text-sm text-muted-foreground">
          Could not load your invite code. Please close and reopen Settings — if it keeps failing, sign in again.
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold flex items-center gap-2"><Gift className="w-4 h-4 text-emerald-500" /> Refer & Earn</h3>

      {/* Reward headline */}
      <Card className="p-4 border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-background to-background">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center shrink-0">
            <PartyPopper className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <div className="font-semibold">Give {data.rewardDays} days of {data.rewardPlan.name}, get {data.rewardDays} days of {data.rewardPlan.name}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Every friend who signs up with your link gets {data.rewardDays} days of {data.rewardPlan.name} ({formatINR(data.rewardPlan.priceINR)}/mo value) free — and you get {data.rewardDays} extra days added to your current plan the moment they join. No card, no waiting.
            </p>
          </div>
        </div>
      </Card>

      {/* Code + link + share */}
      <Card className="p-4 space-y-3">
        <div>
          <Label>Your invite code</Label>
          <div className="flex items-center gap-2 mt-1.5">
            <code className="flex-1 rounded-md border bg-muted/40 px-3 py-2 text-lg font-mono font-bold tracking-[0.2em] select-all">{data.code}</code>
            <Button variant="outline" size="sm" onClick={() => copyText(data.code, 'Code')}>Copy code</Button>
          </div>
        </div>
        <div>
          <Label>Your invite link</Label>
          <div className="flex items-center gap-2 mt-1.5">
            <input
              readOnly
              value={data.link}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground select-all"
            />
            <Button variant="outline" size="sm" onClick={() => copyText(data.link, 'Link')}>Copy link</Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={shareWhatsApp} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            <svg viewBox="0 0 24 24" className="w-4 h-4 mr-1.5 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            Share on WhatsApp
          </Button>
          <Button variant="outline" size="sm" onClick={shareNative}>More ways to share</Button>
        </div>
      </Card>

      {/* How it works */}
      <Card className="p-4">
        <h4 className="text-sm font-medium mb-2">How it works</h4>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>Share your link with a friend (WhatsApp, Instagram, anywhere).</li>
          <li>They see your name on the signup screen and create their account — their {data.rewardDays}-day {data.rewardPlan.name} reward applies automatically.</li>
          <li>The moment they join, {data.rewardDays} extra days land on YOUR plan. Refer 4 friends — that's a month of {data.rewardPlan.name} free.</li>
        </ol>
      </Card>

      {/* Stats + friends */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Your referrals</h4>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">Friends joined: <span className="font-semibold text-foreground">{data.totalReferred}</span></span>
            <span className="text-muted-foreground">Days earned: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{data.totalReferred * data.rewardDays}</span></span>
          </div>
        </div>
        {data.friends.length === 0 ? (
          <p className="text-xs text-muted-foreground">No referrals yet — share your link above and your friends will appear here the moment they join.</p>
        ) : (
          <ul className="space-y-1.5">
            {data.friends.map((f, i) => (
              <li key={i} className="flex items-center justify-between text-xs rounded-md border bg-muted/20 px-2.5 py-1.5">
                <span className="font-medium">{f.name}</span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">{f.plan}</Badge>
                  joined {new Date(f.joinedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function EditorSettings() {
  const [fontSize, setFontSize] = useState(() =>
    typeof window !== 'undefined' ? parseInt(localStorage.getItem('ca:fontSize') || '13', 10) : 13)
  const [wordWrap, setWordWrap] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('ca:wordWrap') !== 'false' : true)
  const [minimap, setMinimap] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('ca:minimap') !== 'false' : true)

  // v63: every change broadcasts ca:settings-changed — CodeEditor listens and
  // applies the values LIVE (the old copy falsely promised "next file open"
  // for controls nothing ever read).
  const apply = (key: string, value: string) => {
    localStorage.setItem(key, value)
    window.dispatchEvent(new Event('ca:settings-changed'))
  }

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Editor</h3>
      <Card className="p-3 space-y-3">
        <div>
          <Label>Font size: {fontSize}px</Label>
          <Slider value={[fontSize]} min={10} max={22} step={1} onValueChange={([v]) => {
            setFontSize(v); apply('ca:fontSize', String(v))
          }} className="mt-2" />
        </div>
        <div className="flex items-center justify-between">
          <Label>Word wrap</Label>
          <Switch checked={wordWrap} onCheckedChange={(b) => { setWordWrap(b); apply('ca:wordWrap', String(b)) }} />
        </div>
        <div className="flex items-center justify-between">
          <Label>Show minimap</Label>
          <Switch checked={minimap} onCheckedChange={(b) => { setMinimap(b); apply('ca:minimap', String(b)) }} />
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">Applied to the editor instantly — open files included.</p>
    </div>
  )
}

function TerminalSettings() {
  const [fontSize, setFontSize] = useState(() =>
    typeof window !== 'undefined' ? parseInt(localStorage.getItem('ca:termFontSize') || '13', 10) : 13)
  const [shell, setShell] = useState(() =>
    (typeof window !== 'undefined' ? localStorage.getItem('ca:shell') : null) || 'bash')

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Terminal</h3>
      <Card className="p-3 space-y-3">
        <div>
          <Label>Font size: {fontSize}px</Label>
          <Slider value={[fontSize]} min={10} max={22} step={1} onValueChange={([v]) => {
            setFontSize(v); localStorage.setItem('ca:termFontSize', String(v)); window.dispatchEvent(new Event('ca:settings-changed'))
          }} className="mt-2" />
        </div>
        <div>
          <Label>Shell</Label>
          <Select value={shell} onValueChange={(v) => { setShell(v); localStorage.setItem('ca:shell', v); window.dispatchEvent(new Event('ca:settings-changed')) }}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bash">bash</SelectItem>
              <SelectItem value="sh">sh</SelectItem>
              <SelectItem value="zsh">zsh (if installed)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">Applies to the next terminal session — use the terminal's ↻ Restart button (or open a new pane) to pick it up.</p>
        </div>
      </Card>
    </div>
  )
}

/** v63 — real disk usage from the previously-unconsumed
 *  GET /api/projects/storage endpoint. Per-project when one is open,
 *  whole-workspace totals otherwise. */
function StorageCard() {
  const activeProject = useAppStore(s => s.activeProject)
  const [usage, setUsage] = useState<{ bytes: number; files: number } | null>(null)

  useEffect(() => {
    let dead = false
    fetch(`/api/projects/storage${activeProject ? `?projectId=${activeProject.id}` : ''}`)
      .then(r => r.json())
      .then(d => { if (!dead) setUsage({ bytes: d.totalBytes || 0, files: d.totalFiles || 0 }) })
      .catch(() => {})
    return () => { dead = true }
  }, [activeProject?.id])

  const mb = usage ? (usage.bytes / (1024 * 1024)).toFixed(1) : null
  return (
    <Card className="p-3">
      <h4 className="text-sm font-medium mb-1">Storage</h4>
      <p className="text-xs text-muted-foreground">
        {usage
          ? <><span className="font-mono text-foreground">{mb} MB</span> across <span className="font-mono text-foreground">{usage.files}</span> file{usage.files === 1 ? '' : 's'}{activeProject ? ` in “${activeProject.name}”` : ' across all projects'}
          </>
          : 'Measuring disk usage…'}
      </p>
    </Card>
  )
}

function EnvVarsSettings({ projectId }: { projectId: string }) {
  const [vars, setVars] = useState<EnvVar[]>([])
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newSecret, setNewSecret] = useState(true)
  const [showValue, setShowValue] = useState<Record<string, boolean>>({})

  async function load() {
    const res = await fetch(`/api/settings?projectId=${projectId}`)
    const data = await res.json()
    setVars(data.envVars || [])
  }
  // load() awaits fetch before setState — safe async pattern
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [projectId])

  async function addVar() {
    if (!newKey) return toast.error('Key required')
    await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, key: newKey, value: newValue, isSecret: newSecret }),
    })
    setNewKey(''); setNewValue(''); setNewSecret(true)
    toast.success('Variable added')
    load()
  }

  async function removeVar(id: string) {
    await fetch(`/api/settings?id=${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">Environment Variables</h3>
      <p className="text-xs text-muted-foreground">Secrets are encrypted at rest. Their values are never shown in full after saving.</p>
      <Card className="p-3 space-y-2">
        <div className="grid grid-cols-[1fr_2fr_auto_auto] gap-2 items-end">
          <div>
            <Label>Key</Label>
            <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="API_KEY" />
          </div>
          <div>
            <Label>Value</Label>
            <Input type={newSecret ? 'password' : 'text'} value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="sk-..." />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Secret</Label>
            <Switch checked={newSecret} onCheckedChange={setNewSecret} />
          </div>
          <Button size="sm" onClick={addVar}><Plus className="w-3.5 h-3.5 mr-1" />Add</Button>
        </div>
      </Card>
      <div className="space-y-1">
        {vars.map(v => (
          <div key={v.id} className="flex items-center gap-2 p-2 border border-border rounded text-sm">
            <code className="font-mono text-xs flex-1">{v.key}</code>
            <code className="font-mono text-xs text-muted-foreground flex-1 truncate">
              {v.isSecret && !showValue[v.id] ? '••••••••' : v.value}
            </code>
            {v.isSecret && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowValue(s => ({ ...s, [v.id]: !s[v.id] }))}>
                {showValue[v.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </Button>
            )}
            <Badge variant="outline" className="text-[10px]">{v.isSecret ? 'secret' : 'plain'}</Badge>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeVar(v.id)}>
              <Trash2 className="w-3 h-3 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProjectInfo({ projectId }: { projectId: string }) {
  const [info, setInfo] = useState<any>(null)
  useEffect(() => {
    fetch(`/api/projects/${projectId}`).then(r => r.json()).then(setInfo)
  }, [projectId])

  if (!info) return <div>Loading...</div>
  const p = info.project
  const d = info.detection

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">Project Info</h3>
      <Card className="p-3 space-y-2 text-sm">
        <Row label="Name" value={p.name} />
        <Row label="ID" value={p.id} mono />
        <Row label="Framework" value={p.framework || d?.framework || 'unknown'} />
        <Row label="Runtime" value={p.runtime || d?.runtime || 'unknown'} />
        <Row label="Language" value={p.language || d?.language || 'unknown'} />
        <Row label="Status" value={p.status} />
        <Row label="Preview port" value={p.entryPort ? String(p.entryPort) : '—'} />
        <Row label="Created" value={new Date(p.createdAt).toLocaleString()} />
        <Row label="Last opened" value={new Date(p.lastOpenedAt).toLocaleString()} />
      </Card>
      <Card className="p-3">
        <h4 className="text-sm font-medium mb-1">Detection signals</h4>
        <div className="flex flex-wrap gap-1">
          {(d?.signals || []).map((s: string, i: number) => (
            <Badge key={i} variant="outline" className="text-[10px]">{s}</Badge>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}


/** v25 — AI usage (real token/request numbers from the swarm + agent loops). */
function UsageSettings() {
  const [days, setDays] = useState(14)
  const [data, setData] = useState<{
    series: { day: string; requests: number; tokensIn: number; tokensOut: number; errors: number }[]
    providers: { provider: string; requests: number; tokensIn: number; tokensOut: number; errors: number; costUSD?: number }[]
    totals: { requests: number; tokensIn: number; tokensOut: number; errors: number }
    totalCostUSD?: number
    pricingNote?: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  // v60: monthly budget cap + run-finished webhook (real server settings)
  const [budget, setBudget] = useState<string>('')
  const [budgetSaved, setBudgetSaved] = useState<string | null>(null) // null = no cap
  const [budgetBusy, setBudgetBusy] = useState(false)
  const [whUrl, setWhUrl] = useState('')
  const [whSecret, setWhSecret] = useState('')
  const [whHasSecret, setWhHasSecret] = useState(false)
  const [whBusy, setWhBusy] = useState(false)

  async function load(d = days) {
    setLoading(true)
    try {
      const r = await fetch(`/api/usage?days=${d}`, { cache: 'no-store' })
      const j = await r.json()
      if (j.ok) setData(j)
    } catch { /* keep old data */ } finally { setLoading(false) }
  }
  useEffect(() => { load(days) }, [days])

  // v60: load budget + webhook settings once
  useEffect(() => {
    fetch('/api/usage/budget', { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (j.ok) {
        setBudgetSaved(j.enabled ? String(j.budgetUSD) : null)
        setBudget(j.enabled ? String(j.budgetUSD) : '')
      }
    }).catch(() => {})
    fetch('/api/usage/webhook', { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (j.ok) { setWhUrl(j.url || ''); setWhHasSecret(!!j.hasSecret) }
    }).catch(() => {})
  }, [])

  const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
  const fmtUSD = (n: number) => (n > 0 && n < 0.01 ? '<$0.01' : `$${(n || 0).toFixed(2)}`)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-sky-400" /> AI usage — last {days} days</h3>
        <div className="flex items-center gap-1.5">
          <Select value={String(days)} onValueChange={v => setDays(parseInt(v, 10))}>
            <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="14">14 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={() => load()} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Requests', value: fmt(data?.totals.requests || 0) },
          { label: 'Tokens in', value: fmt(data?.totals.tokensIn || 0) },
          { label: 'Tokens out', value: fmt(data?.totals.tokensOut || 0) },
          { label: 'Errors', value: fmt(data?.totals.errors || 0) },
        ].map(s => (
          <Card key={s.label} className="p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
            <div className="text-lg font-bold">{s.value}</div>
          </Card>
        ))}
      </div>

      {/* v55: rough spend estimate — always labeled as an estimate */}
      {data && (data.totalCostUSD || 0) > 0 && (
        <Card className="p-3 border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Estimated spend (rough)</div>
              <div className="text-xl font-bold text-emerald-400">≈ {fmtUSD(data.totalCostUSD || 0)}</div>
            </div>
            <div className="text-[10px] text-muted-foreground max-w-[60%] text-right">{data.pricingNote}</div>
          </div>
        </Card>
      )}

      <Card className="p-3">
        <div className="text-xs font-medium mb-2">Daily tokens (in + out) — real chart</div>
        {/* v62: proper stacked bar chart — v116: lazy-loaded (recharts no longer in the Settings chunk) */}
        {(data?.series || []).length > 0 ? (
          <UsageTokenChart series={data?.series || []} />
        ) : (
          <div className="text-xs text-muted-foreground py-6 text-center">No usage recorded yet — run an app build to see numbers here.</div>
        )}
      </Card>

      <Card className="p-3">
        <div className="text-xs font-medium mb-2">By provider</div>
        {(data?.providers || []).length === 0 && <div className="text-xs text-muted-foreground">No providers used yet.</div>}
        <div className="space-y-1.5">
          {(data?.providers || []).map(p => (
            <div key={p.provider} className="flex items-center justify-between gap-2 text-xs border-b border-border/50 pb-1.5 last:border-0 last:pb-0">
              <span className="font-medium truncate">{p.provider}</span>
              <span className="text-muted-foreground shrink-0">{fmt(p.requests)} req · in {fmt(p.tokensIn)} · out {fmt(p.tokensOut)}{(p.costUSD || 0) > 0 && <span className="text-emerald-400"> · ≈{fmtUSD(p.costUSD || 0)}</span>}{p.errors > 0 && <span className="text-destructive"> · {p.errors} err</span>}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-3 border-sky-500/30 bg-sky-500/5">
        <div className="text-xs font-medium mb-1 flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5 text-sky-400" /> Monthly budget cap</div>
        <p className="text-[11px] text-muted-foreground mb-2">Hard stop for ALL run types (chat, army, scheduled) once this month's rough spend reaches the cap — checked BEFORE any model call, so an exceeded cap costs zero tokens. Empty = no cap; 0 blocks everything.</p>
        <div className="flex items-center gap-2">
          <Input
            className="h-8 w-36 text-xs" placeholder="No cap" inputMode="decimal"
            value={budget} onChange={e => setBudget(e.target.value)}
          />
          <Button size="sm" disabled={budgetBusy} onClick={async () => {
            setBudgetBusy(true)
            try {
              const r = await fetch('/api/usage/budget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: budget.trim() }) })
              const j = await r.json()
              if (j.ok) { setBudgetSaved(j.enabled ? String(j.budgetUSD) : null); toast.success(j.enabled ? `Budget cap set: $${j.budgetUSD}` : 'Budget cap cleared') }
              else toast.error(j.error || 'Save failed')
            } catch { toast.error('Network error') } finally { setBudgetBusy(false) }
          }}>Save</Button>
          {budgetSaved !== null && <span className="text-[11px] text-muted-foreground">Active cap: ${budgetSaved}</span>}
        </div>
      </Card>

      <Card className="p-3 border-violet-500/30 bg-violet-500/5">
        <div className="text-xs font-medium mb-1 flex items-center gap-1.5"><BellRing className="w-3.5 h-3.5 text-violet-400" /> Run alerts webhook</div>
        <p className="text-[11px] text-muted-foreground mb-2">Every finished run (single, army, scheduled) POSTs one JSON summary here — works even when the tab is closed. A <code>X-CA-Signature</code> header (HMAC-SHA256 of the raw body with your secret) proves the call came from this app. No keys or file contents ever leave.</p>
        <div className="space-y-2">
          <Input
            className="h-8 text-xs" placeholder="https://hooks.example.com/my-endpoint"
            value={whUrl} onChange={e => setWhUrl(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Input
              className="h-8 text-xs font-mono" placeholder={whHasSecret ? 'Secret saved — type to replace' : 'Optional signing secret'}
              value={whSecret} onChange={e => setWhSecret(e.target.value)}
            />
            <Button size="sm" disabled={whBusy} onClick={async () => {
              setWhBusy(true)
              try {
                const r = await fetch('/api/usage/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: whUrl.trim(), secret: whSecret.trim() }) })
                const j = await r.json()
                if (j.ok) { setWhHasSecret(!!j.hasSecret); setWhSecret(''); toast.success(j.url ? 'Webhook saved' : 'Webhook cleared') }
                else toast.error(j.error || 'Save failed')
              } catch { toast.error('Network error') } finally { setWhBusy(false) }
            }}>Save</Button>
          </div>
        </div>
      </Card>

      <Button
        size="sm" variant="outline" className="text-destructive hover:text-destructive"
        onClick={async () => {
          try {
            const r = await fetch('/api/usage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset' }) })
            const j = await r.json()
            if (j.ok) { toast.success('Usage history cleared'); load() } else toast.error(j.error || 'Reset failed')
          } catch { toast.error('Network error') }
        }}
      >
        <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear usage history
      </Button>
    </div>
  )
}

// ─── v62: Model benchmarks — the ModelBenchmark table finally has a face ────
interface BenchmarkRow {
  id: string; providerName: string; model: string; task: string
  score: number; latencyMs: number; tokensIn: number; tokensOut: number
  notes?: string | null; createdAt: string
}

function BenchmarksSettings() {
  const [rows, setRows] = useState<BenchmarkRow[] | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/benchmarks', { cache: 'no-store' })
      const j = await r.json()
      setRows(j.benchmarks || [])
    } catch { setRows([]) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const tasks = [...new Set((rows || []).map(r => r.task))]
  const byTask = new Map<string, BenchmarkRow[]>()
  for (const t of tasks) byTask.set(t, (rows || []).filter(r => r.task === t))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-violet-400" /> Model benchmarks</h3>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Refresh'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Scores recorded by the AI's own <code>model_benchmark</code> tool while it compares models on real tasks
        (0–100, higher is better). Same model+task rows are upserted, so this is always the latest result.
      </p>

      {rows === null && <div className="text-xs text-muted-foreground py-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Loading…</div>}
      {rows?.length === 0 && (
        <Card className="p-6 text-center text-xs text-muted-foreground">
          No benchmarks recorded yet. Ask the agent to "benchmark your model on code_generation" and results will appear here.
        </Card>
      )}

      {tasks.map(t => {
        const list = byTask.get(t) || []
        const best = Math.max(1, ...list.map(r => r.score))
        return (
          <Card key={t} className="p-3">
            <div className="text-xs font-semibold mb-2 capitalize">{t.replace(/_/g, ' ')} <span className="text-muted-foreground font-normal">({list.length} result{list.length !== 1 ? 's' : ''})</span></div>
            <div className="space-y-2">
              {list.map(r => (
                <div key={r.id} className="text-xs">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="truncate"><span className="font-medium">{r.providerName}</span> <span className="text-muted-foreground font-mono">· {r.model}</span></span>
                    <span className="shrink-0 font-semibold">{r.score.toFixed(0)}<span className="text-muted-foreground font-normal text-[10px]">/100</span></span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-violet-500/70" style={{ width: `${(r.score / best) * 100}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {r.latencyMs > 0 && `${(r.latencyMs / 1000).toFixed(1)}s`} · in {r.tokensIn} / out {r.tokensOut}{r.notes ? ` · ${r.notes}` : ''}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )
      })}
    </div>
  )
}


/** BUSINESS v2 — plan & billing: current plan, live usage vs limits, all plans.
 *  v110 — self-serve Razorpay checkout, expiry display and payment history. */
function PlanSettings() {
  const [data, setData] = useState<any>(null)
  const [bill, setBill] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const [busyPlan, setBusyPlan] = useState('')

  const load = () => {
    setBusy(true)
    fetch('/api/auth/plan', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setBusy(false))
    fetch('/api/billing/me', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setBill(d))
      .catch(() => {})
  }
  useEffect(load, [])

  async function upgrade(planId: string, name: string, amount: number) {
    setBusyPlan(planId)
    try {
      const r = await startCheckout({ plan: planId, planName: name, kind: 'monthly', amountINR: amount })
      if (r.ok) {
        toast.success(`${name} activated. Happy building!`, { duration: 6000 })
        load()
      } else if (r.error) toast.error(r.error, { duration: 7000 })
    } finally {
      setBusyPlan('')
    }
  }

  const plan = data?.plan
  const usage = data?.usage
  const plans = data?.plans || []
  const pct = (used: number, max: number) => (max < 0 ? 0 : Math.min(100, Math.round((used / Math.max(1, max)) * 100)))
  const fmtDate = (iso: any) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
  const kindLabel = (k: string) => (k === 'admin' ? 'Operator' : k === 'monthly' ? 'Monthly' : 'Free tier') // v111: lifetime retired

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" /> Plan & Billing</h3>
      {!data && busy && <p className="text-sm text-muted-foreground">Loading plan…</p>}
      {plan && usage && (
        <Card className="p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">
              {plan.name} {plan.priceINR > 0 && <span className="text-muted-foreground font-normal">— {formatINR(plan.priceINR)}/month</span>}
              {bill?.planKind && <Badge variant="secondary" className="ml-2 text-[10px]">{kindLabel(bill.planKind)}</Badge>}
            </div>
            <a href="/pricing" target="_blank" className="text-xs underline text-muted-foreground hover:text-foreground">See all plans</a>
          </div>
          {bill?.planKind === 'monthly' && bill?.planExpiresAt && (
            <div className={`text-xs ${bill.expired ? 'text-destructive' : 'text-muted-foreground'}`}>
              {bill.expired ? `Expired on ${fmtDate(bill.planExpiresAt)} — renew below to restore your limits.` : `Current period ends ${fmtDate(bill.planExpiresAt)} — renewing extends from this date.`}
            </div>
          )}
          {[
            { label: 'Projects', used: usage.projects, max: plan.maxProjects },
            { label: 'AI runs (this month)', used: usage.runs, max: plan.maxRunsPerMonth },
            { label: 'Tokens (this month)', used: usage.tokens, max: plan.maxTokensPerMonth },
          ].map(row => (
            <div key={row.label} className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{row.label}</span>
                <span>{row.used.toLocaleString()}{row.max >= 0 ? ` / ${row.max.toLocaleString()}` : ' (unlimited)'}</span>
              </div>
              {row.max >= 0 && (
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${pct(row.used, row.max) > 90 ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${pct(row.used, row.max)}%` }} />
                </div>
              )}
            </div>
          ))}
        </Card>
      )}
      {plans.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {plans.map((pl: any) => (
            <div key={pl.id} className={`rounded-lg border p-3 text-xs ${plan?.id === pl.id ? 'border-primary ring-1 ring-primary/40' : ''}`}>
              <div className="font-medium text-sm flex items-center justify-between">
                {pl.name}
                {pl.priceINR > 0 && (
                  <button
                    className="text-[11px] rounded-md border px-2 py-1 hover:bg-muted transition disabled:opacity-50"
                    disabled={busyPlan === pl.id + 'monthly'}
                    onClick={() => upgrade(pl.id, pl.name, pl.priceINR)}
                  >
                    {busyPlan === pl.id + 'monthly' ? '…' : plan?.id === pl.id ? 'Renew' : 'Pay & activate'}
                  </button>
                )}
              </div>
              <div className="text-muted-foreground mt-0.5">{pl.priceINR === 0 ? 'Free' : `${formatINR(pl.priceINR)}/mo`}</div>
              <div className="text-muted-foreground mt-1">{pl.maxProjects < 0 ? 'Unlimited' : pl.maxProjects} projects · {pl.maxRunsPerMonth.toLocaleString()} runs/mo</div>
            </div>
          ))}
        </div>
      )}
      {bill?.payments?.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payment history</h4>
          <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
            {bill.payments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
                <div className="min-w-0">
                  <span className="font-medium">{getPlan(p.plan).name}</span>
                  <span className="text-muted-foreground"> · {p.kind === 'lifetime' ? 'one-time' : 'monthly'} · {fmtDate(p.createdAt)}</span>
                  {p.method && <span className="text-muted-foreground"> · {p.method}</span>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span>{formatINR(p.amount / 100)}</span>
                  <Badge variant={p.status === 'paid' ? 'default' : p.status === 'refunded' ? 'secondary' : 'destructive'} className="text-[10px]">{p.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Payments run through Razorpay (UPI · cards · netbanking) and plans activate automatically after signature
        verification. Facing an issue? Use the Contact page — the owner responds personally.
      </p>
    </div>
  )
}
