"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  Boxes,
  Check,
  Copy,
  Database,
  FileText,
  Flame,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Plus,
  RefreshCcw,
  Users,
} from "lucide-react";
import { VortexMark } from "./login";

/**
 * VORTEX DEVELOPER CONSOLE — the public face of VaaS.
 * Anyone can create an account, provision a production backend and ship.
 * Talks ONLY to /api/vaas/v1/* with the developer token (vdt_…) — the
 * owner's control plane stays private behind VORTEX ID.
 */

const API = "/api/vaas/v1";
const TOKEN_KEY = "vortex_dev_token";

type DevMe = {
  dev: { devId: string; email: string; name: string; plan: string; emailVerified: boolean };
};

type DevProject = {
  projectId: string;
  name: string;
  slug: string;
  region: string;
  status: string;
  viaNexa: boolean;
  authEnabled: boolean;
  rtEnabled: boolean;
  fnEnabled: boolean;
  createdAt: string;
  collections: { name: string; readRule: string; writeRule: string; docs: number }[];
  docs: number;
  files: number;
  storageKb: number;
  endUsers: number;
  usage: Record<string, number>;
  usageBdt: number;
  plan: string | null;
  clientKey: string | null;
  snippet: string | null;
};

type IssuedKeys = {
  projectId: string;
  clientKey?: string;
  adminKey?: string;
  snippet?: string;
};

async function vxApi<T>(path: string, opts?: { method?: string; token?: string | null; body?: unknown }): Promise<{ ok: boolean; data?: T; error?: string; status: number }> {
  try {
    const headers: Record<string, string> = {};
    if (opts?.token) headers.Authorization = `Bearer ${opts.token}`;
    const init: RequestInit = { method: opts?.method || "GET", headers };
    if (opts?.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(API + path, init);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!json.ok) return { ok: false, error: String(json.error || `HTTP ${res.status}`), status: res.status };
    return { ok: true, data: json as T, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error", status: 0 };
  }
}

function copyText(text: string, label: string) {
  try {
    void navigator.clipboard.writeText(text);
    toast({ title: `${label} copied` });
  } catch {
    toast({ title: "Copy failed — select the text manually", variant: "destructive" });
  }
}

const METRIC_LABEL: Record<string, string> = {
  VAAS_API: "SDK API calls",
  VAAS_AUTH: "Auth operations",
  VAAS_DOCS: "Document writes",
  VAAS_STORAGE_MB: "Project storage",
  VAAS_REALTIME: "Realtime messages",
  VAAS_FN: "Function invokes",
};

export default function DevConsole({ onExit }: { onExit: () => void }) {
  const [checking, setChecking] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<DevMe["dev"] | null>(null);
  const [projects, setProjects] = useState<DevProject[] | null>(null);

  const loadProjects = useCallback(async (t: string) => {
    const res = await vxApi<{ projects: DevProject[] }>("/dev/projects", { token: t });
    if (res.ok && res.data) setProjects(res.data.projects);
    else if (res.status === 401) {
      // token died — back to the console gate
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
      setToken(null);
      setMe(null);
      setProjects(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function readSavedToken(): Promise<string | null> {
      try {
        return localStorage.getItem(TOKEN_KEY);
      } catch {
        return null;
      }
    }
    void (async () => {
      const saved = await readSavedToken();
      if (cancelled) return;
      if (!saved) {
        setChecking(false);
        return;
      }
      const res = await vxApi<DevMe>("/dev/me", { token: saved });
      if (cancelled) return;
      if (res.ok && res.data) {
        setToken(saved);
        setMe(res.data.dev);
        await loadProjects(saved);
      } else {
        try { localStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
      }
      if (!cancelled) setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProjects]);

  function authed(t: string, dev: DevMe["dev"]) {
    setToken(t);
    setMe(dev);
    setChecking(false);
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* noop */ }
    void loadProjects(t);
  }

  function logout() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* noop */ }
    setToken(null);
    setMe(null);
    setProjects(null);
    toast({ title: "Signed out of the developer console" });
  }

  if (checking) {
    return (
      <div className="min-h-screen vortex-bg flex flex-col items-center justify-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center animate-pulse">
          <VortexMark className="w-8 h-8 text-primary" />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Connecting to VORTEX VaaS…
        </div>
      </div>
    );
  }

  if (!token || !me) {
    return <ConsoleAuth onAuthed={authed} onExit={onExit} />;
  }

  const totals = (projects || []).reduce(
    (a, p) => ({
      docs: a.docs + p.docs,
      users: a.users + p.endUsers,
      bdt: a.bdt + p.usageBdt,
      files: a.files + p.files,
    }),
    { docs: 0, users: 0, bdt: 0, files: 0 }
  );

  return (
    <div className="min-h-screen vortex-bg flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border/60 bg-background/70 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
              <VortexMark className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold tracking-wide text-sm leading-tight">VORTEX DEVELOPER CONSOLE</p>
              <p className="text-[11px] text-muted-foreground leading-tight truncate">{me.email} · {me.devId}</p>
            </div>
            <Badge variant="outline" className="hidden sm:inline-flex text-[10px] border-primary/40 text-primary">
              {me.plan || "VAAS_FREE"}
            </Badge>
            {me.emailVerified ? (
              <Badge variant="outline" className="hidden md:inline-flex text-[10px] border-emerald-500/40 text-emerald-400">verified</Badge>
            ) : (
              <Badge variant="outline" className="hidden md:inline-flex text-[10px] border-amber-500/40 text-amber-400">verify from your inbox</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => document.getElementById("vx-new-backend")?.click()} className="hidden sm:inline-flex">
              <Plus className="w-4 h-4 mr-1" /> New backend
            </Button>
            <Button size="sm" variant="ghost" onClick={onExit}>Owner login</Button>
            <Button size="sm" variant="ghost" aria-label="Log out" onClick={logout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Hero */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-wide flex items-center gap-2">
              <Flame className="w-6 h-6 text-primary" /> Welcome, {me.name.split(" ")[0]}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              One click = a production backend: auth, document DB with rules, storage, realtime, functions.
            </p>
          </div>
          <NewBackendButton token={token} onCreated={(issued) => {
            toast({ title: "Backend provisioned", description: issued.projectId });
            void loadProjects(token);
          }} />
        </div>

        {/* Stats */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Backends", value: String(projects?.length ?? 0), icon: Boxes, hint: "VaaS projects you own" },
            { label: "Documents", value: totals.docs.toLocaleString(), icon: Database, hint: "across all collections" },
            { label: "End users", value: totals.users.toLocaleString(), icon: Users, hint: "signed in through your apps" },
            { label: "Usage (month)", value: `৳${totals.bdt.toLocaleString("en-US", { maximumFractionDigits: 2 })}`, icon: Flame, hint: `${totals.files} files stored` },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{s.label}</p>
                  <s.icon className="w-4 h-4 text-primary" />
                </div>
                <p className="text-xl font-bold mt-1.5">{s.value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{s.hint}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Projects */}
        <div>
          <h2 className="font-semibold mb-3">Your backends</h2>
          {!projects && (
            <div className="grid gap-3 sm:grid-cols-2">
              {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
            </div>
          )}
          {projects && projects.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center">
                <Flame className="w-8 h-8 text-primary mx-auto mb-3" />
                <p className="font-medium">No backends yet</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Create your first backend — the SDK snippet comes ready to paste.
                </p>
                <div className="mt-4 flex justify-center">
                  <NewBackendButton token={token} onCreated={(issued) => {
                    toast({ title: "Backend provisioned", description: issued.projectId });
                    void loadProjects(token);
                  }} trigger />
                </div>
              </CardContent>
            </Card>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {(projects || []).map((p) => (
              <ProjectCard key={p.projectId} project={p} token={token} onChanged={() => loadProjects(token)} />
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground pb-4">
          VORTEX VaaS · region dhaka-1 · rules enforced server-side · metered into BDT plans
        </p>
      </main>
    </div>
  );
}

// ------------------------------------------------------------
// auth gate — sign in / create account
// ------------------------------------------------------------

function ConsoleAuth({ onAuthed, onExit }: { onAuthed: (token: string, dev: DevMe["dev"]) => void; onExit: () => void }) {
  return (
    <div className="min-h-screen vortex-bg flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-4 vortex-glow">
            <VortexMark className="w-9 h-9 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-[0.3em] vortex-glow">VORTEX</h1>
          <p className="text-sm text-muted-foreground mt-2 tracking-wide text-center">
            Developer Console — build on the backend that outguns Firebase
          </p>
        </div>

        <Card className="border-primary/20 shadow-2xl shadow-primary/10">
          <Tabs defaultValue="signin">
            <CardHeader>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent>
              <TabsContent value="signin">
                <SignInForm onAuthed={onAuthed} />
              </TabsContent>
              <TabsContent value="signup">
                <SignUpForm onAuthed={onAuthed} />
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        <div className="flex items-center justify-between mt-6 text-xs">
          <Button variant="link" size="sm" className="text-muted-foreground h-auto p-0" onClick={onExit}>
            ← VORTEX ID (owner login)
          </Button>
          <p className="text-muted-foreground">public signup · vaas.public_signup</p>
        </div>
      </div>
    </div>
  );
}

function SignInForm({ onAuthed }: { onAuthed: (token: string, dev: DevMe["dev"]) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await vxApi<{ token: string; devId: string; email: string; name: string }>("/dev/login", {
      method: "POST",
      body: { email, password },
    });
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.error || "Login failed");
      return;
    }
    const meRes = await vxApi<DevMe>("/dev/me", { token: res.data.token });
    if (meRes.ok && meRes.data) onAuthed(res.data.token, meRes.data.dev);
    else setError("Session could not be opened");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="dev-email">Email</Label>
        <Input id="dev-email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dev-password">Password</Label>
        <Input id="dev-password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Flame className="w-4 h-4 mr-2" />}
        Enter the console
      </Button>
    </form>
  );
}

function SignUpForm({ onAuthed }: { onAuthed: (token: string, dev: DevMe["dev"]) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await vxApi<{ token: string; verifyToken: string }>("/dev/signup", {
      method: "POST",
      body: { name, email, password },
    });
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.error || "Signup failed");
      return;
    }
    const meRes = await vxApi<DevMe>("/dev/me", { token: res.data.token });
    if (meRes.ok && meRes.data) {
      toast({
        title: "Account created",
        description: "A verification mail is on its way through real SMTP — verify any time.",
      });
      onAuthed(res.data.token, meRes.data.dev);
    } else {
      setError("Account created but session failed — sign in");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="dev-name">Name</Label>
        <Input id="dev-name" placeholder="Rahim Uddin" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dev-nemail">Email</Label>
        <Input id="dev-nemail" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dev-npassword">Password</Label>
        <Input id="dev-npassword" type="password" placeholder="min 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
        Create account
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Verification mail is delivered over the wired SMTP relay. Quota: 10 backends per account (VAAS_FREE → PRO).
      </p>
    </form>
  );
}

// ------------------------------------------------------------
// new backend dialog
// ------------------------------------------------------------

function NewBackendButton({
  token,
  onCreated,
  trigger,
}: {
  token: string;
  onCreated: (issued: IssuedKeys) => void;
  trigger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [collections, setCollections] = useState("posts, profile");
  const [issued, setIssued] = useState<IssuedKeys | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const cols = collections.split(",").map((c) => c.trim()).filter(Boolean);
    const res = await vxApi<IssuedKeys & { snippet: string }>("/dev/projects", {
      method: "POST",
      token,
      body: { name, collections: cols },
    });
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.error || "Provisioning failed");
      return;
    }
    setIssued(res.data);
    onCreated(res.data);
  }

  return (
    <>
      <Button
        id="vx-new-backend"
        onClick={() => { setIssued(null); setError(null); setOpen(true); }}
        className={trigger ? "" : "hidden sm:inline-flex"}
      >
        <Plus className="w-4 h-4 mr-1" /> New backend
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) { setIssued(null); setError(null); } }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {issued ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <KeyRound className="w-5 h-5 text-primary" /> Backend is live
                </DialogTitle>
                <DialogDescription>
                  {issued.projectId} — collections created, keys issued, welcome function armed.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <KeyLine label="CLIENT key (publishable)" value={issued.clientKey || ""} />
                <KeyLine label="ADMIN key (secret — shown only now)" value={issued.adminKey || ""} secret />
                {issued.snippet && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">SDK snippet</Label>
                      <Button size="sm" variant="outline" onClick={() => copyText(issued.snippet || "", "Snippet")}>
                        <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                      </Button>
                    </div>
                    <div className="max-h-48 overflow-y-auto rounded-md border border-border/70 bg-background/60">
                      <pre className="text-[11px] leading-relaxed p-3 font-mono whitespace-pre">{issued.snippet}</pre>
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={() => { setOpen(false); setName(""); setCollections("posts, profile"); }}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={create}>
              <DialogHeader>
                <DialogTitle>Provision a backend</DialogTitle>
                <DialogDescription>
                  Real infrastructure in seconds — auth, document DB, storage bucket, realtime, functions.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="vx-proj-name">App / project name</Label>
                  <Input id="vx-proj-name" placeholder="e.g. Chalo Ride Sharing" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vx-proj-cols">Collections (comma separated)</Label>
                  <Input id="vx-proj-cols" value={collections} onChange={(e) => setCollections(e.target.value)} />
                  <p className="text-[11px] text-muted-foreground">Defaults: posts (public read / auth write), profile (auth read / owner write)</p>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
              <DialogFooter>
                <Button type="submit" disabled={busy || !name.trim()}>
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Flame className="w-4 h-4 mr-2" />}
                  Provision backend
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function KeyLine({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className={`text-xs ${secret ? "text-amber-400" : "text-muted-foreground"}`}>{label}</Label>
        <div className="flex items-center gap-1">
          {secret && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setShown((v) => !v)}>
              {shown ? "Hide" : "Show"}
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => copyText(value, label.split(" (")[0])}>
            <Copy className="w-3 h-3 mr-1" /> Copy
          </Button>
        </div>
      </div>
      <p className="font-mono text-xs rounded-md border border-border/70 bg-background/60 px-3 py-2 break-all">
        {shown ? value : "•".repeat(Math.min(40, value.length))}
      </p>
    </div>
  );
}

// ------------------------------------------------------------
// project card + detail
// ------------------------------------------------------------

function ProjectCard({ project, token, onChanged }: { project: DevProject; token: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [issued, setIssued] = useState<IssuedKeys | null>(null);

  async function rotate() {
    setRotating(true);
    const res = await vxApi<IssuedKeys & { snippet: string }>(`/dev/projects/${project.projectId}/rotate-keys`, {
      method: "POST",
      token,
      body: {},
    });
    setRotating(false);
    if (!res.ok || !res.data) {
      toast({ title: "Rotation failed", description: res.error, variant: "destructive" });
      return;
    }
    setIssued(res.data);
    toast({ title: "Keys rotated", description: "Previous keys are dead — paste the new snippet." });
    onChanged();
  }

  return (
    <>
      <Card
        className="cursor-pointer hover:border-primary/40 transition-colors"
        onClick={() => { setIssued(null); setOpen(true); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") { setIssued(null); setOpen(true); } }}
        aria-label={`Open ${project.name}`}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                <Flame className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-medium truncate">{project.name}</p>
                <p className="font-mono text-[11px] text-muted-foreground truncate">{project.projectId}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge variant="outline" className={`text-[10px] ${project.status === "ACTIVE" ? "border-emerald-500/40 text-emerald-400" : "border-amber-500/40 text-amber-400"}`}>
                {project.status}
              </Badge>
              {project.viaNexa && <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">NEXA</Badge>}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 mt-4 text-center">
            {[
              { v: String(project.collections.length), l: "collections" },
              { v: project.docs.toLocaleString(), l: "docs" },
              { v: project.endUsers.toLocaleString(), l: "users" },
              { v: `৳${project.usageBdt.toFixed(2)}`, l: "month" },
            ].map((s) => (
              <div key={s.l} className="rounded-lg border border-border/50 py-2">
                <p className="text-sm font-semibold leading-tight">{s.v}</p>
                <p className="text-[10px] text-muted-foreground">{s.l}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mt-3 text-[11px] text-muted-foreground">
            <span className="truncate">{project.slug}.vaas.vortex.internal</span>
            <span>{project.region}</span>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-primary" /> {project.name}
            </DialogTitle>
            <DialogDescription>
              {project.projectId} · {project.slug}.vaas.vortex.internal · region {project.region}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh] pr-2">
            <div className="space-y-4 py-1">
              <div className="flex flex-wrap gap-1.5">
                {[
                  { on: project.authEnabled, l: "Auth" },
                  { on: project.rtEnabled, l: "Realtime" },
                  { on: project.fnEnabled, l: "Functions" },
                ].map((f) => (
                  <Badge key={f.l} variant="outline" className={`text-[10px] ${f.on ? "border-emerald-500/40 text-emerald-400" : "border-border text-muted-foreground"}`}>
                    {f.l} {f.on ? "ON" : "OFF"}
                  </Badge>
                ))}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <Label className="text-xs text-muted-foreground">Collections & rules</Label>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setUsageOpen(true)}>
                    <FileText className="w-3.5 h-3.5 mr-1" /> Usage detail
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {project.collections.map((c) => (
                    <div key={c.name} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                      <span className="font-mono text-xs">{c.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        read:{c.readRule} · write:{c.writeRule} · {c.docs} docs
                      </span>
                    </div>
                  ))}
                  {project.collections.length === 0 && <p className="text-xs text-muted-foreground">No collections yet.</p>}
                </div>
              </div>

              {project.clientKey && (
                <KeyLine label="CLIENT key (publishable)" value={project.clientKey} />
              )}

              {project.snippet && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">SDK snippet</Label>
                    <Button size="sm" variant="outline" onClick={() => copyText(project.snippet || "", "Snippet")}>
                      <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                    </Button>
                  </div>
                  <div className="max-h-44 overflow-y-auto rounded-md border border-border/70 bg-background/60">
                    <pre className="text-[11px] leading-relaxed p-3 font-mono whitespace-pre">{project.snippet}</pre>
                  </div>
                </div>
              )}

              {issued && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" /> New keys issued — previous keys are dead
                  </p>
                  <KeyLine label="CLIENT key (publishable)" value={issued.clientKey || ""} />
                  <KeyLine label="ADMIN key (secret — shown only now)" value={issued.adminKey || ""} secret />
                </div>
              )}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={rotate} disabled={rotating}>
              {rotating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCcw className="w-4 h-4 mr-2" />}
              Rotate keys
            </Button>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={usageOpen} onOpenChange={setUsageOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Usage — {project.name}</DialogTitle>
            <DialogDescription>Current period, metered automatically by the SDK surface.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {Object.keys(project.usage).length === 0 && (
              <p className="text-sm text-muted-foreground">No usage recorded yet this period.</p>
            )}
            {Object.entries(project.usage).map(([metric, qty]) => (
              <div key={metric} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                <span className="text-xs">{METRIC_LABEL[metric] || metric}</span>
                <span className="font-mono text-xs">{qty.toLocaleString()}</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="text-xs font-semibold">Estimated cost</span>
              <span className="font-mono text-sm font-bold">৳{project.usageBdt.toFixed(2)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Plan {project.plan || "VAAS_FREE"} · files stored {project.files} · {(project.storageKb / 1024).toFixed(2)} MB
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
