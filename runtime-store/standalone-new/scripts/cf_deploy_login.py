#!/usr/bin/env python3
"""
Redeploy the CloudAgent public site (Cloudflare Pages + Worker) with the
direct-login login.html.

Env:  CF_TOKEN   — Cloudflare API token with Pages:Edit + Workers:Edit.
      BUILDER_URL — optional; when given, bakes PLATFORM_URL into
                    scripts/ghpages/login.html before deploying.

Usage: CF_TOKEN=xxx BUILDER_URL=https://preview-xxx.space-z.ai python3 scripts/cf_deploy_login.py
The token is read from the environment and never printed or stored.
"""
import json
import os
import re
import sys

import requests

BASE = os.path.dirname(os.path.abspath(__file__))
GHPAGES = os.path.join(BASE, "ghpages")
WORKER_JS = os.path.join(BASE, "ca-worker-static.js")
WORKER_NAME = "cloudagent-builder"

TOKEN = os.environ.get("CF_TOKEN", "").strip()
if not TOKEN:
    print("FATAL: CF_TOKEN not set")
    sys.exit(2)

BUILDER_URL = os.environ.get("BUILDER_URL", "").strip()
S = requests.Session()
S.headers.update({"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})


def api(method, path, good=(200, 201, 204), **kw):
    r = S.request(method, "https://api.cloudflare.com/client/v4" + path, timeout=60, **kw)
    ok = r.status_code in good and r.json().get("success", False)
    if not ok:
        print(f"API FAIL {method} {path}: {r.status_code} {r.text[:300]}")
        sys.exit(3)
    return r.json()["result"]


def account_id():
    return api("GET", "/accounts")[0]["id"]


def bake_platform_url(url):
    """Write PLATFORM_URL into login.html (the ONLY line that changes)."""
    path = os.path.join(GHPAGES, "login.html")
    with open(path, encoding="utf-8") as f:
        src = f.read()
    src2 = re.sub(r'const PLATFORM_URL = "[^"]*";', f'const PLATFORM_URL = "{url}";', src)
    if src2 == src and f'PLATFORM_URL = "{url}"' not in src:
        print("FATAL: could not bake PLATFORM_URL")
        sys.exit(4)
    with open(path, "w", encoding="utf-8") as f:
        f.write(src2)
    print("baked PLATFORM_URL =", url)


def deploy_pages(acc):
    projects = api("GET", f"/accounts/{acc}/pages/projects")
    pick = next((p for p in projects if "cloud" in p["name"].lower()), projects[0])
    project = pick["name"]
    print("pages project:", project)
    manifest = {}
    for name in ("index.html", "login.html", "404.html"):
        with open(os.path.join(GHPAGES, name), "rb") as f:
            manifest[name] = f.read()
    # keep the source-kit zip alive on Pages (the Worker redirects to it)
    zpath = os.path.join(GHPAGES, "cloudagent-source-slim.zip")
    zip_part = None
    if os.path.exists(zpath):
        with open(zpath, "rb") as f:
            zip_part = ("cloudagent-source-slim.zip", f.read(), "application/zip")
    form = {"manifest": json.dumps({n: "" for n in manifest})}
    files = [("files", (n, data, "text/html")) for n, data in manifest.items()]
    if zip_part:
        form["manifest"] = json.dumps({n: "" for n in manifest} | {zip_part[0]: ""})
        files.append(("files", zip_part))
    r = requests.post(
        f"https://api.cloudflare.com/client/v4/accounts/{acc}/pages/projects/{project}/deployments",
        headers={"Authorization": f"Bearer {TOKEN}"},
        data=form, files=files, timeout=120,
    )
    j = r.json()
    if not (r.status_code in (200, 201) and j.get("success")):
        print("PAGES DEPLOY FAIL:", r.status_code, r.text[:300])
        sys.exit(5)
    url = j["result"]["url"]
    print("pages deployed:", url)
    return project


def deploy_worker(acc):
    with open(WORKER_JS, "rb") as f:
        body = f.read()
    # modern Workers API: multipart upload with module metadata
    metadata = json.dumps({
        "main_module": "worker.js",
        "compatibility_date": "2026-01-01",
    })
    r = requests.put(
        f"https://api.cloudflare.com/client/v4/accounts/{acc}/workers/scripts/{WORKER_NAME}",
        headers={"Authorization": f"Bearer {TOKEN}"},
        files={
            "metadata": (None, metadata, "application/json"),
            "worker.js": ("worker.js", body, "application/javascript+module"),
        },
        timeout=120,
    )
    j = r.json()
    if not (r.status_code in (200, 201) and j.get("success")):
        print("WORKER DEPLOY FAIL:", r.status_code, r.text[:300])
        sys.exit(6)
    print("worker deployed:", WORKER_NAME)
    # make sure the workers.dev route stays enabled
    sub = api("GET", f"/accounts/{acc}/workers/subdomain")["subdomain"]
    en = requests.post(
        f"https://api.cloudflare.com/client/v4/accounts/{acc}/workers/scripts/{WORKER_NAME}/subdomain",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        data=json.dumps({"enabled": True}), timeout=30,
    )
    print("workers.dev:", f"https://{WORKER_NAME}.{sub}.workers.dev",
          "(enable:", en.json().get("success"), ")")


def verify():
    pages = "https://cloud-agent-1nz.pages.dev/login.html"
    for url in (pages, f"https://{WORKER_NAME}.mdhonabali61.workers.dev/login"):
        try:
            txt = requests.get(url + f"?cb={os.getpid()}", timeout=30).text
            direct = 'Direct login' in txt or 'ca_platform_url' in txt
            print(("OK  " if direct else "STALE"), url, "| direct-login marker:", direct)
        except Exception as e:  # noqa: BLE001
            print("ERR ", url, e)


if __name__ == "__main__":
    acc = account_id()
    if BUILDER_URL:
        bake_platform_url(BUILDER_URL)
    deploy_pages(acc)
    deploy_worker(acc)
    verify()
