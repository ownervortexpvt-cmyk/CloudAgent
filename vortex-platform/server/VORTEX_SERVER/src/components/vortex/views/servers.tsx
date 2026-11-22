"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import {
  Cpu,
  HardDrive,
  Loader2,
  MemoryStick,
  Play,
  Plus,
  Power,
  ServerCog,
  Square,
  Trash2,
} from "lucide-react";
import { api, type AppRow, type ServerNodeRow, fmtDate } from "../client";

const NODE_STATUS: Record<string, string> = {
  RUNNING: "border-emerald-500/40 text-emerald-400",
  PROVISIONING: "border-violet-500/40 text-violet-300",
  STOPPED: "border-zinc-500/40 text-zinc-400",
  DESTROYED: "border-red-500/40 text-red-400",
  ERROR: "border-red-500/40 text-red-400",
};

export default function ServersView({ onChanged }: { onChanged: () => void }) {
  const nodesQuery = useQuery({
    queryKey: ["servers"],
    queryFn: () => api<{ nodes: ServerNodeRow[] }>("/api/v1/servers"),
    refetchInterval: 10_000, // watch PROVISIONING → RUNNING transitions
  });
  const appsQuery = useQuery({
    queryKey: ["apps"],
    queryFn: () => api<{ apps: AppRow[] }>("/api/v1/apps"),
  });

  const nodes = nodesQuery.data?.ok ? nodesQuery.data.data?.nodes ?? null : null;
  const apps = appsQuery.data?.ok ? appsQuery.data.data?.apps ?? [] : [];
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = () => {
    nodesQuery.refetch();
    onChanged();
  };

  async function lifecycle(n: ServerNodeRow, target: "RUNNING" | "STOPPED" | "DESTROYED") {
    setBusyId(n.id);
    const res = await api("/api/v1/servers", { method: "PATCH", body: { id: n.id, status: target } });
    setBusyId(null);
    if (!res.ok) {
      toast({ title: "Operation failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title:
        target === "RUNNING" ? `${n.name} started` : target === "STOPPED" ? `${n.name} stopped` : `${n.name} destroyed`,
      description: target === "DESTROYED" ? "IP released back to the pool" : undefined,
    });
    reload();
  }

  const running = nodes?.filter((n) => n.status === "RUNNING") ?? [];
  const totalCpu = running.reduce((a, n) => a + n.cpuCores, 0);
  const totalRamGb = (running.reduce((a, n) => a + n.ramMb, 0) / 1024).toFixed(1);
  const totalDiskGb = running.reduce((a, n) => a + n.diskGb, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Servers</h3>
          <p className="text-sm text-muted-foreground">
            SERVER module — provision runtime nodes for your apps. New nodes pull a free IP from NETWORK automatically.
          </p>
        </div>
        <ProvisionDialog apps={apps} onCreated={reload} />
      </div>

      {/* Fleet stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <ServerCog className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">RUNNING NODES</p>
              <p className="text-lg font-bold">
                {running.length}
                <span className="text-sm text-muted-foreground font-normal"> / {nodes?.length ?? 0}</span>
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Cpu className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">vCPU ALLOCATED</p>
              <p className="text-lg font-bold">{totalCpu}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <MemoryStick className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">RAM / DISK (RUNNING)</p>
              <p className="text-lg font-bold">
                {totalRamGb} GB <span className="text-sm text-muted-foreground font-normal">/ {totalDiskGb} GB</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {!nodes && (
        <div className="grid gap-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      <div className="grid gap-3">
        {nodes?.map((n) => (
          <Card key={n.id} className={n.status === "DESTROYED" ? "opacity-50" : ""}>
            <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{n.name}</span>
                  <Badge variant="outline" className={`text-[10px] ${NODE_STATUS[n.status] || ""}`}>
                    {n.status === "PROVISIONING" && (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    )}
                    {n.status}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {n.role.replace(/_/g, " ")}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {n.hostType.replace(/_/g, " ")}
                  </Badge>
                  {n.app && (
                    <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                      {n.app.name}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  {n.nodeId} · {n.ipAddress || "no IP"} · {n.cpuCores} vCPU · {(n.ramMb / 1024).toFixed(1)} GB RAM ·{" "}
                  {n.diskGb} GB disk · {n.osImage}
                </p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                  {n.region} · provisioned by {n.provisionedBy || "—"} · up since {fmtDate(n.uptimeSince)}
                </p>
              </div>
              {n.status !== "DESTROYED" && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {n.status === "RUNNING" && (
                    <Button size="sm" variant="outline" disabled={busyId === n.id} onClick={() => lifecycle(n, "STOPPED")}>
                      <Square className="w-3.5 h-3.5 mr-1.5" /> Stop
                    </Button>
                  )}
                  {(n.status === "STOPPED" || n.status === "PROVISIONING") && (
                    <Button size="sm" variant="outline" disabled={busyId === n.id || n.status === "PROVISIONING"} onClick={() => lifecycle(n, "RUNNING")}>
                      <Play className="w-3.5 h-3.5 mr-1.5" /> Start
                    </Button>
                  )}
                  {n.role !== "CONTROL_PLANE" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-red-500/40 text-red-400 hover:bg-red-500/10"
                      disabled={busyId === n.id}
                      onClick={() => lifecycle(n, "DESTROYED")}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Destroy
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ProvisionDialog({ apps, onCreated }: { apps: AppRow[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    role: "APP_RUNTIME",
    hostType: "KVM",
    cpuCores: "2",
    ramGb: "2",
    diskGb: "40",
    appId: "none",
    allocateIp: true,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await api("/api/v1/servers", {
      method: "POST",
      body: {
        name: form.name,
        role: form.role,
        hostType: form.hostType,
        cpuCores: parseInt(form.cpuCores, 10),
        ramMb: Math.round(parseFloat(form.ramGb || "1") * 1024),
        diskGb: parseInt(form.diskGb, 10),
        appId: form.appId === "none" ? null : form.appId,
        allocateIp: form.allocateIp,
      },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Provision failed", description: res.error, variant: "destructive" });
      return;
    }
    const node = (res.data as { node?: { ipAddress?: string | null } }).node;
    toast({
      title: `Node ${form.name} provisioning`,
      description: node?.ipAddress ? `IP ${node.ipAddress} allocated from NETWORK pool` : "Booting without auto-IP",
    });
    setOpen(false);
    setForm({ name: "", role: "APP_RUNTIME", hostType: "KVM", cpuCores: "2", ramGb: "2", diskGb: "40", appId: "none", allocateIp: true });
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" /> Provision node
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto vortex-scroll">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ServerCog className="w-4 h-4 text-primary" /> Provision a server node
            </DialogTitle>
            <DialogDescription>
              SERVER module boots the node and NETWORK auto-assigns a free private IP.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="node-name">Node name</Label>
              <Input
                id="node-name"
                placeholder="e.g. flarex-app-01"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger aria-label="Role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="APP_RUNTIME">APP_RUNTIME</SelectItem>
                    <SelectItem value="GATEWAY">GATEWAY</SelectItem>
                    <SelectItem value="DATABASE">DATABASE</SelectItem>
                    <SelectItem value="STORAGE">STORAGE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.hostType} onValueChange={(v) => setForm({ ...form, hostType: v })}>
                  <SelectTrigger aria-label="Host type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="KVM">KVM (VM)</SelectItem>
                    <SelectItem value="CONTAINER">CONTAINER</SelectItem>
                    <SelectItem value="BARE_METAL">BARE_METAL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="node-cpu">vCPU</Label>
                <Input
                  id="node-cpu"
                  type="number"
                  min={1}
                  max={64}
                  value={form.cpuCores}
                  onChange={(e) => setForm({ ...form, cpuCores: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="node-ram">RAM (GB)</Label>
                <Input
                  id="node-ram"
                  type="number"
                  min={0.25}
                  step={0.25}
                  value={form.ramGb}
                  onChange={(e) => setForm({ ...form, ramGb: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="node-disk">Disk (GB)</Label>
                <Input
                  id="node-disk"
                  type="number"
                  min={10}
                  value={form.diskGb}
                  onChange={(e) => setForm({ ...form, diskGb: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Attach to app</Label>
              <Select value={form.appId} onValueChange={(v) => setForm({ ...form, appId: v })}>
                <SelectTrigger aria-label="Attach to app">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Shared / none —</SelectItem>
                  {apps.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-2 text-sm">
                <HardDrive className="w-4 h-4 text-primary" />
                Auto-assign private IP
              </div>
              <Switch
                checked={form.allocateIp}
                onCheckedChange={(v) => setForm({ ...form, allocateIp: v })}
                aria-label="Auto-assign private IP"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Power className="w-4 h-4 mr-2" />}
              Provision
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
