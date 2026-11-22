#!/bin/bash
# Verify each template scaffold has its expected files
cd /home/z/my-project/projects || exit 1
check() { # name, dir, file1 [file2...]
  local name=$1 dir=$2; shift 2
  local ok=1 missing=""
  for f in "$@"; do
    if ! ls "$dir"/$f >/dev/null 2>&1; then ok=0; missing="$missing $f"; fi
  done
  if [ $ok -eq 1 ]; then echo "OK      $name"; else echo "MISSING $name ->$missing"; fi
}

for d in cm*; do
  # read project name from DB is complex; use heuristics on files
  if [ -f "$d/pubspec.yaml" ]; then check "Flutter" "$d" "pubspec.yaml" "lib"
  elif [ -f "$d/go.mod" ]; then check "Go" "$d" "go.mod" "main.go"
  elif [ -f "$d/Cargo.toml" ]; then check "Rust" "$d" "Cargo.toml" "src/main.rs"
  elif [ -f "$d/pom.xml" ]; then check "Java" "$d" "pom.xml" "src/main"
  elif [ -f "$d/index.php" ]; then check "PHP" "$d" "index.php" "composer.json"
  elif [ -f "$d/main.py" ]; then check "Python" "$d" "main.py" "requirements.txt"
  elif ls "$d"/*.csproj >/dev/null 2>&1; then check "C#" "$d" "*.csproj" "Program.cs"
  elif [ -f "$d/main.cpp" ]; then check "C++" "$d" "main.cpp"
  elif [ -f "$d/capacitor.config.ts" ] || [ -f "$d/capacitor.config.json" ]; then check "Capacitor" "$d" "package.json" "index.html"
  elif [ -f "$d/next.config.ts" ] || [ -f "$d/next.config.js" ] || [ -f "$d/next.config.mjs" ]; then check "Next.js" "$d" "package.json" "app" 
  elif [ -f "$d/svelte.config.js" ]; then check "Svelte" "$d" "package.json" "src"
  elif [ -f "$d/tsconfig.json" ] && [ -d "$d/src" ] && ls "$d"/src/*.ts >/dev/null 2>&1 && [ -f "$d/package.json" ] && grep -q '"express"' "$d/package.json" 2>/dev/null && grep -q '"typescript"' "$d/package.json" 2>/dev/null && [ ! -f "$d/index.html" ]; then check "TS-Node" "$d" "package.json"
  elif [ -f "$d/index.html" ] && [ -f "$d/server.js" ]; then check "JS-Node" "$d" "package.json" "server.js"
  elif [ -f "$d/vite.config.ts" ] && grep -q '"vue"' "$d/package.json" 2>/dev/null; then check "Vue" "$d" "package.json" "index.html"
  elif [ -f "$d/vite.config.ts" ] && grep -q '"svelte"' "$d/package.json" 2>/dev/null; then check "Svelte" "$d" "package.json"
  elif [ -f "$d/vite.config.ts" ]; then check "React" "$d" "package.json" "index.html"
  elif [ -f "$d/index.html" ]; then check "HTML-static" "$d" "index.html"
  else echo "UNKNOWN $d: $(ls "$d" | tr '\n' ' ' | head -c 120)"; fi
done
