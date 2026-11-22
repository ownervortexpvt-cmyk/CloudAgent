#!/usr/bin/env python3
"""v112 E2E — single agent run on the NEW default (glm-5.3-flash built-in),
proving the zero-key builder works end to end: register → project → agent
run (file write) → verify file on disk → cleanup."""
import json, time, urllib.request, urllib.error

BASE = 'http://localhost:3000'

def req(method, path, body=None, token=None, timeout=300):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    if body is not None: r.add_header('Content-Type', 'application/json')
    if token: r.add_header('x-ca-lock', token)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as res:
            return res.status, json.loads(res.read() or b'{}')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'{}')
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {'error': str(e)}

ok = fail = 0
def check(name, cond, extra=''):
    global ok, fail
    if cond: ok += 1; print(f'  PASS {name}')
    else: fail += 1; print(f'  FAIL {name} {extra}')

ts = str(int(time.time()))
email = f'v112-{ts}@e2e.test'

print('== auth + project ==')
s, d = req('POST', '/api/auth/register', {'email': email, 'password': 'Test1234!'})
check('register', s == 200 and d.get('token'), str(s))
tok = d.get('token')

# v115 — Big Billion Day: free accounts can't build outside the monthly window,
# so the smoke-test user gets an Ultra grant before creating the project.
s, d = req('POST', '/api/auth/login', {'email': 'owner@cloudagent.test', 'password': 'owner123'})
if s == 200 and d.get('token'):
    otok = d['token']
    s, d = req('POST', '/api/admin/panel/session', {'pin': '1000391619244862'}, otok)
    room_tok = d.get('token', '') if s == 200 else ''
    s, d = req('GET', '/api/admin/users', token=otok)
    target = next((u for u in d.get('users', []) if u.get('email') == email), None)
    if target and room_tok:
        r = urllib.request.Request(BASE + '/api/admin/users', data=json.dumps({'action': 'set_plan', 'userId': target['id'], 'plan': 'ultra'}).encode(), method='POST')
        r.add_header('Content-Type', 'application/json')
        r.add_header('x-ca-lock', otok)
        r.add_header('x-ca-admin', room_tok)
        try:
            with urllib.request.urlopen(r, timeout=30) as res:
                s, d = res.status, json.loads(res.read() or b'{}')
        except urllib.error.HTTPError as e:
            s, d = e.code, json.loads(e.read() or b'{}')
        check('smoke user upgraded to ultra (BBD rule)', s == 200, f'{s} {str(d)[:100]}')
    else:
        print('  (cannot upgrade — control room or user row unavailable)')
else:
    print('  (owner unavailable on this DB — attempting BBD-window fallback)')

s, d = req('POST', '/api/projects', {'name': f'V112 Smoke {ts}'}, tok)
check('project created', s in (200, 201) and d.get('project', {}).get('id'), str(s))
pid = d['project']['id']

print('== agent run (default provider = GLM 5.3 Flash, zero key) ==')
prompt = 'Create a single file hello.txt containing exactly: V112_LOCAL_CHAIN_OK. Then stop.'
final_status = provider_line = ''
tool_calls = 0
started = time.time()
try:
    with urllib.request.urlopen(urllib.request.Request(BASE + '/api/agent', data=json.dumps({'projectId': pid, 'prompt': prompt, 'forceBuiltIn': True}).encode(), method='POST', headers={'Content-Type': 'application/json', 'x-ca-lock': tok}), timeout=420) as resp:
        for line in resp:
            try: ev = json.loads(line)
            except Exception: continue
            t = ev.get('type')
            if t == 'run_started':
                provider_line = ev.get('provider', '')
                check('run_started', True); print(f'    provider: {provider_line}')
            elif t == 'tool_call':
                tool_calls += 1
                print(f'    [tool] {str(ev.get("name") or ev.get("tool") or "")[:60]}')
            elif t == 'status':
                print(f'    [status] {str(ev.get("message",""))[:110]}')
            elif t == 'error':
                final_status = 'error: ' + str(ev.get('content', ''))[:200]
            elif t == 'done':
                final_status = 'done'
except Exception as e:
    final_status = f'exception: {e}'
dur = time.time() - started
check('run finished without error', final_status == 'done', final_status)
check('agent made tool calls', tool_calls >= 1, f'tool_calls={tool_calls}')
print(f'    duration: {dur:.0f}s')

print('== verify file written (disk truth) ==')
import os
hello = f'/home/z/my-project/projects/{pid}/hello.txt'
found = os.path.isfile(hello)
content = open(hello).read() if found else ''
check('hello.txt exists in project dir', found)
check('content matches', 'V112_LOCAL_CHAIN_OK' in content, repr(content[:60]))

print('== cleanup ==')
req('DELETE', f'/api/projects/{pid}?hard=1', None, tok)
s, d = req('POST', '/api/auth/logout', {}, tok)
check('logout', s == 200)

print(f'RESULT: {ok} pass, {fail} fail')
