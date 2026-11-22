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
import { Switch } from "@/components/ui/switch";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Mail, Loader2, Send, RotateCcw, FileText, Gauge, PlugZap, Trash2 } from "lucide-react";
import { api, fmtAgo, fmtDate, type MailState, type MailTemplateRow, type SmtpStatusRow } from "../client";

const STATUS_CLASS: Record<string, string> = {
  SIMULATED: "border-sky-500/40 text-sky-400",
  QUEUED: "border-amber-500/40 text-amber-400",
  SENT: "border-emerald-500/40 text-emerald-400",
  FAILED: "border-red-500/40 text-red-400",
};

export default function MailView({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["mail"],
    queryFn: () => api<MailState>("/api/v1/mail"),
    refetchInterval: 15_000,
  });
  const data = q.data?.ok ? q.data.data : null;

  const reload = () => {
    q.refetch();
    onChanged();
  };

  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    );
  }

  const failed = data.stats.byStatus["FAILED"] || 0;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">MAIL — outbound center</h3>
        <p className="text-sm text-muted-foreground">
          Provider abstraction (simulated | SMTP | Postal) with system templates, retries and honest
          status marking. Wire SMTP below (Postal speaks plain SMTP) and OTP login codes, alerts and
          notifications leave the sandbox for real — everything else keeps working unchanged.
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total in outbox</p>
              <Mail className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">{data.stats.total}</p>
            <p className="text-xs text-muted-foreground mt-1">all time, every category</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Last 24h</p>
              <Gauge className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">{data.stats.last24h}</p>
            <p className="text-xs text-muted-foreground mt-1">
              OTP, alerts and notifications
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Failed</p>
              <RotateCcw className={`w-4 h-4 ${failed > 0 ? "text-red-400" : "text-primary"}`} />
            </div>
            <p className="text-2xl font-bold mt-2">{failed}</p>
            <p className="text-xs text-muted-foreground mt-1">retryable from the outbox</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Provider</p>
            <div className="mt-2 flex items-center gap-2">
              <ProviderSelect provider={data.provider} onDone={reload} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {data.smtp.configured
                ? `SMTP transport live (${data.smtp.source}) — real delivery`
                : "simulated — save SMTP settings below to wire a real relay"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* SMTP wiring */}
      <SmtpCard smtp={data.smtp} onDone={reload} />

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Compose */}
        <div className="lg:col-span-2">
          <ComposeCard onDone={reload} />
        </div>

        {/* Outbox */}
        <Card className="lg:col-span-3">
          <CardContent className="p-5">
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" /> Outbox (latest 50)
            </h4>
            <ScrollArea className="max-h-96">
              <div className="space-y-2 pr-3">
                {data.mails.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
                )}
                {data.mails.map((m) => (
                  <div key={m.id} className="rounded-lg border border-border/60 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{m.subject}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          to {m.toEmail} · {fmtAgo(m.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className={STATUS_CLASS[m.status] || ""}>
                          {m.status}
                        </Badge>
                        {(m.status === "FAILED" || m.status === "QUEUED") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Retry mail"
                            onClick={async () => {
                              const res = await api("/api/v1/mail", { method: "POST", body: { op: "retry", id: m.id } });
                              if (res.ok) {
                                toast({ title: "Mail re-enqueued" });
                                reload();
                              } else {
                                toast({ title: "Retry failed", description: res.error, variant: "destructive" });
                              }
                            }}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 font-mono whitespace-pre-wrap">{m.body}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Templates */}
      <TemplatesCard templates={data.templates} onDone={reload} />
    </div>
  );
}

function SmtpCard({ smtp, onDone }: { smtp: SmtpStatusRow; onDone: () => void }) {
  const [host, setHost] = useState(smtp.host || "");
  const [port, setPort] = useState(smtp.port ? String(smtp.port) : "587");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState(smtp.from || "");
  const [secure, setSecure] = useState(smtp.secure ?? false);
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);

  async function save() {
    setBusy("save");
    const res = await api("/api/v1/mail", {
      method: "POST",
      body: {
        op: "smtp.save",
        host,
        port: parseInt(port, 10),
        ...(user.trim() ? { user: user.trim() } : {}),
        ...(pass ? { pass } : {}), // empty = keep stored password
        from,
        secure,
      },
    });
    setBusy(null);
    if (res.ok) {
      toast({ title: "SMTP settings saved", description: "Flip the provider to smtp/postal to activate" });
      setPass("");
      onDone();
    } else {
      toast({ title: "Save failed", description: res.error, variant: "destructive" });
    }
  }

  async function test() {
    setBusy("test");
    const res = await api("/api/v1/mail", { method: "POST", body: { op: "smtp.test" } });
    setBusy(null);
    if (res.ok) {
      const d = res.data as { status: string; transport: string };
      if (d.status === "SENT") {
        toast({ title: "Test mail SENT via SMTP", description: `${d.transport} — check the inbox` });
      } else {
        toast({ title: `Test mail ${d.status}`, description: "See the outbox / audit for the transport error", variant: "destructive" });
      }
      onDone();
    } else {
      toast({ title: "Test failed", description: res.error, variant: "destructive" });
    }
  }

  async function clear() {
    setBusy("clear");
    const res = await api("/api/v1/mail", { method: "POST", body: { op: "smtp.clear" } });
    setBusy(null);
    if (res.ok) {
      toast({ title: "SMTP settings cleared — back to simulated" });
      onDone();
    } else {
      toast({ title: "Clear failed", description: res.error, variant: "destructive" });
    }
  }

  const canSave = host.trim() !== "" && parseInt(port, 10) > 0 && from.trim() !== "";

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h4 className="font-semibold flex items-center gap-2">
              <PlugZap className="w-4 h-4 text-primary" /> SMTP wiring (Postal-ready)
            </h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
              Point VORTEX at any SMTP relay — self-hosted Postal, SES, Resend, whatever the owner runs.
              Settings live in the control plane; the password is stored redacted and never shown again.
            </p>
          </div>
          <Badge
            variant="outline"
            className={
              smtp.configured
                ? "border-emerald-500/40 text-emerald-400 shrink-0"
                : "border-sky-500/40 text-sky-400 shrink-0"
            }
          >
            {smtp.configured
              ? `SMTP ${smtp.host}:${smtp.port} · from ${smtp.from} · ${smtp.source}`
              : "SIMULATED — no relay wired"}
          </Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="smtp-host">SMTP host</Label>
            <Input id="smtp-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="postal.vortex.internal" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtp-port">Port</Label>
            <Input id="smtp-port" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" inputMode="numeric" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtp-user">Username (optional)</Label>
            <Input id="smtp-user" value={user} onChange={(e) => setUser(e.target.value)} placeholder={smtp.configured ? "stored" : "relay user"} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtp-pass">Password</Label>
            <Input
              id="smtp-pass"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={smtp.configured ? "keep stored password" : "relay password"}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtp-from">From address</Label>
            <Input id="smtp-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="vortex@vortex.internal" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="smtp-secure">Implicit TLS (port 465)</Label>
            <div className="flex items-center h-9">
              <Switch id="smtp-secure" checked={secure} onCheckedChange={setSecure} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={!canSave || busy !== null}>
            {busy === "save" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlugZap className="w-4 h-4 mr-2" />}
            Save SMTP
          </Button>
          <Button variant="outline" onClick={test} disabled={busy !== null}>
            {busy === "test" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Send test mail
          </Button>
          {smtp.configured && smtp.source === "db" && (
            <Button variant="ghost" className="text-red-400 hover:text-red-300" onClick={clear} disabled={busy !== null}>
              {busy === "clear" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Clear
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Delivery activates when provider is <code className="font-mono text-primary">smtp</code> or{" "}
            <code className="font-mono text-primary">postal</code> and these settings are saved.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderSelect({ provider, onDone }: { provider: string; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  return (
    <Select
      value={provider}
      onValueChange={async (v) => {
        setSaving(true);
        const res = await api("/api/v1/mail", { method: "POST", body: { op: "provider", provider: v } });
        setSaving(false);
        if (res.ok) {
          toast({ title: `Provider set to ${v}` });
          onDone();
        } else {
          toast({ title: "Update failed", description: res.error, variant: "destructive" });
        }
      }}
      disabled={saving}
    >
      <SelectTrigger className="w-36" aria-label="Mail provider">
        <SelectValue />
        {saving && <Loader2 className="w-3 h-3 animate-spin" />}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="simulated">simulated</SelectItem>
        <SelectItem value="smtp">smtp</SelectItem>
        <SelectItem value="postal">postal</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ComposeCard({ onDone }: { onDone: () => void }) {
  const [to, setTo] = useState("admin@vortex.local");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("system");
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    const res = await api("/api/v1/mail", { method: "POST", body: { op: "send", to, subject, body, category } });
    setSending(false);
    if (res.ok) {
      toast({ title: "Mail queued to outbox" });
      setSubject("");
      setBody("");
      onDone();
    } else {
      toast({ title: "Send failed", description: res.error, variant: "destructive" });
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <h4 className="font-semibold flex items-center gap-2">
          <Mail className="w-4 h-4 text-primary" /> Compose
        </h4>
        <div className="space-y-1.5">
          <Label htmlFor="mail-to">To</Label>
          <Input id="mail-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="owner@vortex.local" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mail-cat">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="mail-cat" aria-label="Mail category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">system</SelectItem>
              <SelectItem value="otp">otp</SelectItem>
              <SelectItem value="alert">alert</SelectItem>
              <SelectItem value="notify">notify</SelectItem>
              <SelectItem value="deploy">deploy</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mail-subject">Subject</Label>
          <Input id="mail-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Weekly platform digest" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mail-body">Body</Label>
          <Textarea id="mail-body" value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Plain-text body — placeholder {{vars}} come from templates" />
        </div>
        <Button className="w-full" onClick={send} disabled={sending || !subject.trim() || !body.trim()}>
          {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
          Send via outbox
        </Button>
      </CardContent>
    </Card>
  );
}

function TemplatesCard({ templates, onDone }: { templates: MailTemplateRow[]; onDone: () => void }) {
  const [editing, setEditing] = useState<MailTemplateRow | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  function openEdit(t: MailTemplateRow) {
    setEditing(t);
    setSubject(t.subject);
    setBody(t.body);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const res = await api("/api/v1/mail", { method: "POST", body: { op: "template.save", key: editing.key, subject, body } });
    setSaving(false);
    if (res.ok) {
      toast({ title: "Template saved" });
      setEditing(null);
      onDone();
    } else {
      toast({ title: "Save failed", description: res.error, variant: "destructive" });
    }
  }

  async function toggle(t: MailTemplateRow) {
    const res = await api("/api/v1/mail", { method: "POST", body: { op: "template.save", key: t.key, enabled: !t.enabled } });
    if (res.ok) {
      toast({ title: t.enabled ? "Template disabled" : "Template enabled" });
      onDone();
    } else {
      toast({ title: "Update failed", description: res.error, variant: "destructive" });
    }
  }

  return (
    <Card>
      <CardContent className="p-5">
        <h4 className="font-semibold mb-3 flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" /> System templates ({"{{vars}}"} rendered on send)
        </h4>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <div key={t.id} className="rounded-lg border border-border/60 p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{t.name}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">{t.key}</p>
                </div>
                <Switch checked={t.enabled} onCheckedChange={() => toggle(t)} aria-label={`Toggle ${t.name}`} />
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{t.subject}</p>
              <div className="flex items-center justify-between mt-auto pt-1">
                <Badge variant="outline" className="text-[10px]">{t.category}</Badge>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => openEdit(t)}>
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const res = await api("/api/v1/mail", { method: "POST", body: { op: "send.template", templateKey: t.key, vars: { code: "482913", minutes: "5", severity: "WARNING", target: "vortex-app-01", message: "sample check message (template preview)", time: fmtDate(new Date().toISOString()), app: "flarex", version: "2.4.0", deployId: "dep_preview", stage: "deploy", error: "sample error", backupId: "bkp_preview", sizeMb: "3011", cipher: "age-x25519", tierDisk: "on", tierCluster: "on", tierOffsite: "queued", date: fmtDate(new Date().toISOString()), apps: "5", requests: "128,402", blocked: "37", backups: "9", tokens: "1.34M" } } });
                      if (res.ok) {
                        toast({ title: "Preview sent to outbox" });
                        onDone();
                      } else {
                        toast({ title: "Preview failed", description: res.error, variant: "destructive" });
                      }
                    }}
                  >
                    Preview
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit template — {editing?.name}</DialogTitle>
            <DialogDescription>
              Placeholders like <code className="font-mono text-primary">{"{{code}}"}</code> are filled at send time.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-subject">Subject</Label>
              <Input id="tpl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-body">Body</Label>
              <Textarea id="tpl-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
