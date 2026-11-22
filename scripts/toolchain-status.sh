#!/usr/bin/env bash
# toolchain-status.sh — one command: live state of all 13 toolchains
# (probe files through the sdk → /home/sync/toolchains symlink) + sizes
# + Joy S3 master status. Run anytime: bash scripts/toolchain-status.sh
TC=/home/sync/toolchains
printf "%-8s %-6s %-9s %s\n" NAME STATE SIZE JOY-MASTER
for pair in "jdk jdk-17/bin/javac" "flutter flutter-sdk/bin/flutter" "android android-sdk/cmdline-tools/latest/bin/sdkmanager" "ndk android-sdk/ndk" "gradle gradle/bin/gradle" "kotlin kotlin/bin/kotlinc" "cmake cmake/bin/cmake" "ninja ninja/bin/ninja" "go go-sdk/bin/go" "php php/php" "maven maven/maven/bin/mvn" "rust cargo-home/bin/cargo" "dotnet dotnet-sdk/dotnet"; do
  set -- $pair; n=$1; p=$2
  if [ -e "$TC/$p" ]; then st=OK; else st="--"; fi
  sz=$(du -sh "$TC/$p" 2>/dev/null | cut -f1)
  joy=$(node /home/z/my-project/scripts/joy-put.cjs head vortex-websites "vortex-platform-seeds/toolchains/$n.tar.gz" 2>/dev/null | awk '{print $2}')
  js=${joy:-?}; [ "$js" = "200" ] && jm=YES || jm=no
  printf "%-8s %-6s %-9s %s\n" "$n" "$st" "${sz:--}" "$jm"
done
echo "markers: $(ls $TC/.installed-* 2>/dev/null | wc -l) installed"
