#!/usr/bin/env python3
"""BUSINESS v2 ownership guard patcher v2 — correct insertion inside handlers."""
import re

BASE = '/home/z/my-project/'
GUARD_TMPL = (
    "  // BUSINESS v2: verify the caller owns this project (admins exempt).\n"
    "  if (projectId) {{\n"
    "    try {{ await requireProjectAccess(req, projectId) }} catch (e: any) {{ if (e instanceof Response) return e as any; throw e }}\n"
    "  }}\n"
)
IMPORT = "import { requireProjectAccess } from '@/lib/auth'"

def add_import(s: str) -> str:
    ms = list(re.finditer(r"^import [^\n]+$", s, re.M))
    pos = ms[-1].end()
    return s[:pos] + "\n" + IMPORT + s[pos:]

def find_insert_pos(s: str):
    """Return (line_index_to_insert_after) — after the projectId null-check if present."""
    lines = s.split('\n')
    assign_idx = None
    for i, ln in enumerate(lines):
        if re.search(r"(const|let)\s+[^\n]*\bprojectId\b[^=]*=", ln) or re.search(r"\{[^}]*\bprojectId\b[^}]*\}\s*=\s*body", ln):
            assign_idx = i
            break
    if assign_idx is None:
        return None
    # look ahead for a null-check on projectId
    for j in range(assign_idx, min(assign_idx + 6, len(lines))):
        ln = lines[j]
        if 'if (!projectId' in ln:
            stripped = ln.strip()
            # single-line if: `if (!projectId) return ...` (no opening brace at end)
            if not stripped.endswith('{'):
                return j
            # block form: find the closing '}' line
            k = j + 1
            while k < len(lines):
                if lines[k].strip() == '}':
                    return k
                k += 1
            return j
    return assign_idx

def patch_generic(path: str) -> str:
    s = open(path).read()
    if 'requireProjectAccess' in s:
        return 'already'
    pos = find_insert_pos(s)
    if pos is None:
        return 'NO_PROJECT_ID_ASSIGN'
    s2 = add_import(s)
    pos2 = find_insert_pos(s2)
    if pos2 is None:
        return 'NO_PROJECT_ID_ASSIGN'
    guard = GUARD_TMPL.format()
    lines = s2.split('\n')
    lines.insert(pos2 + 1, guard.rstrip('\n'))
    open(path, 'w').write('\n'.join(lines))
    return f'OK@line{pos2+1}'

generic = [
 'src/app/api/aso-listing/route.ts','src/app/api/assets/generate/route.ts','src/app/api/builds/route.ts',
 'src/app/api/deploy/route.ts','src/app/api/files/route.ts','src/app/api/git/route.ts',
 'src/app/api/github/operations/route.ts','src/app/api/growth-tools/route.ts',
 'src/app/api/projects/storage/route.ts','src/app/api/publish/route.ts','src/app/api/pwa-setup/route.ts',
 'src/app/api/runs/route.ts','src/app/api/runtime/route.ts','src/app/api/schedules/route.ts',
 'src/app/api/sdks/provision/route.ts','src/app/api/search/route.ts','src/app/api/security-scan/route.ts',
 'src/app/api/settings/route.ts','src/app/api/templates/route.ts','src/app/api/terminal/route.ts',
 'src/app/api/versions/route.ts','src/app/api/analytics/route.ts','src/app/api/secrets/test/route.ts',
]

for p in generic:
    print(f"{patch_generic(BASE + p):16} {p}")
