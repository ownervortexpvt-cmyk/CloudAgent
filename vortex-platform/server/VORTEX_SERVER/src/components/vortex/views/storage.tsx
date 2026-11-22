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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Boxes, Database as DbIcon, HardDrive, Loader2, Plus, Server, Trash2 } from "lucide-react";
import { api, fmtSize, type AppRow, type BucketRow, type VolumeRow } from "../client";

const CLASS_STYLE: Record<string, string> = {
  HOT: "border-rose-500/40 text-rose-300",
  WARM: "border-amber-500/40 text-amber-400",
  COLD: "border-sky-500/40 text-sky-400",
};

const VOL_STATUS: Record<string, string> = {
  READ_WRITE: "border-emerald-500/40 text-emerald-400",
  READ_ONLY: "border-amber-500/40 text-amber-400",
  OFFLINE: "border-red-500/40 text-red-400",
};

export default function StorageView({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Storage</h3>
        <p className="text-sm text-muted-foreground">
          Object storage engine — SeaweedFS design (Apache-2.0, never AGPL). Volumes hold buckets; every object keeps{" "}
          <span className="text-foreground">3 copies</span> (locked permanent-storage design), every bucket is bound to
          one app (data gravity) with its own quota. Real bytes land on the storage node.
        </p>
      </div>

      <Tabs defaultValue="buckets" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="buckets" className="gap-2">
            <Boxes className="w-4 h-4" /> Buckets
          </TabsTrigger>
          <TabsTrigger value="volumes" className="gap-2">
            <HardDrive className="w-4 h-4" /> Volumes
          </TabsTrigger>
        </TabsList>
        <TabsContent value="buckets" className="mt-4">
          <BucketsTab onChanged={onChanged} />
        </TabsContent>
        <TabsContent value="volumes" className="mt-4">
          <VolumesTab onChanged={onChanged} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function useStorage() {
  return useQuery({
    queryKey: ["storage"],
    queryFn: () =>
      api<{ buckets: BucketRow[]; volumes: VolumeRow[]; stats: { buckets: number; objects: number; usedMb: number; quotaMb: number; replication: number } }>(
        "/api/v1/storage"
      ),
    refetchInterval: 15_000,
  });
}

/* ---------------- BUCKETS ---------------- */

function BucketsTab({ onChanged }: { onChanged: () => void }) {
  const q = useStorage();
  const data = q.data?.ok ? q.data.data ?? null : null;

  const reload = () => {
    q.refetch();
    onChanged();
  };

  const s = data?.stats;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Buckets" value={s ? `${s.buckets}` : "…"} hint="one app per bucket" />
        <StatTile label="Objects" value={s ? `${s.objects}` : "…"} hint="active + archived" />
        <StatTile label="Used" value={s ? fmtSize(s.usedMb) : "…"} hint={s ? `of ${fmtSize(s.quotaMb)} quota` : ""} />
        <StatTile label="Replication" value={s ? `${s.replication}x` : "…"} hint="copies per object" />
      </div>

      <div className="flex justify-end">
        <CreateBucketDialog onCreated={reload} />
      </div>

      {!data && <Skeleton className="h-72 rounded-xl" />}

      {data && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[32rem] overflow-y-auto vortex-scroll">
              {data.buckets.length === 0 && (
                <p className="text-sm text-muted-foreground p-6 text-center">No buckets yet — create the first one.</p>
              )}
              {data.buckets.map((b) => (
                <BucketRow key={b.id} bucket={b} onChanged={reload} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[10px] text-muted-foreground tracking-wide uppercase">{label}</p>
        <p className="text-lg font-bold mt-1">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{hint}</p>
      </CardContent>
    </Card>
  );
}

function BucketRow({ bucket, onChanged }: { bucket: BucketRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const pct = Math.min(100, Math.round((bucket.usedMb / bucket.quotaMb) * 100));

  async function patch(kind: string, value: string | number, msg: string) {
    setBusy(true);
    const res = await api("/api/v1/storage", { method: "PATCH", body: { id: bucket.id, kind, value } });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: msg });
    onChanged();
  }

  async function remove() {
    setBusy(true);
    const res = await api(`/api/v1/storage?id=${encodeURIComponent(bucket.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `Bucket ${bucket.name} deleted` });
    onChanged();
  }

  return (
    <div className="flex flex-col xl:flex-row xl:items-center gap-2 xl:gap-3 px-4 py-3 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Boxes className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm truncate">{bucket.name}</span>
        <Badge variant="outline" className={`text-[10px] ${CLASS_STYLE[bucket.storageClass] || ""}`}>
          {bucket.storageClass}
        </Badge>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">{bucket.replicationFactor}x</Badge>
        {bucket.status !== "ACTIVE" && (
          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">{bucket.status}</Badge>
        )}
      </div>
      <div className="flex-1 min-w-0 text-xs text-muted-foreground">
        <span className="text-foreground">{bucket.app?.name || "unbound"}</span>
        <span className="opacity-70">
          {" "}· {bucket.volume?.name || "no volume"} · {bucket.objectCount} objects · {bucket.bucketId}
        </span>
        <div className="flex items-center gap-2 mt-1">
          <Progress value={pct} className="h-1.5 w-40" />
          <span className="whitespace-nowrap">
            {fmtSize(bucket.usedMb)} / {fmtSize(bucket.quotaMb)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Select value={String(bucket.quotaMb)} onValueChange={(v) => patch("QUOTA", parseInt(v), `${bucket.name} quota → ${fmtSize(parseInt(v))}`)}>
          <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[256, 512, 1024, 2048, 5120, 10240, 20480, 51200].map((mb) => (
              <SelectItem key={mb} value={String(mb)}>{fmtSize(mb)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            patch("STATUS", bucket.status === "READ_ONLY" ? "ACTIVE" : "READ_ONLY", bucket.status === "READ_ONLY" ? `${bucket.name} writable` : `${bucket.name} set READ_ONLY`)
          }
        >
          {bucket.status === "READ_ONLY" ? "Unlock" : "Lock"}
        </Button>
        <Button size="sm" variant="ghost" className="text-red-400" disabled={busy || bucket.objectCount > 0} onClick={remove}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function CreateBucketDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [appId, setAppId] = useState("");
  const [quotaMb, setQuotaMb] = useState("1024");
  const [storageClass, setStorageClass] = useState("HOT");

  const appsQuery = useQuery({
    queryKey: ["apps"],
    queryFn: () => api<{ apps: AppRow[] }>("/api/v1/apps"),
    enabled: open,
  });
  const apps = appsQuery.data?.ok ? appsQuery.data.data?.apps ?? [] : [];

  async function create() {
    setBusy(true);
    const res = await api("/api/v1/storage", {
      method: "POST",
      body: { name, appId, quotaMb: parseInt(quotaMb) || 1024, storageClass },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Bucket creation failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `Bucket ${name} created — 3x replication, app-bound` });
    setOpen(false);
    setName("");
    setAppId("");
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-1" /> New bucket
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New storage bucket</DialogTitle>
          <DialogDescription>
            Lands on the READ_WRITE volume with the most headroom. Data gravity: the app binding is mandatory.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="bkt-name">Bucket name</Label>
            <Input id="bkt-name" placeholder="e.g. flarex-uploads" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>App</Label>
            <Select value={appId} onValueChange={setAppId}>
              <SelectTrigger><SelectValue placeholder="Select app" /></SelectTrigger>
              <SelectContent>
                {apps.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Quota</Label>
              <Select value={quotaMb} onValueChange={setQuotaMb}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[256, 512, 1024, 2048, 5120, 10240, 20480, 51200].map((mb) => (
                    <SelectItem key={mb} value={String(mb)}>{fmtSize(mb)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Storage class</Label>
              <Select value={storageClass} onValueChange={setStorageClass}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOT">HOT — instant reads</SelectItem>
                  <SelectItem value="WARM">WARM — frequent archive</SelectItem>
                  <SelectItem value="COLD">COLD — deep archive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={busy || !name || !appId} onClick={create}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create bucket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- VOLUMES ---------------- */

function VolumesTab({ onChanged }: { onChanged: () => void }) {
  const q = useStorage();
  const volumes = q.data?.ok ? q.data.data?.volumes ?? null : null;

  const reload = () => {
    q.refetch();
    onChanged();
  };

  async function patchStatus(id: string, status: string, name: string) {
    const res = await api("/api/v1/storage", { method: "PATCH", body: { id, kind: "VOLUME_STATUS", value: status } });
    if (!res.ok) {
      toast({ title: "Volume update failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${name} → ${status}` });
    reload();
  }

  return (
    <div className="space-y-3">
      {!volumes && <Skeleton className="h-56 rounded-xl" />}
      {volumes && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[26rem] overflow-y-auto vortex-scroll">
              {volumes.map((v) => (
                <div key={v.id} className="flex flex-col xl:flex-row xl:items-center gap-2 xl:gap-3 px-4 py-3 border-b border-border/40 last:border-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <HardDrive className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm">{v.name}</span>
                    <Badge variant="outline" className={`text-[10px] ${VOL_STATUS[v.status] || ""}`}>{v.status}</Badge>
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">{v.replicationFactor}x replicas</Badge>
                  </div>
                  <div className="flex-1 min-w-0 text-xs text-muted-foreground">
                    <Server className="w-3 h-3 inline mr-1" />
                    <span className="text-foreground">{v.node?.name || "unassigned"}</span>
                    <span className="opacity-70">
                      {" "}· {v.region} · {fmtSize(v.usedMb)} used / {v.capacityGb} GB · {v.bucketCount} buckets · {v.volumeId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Select value={v.status} onValueChange={(s) => patchStatus(v.id, s, v.name)}>
                      <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="READ_WRITE">READ_WRITE</SelectItem>
                        <SelectItem value="READ_ONLY">READ_ONLY</SelectItem>
                        <SelectItem value="OFFLINE">OFFLINE</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      <Card className="border-primary/20">
        <CardContent className="p-4 flex items-start gap-3">
          <DbIcon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Volume layout mirrors SeaweedFS volume servers. New buckets land on the READ_WRITE volume with the most
            free space; a volume holding buckets cannot go OFFLINE. Backups replicate snapshots to the third tier
            (offsite) independently of this cluster.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
