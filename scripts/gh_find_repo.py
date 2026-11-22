"""Verify a GitHub token (passed via GH_TOKEN env var) and list repos,
highlighting any repo whose name contains 'cloud' or 'agent'.
The token is never written to disk or printed."""
import json
import os
import urllib.request

token = os.environ.get("GH_TOKEN")
if not token:
    raise SystemExit("GH_TOKEN env var not set")

HDRS = {
    "Authorization": "Bearer " + token,
    "Accept": "application/vnd.github+json",
    "User-Agent": "zai-sandbox",
}


def api(path):
    req = urllib.request.Request("https://api.github.com" + path, headers=HDRS)
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


try:
    me = api("/user")
except Exception as e:
    raise SystemExit("TOKEN CHECK FAILED: " + str(e))

print("TOKEN OK  |  LOGIN:", me.get("login"), " |  NAME:", me.get("name"))

repos, page = [], 1
while True:
    batch = api("/user/repos?per_page=100&page=%d&sort=updated" % page)
    repos += batch
    if len(batch) < 100:
        break
    page += 1

print("TOTAL REPOS:", len(repos))
hits = [r for r in repos if "cloud" in r["name"].lower() or "agent" in r["name"].lower()]
print()
print("== MATCHES (name contains cloud/agent) ==")
for r in hits:
    print(" *", r["full_name"], "| private:", r["private"], "| lang:", r.get("language"), "|", (r.get("description") or "")[:80])
if not hits:
    print(" (none)")
print()
print("== ALL REPOS ==")
for r in repos:
    tag = "private" if r["private"] else "public"
    print("  -", r["full_name"], "(%s, %s)" % (tag, r.get("language")))
