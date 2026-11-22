/**
 * v110 — shared shell for the public marketing/legal pages: a minimal top
 * nav and the compliance footer (Terms · Privacy · Refund · Contact — the
 * links Razorpay's India onboarding review looks for).
 */
import Link from 'next/link'
import { SITE } from '@/lib/site'

export function PublicNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-primary to-emerald-400 inline-flex items-center justify-center text-primary-foreground text-xs font-black">C</span>
          {SITE.name}
        </Link>
        <nav className="flex items-center gap-1 sm:gap-4 text-sm">
          <Link href="/pricing" className="px-2 py-1.5 rounded-md hover:bg-muted transition text-muted-foreground hover:text-foreground">Pricing</Link>
          <Link href="/login" className="px-2 py-1.5 rounded-md hover:bg-muted transition text-muted-foreground hover:text-foreground">Sign in</Link>
          <Link href="/register" className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 font-medium hover:bg-primary/90 transition">Start free</Link>
        </nav>
      </div>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className="mt-auto border-t border-border/60">
      <div className="max-w-6xl mx-auto px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
        <div>© {new Date().getFullYear()} {SITE.companyLine} · {SITE.madeIn}</div>
        <nav className="flex flex-wrap items-center gap-4">
          <Link href="/terms" className="hover:text-foreground transition">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-foreground transition">Privacy Policy</Link>
          <Link href="/refund" className="hover:text-foreground transition">Refund & Cancellation</Link>
          <Link href="/contact" className="hover:text-foreground transition">Contact Us</Link>
        </nav>
      </div>
    </footer>
  )
}

/** Small shared page wrapper so the footer sticks to the bottom. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex flex-col bg-background text-foreground">{children}</div>
}
