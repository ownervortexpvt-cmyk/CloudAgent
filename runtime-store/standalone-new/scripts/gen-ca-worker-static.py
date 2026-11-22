#!/usr/bin/env python3
"""Generate the static-serving cloudagent-builder Worker script.
Embeds the ghpages HTML (index/login/404) as JS strings; the 5.7MB zip
redirects to the Cloudflare Pages deployment."""
import json

BASE = "/home/z/my-project/scripts/ghpages"
PAGES_HOST = "https://cloud-agent-1nz.pages.dev"

def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()

index = json.dumps(read(f"{BASE}/index.html"))
login = json.dumps(read(f"{BASE}/login.html"))
notfound = json.dumps(read(f"{BASE}/404.html"))

worker = f"""// CloudAgent public site (cloudagent-builder)
// 2026-11-08: the old FC-gateway proxy mode is impossible now — the sandbox
// gateway is VPC-only (private IP; Cloudflare Workers block private-IP fetches)
// and its public internet URL is disabled. So this Worker now serves the
// CloudAgent public release site directly, same content as the Pages deploy.
const PAGES = {json.dumps(PAGES_HOST)};
const INDEX = {index};
const LOGIN = {login};
const NOTFOUND = {notfound};

function html(body, status = 200) {{
  return new Response(body, {{
    status,
    headers: {{
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
    }},
  }});
}}

export default {{
  async fetch(request) {{
    const url = new URL(request.url);
    const path = url.pathname.replace(/\\/+$/, "") || "/";
    if (path === "/" || path === "/index.html") return html(INDEX);
    if (path === "/login" || path === "/login.html") return html(LOGIN);
    if (path === "/cloudagent-source-slim.zip" || path === "/download") {{
      return Response.redirect(PAGES + "/cloudagent-source-slim.zip", 302);
    }}
    return html(NOTFOUND, 404);
  }},
}};
"""

with open("/home/z/my-project/scripts/ca-worker-static.js", "w", encoding="utf-8") as f:
    f.write(worker)
print("written:", len(worker), "bytes")
