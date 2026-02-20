#!/usr/bin/env bash
# Remote development helper script
#
# Usage:
#   ./scripts/remote-dev.sh start         Start Tilt on the server
#   ./scripts/remote-dev.sh stop          Stop Tilt
#   ./scripts/remote-dev.sh status        Show running services
#   ./scripts/remote-dev.sh tunnel HOST   SSH tunnel to a remote server
#   ./scripts/remote-dev.sh logs SERVICE  Tail logs for a service

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_SETUP_DIR="$(dirname "$SCRIPT_DIR")"

usage() {
    cat <<EOF
Usage: $(basename "$0") <command> [args]

Commands:
  start           Start Tilt (run on the server)
  stop            Stop Tilt and all services
  status          Show service health status
  tunnel HOST     Open SSH tunnel to remote server (run on your machine)
  logs SERVICE    Tail logs for a specific service

Examples:
  # On the server
  ./scripts/remote-dev.sh start
  ./scripts/remote-dev.sh logs pgr-services

  # On your machine
  ./scripts/remote-dev.sh tunnel dev-server
EOF
    exit 1
}

cmd_start() {
    cd "$LOCAL_SETUP_DIR"

    echo "Starting Tilt..."
    echo ""
    echo "Dashboard will be at: http://localhost:10350"
    echo "DIGIT UI will be at:  http://localhost:18000/digit-ui/"
    echo ""
    echo "From your machine, forward ports with:"
    echo "  ssh -L 10350:localhost:10350 -L 18000:localhost:18000 $(hostname)"
    echo ""

    exec tilt up "$@"
}

cmd_stop() {
    cd "$LOCAL_SETUP_DIR"
    tilt down
    echo "Tilt stopped. Docker containers are still running."
    echo "To stop containers too: docker compose down"
}

cmd_status() {
    cd "$LOCAL_SETUP_DIR"

    echo "=== Docker containers ==="
    docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "Docker compose not running"

    echo ""
    echo "=== Service health ==="
    if [ -x "$SCRIPT_DIR/health-check.sh" ]; then
        "$SCRIPT_DIR/health-check.sh"
    else
        for endpoint in \
            "http://localhost:18094/mdms-v2/health MDMS" \
            "http://localhost:18107/user/health User" \
            "http://localhost:18109/egov-workflow-v2/health Workflow" \
            "http://localhost:18088/egov-idgen/health IDGen" \
            "http://localhost:18083/pgr-services/health PGR"; do
            url=$(echo "$endpoint" | awk '{print $1}')
            name=$(echo "$endpoint" | awk '{print $2}')
            if curl -sf "$url" > /dev/null 2>&1; then
                echo "  $name: OK"
            else
                echo "  $name: DOWN"
            fi
        done
    fi
}

cmd_tunnel() {
    local host="${1:?Usage: remote-dev.sh tunnel <host>}"
    shift

    echo "Opening SSH tunnel to $host..."
    echo ""
    echo "Forwarding:"
    echo "  localhost:10350 → Tilt dashboard"
    echo "  localhost:18000 → Kong gateway (API + UI)"
    echo "  localhost:18080 → DIGIT UI (direct)"
    echo "  localhost:15432 → Postgres"
    echo ""
    echo "Open in browser:"
    echo "  Tilt:     http://localhost:10350"
    echo "  DIGIT UI: http://localhost:18000/digit-ui/"
    echo ""
    echo "Press Ctrl+C to close tunnel."

    exec ssh \
        -L 10350:localhost:10350 \
        -L 18000:localhost:18000 \
        -L 18080:localhost:18080 \
        -L 15432:localhost:15432 \
        -N "$host" "$@"
}

cmd_logs() {
    local service="${1:?Usage: remote-dev.sh logs <service>}"

    # Try Tilt first, fall back to docker compose
    if command -v tilt &>/dev/null && tilt get session &>/dev/null 2>&1; then
        exec tilt logs -f "$service"
    else
        cd "$LOCAL_SETUP_DIR"
        exec docker compose logs -f "$service"
    fi
}

# Main
case "${1:-}" in
    start)  shift; cmd_start "$@" ;;
    stop)   shift; cmd_stop "$@" ;;
    status) shift; cmd_status "$@" ;;
    tunnel) shift; cmd_tunnel "$@" ;;
    logs)   shift; cmd_logs "$@" ;;
    *)      usage ;;
esac
