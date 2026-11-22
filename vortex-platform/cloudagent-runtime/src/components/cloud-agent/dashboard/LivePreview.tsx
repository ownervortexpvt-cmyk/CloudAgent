'use client'

import { useCallback, useEffect, useState, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  Monitor, Smartphone, Tablet, Laptop, RefreshCw, Maximize2, RotateCcw, ZoomIn, ZoomOut,
  Smartphone as PhoneIcon, QrCode, Terminal as TerminalIcon, X, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/lib/store'
import { readApi } from '@/lib/http'

interface PreviewProps {
  projectId: string
  port?: number | null
  status?: string
}

type Device = 'desktop' | 'laptop' | 'tablet' | 'mobile'
type Orientation = 'portrait' | 'landscape'

const DEVICE_SIZES: Record<Device, { w: number; h: number; label: string }> = {
  desktop: { w: 1280, h: 800, label: 'Desktop · 1280×800' },
  laptop: { w: 1024, h: 640, label: 'Laptop · 1024×640' },
  tablet: { w: 768, h: 1024, label: 'Tablet · 768×1024' },
  mobile: { w: 375, h: 812, label: 'Mobile · 375×812' },
}

export function LivePreview({ projectId, port, status }: PreviewProps) {
  const [device, setDevice] = useState<Device>('desktop')
  const [orientation, setOrientation] = useState<Orientation>('portrait')
  const [zoom, setZoom] = useState(1)
  const [reloadKey, setReloadKey] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [showQR, setShowQR] = useState(false)
  const [showConsole, setShowConsole] = useState(false)
  const [consoleLogs, setConsoleLogs] = useState<Array<{ type: string; message: string }>>([])
  // v76: USER APP ↔ ADMIN APP tabs. The agent's FULL PRODUCT rule ships an
  // admin panel (admin.html, /admin, pages/admin…) in the SAME project — this
  // tab switch previews it in the same viewport. adminPath is auto-detected.
  const [appTab, setAppTab] = useState<'user' | 'admin'>('user')
  const [adminPath, setAdminPath] = useState<string | null>(null)
  // v86: periodic re-probe tick — the admin probe used to run exactly ONCE
  // per serverReady/reload flip; `next dev` lazily compiles /admin on first
  // hit (>3s), so the one-shot probe found nothing and the Admin tab stayed
  // disabled for the whole session. The tick re-runs the probe every 12s
  // while no admin path is known.
  const [probeTick, setProbeTick] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  // v63: removed unused `setView` destructure (the store View is welcome|dashboard
  // and LivePreview never switched it)

  // Auto-fit when device changes
  useEffect(() => {
    setZoom(1)
  }, [device, orientation])

  /* v90 — swipeable toolbar: ~20 controls cannot fit a phone row, so the whole
     toolbar scrolls horizontally (native touch swipe on phones, mouse-drag on
     desktop) with edge fades that reveal hidden buttons instead of cutting them.
     (Hooks live at the TOP of the component — before any early return.) */
  const [tbEl, setTbEl] = useState<HTMLDivElement | null>(null)
  const [tbCanLeft, setTbCanLeft] = useState(false)
  const [tbCanRight, setTbCanRight] = useState(false)
  const tbDrag = useRef({ down: false, moved: false, startX: 0, startScroll: 0 })

  const updateToolbarEdges = useCallback(() => {
    const el = tbEl
    if (!el) return
    setTbCanLeft(el.scrollLeft > 4)
    setTbCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [tbEl])

  // depends on tbEl (callback ref) — the toolbar does not exist while the
  // component takes an early return (no live preview / starting…), so a
  // plain mount effect would run once with null and NEVER re-measure when
  // the toolbar finally appears; the callback ref re-arms the listeners.
  useEffect(() => {
    if (!tbEl) return
    updateToolbarEdges()
    const onScroll = () => updateToolbarEdges()
    tbEl.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(updateToolbarEdges)
    ro.observe(tbEl)
    window.addEventListener('resize', updateToolbarEdges)
    return () => {
      tbEl.removeEventListener('scroll', onScroll)
      ro.disconnect()
      window.removeEventListener('resize', updateToolbarEdges)
    }
  }, [tbEl, updateToolbarEdges])

  const tbPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return // native touch scroll/swipe already handles this
    tbDrag.current = { down: true, moved: false, startX: e.clientX, startScroll: tbEl?.scrollLeft || 0 }
  }
  const tbPointerMove = (e: React.PointerEvent) => {
    const d = tbDrag.current
    if (!d.down) return
    const dx = e.clientX - d.startX
    if (Math.abs(dx) > 4) d.moved = true
    if (tbEl) tbEl.scrollLeft = d.startScroll - dx
  }
  const tbPointerUp = () => { tbDrag.current.down = false }
  // a real drag (not a tap) must not fire the button underneath the pointer
  const tbClickCapture = (e: React.MouseEvent) => {
    if (tbDrag.current.moved) {
      e.stopPropagation()
      e.preventDefault()
      tbDrag.current.moved = false
    }
  }

  // v85: serverReady must be declared BEFORE the admin-probe effect — the
  // dependency array is evaluated during render, and referencing a state
  // variable declared later would be a TDZ ReferenceError.
  const [serverReady, setServerReady] = useState(false)

  // v76: detect the project's ADMIN page so the Admin tab can preview it.
  // Probes the common admin entry points through the same gateway the iframe
  // uses. Two false-positives are filtered:
  //   1. the platform's "warming up" placeholder (Vortex logo + auto reload)
  //   2. SPA fallback servers (flutter web answers 200 + the SAME index.html
  //      for ANY path) — detected by comparing against the user app response
  //   3. framework 404 pages ("This page could not be found")
  // v85 FIX: the old probe fired ONCE on a blind 2.5s timer — slow-booting dev
  // servers (flutter pub get, npm install, gradle…) were still starting, every
  // probe returned null, and the Admin tab stayed disabled for the whole
  // session (owner: "admin app er preview dekha jacche na"). The probe now
  // waits for serverReady (the same signal the iframe trusts), then retries
  // on every ready-flip and manual reload, with two extra entry candidates.
  // v86 FIX (owner: "admin app er preview dekha jacche na" — still broken):
  //   a) SPA ROUTES: for React/Vite/Next the FULL-PRODUCT rule puts admin at
  //      /admin as a CLIENT route — the dev server answers with the same
  //      index.html (SPA fallback), which the old filter rejected forever.
  //      Now the fallback candidate is kept and verified against the project's
  //      real file tree (/api/files/<id>): admin-ish files → Admin tab ON,
  //      the SPA router renders the admin view from the iframe URL.
  //   b) RETRIES: each candidate is probed up to 3× (lazy compiles) and the
  //      whole probe re-runs every 12s (probeTick) while nothing is found.
  //   c) CANDIDATES: + /pages/admin.html, /admin-panel.html, /dashboard.html,
  //      /admin/login, /admin/dashboard — the paths the audit message itself
  //      sanctions, so the probe can find what the agent was told to build.
  useEffect(() => {
    if (!port || status !== 'running') { setAdminPath(null); setAppTab('user'); return }
    if (!serverReady) return // probe only once the health check passed — effect re-runs when it flips
    let cancelled = false
    const candidates = ['/admin.html', '/admin', '/admin/', '/admin/index.html', '/admin/login.html', '/admin/dashboard.html', '/pages/admin.html', '/admin-panel.html', '/dashboard.html', '/admin/login', '/admin/dashboard']
    const bust = Date.now()
    // v93: probes go through the SAME-ORIGIN PREVIEW PROXY (/preview/<port>/…)
    // — the old `?XTransformPort=` same-origin fetch hit the BUILDER itself
    // (Next ignores that query), so the probe compared the builder against the
    // builder and the Admin tab showed the cloud agent (owner ❌ report).
    const fetchHtml = async (path: string): Promise<string | null> => {
      try {
        const res = await fetch(`/preview/${port}${path}?_probe=${bust}`, { signal: AbortSignal.timeout(5000), cache: 'no-store' })
        const ct = (res.headers.get('content-type') || '').toLowerCase()
        if (!res.ok || !ct.includes('html')) return null
        const head = (await res.text()).slice(0, 4000)
        if (!head.includes('<')) return null
        if (head.includes('window.location.href = window.location.href')) return null // gateway placeholder
        return head
      } catch { return null }
    }
    const probe = async () => {
      // wait for the user app itself to answer before probing candidates
      let base: string | null = null
      for (let i = 0; i < 5 && !cancelled; i++) {
        base = await fetchHtml('/')
        if (base || cancelled) break
        await new Promise(r => setTimeout(r, 2000))
      }
      if (cancelled) return
      let spaFallback: string | null = null // v86: first SPA-fallback admin candidate
      for (const c of candidates) {
        // v86: 3 attempts per candidate — `next dev` compiles /admin on the
        // very first hit and can easily exceed the old single 3s window.
        let head: string | null = null
        for (let a = 0; a < 3 && !head && !cancelled; a++) {
          head = await fetchHtml(c)
          if (!head && a < 2) await new Promise(r => setTimeout(r, 1500))
        }
        if (cancelled) return
        if (!head) continue
        // v85: compare 800 chars (was 200) — two real pages that share a long
        // identical <head> (same meta stack, title deep in) false-rejected as
        // "SPA fallback" at 200; a true SPA fallback is identical everywhere.
        if (base && head.slice(0, 800) === base.slice(0, 800)) { if (!spaFallback) spaFallback = c; continue } // v86: remember, don't discard
        if (/could ?not be found|<title>404|status.?404/i.test(head.slice(0, 2000))) continue
        if (!cancelled) { setAdminPath(c); return }
      }
      // v86: SPA case — the candidate page IS the user app shell (client-side
      // router). Enable the Admin tab only when the project really has admin
      // files, mirroring the agent's disk audit (agent.ts hasAdmin).
      if (!cancelled && spaFallback && projectId) {
        try {
          const res = await fetch(`/api/files/${projectId}`, { cache: 'no-store' })
          if (res.ok) {
            const data = await res.json()
            const paths: string[] = []
            const walk = (n: any) => { if (!n) return; if (n.path && n.path !== '.') paths.push(String(n.path).toLowerCase()); (n.children || []).forEach(walk) }
            walk(data.tree)
            const hasAdminFiles = paths.some(p =>
              /(^|\/)(admin)(\/|\.)/.test(p) || /admin\.html$/.test(p) || /(^|\/)pages\/admin/.test(p) || /(^|\/)app\/admin/.test(p) || /(^|\/)src\/admin/.test(p) || /(^|\/)lib\/admin/.test(p))
            if (hasAdminFiles && !cancelled) { setAdminPath(spaFallback); return }
          }
        } catch { /* tree unreachable — stay disabled, next tick retries */ }
      }
      if (!cancelled) setAdminPath(null)
    }
    const t = setTimeout(probe, 800) // serverReady already gate-keeps; short settle only
    return () => { cancelled = true; clearTimeout(t) }
  }, [port, status, reloadKey, serverReady, probeTick, projectId])

  // v86: periodic re-probe while the app is running and no admin path is
  // known yet — slow first-compile /admin pages get found eventually.
  useEffect(() => {
    if (!port || status !== 'running' || adminPath) return
    const iv = setInterval(() => setProbeTick(t => (t + 1) % 100000), 12000)
    return () => clearInterval(iv)
  }, [port, status, adminPath])

  // Health check: poll the dev server URL until it responds. The preview URL
  // is same-origin (goes through the gateway), so a normal fetch gives us a
  // REAL status code — the old no-cors mode returned an opaque success for
  // 404/500 responses too, rendering broken pages as "ready".
  useEffect(() => {
    if (!port || status !== 'running') {
      setServerReady(false)
      return
    }
    setServerReady(false)
    // v93: health check via the same-origin preview proxy — the old
    // `/?XTransformPort=` fetch always 200'd (the BUILDER answered), so a dead
    // app still rendered "ready" and the iframe showed the cloud agent.
    const url = `/preview/${port}?_hc=${Date.now()}`
    let cancelled = false
    let attempts = 0
    const checkReady = async () => {
      attempts++
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000), cache: 'no-store' })
        if (cancelled) return
        // v86 FIX: 502/503 are the GATEWAY's own error pages while the dev
        // server is still binding — accepting them flipped serverReady true
        // during a dead-port window, the admin probe then fired against
        // nothing and never re-ran (owner: admin tab dead for the session).
        // Any other HTTP response (200/404/500) means the app itself is
        // answering — ready to render.
        if (res.status === 502 || res.status === 503) throw new Error('gateway-upstream-not-ready')
        setServerReady(true)
        return
      } catch {
        if (attempts < 30 && !cancelled) {
          retryTimer = setTimeout(checkReady, 2000)
        } else if (!cancelled) {
          // Give up waiting but still show the iframe — user can judge
          setServerReady(true)
        }
      }
    }
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    checkReady()
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer) }
  }, [port, status, reloadKey])

  // Console panel: stream the dev server's runtime logs (real, useful
  // output) instead of the permanently-empty placeholder.
  useEffect(() => {
    if (!showConsole || !projectId) return
    let cancelled = false
    const pull = async () => {
      try {
        const res = await fetch(`/api/runtime?projectId=${projectId}`)
        const data = await readApi<any>(res)
        if (cancelled || !data.logs) return
        const lines = String(data.logs).split('\n').filter(Boolean)
        const tail = lines.slice(-200)
        setConsoleLogs(tail.map((l: string) => ({
          type: /error|failed|exception/i.test(l) ? 'error' : /warn/i.test(l) ? 'warn' : 'info',
          message: l,
        })))
      } catch {}
    }
    pull()
    const t = setInterval(pull, 2000)
    return () => { cancelled = true; clearInterval(t) }
  }, [showConsole, projectId])

  if (!port || status !== 'running') {
    return (
      <div className="h-full grid place-items-center bg-background ca-grid-bg">
        <div className="text-center max-w-sm px-6">
          <div className="mx-auto w-14 h-14 rounded-xl bg-muted grid place-items-center mb-3">
            <Monitor className="w-7 h-7 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No live preview</h3>
          <p className="text-sm text-muted-foreground">
            Click <span className="text-primary font-medium">RUN</span> in the toolbar to start the dev server.
            Once it's running, the live preview will load here.
          </p>
        </div>
      </div>
    )
  }

  // Show loading state while dev server is booting up
  if (!serverReady) {
    return (
      <div className="h-full grid place-items-center bg-background ca-grid-bg">
        <div className="text-center max-w-sm px-6">
          <div className="mx-auto w-14 h-14 rounded-xl bg-muted grid place-items-center mb-3">
            <Loader2 className="w-7 h-7 text-primary animate-spin" />
          </div>
          <h3 className="font-semibold mb-1">Starting preview…</h3>
          <p className="text-sm text-muted-foreground">
            Waiting for dev server on port {port} to be ready…
          </p>
        </div>
      </div>
    )
  }

  const baseSize = DEVICE_SIZES[device]
  const isPortrait = orientation === 'portrait'
  const w = isPortrait ? baseSize.w : baseSize.h
  const h = isPortrait ? baseSize.h : baseSize.w
  // v93: same-origin PREVIEW PROXY paths. The old `${origin}/?XTransformPort=`
  // iframe URL only ever worked when the builder itself sat behind the Caddy
  // transform (:81) — the phone reaches :3000 directly, so both tabs rendered
  // the cloud agent (owner: "admin app section e ei cloud agent kei dekhacche").
  const previewPath = appTab === 'admin' && adminPath ? adminPath : '/'
  const iframeUrl = `/preview/${port}${previewPath === '/' ? '' : previewPath}?_rk=${reloadKey}`

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col">
        <div className="flex items-center justify-between p-2 border-b border-border">
          <span className="text-sm font-medium">Live Preview · Fullscreen</span>
          <Button variant="ghost" size="sm" onClick={() => setFullscreen(false)}>
            <Maximize2 className="w-4 h-4 mr-1.5" />Exit
          </Button>
        </div>
        <iframe src={iframeUrl} className="flex-1 w-full border-0" />
      </div>
    )
  }

  const showPhoneFrame = device === 'mobile'

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Toolbar — v90: horizontally swipeable (phone) / drag-scrollable (desktop);
          edge fades show that more buttons live off-screen instead of cutting them */}
      <div className="relative border-b border-border bg-card/30">
        {tbCanLeft && <div className="pointer-events-none absolute inset-y-0 left-0 w-7 bg-gradient-to-r from-background to-transparent z-10" />}
        {tbCanRight && <div className="pointer-events-none absolute inset-y-0 right-0 w-7 bg-gradient-to-l from-background to-transparent z-10" />}
        <div
          ref={setTbEl}
          className="flex items-center gap-2 px-2 py-1.5 overflow-x-auto no-scrollbar select-none"
          onScroll={updateToolbarEdges}
          onPointerDown={tbPointerDown}
          onPointerMove={tbPointerMove}
          onPointerUp={tbPointerUp}
          onPointerLeave={tbPointerUp}
          onClickCapture={tbClickCapture}
        >
        <div className="flex items-center gap-1 shrink-0">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant={device === 'desktop' ? 'default' : 'ghost'} size="icon" className="h-7 w-7" onClick={() => setDevice('desktop')}>
                  <Monitor className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Desktop</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant={device === 'laptop' ? 'default' : 'ghost'} size="icon" className="h-7 w-7" onClick={() => setDevice('laptop')}>
                  <Laptop className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Laptop</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant={device === 'tablet' ? 'default' : 'ghost'} size="icon" className="h-7 w-7" onClick={() => setDevice('tablet')}>
                  <Tablet className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Tablet</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant={device === 'mobile' ? 'default' : 'ghost'} size="icon" className="h-7 w-7" onClick={() => setDevice('mobile')}>
                  <Smartphone className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Mobile</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {/* v76: USER APP ↔ ADMIN APP preview tabs */}
        <div className="flex items-center rounded-md border border-border overflow-hidden shrink-0">
          <button
            type="button"
            role="tab"
            aria-selected={appTab === 'user'}
            onClick={() => setAppTab('user')}
            className={`px-2.5 h-7 text-xs font-medium transition ${appTab === 'user' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}`}
          >
            User app
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={appTab === 'admin'}
            disabled={!adminPath}
            onClick={() => adminPath && setAppTab('admin')}
            title={adminPath ? `Preview the admin app (${adminPath})` : 'No admin page found in this project — ask the agent to build the admin app'}
            className={`px-2.5 h-7 text-xs font-medium transition ${appTab === 'admin' && adminPath ? 'bg-primary text-primary-foreground' : ''} ${!adminPath ? 'opacity-40 cursor-not-allowed text-muted-foreground' : appTab === 'user' ? 'text-muted-foreground hover:text-foreground hover:bg-accent/40' : ''}`}
          >
            Admin app
          </button>
        </div>
        <div className="text-xs text-muted-foreground hidden sm:block shrink-0">
          {baseSize.label.split(' · ')[1]} · {port}
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {device !== 'desktop' && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOrientation(o => o === 'portrait' ? 'landscape' : 'portrait')} title="Rotate">
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.max(0.25, +(z - 0.1).toFixed(2)))} title="Zoom out">
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))} title="Zoom in">
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setReloadKey(k => k + 1)} title="Reload">
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          {/* QR Code button */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowQR(!showQR)} title="QR Code">
                  <QrCode className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>QR Code for mobile</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* Console toggle */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className={`h-7 w-7 ${showConsole ? 'bg-accent/20 text-accent' : ''}`} onClick={() => setShowConsole(!showConsole)} title="Console">
                  <TerminalIcon className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Console logs</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFullscreen(true)} title="Fullscreen">
            <Maximize2 className="w-3.5 h-3.5" />
          </Button>
        </div>
        </div>
      </div>

      {/* Preview area */}
      <div ref={containerRef} className="flex-1 overflow-auto grid place-items-center p-4 bg-[#0a0e14] ca-grid-bg">
        {showPhoneFrame ? (
          <div
            style={{
              width: w * zoom + 24,
              height: h * zoom + 80,
            }}
            className="relative shrink-0"
          >
            {/* Phone frame */}
            <div
              className="absolute inset-0 rounded-[36px] border-[8px] border-[#1f2430] bg-[#0a0e14] shadow-2xl overflow-hidden"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
                width: w + 24 - 16,
                height: h + 80 - 16,
              }}
            >
              {/* Camera/speaker notch */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-5 bg-[#1f2430] rounded-b-xl z-10 flex items-center justify-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#2a3142]" />
                <div className="w-8 h-1 rounded-full bg-[#2a3142]" />
              </div>
              <iframe
                key={`${reloadKey}-${device}-${orientation}`}
                src={iframeUrl}
                className="absolute inset-0 w-full h-full border-0"
                style={{ marginTop: 0 }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              />
              {/* Bottom nav bar */}
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-20 h-1 rounded-full bg-[#3a4152] mb-1" />
            </div>
          </div>
        ) : (
          <div
            style={{
              width: w * zoom,
              height: h * zoom,
            }}
            className="border border-border rounded-md overflow-hidden shadow-2xl bg-white shrink-0"
          >
            <iframe
              key={`${reloadKey}-${device}-${orientation}`}
              src={iframeUrl}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          </div>
        )}
      </div>

      {/* QR Code overlay */}
      {showQR && port && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setShowQR(false)}>
          <div className="bg-white p-6 rounded-xl text-center" onClick={e => e.stopPropagation()}>
            <div className="mb-3">
              {/* v114b — the QR MUST open the same-origin /preview/<port>/ proxy.
                  It previously used ?XTransformPort=<port> — a Caddy-:81 convention
                  that no longer exists, so a scanned phone landed on THE BUILDER
                  itself (owner: "preview screen e amar ei cloud agent tai dekhacche
                  😡 — user ra copy kore nibe"). The proxy route works on every
                  deployment and always serves the USER'S app, never the builder. */}
              <QRCodeSVG value={`${window.location.origin}/preview/${port}/`} size={200} />
            </div>
            <p className="text-sm font-medium text-black mb-1">Scan to open YOUR app on phone</p>
            <p className="text-xs text-gray-500 break-all">Port: {port}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowQR(false)}>Close</Button>
          </div>
        </div>
      )}

      {/* Console panel */}
      {showConsole && (
        <div className="border-t border-border bg-[#0a0e14] h-32 flex flex-col shrink-0">
          <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-card/30 shrink-0">
            <span className="text-[10px] font-mono text-muted-foreground">Console ({consoleLogs.length} logs)</span>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-5 px-2 text-[10px]" onClick={() => setConsoleLogs([])}>Clear</Button>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowConsole(false)}>
                <X className="w-3 h-3" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-1 text-[10px] font-mono">
            {consoleLogs.length === 0 ? (
              <p className="text-muted-foreground p-2">Waiting for dev server output… (server logs stream here)</p>
            ) : (
              consoleLogs.map((log, i) => (
                <div key={i} className={`py-0.5 ${log.type === 'error' ? 'text-red-400' : log.type === 'warn' ? 'text-yellow-400' : 'text-emerald-400'}`}>
                  <span className="opacity-60">[{log.type}]</span> {log.message}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
