"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Globe, Loader2, Plus, Trash2, Wind, Pause, Play, Gauge, Zap } from "lucide-react";
import { api, fmtAgo, fmtSize, type CdnState } from "../client";

export default function CdnView({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["cdn"],
    queryFn: () => api<CdnState>("/api/v1/cdn"),
    refetchInterval: 15_000,
  });
  const data = q.data?.ok ? q.data.data : null;

  const reload = () => {
    q.refetch();
    onChanged();
  };

  async function post(body: Record<string, unknown>, okTitle: string) {
    const res = await api("/api/v1/cdn", { method: "POST", body });
    if (res.ok) {
      toast({ title: okTitle });
      reload();
    } else {
      toast({ title: "Action failed", description: res.error, variant: "destructive" });
    }
  }

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">CDN — edge cache in front of STORAGE</h3>
        <p className="text-sm text-muted-foreground">
          Locked design: Cloudflare FREE TIER sits in front of the storage edge — zero cost, no vendor
          lock-in, no AGPL. One distribution maps one bucket to one edge domain; hit accounting advances
          from the bucket&apos;s real object count on every poll.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Distributions</p>
              <Globe className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">
              {data.stats.active}
              <span className="text-sm text-muted-foreground font-normal">/{data.stats.total}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">active on the dhaka-1 edge</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Cache hit rate</p>
              <Gauge className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">{data.stats.hitRate}%</p>
            <Progress value={data.stats.hitRate} className="h-2 mt-2" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Hits / misses</p>
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">{data.stats.hits.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">{data.stats.misses.toLocaleString()} origin fetches</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Edge egress</p>
            <p className="text-2xl font-bold mt-2">{fmtSize(data.stats.bandwidthMb)}</p>
            <p className="text-xs text-muted-foreground mt-1">served from cache, not origin</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h4 className="font-semibold">Distributions</h4>
            <NewDistDialog buckets={data.buckets} onCreate={(b) => post({ op: "create", ...b }, "Distribution created — edge warming up")} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {data.distributions.length === 0 && (
              <p className="text-sm text-muted-foreground">No distributions yet — put a bucket on the edge.</p>
            )}
            {data.distributions.map((d) => {
              const total = d.cacheHits + d.cacheMisses;
              const rate = total > 0 ? Math.round((d.cacheHits / total) * 100) : 0;
              return (
                <div key={d.id} className="rounded-lg border border-border/60 p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{d.name}</p>
                      <p className="text-xs text-primary font-mono truncate">{d.domain}</p>
                    </div>
                    <Badge variant="outline" className={d.status === "ACTIVE" ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-400"}>
                      {d.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Bucket</p>
                      <p className="font-mono truncate">{d.bucket.name}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">TTL</p>
                      <p className="font-mono">{d.defaultTtlSec}s</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Edge</p>
                      <p className="font-mono">{d.edgeRegion}</p>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">
                        {d.cacheHits.toLocaleString()} hits · {d.cacheMisses.toLocaleString()} misses · {fmtSize(d.bandwidthMb)} egress
                      </span>
                      <span>{rate}%</span>
                    </div>
                    <Progress value={rate} className="h-1.5" />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-[10px] text-muted-foreground">
                      {d.purgedAt ? `purged ${fmtAgo(d.purgedAt)}` : "never purged"}
                      {d.app ? ` · ${d.app.name}` : ""}
                    </p>
                    <div className="flex gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => post({ op: "purge", distId: d.distId }, "Edge cache purged")}>
                        <Wind className="w-3.5 h-3.5 mr-1" /> Purge
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => post({ op: d.status === "ACTIVE" ? "pause" : "resume", distId: d.distId }, d.status === "ACTIVE" ? "Distribution paused" : "Distribution resumed")}
                      >
                        {d.status === "ACTIVE" ? <Pause className="w-3.5 h-3.5 mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
                        {d.status === "ACTIVE" ? "Pause" : "Resume"}
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`Delete ${d.name}`} onClick={() => post({ op: "delete", distId: d.distId }, "Distribution deleted")}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NewDistDialog({ buckets, onCreate }: { buckets: CdnState["buckets"]; onCreate: (b: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [bucketId, setBucketId] = useState("");
  const [domain, setDomain] = useState("");
  const [ttl, setTtl] = useState("300");
  const [busy, setBusy] = useState(false);

  const selected = buckets.find((b) => b.id === bucketId);
  const autoDomain = `${(name || "dist").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "")}.cdn.vortex.internal`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-3.5 h-3.5 mr-1" /> New distribution
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Put a bucket on the edge</DialogTitle>
          <DialogDescription>One bucket, one edge domain, free-tier design. TTL rules and purge included.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dist-name">Name</Label>
            <Input id="dist-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Store assets edge" />
          </div>
          <div className="space-y-1.5">
            <Label>Bucket</Label>
            <Select value={bucketId} onValueChange={setBucketId}>
              <SelectTrigger aria-label="Bucket">
                <SelectValue placeholder="pick a bucket" />
              </SelectTrigger>
              <SelectContent>
                {buckets.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} ({b.objectCount} objects)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dist-domain">Edge domain</Label>
            <Input id="dist-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder={autoDomain} />
            <p className="text-[10px] text-muted-foreground">leave empty to use {autoDomain}</p>
          </div>
          <div className="space-y-1.5">
            <Label>Default TTL</Label>
            <Select value={ttl} onValueChange={setTtl}>
              <SelectTrigger aria-label="TTL">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="60">60s — feed-style, always fresh</SelectItem>
                <SelectItem value="300">300s — default</SelectItem>
                <SelectItem value="3600">1h — static assets</SelectItem>
                <SelectItem value="86400">24h — immutable builds</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {selected && (
            <p className="text-xs text-muted-foreground">
              Origin: bucket <span className="font-mono text-primary">{selected.name}</span> with {selected.objectCount} objects.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !name.trim() || !bucketId}
            onClick={async () => {
              setBusy(true);
              await onCreate({ name, bucketId, domain: domain || undefined, defaultTtlSec: Number(ttl) });
              setBusy(false);
              setOpen(false);
              setName("");
              setBucketId("");
              setDomain("");
            }}
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create distribution
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
