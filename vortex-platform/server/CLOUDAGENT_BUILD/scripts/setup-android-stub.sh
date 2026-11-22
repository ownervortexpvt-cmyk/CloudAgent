#!/bin/bash
# setup-android-stub.sh — offline Android APK capability for small sandboxes.
#
# `flutter build apk` on Flutter 3.47 hits THREE network/disk walls here:
#   1. gradle's flutter plugin runs `sdkmanager --install ndk;<ver>` (blocked:
#      no network, and a real NDK is ~2.5G this 10G disk cannot afford)
#   2. AGP validates ndk/<ver>/source.properties even for pure-Dart apps
#   3. stripDebugSymbols calls the NDK's llvm-strip binary
# Pure-Dart Flutter apps compile NO native code (libflutter.so ships prebuilt),
# so a stub NDK (source.properties + llvm-strip passthrough shim) plus
# `org.gradle.offline=true` (gradle then takes the plugin's synthetic NDK
# fallback) make the full APK pipeline work with ZERO network and ~0 disk.
set -u
SDK=/home/z/my-project/sdk/android-sdk
FW=/home/z/my-project/sdk/flutter-sdk
VER=$(grep -oE 'val ndkVersion: String = "[0-9.]+"' "$FW/packages/flutter_tools/gradle/src/main/kotlin/FlutterExtension.kt" 2>/dev/null | grep -oE '[0-9.]+' | head -1)
[ -z "${VER:-}" ] && VER=28.2.13676358
DIR="$SDK/ndk/$VER"
BIN="$DIR/toolchains/llvm/prebuilt/linux-x86_64/bin"
if [ ! -f "$DIR/source.properties" ]; then
  mkdir -p "$BIN"
  printf 'Pkg.Desc = Android NDK\nPkg.Revision = %s\nPkg.License = android-sdk-license\n' "$VER" > "$DIR/source.properties"
  cat > "$BIN/llvm-strip" <<'SHIM'
#!/bin/bash
# llvm-strip passthrough: output = input unstripped (valid ELF, larger).
# Debug APKs do not need symbol stripping; release strips on a real NDK host.
out=""; in=""; prev=""
for a in "$@"; do
  if [ "$prev" = "-o" ]; then out="$a"; elif [ -f "$a" ]; then in="$a"; fi
  prev="$a"
done
if [ -n "$out" ] && [ -n "$in" ]; then cp "$in" "$out"; exit 0; fi
exit 1
SHIM
  chmod +x "$BIN/llvm-strip"
  echo "[android-stub] NDK $VER stub ready ($DIR) — offline APK builds enabled"
else
  echo "[android-stub] NDK stub already present ($DIR)"
fi
