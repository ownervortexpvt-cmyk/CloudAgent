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
import { Bell, Loader2, Plus, Trash2, Zap, CheckCheck, Radio } from "lucide-react";
import { api, fmtAgo, type NotifyState, type ChannelRow } from "../client";

const SEVERITY_CLASS: Record<string, string> = {
  CRITICAL: "border-red-500/40 text-red-400",
  WARNING: "border-amber-500/40 text-amber-400",
  INFO: "border-sky-500/40 text-sky-400",
};

const TYPE_CLASS: Record<string, string> = {
  INAPP: "border-violet-500/40 text-violet-300",
  EMAIL: "border-emerald-500/40 text-emerald-400",
  WEBHOOK: "border-amber-500/40 text-amber-400",
};

const EVENT_TYPES = ["ALERT_OPEN", "DEPLOY_FAILED", "BACKUP_FAILED", "SECURITY_BLOCK", "AI_JOB_FAILED"];

export default function NotifyView({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({
    queryKey: ["notify"],
    queryFn: () => api<NotifyState>("/api/v1/notify"),
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

  async function post(body: Record<string, unknown>, okTitle: string) {
    const res = await api("/api/v1/notify", { method: "POST", body });
    if (res.ok) {
      toast({ title: okTitle });
      reload();
    } else {
      toast({ title: "Action failed", description: res.error, variant: "destructive" });
    }
    return res;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">NOTIFY — event fan-out</h3>
        <p className="text-sm text-muted-foreground">
          Platform events route through rules to channels: the in-app feed, the mail outbox, or app
          webhooks (delivery is simulated until apps answer their hooks). Rules carry severity
          thresholds — a WARNING alert never pages the ops webhook.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Unread (in-app)</p>
              <Bell className="w-4 h-4 text-primary" />
            </div>
            <p className="text-2xl font-bold mt-2">{data.stats.unread}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 px-2 h-7 text-xs"
              onClick={() => post({ op: "read.all" }, "All marked read")}
              disabled={data.stats.unread === 0}
            >
              <CheckCheck className="w-3.5 h-3.5 mr-1" /> Mark all read
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Channels</p>
            <p className="text-2xl font-bold mt-2">{data.channels.length}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.channels.filter((c) => c.enabled).length} enabled · fan-out targets
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Rules armed</p>
            <p className="text-2xl font-bold mt-2">{data.rules.filter((r) => r.enabled).length}</p>
            <p className="text-xs text-muted-foreground mt-1">of {data.rules.length} routing rules</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Delivered 24h</p>
            <p className="text-2xl font-bold mt-2">{data.stats.delivered24h}</p>
            <p className="text-xs text-muted-foreground mt-1">fan-out batches across channels</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Channels */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold flex items-center gap-2">
                <Radio className="w-4 h-4 text-primary" /> Channels
              </h4>
              <NewChannelDialog channels={data.channels} onCreate={(b) => post({ op: "channel.create", ...b }, "Channel created")} />
            </div>
            <div className="space-y-2">
              {data.channels.map((c) => (
                <div key={c.id} className="rounded-lg border border-border/60 px-3 py-2.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium">{c.name}</p>
                      <Badge variant="outline" className={`text-[10px] ${TYPE_CLASS[c.type] || ""}`}>{c.type}</Badge>
                      {c.isSystem && (
                        <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                          system
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {c.target || "in-app feed"} · {c._count.rules} rule{c._count.rules === 1 ? "" : "s"}
                      {c.app ? ` · ${c.app.name}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={c.enabled}
                      onCheckedChange={() => post({ op: "channel.toggle", channelId: c.channelId }, c.enabled ? "Channel disabled" : "Channel enabled")}
                      aria-label={`Toggle ${c.name}`}
                    />
                    {!c.isSystem && (
                      <Button variant="ghost" size="icon" aria-label={`Delete ${c.name}`} onClick={() => post({ op: "channel.delete", channelId: c.channelId }, "Channel deleted")}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Rules */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" /> Routing rules
              </h4>
              <NewRuleDialog channels={data.channels} onCreate={(b) => post({ op: "rule.create", ...b }, "Rule created")} />
            </div>
            <div className="space-y-2">
              {data.rules.map((r) => (
                <div key={r.id} className="rounded-lg border border-border/60 px-3 py-2.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      fires at <span className="font-mono">{r.minSeverity}</span>+ · {r.enabled ? "armed" : "paused"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={() => post({ op: "rule.toggle", id: r.ruleId }, r.enabled ? "Rule paused" : "Rule armed")}
                      aria-label={`Toggle ${r.name}`}
                    />
                    <Button variant="ghost" size="icon" aria-label={`Delete ${r.name}`} onClick={() => post({ op: "rule.delete", id: r.ruleId }, "Rule deleted")}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Feed */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h4 className="font-semibold flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" /> In-app feed
            </h4>
            <EmitEventDialog onEmit={(b) => post({ op: "emit", ...b }, "Test event fired through the fan-out")} />
          </div>
          <ScrollArea className="max-h-96">
            <div className="space-y-2 pr-3">
              {data.feed.length === 0 && <p className="text-sm text-muted-foreground">Feed is empty — fire a test event.</p>}
              {data.feed.map((n) => (
                <button
                  key={n.id}
                  onClick={() => !n.readAt && post({ op: "read", id: n.id }, "Marked read")}
                  className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                    n.readAt ? "border-border/60 opacity-70" : "border-primary/30 bg-primary/5"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className={`text-sm ${n.readAt ? "font-normal" : "font-medium"} truncate`}>{n.title}</p>
                        <Badge variant="outline" className={`text-[10px] ${SEVERITY_CLASS[n.severity] || ""}`}>{n.severity}</Badge>
                        <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">{n.source}</Badge>
                        {n.channelType !== "INAPP" && (
                          <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">{n.channelType}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{n.body}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{fmtAgo(n.createdAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function NewChannelDialog({ channels, onCreate }: { channels: ChannelRow[]; onCreate: (b: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("WEBHOOK");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="w-3.5 h-3.5 mr-1" /> Channel
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New notification channel</DialogTitle>
          <DialogDescription>INAPP needs no target. EMAIL takes an address, WEBHOOK takes an app endpoint URL.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ch-name">Name</Label>
            <Input id="ch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="FLAREX moderation hooks" />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger aria-label="Channel type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INAPP">INAPP — in-app feed</SelectItem>
                <SelectItem value="EMAIL">EMAIL — mail outbox</SelectItem>
                <SelectItem value="WEBHOOK">WEBHOOK — app endpoint</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {type !== "INAPP" && (
            <div className="space-y-1.5">
              <Label htmlFor="ch-target">{type === "EMAIL" ? "Email address" : "Webhook URL"}</Label>
              <Input
                id="ch-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={type === "EMAIL" ? "owner@vortex.local" : "https://flarex.apps.vortex.internal/hooks"}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Existing channels: {channels.map((c) => c.name).join(", ") || "none"}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !name.trim() || (type !== "INAPP" && !target.trim())}
            onClick={async () => {
              setBusy(true);
              await onCreate({ name, type, target });
              setBusy(false);
              setOpen(false);
              setName("");
              setTarget("");
            }}
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create channel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewRuleDialog({ channels, onCreate }: { channels: ChannelRow[]; onCreate: (b: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const [eventType, setEventType] = useState(EVENT_TYPES[0]);
  const [minSeverity, setMinSeverity] = useState("INFO");
  const [channelId, setChannelId] = useState(channels[0]?.channelId || "");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="w-3.5 h-3.5 mr-1" /> Rule
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New routing rule</DialogTitle>
          <DialogDescription>The rule fires when an event matches the type AND meets the severity floor.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Event type</Label>
            <Select value={eventType} onValueChange={setEventType}>
              <SelectTrigger aria-label="Event type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((e) => (
                  <SelectItem key={e} value={e}>
                    {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Minimum severity</Label>
            <Select value={minSeverity} onValueChange={setMinSeverity}>
              <SelectTrigger aria-label="Minimum severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INFO">INFO and above</SelectItem>
                <SelectItem value="WARNING">WARNING and above</SelectItem>
                <SelectItem value="CRITICAL">CRITICAL only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Deliver to channel</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger aria-label="Channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={c.channelId} value={c.channelId}>
                    {c.name} ({c.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !channelId}
            onClick={async () => {
              setBusy(true);
              await onCreate({ eventType, minSeverity, channelId });
              setBusy(false);
              setOpen(false);
            }}
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Create rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmitEventDialog({ onEmit }: { onEmit: (b: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const [eventType, setEventType] = useState(EVENT_TYPES[0]);
  const [severity, setSeverity] = useState("WARNING");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Zap className="w-3.5 h-3.5 mr-1" /> Fire test event
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fire a test event</DialogTitle>
          <DialogDescription>Goes through the REAL fan-out — every matching rule delivers it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Event type</Label>
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger aria-label="Event type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger aria-label="Severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INFO">INFO</SelectItem>
                  <SelectItem value="WARNING">WARNING</SelectItem>
                  <SelectItem value="CRITICAL">CRITICAL</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-title">Title</Label>
            <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Manual drill: backup pipeline check" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-msg">Message</Label>
            <Input id="ev-msg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Fired from the NOTIFY console" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onEmit({ eventType, severity, title, message });
              setBusy(false);
              setOpen(false);
              setTitle("");
              setMessage("");
            }}
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Fire event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
