/**
 * v110 — Contact page (Razorpay India onboarding requires a reachable
 * support/contact surface). Reads the single source of truth in lib/site.ts.
 */
import { SITE } from '@/lib/site'
import { PublicShell, PublicNav, PublicFooter } from '@/components/cloud-agent/public-shell'
import { Mail, MessageSquare, Clock, MapPin } from 'lucide-react'

export const metadata = { title: `Contact Us — ${SITE.name}` }

export default function ContactPage() {
  const rows = [
    { icon: Mail, label: 'Support (billing, plans, refunds)', value: SITE.supportEmail },
    { icon: MessageSquare, label: 'Sales & self-hosted licenses', value: SITE.salesEmail },
    { icon: Clock, label: 'Response time', value: `We reply within ${SITE.responseTime}, every day of the week.` },
    { icon: MapPin, label: 'Operated from', value: `${SITE.companyLine} · ${SITE.country}` },
  ]
  return (
    <PublicShell>
      <PublicNav />
      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-5 py-12">
          <h1 className="text-3xl font-bold tracking-tight">Contact Us</h1>
          <p className="text-sm text-muted-foreground mt-2 max-w-xl">
            Real humans answer these inboxes — the same team that builds {SITE.name}. For anything about a
            payment, include your registered email and the Razorpay payment ID (or UTR) so we can find it instantly.
          </p>
          <div className="mt-8 grid sm:grid-cols-2 gap-4">
            {rows.map((r) => (
              <div key={r.label} className="rounded-2xl border bg-card p-5">
                <r.icon className="w-5 h-5 text-primary" />
                <div className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">{r.label}</div>
                <div className="mt-1 text-sm font-medium break-all">{r.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-2xl border bg-muted/30 p-5 text-sm text-muted-foreground">
            Payment failed but money left your account? Razorpay sometimes shows a &quot;pending&quot; status for a few minutes
            while the bank confirms — the plan activates automatically the moment it settles. If it is still pending after
            30 minutes, email us the UTR and we will either activate the plan or confirm the instant bank reversal.
          </div>
        </div>
      </main>
      <PublicFooter />
    </PublicShell>
  )
}
