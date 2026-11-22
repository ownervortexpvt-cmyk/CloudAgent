#!/usr/bin/env python3
"""v120 retest — the 3 legs that failed in the first multi-stack run:
1. nextjs   (NODE_ENV=production inheritance broke next dev CSS → fixed in runtime)
2. csharp   (console template crashed headless → rewritten as ASP.NET web Snake)
3. flutter  (REAL Android APK build — disk now freed)
"""
import json, os, re, shutil, subprocess, sys, time, urllib.error, urllib.request

BASE = 'http://127.0.0.1:3000'
ROOT = '/home/z/my-project'
PASS, FAIL = [], []

def req(method, path, body=None, cookie=None, timeout=90):
    data = json.dumps(body).encode() if body is not None else None
    h = {'Content-Type': 'application/json'}
    if cookie: h['Cookie'] = cookie
    r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            ct = resp.headers.get('content-type', '')
            try: out = json.loads(raw) if 'json' in ct else {'_raw': raw.decode('utf-8', 'replace')}
            except Exception: out = {'_raw': raw.decode('utf-8', 'replace')}
            return resp.status, out, resp.headers.get('set-cookie', '')
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        try: out = json.loads(raw)
        except Exception: out = {'_raw': raw[:400]}
        return e.code, out, e.headers.get('set-cookie', '') if e.headers else ''
    except Exception as e:
        return 0, {'_err': str(e)}, ''

def check(name, cond, extra=''):
    (PASS if cond else FAIL).append(name)
    print(('✅' if cond else '❌'), name, ('' if cond else f'  [{extra}]'), flush=True)

def login_qa():
    sc, body, setc = req('POST', '/api/auth/login',
                         {'email': 'qa-admin115@qa.local', 'password': 'qatester115'})
    tok = re.search(r'ca_session=([^;]+)', setc or '')
    return ('ca_session=' + tok.group(1)) if tok else None

def create_project(cookie, name, template_id=None):
    body = {'name': name}
    if template_id: body['templateId'] = template_id
    return req('POST', '/api/projects', body, cookie, timeout=60)[:2]

def start_and_probe(cookie, pid, stack, probe_words, max_wait):
    sc, out, _ = req('POST', '/api/runtime', {'projectId': pid, 'action': 'start'}, cookie, timeout=90)
    if sc != 200 or not (out or {}).get('ok'):
        check(f'{stack}: start ok', False, f"{sc} {str((out or {}).get('error', out))[:400]}")
        return None
    port, url = out.get('port'), out.get('url', '')
    deadline = time.time() + max_wait
    last = ''
    while time.time() < deadline:
        time.sleep(4)
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=10) as resp:
                html = resp.read().decode('utf-8', 'replace')
                last = html[:140].replace('\n', ' ')
                if any(w.lower() in html.lower() for w in probe_words):
                    check(f'{stack}: app serves on its own port', True)
                    print(f'   ↳ port={port} bytes={len(html)} first="{last}"', flush=True)
                    try:
                        pr = urllib.request.Request(BASE + url, headers={'Cookie': cookie})
                        with urllib.request.urlopen(pr, timeout=15) as r2:
                            pv = r2.read().decode('utf-8', 'replace')
                        check(f'{stack}: same-origin /preview/ renders app',
                              any(w.lower() in pv.lower() for w in probe_words), pv[:120])
                    except Exception as e:
                        check(f'{stack}: same-origin /preview/ renders app', False, str(e)[:120])
                    return port
        except Exception as e:
            last = str(e)[:120]
    check(f'{stack}: app serves on its own port', False, f'timed out {max_wait}s; last="{last}"')
    return None

def stop_run(cookie, pid):
    try: req('POST', '/api/runtime', {'projectId': pid, 'action': 'stop'}, cookie, timeout=30)
    except Exception: pass

def hard_delete(cookie, pid):
    try: req('DELETE', f'/api/projects/{pid}?hard=1', None, cookie, timeout=90)
    except Exception: pass

def disk_free_g():
    st = os.statvfs(ROOT)
    return (st.f_bavail * st.f_frsize) / (1024 ** 3)

def main():
    cookie = login_qa()
    check('QA admin login', bool(cookie))
    if not cookie: sys.exit(1)

    # ---- 1) Next.js with the NODE_ENV fix ----
    sc, out = create_project(cookie, 'v120r next', 'next')
    pid = (out or {}).get('project', {}).get('id') if isinstance(out, dict) else None
    if pid:
        port = start_and_probe(cookie, pid, 'nextjs', ['__next', 'my next app'], 420)
        stop_run(cookie, pid)
        hard_delete(cookie, pid)

    # ---- 2) C# ASP.NET web Snake ----
    sc, out = create_project(cookie, 'v120r csharp', 'csharp-game')
    pid = (out or {}).get('project', {}).get('id') if isinstance(out, dict) else None
    if pid:
        port = start_and_probe(cookie, pid, 'csharp', ['snake', 'asp.net', 'c#'], 300)
        if port:
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/state', timeout=10) as r:
                    st = json.loads(r.read().decode())
                check('csharp: /api/state returns real C# engine state',
                      isinstance(st.get('snake'), list) and 'score' in st, str(st)[:150])
            except Exception as e:
                check('csharp: /api/state returns real C# engine state', False, str(e)[:150])
        stop_run(cookie, pid)
        hard_delete(cookie, pid)

    # ---- 3) Flutter REAL Android APK ----
    print('\n===== FLUTTER APK =====', flush=True)
    sc, out = create_project(cookie, 'v120r flutter', 'flutter-web')
    fpid = (out or {}).get('project', {}).get('id') if isinstance(out, dict) else None
    if fpid:
        fdir = os.path.join(ROOT, 'projects', fpid)
        env = dict(os.environ)
        env['PATH'] = f"{ROOT}/sdk/flutter-sdk/bin:{ROOT}/sdk/jdk-17/bin:{env.get('PATH','')}"
        env.update({
            'JAVA_HOME': f'{ROOT}/sdk/jdk-17',
            'GRADLE_USER_HOME': f'{ROOT}/sdk/gradle-home',
            'ANDROID_SDK_ROOT': f'{ROOT}/sdk/android-sdk',
            'ANDROID_HOME': f'{ROOT}/sdk/android-sdk',
        })
        r = subprocess.run(['flutter', 'create', '.', '--platforms=android,web', '--project-name', 'v120apk'],
                           cwd=fdir, env=env, capture_output=True, text=True, timeout=240)
        check('flutter: android target scaffolded', r.returncode == 0 and os.path.isdir(os.path.join(fdir, 'android')))
        stop_run(cookie, fpid)
        gprop = os.path.join(fdir, 'android', 'gradle.properties')
        if os.path.exists(gprop):
            txt = open(gprop).read()
            txt = re.sub(r'org\.gradle\.jvmargs=.*', 'org.gradle.jvmargs=-Xmx1400M -XX:MaxMetaspaceSize=384M', txt)
            if 'org.gradle.jvmargs' not in txt:
                txt += '\norg.gradle.jvmargs=-Xmx1400M -XX:MaxMetaspaceSize=384M\n'
            open(gprop, 'w').write(txt)
        free = disk_free_g()
        print(f'   ↳ disk free: {free:.1f}G', flush=True)
        apk_out = os.path.join(fdir, 'build', 'app', 'outputs', 'flutter-apk')
        try:
            r = subprocess.run(['flutter', 'build', 'apk', '--debug', '--target-platform', 'android-arm64'],
                               cwd=fdir, env=env, capture_output=True, text=True, timeout=1200)
            apks = [f for f in (os.listdir(apk_out) if os.path.isdir(apk_out) else []) if f.endswith('.apk')]
            ok = r.returncode == 0 and apks
            size = os.path.getsize(os.path.join(apk_out, apks[0])) // 1024 if apks else 0
            check('flutter: REAL Android APK built', ok,
                  f"rc={r.returncode}\n{r.stdout[-600:]}\n{r.stderr[-400:]}")
            if ok:
                print(f'   ↳ APK: {apks[0]} ({size} KB)', flush=True)
                # copy the APK to download/ so the owner can sideload it
                os.makedirs(os.path.join(ROOT, 'download'), exist_ok=True)
                dst = os.path.join(ROOT, 'download', 'v120-cloudagent-flutter-debug.apk')
                shutil.copyfile(os.path.join(apk_out, apks[0]), dst)
                print(f'   ↳ copied to download/v120-cloudagent-flutter-debug.apk', flush=True)
        except subprocess.TimeoutExpired:
            check('flutter: apk build timed out (1200s)', False)
        hard_delete(cookie, fpid)

    print(f'\nTOTAL: {len(PASS)} passed, {len(FAIL)} failed', flush=True)
    for f in FAIL: print('  FAIL:', f, flush=True)
    sys.exit(1 if FAIL else 0)

if __name__ == '__main__':
    main()
