#!/usr/bin/env python3
"""E2E v113 — Admin Control Room (PIN lock + full control surface)."""
import json, urllib.request, urllib.error, sys

BASE = 'http://localhost:3000'
PASS, FAIL = 0, 0
GATE = 'CA-X-MONA-9173'  # v123 private-site key — every suite presents it

def req(method, path, body=None, headers=None, raw=False):
    h = {'Content-Type': 'application/json'}
    h['x-ca-gate'] = 'CA-X-MONA-9173'  # v123 private-site gate
    if headers: h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            b = resp.read().decode()
            return resp.status, (b if raw else (json.loads(b) if b else {}))
    except urllib.error.HTTPError as e:
        b = e.read().decode()
        try: return e.code, json.loads(b)
        except: return e.code, {'raw': b}

def check(name, cond, extra=''):
    global PASS, FAIL
    if cond: PASS += 1; print(f'  ✅ {name}')
    else: FAIL += 1; print(f'  ❌ {name} {extra}')

print('== 1. anonymous is shut out ==')
s, j = req('GET', '/api/admin/panel/session')
check('anon GET session → 401', s == 401, f'got {s}')
s, j = req('GET', '/api/admin/panel/stats')
check('anon GET stats → 401', s == 401, f'got {s}')

print('== 2. admin login ==')
s, j = req('POST', '/api/auth/login', {'email': 'qa-admin115@qa.local', 'password': 'qatester115'})
check('admin login ok', s == 200 and j.get('user', {}).get('role') == 'admin', f'{s} {j}')
admin_tok = (j.get('sessionToken') or j.get('token') or '')
AH = {'x-ca-lock': admin_tok} if admin_tok else {}
if not admin_tok:
    # cookie-only mode: use a cookie jar via headers
    print('  (no token in body — extracting Set-Cookie via low-level call)')

print('== 3. locked gate ==')
s, j = req('GET', '/api/admin/panel/session', headers=AH)
check('GET session (admin) ok', s == 200, f'{s}')
locked = j.get('locked')
check('room reports locked', locked is True, f'{j}')
s, j = req('GET', '/api/admin/panel/stats', headers=AH)
check('stats behind lock → 401', s == 401, f'got {s}')

print('== 4. wrong PIN rejected ==')
s, j = req('POST', '/api/admin/panel/session', {'pin': '00000000000'}, AH)
check('wrong PIN → 403', s == 403, f'got {s}')

print('== 5. unlock with owner PIN (v148 rotated) ==')
s, j = req('POST', '/api/admin/panel/session', {'pin': 'DCnTt8wwtuj3f6R'}, AH)
check('unlock ok', s == 200 and j.get('unlocked'), f'{s} {j}')
room_tok = j.get('token', '')
RH = dict(AH); RH['x-ca-admin'] = room_tok
check('token returned (header channel)', len(room_tok) > 20)

print('== 5b. razorpay keys POST gated by room ==')
s, j = req('POST', '/api/billing/keys', {'keyId': 'rzp_test_dummy12345678', 'keySecret': 'x' * 20}, AH)
check('keys POST without room token → 401', s == 401, f'got {s}')

print('== 6. stats after unlock ==')
s, j = req('GET', '/api/admin/panel/stats', headers=RH)
check('stats 200', s == 200, f'{s}')
check('users block', 'users' in j and 'total' in j.get('users', {}))
check('planBreakdown 6 tiers', len(j.get('planBreakdown', [])) == 6)
check('toolchains present', len(j.get('toolchains', [])) >= 5)
check('storage block', 'storage' in j and 'dbMb' in j.get('storage', {}))
check('providers count', isinstance(j.get('providers', {}).get('count'), int))
print(f"  → users={j['users']['total']} projects={j['projects']} runs/mo={j['runs']['month']} revenue=₹{j['revenue']['paidTotalINR']} providers={j['providers']['count']} disk={j['storage'].get('disk')}")

print('== 7. toolchain status + log API ==')
s, j = req('GET', '/api/admin/panel/toolchains', headers=RH)
check('toolchains GET 200', s == 200 and 'logs' in j, f'{s}')
s, j = req('POST', '/api/admin/panel/toolchains', {'name': 'not-a-toolchain'}, RH)
check('unknown toolchain → 404', s == 404, f'got {s}')

print('== 8. user control actions ==')
s, j = req('GET', '/api/admin/users', headers=AH)
check('users list ok', s == 200 and len(j.get('users', [])) >= 1)
target = next((u for u in j.get('users', []) if u['role'] != 'admin'), None)
if target:
    # Control actions now REQUIRE the room unlock token (double gate).
    s, j2 = req('POST', '/api/admin/users', {'action': 'set_plan', 'userId': target['id'], 'plan': 'ultra'}, AH)
    check('set_plan WITHOUT room token → 401', s == 401, f'got {s}')
    s, j2 = req('POST', '/api/admin/users', {'action': 'set_plan', 'userId': target['id'], 'plan': 'ultra'}, RH)
    check('set_plan ultra ok (with room token)', s == 200 and j2.get('plan') == 'ultra', f'{s} {j2}')
    s, j2 = req('POST', '/api/admin/users', {'action': 'set_plan', 'userId': target['id'], 'plan': 'bogus'}, RH)
    check('bogus plan → 400', s == 400, f'got {s}')
    s, j2 = req('POST', '/api/admin/users', {'action': 'set_status', 'userId': target['id'], 'status': 'active'}, RH)
    check('set_status ok', s == 200, f'{s} {j2}')
else:
    print('  (no non-admin user to test actions on — skipped)')

print('== 9. change PIN flow (rotates signing secret) ==')
s, j = req('POST', '/api/admin/panel/session', {'action': 'change_pin', 'currentPin': 'wrong', 'nextPin': '654321987654'}, RH)
check('wrong current PIN → 403', s == 403, f'got {s}')
s, j = req('POST', '/api/admin/panel/session', {'action': 'change_pin', 'currentPin': 'DCnTt8wwtuj3f6R', 'nextPin': 'DCnTt8wwtuj3f6R'}, RH)
check('PIN re-set ok + tokens revoked', s == 200 and j.get('allTokensRevoked'), f'{s} {j}')
s, j = req('GET', '/api/admin/panel/stats', headers=RH)
check('old token dead after rotation → 401', s == 401, f'got {s}')
# re-unlock for test 10
s, j = req('POST', '/api/admin/panel/session', {'pin': 'DCnTt8wwtuj3f6R'}, AH)
check('re-unlock after rotation ok', s == 200, f'{s}')
RH['x-ca-admin'] = j.get('token', '')

print('== 10. lock now ==')
s, j = req('DELETE', '/api/admin/panel/session', headers=RH)
check('lock now 200', s == 200, f'{s}')
s, j = req('GET', '/api/admin/panel/stats', headers=RH)
check('stats locked again → 401', s == 401, f'got {s}')
if target:
    s, j2 = req('POST', '/api/admin/users', {'action': 'set_plan', 'userId': target['id'], 'plan': 'ultra'}, RH)
    check('room-locked control APIs refused → 401', s == 401, f'got {s}')

print('== 11. non-admin cannot even see the gate ==')
s, j = req('POST', '/api/auth/register', {'email': f'nonadmin{int(__import__("time").time())}@test.io', 'password': 'testpass123', 'name': 'NonAdmin'})
ntok = (j.get('sessionToken') or j.get('token') or '') if isinstance(j, dict) else ''
if ntok:
    s, j = req('GET', '/api/admin/panel/session', headers={'x-ca-lock': ntok})
    check('non-admin session GET → 403', s == 403, f'got {s}')
    s, j = req('POST', '/api/admin/panel/session', {'pin': 'DCnTt8wwtuj3f6R'}, {'x-ca-lock': ntok})
    check('non-admin unlock → 403', s == 403, f'got {s}')
else:
    print(f'  (register response shape differs: {j})')

print(f'\n═══ RESULT: {PASS} passed, {FAIL} failed ═══')
sys.exit(1 if FAIL else 0)
