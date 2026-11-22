/**
 * v110 — Terms of Service (Razorpay India onboarding requires this page).
 * Plain-language, India-governed, and consistent with the plan enforcement
 * that actually ships (30-day monthly cycles, cancellation at period end).
 */
import { SITE } from '@/lib/site'
import { PublicShell, PublicNav, PublicFooter } from '@/components/cloud-agent/public-shell'

export const metadata = { title: `Terms of Service — ${SITE.name}` }

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: '1. The service',
    p: [
      `${SITE.name} is a software-as-a-service platform that builds, previews, tests and deploys applications using AI agents. You describe work in natural language; the platform's agents create and modify projects inside your account.`,
      'The service is provided by ' + SITE.companyLine + ' and operated from ' + SITE.country + '. By creating an account you agree to these terms.',
    ],
  },
  {
    h: '2. Accounts',
    p: [
      'You must provide a valid email address and a strong password, and you are responsible for keeping your credentials safe. Every project in the platform belongs to the account that created it; you are responsible for all activity performed through your account and sessions.',
      'Accounts engaged in abuse — attempting to attack the platform or other tenants, mining cryptocurrency, hosting illegal content, or circumventing plan limits — may be suspended without refund where required to protect the service.',
    ],
  },
  {
    h: '3. Plans, billing and renewal',
    p: [
      'Plans are described on the Pricing page. Paid plans are billed in Indian Rupees through Razorpay (UPI, cards, netbanking) on a 30-day cycle, and a plan activates immediately after a successful, signature-verified payment.',
      'A monthly plan runs until its expiry date and ends there unless you pay again — we do not store your payment instrument and cannot force a silent charge. The Lifetime plan is a one-time purchase that grants the stated tier for as long as the service operates.',
      'Plan limits (projects, monthly runs, tokens, swarm size) are enforced automatically. If you need more capacity, upgrade at any time — the new tier applies instantly.',
    ],
  },
  {
    h: '4. Your content',
    p: [
      'You own the code and content your accounts and agents produce. We store it to operate the service (previews, builds, backups) and do not sell or share it. You may export or delete your projects at any time from the platform.',
      'You must not use the service to build or distribute content that violates applicable law in ' + SITE.country + ', including intellectual-property-infringing or malicious software.',
    ],
  },
  {
    h: '5. AI output and availability',
    p: [
      'AI-generated code is produced by models and may contain errors; you are responsible for reviewing anything you ship to real users. We depend on third-party AI providers and payment rails and do not guarantee uninterrupted availability, though outages are compensated with plan-time extensions on request.',
      'The service is provided "as is" to the maximum extent permitted by law. Our aggregate liability for any claim is limited to the amount you paid us in the 3 months before the claim.',
    ],
  },
  {
    h: '6. Cancellation and termination',
    p: [
      'You may cancel a paid plan at any time; the plan stays active until the end of the paid period and then drops to the free tier. See the Refund & Cancellation page for the refund windows.',
      'We may terminate these terms for material breach after notice where practicable. On termination your data remains exportable for 30 days before deletion.',
    ],
  },
  {
    h: '7. Governing law',
    p: [
      `These terms are governed by the laws of ${SITE.country}, and the courts at the operator's principal place of business have exclusive jurisdiction. Questions about these terms go to ${SITE.supportEmail} — we answer within ${SITE.responseTime}.`,
    ],
  },
]

export default function TermsPage() {
  return (
    <PublicShell>
      <PublicNav />
      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-5 py-12">
          <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
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
