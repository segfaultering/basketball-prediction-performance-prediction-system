FROM python:3.14-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12.19 /uv /uvx /usr/local/bin/
WORKDIR /app
ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy \
    UV_CONCURRENT_INSTALLS=1 UV_CONCURRENT_BUILDS=1
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,id=courtside-uv,target=/root/.cache/uv uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN --mount=type=cache,id=courtside-uv,target=/root/.cache/uv uv sync --frozen --no-dev --no-editable

FROM python:3.14-slim-bookworm
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PROJ_DIR=/tmp/bpps \
    PUBLIC_DEMO=1 \
    STUB_MODE=0 \
    DEBUG=0 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1
RUN useradd --system --uid 10001 app
USER app
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn bpps.api:app --host 0.0.0.0 --port \"${PORT:-8000}\" --workers 1"]
