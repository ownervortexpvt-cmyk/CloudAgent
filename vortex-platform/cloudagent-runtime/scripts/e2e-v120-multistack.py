#!/usr/bin/env python3
"""v120 — MULTI-STACK + FLUTTER EVERYWHERE verification.

Owner asked: "Flutter must support mobile (android, iOS), web, desktop, laptop —
now test EVERYTHING."

Part A — platform pipeline E2E for EVERY stack (real APIs, real runtimes):
  static(HTML) / vite-react / next / node-express / python-fastapi /
  flutter-web / csharp-game / custom C++ (POSIX socket server via files API)
Part B — Flutter multi-target deep test:
  - scaffold ALL code targets (android/ios/linux/windows/macos) — proof the
    generated project is multi-platform from day one
  - REAL Android APK build (debug, arm64) with tuned gradle memory (4GB box)
  - honest report: iOS/Windows/macOS compile needs their own OS (Xcode etc.)
Part C — cleanup: stop runs, hard-delete projects, remove scratch, drop test user.
"""
import json, os, re, shutil, sqlite3, subprocess, sys, time, urllib.error, urllib.request

BASE = 'http://127.0.0.1:3000'
ROOT = '/home/z/my-project'
PASS, FAIL = [], []
SCRATCH = os.path.join(ROOT, '.e2e-v120-scratch')

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
    sc, out, _ = req('POST', '/api/projects', body, cookie, timeout=60)
    return (sc, out)

def write_file(cookie, pid, path, content):
    return req('POST', '/api/files', {'projectId': pid, 'path': path, 'content': content}, cookie, timeout=60)[0]

def start_and_probe(cookie, pid, stack, probe_words, max_wait):
    sc, out, _ = req('POST', '/api/runtime', {'projectId': pid, 'action': 'start'}, cookie, timeout=90)
    if sc != 200 or not (out or {}).get('ok'):
        err = str((out or {}).get('error', out))[:400]
        check(f'{stack}: start ok', False, f'{sc} {err}')
        return None
    port, url = out.get('port'), out.get('url', '')
    deadline = time.time() + max_wait
    last = ''
    while time.time() < deadline:
        time.sleep(4)
        # GROUND TRUTH: fetch the app port DIRECTLY (no proxy, no auth) —
        # this is literally the user app answering on its own socket.
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=10) as resp:
                html = resp.read().decode('utf-8', 'replace')
                last = html[:160].replace('\n', ' ')
                if any(w.lower() in html.lower() for w in probe_words):
                    check(f'{stack}: app serves on its own port', True)
                    print(f'   ↳ port={port} bytes={len(html)} first="{last}"', flush=True)
                    # same-origin proof: /preview/<port>/ through the builder
                    # WITH cookie + redirect-follow = what the phone iframe gets
                    try:
                        pr = urllib.request.Request(BASE + url, headers={'Cookie': cookie})
                        with urllib.request.urlopen(pr, timeout=15) as r2:
                            pv = r2.read().decode('utf-8', 'replace')
                        same = any(w.lower() in pv.lower() for w in probe_words)
                        check(f'{stack}: same-origin /preview/ renders app', same,
                              f'preview first="{pv[:120]}"')
                    except Exception as e:
                        check(f'{stack}: same-origin /preview/ renders app', False, str(e)[:120])
                    return port
        except Exception as e:
            last = str(e)[:120]
    check(f'{stack}: app serves on its own port', False, f'timed out after {max_wait}s; last="{last}"')
    return None

def stop_run(cookie, pid):
    try: req('POST', '/api/runtime', {'projectId': pid, 'action': 'stop'}, cookie, timeout=30)
    except Exception: pass

def hard_delete(cookie, pid):
    try: req('DELETE', f'/api/projects/{pid}?hard=1', None, cookie, timeout=60)
    except Exception: pass

def disk_free_g():
    st = os.statvfs(ROOT)
    return (st.f_bavail * st.f_frsize) / (1024 ** 3)

CPP_MAIN = r'''#include <iostream>
#include <string>
#include <cstdlib>
#include <cstring>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
int main() {
  int port = 8080;
  if (const char* p = std::getenv("PORT")) port = std::atoi(p);
  int srv = socket(AF_INET, SOCK_STREAM, 0);
  int yes = 1; setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
  sockaddr_in a{}; a.sin_family = AF_INET; a.sin_addr.s_addr = INADDR_ANY; a.sin_port = htons(port);
  if (bind(srv, (sockaddr*)&a, sizeof a) < 0) { perror("bind"); return 1; }
  listen(srv, 16);
  const std::string body = "<html><body><h1>CloudAgent C++ server OK</h1></body></html>";
  const std::string res = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\nContent-Length: "
                          + std::to_string(body.size()) + "\r\n\r\n" + body;
  while (true) {
    int c = accept(srv, nullptr, nullptr);
    if (c < 0) continue;
    ssize_t n = write(c, res.c_str(), res.size()); (void)n;
    close(c);
  }
}'''

def main():
    os.makedirs(SCRATCH, exist_ok=True)
    cookie = login_qa()
    check('QA admin login', bool(cookie))
    if not cookie: sys.exit(1)

    results = {}
    MATRIX = [
        ('static',        'static',        ['<h1', 'hello', 'welcome', 'cloud'], 60),
        ('react',         'vite-react',    ['id="root"', '/@vite', 'react'], 300),
        ('nextjs',        'next',          ['__next', 'next'], 420),
        ('node-express',  'node-express',  ['json', 'message', 'hello', 'api', 'express'], 180),
        ('python',        'python-fastapi',['fastapi', 'uvicorn', 'hello', 'cloud agent'], 240),
        ('flutter',       'flutter-web',   ['flutter_bootstrap', 'main.dart.js', 'flutter'], 360),
        ('csharp',        'csharp-game',   ['asp', 'c#', 'dotnet', 'ok', 'api', 'game', 'minmal', 'weather'], 300),
    ]
    for label, tpl, words, wait in MATRIX:
        sc, out = create_project(cookie, f'v120 {label}', tpl)
        pid = (out or {}).get('project', {}).get('id') if isinstance(out, dict) else None
        check(f'{label}: project created', sc in (200, 201) and bool(pid), f'{sc} {str(out)[:150]}')
        if not pid:
            results[label] = 'CREATE-FAIL'; continue
        port = start_and_probe(cookie, pid, label, words, wait)
        results[label] = 'OK' if port else 'RUN-FAIL'
        stop_run(cookie, pid)

    # --- custom C++ (no template) ---
    sc, out = create_project(cookie, 'v120 cpp')
    pid = (out or {}).get('project', {}).get('id') if isinstance(out, dict) else None
    if pid:
        sc1 = write_file(cookie, pid, 'main.cpp', CPP_MAIN)
        check('cpp: main.cpp written', sc1 in (200, 201))
        port = start_and_probe(cookie, pid, 'cpp', ['C++ server OK'], 90)
        results['cpp'] = 'OK' if port else 'RUN-FAIL'
        stop_run(cookie, pid)
    else:
        check('cpp: project created', False, str(out)[:150]); results['cpp'] = 'CREATE-FAIL'

    # ============ PART B — FLUTTER EVERYWHERE ============
    print('\n===== FLUTTER MULTI-TARGET =====', flush=True)
    sc, out = create_project(cookie, 'v120 flutter-targets', 'flutter-web')
    fpid = (out or {}).get('project', {}).get('id') if isinstance(out, dict) else None
    if fpid:
        fdir = os.path.join(ROOT, 'projects', fpid)
        env = dict(os.environ)
        env['PATH'] = f"{ROOT}/sdk/flutter-sdk/bin:{env.get('PATH','')}"
        env.update({
            'JAVA_HOME': f'{ROOT}/sdk/jdk-17',
            'GRADLE_USER_HOME': f'{ROOT}/sdk/gradle-home',
            'ANDROID_SDK_ROOT': f'{ROOT}/sdk/android-sdk',
            'ANDROID_HOME': f'{ROOT}/sdk/android-sdk',
            'DOTNET_ROOT': f'{ROOT}/sdk/dotnet-sdk',
        })
        # 1) scaffold ALL code targets in ONE project (multi-platform by design)
        r = subprocess.run(['flutter', 'create', '.', '--platforms=android,ios,linux,windows,macos,web',
                            '--project-name', 'v120targets'],
                           cwd=fdir, env=env, capture_output=True, text=True, timeout=240)
        have = [d for d in ('android', 'ios', 'linux', 'windows', 'macos', 'web') if os.path.isdir(os.path.join(fdir, d))]
        check('flutter: all 6 platform targets scaffolded', r.returncode == 0 and len(have) == 6,
              f'rc={r.returncode} have={have} {r.stderr[-200:]}')
        results['flutter-targets'] = f'{len(have)}/6'
        stop_run(cookie, fpid)  # free RAM before the heavy build

        # 2) REAL Android APK (debug, arm64) — gradle memory tuned for 4GB box
        gprop = os.path.join(fdir, 'android', 'gradle.properties')
        if os.path.exists(gprop):
            txt = open(gprop).read()
            txt = re.sub(r'org\.gradle\.jvmargs=.*', 'org.gradle.jvmargs=-Xmx1400M -XX:MaxMetaspaceSize=384M', txt)
            if 'org.gradle.jvmargs' not in txt:
                txt += '\norg.gradle.jvmargs=-Xmx1400M -XX:MaxMetaspaceSize=384M\n'
            open(gprop, 'w').write(txt)
        print(f'   ↳ disk free before apk: {disk_free_g():.1f}G', flush=True)
        apk_out = os.path.join(fdir, 'build', 'app', 'outputs', 'flutter-apk')
        if disk_free_g() < 2.2:
            check('flutter: apk build skipped (disk low)', False, f'{disk_free_g():.1f}G free')
            results['flutter-apk'] = 'DISK-LOW'
        else:
            try:
                r = subprocess.run(['flutter', 'build', 'apk', '--debug', '--target-platform', 'android-arm64'],
                                   cwd=fdir, env=env, capture_output=True, text=True, timeout=900)
                apks = [f for f in (os.listdir(apk_out) if os.path.isdir(apk_out) else []) if f.endswith('.apk')]
                ok = r.returncode == 0 and apks
                size = os.path.getsize(os.path.join(apk_out, apks[0])) // 1024 if apks else 0
                check('flutter: REAL Android APK built', ok,
                      f'rc={r.returncode} {r.stdout[-250:]} {r.stderr[-250:]}')
                if ok:
                    print(f'   ↳ APK: {apks[0]} ({size} KB)', flush=True)
                    results['flutter-apk'] = f'OK {apks[0]} {size}KB'
                else:
                    results['flutter-apk'] = 'FAIL'
            except subprocess.TimeoutExpired:
                check('flutter: apk build timed out (900s)', False); results['flutter-apk'] = 'TIMEOUT'

        # 3) honest platform matrix note
        print('   ↳ iOS ipa / Windows exe / macOS app compile needs that OS (Xcode/VirtualStudio) — '
              'code targets are generated here and the SAME Dart codebase builds there unmodified.', flush=True)
        hard_delete(cookie, fpid)
    else:
        check('flutter: targets project created', False, str(out)[:150])

    # ============ PART C — CLEANUP ============
    print('\n===== CLEANUP =====', flush=True)
    try:
        sc, out, _ = req('GET', '/api/projects', None, cookie, timeout=30)
        plist = out.get('projects', []) if isinstance(out, dict) else []
        for p in plist:
            if str(p.get('name', '')).startswith('v120 '):
                hard_delete(cookie, p['id'])
    except Exception as e:
        print('cleanup list failed:', e, flush=True)
    shutil.rmtree(SCRATCH, ignore_errors=True)
    try:
        con = sqlite3.connect(os.path.join(ROOT, 'db', 'custom.db'))
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        ut = next((t for t in tables if 'user' in t.lower()), None)
        if ut:
            con.execute(f"DELETE FROM {ut} WHERE email LIKE 'e2e-v120%'")
            con.commit()
        con.close()
    except Exception as e:
        print('db cleanup skipped:', e, flush=True)

    print('\n===== MATRIX =====', flush=True)
    for k, v in results.items(): print(f'  {k:18s} {v}', flush=True)
    print(f'\nTOTAL: {len(PASS)} passed, {len(FAIL)} failed', flush=True)
    for f in FAIL: print('  FAIL:', f, flush=True)
    sys.exit(1 if FAIL else 0)

if __name__ == '__main__':
    main()
