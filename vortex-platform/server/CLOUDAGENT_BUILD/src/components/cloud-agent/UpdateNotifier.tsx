'use client'

/**
 * v117.2 — NEW VERSION NOTIFIER (owner request):
 * "update version publish korle user er phone e notification chole jabe —
 *  new version available — user sei notification e click kore update kore
 *  nite parbe."
 *
 * Three independent detectors, one banner:
 *   1. BUILD POLL  — /api/version vs localStorage['ca_build_id'] (catches
 *      every deploy, even when the SW didn't change). Polled on visibility
 *      change and every 45s while visible.
 *   2. SW MESSAGE  — sw-builder.js posts {type:'CA_NEW_VERSION'} when an
 *      activate actually REPLACED an older cache (a real upgrade).
 *   3. SW CONTROLLER CHANGE — the classic PWA "new SW took over" signal
 *      (guarded so the very first claim doesn't false-positive).
 *
 * Tapping the banner stores the new build id and reloads; the network-first
 * service worker then serves the fresh shell. If the user has already
 * granted Notification permission, a system-level notification fires too
 * (its click focuses the window) — that is the "phone notification".
 * The component is intentionally tiny and idle-deferred so it never slows
 * the first paint of any page.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const LS_KEY = 'ca_build_id'

export default function UpdateNotifier() {
  const [updateReady, setUpdateReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const newBuild = useRef<string>('')
  const hadController = useRef<boolean>(false)
  const shownRef = useRef<boolean>(false)

  const showUpdate = useCallback((buildId?: string) => {
    if (shownRef.current) return
    shownRef.current = true
    if (buildId) newBuild.current = buildId
    setUpdateReady(true)
    // Best-effort system notification (phones show it in the notification
    // shade while the app is open). Silently skipped without permission.
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const n = new Notification('CloudAgent — new version available', {
          body: 'Tap to update to the latest version.',
          tag: 'ca-update',
          // renotify re-fires the shade entry even with the same tag
          // (valid at runtime; missing from the TS DOM lib, hence the cast)
          ...({ renotify: true } as object),
        } as NotificationOptions)
        n.onclick = () => { try { window.focus(); n.close() } catch {} }
      }
    } catch {}
  }, [])

  // Detector 2 — SW message (activate replaced an old cache)
  // Detector 3 — controllerchange (new SW took over an existing page)
  useEffect(() => {
    hadController.current = Boolean(navigator.serviceWorker?.controller)
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'CA_NEW_VERSION') showUpdate(e.data.version)
    }
    const onCtl = () => { if (hadController.current) showUpdate() }
    navigator.serviceWorker?.addEventListener('message', onMsg)
    navigator.serviceWorker?.addEventListener('controllerchange', onCtl)
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMsg)
      navigator.serviceWorker?.removeEventListener('controllerchange', onCtl)
    }
  }, [showUpdate])

  // Detector 1 — build poll (visible tabs only)
  useEffect(() => {
    let dead = false
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        const d = await r.json()
        if (dead || !d?.ok || !d.buildId) return
        const prev = (() => { try { return localStorage.getItem(LS_KEY) } catch { return null } })()
        if (prev && prev !== d.buildId) showUpdate(d.buildId)
        else if (!prev) {
          // first-ever visit: just remember the current build (no banner)
          try { localStorage.setItem(LS_KEY, d.buildId) } catch {}
        }
      } catch {}
    }
    check()
    const iv = setInterval(check, 45_000)
    document.addEventListener('visibilitychange', check)
    return () => { dead = true; clearInterval(iv); document.removeEventListener('visibilitychange', check) }
  }, [showUpdate])

  async function applyUpdate() {
    setBusy(true)
    if (newBuild.current) { try { localStorage.setItem(LS_KEY, newBuild.current) } catch {} }
    else { try { localStorage.removeItem(LS_KEY) } catch {} }
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      // Ask any waiting SW to take over immediately (install already does
      // skipWaiting, so this is belt-and-braces for older SWs).
      reg?.waiting?.postMessage({ type: 'CA_SKIP_WAITING' })
    } catch {}
    // controllerchange may fire on its own; give it a beat, then hard reload.
    setTimeout(() => location.reload(), 400)
  }

  if (!updateReady) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[95] flex justify-center px-3 pb-3 pointer-events-none">
      <button
        type="button"
        onClick={applyUpdate}
        className="pointer-events-auto w-full max-w-md flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 backdrop-blur px-4 py-3 text-left shadow-2xl hover:bg-emerald-500/20 transition"
      >
        <span className="text-xl" aria-hidden>🆕</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-emerald-300">New version available</span>
          <span className="block text-xs text-emerald-200/70 truncate">
            {busy ? 'Updating — reloading…' : 'Tap to update CloudAgent now'}
          </span>
        </span>
        <span className="shrink-0 rounded-lg bg-emerald-500 text-black text-xs font-bold px-3 py-1.5">
          {busy ? '…' : 'UPDATE'}
        </span>
      </button>
    </div>
  )
}
