"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Boxes, Loader2, Plus, Play, Square, RotateCw, Trash2, Cpu, MemoryStick, RefreshCw } from "lucide-react";
import { api, fmtAgo, type ComputeState } from "../client";

const STATUS_CLASS: Record<string, string> = {
  RUNNING: "border-emerald-500/40 text-emerald-400",
  PROVISIONING: "border-sky-500/40 text-sky-400",
  STOPPED: "border-amber-500/40 text-amber-400",
  CRASHED: "border-red-500/40 text-red-400",
  DESTROYED: "border-border text-muted-foreground",
};

export default function ComputeView({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["compute"],
    queryFn: () => api<ComputeState>("/api/v1/compute"),
    refetchInterval: 10_000,
  });
  const data = q.data?.ok ? q.data.data : null;

  const reload = () => {
    q.refetch();
    onChanged();
  };

  async function post(body: Record<string, unknown>, okTitle: string) {
    const res = await api("/api/v1/compute", { method: "POST", body });
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
        <h3 className="font-semibold">COMPUTE — runtime workloads</h3>
        <p className="text-sm text-muted-foreground">
          DEPLOY ships a build once; COMPUTE owns the long-running containers, functions and cron jobs
          that keep the apps alive — scheduled onto APP_RUNTIME nodes with CPU/RAM guarantees
          (KVM/libvirt design) and a ram-fit scheduler.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Running</p>
              <Boxes className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">
              {data.stats.running}
              <span className="text-sm text-muted-foreground font-normal">/{data.stats.total}</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">{data.stats.stopped} stopped or crashed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">CPU reserved</p>
              <Cpu className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">{(data.stats.cpuMilli / 1000).toFixed(1)} cores</p>
            <p className="text-xs text-muted-foreground mt-1">guaranteed millicores</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">RAM reserved</p>
              <MemoryStick className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">{(data.stats.ramMb / 1024).toFixed(1)} GB</p>
            <p className="text-xs text-muted-foreground mt-1">across {data.nodes.length} runtime node{data.nodes.length === 1 ? "" : "s"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Quota per app</p>
            <p className="text-2xl font-bold mt-2">{data.quotaPerApp}</p>
            <p className="text-xs text-muted-foreground mt-1">workloads max, ADMIN quota groundwork</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h4 className="font-semibold">Workloads</h4>
            <NewWorkloadDialog apps={data.workloads.map((w) => w.app).filter((a): a is NonNullable<typeof a> => !!a).filter((a, i, arr) => arr.findIndex((x) => x.appId === a.appId) === i)} onCreate={(b) => post({ op: "create", ...b }, "Workload provisioning — live in a few seconds")} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {data.workloads.map((w) => (
              <div key={w.id} className="rounded-lg border border-border/60 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-mono font-medium truncate">{w.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{w.image}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">{w.kind}</Badge>
                    <Badge variant="outline" className={`text-[10px] ${STATUS_CLASS[w.status] || ""}`}>
                      {w.status === "PROVISIONING" && <RefreshCw className="w-2.5 h-2.5 mr-1 animate-spin inline" />}
                      {w.status}
                    </Badge>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">App</p>
                    <p className="truncate">{w.app?.name || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Node</p>
                    <p className="truncate font-mono">{w.node?.name || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">CPU</p>
                    <p className="font-mono">{w.cpuMilli}m</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">RAM</p>
                    <p className="font-mono">{w.ramMb} MB</p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <p className="text-[10px] text-muted-foreground">
                    {w.startedAt ? `up since ${fmtAgo(w.startedAt)}` : "not running"}
                    {w.restartCount > 0 ? ` · ${w.restartCount} restarts` : ""}
                  </p>
                  <div className="flex gap-1.5">
                    {w.status !== "RUNNING" && w.status !== "PROVISIONING" && w.status !== "DESTROYED" && (
                      <Button variant="outline" size="sm" onClick={() => post({ op: "start", workloadId: w.workloadId }, "Workload starting")}>
                        <Play className="w-3.5 h-3.5 mr-1" /> Start
                      </Button>
                    )}
                    {w.status === "RUNNING" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => post({ op: "restart", workloadId: w.workloadId }, "Workload restarting")}>
                          <RotateCw className="w-3.5 h-3.5 mr-1" /> Restart
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => post({ op: "stop", workloadId: w.workloadId }, "Workload stopped")}>
                          <Square className="w-3.5 h-3.5 mr-1" /> Stop
                        </Button>
                      </>
                    )}
                    {w.status !== "DESTROYED" && (
                      <Button variant="ghost" size="icon" aria-label={`Destroy ${w.name}`} onClick={() => post({ op: "destroy", workloadId: w.workloadId }, "Workload destroyed")}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NewWorkloadDialog({
  apps,
  onCreate,
}: {
  apps: { name: string; appId: string }[];
  onCreate: (b: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [kind, setKind] = useState("CONTAINER");
  const [appId, setAppId] = useState<string>("none");
  const [cpu, setCpu] = useState("500");
  const [ram, setRam] = useState("512");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-3.5 h-3.5 mr-1" /> New workload
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule a workload</DialogTitle>
          <DialogDescription>The ram-fit scheduler picks the APP_RUNTIME node with the most free RAM.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="wl-name">Name</Label>
            <Input id="wl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="store-worker" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wl-image">Image (with tag)</Label>
            <Input id="wl-image" value={image} onChange={(e) => setImage(e.target.value)} placeholder="vortex/store-worker:1.0" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger aria-label="Workload kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CONTAINER">CONTAINER</SelectItem>
                  <SelectItem value="FUNCTION">FUNCTION</SelectItem>
                  <SelectItem value="CRON">CRON</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>App binding</Label>
              <Select value={appId} onValueChange={setAppId}>
                <SelectTrigger aria-label="App">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— unbound —</SelectItem>
                  {apps.map((a) => (
                    <SelectItem key={a.appId} value={a.appId}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="wl-cpu">CPU (millicores)</Label>
              <Input id="wl-cpu" type="number" min={100} max={4000} step={100} value={cpu} onChange={(e) => setCpu(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wl-ram">RAM (MB)</Label>
              <Input id="wl-ram" type="number" min={128} max={8192} step={128} value={ram} onChange={(e) => setRam(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !name.trim() || !image.includes(":")}
            onClick={async () => {
              setBusy(true);
              await onCreate({
                name,
                image,
                kind,
                appId: appId === "none" ? null : appId,
                cpuMilli: Number(cpu),
                ramMb: Number(ram),
              });
              setBusy(false);
              setOpen(false);
              setName("");
              setImage("");
            }}
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Schedule workload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
