#!/bin/bash

set -euo pipefail

# 获取脚本所在目录（.zscripts）
# 使用 $0 获取脚本路径（与 build.sh 保持一致）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log_step_start() {
        local step_name="$1"
        echo "=========================================="
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting: $step_name"
        echo "=========================================="
        export STEP_START_TIME
        STEP_START_TIME=$(date +%s)
}

log_step_end() {
        local step_name="${1:-Unknown step}"
        local end_time
        end_time=$(date +%s)
        local duration=$((end_time - STEP_START_TIME))
        echo "=========================================="
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Completed: $step_name"
        echo "[LOG] Step: $step_name | Duration: ${duration}s"
        echo "=========================================="
        echo ""
}

start_mini_services() {
        local mini_services_dir="$PROJECT_DIR/mini-services"
        local started_count=0

        log_step_start "Starting mini-services"
        if [ ! -d "$mini_services_dir" ]; then
                echo "Mini-services directory not found, skipping..."
                log_step_end "Starting mini-services"
                return 0
        fi

        echo "Found mini-services directory, scanning for sub-services..."

        for service_dir in "$mini_services_dir"/*; do
                if [ ! -d "$service_dir" ]; then
                        continue
                fi

                local service_name
                service_name=$(basename "$service_dir")
                echo "Checking service: $service_name"

                if [ ! -f "$service_dir/package.json" ]; then
                        echo "[$service_name] No package.json found, skipping..."
                        continue
                fi

                if ! grep -q '"dev"' "$service_dir/package.json"; then
                        echo "[$service_name] No dev script found, skipping..."
                        continue
                fi

                echo "Starting $service_name in background..."
                (
                        cd "$service_dir"
                        echo "[$service_name] Installing dependencies..."
                        bun install
                        echo "[$service_name] Running bun run dev..."
                        exec bun run dev
                ) >"$PROJECT_DIR/.zscripts/mini-service-${service_name}.log" 2>&1 &

                local service_pid=$!
                echo "[$service_name] Started in background (PID: $service_pid)"
                echo "[$service_name] Log: $PROJECT_DIR/.zscripts/mini-service-${service_name}.log"
                disown "$service_pid" 2>/dev/null || true
                started_count=$((started_count + 1))
        done

        echo "Mini-services startup completed. Started $started_count service(s)."
        log_step_end "Starting mini-services"
}

wait_for_service() {
        local host="$1"
        local port="$2"
        local service_name="$3"
        local max_attempts="${4:-60}"
        local attempt=1

        echo "Waiting for $service_name to be ready on $host:$port..."

        while [ "$attempt" -le "$max_attempts" ]; do
                if curl -s --connect-timeout 2 --max-time 5 "http://$host:$port" >/dev/null 2>&1; then
                        echo "$service_name is ready!"
                        return 0
                fi

                echo "Attempt $attempt/$max_attempts: $service_name not ready yet, waiting..."
                sleep 1
                attempt=$((attempt + 1))
        done

        echo "ERROR: $service_name failed to start within $max_attempts seconds"
        return 1
}

cleanup() {
        if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
                echo "Stopping Next.js dev server (PID: $DEV_PID)..."
                kill "$DEV_PID" >/dev/null 2>&1 || true
        fi
}

trap cleanup EXIT INT TERM

cd "$PROJECT_DIR"

# v124 single-instance guard: two dev.sh instances racing each other run two
# `bun install`s against the SAME node_modules (partial-tree corruption) and
# two next dev servers fighting for :3000 — every observed "random dev server
# death" traceback ended here. Kill any stale instance before starting.
for stale in $(pgrep -f "next dev" 2>/dev/null); do
        echo "[dev.sh] killing stale 'next dev' process $stale"
        kill -9 "$stale" >/dev/null 2>&1 || true
done
for stale in $(pgrep -f "bash .zscripts/dev.sh" 2>/dev/null); do
        [ "$stale" != "$$" ] || continue
        echo "[dev.sh] killing stale dev.sh instance $stale"
        kill -9 "$stale" >/dev/null 2>&1 || true
done
sleep 1

if ! command -v bun >/dev/null 2>&1; then
        echo "ERROR: bun is not installed or not in PATH"
        exit 1
fi

log_step_start "bun install"
echo "[BUN] Installing dependencies..."
bun install
# v124 sanity: bun install can be OOM-killed mid-extract on the 4GB box
# (e.g. a parallel gradle build) — or a second dev.sh instance can race it —
# and exit with a PARTIAL tree: package.json present but dist/ half-written.
# The dev server then boots from stale .next cache and dies on the first
# recompile ("Cannot find module 'next/dist/compiled/cookie'"). Verify a deep
# compiled file too, retry once, then abort loudly instead of limping.
if [ ! -f "$PROJECT_DIR/node_modules/next/package.json" ] || [ ! -f "$PROJECT_DIR/node_modules/next/dist/server/lib/start-server.js" ]; then
        echo "[BUN] node_modules incomplete (next package partial) — retrying install..."
        bun install
fi
if [ ! -f "$PROJECT_DIR/node_modules/next/package.json" ] || [ ! -f "$PROJECT_DIR/node_modules/next/dist/server/lib/start-server.js" ]; then
        echo "FATAL: node_modules/next still incomplete after retry — run 'bun install' manually and inspect the error."
        exit 1
fi
log_step_end "bun install"

# === RECYCLE-RESILIENCE PATCH (ported from the old v79/v125/v127 dev.sh) ===
# 1. Cold .next clear: Turbopack's persistent cache (.sst/.meta inside .next)
#    gets corrupted whenever the sandbox recycles mid-write ("Failed to restore
#    task data ... .sst: No such file or directory" panic) — after that EVERY
#    later compile panics until the cache is wiped. A cold clear per boot keeps
#    chunk consistency at the cost of one cold compile.
rm -rf "$PROJECT_DIR/.next"
# 2. DB snapshot at boot + restore-from-newest-backup when the live DB is gone:
#    sandbox recycles have repeatedly wiped db/*.db, which silently re-seeded
#    the owner account with a fresh password (the "Owner kaj kore na" loop).
mkdir -p "$PROJECT_DIR/db/backups"
if [ -f "$PROJECT_DIR/db/custom.db" ]; then
        cp "$PROJECT_DIR/db/custom.db" "$PROJECT_DIR/db/backups/custom-$(date +%Y%m%d-%H%M%S).db" 2>/dev/null || true
        ls -1t "$PROJECT_DIR/db/backups"/custom-*.db 2>/dev/null | tail -n +8 | xargs -r rm -f
elif ls -1t "$PROJECT_DIR/db/backups"/custom-*.db >/dev/null 2>&1; then
        cp "$(ls -1t "$PROJECT_DIR/db/backups"/custom-*.db | head -n 1)" "$PROJECT_DIR/db/custom.db"
        echo "[dev.sh] DB was missing — restored from newest backup"
fi
# 3. Kill stale agent-service (bun --hot) instances too — recycles leave
#    duplicates that fight over :3001 and keep old code hot-reloaded.
for stale in $(pgrep -f "bun --hot index.ts" 2>/dev/null); do
        [ "$stale" = "$$" ] || kill -9 "$stale" >/dev/null 2>&1 || true
done
# === END PATCH ===

log_step_start "bun run db:push"
echo "[BUN] Setting up database..."
bun run db:push
log_step_end "bun run db:push"

log_step_start "Starting Next.js dev server"
echo "[BUN] Starting development server..."
bun run dev &
DEV_PID=$!
log_step_end "Starting Next.js dev server"

log_step_start "Waiting for Next.js dev server"
wait_for_service "localhost" "3000" "Next.js dev server"
log_step_end "Waiting for Next.js dev server"

log_step_start "Health check"
echo "[BUN] Performing health check..."
curl -fsS localhost:3000 >/dev/null
echo "[BUN] Health check passed"
log_step_end "Health check"

start_mini_services

echo "Next.js dev server is running in background (PID: $DEV_PID)."
echo "Use 'kill $DEV_PID' to stop it."
disown "$DEV_PID" 2>/dev/null || true
unset DEV_PID
