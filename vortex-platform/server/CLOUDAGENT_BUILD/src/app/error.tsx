'use client'

/**
 * v142 — route-segment error boundary.
 *
 * WHY: behind a preview gateway the dev server occasionally restarts while a
 * client is open; a stale chunk fetch then bubbles up as an unhandled client
 * exception and Next shows the dead-end "Application error" page. This
 * boundary turns that dead end into a recoverable screen:
 *   - known chunk/HMR errors auto-reload ONCE (session-guarded, no loops)
 *   - everything else gets an honest message + Retry button
 */
import { useEffect, useState } from 'react'

const CHUNKY = /chunk|dynamically imported|Failed to fetch|Loading initial props|HMR/i

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const msg = error?.message || 'Unknown client error'
  const [count, setCount] = useState(0)

  useEffect(() => {
    // Auto-recover ONCE from chunk-load style transient failures.
    const key = 'ca_err_autoreload'
    const n = Number(sessionStorage.getItem(key) || 0)
    if (CHUNKY.test(msg) && n < 1) {
      sessionStorage.setItem(key, String(n + 1))
      setTimeout(() => location.reload(), 400)
    } else {
      // Successful render past this point clears the loop guard.
      if (n >= 1) sessionStorage.removeItem(key)
    }
  }, [msg])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
        <div className="text-3xl mb-3">⚡</div>
        <h2 className="text-lg font-semibold text-white/90 mb-2">Something hiccupped</h2>
        <p className="text-sm text-white/60 mb-1">
          A client error interrupted this view. It is usually transient (server restart / stale asset).
        </p>
        <p className="text-xs text-white/40 mb-5 break-all">{msg.slice(0, 200)}{error?.digest ? ` · ${error.digest}` : ''}</p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => { setCount(c => c + 1); reset() }}
            className="px-4 py-2 rounded-xl bg-amber-500 text-black text-sm font-semibold hover:bg-amber-400"
          >
            Try again{count ? ` (${count})` : ''}
          </button>
          <button
            onClick={() => location.reload()}
            className="px-4 py-2 rounded-xl border border-white/15 text-white/80 text-sm hover:bg-white/5"
          >
            Full reload
          </button>
        </div>
      </div>
    </div>
  )
}
