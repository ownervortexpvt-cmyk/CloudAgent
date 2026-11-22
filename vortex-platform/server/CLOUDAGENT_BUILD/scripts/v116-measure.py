#!/usr/bin/env python3
"""v116 — measure hydration-critical JS on the authed builder page (/).
Logs in as the QA admin, fetches /, sums every script the HTML references."""
import re, json, urllib.request, http.cookiejar, sys

BASE = 'http://localhost:3000'
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def post(url, payload):
    req = urllib.request.Request(BASE + url, data=json.dumps(payload).encode(),
                                 headers={'content-type': 'application/json'})
    return json.loads(op.open(req, timeout=30).read())

def get(url):
    req = urllib.request.Request(BASE + url)
    r = op.open(req, timeout=30)
    return r.read().decode('utf-8', 'replace')

# login (QA admin from e2e suite)
ok = False
for email, pw in [('qa-admin115@qa.local', 'qatester115')]:
    try:
        j = post('/api/auth/login', {'email': email, 'password': pw})
        if j.get('ok'):
            print(f'logged in as {email}')
            ok = True
            break
    except Exception as e:
        print(f'{email}: {e}')
if not ok:
    print('could not log in — measuring anonymous shell instead')

html = get('/')
srcs = re.findall(r'<script[^>]+src="([^"]+)"', html)
inline_kb = sum(len(m) for m in re.findall(r'<script[^>]*>(.*?)</script>', html, re.S)) / 1024
total = 0
rows = []
for s in srcs:
    if s.startswith('http'): continue
    path = s if s.startswith('/') else '/' + s
    try:
        n = len(op.open(urllib.request.Request(BASE + path), timeout=30).read())
        rows.append((n, path))
        total += n
    except Exception as e:
        print('miss', path, e)
rows.sort(reverse=True)
print(f'\nscript tags: {len(srcs)}  ·  external JS: {total/1024:.0f}KB  ·  inline: {inline_kb:.0f}KB')
for n, p in rows[:12]:
    print(f'  {n/1024:7.1f}KB  {p}')
