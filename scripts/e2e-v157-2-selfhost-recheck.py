#!/usr/bin/env python3
"""v157.2 — re-run the self-host publish E2E on the freshly forged runtime.
1. owner login -> cookie
2. list projects -> find vortex-hosting-proof project (fallback: any project)
3. POST /api/deploy legacy target 'github-pages' -> must AUTO-REDIRECT to self-host
4. GET /sites/<slug>/ (with slash) -> 200 real HTML
5. GET /sites/<slug> (no slash) -> also 200 (skipTrailingSlashRedirect)
6. anonymous GET (no cookie) -> still 200 (public site)
Prints a PASS/FAIL line per check. Exits non-zero if any FAIL.
"""
import json, sys, urllib.request, http.cookiejar

BASE = 'http://127.0.0.1:3000'
OWNER = ('mdhonabali61@gmail.com', 'DCnTt8wwtuj3f6R')

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def req(method, path, body=None, raw=False):
    r = urllib.request.Request(BASE + path, method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        r.add_header('Content-Type', 'application/json')
    try:
        resp = opener.open(r, data=data, timeout=120)
        payload = resp.read()
        return resp.status, (payload if raw else json.loads(payload or b'{}'))
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:300]

fails = []
def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(detail)[:120] if detail else ''))
    if not ok: fails.append(name)

# 1. owner login
s, b = req('POST', '/api/auth/login', {'email': OWNER[0], 'password': OWNER[1]})
check('owner login', s == 200 and (b.get('ok') if isinstance(b, dict) else True), f'status={s}')

# 2. find the proof project (or any)
s, b = req('GET', '/api/projects')
pid, pname = None, None
if s == 200 and isinstance(b, dict):
    arr = b.get('projects') or b.get('data') or []
    for p in arr:
        if 'proof' in str(p.get('name', '')).lower():
            pid, pname = p['id'], p.get('name'); break
    if pid is None and arr:
        pid, pname = arr[0]['id'], arr[0].get('name')
check('project found', pid is not None, f'name={pname} id={pid}')

# 3. deploy via LEGACY target -> auto-redirect to self-host
s, b = req('POST', '/api/deploy', {'projectId': pid, 'target': 'github-pages'})
ok = s == 200 and isinstance(b, dict) and b.get('ok') and b.get('target') == 'self-host' and b.get('redirected')
check('deploy legacy->self-host redirect', ok, b if isinstance(b, dict) else f'status={s}')
live = (b.get('liveUrl') if isinstance(b, dict) else None) or ''
print('   liveUrl =', live)

# 4. published site with trailing slash (public, no cookies)
anon = urllib.request.build_opener()  # no cookie jar
s2 = None; html = b''
try:
    r = anon.open(BASE + live, timeout=30); s2 = r.status; html = r.read()
except urllib.error.HTTPError as e:
    s2 = e.code; html = e.read()[:200]
check('site serves 200 with slash', s2 == 200 and b'<' in html[:400], f'status={s2} bytes={len(html)}')

# 5. no-slash variant
try:
    r = anon.open(BASE + live.rstrip('/'), timeout=30); s3 = r.status
except urllib.error.HTTPError as e:
    s3 = e.code
check('site serves 200 without slash', s3 == 200, f'status={s3}')

# 6. anonymous GET is truly public (already proven by 4) + version banner
try:
    r = anon.open(BASE + '/api/version', timeout=15); v = json.loads(r.read())
    check('buildId live', v.get('ok') is True, str(v.get('buildId')))
except Exception as e:
    check('buildId live', False, e)

print('---')
print('ALL PASS' if not fails else f'{len(fails)} FAILURES: {fails}')
sys.exit(1 if fails else 0)
