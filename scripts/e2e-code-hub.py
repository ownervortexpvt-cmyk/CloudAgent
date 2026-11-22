#!/usr/bin/env python3
"""E2E v152 — Ecosystem Code Hub: self-hosted git + push-to-deploy.

Covers: Cloudflare removal, favicon, admin token lifecycle, smart-http clone,
unauthenticated rejection, PUSH → AUTO-DEPLOY → LIVE (file lands), deletion
push → live file removed, token revocation kills access, :3200 health.
"""
import json, os, shutil, subprocess, sys, time, urllib.request, urllib.error

BASE = 'http://127.0.0.1:3000'
LIVE = '/home/z/my-project'
STATE = f'{LIVE}/.ecosystem/deploy-state.json'
GIT_URL = f'{BASE}/api/ecosystem-git/vortex-ecosystem.git'
WORK = '/tmp/codehub-e2e'
PASS, FAIL = 0, 0

def check(name, cond, extra=''):
    global PASS, FAIL
    if cond: PASS += 1; print(f'  ✅ {name}')
    else: FAIL += 1; print(f'  ❌ {name} {extra}')

def req(method, path, body=None, headers=None):
    h = {'Content-Type': 'application/json', 'x-ca-gate': 'CA-X-MONA-9173'}
    if headers: h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            b = resp.read().decode()
            return resp.status, (json.loads(b) if b else {})
    except urllib.error.HTTPError as e:
        b = e.read().decode()
        try: return e.code, json.loads(b)
        except: return e.code, {'raw': b}

def wait_deploy(after_ts=0, timeout=420):
    """poll deploy-state.json until a deploy STARTED after after_ts finishes"""
    t0 = time.time()
    last = ''
    while time.time() - t0 < timeout:
        try:
            d = json.load(open(STATE))
            if d.get('startedAt', 0) > after_ts and d.get('status') in ('live', 'failed'):
                return d
            last = d.get('status', '?')
        except Exception:
            pass
        time.sleep(4)
    return {'status': 'timeout', 'last': last}

print('== 1. Cloudflare deploy system is GONE ==')
cf_files = ['scripts/cf_deploy_login.py', 'scripts/cf_deploy_vortex_website.py',
            'scripts/cf-worker.js', 'scripts/ca-worker.js', 'scripts/ca-worker-static.js',
            'scripts/gen-ca-worker-static.py']
left = [f for f in cf_files if os.path.exists(f'{LIVE}/{f}')]
check('all 6 cloudflare deploy files deleted', not left, f'still present: {left}')
check('no wrangler config on disk',
      not os.path.exists(f'{LIVE}/wrangler.toml') and not os.path.exists(f'{LIVE}/wrangler.jsonc'))

print('== 2. Vortex favicon serves (z.ai logo fix) ==')
s = None
try:
    r = urllib.request.urlopen(BASE + '/favicon.ico', timeout=15)
    s = r.status
except urllib.error.HTTPError as e:
    s = e.code
check('GET /favicon.ico → 200', s == 200, f'got {s}')
check('favicon file non-empty', os.path.getsize(f'{LIVE}/public/favicon.ico') > 1000)

print('== 3. admin login + unlock control room ==')
s, j = req('POST', '/api/auth/login', {'email': 'qa-admin115@qa.local', 'password': 'qatester115'})
check('admin login ok', s == 200, f'{s}')
admin_tok = j.get('sessionToken') or j.get('token') or ''
AH = {'x-ca-lock': admin_tok}
s, j = req('POST', '/api/admin/panel/session', {'pin': 'DCnTt8wwtuj3f6R'}, AH)
check('room unlock ok', s == 200 and j.get('unlocked'), f'{s}')
room_tok = j.get('token', '')
RH = dict(AH); RH['x-ca-admin'] = room_tok

s, j = req('GET', '/api/admin/panel/code-hub?view=overview', headers=RH)
check('code-hub overview 200', s == 200, f'{s} {str(j)[:120]}')
check('clone URL present', j.get('cloneUrl', '').endswith('/api/ecosystem-git/vortex-ecosystem.git'), str(j.get('cloneUrl')))
check('repo seeded', (j.get('repo') or {}).get('ready') is True and (j.get('repo') or {}).get('trackedFiles', 0) > 800,
      str(j.get('repo'))[:150])

print('== 4. token lifecycle ==')
s, j = req('POST', '/api/admin/panel/code-hub', {'action': 'create-token', 'name': 'e2e-vscode'}, RH)
check('token created', s == 200 and j.get('token', '').startswith('vxtok_'), f'{s} {str(j)[:80]}')
TOK = j.get('token', '')
s, j = req('GET', '/api/admin/panel/code-hub?view=tokens', headers=RH)
names = [t.get('name') for t in j.get('tokens', [])]
check('token listed (no plaintext)', 'e2e-vscode' in names and TOK not in json.dumps(j), str(names))
check('token masked in list', all('hash' not in t for t in j.get('tokens', [])))

print('== 5. smart-http clone with token ==')
shutil.rmtree(WORK, ignore_errors=True)
auth_url = f'http://vortex:{TOK}@127.0.0.1:3000/api/ecosystem-git/vortex-ecosystem.git'
r = subprocess.run(['git', 'clone', '--quiet', auth_url, WORK], capture_output=True, text=True, timeout=180)
check('clone succeeded', r.returncode == 0, (r.stderr or '')[-300:])
check('CloudAgent code present', os.path.exists(f'{WORK}/src/app/admin/page.tsx'))
check('VORTEX_SERVER code present', os.path.exists(f'{WORK}/vortex-platform/server/VORTEX_SERVER/src/components/vortex/dashboard.tsx'))
check('no runtime data in repo', not os.path.exists(f'{WORK}/projects') and not os.path.exists(f'{WORK}/upload'))

print('== 6. auth wall ==')
r = subprocess.run(['git', 'ls-remote', GIT_URL], capture_output=True, text=True, timeout=60, env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'})
check('clone WITHOUT token rejected', r.returncode != 0)
bad = f'http://vortex:vxtok_000000000000000000000000000000000000000000000000@127.0.0.1:3000/api/ecosystem-git/vortex-ecosystem.git'
r = subprocess.run(['git', 'ls-remote', bad], capture_output=True, text=True, timeout=60, env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'})
check('BAD token rejected', r.returncode != 0)

print('== 7. PUSH → auto-deploy → LIVE ==')
probe = f'ecosystem-probe-{int(time.time())}.txt'
marker = 'vortex code hub live deploy proof'
open(f'{WORK}/{probe}', 'w').write(marker + '\n')
subprocess.run(['git', '-C', WORK, 'add', probe], capture_output=True)
subprocess.run(['git', '-C', WORK, '-c', 'user.name=e2e', '-c', 'user.email=e2e@vortex.local',
                'commit', '-q', '-m', f'code-hub e2e: add {probe}'], capture_output=True)
t_push = int(time.time() * 1000) - 2000
r = subprocess.run(['git', '-C', WORK, 'push', '--quiet', 'origin', 'main'], capture_output=True, text=True, timeout=120)
check('push accepted', r.returncode == 0, (r.stderr or '')[-300:])
d = wait_deploy(t_push)
check('deploy went LIVE', d.get('status') == 'live', f"status={d.get('status')} err={str(d.get('lastError'))[:200]}")
check('pushed file LIVE in the ecosystem', os.path.exists(f'{LIVE}/{probe}') and
      open(f'{LIVE}/{probe}').read().strip() == marker)
steps = {s.get('name'): s.get('status') for s in d.get('steps', [])}
check('pipeline steps all done', all(steps.get(k) == 'done' for k in ('checkout', 'deps', 'build', 'restart')), str(steps))

print('== 8. :3200 healthy after deploy ==')
import urllib.request as ur
try:
    code = ur.urlopen('http://127.0.0.1:3200/', timeout=10).status
except Exception as e:
    code = getattr(e, 'code', 0)
check('vortex :3200 → 200', code == 200, f'got {code}')

print('== 9. deletion push → live file removed ==')
subprocess.run(['git', '-C', WORK, 'rm', '-q', probe], capture_output=True)
subprocess.run(['git', '-C', WORK, '-c', 'user.name=e2e', '-c', 'user.email=e2e@vortex.local',
                'commit', '-q', '-m', 'code-hub e2e: remove probe'], capture_output=True)
t_push2 = int(time.time() * 1000) - 2000
r = subprocess.run(['git', '-C', WORK, 'push', '--quiet', 'origin', 'main'], capture_output=True, text=True, timeout=120)
check('deletion push accepted', r.returncode == 0, (r.stderr or '')[-300:])
d = wait_deploy(t_push2)
check('second deploy LIVE', d.get('status') == 'live', f"status={d.get('status')}")
check('file removed from live tree', not os.path.exists(f'{LIVE}/{probe}'))

print('== 10. runtime data survived every push ==')
check('cloudagent db intact', os.path.exists(f'{LIVE}/db/custom.db'))
check('vortex db intact', os.path.exists(f'{LIVE}/vortex-platform/server/VORTEX_SERVER/db/custom.db'))
check('node_modules intact', os.path.isdir(f'{LIVE}/node_modules/next'))
check('.ecosystem state intact', os.path.exists(STATE))

print('== 11. revoke token → access dies ==')
s, j = req('GET', '/api/admin/panel/code-hub?view=tokens', headers=RH)
tid = next((t['id'] for t in j.get('tokens', []) if t.get('name') == 'e2e-vscode'), '')
check('token found for revoke', bool(tid))
s, j = req('POST', '/api/admin/panel/code-hub', {'action': 'revoke-token', 'id': tid}, RH)
check('revoke ok', s == 200 and j.get('ok'), f'{s}')
r = subprocess.run(['git', 'ls-remote', auth_url], capture_output=True, text=True, timeout=60,
                   env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'})
check('revoked token can no longer clone', r.returncode != 0)

s, j = req('GET', '/api/admin/panel/code-hub?view=overview', headers=RH)
hist = j.get('history', [])
check('deploy history recorded', len(hist) >= 2 and hist[0].get('status') == 'live', str(hist)[:150])

shutil.rmtree(WORK, ignore_errors=True)
print(f'\n==== CODE HUB E2E: {PASS} passed / {FAIL} failed ====')
sys.exit(1 if FAIL else 0)
