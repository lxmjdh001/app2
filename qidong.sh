#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADMIN_DIR="$ROOT_DIR/admin-console"
LOG_DIR="$ROOT_DIR/.runlogs"

mkdir -p "$LOG_DIR"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
fi

if [[ ! -f "$ADMIN_DIR/.env" ]]; then
  cp "$ADMIN_DIR/.env.example" "$ADMIN_DIR/.env"
fi

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  (cd "$ROOT_DIR" && npm install)
fi

if [[ ! -d "$ADMIN_DIR/node_modules" ]]; then
  (cd "$ADMIN_DIR" && npm install)
fi

API_LOG="$LOG_DIR/api.log"
WORKER_LOG="$LOG_DIR/worker.log"
WEB_LOG="$LOG_DIR/web.log"

: > "$API_LOG"
: > "$WORKER_LOG"
: > "$WEB_LOG"

(cd "$ROOT_DIR" && npm run start:api) >> "$API_LOG" 2>&1 &
API_PID=$!

(cd "$ROOT_DIR" && npm run start:worker) >> "$WORKER_LOG" 2>&1 &
WORKER_PID=$!

(cd "$ADMIN_DIR" && npm run dev -- --host 127.0.0.1 --port 5173) >> "$WEB_LOG" 2>&1 &
WEB_PID=$!

cleanup() {
  for pid in "$API_PID" "$WORKER_PID" "$WEB_PID"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
}

trap cleanup INT TERM EXIT

echo "启动完成"
echo "API:    http://127.0.0.1:8088"
echo "后台:   http://127.0.0.1:5173"
echo "日志:"
echo "  $API_LOG"
echo "  $WORKER_LOG"
echo "  $WEB_LOG"
echo "停止: Ctrl+C"

while true; do
  for proc in "API:$API_PID" "WORKER:$WORKER_PID" "WEB:$WEB_PID"; do
    name="${proc%%:*}"
    pid="${proc##*:}"
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "$name 进程已退出，正在停止其它进程。"
      exit 1
    fi
  done
  sleep 2
done
