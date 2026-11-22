'use client'

/**
 * BUSINESS v2 — account chip for the headers: avatar, plan badge, and the
 * account dropdown (plan & usage, pricing, sign out). Fetches /api/auth/me.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LogOut, CreditCard, Sparkles, Loader2, Gift, Globe, Code2 } from 'lucide-react'
import { clearLockToken } from '@/lib/lock-client'
import { getPlan, formatINR } from '@/lib/plans'
import { useAppStore } from '@/lib/store'
import { getLang, setLang, translate } from '@/lib/i18n'

type Me = { user: { name: string; email: string; role: string; plan: string; planKind?: string; planExpiresAt?: string | null }; plan: { name: string; priceINR: number }; usage: { projects: number; runs: number; tokens: number } }

export function UserMenu() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [busy, setBusy] = useState(false)
  // v151 — ecosystem language chip (English default / বাংলা / हिन्दी)
  const [lang, setLangState] = useState(() => getLang())

  const load = () => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setMe(d))
      .catch(() => setMe(null))
  }
  useEffect(load, [])

  function cycleLang() {
    const order = ['en', 'bn', 'hi'] as const
    const next = order[(order.indexOf(lang as 'en' | 'bn' | 'hi') + 1) % order.length]
    setLang(next)
    setLangState(next)
  }

  async function signOut() {
    setBusy(true)
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {}
    clearLockToken()
    window.location.href = '/login'
  }

  const name = me?.user?.name || '…'
  const plan = me ? getPlan(me.user.plan) : null
  // v119 — opening the Settings dialog from this menu loses a Radix focus-war
  // (menu unmount restores focus to the trigger AFTER the dialog mounts; the
  // dialog sees an "outside focus" and closes instantly). Suppress the
  // focus restore for exactly the click that opens a dialog.
  const suppressFocusRef = useRef(false)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="inline-flex items-center gap-2 rounded-full border bg-background pl-1 pr-2.5 py-1 hover:bg-muted transition" title="Account">
          <Avatar className="w-7 h-7">
            <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
              {name === '…' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : name.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="hidden md:inline text-xs font-medium max-w-[120px] truncate">{name}</span>
          {plan && (
            <Badge variant={plan.priceINR > 0 ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0 h-4.5 hidden sm:inline-flex">
              {plan.name}
            </Badge>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64"
        onCloseAutoFocus={(e) => { if (suppressFocusRef.current) { suppressFocusRef.current = false; e.preventDefault() } }}
      >
        <DropdownMenuLabel>
          <div className="text-sm font-medium truncate">{name}</div>
          <div className="text-xs text-muted-foreground font-normal truncate">{me?.user?.email || ''}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {me && plan && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground space-y-1">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground"><Sparkles className="w-3.5 h-3.5 text-primary" /> {plan.name} plan</span>
              <span>{plan.priceINR === 0 ? 'Free' : `${formatINR(plan.priceINR)}/mo`}</span>
            </div>
            {me.user.planKind === 'monthly' && me.user.planExpiresAt && (
              <div className="flex justify-between">
                <span>Renews / ends</span>
                <span className={new Date(me.user.planExpiresAt).getTime() < Date.now() ? 'text-destructive' : 'text-foreground'}>
                  {new Date(me.user.planExpiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            )}
            <div className="flex justify-between"><span>Projects</span><span className="text-foreground">{me.usage.projects}{plan.maxProjects > 0 ? ` / ${plan.maxProjects}` : ''}</span></div>
            <div className="flex justify-between"><span>Runs (this month)</span><span className="text-foreground">{me.usage.runs.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>Tokens (this month)</span><span className="text-foreground">{(me.usage.tokens / 1000).toFixed(0)}K</span></div>
          </div>
        )}
        <DropdownMenuSeparator />
        {/* v152.2 — owner entry point: the ecosystem Code Hub (admin only) */}
        {me?.user?.role === 'admin' && (
          <DropdownMenuItem onClick={() => { window.location.href = '/admin?tab=code' }}>
            <Code2 className="w-4 h-4 mr-2 text-violet-500" /> Code Hub — ecosystem code & deploy
          </DropdownMenuItem>
        )}
        {/* v151 — one-tap language cycle: English → বাংলা → हिन्दी */}
        <DropdownMenuItem onClick={cycleLang}>
          <Globe className="w-4 h-4 mr-2 text-sky-500" /> {translate('common.language', lang)}: {lang === 'en' ? 'English' : lang === 'bn' ? 'বাংলা' : 'हिन्दी'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { suppressFocusRef.current = true; const s = useAppStore.getState(); s.setSettingsTabRequest('refer'); s.setSettingsOpen(true) }}>
          <Gift className="w-4 h-4 mr-2 text-emerald-500" /> Refer & earn — 7 days free
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => { window.open('/pricing', '_blank') }}>
          <CreditCard className="w-4 h-4 mr-2" /> Plans & pricing
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onClick={signOut} className="text-destructive focus:text-destructive">
          <LogOut className="w-4 h-4 mr-2" /> {busy ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
