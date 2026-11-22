#!/bin/bash
# Test: create one project per template, verify scaffold on disk
set -u
AB="agent-browser"
DASH="http://localhost:3000/"
PASS=0; FAIL=0; FAILED=""

create_one() {
  local name="$1" emoji="$2"
  $AB open "$DASH" >/dev/null 2>&1; sleep 1.5
  # open the create dialog
  $AB eval "[...document.querySelectorAll('button')].filter(b=>b.textContent.trim().startsWith('Create New App'))[1]?.click() || [...document.querySelectorAll('button')].filter(b=>b.textContent.trim().startsWith('Create New App'))[0]?.click()" >/dev/null 2>&1
  sleep 1.5
  # find Project name textbox ref from snapshot
  local snap; snap=$($AB snapshot -i 2>/dev/null)
  local ref; ref=$(echo "$snap" | grep -o 'textbox "Project name" \[ref=[^]]*\]' | grep -o 'ref=[^]]*' | cut -d= -f2)
  if [ -z "$ref" ]; then echo "[$name] DIALOG-FAIL (no name box)"; FAIL=$((FAIL+1)); FAILED="$FAILED $name(dialog)"; return; fi
  $AB fill "@$ref" "$name" >/dev/null 2>&1
  # click template button by emoji
  $AB eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('$emoji') && x.textContent.length>40); return b ? (b.click(),'ok') : 'notfound' })()" >/dev/null 2>&1
  sleep 0.8
  # click Create
  $AB eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Create'); return b ? (b.click(),'ok') : 'notfound' })()" >/dev/null 2>&1
  sleep 4
  # confirm we left the dashboard into editor (heading 'Back' button appears)
  local after; after=$($AB snapshot -i -c 2>/dev/null | head -5)
  if echo "$after" | grep -q '"Back"'; then echo "[$name] CREATED"; PASS=$((PASS+1))
  else echo "[$name] CREATE-FAIL :: $(echo "$after" | head -3 | tr '\n' ' ')"; FAIL=$((FAIL+1)); FAILED="$FAILED $name"; fi
}

create_one "T-Nextjs"    "▲ Next.js"
create_one "T-Vue"       "💚 Vue 3"
create_one "T-Svelte"    "🔶 Svelte"
create_one "T-React"     "⚛️ React"
create_one "T-JSNode"    "🟨 JavaScript + Node"
create_one "T-TSNode"    "🟦 TypeScript + Node"
create_one "T-Python"    "🐍 Python + FastAPI"
create_one "T-Java"      "☕ Java + Spring"
create_one "T-PHP"       "🐘 PHP"
create_one "T-Go"        "🐹 Go net/http"
create_one "T-Rust"      "🦀 Rust + Axum"
create_one "T-CSharp"    "C# / .NET 8"
create_one "T-CPP"       "🔧 C++"
create_one "T-Capacitor" "📱 Capacitor"

echo "=== RESULT: PASS=$PASS FAIL=$FAIL ==="
[ -n "$FAILED" ] && echo "FAILED:$FAILED"
exit 0
