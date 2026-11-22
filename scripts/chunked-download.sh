#!/usr/bin/env bash
# chunked-download.sh — stall-proof downloader for the sandbox's flaky long
# transfers (GCS bursts fast then cuts the connection). Downloads a big file
# as N parallel RANGE chunks (short-lived connections), then concatenates
# onto the existing partial file.
#
# Usage: chunked-download.sh <url> <outfile> <total-bytes> [num-chunks]
set -u
URL=$1
OUT=$2
TOTAL=$3
N=${4:-8}
TMP=/tmp/my-project/tcwork/chunks-$$
mkdir -p "$TMP"

HAVE=$(stat -c%s "$OUT" 2>/dev/null || echo 0)
if [ "$HAVE" -ge "$TOTAL" ]; then echo "already complete ($HAVE/$TOTAL)"; exit 0; fi
REMAIN=$((TOTAL - HAVE))
CH=$(( (REMAIN + N - 1) / N ))
echo "resuming: have=$HAVE need=$REMAIN chunks=$N chunk-size=$CH"

pids=()
for i in $(seq 0 $((N-1))); do
  S=$((HAVE + i*CH)); E=$((S + CH - 1))
  [ "$E" -ge "$TOTAL" ] && E=$((TOTAL - 1))
  [ "$S" -gt "$E" ] && continue
  (
    for a in 1 2 3 4 5 6; do
      curl -sL --max-time 120 --speed-time 15 --speed-limit 30000 -r "$S-$E" -o "$TMP/c$i" "$URL" && break
      sleep 2
    done
    sz=$(stat -c%s "$TMP/c$i" 2>/dev/null || echo 0)
    want=$((E - S + 1))
    [ "$sz" -ne "$want" ] && echo "chunk $i short: $sz/$want" >&2
  ) &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done

cat "$TMP"/c* >> "$OUT" 2>/dev/null || { echo "concat failed"; exit 1; }
rm -rf "$TMP"
FINAL=$(stat -c%s "$OUT")
echo "final: $FINAL / $TOTAL"
[ "$FINAL" -eq "$TOTAL" ] && echo DOWNLOAD-COMPLETE || { echo DOWNLOAD-INCOMPLETE; exit 1; }
