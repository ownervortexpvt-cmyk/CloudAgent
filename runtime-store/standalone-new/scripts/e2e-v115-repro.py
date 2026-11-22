#!/usr/bin/env python3
"""v115 — full owner-flow verification:
register → BBD paywall (free, outside window) → admin grants plan → create +
run → billing/me BBD fields → password change (session kept) → preview guard."""
import json, time, urllib.request, urllib.error, sys

BASE = 'http://127.0.0.1:3000'
PASS, FAIL = [], []
GATE = 'CA-X-MONA-9173'  # v123 private-site key — every suite presents it

def req(method, path, body=None, cookie=None, headers=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json'}
    h['x-ca-gate'] = 'CA-X-MONA-9173'  # v123 private-site gate
    if cookie: h['Cookie'] = cookie
    if headers: h.update(headers)
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            ct = resp.headers.get('content-type', '')
            setc = resp.headers.get('set-cookie', '')
            try: out = json.loads(raw) if 'json' in ct else {'_raw': raw[:200].decode('utf-8', 'replace')}
            except Exception: out = {'_raw': raw[:200].decode('utf-8', 'replace')}
            return resp.status, out, setc, ct
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        try: out = json.loads(raw)
        except Exception: out = {'_raw': raw[:300]}
        return e.code, out, e.headers.get('set-cookie', ''), e.headers.get('content-type', '')

def check(name, cond, extra=''):
    (PASS if cond else FAIL).append(name)
    print(('✅' if cond else '❌'), name, ('' if cond else f'  [{extra}]'))

ts = int(time.time())
email = f'v115full{ts}@qa.local'

# 1. register free user
sc, body, setc, _ = req('POST', '/api/auth/register', {'email': email, 'password': 'test115pw', 'name': 'v115 full'})
ck = setc.split(';')[0] if setc else ''
check('register 200', sc == 200 and bool(ck), f'{sc} {str(body)[:100]}')

# 2. free account outside BBD window → honest 402 JSON paywall on project create
sc, body, _, ct = req('POST', '/api/projects', {'name': 'BBD Test', 'language': 'react'}, cookie=ck)
check('free create outside BBD → 402 JSON paywall', sc == 402 and 'json' in ct and 'Big Billion' in str(body.get('error', '')), f'{sc} {str(body)[:120]}')

# 3. billing/me exposes Big Billion Day state
sc, body, _, _ = req('GET', '/api/billing/me', cookie=ck)
bbd = (body or {}).get('bigBillionDay') or {}
check('billing/me has bigBillionDay fields', sc == 200 and isinstance(bbd.get('active'), bool) and bbd.get('nextAt'), f'{sc} {str(body)[:150]}')

# 4. QA admin unlocks room with the 16-digit PIN and grants a plan
sc, body, setc2, _ = req('POST', '/api/auth/login', {'email': 'qa-admin115@qa.local', 'password': 'qatester115'})
ack = setc2.split(';')[0] if setc2 else ''
sc, body, _, _ = req('POST', '/api/admin/panel/session', {'pin': '1000391619244862'}, cookie=ack)
room = body.get('token')
check('room unlock 16-digit PIN', sc == 200 and room, f'{sc}')
AH = {'x-ca-admin': room}

sc, body, _, _ = req('GET', '/api/admin/users', cookie=ack, headers=AH)
uid = next((u['id'] for u in body.get('users', []) if u.get('email') == email), None)
check('admin sees new user', bool(uid), str(body)[:100])

sc, body, _, _ = req('POST', '/api/admin/users', {'action': 'set_plan', 'userId': uid, 'plan': 'ultra'}, cookie=ack, headers=AH)
check('admin set_plan ultra (30d)', sc == 200, f'{sc} {str(body)[:120]}')

# 5. paid account creates project + runs agent
sc, body, _, ct = req('POST', '/api/projects', {'name': 'v115 Happy App', 'description': 'full flow', 'language': 'react'}, cookie=ck)
pid = (body or {}).get('project', {}).get('id')
check('paid create project 200 JSON', sc == 200 and 'json' in ct and pid, f'{sc} {str(body)[:150]}')

sc, body, _, _ = req('GET', '/api/billing/me', cookie=ck)
check('plan now ultra', sc == 200 and (body.get('plan') or {}).get('id') == 'ultra', f'{str(body)[:120]}')

# 6. runtime start (static app server) so preview proxy serves THE APP
sc, body, _, _ = req('POST', '/api/runtime', {'projectId': pid, 'action': 'start'}, cookie=ck, timeout=90)
port = (body or {}).get('port')
check('runtime start returns port', sc == 200 and port, f'{sc} {str(body)[:150]}')
if port:
    time.sleep(2)
    try:
        with urllib.request.urlopen(f'{BASE}/preview/{port}/?_hc=1', timeout=15) as r:
            html = r.read().decode('utf-8', 'replace')
        check('preview proxy serves the USER APP', r.status == 200 and 'CloudAgent builder' not in html and '<html' in html, f'len={len(html)}')
    except urllib.error.HTTPError as e:
        check('preview proxy serves the USER APP', False, f'HTTP {e.code}')

# 7. password change: session KEPT on this device, old password dead, new works
sc, body, setc3, _ = req('POST', '/api/auth/password', {'currentPassword': 'test115pw', 'newPassword': 'newpass115'}, cookie=ck)
check('password change 200', sc == 200, f'{sc} {str(body)[:100]}')
newck = setc3.split(';')[0] if setc3 else ''
check('password change re-issues session cookie', bool(newck), str(setc3)[:80])
sc, _, _, _ = req('GET', '/api/auth/me', cookie=(newck or ck))
check('device stays signed in after change', sc == 200, f'{sc}')
sc, _, _, _ = req('POST', '/api/auth/login', {'email': email, 'password': 'test115pw'})
check('old password rejected', sc == 401, f'{sc}')
sc, _, _, _ = req('POST', '/api/auth/login', {'email': email, 'password': 'newpass115'})
check('new password works', sc == 200, f'{sc}')

print(f'\n===== {len(PASS)} pass / {len(FAIL)} fail =====')
for f in FAIL: print('  FAIL:', f)
sys.exit(1 if FAIL else 0)
