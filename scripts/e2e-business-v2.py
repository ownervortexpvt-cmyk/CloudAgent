#!/usr/bin/env python3
"""BUSINESS v2 E2E — auth, plan limits, tenant isolation, admin activation.

Deterministic across reruns: uses a timestamped customer account and cleans
up every project it creates. Regression-covers the 2026-10-09 hardening:
runs listing scope, schedules CRUD ownership, env-var write/delete ownership,
secret reveal ownership.
"""
import json, time, urllib.request, urllib.error, sys

BASE = 'http://localhost:3000'
PASS, FAIL = 0, []

ROOM = ''  # v113: control-room unlock token — auto-attached once unlocked

def req(method, path, body=None, token=None, raw=False):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if body is not None: r.add_header('Content-Type', 'application/json')
    r.add_header('x-ca-gate', 'CA-X-MONA-9173')  # v123 private-site gate
    if token: r.add_header('x-ca-lock', token)
    if ROOM: r.add_header('x-ca-admin', ROOM)
    for attempt in range(2):
        try:
            with urllib.request.urlopen(r, timeout=60) as res:
                payload = res.read()
                if raw: return res.status, payload
                try: return res.status, json.loads(payload)
                except Exception: return res.status, {'_raw': payload.decode('utf-8', 'replace')[:300]}
        except urllib.error.HTTPError as e:
            payload = e.read()
            try: return e.code, json.loads(payload)
            except Exception: return e.code, payload.decode('utf-8', 'replace')[:200]
        except Exception:
            if attempt == 0:
                time.sleep(8)  # watchdog respawn window
                continue
            return 0, {}
        payload = e.read()
        try: return e.code, json.loads(payload)
        except Exception: return e.code, payload.decode('utf-8', 'replace')[:200]

def check(name, cond, detail=''):
    global PASS
    if cond: PASS += 1; print(f'  ✓ {name}')
    else: FAIL.append(name); print(f'  ✗ {name} {detail}')

STAMP = str(int(time.time()))
CUST_EMAIL = f'cust-{STAMP}@cloudagent.test'
created_projects = []  # (id, token) cleaned up at the end

print('── AUTH ──')
s, d = req('GET', '/api/projects')
check('unauth /api/projects → 401', s == 401, str(s))

# owner (first user = admin) — login path (already registered on this DB)
s, d = req('POST', '/api/auth/login', {'email': 'qa-admin115@qa.local', 'password': 'qatester115'})
check('owner login → ok+token', s == 200 and d.get('ok') and d.get('token'), f'{s} {str(d)[:120]}')
OWNER = d.get('token')
check('owner is admin', d.get('user', {}).get('role') == 'admin', str(d.get('user')))

# v113: unlock the admin control room — manual plan activation now lives behind the room PIN
s, d = req('POST', '/api/admin/panel/session', {'pin': '1000391619244862'}, token=OWNER)
check('control room unlock → ok', s == 200 and d.get('unlocked'), f'{s} {str(d)[:120]}')
ROOM = d.get('token', '')

# fresh customer (timestamped — always brand new, always free plan)
s, d = req('POST', '/api/auth/register', {'name': 'Customer', 'email': CUST_EMAIL, 'password': 'cust123'})
check('register fresh customer → ok', s == 200 and d.get('ok'), f'{s} {str(d)[:120]}')
CUST = d.get('token')
check('customer is user + free plan', d.get('user', {}).get('role') == 'user' and d.get('user', {}).get('plan') == 'free', str(d.get('user')))

s, d = req('POST', '/api/auth/login', {'email': CUST_EMAIL, 'password': 'WRONG'})
check('wrong password → 401', s == 401, str(s))
s, d = req('POST', '/api/auth/login', {'email': f'ghost-{STAMP}@x.com', 'password': 'x'})
check('unknown user → 401 (no 500)', s == 401, str(s))

print('── ME / PLAN ──')
s, d = req('GET', '/api/auth/me', token=CUST)
check('me returns plan+usage', s == 200 and d.get('plan', {}).get('id') == 'free' and 'usage' in d, str(d)[:120])

print('── PROJECT OWNERSHIP ──')
s, d = req('POST', '/api/projects', {'name': f'OwnerE2E-{STAMP}', 'language': 'html'}, token=OWNER)
check('owner (admin) creates project', s == 200 and d.get('project', {}).get('id'), f'{s}')
OWNER_P = d.get('project', {}).get('id')
created_projects.append((OWNER_P, OWNER))

# v115 — Big Billion Day: a FREE account cannot build outside the monthly window
s, d = req('POST', '/api/projects', {'name': f'CustProj0-{STAMP}', 'language': 'html'}, token=CUST)
check('free account outside Big Billion Day → 402', s == 402 and d.get('limit') == 'big-billion-day', f'{s} {str(d)[:140]}')

# upgrade the customer (admin) so the ownership tests have a real project to work with
s, d = req('GET', '/api/admin/users', token=OWNER)
cust_row = next((u for u in d.get('users', []) if u['email'] == CUST_EMAIL), None)
s, d = req('POST', '/api/auth/plan', {'userId': cust_row['id'], 'plan': 'ultra'}, token=OWNER)
check('admin activates Ultra (early, for ownership tests)', s == 200 and d.get('ok'), str(d)[:100])

s, d = req('POST', '/api/projects', {'name': f'CustProj1-{STAMP}', 'language': 'html'}, token=CUST)
check('customer (ultra) creates project 1', s == 200 and d.get('project', {}).get('id'), f'{s} {str(d)[:120]}')
CUST_P1 = d.get('project', {}).get('id')
created_projects.append((CUST_P1, CUST))

s, d = req('POST', '/api/projects', {'name': f'CustProj2-{STAMP}', 'language': 'html'}, token=CUST)
check('ultra allows 2nd project', s == 200, str(s))
if s == 200: created_projects.append((d.get('project', {}).get('id'), CUST))

# cross-tenant: customer touching the OWNER's OWN project must 403 everywhere
s, d = req('GET', f'/api/files?projectId={OWNER_P}&path=.', token=CUST)
check('cross-tenant files read → 403', s == 403, str(s))
s, d = req('GET', f'/api/runs?projectId={OWNER_P}', token=CUST)
check('cross-tenant runs read → 403', s == 403, str(s))
s, d = req('POST', '/api/agent', {'projectId': OWNER_P, 'prompt': 'hi'}, token=CUST)
check('cross-tenant agent run → 403', s == 403, str(s))

print('── RUNS LIST SCOPE (hardening) ──')
s, d = req('GET', '/api/runs', token=CUST)
runs_all = d.get('runs', []) if isinstance(d, dict) else []
leaked = [r for r in runs_all if r.get('projectId') not in (CUST_P1,)]
check('runs (no projectId) scoped to own projects', s == 200 and len(leaked) == 0, f'{s} leaked={len(leaked)}')
s, d = req('GET', '/api/runs')
check('runs unauth (no projectId) → 401', s == 401, str(s))

print('── SCHEDULES OWNERSHIP (hardening) ──')
s, d = req('POST', '/api/schedules', {'projectId': OWNER_P, 'prompt': 'e2e schedule', 'mode': 'single', 'intervalMinutes': 5, 'enabled': False}, token=OWNER)
check('owner creates schedule', s == 200 and d.get('schedule', {}).get('id'), f'{s} {str(d)[:100]}')
SCHED = d.get('schedule', {}).get('id')
s, d = req('GET', '/api/schedules', token=CUST)
sched_all = d.get('schedules', []) if isinstance(d, dict) else []
leaked_s = [x for x in sched_all if x.get('projectId') == OWNER_P]
check('customer schedules list hides owner schedules', s == 200 and len(leaked_s) == 0, f'{s} leaked={len(leaked_s)}')
s, d = req('PATCH', '/api/schedules', {'id': SCHED, 'prompt': 'hijacked'}, token=CUST)
check('customer PATCH owner schedule → 403', s == 403, str(s))
s, d = req('DELETE', f'/api/schedules?id={SCHED}', token=CUST)
check('customer DELETE owner schedule → 403', s == 403, str(s))
s, d = req('DELETE', f'/api/schedules?id={SCHED}', token=OWNER)
check('owner DELETE own schedule → ok', s == 200, str(s))

print('── ENV / SECRETS OWNERSHIP (hardening) ──')
s, d = req('POST', '/api/settings', {'projectId': OWNER_P, 'key': 'E2E_KEY', 'value': 'e2e-value', 'isSecret': True}, token=OWNER)
check('owner writes env var', s == 200, f'{s} {str(d)[:100]}')
ENV_ID = d.get('envVar', {}).get('id')
s, d = req('POST', '/api/settings', {'projectId': OWNER_P, 'key': 'HACK', 'value': 'x'}, token=CUST)
check('customer env write on owner project → 403', s == 403, str(s))
s, d = req('POST', '/api/settings/reveal', {'id': ENV_ID}, token=CUST)
check('customer reveal owner secret → 403', s == 403, str(s))
s, d = req('POST', '/api/settings/reveal', {'id': ENV_ID}, token=OWNER)
check('owner reveals own secret → ok', s == 200 and d.get('value') == 'e2e-value', f'{s} {str(d)[:80]}')
s, d = req('DELETE', f'/api/settings?id={ENV_ID}', token=CUST)
check('customer DELETE owner env → 403', s == 403, str(s))
s, d = req('DELETE', f'/api/settings?id={ENV_ID}', token=OWNER)
check('owner DELETE own env → ok', s == 200, str(s))

print('── ADMIN USERS LIST ──')
s, d = req('GET', '/api/admin/users', token=CUST)
check('customer denied admin users → 403', s == 403, str(s))
s, d = req('GET', '/api/admin/users', token=OWNER)
check('admin lists users', s == 200 and len(d.get('users', [])) >= 2, str(s))
cust_row = next((u for u in d.get('users', []) if u['email'] == CUST_EMAIL), None)
check('customer row present with usage', cust_row is not None and 'usage' in cust_row, str(cust_row)[:100])

print('── LOGOUT ──')
s, d = req('POST', '/api/auth/logout', token=CUST)
check('logout ok', s == 200 and d.get('ok'), str(s))
s, d = req('GET', '/api/auth/me', token=CUST)
check('revoked session → 401', s == 401, str(s))

print('── CLEANUP ──')
cleaned = 0
# the customer session was revoked by the logout check — mint a fresh one
s, d = req('POST', '/api/auth/login', {'email': CUST_EMAIL, 'password': 'cust123'})
CUST_FRESH = d.get('token')
for pid, tok in created_projects:
    if not pid: continue
    # customer-owned projects need the fresh token; owner's token is still valid
    tok2 = tok if tok == OWNER else (CUST_FRESH or tok)
    s, d = req('DELETE', f'/api/projects/{pid}?hard=1', token=tok2)
    if s == 200: cleaned += 1
check('all e2e projects hard-deleted', cleaned == len(created_projects), f'{cleaned}/{len(created_projects)}')

print(f'\nRESULT: {PASS} pass, {len(FAIL)} fail')
if FAIL:
    print('FAILED:', FAIL); sys.exit(1)
