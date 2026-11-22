'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Smartphone, Download, CheckCircle2 } from 'lucide-react'

interface BipEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * v25 — install the BUILDER itself as a phone/desktop app (PWA).
 * Uses the native beforeinstallprompt when available; otherwise shows
 * honest manual steps per platform.
 */
export function InstallBuilderCard() {
  const [deferred, setDeferred] = useState<BipEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent))
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true
    setInstalled(standalone)
    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BipEvent)
    }
    window.addEventListener('beforeinstallprompt', onBip)
    window.addEventListener('appinstalled', () => { setInstalled(true); setDeferred(null) })
    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [])

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    const choice = await deferred.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    setDeferred(null)
  }

  return (
    <Card className="p-3 space-y-2">
      <div className="text-sm font-medium flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5 text-emerald-400" /> Install the builder as an app</div>
      {installed ? (
        <p className="text-xs text-emerald-500 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Installed — you are using the app version right now.</p>
      ) : deferred ? (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={install}><Download className="w-3.5 h-3.5 mr-1" /> Install app</Button>
          <span className="text-xs text-muted-foreground">Adds an icon to your home screen / desktop.</span>
        </div>
      ) : isIOS ? (
        <p className="text-xs text-muted-foreground">On iPhone/iPad: tap <b>Share</b>, then <b>Add to Home Screen</b>.</p>
      ) : (
        <p className="text-xs text-muted-foreground">On Android/Chrome: open the <b>⋮ menu</b> → <b>Add to Home screen / Install app</b>. The prompt also appears automatically after a few visits.</p>
      )}
    </Card>
  )
}
