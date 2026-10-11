# Real NBA replay inputs

`history.csv` contains 3,122 regular-season player game logs for the six featured
players, through March 8, 2025. It is derived from the existing local NBA
`PlayerGameLog` cache. Cache filenames were verified against the application's
endpoint/parameter hash before extracting each career season.

`manifest.json` records each source response's checksum and retrieval time,
player/season identities, links to NBA player boxscores, and the CSV checksum.
Source timestamps describe when the upstream snapshot was cached, not when a
forecast was made. The original endpoint responses contain more fields; this
CSV retains only the application's required inputs.

The target day's appearances are used only for matchup reconstruction and
outcome comparisons. Prediction fitting excludes the target day. Backtest
inputs also exclude it. Historical team membership is derived from these
appearances; the demo player lists are deliberately incomplete.

Run `uv run python -m bpps.replay` at the repository root to generate the frontend
snapshot using the current production engine. No network call occurs. Retraining
after changes to the engine can change results; the data checksum alone does not
assert that a different training version produces identical predictions.
