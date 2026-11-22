#!/usr/bin/env bash
# v94 — background Windows EXE build for a C#/.NET project (sandbox-safe).
#
# Usage: build-exe.sh <projectDir> <statusJsonPath> <outDir>
#
# Linux dotnet CAN cross-compile Windows executables: dotnet publish
# -r win-x64 --self-contained produces a single .exe (runtime bundled).
# Status JSON updated per step; definitive end state always written.
set -u

DIR="$1"; STATUS="$2"; OUT="$3"

w() { printf '%s' "$1" > "$STATUS" 2>/dev/null || true; }

mkdir -p "$(dirname "$STATUS")" "$OUT" "$DIR/.export" 2>/dev/null
cd "$DIR" || { w '{"state":"failed","note":"project dir missing on disk"}'; exit 1 }

w '{"state":"building","step":"restore","note":"restoring nuget packages"}'
dotnet restore > .export/build-exe.log 2>&1 || true

w '{"state":"building","step":"publish","note":"dotnet publish win-x64 self-contained single-file"}'
dotnet publish -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true \
  -o "$OUT" >> .export/build-exe.log 2>&1
code=$?

EXE=$(find "$OUT" -maxdepth 1 -name '*.exe' 2>/dev/null | head -1)
if [ "$code" -eq 0 ] && [ -n "$EXE" ]; then
  w '{"state":"done","note":"EXE ready — press Download"}'
  exit 0
fi

tail -c 2000 .export/build-exe.log 2>/dev/null | tr '\n' ' ' | tr -d '"' > .export/exe-last-error.txt
err=$(cat .export/exe-last-error.txt 2>/dev/null | cut -c1-300)
w "{\"state\":\"failed\",\"note\":\"dotnet publish exited $code — $err\"}"
exit "$code"
