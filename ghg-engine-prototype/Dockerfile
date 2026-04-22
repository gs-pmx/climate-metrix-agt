FROM node:20-bookworm-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

FROM ghcr.io/astral-sh/uv:python3.11-bookworm-slim AS python-build

WORKDIR /app
ENV UV_LINK_MODE=copy
COPY pyproject.toml uv.lock README.md ./
COPY api ./api
COPY ghg_engine ./ghg_engine
COPY config.py api_main.py project_store.py ./
RUN uv sync --locked --no-dev

FROM python:3.11-slim AS runtime

WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    DATA_DIR="/app/data" \
    DB_PATH="/app/state/ghg_projects.sqlite" \
    FRONTEND_DIST_DIR="/app/frontend/dist"
COPY --from=python-build /app/.venv /app/.venv
COPY api ./api
COPY ghg_engine ./ghg_engine
COPY config.py api_main.py project_store.py ./
COPY data ./data
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
RUN mkdir -p /app/state
EXPOSE 8000
CMD ["uvicorn", "api_main:app", "--host", "0.0.0.0", "--port", "8000"]
