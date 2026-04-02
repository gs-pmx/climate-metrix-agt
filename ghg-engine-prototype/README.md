# GHG Prototype

Pure Python GHG engine + FastAPI wrapper with modular EQM plugins.

## Setup

```bash
pip install -e .
```

## Run API

```bash
uvicorn api_main:app --reload
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

## API Endpoints

- `POST /calculate`
- `GET /catalog/routing`
- `GET /catalog/factors/preview?query=...`
- `GET /schema/method/{method_id}`

## Example Request

```bash
curl -X POST http://127.0.0.1:8000/calculate \
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
      "source_id": "electricity_s2",
      "source_type": "electricity",
      "scope": "Scope 2",
      "metric_group": "grid_energy",
      "metric_subgroup": "electricity_mix",
      "activity": {"value": 1000, "unit": "kwh"}
    }]
  }'
```

## Quality Checks

```bash
ruff check .
mypy ghg_engine api_main.py
pytest
```
