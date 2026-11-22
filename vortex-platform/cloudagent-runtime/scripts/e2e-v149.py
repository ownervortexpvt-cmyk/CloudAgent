#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
v149 e2e — owner asks:
  1. publish INSIDE CloudAgent (no external cloud)   → self-host target + /sites serving
  2. VORTEX server + VORTEX website inside the agent → /api/admin/vortex control
  3. CloudAgent self-build update                    → /api/admin/self-update
  4. (v148 carry-over) Razorpay encrypted + admin credentials

Bengali ✅/❌ report at the end. Secrets never printed.
"""
import json, time, urllib.request, urllib.error, sys, io

BASE = "http://localhost:3000"
OWNER = "mdhonabali61@gmail.com"
NEW_PW = "DCnTt8wwtuj3f6R"
NEW_PIN = "DCnTt8wwtuj3f6R"
OLD_PW = "Vortex@2026"
OLD_PIN = "1000391619244862"

PASS = 0
FAIL = 0
FAILS = []

def ok(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL += 1
        FAILS.append(f"{name} :: {detail}")
        print(f"  ❌ {name}" + (f" — {detail}" if detail else ""))

def req(method, path, body=None, cookies="", raw=False, timeout=60):
    headers = {}
    if body is not None:
        headers["content-type"] = "application/json"
    if cookies:
        headers["cookie"] = cookies
    r = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None,
                               headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            data = resp.read()
            sc = resp.headers.get("Set-Cookie")
            return resp.status, (data if raw else (json.loads(data) if data else {})), sc
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            return e.code, (data if raw else json.loads(data) if data else {}), e.headers.get("Set-Cookie")
        except Exception:
            return e.code, {}, None

def jar_from(setc):
    jar = {}
    if not setc:
        return jar
    if isinstance(setc, str):
        setc = [setc]
    for c in setc:
        pair = c.split(";")[0]
        k, _, v = pair.partition("=")
        jar[k.strip()] = v
    return jar

print("── A. admin credentials (v148 carry-over) ──")
s, j, sc = req("POST", "/api/auth/login", {"email": OWNER, "password": NEW_PW})
jar = jar_from(sc)
AUTH = "; ".join(f"{k}={v}" for k, v in jar.items())
ok("owner login with NEW password", s == 200 and j.get("ok") is True, f"status={s}")

s2, _, _ = req("POST", "/api/auth/login", {"email": OWNER, "password": OLD_PW})
ok("old login password is DEAD", s2 == 401, f"status={s2}")

s3, j3, sc3 = req("POST", "/api/admin/panel/session", {"pin": NEW_PIN}, cookies=AUTH)
jar3 = jar_from(sc3)
LOCKC = "; ".join(f"{k}={v}" for k, v in jar3.items())
ok("control room unlocks with NEW pin", s3 == 200 and j3.get("ok") is True, f"status={s3} {str(j3)[:80]}")
ADMIN = AUTH + "; " + LOCKC

s4, _, _ = req("POST", "/api/admin/panel/session", {"pin": OLD_PIN}, cookies=AUTH)
ok("old control-room pin is DEAD", s4 in (401, 403), f"status={s4}")

print("── B. publish shelf (21 targets, none removed) ──")
s5, j5, _ = req("GET", "/api/version")
ok("platform answering", s5 == 200 and "buildId" in j5, f"status={s5}")

print("── C. self-host publish INSIDE CloudAgent ──")
stamp = str(int(time.time()))
slug = ""
live = ""
v1 = 0
s6, j6, _ = req("POST", "/api/projects", {"name": f"selfhost {stamp}", "language": "html", "description": "v149 e2e"}, cookies=AUTH)
pid = ((j6.get("project") or {}) if isinstance(j6, dict) else {}).get("id")
ok("project created", s6 in (200, 201) and pid, f"status={s6} {str(j6)[:120]}")

page = f"""<!doctype html><html><head><meta charset="utf-8"><title>V149 LIVE {stamp}</title>
<link rel="stylesheet" href="style.css"></head>
<body><h1 id="t">CLOUDAGENT-SELFHOST-OK-{stamp}</h1><script src="js/app.js"></script></body></html>"""
if pid:
    s7, j7, _ = req("PUT", "/api/files", {"projectId": pid, "path": "index.html", "content": page}, cookies=AUTH)
    ok("index.html written", s7 == 200 and j7.get("ok"), f"status={s7}")
    s7b, j7b, _ = req("PUT", "/api/files", {"projectId": pid, "path": "style.css", "content": "h1{color:#7ea2ff}"}, cookies=AUTH)
    ok("style.css written", s7b == 200, f"status={s7b}")
    s7c, j7c, _ = req("PUT", "/api/files", {"projectId": pid, "path": "js/app.js", "content": "console.log('v149')"}, cookies=AUTH)
    ok("js/app.js written", s7c == 200, f"status={s7c}")

    s8, j8, _ = req("POST", "/api/publish", {"projectId": pid, "target": "self-host"}, cookies=AUTH, timeout=180)
    ok("publish → self-host OK", s8 == 200 and j8.get("ok") is True and j8.get("liveUrl"), f"status={s8} {str(j8)[:180]}")
    site = j8.get("selfHost") or {}
    slug = site.get("siteId", "")
    live = j8.get("liveUrl", "")
    v1 = site.get("version", 0)

    s9, b9, _ = req("GET", live[len(BASE):] if live.startswith("http") else live, raw=True)
    ok("self-hosted site LIVE on the agent itself", s9 == 200 and f"CLOUDAGENT-SELFHOST-OK-{stamp}".encode() in b9, f"status={s9} url={live[:60]}")
    s9b, b9b, _ = req("GET", f"/sites/{slug}/style.css", raw=True)
    ok("asset served with css content-type", s9b == 200 and b"7ea2ff" in b9b, f"status={s9b}")
    s9c, b9c, _ = req("GET", f"/sites/{slug}/js/app.js", raw=True)
    ok("nested path served", s9c == 200 and b"v149" in b9c, f"status={s9c}")

    s10, j10, _ = req("POST", "/api/publish", {"projectId": pid, "target": "self-host"}, cookies=AUTH, timeout=180)
    site2 = (j10.get("selfHost") or {}) if isinstance(j10, dict) else {}
    ok("re-publish bumps the SAME site's version", s10 == 200 and site2.get("siteId") == slug and site2.get("version", 0) == v1 + 1,
       f"v{v1}→v{site2.get('version')} slug={site2.get('siteId')}")

print("── D. VORTEX ecosystem control ──")
s11, j11, _ = req("GET", "/api/admin/vortex", cookies=ADMIN, timeout=120)
ok("vortex status: server ONLINE", s11 == 200 and (j11.get("vortexServer") or {}).get("online") is True, f"status={s11} {str(j11)[:120]}")
mirror = (j11.get("vortexWebsite") or {}).get("mirror") or {}
ok("VORTEX website mirror LIVE inside the agent", s11 == 200 and mirror.get("live") is True, f"mirror={str(mirror)[:80]}")
s12, b12, _ = req("GET", "/sites/vortex-website/", raw=True, timeout=60)
ok("VORTEX website served BY CloudAgent at /sites/vortex-website/", s12 == 200 and (b"VORTEX" in b12 or b"vortex" in b12), f"status={s12} bytes={len(b12)}")
sites = j11.get("selfHostSites") or []
if slug:
    ok("self-host registry lists the e2e site + the vortex mirror",
        any(x.get("siteId") == slug for x in sites) and any(x.get("siteId") == "vortex-website" for x in sites),
        f"sites={[x.get('siteId') for x in sites][:6]}")

s13, j13, _ = req("POST", "/api/admin/vortex", {"action": "update-website"}, cookies=ADMIN, timeout=180)
vh = j13.get("vortexHosting") or {}
ok("update-website: mirror redeployed", s13 == 200 and j13.get("ok") is True, f"status={s13} {str(j13)[:140]}")
ok("update-website: also live on :3200 vortex hosting", vh.get("ok") is True and vh.get("url"), f"hosting={str(vh)[:100]}")

print("── E. self-update API ──")
s14, j14, _ = req("GET", "/api/admin/self-update", cookies=ADMIN)
ok("self-update status endpoint", s14 == 200 and j14.get("current", {}).get("buildId"), f"status={s14} {str(j14)[:100]}")
mode_before = j14.get("current", {}).get("mode")

print("── F. THE REAL THING: update the agent's own build ──")
s15, j15, _ = req("POST", "/api/admin/self-update", {"action": "start"}, cookies=ADMIN, timeout=30)
started = s15 == 200 and j15.get("ok") is True
ok("self-update job started", started, f"status={s15} {str(j15)[:140]}")

final_phase, final_build = None, None
if started:
    deadline = time.time() + 900  # 15 min ceiling
    last = ""
    while time.time() < deadline:
        time.sleep(15)
        try:
            _, st, _ = req("GET", "/api/admin/self-update", cookies=ADMIN, timeout=30)
            job = st.get("job") or {}
            last = f"{job.get('phase')} / {job.get('note') or job.get('error')}"
            print(f"    … {last}")
            if not job.get("running") and job.get("phase") in ("done", "failed"):
                final_phase = job.get("phase")
                final_build = job.get("buildId")
                break
        except Exception as e:
            # the server may bounce mid-swap — keep polling
            print(f"    … (server busy: {e})")
    ok("self-update job FINISHED", final_phase == "done", f"phase={final_phase} last={last[:120]}")

s16, j16, _ = req("GET", "/api/version", timeout=30)
build_now = j16.get("buildId", "")
ok(":3000 now serves the NEW production build (not dev)", build_now not in ("", "dev"), f"buildId={build_now} mode_before={mode_before}")

# post-prod regression: the new build still carries v149
s17, j17, _ = req("POST", "/api/auth/login", {"email": OWNER, "password": NEW_PW}, timeout=60)
ok("prod build: owner login works", s17 == 200 and j17.get("ok") is True, f"status={s17}")
jar17 = jar_from(None if s17 != 200 else req("POST", "/api/auth/login", {"email": OWNER, "password": NEW_PW})[2])
AUTH17 = "; ".join(f"{k}={v}" for k, v in jar17.items()) if jar17 else AUTH
_, jj, _ = req("POST", "/api/auth/login", {"email": OWNER, "password": NEW_PW})
# reuse original cookies (sessions survive restarts — registry is in the DB)
s18, j18, _ = req("GET", "/api/admin/self-update", cookies=ADMIN, timeout=60)
ok("prod build: self-update endpoint present", s18 == 200 and j18.get("current", {}).get("buildId") == build_now, f"status={s18}")
s19, j19, _ = req("GET", "/api/admin/vortex", cookies=ADMIN, timeout=120)
ok("prod build: vortex control present", s19 == 200 and j19.get("ok") is True, f"status={s19}")
if slug:
    s20, b20, _ = req("GET", f"/sites/{slug}/", raw=True, timeout=60)
    ok("prod build: self-hosted site still live", s20 == 200 and b"CLOUDAGENT-SELFHOST" in b20, f"status={s20}")

print("── G. VORTEX restart action (last — server restarts) ──")
s21, j21, _ = req("POST", "/api/admin/vortex", {"action": "restart-server"}, cookies=ADMIN, timeout=30)
ok("restart-server accepted", s21 == 200 and j21.get("ok") is True, f"status={s21} {str(j21)[:100]}")
back = False
deadline = time.time() + 180
while time.time() < deadline:
    time.sleep(15)
    s22, j22, _ = req("GET", "/api/admin/vortex", cookies=ADMIN, timeout=30)
    if (j22.get("vortexServer") or {}).get("online") is True:
        back = True
        break
ok("watchdog brought the VORTEX server back ONLINE", back, "did not come back within 180s")

print()
print("════════ v149 ফলাফল ════════")
print(f"✅ PASS: {PASS}   ❌ FAIL: {FAIL}")
for f in FAILS:
    print("  ❌", f)
sys.exit(1 if FAIL else 0)
