# Basketball Performance Prediction System

Predict an NBA player's **points, rebounds, assists, and steals** for a selected scheduled game. This Python command-line application supports NBA schedule/roster/history retrieval, local CSV history, JSON predictions with approximate ranges, and chronological backtesting against a last-ten-games mean baseline.

## Run

Requires Python 3.14 and uv. There are no runtime dependencies.

```bash
uv sync
uv run bpps --help
```

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
3. Download history with `uv run bpps sync --player-id PLAYER_ID --season 2025-26 --output history.csv`. `--season-type` accepts `Regular Season`, `Playoffs`, or `Pre Season`. For early-season predictions, previous-season history may be necessary. You can concatenate seasons into a single CSV with one header and no duplicate player/game rows.
4. Run `uv run bpps predict --csv history.csv --game-id GAME_ID --player-id PLAYER_ID --team LAL`. Add `--minutes 32` to supply your own minutes expectation.
5. Evaluate history with `uv run bpps backtest --csv history.csv --player-id PLAYER_ID`.

Live mode checks that the game is scheduled, the team participates, and the player is on the team's roster. Roster membership does not guarantee availability or minutes. NBA JSON responses are cached for one hour under `.cache/bpps`. Global `--refresh` bypasses the cache, e.g. `uv run bpps --refresh games --date YYYY-MM-DD`.

NBA endpoints may block or time out. The application reports a clear error rather than substituting fictional data. Live access has not been verified in this environment. The adapters follow [PlayerGameLog](https://github.com/swar/nba_api/blob/master/docs/nba_api/stats/endpoints/playergamelog.md) and [CommonTeamRoster](https://github.com/swar/nba_api/blob/master/docs/nba_api/stats/endpoints/commonteamroster.md) endpoint schemas. Schedule comes from NBA's `scheduleLeagueV2.json` feed.

### Your own data

CSV columns (dates ISO 8601, stats nonnegative, home `true`/`false` or `1`/`0`):

```text
player_id,game_id,date,team,opponent,home,minutes,points,rebounds,assists,steals
```

Player and game IDs are strings. Team and opponent should use consistent uppercase NBA tricodes. Duplicate player/game rows are rejected. Zero-minute appearances are excluded; predictions are conditional on playing.

A local schedule is a JSON array:

```json
[{"game_id":"my-game","date":"2026-10-20","status":1,"home_team":"LAL","away_team":"BOS"}]
```

Status `1` means scheduled. Local schedule mode trusts your supplied player/team membership and reports `roster_verified: false`.

## Model and evaluation

The model takes up to 60 positive-minute appearances strictly before the target date, with a recency half-life of ten appearances. It estimates minutes and per-minute production, then applies small, sample-size-shrunk home/away and opponent-history adjustments. A minimum of five historical appearances is required. It supports a 0–48 minute override. An old-history warning appears after a 30-day gap.

The output ranges use a normal approximation with historical residual variance and a count-variance floor. They are heuristic, **not calibrated confidence intervals**. Injury status, starting lineups, trades, role changes, rest, pace, and current opponent defense are not modeled. This is an interpretable initial baseline; predictive usefulness must be established on real held-out data.

Backtesting uses expanding historical windows, never the actual target-game minutes, and reports MAE, RMSE, last-ten-games mean MAE, and empirical range coverage for each stat. It requires six or more appearances on distinct dates. For model selection, keep a separate later season as a final holdout. No real-data accuracy claim is made.

## Checks

```bash
uv run pytest -q
uv run ruff check src tests
uv run ruff format --check src tests
```
