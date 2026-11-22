#!/usr/bin/env python3
"""
e2e-v124-speed-pass.py — v124 ⚡ Ultra Speed Pass + platform integrity suite.

Covers, over REAL HTTP on the REAL server:
  0. GATE + PLATFORM   — private gate still guards; version probe works.
  1. SPEED-PASS API    — 401 signed-out; 400 bad values; on/off round-trip;
                         per-user UserSetting row verified via sqlite.
  2. LIVE FLASH RUN    — with the pass ON, a REAL agent run's run_started
                         carries speedPass:true + the '⚡ Ultra Speed' flash
                         lane leads + the honest status event appears + the
                         run actually BUILDS (index.html lands); with the pass
                         OFF a second run reports speedPass:false.
  3. PLATFORM INTEGRITY — auth session healthy; orphan sweep held (projects/
                         empty); v124 migration SQL exists with the hot index;
                         SW cache bumped to v22.

Usage: python3 scripts/e2e-v124-speed-pass.py
"""
import json
import os
import sqlite3
import sys
import time
import urllib.request
import urllib.error

BASE = 'http://localhost:3000'
GATE = 'CA-X-MONA-9173'
DB = '/home/z/my-project/db/custom.db'
STAMP = str(int(time.time()))
OWNER = {'email': 'mdhonabali61@gmail.com', 'password': 'Owner123'}

PASS, FAIL = [], []

def check(name, cond, detail=''):
    (PASS if cond else FAIL).append(name)
    print(f"  {'✅' if cond else '❌'} {name}" + (f' — {detail}' if detail and not cond else ''))
    return cond

def req(method, path, body=None, token=None, headers=None, raw=False, timeout=240, no_gate=False):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json'}
    if not no_gate: h['x-ca-gate'] = GATE
    if token: h['x-ca-lock'] = token
    if headers: h.update(headers)
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            payload = resp.read()
            if raw: return resp.status, payload, dict(resp.headers)
            try: return resp.status, json.loads(payload), dict(resp.headers)
            except Exception: return resp.status, {'_raw': payload.decode('utf-8', 'replace')[:300]}, dict(resp.headers)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try: return e.code, json.loads(payload), dict(e.headers)
        except Exception: return e.code, {'_raw': payload.decode('utf-8', 'replace')[:300]}, dict(e.headers)
    except Exception as e:
        return 0, {'error': str(e)}, {}

def login(email, password):
    s, d, _ = req('POST', '/api/auth/login', {'email': email, 'password': password})
    return (d or {}).get('token')

def stream_run(project_id, token, prompt):
    """POST /api/agent and consume the NDJSON stream to its end. Returns the event list."""
    data = json.dumps({'projectId': project_id, 'prompt': prompt}).encode()
    h = {'Content-Type': 'application/json', 'x-ca-gate': GATE, 'x-ca-lock': token}
    r = urllib.request.Request(BASE + '/api/agent', data=data, method='POST', headers=h)
    events = []
    with urllib.request.urlopen(r, timeout=240) as resp:
        for line in resp:
            line = line.decode('utf-8', 'replace').strip()
            if not line: continue
            try: events.append(json.loads(line))
            except Exception: pass
    return events

def tree_names(node, acc):
    """Flatten storage.listTree's TreeNode into a set of names."""
    if not isinstance(node, dict): return acc
    n = node.get('name') or node.get('path')
    if n: acc.append(str(n))
    for c in node.get('children') or []:
        tree_names(c, acc)
    return acc

def main():
    print('── v124 ⚡ ULTRA SPEED PASS — release suite ──')

    # ── 0. gate + platform ────────────────────────────────────────────────
    print('[0] gate + platform')
    s, d, _ = req('GET', '/api/version')
    check('version probe 200 through gate', s == 200 and d.get('ok') is True, f's={s}')
    s, d, _ = req('GET', '/api/speed-pass')
    check('speed-pass signed-out → 401', s == 401, f's={s}')

    token = login(OWNER['email'], OWNER['password'])
    check('owner login ok', bool(token))
    if not token:
        print('FATAL: no owner session'); sys.exit(1)

    # ── 1. speed-pass API ─────────────────────────────────────────────────
    print('[1] speed-pass API')
    s, d, _ = req('GET', '/api/speed-pass', token=token)
    check('GET → ok:false initially', s == 200 and d.get('on') is False, f's={s} d={d}')
    s, d, _ = req('POST', '/api/speed-pass', {'value': 'x'}, token=token)
    check("POST value='x' → 400", s == 400, f's={s}')
    s, d, _ = req('POST', '/api/speed-pass', {}, token=token)
    check('POST missing value → 400', s == 400, f's={s}')
    s, d, _ = req('POST', '/api/speed-pass', {'value': '1'}, token=token)
    check("POST value='1' → on:true", s == 200 and d.get('on') is True, f's={s} d={d}')
    s, d, _ = req('GET', '/api/speed-pass', token=token)
    check('GET reflects ON', s == 200 and d.get('on') is True, f's={s}')

    con = sqlite3.connect(DB)
    uid = con.execute("SELECT id FROM AuthUser WHERE email=?", (OWNER['email'],)).fetchone()
    uid = uid[0] if uid else ''
    row = con.execute("SELECT value FROM UserSetting WHERE key=?", (f'ultra_speed_pass:{uid}',)).fetchone()
    check('UserSetting row persisted (1)', bool(row) and row[0] == '1', f'row={row} uid={uid[:8]}')
    con.close()

    # ── 2. live flash-lane runs ───────────────────────────────────────────
    print('[2] live flash-lane run (pass ON)')
    s, d, _ = req('POST', '/api/projects', {'name': f'V124-Speed-{STAMP}', 'language': 'html'}, token=token)
    check('project created', s in (200, 201) and d.get('project', {}).get('id'), f's={s} d={str(d)[:120]}')
    pid = (d.get('project') or {}).get('id') or d.get('id')

    ev = stream_run(pid, token, 'Create index.html with exactly one line: v124 speed pass works. Nothing else.')
    fin = next((e for e in ev if e.get('type') in ('complete', 'completed', 'done', 'run_finished')), None)
    if fin and fin.get('ok') is False and 'planning failed' in str(fin.get('content', '')):
        # free-tier burst throttle — wait out the window and retry ONCE, honestly
        print('  … planning throttled (free-tier burst) — retrying once after 45s')
        time.sleep(45)
        ev = stream_run(pid, token, 'Create index.html with exactly one line: v124 speed pass works. Nothing else.')
        fin = next((e for e in ev if e.get('type') in ('complete', 'completed', 'done', 'run_finished')), None)
    rs = next((e for e in ev if e.get('type') == 'run_started'), None)
    check('run_started received', bool(rs), f'events={[e.get("type") for e in ev][:8]}')
    check('run_started.speedPass true', bool(rs and rs.get('speedPass') is True), f'rs={rs}')
    check('flash lane leads (Ultra Speed provider)', bool(rs and 'Ultra Speed' in str(rs.get('provider', ''))), f'provider={rs and rs.get("provider")}')
    stat = next((e for e in ev if e.get('type') == 'status' and 'Ultra Speed Pass active' in str(e.get('message', ''))), None)
    check('honest ⚡ status event emitted', bool(stat))
    check('run completed', bool(fin) and fin.get('ok') is not False, f'fin={fin}')
    s, d, _ = req('GET', f'/api/files/{pid}', token=token)
    names = tree_names(d.get('tree'), []) if s == 200 else []
    check('index.html actually written by flash lane', 'index.html' in names, f's={s} names={names[:8]}')

    print('[2b] run with pass OFF reports honestly')
    s, d, _ = req('POST', '/api/speed-pass', {'value': '0'}, token=token)
    check("POST value='0' → on:false", s == 200 and d.get('on') is False, f's={s}')
    ev2 = stream_run(pid, token, 'Append nothing. Just reply with the single word: ok.')
    rs2 = next((e for e in ev2 if e.get('type') == 'run_started'), None)
    check('second run_started.speedPass false', bool(rs2 and rs2.get('speedPass') is False), f'rs2={rs2}')

    # ── 3. platform integrity ─────────────────────────────────────────────
    print('[3] platform integrity')
    s, d, _ = req('GET', '/api/auth/me', token=token)
    check('auth session healthy', s == 200 and (d.get('user') or {}).get('email') == OWNER['email'], f's={s}')
    mig = '/home/z/my-project/prisma/migrations/20261017232508_v124_hot_indexes/migration.sql'
    ok = os.path.isfile(mig) and 'GitHubAccount_userId_idx' in open(mig).read()
    check('v124 hot-index migration ships GitHubAccount_userId_idx', ok)
    sw = open('/home/z/my-project/public/sw-builder.js').read()
    check('SW cache bumped to v22', "ca-builder-v22" in sw)

    # ── cleanup (real APIs + sqlite only for the KV flag) ─────────────────
    print('[9] cleanup')
    if pid:
        s, _, _ = req('DELETE', f'/api/projects/{pid}?hard=1', token=token)
        check('test project HARD-deleted (row + disk)', s in (200, 202, 204), f's={s}')
    try:
        con = sqlite3.connect(DB)
        con.execute("DELETE FROM UserSetting WHERE key=?", (f'ultra_speed_pass:{uid}',))
        con.commit(); con.close()
        check('speed-pass KV cleaned', True)
    except Exception as e:
        check('speed-pass KV cleaned', False, str(e))
    orphans = os.listdir('/home/z/my-project/projects') if os.path.isdir('/home/z/my-project/projects') else []
    check('orphan sweep held (projects/ empty after cleanup)', len(orphans) == 0, f'found={len(orphans)}')

    print(f"\n═══ v124: {len(PASS)} PASS / {len(FAIL)} FAIL ═══")
    if FAIL:
        print('FAILED:', *FAIL, sep='\n  - ')
        sys.exit(1)

if __name__ == '__main__':
    main()
