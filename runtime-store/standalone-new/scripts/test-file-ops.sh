#!/bin/bash
# Deep file-ops test suite for CloudAgent (project: Flutter APK Build Test)
B="-b /tmp/cj.txt"
H='-H Content-Type:application/json'
API=http://localhost:3000
P=cmwbavvan000gpovwjp1nxw0s
pass=0; fail=0
chk() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "PASS: $3"; else fail=$((fail+1)); echo "FAIL: $3 (expected=$2 got=$1)"; fi }

# 1. write new file
r=$(curl -s $B $H -X POST $API/api/files -d "{\"projectId\":\"$P\",\"path\":\"test_dir/hello.txt\",\"content\":\"Hello CloudAgent\",\"op\":\"write\"}")
chk "$(echo $r | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ok"))')" "True" "write new file"

# 2. read back
r=$(curl -s $B "$API/api/files?projectId=$P&path=test_dir/hello.txt")
chk "$(echo "$r" | python3 -c 'import json,sys;print(json.load(sys.stdin)["content"])')" "Hello CloudAgent" "read back content"

# 3. Bengali + unicode content
r=$(curl -s $B $H -X POST $API/api/files -d "{\"projectId\":\"$P\",\"path\":\"test_dir/bn.txt\",\"content\":\"স্বাগতম CloudAgent — বাংলা টেস্ট ১২৩ ✓\",\"op\":\"write\"}")
chk "$(echo $r | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ok"))')" "True" "write unicode content"
r=$(curl -s $B "$API/api/files?projectId=$P&path=test_dir/bn.txt")
chk "$(echo "$r" | python3 -c 'import json,sys;print(json.load(sys.stdin)["content"])')" "স্বাগতম CloudAgent — বাংলা টেস্ট ১২৩ ✓" "read unicode back"

# 4. createFolder
r=$(curl -s $B $H -X POST $API/api/files -d "{\"projectId\":\"$P\",\"path\":\"test_dir/sub\",\"op\":\"createFolder\"}")
chk "$(echo $r | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ok"))')" "True" "createFolder"
[ -f /home/z/my-project/projects/$P/test_dir/sub/.gitkeep ]; chk "$?" "0" "folder .gitkeep on disk"

# 5. move (rename file)
r=$(curl -s $B $H -X POST $API/api/files -d "{\"projectId\":\"$P\",\"path\":\"test_dir/hello.txt\",\"to\":\"test_dir/sub/renamed.txt\",\"op\":\"move\"}")
chk "$(echo $r | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ok"))')" "True" "move/rename file"
[ -f /home/z/my-project/projects/$P/test_dir/sub/renamed.txt ] && [ ! -f /home/z/my-project/projects/$P/test_dir/hello.txt ]; chk "$?" "0" "old gone + new present on disk"

# 6. binary write (base64 upload simulation)
B64=$(head -c 256 /dev/urandom | base64 -w0)
r=$(curl -s $B $H -X POST $API/api/files -d "{\"projectId\":\"$P\",\"path\":\"test_dir/blob.bin\",\"contentBase64\":\"$B64\",\"op\":\"writeBase64\"}")
chk "$(echo $r | python3 -c 'import json,sys;print(json.load(sys.stdin).get("bytes"))')" "192" "writeBase64 binary size (128B random→base64)"
r=$(curl -s $B "$API/api/files?projectId=$P&path=test_dir/blob.bin&encoding=base64")
got=$(echo "$r" | python3 -c 'import json,sys;print(json.load(sys.stdin)["content"])')
chk "$got" "$B64" "binary roundtrip identical"

# 7. editor save (PUT)
r=$(curl -s $B $H -X PUT $API/api/files -d "{\"projectId\":\"$P\",\"path\":\"test_dir/bn.txt\",\"content\":\"updated v2 — হালনাগাদ\"}")
chk "$(echo $r | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ok"))')" "True" "PUT editor save"
r=$(curl -s $B "$API/api/files?projectId=$P&path=test_dir/bn.txt")
chk "$(echo "$r" | python3 -c 'import json,sys;print(json.load(sys.stdin)["content"])')" "updated v2 — হালনাগাদ" "PUT read-back"

# 8. delete file
r=$(curl -s $B $H -X POST $API/api/files -d "{\"projectId\":\"$P\",\"path\":\"test_dir/blob.bin\",\"op\":\"delete\"}")
chk "$(echo $r | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ok"))')" "True" "delete file"
code=$(curl -s $B -o /dev/null -w "%{http_code}" "$API/api/files?projectId=$P&path=test_dir/blob.bin")
chk "$code" "404" "deleted file now 404"

# 9. delete folder with children (renamed.txt inside sub)
r=$(curl -s $B $H -X POST $API/api/files -d "{\"projectId\":\"$P\",\"path\":\"test_dir/sub\",\"op\":\"delete\"}")
chk "$(echo $r | python3 -c 'import json,sys;print(json.load(sys.stdin).get("ok"))')" "True" "delete folder"
[ ! -e /home/z/my-project/projects/$P/test_dir/sub ]; chk "$?" "0" "folder gone from disk"

# 10. path traversal security — MUST NOT escape
code=$(curl -s $B -o /tmp/trav.json -w "%{http_code}" $H -X POST $API/api/files -d "{\"projectId\":\"$P\",\"path\":\"../../../escaped.txt\",\"content\":\"pwn\",\"op\":\"write\"}")
esc=$( [ -f /home/z/escaped.txt ] || [ -f /home/z/my-project/escaped.txt ] || [ -f /home/z/my-project/projects/escaped.txt ] ) && echo yes || echo no
chk "$esc" "no" "traversal write blocked (HTTP $code)"
code=$(curl -s $B -o /dev/null -w "%{http_code}" "$API/api/files?projectId=$P&path=../../etc/passwd")
chk "$code" "404" "traversal read returns 404/contained"

# 11. invalid projectId
code=$(curl -s $B -o /dev/null -w "%{http_code}" "$API/api/files?projectId=..%2Fevil&path=x.txt")
chk "$code" "404" "invalid projectId rejected"

# 12. unknown op
r=$(curl -s $B $H -X POST $API/api/files -d "{\"projectId\":\"$P\",\"path\":\"x.txt\",\"op\":\"hack\"}")
chk "$(echo $r | python3 -c 'import json,sys;print(json.load(sys.stdin).get("error","")[:15])')" "unknown op: hac" "unknown op 400"

echo "=== RESULT: $pass passed, $fail failed ==="
