#!/bin/sh
# Run inside Dockerfile.verify; no host files or caches are modified.
set -eu
report_memory() {
    if [ -r /sys/fs/cgroup/memory.peak ]; then
        awk '{printf "Container peak memory so far: %.0f MiB\n", $1 / 1048576}' /sys/fs/cgroup/memory.peak
    fi
}
trap report_memory EXIT
uv run pyrefly check
uv run ruff check src tests
uv run ruff format --check src tests
uv run pytest -q
# Exercise real training, all minute scenarios, and chronological backtests.
uv run python -m bpps.replay --output /tmp/rebuilt-replay.json
# Exercise the longest bundled career, beyond the prepared 80-game replay window.
uv run bpps backtest --csv examples/replay/history.csv --player-id 201939 \
    > /tmp/career-backtest.json
uv run --group research python scripts/run_baseline_notebook.py \
    --source csv --csv examples/replay/history.csv \
    --tuning-seasons 2022 2023 --holdout-season 2024 \
    --output /tmp/player-baseline.ipynb
report_memory
cd frontend
npm run check
npm test
npm run build
npm run test:e2e
VITE_PORTFOLIO_DEMO=1 VITE_BASE_PATH=/ VITE_API_BASE_URL=https://unavailable.example npm run build
npm run test:e2e -- --config portfolio.playwright.config.ts
VITE_AUTH_ENABLED=1 VITE_SUPABASE_URL=https://auth-fixture.supabase.co \
    VITE_SUPABASE_PUBLISHABLE_KEY=fixture-public-key VITE_API_BASE_URL=/api \
    VITE_PORTFOLIO_DEMO=1 VITE_BASE_PATH=/ npm run build
npm run test:e2e -- --config auth.playwright.config.ts
report_memory
