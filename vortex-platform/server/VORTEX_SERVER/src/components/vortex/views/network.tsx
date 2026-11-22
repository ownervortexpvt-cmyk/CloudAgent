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
import {
  ArrowLeftRight,
  Globe,
  Loader2,
  Network as NetworkIcon,
  Plus,
  Shield,
  Trash2,
  Waypoints,
} from "lucide-react";
import { api, type DnsRow, type FirewallRow, type IpRow, type ZoneRow } from "../client";

const IP_STATUS: Record<string, string> = {
  FREE: "border-emerald-500/40 text-emerald-400",
  ASSIGNED: "border-violet-500/40 text-violet-300",
  RESERVED: "border-amber-500/40 text-amber-400",
};

export default function NetworkView({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Network</h3>
        <p className="text-sm text-muted-foreground">
          NETWORK module — private zones, IP pool, internal DNS and the firewall with a protected default-deny baseline.
        </p>
      </div>

      <Tabs defaultValue="ips" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="ips" className="gap-2">
            <Waypoints className="w-4 h-4" /> IP Pool
          </TabsTrigger>
          <TabsTrigger value="dns" className="gap-2">
            <Globe className="w-4 h-4" /> DNS
          </TabsTrigger>
          <TabsTrigger value="firewall" className="gap-2">
            <Shield className="w-4 h-4" /> Firewall
          </TabsTrigger>
          <TabsTrigger value="zones" className="gap-2">
            <NetworkIcon className="w-4 h-4" /> Zones
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ips" className="mt-4">
          <IpsTab onChanged={onChanged} />
        </TabsContent>
        <TabsContent value="dns" className="mt-4">
          <DnsTab onChanged={onChanged} />
        </TabsContent>
        <TabsContent value="firewall" className="mt-4">
          <FirewallTab onChanged={onChanged} />
        </TabsContent>
        <TabsContent value="zones" className="mt-4">
          <ZonesTab onChanged={onChanged} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- IP POOL ---------------- */

function IpsTab({ onChanged }: { onChanged: () => void }) {
  const ipsQuery = useQuery({
    queryKey: ["ips"],
    queryFn: () => api<{ ips: IpRow[] }>("/api/v1/network/ips"),
  });
  const zonesQuery = useQuery({
    queryKey: ["zones"],
    queryFn: () => api<{ zones: ZoneRow[] }>("/api/v1/network/zones"),
  });
  const ips = ipsQuery.data?.ok ? ipsQuery.data.data?.ips ?? null : null;
  const zones = zonesQuery.data?.ok ? zonesQuery.data.data?.zones ?? [] : [];
  const [assigning, setAssigning] = useState<IpRow | null>(null);
  const [assignTarget, setAssignTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = () => {
    ipsQuery.refetch();
    onChanged();
  };

  async function patchIp(action: "ASSIGN" | "RELEASE" | "RESERVE", ip: IpRow, target?: string) {
    setBusy(true);
    const res = await api("/api/v1/network/ips", {
      method: "PATCH",
      body: { id: ip.id, action, target },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: `${action} failed`, description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${ip.address} → ${action === "ASSIGN" ? `assigned to ${target}` : action.toLowerCase()}` });
    setAssigning(null);
    setAssignTarget("");
    reload();
  }

  async function removeIp(ip: IpRow) {
    setBusy(true);
    const res = await api(`/api/v1/network/ips?id=${encodeURIComponent(ip.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Remove failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${ip.address} removed from pool` });
    reload();
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <AddIpDialog zones={zones} onCreated={reload} />
      </div>

      {!ips && <Skeleton className="h-64 rounded-xl" />}

      {ips && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[30rem] overflow-y-auto vortex-scroll">
              {ips.map((ip) => (
                <div
                  key={ip.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 border-b border-border/40 last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <code className="font-mono text-sm text-primary">{ip.address}</code>
                    <Badge variant="outline" className={`text-[10px] ${IP_STATUS[ip.status] || ""}`}>
                      {ip.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      {ip.ipType}
                    </Badge>
                  </div>
                  <div className="flex-1 min-w-0 text-xs text-muted-foreground truncate">
                    {ip.assignedTo ? (
                      <span>
                        → <span className="text-foreground">{ip.assignedTo}</span>
                      </span>
                    ) : (
                      ip.note || "—"
                    )}
                    {ip.zone && <span className="ml-2 opacity-70">({ip.zone.name})</span>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {ip.status === "FREE" && (
                      <>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => { setAssigning(ip); setAssignTarget(""); }}>
                          <ArrowLeftRight className="w-3 h-3 mr-1" /> Assign
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => patchIp("RESERVE", ip)}>
                          Reserve
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-400" disabled={busy} onClick={() => removeIp(ip)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                    {(ip.status === "ASSIGNED" || ip.status === "RESERVED") && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => patchIp("RELEASE", ip)}>
                        Release
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!assigning} onOpenChange={(v) => !v && setAssigning(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign {assigning?.address}</DialogTitle>
            <DialogDescription>Bind this address to a node name or label.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="assign-target">Target</Label>
            <Input
              id="assign-target"
              placeholder="e.g. flarex-app-01"
              value={assignTarget}
              onChange={(e) => setAssignTarget(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={busy || !assignTarget.trim() || !assigning}
              onClick={() => assigning && patchIp("ASSIGN", assigning, assignTarget.trim())}
            >
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddIpDialog({ zones, onCreated }: { zones: ZoneRow[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ address: "", ipType: "PRIVATE", note: "", zoneId: "none" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await api("/api/v1/network/ips", {
      method: "POST",
      body: { ...form, zoneId: form.zoneId === "none" ? undefined : form.zoneId },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Could not add IP", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${form.address} added to pool` });
    setOpen(false);
    setForm({ address: "", ipType: "PRIVATE", note: "", zoneId: "none" });
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="w-4 h-4 mr-2" /> Add IP
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add address to pool</DialogTitle>
            <DialogDescription>Expand the private (or public) address pool.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="ip-addr">IPv4 address</Label>
              <Input
                id="ip-addr"
                placeholder="10.10.0.25"
                className="font-mono"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.ipType} onValueChange={(v) => setForm({ ...form, ipType: v })}>
                  <SelectTrigger aria-label="IP type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRIVATE">PRIVATE</SelectItem>
                    <SelectItem value="PUBLIC">PUBLIC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Zone</Label>
                <Select value={form.zoneId} onValueChange={(v) => setForm({ ...form, zoneId: v })}>
                  <SelectTrigger aria-label="Zone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— none —</SelectItem>
                    {zones.map((z) => (
                      <SelectItem key={z.id} value={z.id}>
                        {z.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ip-note">Note</Label>
              <Input id="ip-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- DNS ---------------- */

function DnsTab({ onChanged }: { onChanged: () => void }) {
  const dnsQuery = useQuery({
    queryKey: ["dns"],
    queryFn: () => api<{ records: DnsRow[] }>("/api/v1/network/dns"),
  });
  const records = dnsQuery.data?.ok ? dnsQuery.data.data?.records ?? null : null;
  const [busy, setBusy] = useState(false);

  const reload = () => {
    dnsQuery.refetch();
    onChanged();
  };

  async function toggle(r: DnsRow) {
    setBusy(true);
    const res = await api("/api/v1/network/dns", {
      method: "PATCH",
      body: { id: r.id, status: r.status === "ACTIVE" ? "DISABLED" : "ACTIVE" },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: res.error, variant: "destructive" });
      return;
    }
    reload();
  }

  async function remove(r: DnsRow) {
    setBusy(true);
    const res = await api(`/api/v1/network/dns?id=${encodeURIComponent(r.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `Record ${r.name}.${r.zone} deleted` });
    reload();
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <AddDnsDialog onCreated={reload} />
      </div>
      {!records && <Skeleton className="h-56 rounded-xl" />}
      {records && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[30rem] overflow-y-auto vortex-scroll">
              {records.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 py-3 border-b border-border/40 last:border-0"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Badge variant="outline" className="text-[10px] border-primary/30 text-primary shrink-0">
                      {r.type}
                    </Badge>
                    <code className="font-mono text-xs truncate">
                      {r.name}.<span className="text-muted-foreground">{r.zone}</span>
                    </code>
                  </div>
                  <code className="font-mono text-xs text-muted-foreground flex-1 truncate">{r.value}</code>
                  <span className="text-[11px] text-muted-foreground shrink-0">TTL {r.ttl}s</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch checked={r.status === "ACTIVE"} onCheckedChange={() => toggle(r)} disabled={busy} aria-label={`Toggle ${r.name}`} />
                    <Button size="sm" variant="ghost" className="text-red-400" disabled={busy} onClick={() => remove(r)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AddDnsDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ zone: "vortex.internal", name: "", type: "A", value: "", ttl: "300" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await api("/api/v1/network/dns", {
      method: "POST",
      body: { ...form, ttl: parseInt(form.ttl, 10) },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Could not create record", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${form.name}.${form.zone} created` });
    setOpen(false);
    setForm({ zone: "vortex.internal", name: "", type: "A", value: "", ttl: "300" });
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="w-4 h-4 mr-2" /> Add record
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create DNS record</DialogTitle>
            <DialogDescription>Internal VORTEX DNS — resolvable inside the private network.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dns-name">Name</Label>
                <Input
                  id="dns-name"
                  placeholder="myapp"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger aria-label="Record type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["A", "AAAA", "CNAME", "TXT", "MX"].map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dns-value">Value</Label>
              <Input
                id="dns-value"
                placeholder={form.type === "A" ? "10.10.0.25" : "target or text"}
                className="font-mono"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dns-ttl">TTL (seconds)</Label>
              <Input id="dns-ttl" type="number" min={30} max={86400} value={form.ttl} onChange={(e) => setForm({ ...form, ttl: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- FIREWALL ---------------- */

function FirewallTab({ onChanged }: { onChanged: () => void }) {
  const fwQuery = useQuery({
    queryKey: ["firewall"],
    queryFn: () => api<{ rules: FirewallRow[] }>("/api/v1/network/firewall"),
  });
  const rules = fwQuery.data?.ok ? fwQuery.data.data?.rules ?? null : null;
  const [busy, setBusy] = useState(false);

  const reload = () => {
    fwQuery.refetch();
    onChanged();
  };

  async function toggle(rule: FirewallRow) {
    setBusy(true);
    const res = await api("/api/v1/network/firewall", {
      method: "PATCH",
      body: { id: rule.id, enabled: !rule.enabled },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: res.error, variant: "destructive" });
      return;
    }
    reload();
  }

  async function remove(rule: FirewallRow) {
    setBusy(true);
    const res = await api(`/api/v1/network/firewall?id=${encodeURIComponent(rule.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `Rule "${rule.name}" deleted` });
    reload();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground max-w-md">
          Rules apply in priority order (1 first). The DEFAULT DENY system rule is protected — it cannot be disabled or deleted.
        </p>
        <AddRuleDialog onCreated={reload} />
      </div>
      {!rules && <Skeleton className="h-56 rounded-xl" />}
      {rules && (
        <div className="grid gap-2">
          {rules.map((r) => (
            <Card key={r.id} className={r.enabled ? "" : "opacity-50"}>
              <CardContent className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <span className="w-10 h-8 rounded-md bg-primary/10 border border-primary/25 text-primary text-xs font-bold flex items-center justify-center shrink-0">
                  {r.priority}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{r.name}</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${r.action === "ALLOW" ? "border-emerald-500/40 text-emerald-400" : "border-red-500/40 text-red-400"}`}
                    >
                      {r.action}
                    </Badge>
                    {r.isSystem && (
                      <Badge variant="outline" className="text-[10px] border-amber-600/40 text-amber-500">
                        SYSTEM
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                    {r.direction} · {r.protocol} · port {r.port || "any"} · from {r.source}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={r.enabled} onCheckedChange={() => toggle(r)} disabled={busy || r.isSystem} aria-label={`Toggle ${r.name}`} />
                  {!r.isSystem && (
                    <Button size="sm" variant="ghost" className="text-red-400" disabled={busy} onClick={() => remove(r)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AddRuleDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    direction: "IN",
    action: "ALLOW",
    protocol: "tcp",
    port: "",
    source: "0.0.0.0/0",
    priority: "100",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await api("/api/v1/network/firewall", {
      method: "POST",
      body: { ...form, priority: parseInt(form.priority, 10) },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Could not create rule", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Firewall rule created", description: form.name });
    setOpen(false);
    setForm({ name: "", direction: "IN", action: "ALLOW", protocol: "tcp", port: "", source: "0.0.0.0/0", priority: "100" });
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="w-4 h-4 mr-2" /> Add rule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New firewall rule</DialogTitle>
            <DialogDescription>Lower priority numbers are evaluated first.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="fw-name">Rule name</Label>
              <Input id="fw-name" placeholder="e.g. Allow app port 3000" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Action</Label>
                <Select value={form.action} onValueChange={(v) => setForm({ ...form, action: v })}>
                  <SelectTrigger aria-label="Action"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALLOW">ALLOW</SelectItem>
                    <SelectItem value="DENY">DENY</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Protocol</Label>
                <Select value={form.protocol} onValueChange={(v) => setForm({ ...form, protocol: v })}>
                  <SelectTrigger aria-label="Protocol"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tcp">tcp</SelectItem>
                    <SelectItem value="udp">udp</SelectItem>
                    <SelectItem value="icmp">icmp</SelectItem>
                    <SelectItem value="any">any</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fw-port">Port</Label>
                <Input id="fw-port" placeholder="443 / 3000-3010" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fw-source">Source CIDR</Label>
                <Input id="fw-source" className="font-mono" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fw-priority">Priority</Label>
                <Input id="fw-priority" type="number" min={1} max={999} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create rule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- ZONES ---------------- */

function ZonesTab({ onChanged }: { onChanged: () => void }) {
  const zonesQuery = useQuery({
    queryKey: ["zones"],
    queryFn: () => api<{ zones: ZoneRow[] }>("/api/v1/network/zones"),
  });
  const zones = zonesQuery.data?.ok ? zonesQuery.data.data?.zones ?? null : null;

  const reload = () => {
    zonesQuery.refetch();
    onChanged();
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <AddZoneDialog onCreated={reload} />
      </div>
      {!zones && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {zones?.map((z) => (
          <Card key={z.id}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                    <NetworkIcon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{z.name}</p>
                    <code className="font-mono text-[11px] text-muted-foreground">{z.cidr}</code>
                  </div>
                </div>
                {z.vlan !== null && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">
                    VLAN {z.vlan}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-3">{z.purpose || "No purpose set."}</p>
              <div className="flex items-center justify-between mt-4 text-[11px] text-muted-foreground">
                <span>
                  IPs: {z.ipFree} free / {z.ipTotal} pooled
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" /> {z.status}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AddZoneDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", cidr: "", vlan: "", purpose: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await api("/api/v1/network/zones", {
      method: "POST",
      body: { ...form, vlan: form.vlan ? parseInt(form.vlan, 10) : undefined },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Could not create zone", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `Zone ${form.name} created`, description: form.cidr });
    setOpen(false);
    setForm({ name: "", cidr: "", vlan: "", purpose: "" });
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="w-4 h-4 mr-2" /> Add zone
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Create network zone</DialogTitle>
            <DialogDescription>An isolated private segment for a group of nodes.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="zone-name">Name</Label>
                <Input id="zone-name" placeholder="vortex-ai" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zone-cidr">CIDR</Label>
                <Input id="zone-cidr" placeholder="10.40.0.0/24" className="font-mono" value={form.cidr} onChange={(e) => setForm({ ...form, cidr: e.target.value })} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="zone-vlan">VLAN (optional)</Label>
                <Input id="zone-vlan" type="number" min={1} max={4094} value={form.vlan} onChange={(e) => setForm({ ...form, vlan: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zone-purpose">Purpose</Label>
                <Input id="zone-purpose" placeholder="What is this zone for?" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Create zone
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
