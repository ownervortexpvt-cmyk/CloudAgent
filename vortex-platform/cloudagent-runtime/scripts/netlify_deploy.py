#!/usr/bin/env python3
"""Netlify deployer for the CloudAgent public website (GitHub-free path).

Idempotent: reuses an existing site when the name matches, otherwise creates
one (trying preferred subdomain names, then auto-name). Every run makes a
fresh production deploy using the digest flow (files map -> required sha1
uploads -> poll until ready -> live verification).

Token ONLY via NETLIFY_TOKEN env var; it is never printed.
"""
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.netlify.com/api/v1"
ROOT = "/home/z/my-project/scripts/ghpages"
FILES = ["index.html", "login.html", "404.html", "cloudagent-source-slim.zip"]
NAME_CANDIDATES = ["cloudagent-web", "cloudagent-ai", "cloudagent-builder", "cloudagent-app"]
TOKEN = os.environ.get("NETLIFY_TOKEN", "").strip()


def req(method, path, data=None, raw=None, timeout=40):
    url = path if path.startswith("http") else API + path
    headers = {"Authorization": "Bearer " + TOKEN}
    body = None
    if raw is not None:
        body = raw
        headers["Content-Type"] = "application/octet-stream"
    elif data is not None:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            txt = resp.read().decode("utf-8", "replace")
            if txt.strip().startswith(("{", "[")):
                return resp.status, json.loads(txt)
            return resp.status, txt
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(txt)
        except Exception:
            return e.code, txt
    except Exception as e:  # network hiccup
        return 0, str(e)


def sha1_file(path):
    with open(path, "rb") as f:
        return hashlib.sha1(f.read()).hexdigest()


def main():
    if not TOKEN:
        print("FATAL: NETLIFY_TOKEN env var missing")
        sys.exit(1)

    # 1) verify token
    s, user = req("GET", "/user")
    if s != 200 or not isinstance(user, dict):
        print("FATAL: token check failed: HTTP %s %s" % (s, str(user)[:160]))
        sys.exit(1)
    print("account OK: %s (id %s...)" % (user.get("email", "?"), str(user.get("id", "?"))[:8]))

    # 2) find or create site
    site = None
    s, sites = req("GET", "/sites?per_page=100")
    if s == 200 and isinstance(sites, list):
        for st in sites:
            if st.get("name") in NAME_CANDIDATES:
                site = st
                print("reusing existing site: %s" % st["name"])
                break
    if site is None:
        for name in NAME_CANDIDATES:
            s, st = req("POST", "/sites", data={"name": name})
            if s in (200, 201) and isinstance(st, dict) and st.get("id"):
                site = st
                print("created site: %s" % name)
                break
            print("  name '%s' unavailable (HTTP %s), trying next..." % (name, s))
    if site is None:
        s, st = req("POST", "/sites", data={})
        if s in (200, 201) and isinstance(st, dict) and st.get("id"):
            site = st
            print("created site (auto name): %s" % st["name"])
    if site is None:
        print("FATAL: could not create any site")
        sys.exit(1)

    sid, sname = site["id"], site["name"]
    live = site.get("ssl_url") or site.get("url")
    print("site: %s -> %s" % (sname, live))

    # 3) digest deploy
    files_map, blobs = {}, {}
    for f in FILES:
        d = sha1_file(os.path.join(ROOT, f))
        files_map["/" + f] = d
        blobs[d] = f
    s, dep = req("POST", "/sites/%s/deploys" % sid, data={"files": files_map})
    if s not in (200, 201) or not isinstance(dep, dict) or "id" not in dep:
        print("FATAL: deploy create failed: HTTP %s %s" % (s, str(dep)[:300]))
        sys.exit(1)
    did = dep["id"]
    need = dep.get("required", [])
    print("deploy %s created; uploading %d file(s)..." % (did[:10], len(need)))
    for sha in need:
        s2, _r = req("PUT", "/deploys/%s/files/%s" % (did, sha), raw=open(os.path.join(ROOT, blobs[sha]), "rb").read())
        print("  upload %-12s HTTP %s" % (blobs[sha], s2))
        if s2 not in (200, 201):
            print("FATAL: upload failed")
            sys.exit(1)

    # 4) poll until ready
    state = "?"
    for _ in range(45):
        s3, d = req("GET", "/deploys/%s" % did)
        if isinstance(d, dict):
            state = d.get("state", "?")
            if state in ("ready", "error"):
                break
        time.sleep(2)
    print("deploy state: %s" % state)
    if state != "ready":
        print("FATAL: deploy did not become ready")
        sys.exit(1)

    # 5) live verification
    checks = [("/", "CloudAgent"), ("/login.html", "CloudAgent"), ("/nope-xyz", "CloudAgent")]
    for path, marker in checks:
        rc = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-L", live.rstrip("/") + path],
            capture_output=True, text=True, timeout=60).stdout
        body = subprocess.run(
            ["curl", "-s", "-L", live.rstrip("/") + path],
            capture_output=True, text=True, timeout=60).stdout
        print("live check %-12s HTTP %s  marker'%s': %s" % (path, rc, marker, "YES" if marker.lower() in body.lower() else "NO"))

    print("DEPLOY COMPLETE: %s" % live)


if __name__ == "__main__":
    main()
