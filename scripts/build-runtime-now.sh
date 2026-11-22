#!/usr/bin/env bash
# BUILD-RUNTIME-NOW (v152.6): install + standalone build with checkpoint-race retries.
set -u
cd /home/z/my-project
for attempt in 1 2 3 4; do
  echo "=== attempt $attempt $(date +%H:%M:%S) ===" >> build-runtime.log
  if [ ! -e node_modules/.bin/next ]; then
    echo "installing deps…" >> build-runtime.log
    bun install --frozen-lockfile >> deps-build.log 2>&1 || bun install >> deps-build.log 2>&1
  fi
  [ -e node_modules/.bin/next ] || { echo "install failed, retrying" >> build-runtime.log; sleep 5; continue; }
  echo "building standalone…" >> build-runtime.log
  DEPLOY_BUILD=1 NODE_OPTIONS="--max-old-space-size=1280" ./node_modules/.bin/next build --webpack >> build-runtime.log 2>&1
  if [ -f .next/standalone/server.js ]; then
    echo "BUILD_OK $(date +%H:%M:%S)" >> build-runtime.log
    exit 0
  fi
  sleep 10
done
echo "BUILD_FAILED_ALL_ATTEMPTS" >> build-runtime.log
exit 1
