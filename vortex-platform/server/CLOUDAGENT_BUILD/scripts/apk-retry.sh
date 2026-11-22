#!/bin/bash
# APK build retry loop: gradle's dependency cache accumulates across attempts,
# so repeated retries eventually get past the rate-limited maven downloads.
cd /home/z/my-project/projects/cmwbavvan000gpovwjp1nxw0s
export JAVA_HOME=/home/z/my-project/sdk/jdk-17
export ANDROID_HOME=/home/z/my-project/sdk/android-sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH=/home/z/my-project/sdk/flutter-sdk/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$JAVA_HOME/bin:$PATH
export GRADLE_USER_HOME=/home/z/my-project/sdk/gradle-home
LOG=/tmp/apk-retry.log
echo "=== APK build retry loop started $(date '+%H:%M:%S') ===" > "$LOG"
for attempt in 1 2 3 4; do
  echo "--- attempt $attempt $(date '+%H:%M:%S') ---" >> "$LOG"
  # pub get first — a wiped .dart_tool (platform disk-cleaner) kills the
  # kernel compile with a cryptic gradle error otherwise
  flutter pub get >> "$LOG" 2>&1 || true
  flutter build apk --release >> "$LOG" 2>&1
  # grab the artifact the SECOND it exists — the platform disk-cleaner wipes
  # build/ outputs within ~60s of creation
  if ls build/app/outputs/flutter-apk/*.apk >/dev/null 2>&1; then
    mkdir -p /home/z/my-project/download
    cp -f build/app/outputs/flutter-apk/*.apk /home/z/my-project/download/flutter-apk-test.apk 2>/dev/null
    echo "copied to download/: $(ls -la /home/z/my-project/download/flutter-apk-test.apk 2>/dev/null)" >> "$LOG"
  fi
  if ls build/app/outputs/flutter-apk/*.apk >/dev/null 2>&1; then
    echo "=== SUCCESS: APK produced at attempt $attempt ===" >> "$LOG"
    ls -la build/app/outputs/flutter-apk/*.apk >> "$LOG"
    exit 0
  fi
  echo "--- attempt $attempt failed; cooling down 90s (maven 429 rate limit) ---" >> "$LOG"
  sleep 90
done
echo "=== ALL ATTEMPTS FAILED ===" >> "$LOG"
tail -30 "$LOG"
