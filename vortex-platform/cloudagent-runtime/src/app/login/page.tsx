'use client'

/**
 * BUSINESS v2 — the front door. Replaces the old single-owner PIN lock.
 * Sign in / Create account on one screen. On success the session token is
 * stored for the embedded-header channel (LockTokenBridge) and the cookie is
 * set server-side; the builder loads at `next` (or /).
 */
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AdminSecretEntry } from '@/components/cloud-agent/AdminSecretEntry'
import { Loader2, Sparkles, Zap, ShieldCheck, Rocket, Eye, EyeOff, Check, Gift } from 'lucide-react'

const HIGHLIGHTS = [
  { icon: Sparkles, text: 'AI agent builds real, working apps from one prompt' },
  { icon: Zap, text: '1000-agent swarm — your whole team at once' },
  { icon: ShieldCheck, text: 'Your projects, your keys — never shared' },
  { icon: Rocket, text: 'Terminal, deploy, GitHub, custom domains built in' },
]

function LoginInner() {
  const router = useRouter()
  const params = useSearchParams()
  // SECURITY: `next` must be a same-origin internal path. Anything else
  // (absolute https://, protocol-relative //host, backslashes) falls back to
  // / so a crafted ?next= link can never bounce users off-site.
  const nextParam = params.get('next') || '/'
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.includes('\\') ? nextParam : '/'

  const [mode, setMode] = useState<'signin' | 'signup'>(params.get('mode') === 'signup' ? 'signup' : 'signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState<boolean | null>(null) // any account exists?
  // v119 REFER & EARN — an invite link pays BOTH sides 7 days of Pro.
  const [inviter, setInviter] = useState<string | null>(null)
  const refParam = (params.get('ref') || '').trim()

  // Accept ?ref=CODE from the link, and remember it locally for 7 days so a
  // friend who browses around before signing up never loses their reward.
  useEffect(() => {
    let code = refParam
    try {
      if (code) {
        localStorage.setItem('ca_ref', JSON.stringify({ code: code.toUpperCase(), at: Date.now() }))
      } else {
        const raw = localStorage.getItem('ca_ref')
        const saved = raw ? JSON.parse(raw) : null
        if (saved?.code && Date.now() - (saved.at || 0) < 7 * 24 * 3600 * 1000) code = saved.code
        else if (raw) localStorage.removeItem('ca_ref')
      }
    } catch {}
    if (!code) return
    setInviter('loading')
    fetch(`/api/referral/lookup?ref=${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? r.json() : null))
      .then((d) => setInviter(d?.ok ? d.referrerName : null))
      .catch(() => setInviter(null))
  }, [refParam])

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (r) => {
        // Already signed in → go where the user was headed. Honoring `next`
        // (same-origin-guarded above) is what breaks the bounce loop for
        // browsers that drop cookies: the in-app RSC navigation carries the
        // x-ca-lock header, so /admin loads even without the session cookie.
        if (r.ok) { router.replace(next === '/login' ? '/' : next) ; return }
        // public probe: does any account exist? (register is always open)
        setConfigured(true)
      })
      .catch(() => setConfigured(true))
  }, [router, next])

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setError('')
    if (!email.trim() || !password) { setError('Email and password are required.') ; return }
    if (mode === 'signup') {
      if (password.length < 6) { setError('Password must be at least 6 characters.') ; return }
      if (password !== confirm) { setError('Passwords do not match.') ; return }
    }
    setBusy(true)
    try {
      // v119: attach the remembered referral code (param wins over storage)
      let refCode = refParam
      if (!refCode) {
        try {
          const raw = localStorage.getItem('ca_ref')
          const saved = raw ? JSON.parse(raw) : null
          if (saved?.code && Date.now() - (saved.at || 0) < 7 * 24 * 3600 * 1000) refCode = saved.code
        } catch {}
      }
      const res = await fetch(mode === 'signin' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'signin' ? { email, password } : { name, email, password, ref: refCode || undefined }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok && d.token) {
        try {
          localStorage.setItem('ca_lock_token', d.token)
          if (mode === 'signup') localStorage.removeItem('ca_ref') // consumed — no replay
        } catch {}
        // v110: a signup started from the pricing page continues to checkout
        const plan = params.get('plan')
        const kind = params.get('kind') || 'monthly'
        const dest = plan ? `/pricing?plan=${encodeURIComponent(plan)}&kind=${encodeURIComponent(kind)}` : next
        // small delay so the cookie lands before the RSC fetch of /
        setTimeout(() => router.replace(dest), 50)
        return
      }
      setError(d.error || `Could not ${mode === 'signin' ? 'sign in' : 'create the account'} (${res.status}).`)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-background text-foreground">
      {/* Brand panel */}
      <div className="relative lg:w-[55%] flex flex-col justify-between overflow-hidden p-8 lg:p-14 bg-gradient-to-br from-primary/15 via-background to-background">
        <div className="absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full bg-primary/20 blur-[120px] pointer-events-none" />
        <div className="absolute -bottom-52 -right-24 w-[480px] h-[480px] rounded-full bg-emerald-500/10 blur-[120px] pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
              <Sparkles className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <div id="ca-login-brand" className="text-lg font-bold tracking-tight cursor-default select-none">Vortex CloudAgent</div>
              <div className="text-[11px] text-muted-foreground -mt-0.5">AI App Builder — Business</div>
            </div>
          </div>
        </div>
        <div className="relative max-w-lg py-10">
          <h1 className="text-3xl lg:text-4xl font-bold tracking-tight leading-tight">
            Describe your app.<br />
            <span className="bg-gradient-to-r from-primary to-emerald-400 bg-clip-text text-transparent">Your AI army builds it.</span>
          </h1>
          <p className="text-muted-foreground mt-4 text-sm lg:text-base">
            One workspace for building, running and shipping software with autonomous AI agents — from a single landing page to a full production platform.
          </p>
          <ul className="mt-8 space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <span className="text-sm text-foreground/90 pt-1.5">{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative text-xs text-muted-foreground">© 2026 Vortex CloudAgent — all plans billed monthly</div>
      </div>

      {/* Form panel */}
      <div className="lg:w-[45%] flex items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-sm">
          <div className="flex rounded-lg border p-1 mb-6 bg-muted/40">
            <button
              className={`flex-1 text-sm rounded-md py-2 transition ${mode === 'signin' ? 'bg-background shadow font-medium' : 'text-muted-foreground'}`}
              onClick={() => { setMode('signin'); setError('') }}
              type="button"
            >Sign in</button>
            <button
              className={`flex-1 text-sm rounded-md py-2 transition ${mode === 'signup' ? 'bg-background shadow font-medium' : 'text-muted-foreground'}`}
              onClick={() => { setMode('signup'); setError('') }}
              type="button"
            >Create account</button>
          </div>

          {/* v119 REFER & EARN — invite banner (param or remembered link) */}
          {inviter && (
            <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 mb-4">
              <Gift className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              <div className="text-sm">
                <span className="font-medium">{inviter === 'loading' ? 'A friend' : inviter} invited you to Vortex CloudAgent</span>
                <div className="text-xs text-muted-foreground mt-0.5">
                  You both get <span className="text-emerald-600 dark:text-emerald-400 font-medium">7 days of Pro free</span> — applied automatically when you create your account.
                </div>
                {mode === 'signin' && (
                  <button className="text-xs underline mt-1 hover:text-foreground" onClick={() => { setMode('signup'); setError('') }} type="button">Switch to Create account to claim it →</button>
                )}
              </div>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="mt-1.5" autoComplete="name" />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="mt-1.5" autoComplete="email" />
            </div>
            <div className="relative">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'min 6 characters' : 'Your password'} className="mt-1.5 pr-9" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
              <button className="absolute right-2 top-[30px] text-muted-foreground" onClick={() => setShow(s => !s)} type="button" tabIndex={-1}>
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {mode === 'signup' && (
              <div>
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" type={show ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1.5" autoComplete="new-password" />
              </div>
            )}

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">{error}</div>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {mode === 'signin' ? 'Sign in to Vortex CloudAgent' : 'Create my account'}
            </Button>
          </form>

          {mode === 'signin' && configured === true && (
            <p className="text-xs text-muted-foreground text-center mt-4">
              New here? Switch to <button className="underline hover:text-foreground" onClick={() => { setMode('signup'); setError('') }} type="button">Create account</button> — free on Big Billion Day.
            </p>
          )}
          {mode === 'signup' && (
            <ul className="mt-5 space-y-1.5">
              {['Big Billion Day: 4 free hours on the 1st of every month (8 AM–12 PM IST)', 'Plans from ₹1,999/month — cancel anytime', 'Keep every project you build'].map((t) => (
                <li key={t} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Check className="w-3.5 h-3.5 text-emerald-500" /> {t}
                </li>
              ))}
            </ul>
          )}
          <a href="/pricing" className="block text-center text-xs text-muted-foreground hover:text-foreground mt-6 underline underline-offset-4">
            See plans & pricing →
          </a>
          <nav className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <a href="/terms" className="hover:text-foreground transition">Terms</a>
            <a href="/privacy" className="hover:text-foreground transition">Privacy</a>
            <a href="/refund" className="hover:text-foreground transition">Refund & Cancellation</a>
            <a href="/contact" className="hover:text-foreground transition">Contact</a>
          </nav>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <AdminSecretEntry targetId="ca-login-brand" />
      <LoginInner />
    </Suspense>
  )
}
