#!/usr/bin/env python3
"""v157.2 — FULL self-host publish E2E with a fresh proof project.
1. owner login
2. create project "vortex-hosting-proof" via API
3. write static files into projects/<id>/
4. POST /api/deploy legacy target 'github-pages' -> must AUTO-REDIRECT to self-host
5. GET /sites/<slug>/ (slash + no-slash, anonymous) -> 200 real HTML with our marker
6. re-deploy -> version bumps to v2
Prints PASS/FAIL per check; exits non-zero on failure.
"""
import json, os, sys, urllib.request, http.cookiejar

BASE = 'http://127.0.0.1:3000'
OWNER = ('mdhonabali61@gmail.com', 'DCnTt8wwtuj3f6R')
PROJECTS = '/home/z/my-project/projects'

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def req(method, path, body=None):
    r = urllib.request.Request(BASE + path, method=method)
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        r.add_header('Content-Type', 'application/json')
    try:
        resp = opener.open(r, data=data, timeout=120)
        return resp.status, json.loads(resp.read() or b'{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}

fails = []
def check(name, ok, detail=''):
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(detail)[:160] if detail else ''))
    if not ok: fails.append(name)

s, b = req('POST', '/api/auth/login', {'email': OWNER[0], 'password': OWNER[1]})
check('owner login', s == 200, f'status={s}')

s, b = req('POST', '/api/projects', {'name': 'vortex-hosting-proof', 'description': 'v157.2 self-host publish proof'})
pid = (b.get('project') or {}).get('id') if isinstance(b, dict) else None
if pid is None and isinstance(b, dict):
    pid = b.get('id')
check('project created', s in (200, 201) and pid is not None, f'{s} {str(b)[:120]}')

MARK = 'VORTEX-SELFHOST-PROOF-157'
html = f'''<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vortex Hosting Proof</title><style>body{{font-family:system-ui;display:grid;place-items:center;min-height:90vh;margin:0;background:#0b1020;color:#e8ecff}}
main{{text-align:center}}h1{{font-size:2rem}}code{{background:#1a2340;padding:.2rem .5rem;border-radius:6px}}</style></head>
<body><main><h1>Published INSIDE Vortex</h1>
<p>This page is served by the Vortex Cloud Agent platform's own server at <code>/sites/</code>.</p>
<p>No third-party hosting. One platform: build, host, publish, live.</p>
<p><code>{MARK}</code></p></main></body></html>'''

os.makedirs(os.path.join(PROJECTS, pid), exist_ok=True)
with open(os.path.join(PROJECTS, pid, 'index.html'), 'w') as f:
    f.write(html)
with open(os.path.join(PROJECTS, pid, 'vortex.txt'), 'w') as f:
    f.write('v157.2 self-host proof\n')
check('static files written', os.path.exists(os.path.join(PROJECTS, pid, 'index.html')), pid)

s, b = req('POST', '/api/deploy', {'projectId': pid, 'target': 'github-pages'})
print('   deploy raw =', json.dumps(b)[:400], file=sys.stderr)
ok = s == 200 and b.get('ok') and b.get('target') == 'self-host' and b.get('redirected') and b.get('version') == 1
live = b.get('liveUrl') or ''
check('deploy legacy->self-host (v1)', ok, f'{s} {str(b)[:150]}')
print('   liveUrl =', live)
if live.startswith('http://'):
    live = live.replace(BASE, '', 1) if live.startswith(BASE) else '/' + live.split('/', 3)[-1]
    print('   normalized liveUrl =', live, file=sys.stderr)

anon = urllib.request.build_opener()
s2 = None; html2 = b''
try:
    r = anon.open(BASE + live, timeout=30); s2 = r.status; html2 = r.read()
except urllib.error.HTTPError as e:
    s2 = e.code
check('public GET with slash = 200 + marker', s2 == 200 and MARK.encode() in html2, f'status={s2} bytes={len(html2)}')
try:
    r = anon.open(BASE + live.rstrip('/'), timeout=30); s3 = r.status
except urllib.error.HTTPError as e:
    s3 = e.code
check('public GET without slash = 200', s3 == 200, f'status={s3}')

s, b = req('POST', '/api/deploy', {'projectId': pid, 'target': 'self-host'})
ok2 = s == 200 and b.get('ok') and b.get('version') == 2
check('re-deploy bumps to v2', ok2, f'{s} version={b.get("version") if isinstance(b, dict) else "?"}')

print('---')
print('ALL PASS' if not fails else f'{len(fails)} FAILURES: {fails}')
sys.exit(1 if fails else 0)
