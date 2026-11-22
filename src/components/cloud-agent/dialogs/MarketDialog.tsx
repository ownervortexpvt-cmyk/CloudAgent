/**
 * v123 — MARKETPLACE dialog — "nijer bana app share/sell koro"
 * Browse (search + category), publish MY app (snapshot), install others' apps
 * as my own new project. Paid listings show the honest "needs Razorpay" state.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Store, Search, Upload, Download, Loader2, Users, Sparkles, Trash2, IndianRupee, PackageOpen,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'

interface Listing {
  id: string
  title: string
  description: string
  category: string
  priceInr: number
  sellerName: string
  installs: number
  fileCount: number
  sizeBytes: number
  thumbSvg?: string | null
  mine: boolean
}

const CATS = ['apps', 'games', 'business', 'portfolio', 'tools', 'other']

export function MarketDialog() {
  const { marketOpen, setMarketOpen, activeProject, openProject } = useAppStore()
  const [tab, setTab] = useState<'browse' | 'publish' | 'mine'>('browse')
  const [listings, setListings] = useState<Listing[]>([])
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState('')
  // publish form
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('apps')
  const [price, setPrice] = useState('0')
  const [publishing, setPublishing] = useState(false)

  const load = useCallback(async (opts?: { mine?: boolean }) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (cat) params.set('category', cat)
      if (opts?.mine) params.set('mine', '1')
      const r = await fetch(`/api/marketplace?${params}`)
      const d = await r.json()
      setListings(d?.listings || [])
    } catch { toast.error('Marketplace load failed') }
    setLoading(false)
  }, [q, cat])

  useEffect(() => {
    if (!marketOpen) return
    if (tab === 'mine') load({ mine: true })
    else load()
  }, [marketOpen, tab, load])

  useEffect(() => {
    if (marketOpen && activeProject) {
      setTitle(activeProject.name || '')
      setDescription(activeProject.description || '')
    }
  }, [marketOpen, activeProject])

  const publish = async () => {
    if (!activeProject) { toast.error('Age ekta project khulo — tarpor publish koro'); return }
    if (!title.trim()) { toast.error('Title din'); return }
    setPublishing(true)
    try {
      const r = await fetch('/api/marketplace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: activeProject.id, title, description, category, priceInr: Number(price) || 0 }),
      })
      const d = await r.json()
      if (d?.ok) {
        toast.success(`"${title}" marketplace e published!`)
        setTab('mine')
      } else toast.error(d?.error || 'publish failed')
    } catch { toast.error('publish failed') }
    setPublishing(false)
  }

  const install = async (l: Listing) => {
    setInstalling(l.id)
    try {
      const r = await fetch('/api/marketplace/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: l.id }),
      })
      const d = await r.json()
      if (d?.ok) {
        toast.success(`"${l.title}" installed — notun project toiri holo`)
        setMarketOpen(false)
        openProject({ id: d.projectId, name: d.projectName, framework: null, status: 'stopped', description: '', lastOpenedAt: Date.now(), entryPort: null } as any)
      } else toast.error(d?.error || 'install failed')
    } catch { toast.error('install failed') }
    setInstalling('')
  }

  const unpublish = async (l: Listing) => {
    try {
      const r = await fetch(`/api/marketplace?id=${l.id}`, { method: 'DELETE' })
      const d = await r.json()
      if (d?.ok) { toast.success('Listing removed'); load({ mine: true }) }
    } catch { toast.error('remove failed') }
  }

  const fmt = (n: number) => (n > 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

  return (
    <Dialog open={marketOpen} onOpenChange={setMarketOpen}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="w-5 h-5 text-emerald-600" /> Marketplace
          </DialogTitle>
          <DialogDescription>
            Nijer bana app share korun ba bikri korun — onnoder app ek click e install korun.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="browse" className="gap-1"><Sparkles className="w-3.5 h-3.5" /> Browse</TabsTrigger>
            <TabsTrigger value="publish" className="gap-1"><Upload className="w-3.5 h-3.5" /> Publish</TabsTrigger>
            <TabsTrigger value="mine" className="gap-1"><PackageOpen className="w-3.5 h-3.5" /> Mine</TabsTrigger>
          </TabsList>

          <TabsContent value="browse" className="mt-3 flex-1 min-h-0 flex flex-col">
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input placeholder="Search apps…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 h-9" />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              <button onClick={() => setCat('')} className={`text-xs px-2.5 py-1 rounded-full border ${!cat ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>All</button>
              {CATS.map((c) => (
                <button key={c} onClick={() => setCat(c === cat ? '' : c)} className={`text-xs px-2.5 py-1 rounded-full border capitalize ${cat === c ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{c}</button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto max-h-[46vh] space-y-2 pr-1">
              {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
              {!loading && listings.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">Ekhono kono app nei — prothom publisher hoen!</p>
              )}
              {listings.map((l) => (
                <div key={l.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                    {l.thumbSvg
                      ? <span className="w-full h-full [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: l.thumbSvg }} />
                      : <Store className="w-5 h-5 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm truncate">{l.title}</span>
                      <Badge variant="outline" className="text-[10px] capitalize">{l.category}</Badge>
                      {l.priceInr > 0
                        ? <Badge className="text-[10px] bg-amber-500/15 text-amber-700 border-0 gap-0.5"><IndianRupee className="w-2.5 h-2.5" />{l.priceInr}</Badge>
                        : <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 border-0">Free</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{l.description || '—'}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                      <Users className="w-3 h-3" /> {l.installs} installs · {l.fileCount} files · {fmt(l.sizeBytes)} · by {l.sellerName}
                    </p>
                  </div>
                  <Button size="sm" className="shrink-0" disabled={installing === l.id} onClick={() => install(l)}>
                    {installing === l.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />}
                    Install
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="publish" className="mt-3 space-y-3">
            {!activeProject ? (
              <p className="text-sm text-muted-foreground text-center py-8">Age ekta project khulo, tahole seta publish korte parben.</p>
            ) : (
              <>
                <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                  Publishing: <b>{activeProject.name}</b> — pura project er ekta snapshot jabe (node_modules/build output bad).
                </div>
                <div>
                  <label className="text-xs font-medium">Title</label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="My Awesome App" className="mt-1" />
                </div>
                <div>
                  <label className="text-xs font-medium">Description</label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ei app ki kore, kake kajbe…" className="mt-1" />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs font-medium">Category</label>
                    <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full h-9 rounded-md border bg-background px-2 text-sm">
                      {CATS.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
                    </select>
                  </div>
                  <div className="w-32">
                    <label className="text-xs font-medium">Price (₹, 0 = free)</label>
                    <Input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1" />
                  </div>
                </div>
                {Number(price) > 0 && (
                  <p className="text-xs text-amber-600">Paid listing: install pete hobe payment — Razorpay keys connected na thakle buyer ke honest 402 message jabe.</p>
                )}
                <Button className="w-full" onClick={publish} disabled={publishing}>
                  {publishing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                  Publish to Marketplace
                </Button>
              </>
            )}
          </TabsContent>

          <TabsContent value="mine" className="mt-3 flex-1 min-h-0 overflow-y-auto max-h-[52vh] space-y-2">
            {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
            {!loading && listings.length === 0 && <p className="text-center text-sm text-muted-foreground py-8">Apnar kono listing nei — Publish tab theke shuru korun.</p>}
            {listings.map((l) => (
              <div key={l.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{l.title}</span>
                    {l.priceInr > 0 ? <Badge className="text-[10px] bg-amber-500/15 text-amber-700 border-0">₹{l.priceInr}</Badge> : <Badge className="text-[10px] bg-emerald-500/15 text-emerald-700 border-0">Free</Badge>}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{l.installs} installs · {l.fileCount} files</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => unpublish(l)}><Trash2 className="w-3.5 h-3.5 mr-1" /> Remove</Button>
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
