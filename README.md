# Basketball Performance Prediction System

Predict an NBA player's **points, rebounds, assists, steals, and blocks** for a selected scheduled game. This Python command-line application supports NBA schedule/roster/history retrieval, local CSV history, JSON predictions with approximate ranges, and chronological backtesting against a last-ten-games mean baseline.

## Run

Requires Python 3.14 and uv. FastAPI and Uvicorn power the HTTP server; `nba_api` retrieves live NBA data.

```bash
uv sync
uv run bpps --help
```

## Portfolio demo

The hosted portfolio build opens an **NBA replay** of March 8, 2025. It includes
six featured players across DET–GSW, IND–ATL, and ORL–MIL. The replay uses real
NBA game logs, not synthetic fixtures. Its date is the NBA boxscore game date;
it is not a claim that all three games tipped off on that UTC date.

The browser loads a bundled snapshot, so predictions, whole-minute scenarios
from 0–48, the daily board, prepared backtests, and outcome comparisons work
without a running API. Models and features use only games before the replay
date. These predictions were rebuilt retrospectively: they are **not forecasts
archived before tipoff**, and their comparison with actual results is not a
prospective accuracy claim. Backtests are explicitly scoped to the last 80
positive-minute appearances before the replay, rather than the full career.
The player lists are curated selections, not complete historical rosters.

Use **Live NBA** to fetch upcoming games and generate current forecasts through
the Python API. Failures stay in live mode with a retry message; the application
never silently substitutes replay or synthetic predictions. Switch back to
**NBA replay** whenever the API is unavailable or there are no upcoming games.
The replay snapshot never refreshes itself from live NBA endpoints.

Portfolio history belongs to the visitor's browser, with separate replay and
live records and a maximum of 100 scenarios per mode. Replay **Refresh results**
attaches bundled actual outcomes. Live outcome refresh is deferred; live records
stay pending. Clearing browser storage removes history. When storage is blocked,
records survive only in memory for that session. The normal local application
still uses its existing SQLite forecast archive.

The source CSV and provenance manifest are in [examples/replay](examples/replay).
The manifest records NBA player source links, upstream response hashes, season
identities, retrieval timestamps, and the source CSV checksum. Rebuild the
prepared snapshot offline using the production prediction engine:

```bash
uv run python -m bpps.replay
```

This intentionally performs training and evaluation before deployment. The
generated [snapshot](frontend/public/replay/snapshot.json) is committed so frontend
builds need neither Python training nor NBA access. To update the replay, replace
the CSV and its manifest, rebuild the snapshot, and update the replay date and
description in the frontend. Keep the chronological tests passing.

Preview the standalone portfolio build locally:

```bash
cd frontend
npm ci
VITE_PORTFOLIO_DEMO=1 VITE_BASE_PATH=/ VITE_API_BASE_URL=http://127.0.0.1:8000 npm run build
npm run preview -- --base /
```

For live mode during this preview, start the API from the repository root:

```bash
PUBLIC_DEMO=1 STUB_MODE=0 DEBUG=0 CORS_ORIGINS='["http://localhost:4173","http://127.0.0.1:4173"]' uv run uvicorn bpps.api:app
```

The public configuration allows one active prediction and ten prediction
attempts per minute across the single API process. It rejects additional work
with retryable 503/429 responses. Shared forecast history, live backtests, and
Gemini research are disabled in this deployment; the prepared replay demonstrates
evaluation without public requests starting full-career backtests or paid
research. `PUBLIC_DEMO=1` refuses `DEBUG=1` and `STUB_MODE=1` at startup.

### Free-tier deployment

Use a static frontend on **Cloudflare Pages** and the Python backend on **Render**:

1. On Render, create a Blueprint from this repository using [render.yaml](render.yaml).
   It builds [Dockerfile](Dockerfile), runs as a non-root user with one worker,
   and checks `/ready`. Enter `CORS_ORIGINS` as a JSON array containing your exact
   Pages origin, for example `["https://courtside.pages.dev"]`.
2. On Cloudflare Pages, set the root directory to `frontend`, the build command
   to `npm ci && npm run build`, and the output directory to `dist`. Set
   `VITE_PORTFOLIO_DEMO=1`, `VITE_BASE_PATH=/`, and
   `VITE_API_BASE_URL=https://YOUR-API.onrender.com` before building. These values
   are public configuration, not secrets; never put a Gemini key in a `VITE_*`
   variable. See [frontend/.env.example](frontend/.env.example).
3. If the generated Pages origin differs, update Render's CORS allowlist. It
   accepts explicit HTTPS origins or local development origins, without trailing
   slashes. Replay remains available even with an incorrect/unavailable API URL.
4. Smoke-test the replay prediction, minute override, daily board, backtest,
   history refresh, and live-mode failure/recovery on desktop and mobile.

Render's free API can sleep after inactivity and lose local files on restart.
The static replay does not wake it or rely on its SQLite database or cache.
Live mode explains startup delays and uses a 90-second browser request deadline.
Model/response caches are disposable; there is no paid database or background
worker in this setup. See [Render's free-service limits](https://render.com/docs/free)
and [Cloudflare Pages deployment documentation](https://developers.cloudflare.com/pages/).

GitHub Actions runs the Python suite and required checks, frontend checks/tests,
the existing synthetic API browser tests, a separate API-independent portfolio
browser suite, and a container build/readiness smoke test. Browser dependencies
are installed in CI. To run the portfolio browser suite locally, build the
portfolio with `VITE_API_BASE_URL=https://unavailable.example`, then run:

```bash
cd frontend
npx playwright install --with-deps chromium
npx playwright test --config portfolio.playwright.config.ts
```

These files prepare deployment; they do not provision hosting accounts or
publish a site automatically.

### Offline example

The example history and schedule are **synthetic**, not actual NBA results or fixtures. They demonstrate the full workflow without network access:

```bash
uv run bpps games --date 2026-10-20 --schedule examples/schedule.json
uv run bpps predict --csv examples/history.csv --schedule examples/schedule.json --game-id demo-game --player-id demo-player --team LAL
uv run bpps backtest --csv examples/history.csv --player-id demo-player
```

### Real NBA data

1. List upcoming games with `uv run bpps games --date YYYY-MM-DD`. Dates are UTC. Copy the game ID, team ID, and team tricode from the result.
2. Find the player with `uv run bpps players --team-id TEAM_ID --season 2025-26` (use the appropriate season).
3. Run `uv run bpps predict --game-id GAME_ID --player-id PLAYER_ID --team LAL`. Career history is retrieved automatically, and a player-specific baseline and correction model are trained or reused. Add `--minutes 32` to supply your own minutes expectation.
4. Train ahead of a prediction with `uv run bpps train --player-id PLAYER_ID`. This prints blend parameters, chronological evaluation metrics, and whether each correction is enabled.
5. Evaluate history with `uv run bpps backtest --player-id PLAYER_ID`. Full-career backtests refit models at each eligible game and can be slow; use `--csv` with a smaller historical dataset for a focused evaluation.

CSV is an optional history override for `predict`, `train`, and `backtest`. `bpps sync` remains available to export a single season. `--season-type` accepts `Regular Season`, `Playoffs`, or `Pre Season`.

Live mode checks that the game is scheduled, the team participates, and the player is on the team's roster. Roster membership does not guarantee availability or minutes. NBA JSON responses are cached under `.cache/bpps`. Schedule, roster, and current-season history have a one-hour lifetime. Career retrieval caches completed seasons for a year and player metadata for a day. Global `--refresh` bypasses the NBA cache and explicitly rebuilds models for `train`, e.g. `uv run bpps --refresh train --player-id PLAYER_ID`.

Live data is retrieved with the [`nba_api` Python package](https://github.com/swar/nba_api): `ScheduleLeagueV2` for schedules, `CommonTeamRoster` for rosters, `CommonPlayerInfo` for the career starting season, and `PlayerGameLog` for history. The package handles NBA headers and endpoint-specific parsing. No API key is required. The schedule defaults to the current season (July-to-June naming); games are filtered by UTC date. An incomplete career download fails explicitly rather than training on an undisclosed partial history.

NBA endpoints can block or time out because `nba_api` uses NBA's servers. Failures produce a clear error rather than synthetic fallback data. Corrupt cached responses are refetched. `STUB_MODE=1` uses local synthetic data and never calls the package's HTTP layer. Stub model artifacts are isolated from live artifacts.

### Your own data

CSV columns (dates ISO 8601, stats nonnegative, home `true`/`false` or `1`/`0`):

```text
player_id,game_id,date,team,opponent,home,minutes,points,rebounds,assists,steals,blocks
```

The `blocks` column is required. Re-download older CSV histories with `bpps sync` to include it. Player and game IDs are strings. Team and opponent should use consistent uppercase NBA tricodes. Duplicate player/game rows are rejected. Zero-minute appearances are excluded; predictions are conditional on playing.

A local schedule is a JSON array:

```json
[{"game_id":"my-game","date":"2026-10-20","status":1,"home_team":"LAL","away_team":"BOS"}]
```

Status `1` means scheduled. Local schedule mode trusts your supplied player/team membership and reports `roster_verified: false`.

## Model and evaluation

For **points, rebounds, and assists**, the production baseline blends prior-season and current-season per-minute rates, then multiplies by expected minutes. Historical windows and weight candidates are shared with the research notebook. Expected minutes are the mean of the last ten positive-minute appearances, capped at 48, with an optional 0–48 minute override. Each prediction needs at least five earlier positive-minute appearances; same-day and future games are excluded.

Each player has three separate **Ridge correction models**. Inputs include historical, season, and recent per-minute production, recent minutes, home/away status, and rest days. The target is actual per-minute production minus the baseline rate. Training weights examples by playing time. Scaling is fitted on training data only. Actual target-game minutes are used for training labels/weights and evaluation outcomes, never pregame input features.

At least 50 distinct target dates after the five-game warm-up are needed to train. Dates are divided chronologically into approximately 70% training, 15% tuning, and 15% validation, with minimums of 30/10/10 dates. Blend parameters are selected on the training partition. Ridge regularization (`alpha` of 1, 10, or 100) is chosen on tuning games. After refitting on training and tuning, each correction is enabled only if it reduces MAE against the blended baseline on validation games. It is then refitted on all available earlier games with the selected parameters frozen. Validation metrics describe the earlier evaluation fit, not the final fit's training error.

Short histories use a previous-three-season baseline with adaptive season weight `season_minutes / (season_minutes + 600)`; if only one rate component exists, it is used alone. These fallback settings are heuristics. Trained blend weights are player-specific, not universal Curry weights. **Steals and blocks** retain the original recency-weighted per-minute estimator and its small venue/opponent adjustments, using the same expected minutes.

Models are saved as validated JSON under `PROJ_DIR/.cache/bpps/models`. Reuse requires matching player, data fingerprint, source mode, season type, backend, feature schema, and training version. New positive-minute history or corrected data rebuilds the model. Historical cutoffs cannot reuse future-trained artifacts. Corrupt/incompatible artifacts are rebuilt; writes are atomic. No pickle deserialization is used. The response includes the baseline, model correction, selection metrics, and cache status; the frontend shows baseline and final prediction side by side.

The `CorrectionBackend`/`CorrectionModel` protocols in `bpps.learning` separate fitting, inference, and JSON serialization from history, baseline arithmetic, caching, and evaluation. Add a factory in `create_backend` to support another backend. `MODEL_BACKEND=ridge` is the default; CLI `--backend` overrides it. Unknown backends fail explicitly.

Output ranges use a normal approximation with validation residual variance (historical baseline residuals for short histories) and a count-variance floor. They are heuristic, **not calibrated confidence intervals**. Injury status, starting lineups, trades, explicit role changes, pace, and current opponent defense are not modeled. An old-history warning appears after a 30-day gap. Validation results are per-player model-selection evidence, not a general accuracy claim or an untouched final test.

Backtesting uses expanding historical windows, retraining and selecting only on earlier dates, and reports MAE, RMSE, blended-baseline MAE, last-ten-games mean MAE, and empirical range coverage. It requires at least one target game with five earlier positive-minute appearances. Historical evaluation does not save a model for every cutoff. Keep a separate later season as a final holdout for further model development.

## Checks

```bash
uv run pytest -q
uv run pyrefly check
uv run ruff check src tests
uv run ruff format --check src tests
```

## Baseline research notebook

[`notebooks/player_baseline.ipynb`](notebooks/player_baseline.ipynb) compares
historical/season per-minute blends for **points, rebounds, and assists**. It
defaults to Stephen Curry (`201939`), fetching regular-season history from
`2009-10` through `2025-26`. Full prior-career and previous-three-season rates
compete with fixed and adaptive season weights. Weights are selected separately
for each stat on `2023-24` and `2024-25`; `2025-26` is evaluated afterward without
retuning. Every prediction uses only earlier dates and estimated minutes.

Install the optional research tools and open JupyterLab:

```bash
uv sync --group research
uv run --group research jupyter lab notebooks/player_baseline.ipynb
```

Run the entire notebook from a fresh kernel without editing its default parameters:

```bash
# Offline workflow verification, explicitly synthetic:
uv run --group research python scripts/run_baseline_notebook.py --source synthetic

# Real NBA experiment (no synthetic fallback):
uv run --group research python scripts/run_baseline_notebook.py --source nba
```

Executed copies are saved under `.cache/bpps/research/`. Each experiment also
saves selected parameters, dataset identity, metrics, per-game holdout predictions,
and four standalone plots. Complete NBA history snapshots are retained there;
`--refresh` downloads again. Retrieval failures stop the experiment and preserve
the notebook error output. Synthetic results do not establish NBA accuracy.

The runner supports `--source csv --csv history.csv`, `--player-id`,
`--first-season`, `--last-season`, `--tuning-seasons`, `--holdout-season`, and
`--output`. Notebook parameters expose the same controls. For another player,
set the first career season appropriately; CSV career comparisons require
complete historical data. Requested-season counts are shown before evaluation.
These explicit research sources are independent of application `STUB_MODE`.

The experiment reports MAE, RMSE, and minutes-estimation error against the existing
application model and last-ten-game average on identical eligible games. It
reports both improvements and losses. Predictions remain conditional on playing;
the proposed blends do not add opponent adjustments or change the CLI, API, or
frontend by itself. Its blend formulas are shared through `bpps.baseline`, and
research orchestration lives in `bpps.baseline_research`. If you adjust
the formula after inspecting holdout results, reserve a new untouched period for
final evaluation.

Research checks additionally include:

```bash
uv run --group research ruff check scripts notebooks
uv run --group research ruff format --check scripts notebooks
```

## FastAPI server

Install and start the API with synthetic local data:

```bash
uv sync
STUB_MODE=1 uv run uvicorn bpps.api:app --reload
```

Open http://127.0.0.1:8000/docs for interactive endpoint documentation, or http://127.0.0.1:8000/openapi.json for the OpenAPI schema.

`STUB_MODE=1` enables synthetic local data; `STUB_MODE=0` selects real NBA data. If absent from both the environment and `.env`, it defaults to `0`. Only `0` and `1` are accepted. Invalid values fail startup. The server reads this setting at application creation; restart to change modes. CLI commands also honor it. `pydantic-settings` automatically loads the project-root `.env` for both the API and CLI. Shell environment variables override `.env` values. `.env.example` is a template, not loaded at runtime. Existing `.env` contents are preserved.

Stub mode uses an entirely local provider with no NBA requests or NBA cache reads. It provides today's UTC `demo-game` (LAL versus BOS), players `demo-player` and `demo-celtics-player`, and deterministic synthetic histories. Automatic career mode supplies five synthetic seasons and exercises training and persistence. Responses include `stub_mode`; synthetic predictions contain an explicit warning. The stub schedule date advances daily.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/health` | Service status and active mode; no upstream call |
| GET | `/games?date=YYYY-MM-DD` | Scheduled games for a UTC date (defaults to today) |
| GET | `/teams/{team_id}/players?season=2026-27` | Team roster |
| POST | `/predictions` | Predict all five stats, validating game and roster membership |
| POST | `/backtests` | Chronological evaluation of the requested player's history |

Try a stub prediction (adjust seasons as appropriate):

```bash
curl -X POST http://127.0.0.1:8000/predictions \
  -H 'Content-Type: application/json' \
  -d '{"game_id":"demo-game","player_id":"demo-player","minutes":32}'
```

For `/backtests`, send `player_id` without `game_id` or `minutes`. Both requests accept optional `season_type` (`Regular Season`, `Playoffs`, or `Pre Season`). Omit `seasons` for automatic career history, or supply one to five season strings as an explicit override; duplicates are fetched once. The API downloads history itself, so no local CSV path is needed. Prediction requests infer the team from the selected game's rosters. Existing requests with `seasons` remain supported.

Errors return JSON `detail`: `404` for a missing game/history, `409` for a game already started, `422` for invalid inputs, roster mismatch, or insufficient history, and `502` when NBA data retrieval fails. To use live mode, start with `STUB_MODE=0 uv run uvicorn bpps.api:app --reload`.

### Environment configuration

The shared `Settings` model loads `.env` using UTF-8 from the source project root, regardless of the current working directory. Configure:

- `STUB_MODE=1` for local synthetic data, or `0` for live NBA data.
- `DEBUG=1` for FastAPI debug mode, or `0` to disable it.
- `PROJ_DIR=/absolute/path/to/project` for the base directory of the NBA response cache (`PROJ_DIR/.cache/bpps`). The default is the source project root. CLI `--cache-dir` overrides this cache location. `PROJ_DIR` does not relocate the `.env` file.
- `MODEL_BACKEND=ridge` for the correction backend. Models are stored beneath the same base cache directory.

`STUB_MODE` and `DEBUG` accept only `0` or `1` and default to `0`. Unknown dotenv keys are ignored. Restart the API after changing settings. `.env` is ignored by Git; `.env.example` remains the shared template.

With your `.env` configured, start using:

```bash
uv run uvicorn bpps.api:app --reload
```

## Forecast tracking

API predictions and CLI predictions using automatic NBA or stub history are saved
automatically. Each immutable snapshot includes a UTC creation time, requested
inputs, player/game identity, prediction ranges, baseline, and model identity.
The response adds `forecast_id` and `saved_at`. Predictions are checked before
and after training against the scheduled tipoff, so training that crosses tipoff
does not produce an archived forecast. Historical backtests and CLI CSV/local
schedule experiments are not archived.

Open **Forecast history** in the dashboard to review saved forecasts. Select
**Refresh results** after games finish to retrieve outcomes and compare forecast,
baseline, actual statistics, and signed errors. Refresh only attaches game logs
for games marked final; it bypasses live response caches, matches NBA game IDs,
and fetches the saved game's season. It tries the requested history season type
first, then other NBA season types when needed, so forecasts using regular-season
history can still be matched to playoff outcomes. Missing player
game logs remain pending, since absence does not establish that a player did not
play. Confirmed zero-minute logs are labeled did not play and excluded from
accuracy metrics. Repeat refreshes can pick up corrected NBA results without
changing forecast snapshots. Partial upstream failures are reported individually
while other records can still update.

Accuracy summaries report MAE, RMSE, baseline MAE, and empirical range coverage
across the **first saved forecast per player/game**. Additional predictions and
minutes scenarios remain visible but do not increase the evaluation sample.
These are forecasts made before games, separate from historical backtesting;
small samples and synthetic results do not establish NBA accuracy.

Records live in `PROJ_DIR/data/bpps/forecasts.sqlite3`, separate from disposable
`.cache/bpps` artifacts. The database is created on first use; back up this file
to preserve history. Live and synthetic records are isolated by source, and
switching modes shows only that mode's history. Existing predictions are not
retroactively imported. Stub fixtures do not provide completed demo-game results,
so ordinary stub forecasts remain pending. Result refresh is manual; there is no
background polling or user-account separation in this local application.

```bash
uv run bpps forecasts
uv run bpps forecasts --refresh-results
uv run bpps forecasts --limit 20 --offset 20
```

The API exposes `GET /forecasts?limit=50&offset=0` (limit 1–100) and
`POST /forecasts/refresh` (no body required). History responses include a paginated
`forecasts` list, `total`, and a `summary` over all records for the active source.
Refresh responses include `updated_forecasts` and per-player retrieval `errors`.
Forecast storage failures return HTTP 503 rather than reporting an unsaved
prediction as successfully tracked.

## React frontend

Courtside is a React + TypeScript dashboard served by FastAPI at **http://127.0.0.1:8000/ui/**. Install Node.js 22.12+ (or 20.19+) and build the interface once:

```bash
cd frontend
npm ci
npm run build
cd ..
uv run uvicorn bpps.api:app --reload
```

Opening `/` redirects to `/ui/`; API documentation remains at `/docs`. Rebuild after frontend changes. The API remains usable before building; `/ui/` shows build instructions until you build and restart the server.

Choose a UTC date and matchup, search either roster, select a player, and generate a forecast. Expected minutes default to recent playing time; enable the minute control to override them. History defaults to the full career, with optional season overrides. Points, rebounds, and assists show their baseline alongside the final projection. Model insights explain which corrections passed validation and offer a chronological backtest. Download the full prediction as JSON for further analysis.

Open **Daily forecasts** from navigation to select players across the day's
scheduled matchups. Generate selected forecasts to compare expected minutes and
all five statistics with approximate ranges. Search and team filters apply to
both player selection and the result table; forecasts can be sorted by player or
any projected statistic. Generation uses full career history and recent expected
minutes, processes one player at a time, and saves successful predictions to
Forecast history. Failed players can be retried without regenerating successful
forecasts. **Stop after current player** finishes the active prediction before
ending the batch. The board's selections and results reset on a date change,
slate reload, or leaving the page; saved forecasts remain in history.

For an offline demo, run `STUB_MODE=1 uv run uvicorn bpps.api:app --reload` and choose today's UTC date. Synthetic data is labeled throughout. Live mode uses the existing `.env` settings. Changing a game, player, minutes, or history clears outdated results and cancels pending requests.

For frontend development, start the API on port 8000 and run `npm run dev` from `frontend/`. Open **http://127.0.0.1:5173/ui/**; Vite proxies requests to the API. Fonts are bundled locally; no external font requests are needed.

Use the hamburger button to open the sliding navigation drawer. Close it with
the close button, Escape, or a click outside; choosing a view also closes it.
The dashboard uses larger controls and concise labels, with explanations under details.

Use the sun/moon button in the header to switch between light and dark mode.
Your selection is remembered in the browser across reloads. Until you choose a
theme, the dashboard follows your system's color preference. Switching also
works when browser storage is unavailable, for the current session.

Frontend checks (from `frontend/`):

```bash
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser tests start a synthetic API on port 8012 and exercise the built interface at desktop and mobile sizes. Run them after building. Python checks remain `uv run pyrefly check`, `uv run ruff check src tests`, `uv run ruff format --check src tests`, and `uv run pytest`.

## Gemini player research

Select a player and click **Research player** to check recent availability,
injuries, rest, minutes restrictions, and team news alongside the forecast.
Research does not change the numerical prediction or run automatically.

In the project-root `.env`, set `GEMINI_API_KEY` to your Gemini API key and
`STUB_MODE=0`, then restart the API. Keep the key server-side; do not put it in
frontend variables or commit it. `GEMINI_MODEL` defaults to `gemini-3.1-flash-lite`;
use a model that supports Google Search grounding and structured output.
`RESEARCH_TIMEOUT_SECONDS` defaults to 60. Missing keys and quota/network errors
appear in the research panel without preventing predictions.

The LangGraph workflow resolves the player/game from the NBA roster, asks Gemini
to search recent public reports with Google Search grounding, summarizes only
cited passages, and validates citation IDs and report dates. Links and Google
Search suggestions accompany results. Suggestions render in a sandboxed frame;
web text is treated as evidence, not executable instructions.
No custom site scraper or second search API key is required.

The panel shows the latest **reported** status, its report date, and when research
was checked. Missing, conflicting, undated, or stale status evidence remains
unconfirmed; no report does not mean a player is available. Reports may change
before tipoff. Successful research is cached in memory for five minutes (up to
128 player/game contexts); research is not saved to forecast history.
A search plus structured summary can use two Gemini calls and search-grounding
quota. Clicking again within five minutes reuses the cached result.
`STUB_MODE=1` returns an explicitly synthetic unknown status and never calls Gemini,
even when a key is configured.

References: [Gemini search grounding](https://ai.google.dev/gemini-api/docs/google-search/),
[Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output),
[LangGraph](https://docs.langchain.com/oss/python/langgraph/graph-api).
