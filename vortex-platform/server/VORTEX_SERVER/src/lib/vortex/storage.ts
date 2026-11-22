import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync, rmSync } from "fs";
import path from "path";
import { createHash } from "crypto";

/**
 * VORTEX STORAGE — embedded object-storage engine (Phase 4).
 *
 * Design follows the locked decision: SeaweedFS (Apache-2.0) — never MinIO (AGPL).
 * This is the control-plane engine: real bytes land on disk under
 *   <root>/<volume>/<bucket>/<object path>
 * Layout mirrors a SeaweedFS topology (volume servers holding collections).
 * Every object is bound to an app (data gravity) and checksummed (sha256);
 * reads verify the checksum — corruption is detected, not silent.
 */

export function storageRoot(): string {
  return process.env.VORTEX_STORAGE_ROOT || path.join(process.cwd(), ".vortex-storage");
}

/** Object keys: relative, no leading/trailing slashes, no "..", no empty segments. */
export function sanitizeObjectPath(raw: string): string | null {
  const cleaned = raw
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (cleaned.length === 0) return null;
  for (const seg of cleaned) {
    if (seg === "." || seg === ".." || seg.includes("\0")) return null;
  }
  const joined = cleaned.join("/");
  return joined.length > 400 ? null : joined;
}

function volumeDir(volumeName: string): string {
  return path.join(storageRoot(), volumeName);
}

export function bucketDir(volumeName: string, bucketName: string): string {
  return path.join(volumeDir(volumeName), bucketName);
}

export function ensureBucketDir(volumeName: string, bucketName: string): void {
  mkdirSync(bucketDir(volumeName, bucketName), { recursive: true });
}

export function removeBucketDir(volumeName: string, bucketName: string): void {
  const dir = bucketDir(volumeName, bucketName);
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup; registry state stays authoritative
  }
}

export type StoredObject = { sizeBytes: number; checksum: string; absPath: string };

/** Write object bytes to the volume and return size + sha256 checksum. */
export function writeObject(
  volumeName: string,
  bucketName: string,
  objectPath: string,
  data: Buffer
): StoredObject {
  const abs = path.join(bucketDir(volumeName, bucketName), objectPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  return {
    sizeBytes: data.length,
    checksum: createHash("sha256").update(data).digest("hex"),
    absPath: abs,
  };
}

/** Read object bytes; caller must verify the checksum (verifyObject). */
export function readObject(volumeName: string, bucketName: string, objectPath: string): Buffer {
  const abs = path.join(bucketDir(volumeName, bucketName), objectPath);
  return readFileSync(abs);
}

export function objectExists(volumeName: string, bucketName: string, objectPath: string): boolean {
  return existsSync(path.join(bucketDir(volumeName, bucketName), objectPath));
}

export function removeObject(volumeName: string, bucketName: string, objectPath: string): void {
  const abs = path.join(bucketDir(volumeName, bucketName), objectPath);
  try {
    unlinkSync(abs);
  } catch {
    // already gone — fine
  }
}

export function sha256Of(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function bucketNameValid(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{2,30}$/.test(name);
}

/** Guess a sane mime from the object key extension. */
export function mimeFromPath(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    txt: "text/plain",
    json: "application/json",
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "text/javascript",
    csv: "text/csv",
    md: "text/markdown",
    xml: "application/xml",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    webm: "video/webm",
    zip: "application/zip",
    woff2: "font/woff2",
  };
  return map[ext] || "application/octet-stream";
}
