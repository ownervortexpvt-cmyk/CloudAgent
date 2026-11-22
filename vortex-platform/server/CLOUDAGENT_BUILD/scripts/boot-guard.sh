#!/usr/bin/env bash
# v80 boot-guard — runs DETACHED at every next-server boot (spawned by
# src/instrumentation.ts). Idempotent, fast (<50 ms), never blocks boot.
#
# 1. Re-enforces the gradle memory ceiling in $GRADLE_USER_HOME — a snapshot
#    restore can regenerate sdk/ without gradle-home, and an un-capped gradle
#    JVM (+ kotlin daemon) is what OOM-killed next-server during publish.
# 2. Ensures the dev-watchdog (30 s :3000 probe + cold recovery) is alive.
#    It is single-instance via its own lock, so re-running is always safe.
set -u
BASE=/home/z/my-project
GH="$BASE/sdk/gradle-home"
CAP='# v80 gradle memory ceiling'
PROPS='org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=384m -XX:+UseSerialGC
org.gradle.daemon=false
kotlin.compiler.execution.strategy=in-process
kotlin.daemon.jvmargs=-Xmx512m'

mkdir -p "$GH" 2>/dev/null
if [ ! -f "$GH/gradle.properties" ] || ! grep -q "$CAP" "$GH/gradle.properties" 2>/dev/null; then
  { echo "$CAP (sandbox: 4 GB RAM, no swap — see runtime.ts oom guard)"; echo "$PROPS"; } > "$GH/gradle.properties" 2>/dev/null
fi

# watchdog: script holds its own lock — a second copy exits immediately
if [ -d "$BASE/.dev-watchdog.lock" ]; then
  AGE=$(( $(date +%s) - $(stat -c %Y "$BASE/.dev-watchdog.lock" 2>/dev/null || echo 0) ))
  if [ "$AGE" -le 120 ]; then exit 0; fi
fi
nohup setsid bash "$BASE/scripts/dev-watchdog.sh" </dev/null >> "$BASE/dev-watchdog.log" 2>&1 &
