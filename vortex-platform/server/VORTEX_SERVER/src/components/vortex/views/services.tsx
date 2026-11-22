"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Loader2, Plus, Radio, Server } from "lucide-react";
import { api, type Service, fmtDate } from "../client";

const STATUS_STYLES: Record<string, string> = {
  ONLINE: "border-emerald-500/40 text-emerald-400",
  OFFLINE: "border-red-500/40 text-red-400",
  DEGRADED: "border-amber-500/40 text-amber-400",
  BUILDING: "border-violet-500/40 text-violet-300",
  PLANNED: "border-zinc-500/40 text-zinc-400",
  RESERVED: "border-amber-600/40 text-amber-500",
};

export default function ServicesView({ onChanged }: { onChanged: () => void }) {
  const servicesQuery = useQuery({
    queryKey: ["services"],
    queryFn: () => api<{ services: Service[] }>("/api/v1/services"),
  });
  const services = servicesQuery.data?.ok ? servicesQuery.data.data?.services ?? null : null;
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const reload = () => {
    servicesQuery.refetch();
    onChanged();
  };

  async function sendHeartbeat(s: Service) {
    setBusyKey(s.id);
    const res = await api("/api/v1/services/heartbeat", {
      method: "POST",
      body: { serviceKey: s.serviceKey },
    });
    setBusyKey(null);
    if (!res.ok) {
      toast({ title: "Heartbeat rejected", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${s.name} is alive`, description: "Heartbeat recorded — status ONLINE" });
    reload();
  }

  async function setStatus(s: Service, status: string) {
    setBusyKey(s.id);
    const res = await api("/api/v1/services", {
      method: "PATCH",
      body: { id: s.id, status },
    });
    setBusyKey(null);
    if (!res.ok) {
      toast({ title: "Update failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${s.name} → ${status}` });
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Service Registry</h3>
          <p className="text-sm text-muted-foreground">
            Every VORTEX module registers here. CORE tracks status, endpoint and heartbeats.
          </p>
        </div>
        <RegisterDialog onCreated={reload} />
      </div>

      {!services && (
        <div className="grid gap-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )}

      <div className="grid gap-3">
        {services?.map((s) => (
          <Card key={s.id} className={s.status === "RESERVED" ? "opacity-70" : ""}>
            <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[s.status] || ""}`}>
                    {s.status}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    Phase {s.phase}
                  </Badge>
                  {s.version && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      v{s.version}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
                <p className="text-[11px] text-muted-foreground/70 mt-1 font-mono">
                  {s.endpoint || "no endpoint"} · last heartbeat {fmtDate(s.lastHeartbeat)}
                </p>
              </div>
              {s.status !== "RESERVED" && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Select value={s.status} onValueChange={(v) => setStatus(s, v)}>
                    <SelectTrigger className="w-[130px] h-8 text-xs" aria-label={`Status for ${s.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ONLINE">ONLINE</SelectItem>
                      <SelectItem value="BUILDING">BUILDING</SelectItem>
                      <SelectItem value="PLANNED">PLANNED</SelectItem>
                      <SelectItem value="OFFLINE">OFFLINE</SelectItem>
                      <SelectItem value="DEGRADED">DEGRADED</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyKey === s.id}
                    onClick={() => sendHeartbeat(s)}
                  >
                    {busyKey === s.id ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Radio className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Heartbeat
                  </Button>
                </div>
              )}
              {s.status === "RESERVED" && (
                <Badge variant="outline" className="border-amber-600/40 text-amber-500 shrink-0">
                  Locked until Phase 7
                </Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RegisterDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", serviceKey: "", description: "", phase: "6", endpoint: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await api("/api/v1/services", {
      method: "POST",
      body: {
        name: form.name,
        serviceKey: form.serviceKey || form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        description: form.description,
        phase: parseInt(form.phase, 10),
        endpoint: form.endpoint,
      },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Could not register", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Service registered", description: `${form.name} joined the registry` });
    setOpen(false);
    setForm({ name: "", serviceKey: "", description: "", phase: "6", endpoint: "" });
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="w-4 h-4 mr-2" /> Register service
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Server className="w-4 h-4 text-primary" /> Register a module
            </DialogTitle>
            <DialogDescription>
              Add a new VORTEX module to the registry. It can then send heartbeats to CORE.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="svc-name">Name</Label>
              <Input
                id="svc-name"
                placeholder="e.g. SEARCH"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="svc-key">Service key (unique)</Label>
              <Input
                id="svc-key"
                placeholder="search"
                value={form.serviceKey}
                onChange={(e) => setForm({ ...form, serviceKey: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="svc-desc">Description</Label>
              <Textarea
                id="svc-desc"
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Target phase</Label>
                <Select value={form.phase} onValueChange={(v) => setForm({ ...form, phase: v })}>
                  <SelectTrigger aria-label="Target phase">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7].map((p) => (
                      <SelectItem key={p} value={String(p)}>
                        Phase {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="svc-endpoint">Endpoint (optional)</Label>
                <Input
                  id="svc-endpoint"
                  placeholder="/api/v1/..."
                  value={form.endpoint}
                  onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Register
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
