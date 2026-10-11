# Project checks

At the end of every code or configuration change, run all of these checks and fix any errors before reporting completion:

```bash
uv run pyrefly check
uv run ruff check src tests
uv run ruff format --check src tests
```

Run relevant tests when behavior changes. Do not skip or suppress type or lint errors to make these checks pass.

# Resource budget

Target a workstation with 8 GB total RAM. Keep builds, training, and test suites
sequential, with one Vitest/Playwright worker and one BLAS thread by default.
For resource-sensitive changes, run the Dockerfile.verify workflow with a 2 GB
memory limit and no swap allowance, as documented in README.md. Keep that
workflow covering the supported application, CLI, and research notebook tools.
