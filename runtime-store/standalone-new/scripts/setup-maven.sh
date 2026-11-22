#!/usr/bin/env bash
# v77 — Apache Maven → /home/z/my-project/sdk/maven/maven
# + persistent local repo /home/z/my-project/sdk/maven-home/repository
# Why: languages.ts claims "Java + Spring Boot (Maven)" but `mvn` was MISSING
# (only a JRE was on PATH — javac now comes from sdk/jdk-17 via runtime PATH).
set -u
DEST="/home/z/my-project/sdk/maven"
WORK="/home/z/my-project/.flutter-setup"
mkdir -p "$WORK"
if [ -x "$DEST/maven/bin/mvn" ]; then echo "[setup-maven] present: $("$DEST/maven/bin/mvn" -version 2>&1 | head -1)"; exit 0; fi
VER=$(curl -s https://dlcdn.apache.org/maven/maven-3/ | grep -o '3\.9\.[0-9]*' | sort -V | tail -1)
[ -n "$VER" ] || VER="3.9.9"
URL="https://dlcdn.apache.org/maven/maven-3/$VER/binaries/apache-maven-$VER-bin.tar.gz"
echo "[setup-maven] downloading $VER (resumable)…"
for i in $(seq 1 20); do
  curl -sL -C - --retry 3 --retry-delay 2 -o "$WORK/maven.tar.gz" "$URL" && break
  sleep 2
done
[ -s "$WORK/maven.tar.gz" ] || { echo "[setup-maven] FATAL: download failed"; exit 1; }
echo "[setup-maven] extracting…"
rm -rf "$DEST"
mkdir -p "$DEST"
tar -xzf "$WORK/maven.tar.gz" -C "$DEST" || { echo "[setup-maven] FATAL: extraction failed"; exit 1; }
mv "$DEST/apache-maven-$VER" "$DEST/maven"
rm -f "$WORK/maven.tar.gz"
mkdir -p /home/z/my-project/sdk/maven-home/repository   # persistent ~/.m2 replacement
JAVA_HOME=/home/z/my-project/sdk/jdk-17 "$DEST/maven/bin/mvn" -version 2>&1 | head -2
echo "[setup-maven] DONE — $(du -sh "$DEST" | cut -f1)"
