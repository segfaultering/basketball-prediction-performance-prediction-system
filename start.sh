#!/usr/bin/env bash
# Start the portfolio UI and optional live API on an 8 GB workstation.
set -euo pipefail

replay_only=0
case "${1:-}" in
    "") ;;
    --replay-only) replay_only=1 ;;
    -h|--help)
        echo "Usage: ./start.sh [--replay-only]"
        echo "Starts the frontend and a 1 GB Docker API for Live NBA."
        echo "Uses ports 4173/8000, or the next free ports if occupied."
        echo "Use --replay-only to run the historical demo without Docker."
        exit 0
        ;;
    *) echo "Unknown option: $1. Run ./start.sh --help." >&2; exit 1 ;;
esac
if (( $# > 1 )); then
    echo "Usage: ./start.sh [--replay-only]" >&2
    exit 1
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
for command in node npm; do
    command -v "$command" >/dev/null || { echo "Install $command before starting." >&2; exit 1; }
done
if (( ! replay_only )); then
    for command in docker curl; do
        command -v "$command" >/dev/null || { echo "Install $command, or use --replay-only." >&2; exit 1; }
    done
    docker info >/dev/null || { echo "Start Docker, or use ./start.sh --replay-only." >&2; exit 1; }
fi

# Probe ports without interfering with an existing application.
free_port() {
    node --input-type=module - "$1" <<'JS'
import net from "node:net";
const first = Number(process.argv[2]);
function probe(port) {
    const server = net.createServer();
    server.once("error", (error) => {
        if (error.code === "EADDRINUSE" && port < first + 10) {
            probe(port + 1);
        } else {
            console.error(`Cannot use port ${port}: ${error.message}`);
            process.exitCode = 1;
        }
    });
    server.listen(port, "127.0.0.1", () => {
        server.close(() => console.log(port));
    });
}
probe(first);
JS
}
ui_port=$(free_port 4173)
api_port=8000
if (( ! replay_only )); then
    api_port=$(free_port 8000)
fi

container="courtside-local-$$"
api_started=0
preview_pid=""
cleanup() {
    if [[ -n "$preview_pid" ]]; then
        kill "$preview_pid" 2>/dev/null || true
        wait "$preview_pid" 2>/dev/null || true
    fi
    if (( api_started )); then
        docker rm --force "$container" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

export NODE_OPTIONS=--max-old-space-size=1024
echo "Installing and building the frontend (builds run sequentially)..."
(
    cd frontend
    npm ci
    VITE_PORTFOLIO_DEMO=1 VITE_BASE_PATH=/ VITE_API_BASE_URL="http://127.0.0.1:$api_port" npm run build
)

if (( ! replay_only )); then
    echo "Building the API image (Docker reuses cached layers)..."
    docker build -t courtside-api:local .
    echo "Starting the API with a 1 GB RAM limit and no swap..."
    api_started=1
    docker run --detach --rm --name "$container" \
        --memory=1g --memory-swap=1g --cpus=2 \
        -p "127.0.0.1:$api_port:8000" \
        -e "CORS_ORIGINS=[\"http://localhost:$ui_port\",\"http://127.0.0.1:$ui_port\"]" \
        courtside-api:local >/dev/null
    ready=0
    for (( attempt=0; attempt<30; attempt++ )); do
        if curl --fail --silent --max-time 2 "http://127.0.0.1:$api_port/ready" >/dev/null; then
            ready=1
            break
        fi
        if [[ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || true)" != true ]]; then
            break
        fi
        sleep 1
    done
    if (( ! ready )); then
        echo "API failed to become ready. Docker logs:" >&2
        docker logs "$container" >&2 || true
        exit 1
    fi
fi

echo "Open http://localhost:$ui_port/ — press Ctrl+C to stop."
if (( replay_only )); then
    echo "NBA replay is available. Live NBA requires the Docker API."
else
    echo "NBA replay and Live NBA are available. API: http://127.0.0.1:$api_port"
fi
node frontend/node_modules/vite/bin/vite.js preview frontend \
    --base / --host 127.0.0.1 --port "$ui_port" --strictPort &
preview_pid=$!
wait "$preview_pid"
