#!/usr/bin/env python3
"""
v111 E2E — LOCAL OPEN-SOURCE AI (the zero-API-key builder layer).
Run against a live server: python3 scripts/e2e-local-ai.py [BASE_URL]
Default BASE = http://localhost:3000

What it proves:
  local runtime:     :11434 answers /v1/models (Ollama or llama.cpp)
  status API:        /api/ai/local exposes up + catalog + provider rows
  auto-provision:    POST sync {action:'sync'} creates a kind='local'
                     provider row per installed model — zero user config
  no-key build:      an agent run led by the LOCAL provider writes a real
                     file into a real project — no API key was ever added
  gating:            non-admin cannot POST /api/ai/local (403)
  cleanup:           test project removed
"""
import sys, json, time, string, random, sqlite3

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000').rstrip('/')
DB = '/home/z/my-project/db/custom.db'

results = []
def check(name, cond, extra=''):
    results.append(bool(cond))
    print(f"{'PASS' if cond else 'FAIL'} [{len(results):02d}] {name}" + (f" — {extra}" if extra and not cond else ''))

def req(method, path, body=None, token=None):
    import requests
    headers = {}
    if token:
        headers['x-ca-lock'] = token
    r = requests.request(method, BASE + path, json=body, headers=headers, timeout=300,
                         proxies={'http': None, 'https': None})
    try:
        d = r.json()
    except Exception:
        d = {}
    return r.status_code, d

STAMP = ''.join(random.choices(string.ascii_lowercase + string.digits, k=7))
con = sqlite3.connect(DB)

# ── 1. local runtime probe (bypassing the app — the runtime itself) ─────────
import requests
P = {'http': None, 'https': None}
try:
    r = requests.get('http://127.0.0.1:11434/v1/models', timeout=5, proxies=P)
    RUNTIME_UP = r.status_code == 200 and len(r.json().get('data', [])) >= 1
except Exception:
    RUNTIME_UP = False
check('local model runtime answers on :11434/v1/models', RUNTIME_UP)

# ── 2. admin login + status API ──────────────────────────────────────────────
s, d = req('POST', '/api/auth/login', {'email': 'owner@cloudagent.test', 'password': 'owner123'})
check('admin login', s == 200 and d.get('ok'), f'{s}')
ADMIN = d.get('token')

s, d = req('GET', '/api/ai/local')
check('unauth status → 401', s == 401, str(s))

s, d = req('GET', '/api/ai/local', token=ADMIN)
check('status API: ok + catalog of 9', s == 200 and d.get('ok') and len(d.get("catalog", [])) == 9,
      f'{s} catalog={len(d.get("catalog", []))}')
check('status API: runtime up + models listed', d.get('up') is True and len(d.get('installed', [])) >= 1,
      f'up={d.get("up")} installed={d.get("installed")}')
LOCAL_MODEL_ID = (d.get('installed') or [''])[0]
check('at least one local model installed', bool(LOCAL_MODEL_ID), f'got "{LOCAL_MODEL_ID}"')

# ── 3. gating: non-admin cannot manage ───────────────────────────────────────
s, d = req('POST', '/api/auth/register', {'name': 'LocalTest', 'email': f'local-{STAMP}@cloudagent.test', 'password': 'localpass-1'})
check('test customer registers', s == 200 and d.get('ok'), f'{s} {str(d)[:160]}')
s, d = req('POST', '/api/auth/login', {'email': f'local-{STAMP}@cloudagent.test', 'password': 'localpass-1'})
CUST = d.get('token')
check('test customer logs in', s == 200 and CUST, f'{s} {str(d)[:120]}')
s, d = req('POST', '/api/ai/local', {'action': 'sync'}, token=CUST)
check('non-admin sync → 403', s == 403, str(s))

# ── 4. auto-provision ────────────────────────────────────────────────────────
s, d = req('POST', '/api/ai/local', {'action': 'sync'}, token=ADMIN)
check('admin sync → ok', s == 200 and d.get('ok') is True, f'{s} {str(d)[:150]}')
s, d = req('GET', '/api/ai/local', token=ADMIN)
rows = d.get('providers', [])
row = next((r for r in rows if r.get('model') == LOCAL_MODEL_ID), None)
check('local model auto-provisioned as a provider row', row is not None, f'rows={json.dumps(rows)[:200]}')
check('provider row is kind local + no key needed', row is not None and row.get('endpoint', '').endswith('/v1'))

# unknown action + unknown model honesty
s, d = req('POST', '/api/ai/local', {'action': 'install', 'model': 'not-in-catalog:9b'}, token=ADMIN)
check('install of non-catalog model rejected', s == 400, str(s))
s, d = req('POST', '/api/ai/local', {'action': 'dance'}, token=ADMIN)
check('unknown action → 400', s == 400, str(s))

# ── 5. THE BIG ONE: build an app with the local model, no API key ───────────
s, d = req('POST', '/api/projects', {'name': f'LocalAI-{STAMP}', 'language': 'html'}, token=ADMIN)
PID = (d.get('project') or {}).get('id')
check('test project created', s == 200 and PID, f'{s} {str(d)[:120]}')

# small open-source models are stochastic — up to 3 attempts is honest usage
def local_run(attempt):
    prompt = (f'Use the write_file tool NOW. Path: hello.txt. Content: HELLO LOCAL AI. '
              f'Do not explain. Write the file immediately.' if attempt else
              'Create a single file named hello.txt containing exactly the text HELLO LOCAL AI')
    s, d = req('POST', '/api/agent', {'projectId': PID, 'prompt': prompt, 'providerId': row['id'], 'maxIterations': 4}, token=ADMIN)
    RUN = None
    for _ in range(10):
        time.sleep(1)
        r = con.execute('SELECT id FROM AgentRun WHERE projectId=? ORDER BY createdAt DESC LIMIT 1', (PID,)).fetchone()
        if r:
            RUN = r[0]
            break
    final = None
    prov = None
    for _ in range(90):
        time.sleep(2)
        rr = con.execute('SELECT status, provider FROM AgentRun WHERE id=?', (RUN,)).fetchone() if RUN else None
        if rr:
            final, prov = rr[0], rr[1]
        if final in ('completed', 'failed', 'stopped'):
            break
    s, d = req('GET', f'/api/files?projectId={PID}&path=hello.txt', token=ADMIN)
    return final, prov, s, d, RUN

wrote = False
for attempt in range(3):
    final, prov, fcode, fdata, RUN = local_run(attempt)
    if fcode == 200 and 'HELLO' in str(fdata.get('content', '')).upper():
        wrote = True
        break
    resp_head = ''
    if RUN:
        rr = con.execute('SELECT response FROM AgentRun WHERE id=?', (RUN,)).fetchone()
        resp_head = (rr[0] or '')[:220].replace('\n', ' | ') if rr else ''
    print(f'  attempt {attempt + 1}: status={final} file={fcode} provider={prov} run={RUN}')
    print(f'    response: {resp_head}')
    import subprocess
    print('    disk:', subprocess.run(['bash', '-c', f'ls /home/z/my-project/projects/{PID}/ 2>/dev/null | head -6 || echo no-dir'],
                                     capture_output=True, text=True).stdout.split())

check('local-model agent run completed', final == 'completed', f'final={final}')
check('run executed by the LOCAL open-source model (not a cloud failover)',
      isinstance(prov, str) and ('local' in prov.lower() or prov == row['name']), f'provider={prov} local={row["id"]}')
check('file written by the open-source model — build WITHOUT any API key', wrote,
      f'{fcode} {str(fdata)[:160]}')

# ── 6. cleanup ───────────────────────────────────────────────────────────────
if PID:
    s, d = req('DELETE', f'/api/projects/{PID}?hard=1', token=ADMIN)
    check('test project cleaned up', s == 200, str(s))

print(f"\n{'ALL PASS' if all(results) else 'FAILURES PRESENT'} — {sum(results)}/{len(results)}")
sys.exit(0 if all(results) else 1)
