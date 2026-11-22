#!/usr/bin/env bash
# FORGE-RUNTIME (v156): install -> webpack standalone build ->
# copy self-contained runtime to the SURVIVOR path (vortex-platform/) so the
# checkpoint re-sync (which deletes node_modules/.next every few minutes)
# can never break :3000 again. Mirrors how :3200 already runs.
#
# v156 CHANGE (owner order): the sdk/ toolchains (flutter, android, dotnet,
# jdk, gradle...) are PERMANENT — installed directly, never archived, NEVER
# deleted by a build. The old "rm -rf sdk" purge line is gone for good.
set -u
BASE=/home/z/my-project
cd "$BASE"
LOG=forge-runtime.log

echo "=== forge start $(date +%H:%M:%S) ===" >> $LOG

for attempt in 1 2 3; do
  echo "--- attempt $attempt $(date +%H:%M:%S) ---" >> $LOG
  if [ ! -e node_modules/.bin/next ]; then
    bun install --frozen-lockfile >> deps-build.log 2>&1 || bun install >> deps-build.log 2>&1
  fi
  [ -e node_modules/.bin/next ] || { echo "install failed" >> $LOG; sleep 5; continue; }
  echo "building (webpack, heap 1280)…" >> $LOG
  DEPLOY_BUILD=1 NODE_OPTIONS="--max-old-space-size=1280" ./node_modules/.bin/next build --webpack >> build-runtime.log 2>&1
  if [ -f .next/standalone/server.js ]; then
    echo "BUILD_OK — copying runtime" >> $LOG
    rm -rf vortex-platform/cloudagent-runtime
    mkdir -p vortex-platform/cloudagent-runtime
    cp -a .next/standalone/. vortex-platform/cloudagent-runtime/
    mkdir -p vortex-platform/cloudagent-runtime/.next/static
    cp -a .next/static/. vortex-platform/cloudagent-runtime/.next/static/ 2>/dev/null
    cp -a public vortex-platform/cloudagent-runtime/ 2>/dev/null
    if [ -f vortex-platform/cloudagent-runtime/server.js ]; then
      echo "RUNTIME_FORGED $(date +%H:%M:%S)" >> $LOG
      # v158 — SYNC TO LIVE_RT: /home/sync/runtime-live/cloudagent-runtime is
      # the SERVING copy (janitor-proof). Every forge refreshes it in place so
      # the next :3000 restart (self-update swap / watchdog respawn) picks up
      # the new build. Verified: BUILD_ID must match the forge output.
      rm -rf /home/sync/runtime-live/cloudagent-runtime
      mkdir -p /home/sync/runtime-live
      if cp -a vortex-platform/cloudagent-runtime /home/sync/runtime-live/ 2>>$LOG \
         && [ "$(cat /home/sync/runtime-live/cloudagent-runtime/.next/BUILD_ID 2>/dev/null)" = "$(cat vortex-platform/cloudagent-runtime/.next/BUILD_ID 2>/dev/null)" ]; then
        echo "LIVE_RT_SYNCED $(date +%H:%M:%S) (BUILD_ID $(cat vortex-platform/cloudagent-runtime/.next/BUILD_ID))" >> $LOG
      else
        echo "LIVE_RT_SYNC_FAILED $(date +%H:%M:%S) — watchdog will restore from tarball" >> $LOG
      fi
      # v153.3 — durable seeds BOTH places: /home/sync (fast path) AND the
      # git-committed runtime-store/ (durable — survives checkpoint re-syncs;
      # the watchdog restores from whichever survives).
      # v156.1 — SYNC + VERIFIED: the old detached tar captured a runtime the
      # janitor had ALREADY gutted (node_modules/next missing → every watchdog
      # restore produced a broken :3000). The tar now runs synchronously and
      # is only declared saved when it really contains the bundled next
      # modules + BUILD_ID; otherwise forge falls back to re-tarring the
      # freshly forged dir it just verified above.
      tarball_saved=0
      for TGT in /home/sync/runtime-store "$BASE/runtime-store"; do
        mkdir -p "$TGT"
        if tar czf "$TGT/runtime.tar.new" -C vortex-platform cloudagent-runtime 2>/dev/null \
           && mv "$TGT/runtime.tar.new" "$TGT/runtime.tar.gz" 2>/dev/null \
           && tar tzf "$TGT/runtime.tar.gz" 2>/dev/null | grep -q 'cloudagent-runtime/node_modules/next/package.json' \
           && tar tzf "$TGT/runtime.tar.gz" 2>/dev/null | grep -q 'cloudagent-runtime/.next/BUILD_ID'; then
          echo "RUNTIME_TARBALL_SAVED $(date +%H:%M:%S) -> $TGT (verified)" >> $LOG
          tarball_saved=1
        else
          echo "RUNTIME_TARBALL_REJECT $TGT (incomplete capture)" >> $LOG
          rm -f "$TGT/runtime.tar.new"
        fi
      done
      [ "$tarball_saved" -eq 0 ] && echo "RUNTIME_TARBALL_ALL_REJECTED $(date +%H:%M:%S)" >> $LOG
      # v158 — Joy S3 auto-backup (owner's own storage, outside every sandbox
      # lifecycle): after every successful forge the verified tarball is
      # pushed so the watchdog can restore even when ALL local seeds are
      # reverted (04:13 incident class).
      if [ -s /home/sync/runtime-store/runtime.tar.gz ]; then
        node "$BASE/scripts/joy-put.cjs" put /home/sync/runtime-store/runtime.tar.gz \
          vortex-websites vortex-platform-seeds/runtime-v158.tar.gz application/gzip >> $LOG 2>&1 \
          && echo "JOY_SEED_UPLOADED $(date +%H:%M:%S)" >> $LOG \
          || echo "JOY_SEED_UPLOAD_FAILED $(date +%H:%M:%S)" >> $LOG
      fi
      # free the source tree — the runtime is self-contained now
      rm -rf node_modules .next
      exit 0
    fi
  fi
  sleep 8
done
echo "FORGE_FAILED $(date +%H:%M:%S)" >> $LOG
exit 1
