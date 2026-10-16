# Courtside

**NBA player forecasts you can explore, question, and compare with real results.**

Courtside predicts a player's points, rebounds, assists, steals, and blocks for a
scheduled game. It combines an interactive dashboard, a Python API, and a CLI,
with support for live NBA data and offline experiments.

## Why this project?

A prediction is more useful when you understand its assumptions. Courtside lets
you change expected playing time, compare the model with simple baselines, and
check forecasts against actual outcomes. It brings the full workflow—from
historical data to evaluation—into one basketball analytics project.

## Features

- **Scouting Room:** explore six featured players, adjust their minutes, and
  reveal actual box scores in an interactive historical replay.
- **Player forecasts:** choose a matchup and player to see all five projected
  stats, approximate ranges, and baseline comparisons. Export results as JSON.
- **Minutes scenarios:** explore playing time from 0–48 minutes and see how it
  changes each projection.
- **Daily forecasts:** select players across matchups and compare projections.
  Batches run sequentially; failed players can be retried.
- **Model insights:** inspect validation results and run chronological backtests
  against blended-rate and last-ten-game baselines.
- **Forecast history:** save forecasts and compare them with completed results.
  The local app uses SQLite; the portfolio demo uses browser storage.
- **Offline experiments:** use bundled NBA replay data, synthetic fixtures, or
  your own CSV history. The dashboard supports mobile and light/dark themes.

## How it works

1. Load earlier game logs and estimate minutes from the player's last ten
   appearances, or use your own minutes estimate.
2. For points, rebounds, and assists, blend historical and current-season
   per-minute rates. Apply a player-specific Ridge correction only when it
   improves chronological validation error. Short histories use a baseline.
3. Estimate steals and blocks with a recency-weighted per-minute model.
4. Backtest using earlier games only, or save a forecast and compare it with the
   final box score. Evaluation reports MAE, RMSE, and range coverage.

Forecasts assume the player plays. Injuries and starting lineups are not modeled;
minutes scenarios hold per-minute rates fixed. Output ranges are heuristic,
not calibrated confidence intervals. Confirmed DNPs are excluded from accuracy
scoring. Historical results do not guarantee future accuracy.

## Technologies

| Area | Tools |
| --- | --- |
| Frontend | React, TypeScript, Vite, Lucide icons |
| Backend | Python 3.14, FastAPI, Uvicorn, Pydantic Settings |
| Modeling and data | scikit-learn Ridge regression, `nba_api`, CSV |
| Storage | SQLite, JSON caches, browser local storage |
| Research | JupyterLab, pandas, Matplotlib |
| Development | uv, Ruff, Pyrefly, pytest, Vitest, Playwright, Docker |

## Getting started

Run commands from the repository root unless noted otherwise.

### Portfolio demo

Requires **Node.js 22.12+ and npm**. For the quickest start:

```bash
./start.sh --replay-only
```

The launcher installs dependencies, builds the frontend, and prints a local URL
(normally **http://localhost:4173/**). Press **Ctrl+C** to stop.

Replay works without an API after setup. It uses [real NBA history](examples/replay)
for six players across three matchups on March 8, 2025. Forecasts were rebuilt
retrospectively using earlier games; they were not archived before tipoff.
Replay backtests cover the last 80 eligible appearances.

To also enable **Live NBA**, install and start Docker, ensure `curl` is available,
then run:

```bash
./start.sh
```

This starts the frontend and a Docker API capped at 1 GB RAM with no swap. NBA
endpoints can be delayed or unavailable. Public live mode disables live backtests
and result refresh; replay includes prepared backtests and results.

### Local development

Requires **Python 3.14, uv, Node.js 22.12+, and npm**.

```bash
uv sync --frozen
cd frontend
npm ci
npm run build
cd ..
STUB_MODE=1 uv run uvicorn bpps.api:app --reload
```

Open **http://127.0.0.1:8000/ui/** for the dashboard or
**http://127.0.0.1:8000/docs** for the interactive API reference.
`STUB_MODE=1` uses local synthetic data; use `STUB_MODE=0` for real NBA data.
No NBA API key is required. Optional root `.env` settings are listed in
[.env.example](.env.example).

For frontend hot reload, keep the API running and run `npm run dev` from
`frontend/`. Open **http://127.0.0.1:5173/ui/**; Vite proxies requests to port 8000.

## Command-line usage

The CLI supports schedules, rosters, forecasts, training, backtesting, CSV export,
and forecast history. Start with `uv run bpps --help` or a command's `--help`.

Try the bundled **synthetic** history and schedule:

```bash
uv run bpps predict --csv examples/history.csv \
  --schedule examples/schedule.json --game-id demo-game \
  --player-id demo-player --team LAL --minutes 32
uv run bpps backtest --csv examples/history.csv --player-id demo-player
```

For live predictions, omit `--csv` and `--schedule`, and use real game/player IDs.
Use `bpps games` and `bpps players` to find them. Full-career backtests can be slow.

## Research notebook

The [baseline notebook](notebooks/player_baseline.ipynb) compares per-minute
blends for points, rebounds, and assists using chronological tuning and holdout
periods. Install the optional research tools to explore it:

```bash
uv sync --group research
uv run --group research jupyter lab notebooks/player_baseline.ipynb
```

[scripts/run_baseline_notebook.py](scripts/run_baseline_notebook.py) also runs the
notebook with NBA, CSV, or synthetic data and exports metrics and plots.

## Checks

Run tasks sequentially, especially on an 8 GB machine:

```bash
uv run pyrefly check
uv run ruff check src tests
uv run ruff format --check src tests
uv run pytest -q
```

From `frontend/`:

```bash
npm run check
npm test
npm run build
npx playwright install --with-deps --only-shell chromium
npm run test:e2e
```

The API browser suite uses synthetic data. For the offline replay suite, build
and test from `frontend/` with:

```bash
VITE_PORTFOLIO_DEMO=1 VITE_BASE_PATH=/ VITE_API_BASE_URL=https://unavailable.example npm run build
npm run test:e2e -- --config portfolio.playwright.config.ts
```

For complete verification under a **2 GB RAM limit with no swap**, stop other
project workloads and run:

```bash
docker build -f Dockerfile.verify -t courtside-verify .
docker run --rm --memory=2g --memory-swap=2g --cpus=2 --shm-size=256m courtside-verify
```

This covers checks, tests, both frontend builds, desktop/mobile browser suites,
replay generation, the full-career CLI backtest, and the research notebook. It
uses one test worker and one BLAS thread and reports peak memory. On Docker
Desktop, allocate about 3 GB to Docker on an 8 GB workstation.

## Deployment

The project includes a [Docker API image](Dockerfile) and a
[Render configuration](render.yaml). For Cloudflare Pages, use `frontend` as the
root, `npm ci && npm run build` as the build command, and `dist` as the output.
Set `VITE_PORTFOLIO_DEMO=1`, `VITE_BASE_PATH=/`, and `VITE_API_BASE_URL` to the API
URL. Set the API's `CORS_ORIGINS` to a JSON array containing the frontend origin.
See [frontend/.env.example](frontend/.env.example) for frontend settings.
