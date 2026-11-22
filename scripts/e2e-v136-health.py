#!/usr/bin/env python3
"""v136 health-check — live agent run + flutter readiness probe."""
import requests, sys, time, json

B = 'http://localhost:3000'
G = {'x-ca-gate': 'CA-X-MONA-9173'}
ok = lambda c, m: print(('✅' if c else '❌') + ' ' + m)
ts = str(int(time.time()))

s = requests.Session(); s.headers.update(G)
r = s.post(f'{B}/api/auth/register', json={'name': 'Health Bot', 'email': f'health{ts}@test.local', 'password': 'Test1234!'})
rj = r.json()
ok(rj.get('ok'), f'register ({rj.get("user", {}).get("plan", "?")} plan)')

# create a project
r = s.post(f'{B}/api/projects', json={'name': f'health-{ts}', 'description': 'health check'}).json()
if not r.get('ok'):
    # try alternate shape
    r = s.post(f'{B}/api/projects', json={'name': f'health-{ts}'}).json()
pid = r.get('project', {}).get('id') or r.get('id')
ok(bool(pid), f'project created ({pid})')

# run the agent on a tiny task (SSE stream)
run_id = f'health-{ts}'
payload = {'projectId': pid, 'prompt': 'Create a single file hello.txt containing the word HEALTHCHECK. Nothing else.', 'runId': run_id}
t0 = time.time()
r = s.post(f'{B}/api/agent', json=payload, stream=True, timeout=180)
ok(r.status_code == 200, f'agent run started (HTTP {r.status_code})')
events = []
final = None
err = None
for line in r.iter_lines(decode_unicode=True):
    if not line or not line.startswith('data: '):
        continue
    try:
        ev = json.loads(line[6:])
    except Exception:
        continue
    events.append(ev)
    t = ev.get('type') or ev.get('event')
    if t in ('done', 'complete', 'finish', 'end'):
        final = ev
    if t in ('error', 'run_error'):
        err = ev
    if len(events) > 400:
        break
dt = time.time() - t0
types = {}
for e in events:
    k = e.get('type') or e.get('event') or '?'
    types[k] = types.get(k, 0) + 1
print(f'   {len(events)} events in {dt:.1f}s — types: {types}')
if err:
    print(f'   error event: {json.dumps(err)[:300]}')
if final:
    print(f'   final: {json.dumps(final)[:200]}')

# verify the file actually got written
r = s.get(f'{B}/api/files?projectId={pid}&path=hello.txt', timeout=15)
txt = ''
if r.status_code == 200:
    try:
        j = r.json()
        txt = j.get('content') or ''
    except Exception:
        txt = r.text
ok('HEALTHCHECK' in txt, f'agent wrote hello.txt ({txt[:40]!r})')

# run history persisted
r = s.get(f'{B}/api/runs?projectId={pid}', timeout=15).json()
rows = r.get('runs') or r.get('rows') or []
ok(len(rows) >= 1, f'run history persisted ({len(rows)} row)')

print('\n— flutter readiness:')
import subprocess
out = subprocess.run(['bash', '-c', 'ls /home/z/my-project/sdk/flutter-sdk/bin/flutter >/dev/null 2>&1 && echo SDK_PRESENT || echo SDK_MISSING'], capture_output=True, text=True).stdout.strip()
print(f'   {out}')
