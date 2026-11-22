#!/usr/bin/env python3
"""
e2e-v125-publish-fix.py — proves the owner's "Publish er shomoy error" is fixed.

Reproduces the EXACT failing flow over REAL HTTP:
  1. create a project from the 'next' template (what the owner built)
  2. publish target=web → runs the FIXED build pipeline:
     auto npm install (never existed before) + version-aware webpack build
     + child heap cap — the old path crashed with "Failed to load external
     module / Failed to collect page data / Build error occurred"
  3. assert the build row is completed + a downloadable artifact exists
  4. hard-delete the project (owner starts clean)

Usage: python3 scripts/e2e-v125-publish-fix.py
"""
import json, sys, time, urllib.request, urllib.error

BASE = 'http://localhost:3000'
GATE = 'CA-X-MONA-9173'
OWNER = {'email': 'mdhonabali61@gmail.com', 'password': 'Owner123'}
STAMP = str(int(time.time()))
PASS, FAIL = [], []

def check(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print(f"  {'✅' if cond else '❌'} {name}" + (f' — {detail}' if detail and not cond else ''))
    return cond

def req(method, path, body=None, token=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json', 'x-ca-gate': GATE}
    if token: h['x-ca-lock'] = token
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            try: return resp.status, json.loads(resp.read())
            except Exception: return resp.status, {'_raw': resp.read().decode('utf-8', 'replace')[:300]}
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {'error': str(e)}

def main():
    print('── v125 PUBLISH FIX — reproduce the owner flow ──')
    s, d = req('POST', '/api/auth/login', OWNER)
    tok = (d or {}).get('token')
    check('owner login', bool(tok), f's={s}')
    if not tok: sys.exit(1)

    s, d = req('POST', '/api/projects', {'name': f'V125-Pub-{STAMP}', 'templateId': 'next'}, token=tok, timeout=120)
    proj = (d or {}).get('project') or d or {}
    pid = proj.get('id')
    check('next-template project created', s in (200, 201) and pid, f's={s} d={str(d)[:150]}')
    if not pid: sys.exit(1)

    # publish target=web — the EXACT flow that died for the owner
    s, d = req('POST', '/api/publish', {'projectId': pid, 'target': 'web'}, token=tok, timeout=1500)
    ok = s == 200 and d.get('ok') is True
    check('publish target=web SUCCEEDED (build + zip)', ok, f's={s} d={str(d)[:400]}')
    if not ok and d.get('logs'):
        print('  [build logs tail]', str(d.get('logs'))[-800:])
    else:
        art = d.get('artifactPath') or d.get('artifact') or ''
        check('artifact path produced', bool(art), f'art={art}')
        import os, zipfile
        real = art and os.path.isfile(art) and os.path.getsize(art) > 100_000
        check('artifact is a real build output (>100KB)', bool(real), f'art={art}')
        if real:
            z = zipfile.ZipFile(art)
            names = z.namelist()
            check('zip contains next build output (BUILD_ID/manifests)',
                  any(n in names for n in ('BUILD_ID', 'build-manifest.json', 'app-build-manifest.json'))
                  or any(n.startswith('.next/') for n in names), f'entries={len(names)}')
        logs = str(d.get('logs') or '')
        check('no turbopack/external-module crash in logs', ('Failed to load external module' not in logs) and ('collect page data' not in logs) and ('Build error occurred' not in logs))

    s, d = req('DELETE', f'/api/projects/{pid}?hard=1', token=tok)
    check('project hard-deleted (clean end state)', s in (200, 202, 204), f's={s}')

    print(f"\n═══ v125: {len(PASS)} PASS / {len(FAIL)} FAIL ═══")
    if FAIL:
        print('FAILED:', *FAIL, sep='\n  - '); sys.exit(1)

if __name__ == '__main__':
    main()
