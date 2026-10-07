# Project checks

At the end of every code or configuration change, run all of these checks and fix any errors before reporting completion:

```bash
uv run pyrefly check
uv run ruff check src tests
uv run ruff format --check src tests
```

Run relevant tests when behavior changes. Do not skip or suppress type or lint errors to make these checks pass.
