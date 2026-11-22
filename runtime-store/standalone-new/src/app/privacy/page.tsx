/**
 * v110 — Privacy Policy (Razorpay India onboarding requires this page).
 * Honest about what the platform stores, where payments touch Razorpay, and
 * that AI providers receive prompts under the operator's configured keys.
 */
import { SITE } from '@/lib/site'
import { PublicShell, PublicNav, PublicFooter } from '@/components/cloud-agent/public-shell'

export const metadata = { title: `Privacy Policy — ${SITE.name}` }

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: 'What we collect',
    p: [
      'Account data: your name, email address and a salted, hashed password (we never store passwords in readable form).',
      'Usage data: project names and files you or your agents create, AI run logs (prompts, model, token counts), and basic request logs needed to operate and secure the service.',
      'Payment data: we never receive or store your card number, UPI PIN or bank credentials. Payments are processed by Razorpay (a PCI-DSS compliant Indian payment gateway); we receive only the payment reference, amount and status needed to activate your plan and keep billing history.',
    ],
  },
  {
    h: 'How data flows',
    p: [
      'To generate code, the prompts and relevant project context you send are transmitted to the AI provider configured for your workspace (for example OpenAI, Google, Anthropic or Groq) under the operator\u2019s or your own API keys. Provider keys are encrypted at rest.',
      'Razorpay receives the payment amount and checkout identifiers. GitHub receives only what you explicitly push, under a token you add, encrypted at rest.',
      'We do not sell personal data, and we do not run third-party advertising trackers on the app.',
    ],
  },
  {
    h: 'Security',
    p: [
      'Sessions are signed and revocable; projects are isolated per account and every cross-tenant request is denied server-side. Secrets (AI keys, payment keys, tokens) are AES-256-GCM encrypted at rest.',
      'No system is perfectly secure; if a breach affects your data we will notify you by email and act to contain it.',
    ],
  },
  {
    h: 'Your rights',
    p: [
      `You can export your projects, delete them permanently, sign out all devices, or request full account deletion by writing to ${SITE.supportEmail}. We honour deletion requests within ${SITE.responseTime}, keeping only what law requires us to retain (for example payment records for tax purposes).`,
      'Under India\u2019s DPDP Act (2023) you may request access, correction and erasure of your personal data — write to the same address and we will verify you before acting.',
    ],
  },
  {
    h: 'Contact',
    p: [
      `Privacy questions: ${SITE.supportEmail} · Grievance officer: ${SITE.supportEmail} (response ${SITE.responseTime}).`,
    ],
  },
]

export default function PrivacyPage() {
  return (
    <PublicShell>
      <PublicNav />
      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-5 py-12">
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
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
