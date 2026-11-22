/**
 * v110 — Refund & Cancellation Policy (Razorpay India onboarding requires
 * this page). Matches what the billing system actually does: instant
 * activation, 30-day cycles, expiry instead of auto-charge, refund windows.
 */
import { SITE } from '@/lib/site'
import { PublicShell, PublicNav, PublicFooter } from '@/components/cloud-agent/public-shell'

export const metadata = { title: `Refund & Cancellation — ${SITE.name}` }

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: 'Cancelling a monthly plan',
    p: [
      'You can stop using a paid plan at any time — simply let the current 30-day period end without renewing, or ask us to cancel by writing to ' + SITE.supportEmail + '. Because we never store your card or UPI mandate, there is nothing to "turn off": when the period ends your account simply moves to the free tier. Your projects and code remain intact and exportable.',
    ],
  },
  {
    h: 'Refund window — monthly plans',
    p: [
      'If a monthly payment failed to unlock what it promised (for example the plan did not activate, or a platform defect made the builder unusable), tell us within 7 days of the payment and we will issue a full refund to the original payment method — usually via the Razorpay refund rail within 5–7 working days.',
      'Renewal payments made by accident within the last 48 hours are also refunded in full, provided the plan was not meaningfully used in that window (as a guide: fewer than 5 AI runs since the payment).',
    ],
  },
  {
    h: 'Lifetime plan',
    p: [
      `The Lifetime plan (${SITE.name} Ultra Pro Max, one-time) carries a 30-day, no-questions-asked refund window from the date of purchase. After 30 days it is non-refundable, because the tier it unlocks is consumed continuously.`,
    ],
  },
  {
    h: 'What is not refundable',
    p: [
      'Usage already consumed on a working plan (AI runs, tokens, build minutes) cannot be refunded pro-rata; refunds under the windows above are full refunds of the failed or accidental payment.',
      'Payments where chargeback-style disputes were opened at the bank before contacting support are handled through the dispute process instead.',
    ],
  },
  {
    h: 'How to request',
    p: [
      `Email ${SITE.supportEmail} from your registered address with the payment reference (Razorpay payment ID or UTR) and one line about what went wrong. We confirm every eligible refund within ${SITE.responseTime} and process it to the original payment method — no restocking fees, no retention calls.`,
    ],
  },
]

export default function RefundPage() {
  return (
    <PublicShell>
      <PublicNav />
      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-5 py-12">
          <h1 className="text-3xl font-bold tracking-tight">Refund & Cancellation Policy</h1>
          <p className="text-sm text-muted-foreground mt-2">Last updated: {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <div className="mt-8 space-y-8">
            {SECTIONS.map((s) => (
              <section key={s.h}>
                <h2 className="font-semibold text-lg">{s.h}</h2>
                {s.p.map((para, i) => (
                  <p key={i} className="mt-2.5 text-sm text-muted-foreground leading-relaxed">{para}</p>
                ))}
              </section>
            ))}
          </div>
        </div>
      </main>
      <PublicFooter />
    </PublicShell>
  )
}
