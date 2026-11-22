'use client'

/**
 * v110 — public pricing page with REAL Razorpay self-serve checkout.
 * Signed out → buttons route to /register (plan remembered in the URL).
 * Signed in → the button opens the Razorpay modal (UPI / cards / netbanking)
 * and the plan activates the moment the payment signature verifies.
 * v111 — Lifetime offer REMOVED: monthly subscriptions only.
 */
import { useEffect, useState } from 'react'
import { PLANS, PAID_PLAN_ORDER, formatINR, PlanId } from '@/lib/plans'
import { bigBillionDayState } from '@/lib/bbd'
import { Check, ArrowLeft, Zap, ShieldCheck, PartyPopper } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { startCheckout, CheckoutKind } from '@/lib/checkout'
import { PublicShell, PublicNav, PublicFooter } from '@/components/cloud-agent/public-shell'

type Me = { ok: boolean; user?: { name: string; email: string } }

export default function PricingPage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [busyPlan, setBusyPlan] = useState('')
  const [keysMissing, setKeysMissing] = useState(false)

  useEffect(() => {
    // v161 anti-false-logout: one hiccup on /api/auth/me must NEVER make a
    // signed-in user look signed out (clicking Pay then bounced them to
    // /register — reported as "payment korte logout hoy"). Retry once, and
    // re-verify at click time before any redirect.
    let dead = false
    const load = () => fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { ok: false }))
      .then((d) => { if (!dead) setMe(d) })
      .catch(() => { if (!dead) setMe({ ok: false }) })
    load()
    const t = setTimeout(() => { if (!dead) load() }, 1200)
    return () => { dead = true; clearTimeout(t) }
  }, [])

  const signedIn = Boolean(me?.ok)
  // v117 — the OWNER reported "plan system kaj kore na": with Razorpay keys
  // not yet connected, checkout honestly refuses — but nobody told the owner
  // WHERE to connect them. Admin-role viewers now see the exact fix path.
  const isOwner = (me as any)?.user?.role === 'admin'

  async function pay(plan: string, planName: string, kind: CheckoutKind, amountINR: number) {
    if (!signedIn) {
      // v161 — re-verify ONCE before redirecting: the initial me fetch may
      // have failed transiently (proxy wake-up, slow tunnel). Bouncing a
      // logged-in user to /register felt like "payment logs me out".
      try {
        const re = await fetch('/api/auth/me', { cache: 'no-store' })
        const d = re.ok ? await re.json() : { ok: false }
        if (d?.ok) {
          setMe(d)
        } else {
          toast.error('Please log in first — your payment continues right after.', { duration: 5000 })
          router.push(`/register?plan=${plan}&kind=${kind}`)
          return
        }
      } catch {
        toast.error('Network hiccup while checking your session — try again.', { duration: 5000 })
        return
      }
    }
    setBusyPlan(plan + kind)
    try {
      const result = await startCheckout({
        plan,
        planName,
        kind,
        amountINR,
        prefill: { name: me?.user?.name, email: me?.user?.email },
        onKeysMissing: () => setKeysMissing(true),
      })
      if (result.ok) {
        toast.success(`${planName} activated. Happy building!`, { duration: 6000 })
        setTimeout(() => router.push('/'), 1500)
      } else if (result.error) {
        toast.error(result.error, { duration: 7000 })
      }
    } finally {
      setBusyPlan('')
    }
  }

  const plans: PlanId[] = PAID_PLAN_ORDER
  const bbd = bigBillionDayState()

  return (
    <PublicShell>
      <PublicNav />
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-5 py-12">
          <a href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
            <ArrowLeft className="w-4 h-4" /> Back to home
          </a>

          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground mb-4">
              <ShieldCheck className="w-3.5 h-3.5 text-primary" /> Secure payments by Razorpay · UPI, cards, netbanking
            </div>
            <h1 className="text-3xl lg:text-5xl font-bold tracking-tight">
              Pick your <span className="bg-gradient-to-r from-primary to-emerald-400 bg-clip-text text-transparent">power level</span>
            </h1>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto text-sm lg:text-base">
              Every plan includes the full builder: AI agents, swarm, terminal, deploy, GitHub and backups.
              Bigger plans unlock more projects, more runs, bigger armies.
            </p>
          </div>

          {/* ── v115 BIG BILLION DAY — the only free access, 4h on the 1st ── */}
          <div className={`mb-8 rounded-2xl border p-6 ${bbd.active ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-border bg-muted/30'}`}>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                <PartyPopper className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1">
                <div className="font-semibold">Big Billion Day — 4 free hours, every month</div>
                <p className="text-sm text-muted-foreground mt-1">
                  {bbd.active
                    ? 'IT IS LIVE RIGHT NOW — free building until 12:00 IST today. Create an account and go.'
                    : 'On the 1st of every month, 8:00 AM – 12:00 PM IST, the whole builder opens free for everyone — Pro-level power, no card, no trial. Next window opens ' + (bbd.nextAt ? new Date(bbd.nextAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : 'soon') + ' IST.'}
                </p>
              </div>
              <a
                href={signedIn ? '/' : '/register'}
                className="shrink-0 inline-flex justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition border bg-background hover:bg-muted"
              >
                {bbd.active ? 'Claim free hours' : 'Remind me — create account'}
              </a>
            </div>
          </div>

          {/* ── paid grid (v115: no standing free tier — Big Billion Day above) ── */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((id) => {
              const p = PLANS[id]
              const highlight = p.highlight
              return (
                <div
                  key={p.id}
                  className={`relative rounded-2xl border p-6 flex flex-col ${highlight ? 'border-primary shadow-lg shadow-primary/10 ring-1 ring-primary/40' : 'border-border'}`}
                >
                  {highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-[11px] font-medium text-primary-foreground">
                      Most popular
                    </div>
                  )}
                  <div className="text-sm font-medium text-muted-foreground">{p.name}</div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-bold tracking-tight">{p.priceINR === 0 ? '₹0' : formatINR(p.priceINR)}</span>
                    <span className="text-xs text-muted-foreground">/month</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{p.tagline}</div>
                  <ul className="mt-5 space-y-2.5 flex-1">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" /> {f}
                      </li>
                    ))}
                  </ul>
                  {p.priceINR === 0 ? (
                    <a
                      href={signedIn ? '/' : '/register'}
                      className="mt-6 inline-flex justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition border bg-background hover:bg-muted"
                    >
                      Start free
                    </a>
                  ) : (
                    <button
                      onClick={() => pay(p.id, p.name, 'monthly', p.priceINR)}
                      disabled={busyPlan === p.id + 'monthly'}
                      className="mt-6 inline-flex w-full justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    >
                      {busyPlan === p.id + 'monthly' ? 'Opening Razorpay…' : `Pay ₹${p.priceINR} with Razorpay — ${p.name}`}
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-10 rounded-2xl border bg-muted/30 p-5 text-sm text-muted-foreground">
            {keysMissing ? (
              isOwner ? (
                <span>
                  <span className="font-medium text-foreground">Razorpay keys are not connected yet — that is why checkout cannot open.</span>{' '}
                  Fix it in 30 seconds: open the <span className="font-medium text-foreground">Admin Control Room (shield button → password)</span>{' '}
                  → <span className="font-medium text-foreground">Razorpay tab</span> → paste your Key ID and Key Secret from the{' '}
                  <a href="https://dashboard.razorpay.com/app/keys" target="_blank" rel="noopener noreferrer" className="underline">Razorpay Dashboard</a>{' '}
                  → press <span className="font-medium text-foreground">Get</span>. The connection is live-validated and checkout starts working instantly.
                </span>
              ) : (
                <span>
                  <span className="font-medium text-foreground">Online payments are being configured.</span> We&apos;re wiring up
                  Razorpay right now — meanwhile, reach us at <span className="font-medium text-foreground">support</span> (see the
                  Contact page) and we&apos;ll activate your plan manually.
                </span>
              )
            ) : (
              <span>
                <span className="font-medium text-foreground">How payment works:</span> pick a plan → the secure Razorpay window
                opens → pay with <span className="font-medium text-foreground">UPI (PhonePe / GPay / Paytm), card or netbanking</span> → your
                plan activates instantly and automatically. Monthly plans renew every 30 days — cancel anytime (see Refund policy).
              </span>
            )}
          </div>
        </div>
      </main>
      <PublicFooter />
    </PublicShell>
  )
}
