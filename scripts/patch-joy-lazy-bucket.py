#!/usr/bin/env python3
"""Patch joyData.put in VORTEX_SERVER vserver.ts: lazy Joy-bucket creation.

With storage.provider=joy, every object PUT goes to Joy S3. The vortex server
creates buckets only in its local registry, so the first upload hits
404 NoSuchBucket. Fix: on 404, PUT the bucket (SigV4, empty key) and retry the
object PUT once. Covers all callers (site deploys, appverse, vault archives).
"""
import sys

P = "/home/z/my-project/vortex-platform/server/VORTEX_SERVER/src/lib/vortex/vserver.ts"

OLD = """  async put(bucket: string, key: string, body: Buffer) {
    const c = await joyCreds();
    const res = await joyS3Fetch(c, "PUT", bucket, key, body);
    if (!res.ok) throw new Error(`JOY S3 PUT failed: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
    return { sizeBytes: body.length, checksum: createHash("sha256").update(body).digest("hex") };
  },"""

NEW = """  async put(bucket: string, key: string, body: Buffer) {
    const c = await joyCreds();
    let res = await joyS3Fetch(c, "PUT", bucket, key, body);
    // Joy account buckets are created on demand: NoSuchBucket -> PUT the
    // bucket (SigV4, empty key) and retry the object PUT once. Keeps site
    // deploys, appverse uploads and vault archives working with no manual
    // bucket setup on the Joy console.
    if (res.status === 404) {
      const mk = await joyS3Fetch(c, "PUT", bucket, "");
      if (!mk.ok && mk.status !== 409) throw new Error(`JOY S3 bucket create failed: ${mk.status} ${await mk.text().catch(() => "")}`.slice(0, 300));
      res = await joyS3Fetch(c, "PUT", bucket, key, body);
    }
    if (!res.ok) throw new Error(`JOY S3 PUT failed: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
    return { sizeBytes: body.length, checksum: createHash("sha256").update(body).digest("hex") };
  },"""

src = open(P, encoding="utf-8").read()
if NEW in src:
    print("ALREADY-PATCHED")
    sys.exit(0)
if OLD not in src:
    print("PATTERN-NOT-FOUND — aborting without changes")
    sys.exit(1)
out = src.replace(OLD, NEW, 1)
open(P, "w", encoding="utf-8").write(out)
back = open(P, encoding="utf-8").read()
assert NEW in back, "post-write verify failed"
print("PATCHED-OK")
