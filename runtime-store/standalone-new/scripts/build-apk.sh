#!/usr/bin/env bash
# v94 — background APK build for a Flutter project (sandbox-safe).
#
# Usage: build-apk.sh <projectDir> <statusJsonPath> <outApkPath>
#
# Writes a JSON status file at each step so GET ?kind=status can show live
# progress, copies the finished APK out of build/ (which the ZIP export
# ignores) into .export/, and always exits with a definitive state
# ("done" | "failed") — never leaves "building" hanging after death.
#
# Sandbox lessons encoded here (v73-v80 history):
#   - gradle jvmargs capped to 1 GB (the Xmx4G template OOM-killed next-server)
#   - ndkVersion line commented out (no NDK disk budget; prebuilt libflutter.so)
#   - target-platform android-arm64 (one ABI ≈ 3x smaller + 3x faster)
set -u

DIR="$1"; STATUS="$2"; OUT="$3"

w() { # w '<json>' — overwrite the status file atomically-enough
  printf '%s' "$1" > "$STATUS" 2>/dev/null || true
}

mkdir -p "$(dirname "$STATUS")" "$(dirname "$OUT")" "$DIR/.export" 2>/dev/null
cd "$DIR" || { w '{"state":"failed","note":"project dir missing on disk"}'; exit 1 }

w '{"state":"building","step":"scaffold","note":"ensuring android/ platform exists"}'
if [ ! -f android/app/build.gradle.kts ] && [ ! -f android/app/build.gradle ]; then
  flutter create . --platforms=android --offline > .export/build-apk.log 2>&1 \
    || flutter create . --platforms=android >> .export/build-apk.log 2>&1
fi

w '{"state":"building","step":"memory-guard","note":"capping gradle heap to 1 GB (4 GB sandbox, no swap)"}'
if [ -f android/gradle.properties ]; then
  sed -i 's/^org.gradle.jvmargs=.*/org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=384m/' android/gradle.properties 2>/dev/null || true
  grep -q '^org.gradle.jvmargs=' android/gradle.properties || echo 'org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=384m' >> android/gradle.properties
  # gradle daemon stays single-use here — free RAM for the platform afterwards
  grep -q '^org.gradle.daemon=' android/gradle.properties || echo 'org.gradle.daemon=false' >> android/gradle.properties
fi
if [ -f android/app/build.gradle.kts ]; then
  sed -i 's|^    ndkVersion = flutter.ndkVersion$|    // ndkVersion omitted (sandbox: no NDK disk budget; prebuilt libflutter.so needs none)|' android/app/build.gradle.kts 2>/dev/null || true
fi

w '{"state":"building","step":"pub-get","note":"resolving dart dependencies"}'
flutter pub get >> .export/build-apk.log 2>&1 || true

w '{"state":"building","step":"gradle-build","note":"flutter build apk --debug (arm64) — first build downloads gradle deps, 5-20 min"}'
flutter build apk --debug --target-platform android-arm64 >> .export/build-apk.log 2>&1
code=$?

APK_REL="build/app/outputs/flutter-apk/app-debug.apk"
if [ "$code" -eq 0 ] && [ -f "$APK_REL" ]; then
  cp "$APK_REL" "$OUT" || { w '{"state":"failed","note":"copy to .export failed (disk?)"}'; exit 1 }
  w '{"state":"done","note":"APK ready — press Download"}'
  exit 0
fi

tail -c 2000 .export/build-apk.log 2>/dev/null | tr '\n' ' ' | tr -d '"' > .export/apk-last-error.txt
err=$(cat .export/apk-last-error.txt 2>/dev/null | cut -c1-300)
w "{\"state\":\"failed\",\"note\":\"flutter build apk exited $code — $err\"}"
exit "$code"
