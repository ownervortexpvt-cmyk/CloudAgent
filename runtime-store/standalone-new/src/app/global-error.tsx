'use client'

/**
 * v142 — root global error boundary. Renders even when the root layout
 * itself fails. Self-contained inline styles (external CSS may be the thing
 * that failed). Auto-reloads once for chunk/restart-style transient errors;
 * never loops — sessionStorage guard + user-controlled retry afterwards.
 */
import { useEffect } from 'react'

const CHUNKY = /chunk|dynamically imported|Failed to fetch|Loading initial props|HMR/i

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const msg = error?.message || 'Unknown client error'

  useEffect(() => {
    const key = 'ca_gerr_autoreload'
    const n = Number(sessionStorage.getItem(key) || 0)
    if (CHUNKY.test(msg) && n < 1) {
      sessionStorage.setItem(key, String(n + 1))
      setTimeout(() => location.reload(), 400)
    }
  }, [msg])

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#05070f', color: '#e9eef7' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 460, width: '100%', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, padding: 28, textAlign: 'center', background: 'rgba(255,255,255,.04)' }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>⚡</div>
            <h1 style={{ fontSize: 18, margin: '0 0 10px', fontWeight: 600 }}>Cloud Agent hit a snag</h1>
            <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 6px', lineHeight: 1.5 }}>
              A client-side error stopped the app from rendering. One automatic reload was attempted for
              transient (restart/stale-asset) failures.
            </p>
            <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 20px', wordBreak: 'break-all' }}>
              {msg.slice(0, 220)}{error?.digest ? ` · ${error.digest}` : ''}
            </p>
            <button
              onClick={() => { try { sessionStorage.removeItem('ca_gerr_autoreload') } catch {}; location.reload() }}
              style={{ background: '#f59e0b', color: '#111', border: 0, borderRadius: 10, padding: '11px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Reload Cloud Agent
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
