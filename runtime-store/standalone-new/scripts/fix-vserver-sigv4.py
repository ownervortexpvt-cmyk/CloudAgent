#!/usr/bin/env python3
"""Fix the corrupted SigV4 canonical-request line in VORTEX_SERVER vserver.ts.

The shipped zip contains:   const canonicalRequest = ethod.toUpperCase(), canonicalUri, ... payloadHash].join("\n");
  - missing the 'm' of `method`
  - missing the opening '[' of the array literal
Fixed:                        const canonicalRequest = [method.toUpperCase(), canonicalUri, ... payloadHash].join("\n");

Idempotent: safe to run multiple times. Verifies by re-reading.
"""
import sys

TARGETS = [
    "/home/z/my-project/vortex-platform/server/VORTEX_SERVER/src/lib/vortex/vserver.ts",
]

BROKEN = 'const canonicalRequest = ethod.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\\n");'
FIXED  = 'const canonicalRequest = [method.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\\n");'

ok = True
for p in TARGETS:
    try:
        src = open(p, "r", encoding="utf-8").read()
    except FileNotFoundError:
        print(f"MISSING  {p}")
        ok = False
        continue
    if FIXED in src:
        print(f"ALREADY-FIXED  {p}")
        continue
    if BROKEN not in src:
        print(f"PATTERN-NOT-FOUND  {p}  (line 177 region unchanged?)")
        ok = False
        continue
    out = src.replace(BROKEN, FIXED, 1)
    with open(p, "w", encoding="utf-8") as f:
        f.write(out)
    # verify immediately
    back = open(p, "r", encoding="utf-8").read()
    if FIXED in back and BROKEN not in back:
        print(f"FIXED-OK  {p}")
    else:
        print(f"WRITE-DID-NOT-STICK  {p}")
        ok = False

sys.exit(0 if ok else 1)
