# GHG Prototype

Pure Python GHG engine + FastAPI wrapper with modular EQM plugins.

## Backend Setup

```bash
uv sync --dev
```

## Run API Locally

```bash
uv run uvicorn api_main:app --reload
```

## Run Frontend

```bash
cd frontend
npm install
npm run dev
```

The UI is available at `http://localhost:5173`.

In development, Vite now proxies `"/api/*"` requests from `:5173` to the FastAPI service on `http://127.0.0.1:8000`, so the expected local setup is:

- frontend on `:5173`
- backend on `:8000`

If the UI loads but calculations fail, confirm the FastAPI server is running; the frontend port does not replace the backend port.

## Run With Docker

```bash
docker compose up --build
```

The single app is served from `http://127.0.0.1:8000`.

Docker uses:

- bundled read-only seed/reference data at `/app/data`
- writable runtime SQLite state at `/app/state/ghg_projects.sqlite`

The compose volume preserves runtime project and inventory state across restarts.

## API Endpoints

- `POST /api/calculate`
- `POST /api/calculate/audit`
- `GET /api/catalog/activity-types`
- `GET /api/catalog/factors/preview?query=...`
- `GET /api/schema/method/{method_id}`
- `GET /healthz`

The legacy root routes remain available temporarily for compatibility, but `/api/...` is the canonical browser-facing interface.

## Example Request

```bash
curl -X POST http://127.0.0.1:8000/api/calculate \
  -H "content-type: application/json" \
  -d '{
    "context": {
      "inventory_year": 2024,
      "gwp_set": "AR6",
      "include_trace": true,
      "source_attributes": {"country": "US", "egrid_subregion": "WECC"}
    },
    "activities": [{
      "facility_id": "F1",
      "activity_type_id": "scope2_purchased_electricity_grid_mix",
      "activity": {"value": 1000, "unit": "kwh"}
    }]
  }'
```

## Quality Checks

```bash
uv run ruff check .
uv run mypy ghg_engine api_main.py
uv run pytest -q
```
