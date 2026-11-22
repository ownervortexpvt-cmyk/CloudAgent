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
  Globe,
  Loader2,
  Play,
  Plus,
  Terminal,
  Trash2,
  Zap,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import {
  api,
  fmtAgo,
  fmtDate,
  type AppRow,
  type GatewayRequestRow,
  type GatewayRouteRow,
  type GatewayStats,
  type KeyRow,
} from "../client";

const STATUS_COLOR: Record<string, string> = {
  "2xx": "border-emerald-500/40 text-emerald-400",
  "4xx": "border-amber-500/40 text-amber-400",
  "5xx": "border-red-500/40 text-red-400",
};

function statusClass(code: number): string {
  if (code < 400) return STATUS_COLOR["2xx"];
  if (code < 500) return STATUS_COLOR["4xx"];
  return STATUS_COLOR["5xx"];
}

export default function GatewayView({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">API Gateway</h3>
        <p className="text-sm text-muted-foreground">
          One door for every app call: <code className="font-mono text-primary">/api/gw/&lt;route&gt;</code> — API-key
          auth, app binding (a key can never cross into another app&apos;s route), scopes, per-key rate limits and a
          full access log. The edge is real: send a Bearer key with curl.
        </p>
      </div>

      <Tabs defaultValue="routes" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="routes" className="gap-2">
            <Globe className="w-4 h-4" /> Routes
          </TabsTrigger>
          <TabsTrigger value="traffic" className="gap-2">
            <Zap className="w-4 h-4" /> Access log
          </TabsTrigger>
          <TabsTrigger value="console" className="gap-2">
            <Terminal className="w-4 h-4" /> Request console
          </TabsTrigger>
        </TabsList>
        <TabsContent value="routes" className="mt-4">
          <RoutesTab onChanged={onChanged} />
        </TabsContent>
        <TabsContent value="traffic" className="mt-4">
          <TrafficTab />
        </TabsContent>
        <TabsContent value="console" className="mt-4">
          <ConsoleTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- ROUTES ---------------- */

function RoutesTab({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["gateway"],
    queryFn: () => api<{ routes: GatewayRouteRow[]; stats: GatewayStats }>("/api/v1/gateway"),
    refetchInterval: 15_000,
  });
  const data = q.data?.ok ? q.data.data ?? null : null;

  const reload = () => {
    q.refetch();
    onChanged();
  };

  const s = data?.stats;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-5">
        <StatTile label="Requests 24h" value={s ? `${s.requests24h}` : "…"} hint="edge + simulator" />
        <StatTile label="OK rate" value={s ? `${s.okRate}%` : "…"} hint={s ? `${s.ok24h} succeeded` : ""} />
        <StatTile label="Blocked 24h" value={s ? `${s.blocked24h}` : "…"} hint="401/403/429/404" />
        <StatTile label="Latency avg" value={s ? `${s.avgLatencyMs} ms` : "…"} hint={s ? `p95 ${s.p95LatencyMs} ms` : ""} />
        <StatTile label="Routes" value={s ? `${s.routesActive}/${s.routesTotal}` : "…"} hint="active / total" />
      </div>

      <div className="flex justify-end">
        <CreateRouteDialog onCreated={reload} />
      </div>

      {!data && <Skeleton className="h-72 rounded-xl" />}

      {data && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[32rem] overflow-y-auto vortex-scroll">
              {data.routes.length === 0 && (
                <p className="text-sm text-muted-foreground p-6 text-center">No routes yet — publish the first door.</p>
              )}
              {data.routes.map((r) => (
                <RouteRow key={r.id} route={r} onChanged={reload} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-primary/20">
        <CardContent className="p-4 flex items-start gap-3">
          <Terminal className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="text-foreground font-medium">Try the edge from a terminal</p>
            <code className="block font-mono bg-card/80 border border-border/60 rounded-md px-3 py-2 overflow-x-auto vortex-scroll">
              curl -s -H &quot;Authorization: Bearer vx_live_...&quot; http://localhost:3000/api/gw/nexseva
            </code>
            <p>
              Public probe (no key): <code className="font-mono text-primary">GET /api/gw/status</code> — everything
              else requires a key bound to the route&apos;s app with the right scope.
            </p>
          </div>
        </CardContent>
      </Card>
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

function RouteRow({ route, onChanged }: { route: GatewayRouteRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    const res = await api("/api/v1/gateway", { method: "PATCH", body: { id: route.id, ...body } });
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
    const res = await api(`/api/v1/gateway?id=${encodeURIComponent(route.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `/api/gw/${route.publicPath} removed` });
    onChanged();
  }

  return (
    <div className="flex flex-col xl:flex-row xl:items-center gap-2 xl:gap-3 px-4 py-3 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <code className="font-mono text-xs text-primary whitespace-nowrap">/api/gw/{route.publicPath}</code>
        <Badge variant="outline" className="text-[10px] border-violet-500/40 text-violet-300">
          {route.targetType}:{route.target}
        </Badge>
        {route.auth === "API_KEY" ? (
          <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
            <ShieldCheck className="w-3 h-3 mr-1" />
            key · {route.requiredScope}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">
            <ShieldAlert className="w-3 h-3 mr-1" />
            public
          </Badge>
        )}
      </div>
      <div className="flex-1 min-w-0 text-xs text-muted-foreground">
        <span className="text-foreground">{route.name}</span>
        <span className="opacity-70">
          {" "}
          · {route.rateLimitPerMin}/min · {route.hitCount} hits · last {fmtAgo(route.lastHitAt)}
        </span>
        {route.app && <span className="block">{route.app.name}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Switch
          checked={route.status === "ACTIVE"}
          disabled={busy}
          onCheckedChange={(v) =>
            patch({ status: v ? "ACTIVE" : "DISABLED" }, v ? `/api/gw/${route.publicPath} live` : `/api/gw/${route.publicPath} disabled (503)`)
          }
        />
        <Button size="sm" variant="ghost" className="text-red-400" disabled={busy} onClick={remove}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function CreateRouteDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [publicPath, setPublicPath] = useState("");
  const [targetType, setTargetType] = useState("APP");
  const [appId, setAppId] = useState("");
  const [serviceKey, setServiceKey] = useState("");
  const [auth, setAuth] = useState("API_KEY");
  const [scope, setScope] = useState("read");
  const [rate, setRate] = useState("120");

  const appsQuery = useQuery({
    queryKey: ["apps"],
    queryFn: () => api<{ apps: AppRow[] }>("/api/v1/apps"),
    enabled: open,
  });
  const servicesQuery = useQuery({
    queryKey: ["services"],
    queryFn: () => api<{ services: { serviceKey: string; name: string }[] }>("/api/v1/services"),
    enabled: open,
  });

  const apps = appsQuery.data?.ok ? appsQuery.data.data?.apps ?? [] : [];
  const services = servicesQuery.data?.ok ? servicesQuery.data.data?.services ?? [] : [];

  async function create() {
    setBusy(true);
    const res = await api("/api/v1/gateway", {
      method: "POST",
      body: {
        name,
        publicPath,
        targetType,
        appId: targetType === "APP" ? appId : undefined,
        target: targetType === "SERVICE" ? serviceKey : undefined,
        auth,
        requiredScope: auth === "API_KEY" ? scope : "none",
        rateLimitPerMin: parseInt(rate) || 120,
      },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Route creation failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `/api/gw/${publicPath} is live` });
    setOpen(false);
    setName("");
    setPublicPath("");
    onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-1" /> New route
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish a gateway route</DialogTitle>
          <DialogDescription>
            APP routes are app-bound (data gravity). SERVICE routes resolve against the registry. MOCK echoes the
            request back — handy for testing keys and rate limits.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gw-name">Route name</Label>
              <Input id="gw-name" placeholder="e.g. FLAREX write API" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gw-path">Public path</Label>
              <div className="flex items-center gap-1">
                <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">/api/gw/</span>
                <Input id="gw-path" placeholder="flarex" value={publicPath} onChange={(e) => setPublicPath(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Target type</Label>
            <Select value={targetType} onValueChange={setTargetType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="APP">App (data gravity)</SelectItem>
                <SelectItem value="SERVICE">Service (registry)</SelectItem>
                <SelectItem value="MOCK">Mock (echo)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {targetType === "APP" && (
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
          )}
          {targetType === "SERVICE" && (
            <div className="space-y-1.5">
              <Label>Upstream service</Label>
              <Select value={serviceKey} onValueChange={setServiceKey}>
                <SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger>
                <SelectContent>
                  {services.map((s) => (
                    <SelectItem key={s.serviceKey} value={s.serviceKey}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Auth</Label>
              <Select value={auth} onValueChange={setAuth}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="API_KEY">API key</SelectItem>
                  <SelectItem value="PUBLIC">Public</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={setScope} disabled={auth === "PUBLIC"}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">read</SelectItem>
                  <SelectItem value="write">write</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gw-rate">Limit/min</Label>
              <Input id="gw-rate" type="number" min="10" max="10000" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={busy || !name || !publicPath || (targetType === "APP" && !appId) || (targetType === "SERVICE" && !serviceKey)} onClick={create}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Publish route
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- TRAFFIC ---------------- */

function TrafficTab() {
  const q = useQuery({
    queryKey: ["gateway"],
    queryFn: () => api<{ requests: GatewayRequestRow[] }>("/api/v1/gateway"),
    refetchInterval: 8_000,
  });
  const requests = q.data?.ok ? q.data.data?.requests ?? null : null;

  return (
    <div className="space-y-3">
      {!requests && <Skeleton className="h-72 rounded-xl" />}
      {requests && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[32rem] overflow-y-auto vortex-scroll">
              {requests.length === 0 && (
                <p className="text-sm text-muted-foreground p-6 text-center">No traffic in the last 24h.</p>
              )}
              {requests.map((r) => (
                <div key={r.id} className="flex flex-col xl:flex-row xl:items-center gap-1 xl:gap-3 px-4 py-2.5 border-b border-border/40 last:border-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Badge variant="outline" className={`font-mono text-[10px] ${statusClass(r.status)}`}>
                      {r.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">{r.method}</Badge>
                    <code className="font-mono text-xs text-primary">/api/gw/{r.routeKey}</code>
                    {r.blocked && <span className="text-[10px] text-amber-400 truncate">⛔ {r.blocked}</span>}
                  </div>
                  <div className="flex-1 min-w-0 text-xs text-muted-foreground">
                    <span className="font-mono">{r.keyPrefix || "anon"}</span>
                    <span className="opacity-70"> · {r.sourceIp} · {r.latencyMs} ms · {r.via === "SIMULATOR" ? "console" : "edge"}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{fmtDate(r.createdAt)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ---------------- CONSOLE ---------------- */

function ConsoleTab() {
  const [routeKey, setRouteKey] = useState("");
  const [keyId, setKeyId] = useState("none");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: number; latencyMs: number; body: unknown } | null>(null);

  const routesQuery = useQuery({
    queryKey: ["gateway"],
    queryFn: () => api<{ routes: GatewayRouteRow[] }>("/api/v1/gateway"),
  });
  const keysQuery = useQuery({
    queryKey: ["keys"],
    queryFn: () => api<{ keys: KeyRow[] }>("/api/v1/keys"),
  });

  const routes = routesQuery.data?.ok ? routesQuery.data.data?.routes ?? [] : [];
  const keys = (keysQuery.data?.ok ? keysQuery.data.data?.keys ?? [] : []).filter((k) => k.status === "ACTIVE");

  async function run() {
    if (!routeKey) return;
    setBusy(true);
    setResult(null);
    const res = await api<{ status: number; latencyMs: number; body: unknown }>("/api/v1/gateway/simulate", {
      method: "POST",
      body: { routeKey, keyId: keyId === "none" ? undefined : keyId },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Console error", description: res.error, variant: "destructive" });
      return;
    }
    if (res.data) setResult(res.data);
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Route</Label>
              <Select value={routeKey} onValueChange={setRouteKey}>
                <SelectTrigger><SelectValue placeholder="/api/gw/…" /></SelectTrigger>
                <SelectContent>
                  {routes.map((r) => (
                    <SelectItem key={r.id} value={r.publicPath}>
                      {r.publicPath} ({r.auth === "PUBLIC" ? "public" : "key"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>API key</Label>
              <Select value={keyId} onValueChange={setKeyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No key (tests rejection)</SelectItem>
                  {keys.map((k) => (
                    <SelectItem key={k.keyId} value={k.keyId}>
                      {k.prefix}… · {k.app?.appId || "no app"} · {k.scopes.join("/")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button className="w-full" disabled={busy || !routeKey} onClick={run}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />} Send request
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Requests run through the real pipeline and land in the access log. Pick a key bound to a different app than
            the route to watch the app-binding guard reject it with 403.
          </p>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-3">
              <Badge variant="outline" className={`font-mono ${statusClass(result.status)}`}>{result.status}</Badge>
              <span className="text-xs text-muted-foreground">{result.latencyMs} ms round-trip</span>
            </div>
            <pre className="text-xs font-mono bg-card/80 border border-border/60 rounded-md p-3 overflow-x-auto vortex-scroll max-h-80 whitespace-pre-wrap">
              {JSON.stringify(result.body, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
