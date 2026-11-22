"use client";

import { useRef, useState } from "react";
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
import {
  Archive,
  ArchiveRestore,
  Download,
  File as FileIcon,
  FileArchive,
  FileCode2,
  FileImage,
  FileJson2,
  FileText,
  FolderOpen,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { api, fmtAgo, fmtBytes, type BucketRow, type FileRow } from "../client";

const FILE_STATUS: Record<string, string> = {
  ACTIVE: "border-emerald-500/40 text-emerald-400",
  ARCHIVED: "border-sky-500/40 text-sky-400",
  DELETED: "border-red-500/40 text-red-400",
};

function MimeIcon({ mime, className }: { mime: string; className?: string }) {
  if (mime.startsWith("image/")) return <FileImage className={className} />;
  if (mime.startsWith("video/") || mime.startsWith("audio/")) return <FileArchive className={className} />;
  if (mime === "application/json") return <FileJson2 className={className} />;
  if (mime.includes("javascript") || mime.includes("css") || mime.includes("html") || mime.includes("xml")) return <FileCode2 className={className} />;
  if (mime.startsWith("text/")) return <FileText className={className} />;
  return <FileIcon className={className} />;
}

export default function FilesView({ onChanged }: { onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">Files</h3>
        <p className="text-sm text-muted-foreground">
          The file layer on top of STORAGE: upload (real bytes to the volume), download with sha256 integrity check on
          every read, version counter on overwrite, trash before purge. Every object belongs to one app.
        </p>
      </div>
      <FilesBrowser onChanged={onChanged} />
    </div>
  );
}

function FilesBrowser({ onChanged }: { onChanged: () => void }) {
  const [bucketFilter, setBucketFilter] = useState("all");

  const q = useQuery({
    queryKey: ["files", bucketFilter],
    queryFn: () =>
      api<{ buckets: BucketRow[]; files: FileRow[]; stats: { files: number; activeBytes: number; trashed: number } }>(
        `/api/v1/files${bucketFilter !== "all" ? `?bucketId=${encodeURIComponent(bucketFilter)}` : ""}`
      ),
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
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Objects" value={s ? `${s.files}` : "…"} hint="in view (all states)" />
        <StatTile label="Stored" value={s ? fmtBytes(s.activeBytes) : "…"} hint="active + archived bytes" />
        <StatTile label="In trash" value={s ? `${s.trashed}` : "…"} hint="purge frees the volume" />
      </div>

      <div className="flex flex-col sm:flex-row justify-between gap-2">
        <Select value={bucketFilter} onValueChange={setBucketFilter}>
          <SelectTrigger className="w-full sm:w-[240px]">
            <SelectValue placeholder="Bucket" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All buckets</SelectItem>
            {(data?.buckets ?? []).map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <UploadDialog onUploaded={reload} />
      </div>

      {!data && <Skeleton className="h-72 rounded-xl" />}

      {data && (
        <Card>
          <CardContent className="p-0">
            <div className="max-h-[34rem] overflow-y-auto vortex-scroll">
              {data.files.length === 0 && (
                <p className="text-sm text-muted-foreground p-6 text-center flex items-center justify-center gap-2">
                  <FolderOpen className="w-4 h-4" /> No objects here yet — upload something.
                </p>
              )}
              {data.files.map((f) => (
                <FileRowItem key={f.id} file={f} onChanged={reload} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
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

function FileRowItem({ file, onChanged }: { file: FileRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function patch(action: string, msg: string) {
    setBusy(true);
    const res = await api("/api/v1/files", { method: "PATCH", body: { id: file.id, action } });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Action failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: msg });
    onChanged();
  }

  async function trash() {
    setBusy(true);
    const res = await api(`/api/v1/files?id=${encodeURIComponent(file.id)}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Trash failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${file.name} moved to trash` });
    onChanged();
  }

  async function purge() {
    setBusy(true);
    const res = await api(`/api/v1/files?id=${encodeURIComponent(file.id)}&purge=true`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Purge failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({ title: `${file.name} purged — bytes removed from the volume` });
    onChanged();
  }

  return (
    <div className="flex flex-col xl:flex-row xl:items-center gap-2 xl:gap-3 px-4 py-3 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <MimeIcon mime={file.mime} className="w-4 h-4 text-primary shrink-0" />
        <code className="font-mono text-xs truncate" title={`${file.bucket?.name}/${file.path}`}>
          {file.bucket?.name}/{file.path}
        </code>
        <Badge variant="outline" className="text-[10px] text-muted-foreground">v{file.version}</Badge>
        <Badge variant="outline" className={`text-[10px] ${FILE_STATUS[file.status] || ""}`}>{file.status}</Badge>
      </div>
      <div className="flex-1 min-w-0 text-xs text-muted-foreground">
        <span>{fmtBytes(file.sizeBytes)} · {file.mime}</span>
        <span className="block opacity-70 truncate" title={file.checksum}>
          sha256:{file.checksum.slice(0, 16)}… · {file.uploadedBy || "system"} · {fmtAgo(file.updatedAt)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {file.status !== "DELETED" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => window.open(`/api/v1/files/download?id=${encodeURIComponent(file.id)}`, "_blank")}
          >
            <Download className="w-3 h-3 mr-1" /> Download
          </Button>
        )}
        {file.status === "ACTIVE" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch("ARCHIVE", `${file.name} archived`)}>
            <Archive className="w-3.5 h-3.5" />
          </Button>
        )}
        {["ARCHIVED", "DELETED"].includes(file.status) && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch("RESTORE", `${file.name} restored to ACTIVE`)}>
            <ArchiveRestore className="w-3.5 h-3.5" />
          </Button>
        )}
        {file.status !== "DELETED" && (
          <Button size="sm" variant="ghost" className="text-amber-400" disabled={busy} onClick={trash}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
        {file.status === "DELETED" && (
          <Button size="sm" variant="ghost" className="text-red-400" disabled={busy} onClick={purge}>
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Purge
          </Button>
        )}
      </div>
    </div>
  );
}

function UploadDialog({ onUploaded }: { onUploaded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bucketId, setBucketId] = useState("");
  const [path, setPath] = useState("");
  const [contentBase64, setContentBase64] = useState("");
  const [pickedName, setPickedName] = useState("");
  const [pickedSize, setPickedSize] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const q = useQuery({
    queryKey: ["files", "all"],
    queryFn: () => api<{ buckets: BucketRow[] }>("/api/v1/files"),
    enabled: open,
  });
  const buckets = (q.data?.ok ? q.data.data?.buckets ?? [] : []).filter((b) => b.status === "ACTIVE");

  function onPickFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 5 * 1_000_000) {
      toast({ title: "File too large", description: "The control plane accepts up to 5 MB per upload.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      setContentBase64(base64);
      setPickedName(f.name);
      setPickedSize(f.size);
      if (!path) setPath(f.name);
    };
    reader.readAsDataURL(f);
  }

  async function upload() {
    setBusy(true);
    const res = await api<{ overwritten: boolean }>("/api/v1/files", {
      method: "POST",
      body: { bucketId, path, contentBase64 },
    });
    setBusy(false);
    if (!res.ok) {
      toast({ title: "Upload failed", description: res.error, variant: "destructive" });
      return;
    }
    toast({
      title: res.data?.overwritten ? `${path} — new version stored (v bumped)` : `${path} uploaded — 3 copies, checksummed`,
    });
    setOpen(false);
    setContentBase64("");
    setPickedName("");
    setPickedSize(0);
    setPath("");
    onUploaded();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Upload className="w-4 h-4 mr-1" /> Upload object
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload an object</DialogTitle>
          <DialogDescription>
            Bytes go to the bucket&apos;s volume with 3x replication; the sha256 checksum is computed from the real
            buffer and verified on every download. Overwriting the same path bumps the version.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Bucket</Label>
            <Select value={bucketId} onValueChange={setBucketId}>
              <SelectTrigger><SelectValue placeholder="Select bucket" /></SelectTrigger>
              <SelectContent>
                {buckets.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} · {fmtBytes(b.quotaMb * 1_000_000 - b.usedMb * 1_000_000)} free
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="up-file">Pick a file (max 5 MB)</Label>
            <Input id="up-file" type="file" ref={fileInput} onChange={(e) => onPickFile(e.target.files?.[0])} />
            {pickedName && (
              <p className="text-xs text-muted-foreground">
                {pickedName} — {fmtBytes(pickedSize)} ready
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="up-path">Object path in bucket</Label>
            <Input id="up-path" placeholder="e.g. media/launch.jpg" value={path} onChange={(e) => setPath(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={busy || !bucketId || !path || !contentBase64} onClick={upload}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
