#!/usr/bin/env python3
"""
Task 128 (v128) — CloudAgent GitHub Pages "web release" deployer.

Flow:
  A. Push the static landing (scripts/ghpages/) to the OWNER'S literal ask:
     the private repo Cloud-Agent-ai-app-builder- on an orphan `gh-pages`
     branch (Git Data API), then try to enable Pages there.
     -> On a free plan a PRIVATE repo cannot have Pages; if enabling fails,
        or the build errors, delete the Pages config and fall back.
  B. Dedicated PUBLIC release repo `cloudagent-web` (landing-only, zero
     platform source) — push files, enable Pages from `main`, poll until live.

Secrets: the PAT is read from the GH_TOKEN env var and never printed.
"""
import base64
import json
import os
import sys
import time

import requests

API = "https://api.github.com"
OWNER = "mdhonabali02"
MAIN_REPO = "Cloud-Agent-ai-app-builder-"
RELEASE_REPO = "cloudagent-web"
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ghpages")
POLL_SECONDS = 210
MESSAGE = "web release: CloudAgent public landing (v128)"

TOKEN = os.environ.get("GH_TOKEN", "").strip()
if not TOKEN:
    print("FATAL: GH_TOKEN not set")
    sys.exit(2)

S = requests.Session()
S.headers.update({
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "cloudagent-release-bot",
})


def call(method, path, good=(200, 201, 204), timeout=30, **kw):
    r = S.request(method, API + path, timeout=timeout, **kw)
    return r


def gh_pages_files():
    files = {}
    for name in ("index.html", "404.html", "login.html", "README.md"):
        with open(os.path.join(SRC, name), "rb") as f:
            files[name] = f.read()
    files[".nojekyll"] = b"\n"  # skip Jekyll processing
    return files


def push_orphan_ghpages(repo, files):
    """Git Data API: blobs -> tree -> orphan commit -> refs/heads/gh-pages."""
    tree_items = []
    for path, data in sorted(files.items()):
        r = call("POST", f"/repos/{OWNER}/{repo}/git/blobs",
                 json={"content": base64.b64encode(data).decode(),
                       "encoding": "base64"})
        if r.status_code != 201:
            raise RuntimeError(f"blob {path}: {r.status_code} {r.text[:200]}")
        tree_items.append({"path": path, "mode": "100644",
                           "type": "blob", "sha": r.json()["sha"]})
    r = call("POST", f"/repos/{OWNER}/{repo}/git/trees", json={"tree": tree_items})
    if r.status_code != 201:
        raise RuntimeError(f"tree: {r.status_code} {r.text[:200]}")
    tree_sha = r.json()["sha"]
    r = call("POST", f"/repos/{OWNER}/{repo}/git/commits",
             json={"message": MESSAGE, "tree": tree_sha, "parents": []})
    if r.status_code != 201:
        raise RuntimeError(f"commit: {r.status_code} {r.text[:200]}")
    csha = r.json()["sha"]
    r = call("GET", f"/repos/{OWNER}/{repo}/git/ref/heads/gh-pages",
             good=(200, 404))
    if r.status_code == 200:
        r = call("PATCH", f"/repos/{OWNER}/{repo}/git/refs/heads/gh-pages",
                 json={"sha": csha, "force": True})
    else:
        r = call("POST", f"/repos/{OWNER}/{repo}/git/refs",
                 json={"ref": "refs/heads/gh-pages", "sha": csha})
    if r.status_code not in (200, 201):
        raise RuntimeError(f"ref: {r.status_code} {r.text[:200]}")
    return csha


def try_enable_pages(repo, branch):
    r = call("POST", f"/repos/{OWNER}/{repo}/pages",
             json={"source": {"branch": branch, "path": "/"}})
    if r.status_code == 409:
        return True, "already-enabled"
    if r.status_code in (201, 202):
        return True, "created"
    return False, f"{r.status_code} {r.text[:180]}"


def pages_status(repo):
    r = call("GET", f"/repos/{OWNER}/{repo}/pages", good=(200, 404))
    if r.status_code != 200:
        return None
    d = r.json()
    return {"status": d.get("status"), "html_url": d.get("html_url")}


def site_live(url, needle="cloudagent"):
    try:
        resp = requests.get(url, timeout=20,
                            headers={"User-Agent": "cloudagent-release-bot"})
        return resp.status_code == 200 and needle in resp.text.lower()
    except Exception:
        return False


def wait_live(repo, url, seconds=POLL_SECONDS):
    """Poll the site; abort early if the Pages build reports an error."""
    end = time.time() + seconds
    while time.time() < end:
        if site_live(url):
            return True
        st = pages_status(repo)
        if st and st.get("status") == "errored":
            print("   pages build ERRORED:", st)
            return False
        time.sleep(12)
    return False


def main():
    files = gh_pages_files()
    out = {"owner": OWNER, "files": sorted(files), "result": None, "url": None}

    # ---- Path A: the literal ask — Pages on the (private) main repo ----
    print(f"[A] pushing orphan gh-pages branch to {MAIN_REPO} …")
    try:
        csha = push_orphan_ghpages(MAIN_REPO, files)
        out["ghpages_commit_on_main_repo"] = csha
        print("   gh-pages commit:", csha)
        enabled, detail = try_enable_pages(MAIN_REPO, "gh-pages")
        out["A_pages_enable"] = detail
        print("   enable pages:", detail)
    except Exception as e:  # noqa: BLE001
        enabled, detail = False, f"error: {e}"
        out["A_pages_enable"] = detail
        print("   path A error:", detail)

    if enabled:
        url = f"https://{OWNER}.github.io/{MAIN_REPO}/"
        if wait_live(MAIN_REPO, url, seconds=150):
            out.update({"result": "A", "url": url,
                        "pages": pages_status(MAIN_REPO)})
            print(json.dumps(out, indent=1))
            return
        # enabled but never built (free plan + private repo) — clean up
        r = call("DELETE", f"/repos/{OWNER}/{MAIN_REPO}/pages")
        out["A_cleanup_delete_pages"] = r.status_code
        print("   path A cannot serve (free plan + private repo) → cleaned up, falling back")

    # ---- Path B: dedicated PUBLIC release repo ----
    print(f"[B] public release repo {RELEASE_REPO} …")
    r = call("GET", f"/repos/{OWNER}/{RELEASE_REPO}", good=(200, 404))
    if r.status_code == 404:
        r = call("POST", "/user/repos", json={
            "name": RELEASE_REPO,
            "private": False,
            "auto_init": True,
            "description": ("CloudAgent — AI multi-agent app builder · "
                            "public web release (GitHub Pages)"),
            "homepage": f"https://{OWNER}.github.io/{RELEASE_REPO}/",
        })
        if r.status_code not in (201, 202):
            raise RuntimeError(f"create repo: {r.status_code} {r.text[:300]}")
        print("   repo created (public)")
    else:
        print("   repo already exists — reusing")

    for path, data in sorted(files.items()):
        body = {"message": MESSAGE,
                "content": base64.b64encode(data).decode(),
                "branch": "main"}
        r = call("PUT", f"/repos/{OWNER}/{RELEASE_REPO}/contents/{path}",
                 json=body)
        if r.status_code not in (200, 201) and r.status_code != 422:
            raise RuntimeError(f"put {path}: {r.status_code} {r.text[:200]}")
        print(f"   put {path}: {r.status_code}"
              + (" (unchanged)" if r.status_code == 422 else ""))

    enabled, detail = try_enable_pages(RELEASE_REPO, "main")
    out["B_pages_enable"] = detail
    print("   enable pages:", detail)
    if not enabled:
        raise RuntimeError("could not enable Pages on the public repo: " + detail)

    url = f"https://{OWNER}.github.io/{RELEASE_REPO}/"
    live = wait_live(RELEASE_REPO, url, seconds=POLL_SECONDS)
    out.update({"result": "B", "url": url, "live": live,
                "pages": pages_status(RELEASE_REPO)})
    print(json.dumps(out, indent=1))
    if not live:
        print("NOTE: build may still be provisioning (first Pages site on this "
              "account can take a few extra minutes); check the URL again shortly.")


if __name__ == "__main__":
    main()
