/**
 * v110 — public marketing landing page (server component, zero client JS).
 * Anonymous visitors hitting "/" are rewritten here by the middleware.
 * Every claim below is backed by a real, measurable platform capability —
 * no invented benchmarks: the swarm size, the toolchains and the payment
 * rails are shipped features, and speed numbers come from the production
 * build measurements recorded in the worklog.
 */
import Link from 'next/link'
import type { Metadata } from 'next'
import { PLANS, PAID_PLAN_ORDER, formatINR } from '@/lib/plans'
import { SITE } from '@/lib/site'
import { PublicShell, PublicNav, PublicFooter } from '@/components/cloud-agent/public-shell'
import {
  Check, X, Minus, Zap, TerminalSquare, Rocket, ShieldCheck, Github, Globe,
  Bot, Wallet, ServerCog, CalendarClock, Layers, ArrowRight,
} from 'lucide-react'

// v156 — SEO: the exact brand phrase users search for. This page is the only
// crawler-visible surface of the platform (public in the middleware), so the
// title, description and structured data must all carry "Vortex Cloud Agent".
export const metadata: Metadata = {
  title: 'Vortex Cloud Agent — AI App Builder | Build Real Apps by Chatting',
  description:
    'Vortex Cloud Agent is the AI app builder where one prompt deploys a swarm of up to 1,000 AI agents that plan, code, review and ship real software — real Linux terminal, APK/.exe exports, custom domains, UPI billing. Free platform hours every month.',
  keywords: [
    'vortex cloud agent', 'vortex cloudagent', 'vortex cloud agent app builder',
    'AI app builder', 'multi-agent coding', 'build apps with AI', 'vortex agent',
  ],
  openGraph: {
    title: 'Vortex Cloud Agent — AI App Builder',
    description: 'One prompt → a 1,000-agent swarm that plans, codes, reviews and ships real software.',
    type: 'website',
    siteName: 'Vortex Cloud Agent',
  },
}

// JSON-LD: tells search engines exactly what this product is (rich results)
const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'Vortex Cloud Agent',
  alternateName: ['Vortex CloudAgent', 'Vortex Cloud Agent app builder'],
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Web, Android, Windows, Linux',
  description:
    'AI app builder: one prompt deploys a coordinated swarm of up to 1,000 AI agents that plan, code, review and ship real software — with a real Linux terminal, APK/.exe exports, custom domains and UPI billing.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR', description: 'Free open hours every month + paid plans' },
  featureList: [
    '1,000-agent swarm builds',
    'Real Linux terminal',
    'Android APK and desktop .exe export',
    'Built-in open-source AI models (no API key needed)',
    'Bring your own AI keys',
    'Scheduled autonomous runs',
  ],
}

const COMPARISON = {
  them: ['Lovable', 'Replit', 'v0', 'Bolt'],
  rows: [
    { label: 'Entry price', us: 'Big Billion Day — 4 free hrs/month', them: ['$25/mo', '$20–25/mo', '$20/mo', '$20/mo'] },
    { label: 'Pay in ₹ with UPI', us: true, them: [false, false, false, false] },
    { label: 'AI agents per build', us: 'Up to 1,000-agent swarm', them: ['1', '1', '1', '1'] },
    { label: 'Bring your own AI keys', us: true, them: [false, false, false, false] },
    { label: 'Real Linux terminal', us: true, them: [false, true, false, 'web-only'] },
    { label: 'Android APK / desktop .exe export', us: true, them: [false, 'partial', false, false] },
    { label: 'Built-in open-source AI models (no key needed)', us: true, them: [false, false, false, false] },
    { label: 'Scheduled autonomous runs', us: true, them: [false, false, false, false] },
  ] as { label: string; us: string | boolean; them: (string | boolean)[] }[],
}

function Cell({ v }: { v: string | boolean }) {
  if (v === true) return <Check className="w-4 h-4 text-emerald-500 mx-auto" />
  if (v === false) return <X className="w-4 h-4 text-muted-foreground/40 mx-auto" />
  if (v === 'partial' || v === 'web-only')
    return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Minus className="w-3.5 h-3.5" />{v === 'partial' ? 'partial' : 'web-only'}</span>
  return <span className="text-xs sm:text-sm">{v}</span>
}

const FEATURES = [
  { icon: Bot, title: '1,000-agent swarm', body: 'One prompt becomes a coordinated army: a coordinator plans, quality agents review, hundreds of writers build in parallel lanes. Single-agent tools queue your work — we orchestrate it.' },
  { icon: TerminalSquare, title: 'Real terminal, real shell', body: 'A genuine Linux terminal per project — install anything, run migrations, debug like a developer. It even self-heals and reconnects after a server restart.' },
  { icon: Rocket, title: 'Ship to APK, .exe and web', body: 'Export real installers: Android APK, Electron desktop executables, Docker, or publish straight to the web with custom domains and analytics.' },
  { icon: Wallet, title: 'Pay in ₹, with UPI', body: 'Razorpay checkout with PhonePe, GPay, Paytm, cards and netbanking. No dollar cards, no RBI e-mandate failures, no forex markup.' },
  { icon: ServerCog, title: 'No API key? No problem.', body: 'Six open-source models (Qwen, DeepSeek, Llama, Gemma, Phi, Mistral) run right on the server — start building with zero AI keys. Or plug in OpenAI, Gemini, Claude, Groq, OpenRouter at your own rates.' },
  { icon: Github, title: 'GitHub built in', body: 'Two-way sync: push your project to a repo, clone any repo back in. Private by default, tokens encrypted at rest.' },
  { icon: CalendarClock, title: 'Autonomous schedules', body: 'Your agent army fires itself on a timer — nightly refactors, hourly scrapers, cron-style maintenance — with honest run history.' },
  { icon: Globe, title: 'Domains, analytics, PWA', body: 'Custom domains, privacy-friendly analytics, installable PWA builder output and one-click backups — the unglamorous 20% that makes apps real.' },
]

const FAQ = [
  { q: 'Is there a free trial or free plan?', a: 'No free trial — the builder is a serious production tool. Instead you get Big Billion Day: on the 1st of EVERY month, 8:00 AM – 12:00 PM IST, the whole platform opens FREE for 4 hours with Pro-level power. No card, no commitment — register and build.' },
  { q: 'Do I need my own AI API key?', a: 'No. The builder ships with built-in AI including open-source models running on our servers — you can create apps from minute one without a single API key. Power users can still attach their own providers (OpenAI, Gemini, Claude, Groq, Ollama…) to run at their own rates.' },
  { q: 'How do payments work?', a: 'All billing runs through Razorpay: UPI (PhonePe / Google Pay / Paytm), debit/credit cards and netbanking. Monthly plans activate instantly after payment and can be cancelled anytime from your account.' },
  { q: 'Do you offer lifetime access?', a: 'No — deliberately. Vortex CloudAgent is a living product: new models, new toolchains and new features ship every month, and a subscription keeps that sustainable. Every plan is a rolling 30-day subscription with no lock-in; cancel and renew as you wish.' },
  { q: 'Do you charge for AI tokens on top?', a: 'No. Plans include generous token pools, and you can also attach your own AI provider keys so your heavy usage runs at your provider rates — not ours.' },
  { q: 'Can I get a self-hosted / source license?', a: 'Yes — businesses can license Vortex CloudAgent with source for on-premise deployment on an annual agreement. Contact us with your use case and team size for a quote.' },
]

export default function LandingPage() {
  const paid = PAID_PLAN_ORDER.map((id) => PLANS[id])
  return (
    <PublicShell>
      {/* v156 — structured data for search engines (crawler-visible page) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <PublicNav />

      <main className="flex-1">
        {/* ── HERO ── */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,--theme(--color-primary/10%),transparent)]" />
          <div className="max-w-6xl mx-auto px-5 pt-16 pb-20 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground mb-6">
              <Zap className="w-3.5 h-3.5 text-primary" /> {SITE.madeIn} · Razorpay secured
            </div>
            <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-[1.05] max-w-3xl mx-auto">
              Don&apos;t prompt a chatbot.
              <span className="block bg-gradient-to-r from-primary to-emerald-400 bg-clip-text text-transparent">Command an army of 1,000 agents.</span>
            </h1>
            <p className="text-muted-foreground mt-5 max-w-2xl mx-auto text-base sm:text-lg">
              Vortex CloudAgent is the AI app builder where one instruction deploys a coordinated swarm that plans,
              codes, reviews and ships real software — with a real terminal, real deploys and real exports.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/register" className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-6 py-3 font-semibold hover:bg-primary/90 transition shadow-lg shadow-primary/20">
                Create account — join Big Billion Day <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="/pricing" className="inline-flex items-center gap-2 rounded-xl border px-6 py-3 font-semibold hover:bg-muted transition">
                See plans &nbsp;·&nbsp; {formatINR(1999)}/mo
              </Link>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Every 1st of the month, 8 AM – 12 PM IST: the builder opens FREE for 4 hours. No trial, no card.
            </p>
            <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl mx-auto text-left">
              {[
                ['1,000', 'agents per swarm'],
                ['~5 ms', 'API response (prod build)'],
                ['UPI', 'native Indian payments'],
                ['24/7', 'autonomous schedules'],
              ].map(([big, small]) => (
                <div key={small} className="rounded-xl border bg-card p-4">
                  <div className="text-2xl font-black tracking-tight">{big}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{small}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── COMPARISON ── */}
        <section className="max-w-6xl mx-auto px-5 py-14" id="compare">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-center">
            How we stack up against <span className="text-primary">Lovable, Replit, v0 & Bolt</span>
          </h2>
          <p className="text-center text-sm text-muted-foreground mt-2 max-w-xl mx-auto">
            Compared on public pricing pages and shipped features ( competitors&apos; data from their public plans, {new Date().getFullYear()} ).
          </p>
          <div className="mt-8 overflow-x-auto rounded-2xl border">
            <table className="w-full min-w-[720px] text-sm bg-card">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left font-medium px-4 py-3 text-muted-foreground">Capability</th>
                  <th className="px-4 py-3 font-bold text-primary min-w-[150px]">{SITE.name}</th>
                  {COMPARISON.them.map((t) => (
                    <th key={t} className="px-4 py-3 font-medium text-muted-foreground">{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.rows.map((row) => (
                  <tr key={row.label} className="border-b last:border-0">
                    <td className="px-4 py-3 text-muted-foreground">{row.label}</td>
                    <td className="px-4 py-3 text-center font-semibold bg-primary/5">
                      <Cell v={row.us} />
                    </td>
                    {row.them.map((v, i) => (
                      <td key={i} className="px-4 py-3 text-center text-muted-foreground">
                        <Cell v={v} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 text-center">
            "partial" = available in some form but limited; competitor pricing converted at ~₹84/USD and rounded. Correction requests welcome at {SITE.supportEmail}.
          </p>
        </section>

        {/* ── FEATURES ── */}
        <section className="max-w-6xl mx-auto px-5 py-14" id="features">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-center">Everything a software team needs — in one builder</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border bg-card p-5 hover:shadow-md transition">
                <f.icon className="w-5 h-5 text-primary" />
                <h3 className="mt-3 font-semibold text-sm">{f.title}</h3>
                <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── PRICING PREVIEW ── */}
        <section className="max-w-6xl mx-auto px-5 py-14" id="pricing">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-center">Priced for India</h2>
          <p className="text-center text-sm text-muted-foreground mt-2">Monthly plans, cancel anytime — built-in AI included on every tier.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {paid.map((p) => (
              <div key={p.id} className={`relative rounded-2xl border p-5 flex flex-col ${p.highlight ? 'border-primary ring-1 ring-primary/40' : 'border-border'}`}>
                <div className="flex items-baseline justify-between">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-xl font-bold">{formatINR(p.priceINR)}<span className="text-xs text-muted-foreground font-normal">/mo</span></span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{p.tagline}</div>
                <div className="mt-3 flex-1 text-xs text-muted-foreground">{p.features.slice(0, 4).join(' · ')}</div>
              </div>
            ))}
            <div className="relative rounded-2xl border-2 border-primary/60 p-5 flex flex-col bg-primary/5">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">Every plan includes</span>
                <span className="text-xl font-bold">6<span className="text-xs text-muted-foreground font-normal"> AI models</span></span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Built-in open-source AI</div>
              <div className="mt-3 flex-1 text-xs text-muted-foreground">Qwen · DeepSeek · Llama · Gemma · Phi · Mistral — build with zero API keys, on every tier.</div>
            </div>
          </div>
          <div className="text-center mt-8">
            <Link href="/pricing" className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-6 py-3 font-semibold hover:bg-primary/90 transition">
              Full plan details <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="max-w-3xl mx-auto px-5 py-14">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-center">Questions, answered straight</h2>
          <div className="mt-8 space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-xl border bg-card p-4 open:shadow-sm">
                <summary className="cursor-pointer font-medium text-sm flex items-center justify-between">
                  {f.q}
                  <Layers className="w-4 h-4 text-muted-foreground group-open:rotate-90 transition-transform" />
                </summary>
                <p className="mt-2.5 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── FINAL CTA ── */}
        <section className="max-w-6xl mx-auto px-5 pb-20">
          <div className="rounded-3xl border bg-gradient-to-b from-primary/10 to-transparent p-10 text-center">
            <ShieldCheck className="w-8 h-8 text-primary mx-auto" />
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mt-4">Your army is waiting.</h2>
            <p className="text-muted-foreground text-sm mt-2 max-w-md mx-auto">
              Create your account now, catch the next Big Billion Day (4 free hours on the 1st, 8 AM–12 PM IST) — or subscribe and start shipping today.
            </p>
            <Link href="/register" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-6 py-3 font-semibold hover:bg-primary/90 transition shadow-lg shadow-primary/20">
              Create free account <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </PublicShell>
  )
}
