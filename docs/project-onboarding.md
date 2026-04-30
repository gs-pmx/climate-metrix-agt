# Climate Metrix Workshop OS Onboarding

Status: draft
Last updated: 2026-04-29
Workshop OS project ID: `climate-metrix`
Workshop OS root: `C:\Users\GreenSte\local_repo\pmx_core\workshop-os`
Project root: `C:\Users\GreenSte\local_repo\pmx_core\climate-metrix`
Active development root: `C:\Users\GreenSte\local_repo\pmx_core\climate-metrix\ghg-engine-prototype`

## Purpose

This file is the local Climate Metrix touchpoint for Workshop OS / AgentOS.

It does not replace project documentation, source code, tests, issue notes, or local agent instructions. It explains how agents should connect this repository to the canonical Workshop OS context, memory, policies, and project profile.

## Repository Shape

- Nominal project root: `C:\Users\GreenSte\local_repo\pmx_core\climate-metrix`
- Active app/package root: `ghg-engine-prototype`
- Backend/API: Python, FastAPI, Pydantic, `api_main.py`, `api/`, `ghg_engine/`
- Frontend: React/Vite under `ghg-engine-prototype/frontend`
- Tests: backend tests under `ghg-engine-prototype/tests`; frontend tests through `frontend/package.json`
- Local state: SQLite project/inventory/factor stores, with Docker volume-backed state in local development

## Worktree Workflow

Agentic write tasks should use purpose-built git worktrees. Do not switch the primary project checkout onto a task branch for normal agent work.

Use this pattern from the project root before editing:

```powershell
git worktree add -b codex/<task-slug> .codex\worktrees\<task-slug> origin/main
cd .codex\worktrees\<task-slug>
```

Claude-managed work may use `.claude\worktrees\<task-slug>`; Codex-managed work should use `.codex\worktrees\<task-slug>` unless a task-specific harness provides a different path. Run app commands from `ghg-engine-prototype` inside the task worktree.

Read-only inspection can happen from the primary checkout. Writing, committing, testing with generated files, or opening a PR should happen from the task worktree. Check `git status` inside the worktree before staging and preserve unrelated work.

## Canonical Context

Canonical Workshop OS files for this project:

- `workshop-os/projects/climate-metrix/project.md`
- `workshop-os/projects/climate-metrix/rules.md`
- `workshop-os/projects/climate-metrix/current-state.md`
- `workshop-os/projects/climate-metrix/decisions.md`
- `workshop-os/context/workshop.md`
- `workshop-os/context/tools-and-systems.md`
- `workshop-os/identity/user.md`
- `workshop-os/identity/operating-principles.md`
- `workshop-os/policies/default.yaml`

Project-local documentation remains authoritative for implementation details, repo layout, commands, tests, data files, and current task plans.

## Compile Context

Before substantial agent work, compile a bounded Workshop OS context bundle:

```powershell
cd C:\Users\GreenSte\local_repo\pmx_core\workshop-os
$env:PYTHONPATH='src'
python -m workshop_os compile --project climate-metrix --adapter codex
```

For MAGE or orchestration work:

```powershell
cd C:\Users\GreenSte\local_repo\pmx_core\workshop-os
$env:PYTHONPATH='src'
python -m workshop_os compile --project climate-metrix --adapter mage --output generated\climate-metrix-context-bundle.json
```

Use a task reference when working from a local plan or issue:

```powershell
python -m workshop_os compile --project climate-metrix --adapter codex --task C:\path\to\task-or-plan.md
```

## Local Commands

Run these from `ghg-engine-prototype` unless noted otherwise.

Backend setup:

```powershell
uv sync --dev
```

Run backend locally:

```powershell
uv run uvicorn api_main:app --reload
```

Backend quality checks:

```powershell
uv run ruff check .
uv run mypy ghg_engine api_main.py
uv run pytest -q
```

Run frontend locally:

```powershell
cd frontend
npm install
npm run dev
```

Frontend quality checks:

```powershell
cd frontend
npm run lint
npm test
npm run build
```

Docker run:

```powershell
docker compose up --build
```

Local ports:

- Backend API: `http://127.0.0.1:8000`
- Frontend dev server: `http://localhost:5173`
- Docker-served app: `http://127.0.0.1:8000`

## Domain Authority Files

Before changing calculation or accounting behavior, locate the authority for the surface being touched:

- Core domain model: `ghg_engine/domain/common.py`, `activity.py`, `locus.py`, `policy.py`, `factors.py`, `resolved_activity.py`
- Activity catalog schema and validation: `ghg_engine/activity_catalog.py`
- Canonical activity catalog data: `data/activity_types.json`
- Calculation orchestration: `ghg_engine/services/calculation_orchestrator.py`
- EQM plugin contract and implementations: `ghg_engine/eqms/base.py`, `ghg_engine/eqms/registry.py`, `ghg_engine/eqms/*.py`
- Factor records and source selection: `ghg_engine/domain/factors.py`, `ghg_engine/factors.py`, `ghg_engine/document_factors.py`, `ghg_engine/services/factor_selector.py`
- Factor/source data: `data/sources.json`, `data/emission_factors.json`, `data/factors.csv`, `data/ghg_metadata.json`, `data/grid_regions.json`, `data/unit_definitions.json`
- API boundary: `api/dto.py`, `api/schemas.py`, `api/routers/`, `api_main.py`
- Persistence: `project_store.py`, `ghg_engine/infrastructure/sqlite_workspace.py`, `sqlite_inventory.py`, `sqlite_factors.py`

## Domain Docs To Read Before Calculation Changes

Read the docs that match the task before changing methodology, catalog semantics, factors, boundaries, applicability, audit behavior, or inventory materialization:

- `ghg-engine-prototype/docs/handoff-notes-2026-04.md`: current app status, architecture notes, roadmap, gotchas, and test expectations.
- `ghg-engine-prototype/docs/phased-development-plan.md`: backend architecture history, domain/transport boundaries, error-envelope work, and phased design intent.
- `ghg-engine-prototype/docs/facility-checklist-alignment.md`: Reporting Unit applicability decisions, planning-tool behavior, and canonical inventory filtering expectations.
- `ghg-engine-prototype/docs/spend-based-accounting-plan.md`: spend-based Scope 3 accounting decisions, GL mapping, EEIO datasets, FX/inflation behavior, and supplier substitution roadmap.

## Protective Tests

Use targeted tests when the touched surface is narrow, and run the full backend/frontend checks before a PR when practical.

Backend domain and contract tests:

- `tests/test_domain_boundary.py`
- `tests/test_dto_boundary.py`
- `tests/test_activity_catalog.py`
- `tests/test_eqm_coverage.py`

Calculation, factor, and unit tests:

- `tests/test_resolved_locus_execution.py`
- `tests/test_calculation_error_envelope.py`
- `tests/test_factor_selection.py`
- `tests/test_factor_backend_contracts.py`
- `tests/test_factor_store.py`
- `tests/test_units.py`
- `tests/test_smoke.py`

Spend-based and EEIO tests:

- `tests/test_spend_based_method.py`
- `tests/test_spend_based_e2e.py`
- `tests/test_spend_factor_browsing.py`
- `tests/test_eeio_ingestion.py`
- `tests/test_gl_mappings_api.py`

Persistence, project, and API tests:

- `tests/test_project_store.py`
- `tests/test_project_draft.py`
- `tests/test_project_draft_api.py`
- `tests/test_catalog_api.py`
- `tests/test_app_runtime.py`

Frontend tests are enumerated in `frontend/package.json`. If adding a new frontend test file, update the test script because the runner explicitly lists test files.

## Agent Startup Checklist

Before editing this repo, an agent should:

1. Read this file.
2. Compile or request Workshop OS context for `climate-metrix`.
3. Create or enter a purpose-built task worktree for any write task.
4. Work from `ghg-engine-prototype` inside that worktree for active app changes unless the task says otherwise.
5. Read relevant local project docs and task files.
6. Inspect the current git status and avoid overwriting unrelated work.
7. Identify whether the task touches GHG calculation logic, domain model architecture, factors, boundaries, auditability, or UI workflow.
8. If the task affects architecture or scientific/accounting assumptions, pause and document the decision point before making changes.

## Climate Metrix Guardrails

Agents should preserve these project-level requirements:

- Prioritize GHG calculation correctness, traceability, auditability, and reproducibility.
- Treat emissions factors, accounting boundaries, assumptions, scopes, and methods as evidence-backed domain choices.
- Keep the domain model flexible and portable without adding speculative abstraction.
- Bias toward FastAPI/Pydantic plus React when building application features, while still choosing better tools when justified.
- Maintain high test coverage for calculation behavior and shared domain contracts.
- Make UI choices with clear workflow judgment; do not wait for pixel-level instructions when reasonable design decisions are needed.
- Preserve security boundaries and do not store secrets in the repository.

## Approval Boundaries

Agents may usually act autonomously for routine, non-destructive implementation work inside a purpose-built task worktree.

Agents should pause before:

- major architectural forks;
- changes that break or delete existing work;
- changes to GHG accounting methodology, factor selection, scope/category mapping, or inventory boundary behavior;
- working directly in the primary checkout for an agentic write task;
- pushing to `main` or mutating protected/shared branches;
- destructive filesystem or git actions;
- initiating communication with other humans;
- intentionally bypassing security controls.

## Durable Decisions And Memory

Write durable knowledge back to Workshop OS when it changes future agent behavior.

Use project decision files for:

- architecture decisions;
- calculation model decisions;
- accounting boundary decisions;
- factor-source or method-selection decisions;
- major UI/workflow decisions that future agents need to respect.

Use Workshop OS memory for:

- reusable lessons;
- durable project facts;
- user preferences;
- recurring risks;
- commitments and follow-ups.

Every durable item needs source and timestamp.

## Local Touchpoints To Add Or Refine

Use this checklist to finish onboarding the repository:

- [x] Confirm the current active app/package root inside this repo.
- [x] Document standard setup, run, test, and build commands.
- [x] Identify the local agent instruction file target: `AGENTS.md`.
- [x] Add a local instruction bridge that points to Workshop OS instead of duplicating canonical identity/context.
- [x] Identify domain docs agents should read before touching calculation logic.
- [x] Identify test suites that protect calculation correctness and domain contracts.
- [x] Update `workshop-os/projects/climate-metrix/current-state.md` with verified implementation state.
- [x] Update `workshop-os/projects/climate-metrix/decisions.md` with confirmed durable decisions.

## Refinement Questions

Please fill these in over time, or ask an agent to interview you for them:

1. Which existing decisions in the Climate Metrix docs are settled and should be elevated into Workshop OS decisions?
2. What work is currently highest priority this week?
3. What should agents avoid touching without explicit approval beyond the default GHG methodology/factor/boundary guardrails?
4. Which external GHG standards or source PDFs should agents cite for each major calculation class?
5. Which Climate Metrix docs should be retired or consolidated as implementation catches up?

## Recommended Next Step

Use this onboarding pattern on the next real project only after Climate Metrix has gone through one substantial agent task. The decision point is whether the bridge plus compiled Workshop OS bundle gives enough context without overloading the task agent.
