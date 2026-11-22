#!/usr/bin/env python3
"""Restore every legacy project directory into the fresh DB via the REAL
import API (zip -> POST /api/projects/import). Skips the cmv0* dirs that
were E2E leftovers, and skips node_modules/dist/.git/coverage when zipping.
Result: each dir becomes a live project (new id) with File rows + framework
detection — exactly as if the user had imported it themselves.
"""
import io, json, os, time, zipfile, urllib.request, urllib.error

BASE = 'http://localhost:3000'
PROJECTS = '/home/z/my-project/projects'
SKIP_PREFIX = 'cmv0'          # E2E leftovers, not user work
SKIP_DIRS = {'node_modules', 'dist', '.git', 'coverage', '.next', 'build'}
ZIP_EXCLUDE_EXT = {'.lock'}   # big low-value files (package-lock keeps)

def req(method, path, body=None, token=None, timeout=120):
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

def guess_name(d):
    pkg = os.path.join(PROJECTS, d, 'package.json')
    if os.path.isfile(pkg):
        try:
            n = json.load(open(pkg)).get('name') or ''
            if n: return n.replace('-', ' ').replace('_', ' ').strip().title()
        except Exception: pass
    if os.path.isfile(os.path.join(PROJECTS, d, 'pubspec.yaml')): return 'Flutter App (restored)'
    if os.path.isfile(os.path.join(PROJECTS, d, 'main.cpp')): return 'C++ App (restored)'
    if os.path.isfile(os.path.join(PROJECTS, d, 'index.html')): return 'Website (restored)'
    if os.path.isfile(os.path.join(PROJECTS, d, 'index.js')): return 'Node App (restored)'
    return f'Restored Project {d[:8]}'

def zip_dir(src):
    buf = io.BytesIO()
    count = 0
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(src):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
            for f in files:
                p = os.path.join(root, f)
                rel = os.path.relpath(p, src)
                if os.path.splitext(f)[1] in ZIP_EXCLUDE_EXT: continue
                try:
                    z.write(p, rel); count += 1
                except Exception as e:
                    print(f'    skip {rel}: {e}')
    return buf.getvalue(), count

# login as admin
s, d = req('POST', '/api/auth/login', {'email': 'owner@cloudagent.test', 'password': 'owner123'})
assert s == 200, f'admin login failed: {s}'
TOKEN = d['token']
print('admin logged in')

dirs = sorted(x for x in os.listdir(PROJECTS)
              if os.path.isdir(os.path.join(PROJECTS, x)) and not x.startswith(SKIP_PREFIX))
print(f'{len(dirs)} legacy project dirs to restore\n')
ok, fail = 0, []
for dname in dirs:
    name = guess_name(dname)
    zb, nfiles = zip_dir(os.path.join(PROJECTS, dname))
    size_kb = len(zb) // 1024
    if nfiles == 0:
        print(f'- {dname[:14]} -> EMPTY after filtering, skipped'); fail.append((dname, 'empty')); continue
    s, r = req('POST', '/api/projects/import', {'name': name, 'zipBase64': zb.hex() and __import__("base64").b64encode(zb).decode()}, token=TOKEN, timeout=300)
    if s == 200 and r.get('project', {}).get('id'):
        ok += 1
        print(f'+ {dname[:14]} -> "{name}" ({nfiles} files, {size_kb}KB) id={r["project"]["id"][:14]}')
    else:
        fail.append((dname, s))
        print(f'x {dname[:14]} -> "{name}" FAILED {s}: {str(r)[:120]}')
    time.sleep(0.3)

print(f'\nRESTORED {ok}/{len(dirs)}; failures: {fail}')
