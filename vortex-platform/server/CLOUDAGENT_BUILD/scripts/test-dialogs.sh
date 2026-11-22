#!/bin/bash
# Open each editor dialog, capture its heading/content, close it
DIALOGS=("Secrets" "SDK Manager" "Studio" "Collab" "Market")
for d in "${DIALOGS[@]}"; do
  agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='$d'); if(!b) return 'btn-missing'; b.click(); return 'clicked' })()" >/dev/null 2>&1
  sleep 2
  echo "=== $d ==="
  agent-browser eval "(() => { const dlg=document.querySelector('[role=dialog]'); if(!dlg) return 'NO-DIALOG'; const h=dlg.querySelector('h2,h3,[data-radix-collection-item]'); return (h?h.textContent:'(no heading)') + ' ||| ' + dlg.innerText.slice(0,150).replace(/\n+/g,' | ') })()" 2>&1 | head -2
  agent-browser press Escape >/dev/null 2>&1
  sleep 1
done
