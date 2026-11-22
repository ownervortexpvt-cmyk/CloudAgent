'use client'

/**
 * v60 — Notification center: a bell that collects EVERY finished run
 * (single agent + army) from the real run events in the store. Persisted
 * to localStorage (ca:notifs, newest first, capped at 50), unread badge,
 * mark-all-read and clear. Works in both the welcome header and the editor.
 */
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Bell, CheckCheck, Trash2, Bot, Users, CheckCircle2, XCircle } from 'lucide-react'
import { useAppStore } from '@/lib/store'

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function NotificationCenter() {
  const { notifications, unreadNotifs, markNotifsRead, clearNotifs } = useNotifStore()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) markNotifsRead() }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3 relative" title="Run notifications">
          <Bell className="w-4 h-4" />
          {unreadNotifs > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold grid place-items-center">
              {unreadNotifs > 9 ? '9+' : unreadNotifs}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
          <span className="text-xs font-semibold">Run notifications</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" onClick={markNotifsRead} disabled={notifications.length === 0}>
              <CheckCheck className="w-3 h-3 mr-0.5" /> Mark read
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-destructive hover:text-destructive" onClick={clearNotifs} disabled={notifications.length === 0}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-8 px-4">
              No run notifications yet — finished runs (single or army) will appear here, even if you were on another page.
            </div>
          )}
          {notifications.map(n => (
            <div key={n.id} className={`flex gap-2 px-3 py-2 border-b border-border/40 last:border-0 ${n.read ? '' : 'bg-primary/5'}`}>
              {n.kind === 'swarm'
                ? <Users className={`w-4 h-4 mt-0.5 shrink-0 ${n.ok ? 'text-emerald-400' : 'text-red-400'}`} />
                : <Bot className={`w-4 h-4 mt-0.5 shrink-0 ${n.ok ? 'text-emerald-400' : 'text-red-400'}`} />}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium flex items-center gap-1">
                  {n.ok ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <XCircle className="w-3 h-3 text-red-400" />}
                  {n.title}
                  <span className="ml-auto text-[10px] text-muted-foreground font-normal">{timeAgo(n.at)}</span>
                </div>
                <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">{n.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Small selector so unread badge stays reactive without re-rendering the world. */
function useNotifStore() {
  const notifications = useAppStore(s => s.notifications)
  const markNotifsRead = useAppStore(s => s.markNotifsRead)
  const clearNotifs = useAppStore(s => s.clearNotifs)
  const unreadNotifs = notifications.filter(n => !n.read).length
  return { notifications, unreadNotifs, markNotifsRead, clearNotifs }
}
