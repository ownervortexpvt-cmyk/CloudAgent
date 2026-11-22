#!/bin/bash
# Build a local maven2-layout mirror from gradle's cache (symlinks - zero copy).
# Layout: maven-local/<group.dots>/<artifact>/<version>/<file>
CACHE=/home/z/my-project/sdk/gradle-home/caches/modules-2/files-2.1
MIRROR=/home/z/my-project/sdk/maven-local
mkdir -p "$MIRROR"
count=0
for groupdir in "$CACHE"/*/; do
  group=$(basename "$groupdir")
  gpath=$(echo "$group" | tr '.' '/')
  for artidir in "$groupdir"*/; do
    arti=$(basename "$artidir")
    for verdir in "$artidir"*/; do
      ver=$(basename "$verdir")
      dest="$MIRROR/$gpath/$arti/$ver"
      mkdir -p "$dest"
      for f in "$verdir"*/; do
        for file in "$f"*; do
          [ -f "$file" ] || continue
          bn=$(basename "$file")
          [ -e "$dest/$bn" ] || ln -s "$file" "$dest/$bn" 2>/dev/null
          count=$((count+1))
        done
      done
    done
  done
done
echo "mirrored $count artifacts into $MIRROR"

# v124b — synthesize PLUGIN MARKER poms for versions that live only in the
# cache: `plugins { id("x") version "v" }` resolves
# <group>.grad.plugin:<artifact>.grad.plugin:<v> marker POMs, which the
# cache never stores (they come from the plugin portal). gradlePluginPortal
# is reachable (303) but maven-central is 429-throttled, so hand out the
# markers locally and let them point at the cached real artifacts.
mk_marker() {
  local gpath="$1" arti="$2" ver="$3" real_group="$4" real_arti="$5" real_ver="$6"
  local gdot
  gdot=$(echo "$gpath" | tr '/' '.')
  local dest="$MIRROR/$gpath/$arti/$ver"
  mkdir -p "$dest"
  local f="$dest/$arti-$ver.pom"
  [ -e "$f" ] && return 0
  cat > "$f" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>$gdot</groupId>
  <artifactId>$arti</artifactId>
  <version>$ver</version>
  <packaging>pom</packaging>
  <dependencies>
    <dependency>
      <groupId>$real_group</groupId>
      <artifactId>$real_arti</artifactId>
      <version>$real_ver</version>
    </dependency>
  </dependencies>
</project>
EOF
  echo "marker: $gpath/$arti/$ver"
}
# every cached kotlin-gradle-plugin version gets a matching plugin marker
for kv in $(ls "$CACHE/org.jetbrains.kotlin/kotlin-gradle-plugin/" 2>/dev/null); do
  mk_marker "org/jetbrains/kotlin/android" "org.jetbrains.kotlin.android.gradle.plugin" "$kv" "org.jetbrains.kotlin" "kotlin-gradle-plugin" "$kv"
done 2>/dev/null
echo "markers synthesized"
