#!/usr/bin/env bash
# v77 — PHP 8 (static single-binary CLI, no root needed) + Composer
# → /home/z/my-project/sdk/php/php  and  /home/z/my-project/sdk/composer/composer
# Why: languages.ts claims PHP (`php -S 0.0.0.0:$PORT`) but no php binary existed.
# static-php-cli ships a self-contained php CLI (built-in web server works).
set -u
PHP_DIR="/home/z/my-project/sdk/php"
COMP_DIR="/home/z/my-project/sdk/composer"
WORK="/home/z/my-project/.flutter-setup"
mkdir -p "$WORK" "$PHP_DIR"

if [ -x "$PHP_DIR/php" ]; then
  echo "[setup-php] present: $("$PHP_DIR/php" -v 2>&1 | head -1)"
else
  echo "[setup-php] discovering latest static php CLI (dl.static-php.dev)…"
  # NOTE: GitHub API rate-limits unauthenticated calls — use the official
  # static-php.dev mirror listing instead of the releases API.
  ASSET="https://dl.static-php.dev/static-php-cli/common/$(curl -s https://dl.static-php.dev/static-php-cli/common/ \
    | grep -o 'php-[0-9.]*-cli-linux-x86_64\.tar\.gz' | sort -uV | tail -1)"
  [ -n "${ASSET##https://dl.static-php.dev/static-php-cli/common/}" ] || { echo "[setup-php] FATAL: no static php asset found"; exit 1; }
  echo "[setup-php] downloading $ASSET (resumable)…"
  for i in $(seq 1 20); do
    curl -sL -C - --retry 3 --retry-delay 2 -o "$WORK/php.tar.gz" "$ASSET" && break
    sleep 2
  done
  [ -s "$WORK/php.tar.gz" ] || { echo "[setup-php] FATAL: download failed"; exit 1; }
  tar -xzf "$WORK/php.tar.gz" -C "$WORK" || { echo "[setup-php] FATAL: extraction failed"; exit 1; }
  BIN=$(ls "$WORK"/php 2>/dev/null | head -1)
  [ -n "$BIN" ] || { echo "[setup-php] FATAL: php binary not in archive"; exit 1; }
  mv "$BIN" "$PHP_DIR/php"
  chmod +x "$PHP_DIR/php"
  rm -f "$WORK/php.tar.gz"
  "$PHP_DIR/php" -v | head -1
fi

if [ -x "$COMP_DIR/composer" ]; then
  echo "[setup-php] composer present"
else
  mkdir -p "$COMP_DIR"
  curl -sL https://getcomposer.org/download/latest-stable/composer.phar -o "$COMP_DIR/composer.phar" || { echo "[setup-php] FATAL: composer download failed"; exit 1; }
  printf '#!/usr/bin/env bash\nexec /home/z/my-project/sdk/php/php /home/z/my-project/sdk/composer/composer.phar "$@"\n' > "$COMP_DIR/composer"
  chmod +x "$COMP_DIR/composer"
  "$COMP_DIR/composer" --version 2>&1 | head -1
fi
echo "[setup-php] DONE — php $(du -sh "$PHP_DIR" | cut -f1) + composer $(du -sh "$COMP_DIR" | cut -f1)"
