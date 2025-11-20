#!/bin/bash
# Unified launcher for I2PPTT services (backend / frontend / all), modeled after ppttt_service.sh
# Usage:
#   ./i2pptt_service.sh start {backend|frontend|all}
#   ./i2pptt_service.sh stop {backend|frontend|all}
#   ./i2pptt_service.sh restart {backend|frontend|all}
#   ./i2pptt_service.sh status
# Environment:
#   I2PPTT_ROOT_PATH, ROOT_PATH (fallback)
#   I2PPTT_WORKERS
#   I2PPTT_VITE_BASE_PATH, VITE_BASE_PATH (fallback)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_ACTIVATE="$ROOT_DIR/venv/bin/activate"
BACKEND_PORT=8001
FRONTEND_PORT=5174
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"
SETTINGS_FILE="$ROOT_DIR/web/settings.toml"

_load_config_from_file() {
  local config_file="$1"; local key="$2"
  if [[ ! -f "$config_file" ]]; then return 1; fi
  local python_script=$(cat <<'PY'
import sys
try:
    import tomllib
except Exception:
    try:
        import tomli as tomllib  # type: ignore
    except Exception:
        sys.exit(1)
try:
    config_file = sys.argv[1]; key = sys.argv[2]
    with open(config_file, 'rb') as f:
        config = tomllib.load(f)
    if 'server' in config and key in config['server']:
        val = config['server'][key]
        print(str(val or '').strip())
except Exception:
    sys.exit(1)
PY
)
  local py="python3"
  if [[ -f "$VENV_ACTIVATE" && -f "$ROOT_DIR/venv/bin/python3" ]]; then
    py="$ROOT_DIR/venv/bin/python3"
  fi
  local value=$("$py" -c "$python_script" "$config_file" "$key" 2>/dev/null || true)
  if [[ -n "$value" ]]; then echo "$value"; return 0; fi
  return 1
}

# root_path
if [[ -z "${I2PPTT_ROOT_PATH:-}" && -z "${ROOT_PATH:-}" ]]; then
  ROOT_PATH="$(_load_config_from_file "$SETTINGS_FILE" "root_path" 2>/dev/null || echo "")"
else
  ROOT_PATH="${I2PPTT_ROOT_PATH:-${ROOT_PATH:-}}"
fi

# workers
if [[ -z "${I2PPTT_WORKERS:-}" ]]; then
  BACKEND_WORKERS="$(_load_config_from_file "$SETTINGS_FILE" "workers" 2>/dev/null || echo "")"
else
  BACKEND_WORKERS="${I2PPTT_WORKERS}"
fi

# vite base
if [[ -z "${I2PPTT_VITE_BASE_PATH:-}" && -z "${VITE_BASE_PATH:-}" ]]; then
  CONFIG_VITE_BASE="$(_load_config_from_file "$SETTINGS_FILE" "vite_base_path" 2>/dev/null || echo "")"
  if [[ -n "$CONFIG_VITE_BASE" ]]; then
    export I2PPTT_VITE_BASE_PATH="$CONFIG_VITE_BASE"
    export VITE_BASE_PATH="$CONFIG_VITE_BASE"
  fi
fi

if [[ ! -f "$VENV_ACTIVATE" ]]; then
  echo "[ERROR] venv not found at $VENV_ACTIVATE" >&2
  echo "Create: python3 -m venv venv && source venv/bin/activate && pip install -r web/requirements.txt" >&2
  exit 1
fi

get_port_info() {
  local port=$1
  if lsof -Pi :"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    local pid=$(lsof -Pi :"$port" -sTCP:LISTEN -t | head -n1)
    local cmd=$(ps -p "$pid" -o command= 2>/dev/null || echo "unknown")
    echo "$pid|$cmd"; return 0
  fi; return 1
}

check_port() { local port=$1; lsof -Pi :"$port" -sTCP:LISTEN -t >/dev/null 2>&1 && return 1 || return 0; }

stop_port() {
  local port=$1; local name=$2
  local pids=$(lsof -Pi :"$port" -sTCP:LISTEN -t 2>/dev/null || true)
  if [[ -z "$pids" ]]; then echo "[INFO] $name not running on $port"; return 0; fi
  echo "[INFO] Stopping $name on $port..."
  for pid in $pids; do kill "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true; done
  sleep 1
  if lsof -Pi :"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "[ERROR] $name failed to stop" >&2; return 1
  fi
  echo "[INFO] $name stopped"
}

show_status() {
  echo "=== I2PPTT Status ==="
  echo "Backend: port $BACKEND_PORT"
  local b=$(get_port_info "$BACKEND_PORT" 2>/dev/null || echo "")
  if [[ -n "$b" ]]; then echo "  ✅ $(echo "$b" | cut -d'|' -f1)"; else echo "  ❌"; fi
  echo "Frontend: port $FRONTEND_PORT"
  local f=$(get_port_info "$FRONTEND_PORT" 2>/dev/null || echo "")
  if [[ -n "$f" ]]; then echo "  ✅ $(echo "$f" | cut -d'|' -f1)"; else echo "  ❌"; fi
}

start_backend() {
  if ! check_port "$BACKEND_PORT"; then
    echo "[ERROR] Backend port $BACKEND_PORT in use" >&2; exit 1; fi
  echo "[INFO] Starting backend (uvicorn) on $BACKEND_PORT"
  local args="--host 0.0.0.0 --port $BACKEND_PORT"
  # Note: uvicorn doesn't have direct body size limit option
  # File size limits are handled by FastAPI/Starlette middleware
  # For large files, consider using nginx as reverse proxy with client_max_body_size
  if [[ -n "${BACKEND_WORKERS:-}" && "$BACKEND_WORKERS" != "1" ]]; then
    args="$args --workers $BACKEND_WORKERS"
  else
    args="$args --reload"
  fi
  VENV_PY="$ROOT_DIR/venv/bin/python"
  
  # Calculate wait time based on worker count
  # More workers need more time to start
  local worker_count=1
  if [[ -n "${BACKEND_WORKERS:-}" && "$BACKEND_WORKERS" != "1" ]]; then
    worker_count="$BACKEND_WORKERS"
  fi
  # Base wait: 5 seconds, plus 2 seconds per worker
  local max_wait=$((5 + worker_count * 2))
  # Cap at 30 seconds
  if [[ $max_wait -gt 30 ]]; then
    max_wait=30
  fi
  
  # Don't clear log immediately - append to preserve history
  # Start backend in background
  ( cd "$ROOT_DIR"; export ROOT_PATH; nohup "$VENV_PY" -m uvicorn web.backend.main:app $args >> "$LOG_DIR/backend.log" 2>&1 & ) >/dev/null 2>&1 &
  
  # Wait and check multiple times
  local waited=0
  local port_listening=false
  local startup_complete=false
  
  while [[ $waited -lt $max_wait ]]; do
    sleep 1
    waited=$((waited + 1))
    
    # Check if port is listening
    if lsof -Pi :"$BACKEND_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
      port_listening=true
    fi
    
    # Check if "Application startup complete" appears in logs
    if [[ -f "$LOG_DIR/backend.log" ]]; then
      # Count how many times "Application startup complete" appears
      # Should match worker count (or at least 1 for single worker/reload mode)
      local complete_count=$(grep -c "Application startup complete" "$LOG_DIR/backend.log" 2>/dev/null || echo "0")
      if [[ $complete_count -ge 1 ]]; then
        startup_complete=true
        # For multi-worker mode, wait for all workers to start
        if [[ $worker_count -gt 1 && $complete_count -ge $worker_count ]]; then
          break
        elif [[ $worker_count -eq 1 ]]; then
          break
        fi
      fi
    fi
    
    # If port is listening, we can break early (service is up)
    if [[ "$port_listening" == "true" ]]; then
      # But wait a bit more for multi-worker to fully start
      if [[ $worker_count -eq 1 || $waited -ge $((max_wait / 2)) ]]; then
        break
      fi
    fi
  done
  
  # If port is listening OR startup is complete, consider it successful
  if [[ "$port_listening" == "true" || "$startup_complete" == "true" ]]; then
    echo "[INFO] Backend started successfully (waited ${waited}s), logs: $LOG_DIR/backend.log"
    return 0
  fi
  
  # If we get here, backend didn't start
  echo "[ERROR] Backend failed to start after ${max_wait}s, checking logs:" >&2
  if [[ -f "$LOG_DIR/backend.log" ]]; then
    echo "--- Last 30 lines of backend.log ---" >&2
    tail -30 "$LOG_DIR/backend.log" >&2
    echo "--- End of log ---" >&2
  else
    echo "[ERROR] Log file not found: $LOG_DIR/backend.log" >&2
  fi
  
  # Check if there's a Python import error or syntax error
  if grep -q "ModuleNotFoundError\|ImportError\|SyntaxError\|IndentationError" "$LOG_DIR/backend.log" 2>/dev/null; then
    echo "[ERROR] Python import/syntax error detected. Check dependencies:" >&2
    echo "  Run: source venv/bin/activate && pip install -r web/requirements.txt" >&2
  fi
  
  exit 1
}

start_frontend() {
  if ! check_port "$FRONTEND_PORT"; then
    echo "[WARN] Frontend port $FRONTEND_PORT in use, attempting cleanup..."; stop_port "$FRONTEND_PORT" "Frontend" || true; fi
  local vite_base="${I2PPTT_VITE_BASE_PATH:-${VITE_BASE_PATH:-${ROOT_PATH:-/}}}"
  echo "[INFO] Starting frontend on $FRONTEND_PORT (base $vite_base)"
  
  # Check if node_modules exists, if not, install dependencies
  if [[ ! -d "$ROOT_DIR/web/frontend/node_modules" ]]; then
    echo "[INFO] Installing frontend dependencies..."
    ( cd "$ROOT_DIR/web/frontend"; npm install )
  fi
  
  ( cd "$ROOT_DIR/web/frontend"; export I2PPTT_VITE_BASE_PATH="$vite_base" VITE_BASE_PATH="$vite_base"; nohup npm run dev -- --host --port "$FRONTEND_PORT" > "$LOG_DIR/frontend.log" 2>&1 & ) >/dev/null 2>&1 &
  sleep 3
  if lsof -Pi :"$FRONTEND_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "[INFO] Frontend started, logs: $LOG_DIR/frontend.log"
  else
    echo "[ERROR] Frontend failed, tail logs:" >&2; tail -20 "$LOG_DIR/frontend.log" 2>/dev/null || true; exit 1
  fi
}

start_all() { start_backend; start_frontend; }
stop_backend() { stop_port "$BACKEND_PORT" "Backend"; }
stop_frontend() { stop_port "$FRONTEND_PORT" "Frontend"; }
stop_all() { stop_backend; stop_frontend; }
restart_backend() { stop_backend; sleep 1; start_backend; }
restart_frontend() { stop_frontend; sleep 1; start_frontend; }
restart_all() { stop_all; sleep 2; start_all; }

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 {start|stop|restart|status} [backend|frontend|all]" >&2; exit 1; fi
CMD="$1"; SVC="${2:-all}"
case "$CMD" in
  start) case "$SVC" in backend) start_backend;; frontend) start_frontend;; all) start_all;; *) echo "Unknown service: $SVC" >&2; exit 1;; esac ;;
  stop) case "$SVC" in backend) stop_backend;; frontend) stop_frontend;; all) stop_all;; *) echo "Unknown service: $SVC" >&2; exit 1;; esac ;;
  restart) case "$SVC" in backend) restart_backend;; frontend) restart_frontend;; all) restart_all;; *) echo "Unknown service: $SVC" >&2; exit 1;; esac ;;
  status) show_status ;;
  *) echo "Unknown command: $CMD" >&2; exit 1 ;;
esac


