#!/usr/bin/env bash
# v78 sdk-doctor — ONE command that (re)installs EVERY operator SDK this
# sandbox needs. Two ways it runs:
#   1. Manual:      bash scripts/sdk-doctor.sh        (also --dry-run)
#   2. AUTO-HEAL:   spawned detached by src/instrumentation.ts on EVERY
#                   server boot — sandbox restarts keep wiping sdk/
#                   (snapshot doesn't keep 6.5G of binaries), so the app
#                   re-installs whatever is missing by itself.
# Every setup-*.sh here is resumable (curl -C -, skips when present), so
# re-running is always safe and cheap when nothing is missing.
set -u
BASE=/home/z/my-project
LOG=$BASE/sdk-doctor.log
LOCK=$BASE/.sdk-doctor.lock
STALE_MS=$((2*3600*1000))   # take over locks older than 2h (killed run)

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# ---- v85 disk guard (re-added; the v84.3 copy was lost in the snapshot
# rollback and the boot run filled the disk to 100%). Per-toolchain approx
# size (mirrors src/lib/toolchains.ts approxMb): an install is SKIPPED when
# free disk < need + 800M headroom. Autorun itself stays ON — the owner
# explicitly wants SDKs to auto-download/install — the guard only stops the
# runaway-when-disk-full case.
approx_mb() {
  case "$1" in
    jdk) echo 330 ;; flutter) echo 2300 ;; android) echo 2400 ;; ndk) echo 3000 ;;
    dotnet) echo 600 ;; gradle) echo 150 ;; kotlin) echo 95 ;; cmake) echo 180 ;;
    ninja) echo 2 ;; go) echo 290 ;; php) echo 35 ;; maven) echo 12 ;; rust) echo 310 ;;
    *) echo 500 ;;
  esac
}
free_mb() { df -PM "$BASE" 2>/dev/null | awk 'NR==2 {print $4}'; }

# ---- single-instance lock (script-owned; released via trap) ----
if [ -d "$LOCK" ]; then
  AGE=$(( $(date +%s%3N) - $(stat -c %Y "$LOCK" 2>/dev/null || echo 0) * 1000 ))
  if [ "$AGE" -gt "$STALE_MS" ]; then
    log "stale lock (${AGE}ms) — taking over"
    rm -rf "$LOCK"
  else
    log "another doctor run is active — exiting"
    exit 0
  fi
fi
mkdir -p "$LOCK"
trap 'rm -rf "$LOCK"' EXIT

# v163 single-installer rule: install-all-toolchains.sh (manual/boot lane) and
# this doctor must never write the same SDK concurrently (partial-tree race).
# If the big installer is running, defer to it entirely.
if pgrep -f "install-all-toolchains.sh" >/dev/null 2>&1; then
  log "install-all-toolchains.sh is active — deferring (retry on next boot)"
  exit 0
fi

# ---- toolchain table: NAME | detect-binary | setup-script (order matters:
# jdk first, android before ndk, kotlin needs jdk at runtime) ----
NAMES=(jdk flutter android ndk dotnet gradle kotlin cmake ninja go php maven rust)
detect_of() {
  case "$1" in
    jdk)     echo "$BASE/sdk/jdk-17/bin/javac" ;;
    # v77: a partially-extracted Flutter SDK (bin/flutter present, bin/internal/
    # or packages/ missing) cannot run anything — treat it as MISSING so the
    # doctor reinstalls instead of reporting a broken SDK as installed.
    flutter) if [ -x "$BASE/sdk/flutter-sdk/bin/flutter" ] && [ -s "$BASE/sdk/flutter-sdk/bin/internal/shared.sh" ] && [ -s "$BASE/sdk/flutter-sdk/packages/flutter_tools/pubspec.yaml" ]; then echo "$BASE/sdk/flutter-sdk/bin/flutter"; else echo "$BASE/sdk/flutter-sdk/bin/flutter.INCOMPLETE"; fi ;;
    android) echo "$BASE/sdk/android-sdk/cmdline-tools/latest/bin/sdkmanager" ;;
    ndk)     ls "$BASE"/sdk/android-sdk/ndk/*/source.properties 2>/dev/null | head -1 ;;
    dotnet)  echo "$BASE/sdk/dotnet-sdk/dotnet" ;;
    gradle)  echo "$BASE/sdk/gradle/bin/gradle" ;;
    kotlin)  echo "$BASE/sdk/kotlin/bin/kotlinc" ;;
    cmake)   echo "$BASE/sdk/cmake/bin/cmake" ;;
    ninja)   echo "$BASE/sdk/ninja/bin/ninja" ;;
    go)      echo "$BASE/sdk/go-sdk/bin/go" ;;
    php)     echo "$BASE/sdk/php/php" ;;
    maven)   echo "$BASE/sdk/maven/maven/bin/mvn" ;;
    rust)    echo "$BASE/sdk/cargo-home/bin/cargo" ;;
  esac
}
script_of() {
  case "$1" in
    ndk) echo "$BASE/scripts/setup-ndk.sh" ;;
    *)   echo "$BASE/scripts/setup-$1.sh" ;;
  esac
}

# ---- dry-run: just report ----
if [ "${1:-}" = "--dry-run" ]; then
  for n in "${NAMES[@]}"; do
    P=$(detect_of "$n")
    [ -e "$P" ] && echo "OK       $n ($P)" || echo "MISSING  $n ($(script_of "$n"))"
  done
  [ -e "$BASE/sdk/flutter-sdk/bin/flutter" ] && [ ! -e "$BASE/sdk/flutter-sdk/bin/flutter.INCOMPLETE" ] && [ ! -s "$BASE/sdk/flutter-sdk/bin/internal/shared.sh" ] && echo "BROKEN   flutter (bin/flutter present but SDK incomplete — rerun to reinstall)"
  exit 0
fi

# ---- v79 fix: after a snapshot wipe the sdk/ DIRECTORY itself disappears
# (seen in wipe #4 — setup scripts then fail 'tar: cannot open'). Recreate it
# before any installer runs. Costless when present.
mkdir -p "$BASE/sdk"

# ---- audit ----
log "doctor run start (pid $$, autorun=${SDK_DOCTOR_AUTORUN:-0})"
MISSING=()
for n in "${NAMES[@]}"; do
  P=$(detect_of "$n")
  if [ -e "$P" ]; then
    log "  present : $n"
  else
    log "  MISSING : $n"
    MISSING+=("$n")
  fi
done

# ---- v86 autorun whitelist: boot autorun only installs the OWNER'S NAMED
# set (jdk/flutter/android/dotnet + build helpers). Disk-eaters (ndk, cmake,
# go, php, rust) are MANUAL-ONLY — three snapshot restores filled the disk
# with them while the owner only ever asked for the four above. Manual runs
# (no SDK_DOCTOR_AUTORUN) always install everything missing.
AUTORUN_SET=(jdk flutter android dotnet gradle kotlin maven ninja)
if [ "${SDK_DOCTOR_AUTORUN:-0}" = "1" ]; then
  # v146 JOY-ARCHIVE MODE (owner storage decision) — boot autorun no longer
  # re-downloads gigabytes from the internet. Every toolchain archived to
  # Joy S3 (bucket appverse-apk, sdk-archive/*) stays OFF disk until the
  # owner actually needs it; a real build session restores via the manifest.
  # Boot autorun now REPORTS + points at the archive, installs NOTHING.
  # Manual run (bash scripts/sdk-doctor.sh) still installs everything.
  if [ -e "$BASE/sdk-archive.flag" ] || [ "${SDK_DOCTOR_JOY_MODE:-0}" = "1" ]; then
    for n in "${MISSING[@]}"; do
      case " ${AUTORUN_SET[*]} " in
        *" $n "*) log "  joy-archived: $n — restore on demand (bucket appverse-apk, key sdk-archive/) — NOT re-downloading at boot" ;;
        *) log "  autorun skip: $n (manual-only toolchain — run scripts/sdk-doctor.sh)" ;;
      esac
    done
    log "doctor run done — joy-archive mode: report-only at boot (disk guard per owner's Joy storage decision)"
    exit 0
  fi
  FILTERED=()
  for n in "${MISSING[@]}"; do
    case " ${AUTORUN_SET[*]} " in
      *" $n "*) FILTERED+=("$n") ;;
      *) log "  autorun skip: $n (manual-only toolchain — run scripts/sdk-doctor.sh)" ;;
    esac
  done
  MISSING=("${FILTERED[@]}")
fi
if [ ${#MISSING[@]} -eq 0 ]; then
  log "all wanted toolchains present — nothing to do"
  exit 0
fi
log "reinstalling ${#MISSING[@]}: ${MISSING[*]} (sequential, resumable)"

# ---- install missing, in table order, logging everything ----
FAILED=()
for n in "${NAMES[@]}"; do
  case " ${MISSING[*]} " in *" $n "*) ;; *) continue ;; esac
  # v163 DISK-GUARD v2: installs now land on /home/sync/toolchains (ossfs,
  # effectively unlimited — sdk/ is a symlink to it), so the INSTALLED size
  # no longer consumes rootfs. Only the temp download does. Reserve download
  # headroom (capped at 1.5GB) on the rootfs, not the full install size.
  NEED=$(( $(approx_mb "$n") < 1500 ? $(approx_mb "$n") : 1500 ))
  FREE=$(free_mb)
  if [ -n "$FREE" ] && [ "$FREE" -lt $((NEED + 800)) ]; then
    log "<<< $n SKIPPED — disk low (${FREE}MB free, download headroom ~$((NEED + 800))MB). Free space and re-run scripts/sdk-doctor.sh"
    FAILED+=("$n(disk-low)")
    continue
  fi
  S=$(script_of "$n")
  log ">>> installing $n via $S"
  if bash "$S" >> "$LOG" 2>&1; then
    P=$(detect_of "$n")
    if [ -e "$P" ]; then log "<<< $n OK"; else log "<<< $n script exited 0 but binary still missing"; FAILED+=("$n"); fi
  else
    log "<<< $n FAILED (exit $?)"
    FAILED+=("$n")
  fi
done
if [ ${#FAILED[@]} -eq 0 ]; then
  log "doctor run done — all toolchains restored"
else
  log "doctor run done WITH FAILURES: ${FAILED[*]} — re-run scripts/sdk-doctor.sh (resumable)"
fi
