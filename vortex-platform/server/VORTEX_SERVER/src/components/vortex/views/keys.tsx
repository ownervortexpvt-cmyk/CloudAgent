"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Copy, KeyRound, Loader2, Plus, ShieldOff, Terminal } from "lucide-react";
import { api, type AppRow, type KeyRow, fmtDate } from "../client";

const SCOPES = ["read", "write", "admin"];

export default function KeysView({ onChanged }: { onChanged: () => void }) {
  const keysQuery = useQuery({
    queryKey: ["keys"],
    queryFn: () => api<{ keys: KeyRow[] }>("/api/v1/keys"),
  });
  const appsQuery = useQuery({
    queryKey: ["apps"],
    queryFn: () => api<{ apps: AppRow[] }>("/api/v1/apps"),
  });
  const keys = keysQuery.data?.ok ? keysQuery.data.data?.keys ?? null : null;
  const apps = appsQuery.data?.ok ? appsQuery.data.data?.apps ?? [] : [];

  const reload = () => {
    keysQuery.refetch();
    appsQuery.refetch();
    onChanged();
  };

  async function revoke(k: KeyRow) {
    const res = await api("/api/v1/keys/revoke", { method: "POST", body: { id: k.id } });
    if (!res.ok) {
      toast({ title: "Revoke failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: "Key revoked", description: k.name });
    reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">API Keys</h3>
          <p className="text-sm text-muted-foreground">
            SDK-style access for your apps: <code className="font-mono text-primary">Authorization: Bearer vx_live_…</code>.
            Keys are stored hashed — plaintext is shown once at creation.
          </p>
        </div>
        <CreateKeyDialog apps={apps} onCreated={reload} />
      </div>

      {/* SDK usage snippet */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Terminal className="w-4 h-4 text-primary" />
            <p className="text-sm font-medium">Verify from any app (API module groundwork)</p>
          </div>
          <pre className="rounded-lg bg-black/40 border border-border/60 p-3 text-[11px] font-mono overflow-x-auto vortex-scroll">
{`curl -X POST https://<vortex-host>/api/v1/keys/verify \\
  -H "Authorization: Bearer vx_live_xxxxxxxxxxxx"`}
          </pre>
        </CardContent>
      </Card>

      {!keys && (
        <div className="grid gap-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      )}

      <div className="grid gap-3">
        {keys?.map((k) => (
          <Card key={k.id}>
            <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${k.status === "ACTIVE" ? "bg-primary/15 border-primary/25" : "bg-muted border-border"}`}>
                  <KeyRound className={`w-5 h-5 ${k.status === "ACTIVE" ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{k.name}</span>
                    <Badge variant="outline" className={`text-[10px] ${k.status === "ACTIVE" ? "border-emerald-500/40 text-emerald-400" : "border-red-500/40 text-red-400"}`}>
                      {k.status}
                    </Badge>
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground mt-0.5">{k.prefix} <span className="opacity-50">(hashed)</span></p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {k.app ? `${k.app.name} (${k.app.appId}) · ` : "no app · "}
                    scopes: {k.scopes.join(", ")} · last used {fmtDate(k.lastUsedAt)}
                  </p>
                </div>
              </div>
              {k.status === "ACTIVE" && (
                <Button size="sm" variant="outline" className="border-red-500/40 text-red-400 hover:bg-red-500/10" onClick={() => revoke(k)}>
                  <ShieldOff className="w-3.5 h-3.5 mr-1.5" /> Revoke
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
        {keys && keys.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No keys yet. Create one to let an app talk to VORTEX.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function CreateKeyDialog({ apps, onCreated }: { apps: AppRow[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [appId, setAppId] = useState<string>("none");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [plaintext, setPlaintext] = useState<string | null>(null);

  function toggleScope(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await api<{ key: KeyRow; plaintext: string }>("/api/v1/keys", {
      method: "POST",
      body: { name, appId: appId === "none" ? undefined : appId, scopes },
    });
    setBusy(false);
    if (!res.ok || !res.data) {
      toast({ title: "Could not create key", description: res.error, variant: "destructive" });
      return;
    }
    setPlaintext(res.data.plaintext);
    onCreated();
  }

  function closeAll() {
    setOpen(false);
    setPlaintext(null);
    setName("");
    setAppId("none");
    setScopes(["read"]);
  }

  async function copyKey() {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Copy failed — select the text manually", variant: "destructive" });
    }
  }

  return (
    <>
      <Dialog open={open && !plaintext} onOpenChange={(v) => (v ? setOpen(true) : closeAll())}>
        <DialogTrigger asChild>
          <Button>
            <Plus className="w-4 h-4 mr-2" /> Create key
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Attach it to an app so all data stays tagged with that appId.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="key-name">Key name</Label>
                <Input
                  id="key-name"
                  placeholder="e.g. FLAREX backend key"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Attach to app</Label>
                <Select value={appId} onValueChange={setAppId}>
                  <SelectTrigger aria-label="Attach to app">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— No app (owner key) —</SelectItem>
                    {apps.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Scopes</Label>
                <div className="flex gap-4">
                  {SCOPES.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={scopes.includes(s)} onCheckedChange={() => toggleScope(s)} />
                      {s}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">admin includes write; needed for provisioning APIs later.</p>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || scopes.length === 0}>
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Generate key
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Plaintext reveal — shown ONCE */}
      <Dialog open={!!plaintext} onOpenChange={(v) => !v && closeAll()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" /> Your new key
            </DialogTitle>
            <DialogDescription>
              Copy it now — VORTEX stores only the hash. This exact text will never be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-center gap-2">
            <code className="font-mono text-xs break-all flex-1 select-all">{plaintext}</code>
            <Button size="icon" variant="outline" aria-label="Copy key" onClick={copyKey}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={closeAll}>I saved it — done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
