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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Boxes, Copy, Flame, KeyRound, Loader2, Plus } from "lucide-react";
import { api, type AppRow } from "../client";

const APP_STYLES: Record<string, string> = {
  ACTIVE: "border-emerald-500/40 text-emerald-400",
  PAUSED: "border-amber-500/40 text-amber-400",
  ARCHIVED: "border-zinc-500/40 text-zinc-400",
};

export default function AppsView({ onChanged }: { onChanged: () => void }) {
  const appsQuery = useQuery({
    queryKey: ["apps"],
    queryFn: () => api<{ apps: AppRow[] }>("/api/v1/apps"),
  });
  const apps = appsQuery.data?.ok ? appsQuery.data.data?.apps ?? null : null;

  const reload = () => {
    appsQuery.refetch();
    onChanged();
  };

  async function setStatus(app: AppRow, status: string) {
    const res = await api("/api/v1/apps", { method: "PATCH", body: { id: app.id, status } });
    if (!res.ok) {
      toast({ title: "Update failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${app.name} → ${status}` });
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Applications</h3>
          <p className="text-sm text-muted-foreground">
            The owner&apos;s apps that live inside VORTEX. Every app gets an <code className="font-mono text-primary">appId</code> —
            all future data (files, DBs, keys) is tagged with it.
          </p>
        </div>
        <RegisterAppDialog onCreated={reload} />
      </div>

      {!apps && (
        <div className="grid gap-3 sm:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {apps?.map((a) => (
          <Card key={a.id}>
            <CardContent className="p-5 flex flex-col h-full">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                    <Boxes className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{a.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground truncate">{a.appId}</p>
                  </div>
                </div>
                <Badge variant="outline" className={`text-[10px] shrink-0 ${APP_STYLES[a.status] || ""}`}>
                  {a.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-3 flex-1">{a.description || "No description."}</p>
              {a.backend && <BackendStrip backend={a.backend} appName={a.name} />}
              <div className="flex items-center justify-between mt-4">
                <p className="text-[11px] text-muted-foreground">
                  {a.activeKeys} active key{a.activeKeys === 1 ? "" : "s"}
                </p>
                <SelectMini current={a.status} onSet={(v) => setStatus(a, v)} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SelectMini({ current, onSet }: { current: string; onSet: (v: string) => void }) {
  return (
    <select
      value={current}
      aria-label="App status"
      onChange={(e) => onSet(e.target.value)}
      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs text-muted-foreground"
    >
      <option value="ACTIVE">ACTIVE</option>
      <option value="PAUSED">PAUSED</option>
      <option value="ARCHIVED">ARCHIVED</option>
    </select>
  );
}

/** VaaS backend strip — every app ships with a live backend since the NEXA wire. */
function BackendStrip({ backend, appName }: { backend: NonNullable<AppRow["backend"]>; appName: string }) {
  const [open, setOpen] = useState(false);
  const snippet = buildSnippet(appName, backend.projectId, backend.clientKey);
  return (
    <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Flame className="w-4 h-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-medium leading-tight">VaaS backend · {backend.region}</p>
            <p className="font-mono text-[10px] text-muted-foreground truncate leading-tight">{backend.projectId}</p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="h-7 px-2 text-[11px] shrink-0" onClick={() => setOpen(true)}>
          <KeyRound className="w-3 h-3 mr-1" /> SDK
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-primary" /> {appName} — VaaS backend
            </DialogTitle>
            <DialogDescription>
              {backend.projectId} · {backend.slug}.vaas.vortex.internal · linked {backend.linkedAt ? new Date(backend.linkedAt).toLocaleString() : "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">CLIENT key (publishable config)</Label>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { void navigator.clipboard.writeText(backend.clientKey); toast({ title: "Client key copied" }); }}>
                  <Copy className="w-3 h-3 mr-1" /> Copy
                </Button>
              </div>
              <p className="font-mono text-xs rounded-md border border-border/70 bg-background/60 px-3 py-2 break-all">{backend.clientKey}</p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">SDK snippet</Label>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { void navigator.clipboard.writeText(snippet); toast({ title: "Snippet copied" }); }}>
                  <Copy className="w-3 h-3 mr-1" /> Copy
                </Button>
              </div>
              <ScrollArea className="max-h-52 rounded-md border border-border/70 bg-background/60">
                <pre className="text-[11px] leading-relaxed p-3 font-mono whitespace-pre">{snippet}</pre>
              </ScrollArea>
            </div>
            <p className="text-[11px] text-muted-foreground">
              The ADMIN key was shown once at registration. Lost it? Rotate keys from VaaS (P8).
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function buildSnippet(appName: string, projectId: string, clientKey: string): string {
  return [
    `<script src="/vortex-sdk.js"></script>`,
    `<script>`,
    `  // ${appName} — powered by VORTEX VaaS (dhaka-1)`,
    `  const vx = Vortex.initializeApp({`,
    `    projectId: "${projectId}",`,
    `    clientKey: "${clientKey}",`,
    `    apiUrl: "/api/vaas/v1"`,
    `  });`,
    `</script>`,
  ].join("\n");
}

function RegisterAppDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [created, setCreated] = useState<{
    name: string;
    backend: { projectId: string; clientKey: string; adminKey: string; snippet: string } | null;
    backendError: string | null;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await api<{
      app: { name: string; appId: string };
      backend: { projectId: string; clientKey: string; adminKey: string; snippet: string } | null;
      backendError: string | null;
    }>("/api/v1/apps", { method: "POST", body: form });
    setBusy(false);
    if (!res.ok || !res.data) {
      toast({ title: "Could not register app", description: res.error, variant: "destructive" });
      return;
    }
    setCreated({ name: res.data.app.name, backend: res.data.backend, backendError: res.data.backendError });
    setOpen(false);
    setForm({ name: "", description: "" });
    onCreated();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) setCreated(null); }}>
        <DialogTrigger asChild>
          <Button>
            <Plus className="w-4 h-4 mr-2" /> Add app
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Register an application</DialogTitle>
              <DialogDescription>
                The AI builder auto-provisions a production VaaS backend with it — auth, DB, storage, realtime, functions.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="app-name">Name</Label>
                <Input
                  id="app-name"
                  placeholder="e.g. MY NEW APP"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="app-desc">Description</Label>
                <Textarea
                  id="app-desc"
                  rows={3}
                  placeholder="What does this app do inside VORTEX?"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Register app
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* post-create reveal — the only time the ADMIN key is ever shown */}
      <Dialog open={!!created} onOpenChange={(v) => { if (!v) setCreated(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {created && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Flame className="w-5 h-5 text-primary" /> {created.name} is live
                </DialogTitle>
                <DialogDescription>
                  {created.backend
                    ? "App registered AND backend provisioned — the AI builder shipped the whole stack."
                    : `App registered, but backend provisioning deferred: ${created.backendError || "unknown"}`}
                </DialogDescription>
              </DialogHeader>
              {created.backend && (
                <div className="space-y-3 py-1">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">CLIENT key (publishable)</Label>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { void navigator.clipboard.writeText(created.backend?.clientKey || ""); toast({ title: "Client key copied" }); }}>
                        <Copy className="w-3 h-3 mr-1" /> Copy
                      </Button>
                    </div>
                    <p className="font-mono text-xs rounded-md border border-border/70 bg-background/60 px-3 py-2 break-all">{created.backend.clientKey}</p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-amber-400">ADMIN key (secret — shown ONLY now)</Label>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { void navigator.clipboard.writeText(created.backend?.adminKey || ""); toast({ title: "Admin key copied" }); }}>
                        <Copy className="w-3 h-3 mr-1" /> Copy
                      </Button>
                    </div>
                    <p className="font-mono text-xs rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 break-all">{created.backend.adminKey}</p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">SDK snippet</Label>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { void navigator.clipboard.writeText(created.backend?.snippet || ""); toast({ title: "Snippet copied" }); }}>
                        <Copy className="w-3 h-3 mr-1" /> Copy
                      </Button>
                    </div>
                    <div className="max-h-48 overflow-y-auto rounded-md border border-border/70 bg-background/60">
                      <pre className="text-[11px] leading-relaxed p-3 font-mono whitespace-pre">{created.backend.snippet}</pre>
                    </div>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button onClick={() => setCreated(null)}>Done</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
