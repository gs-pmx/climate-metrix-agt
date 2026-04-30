# Climate Metrix Agent Instructions

Climate Metrix is governed by Workshop OS project ID: `climate-metrix`.

This file is a local bridge for agents working in this repository. It is not the canonical source of user identity, global operating principles, project policy, or durable memory.

## Start Here

Before substantial work:

1. Read `docs/project-onboarding.md` in this repository.
2. Compile or request Workshop OS context for `climate-metrix`.
3. Create or enter a purpose-built task worktree before making repository changes.
4. Work from `ghg-engine-prototype` inside that worktree for active app changes unless the task says otherwise.
5. Read the relevant local task, plan, docs, and code before editing.
6. Check `git status` in the task worktree and preserve unrelated work.

Workshop OS root:

```text
C:\Users\GreenSte\local_repo\pmx_core\workshop-os
```

Active development root:

```text
C:\Users\GreenSte\local_repo\pmx_core\climate-metrix\ghg-engine-prototype
```

Compile context from source:

```powershell
cd C:\Users\GreenSte\local_repo\pmx_core\workshop-os
$env:PYTHONPATH='src'
python -m workshop_os compile --project climate-metrix --adapter codex
```

For a task file:

```powershell
python -m workshop_os compile --project climate-metrix --adapter codex --task C:\path\to\task-or-plan.md
```

## Worktree Workflow

Agentic write tasks should happen in a purpose-built git worktree, not by switching the primary checkout onto a task branch. This keeps the main local checkout stable while parallel agents work.

Preferred local pattern:

```powershell
git worktree add -b codex/<task-slug> .codex\worktrees\<task-slug> origin/main
cd .codex\worktrees\<task-slug>
```

Claude-managed work may use `.claude\worktrees\<task-slug>`; Codex-managed work should use `.codex\worktrees\<task-slug>` unless a task-specific harness says otherwise.

Use direct branches in the primary checkout only for explicitly requested recovery, maintenance, or human-directed git operations. Read-only inspection may happen from the primary checkout.

## Common Commands

Run from `ghg-engine-prototype` unless noted otherwise.

```powershell
uv sync --dev
uv run ruff check .
uv run mypy ghg_engine api_main.py
uv run pytest -q
uv run uvicorn api_main:app --reload
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
npm run lint
npm test
npm run build
```

Docker:

```powershell
docker compose up --build
```

## Calculation And Domain Work

Before touching calculation behavior, domain model shape, factor selection, scope/category mapping, Reporting Unit applicability, audit output, or inventory boundary behavior, read the relevant sections of `docs/project-onboarding.md`:

- Domain Authority Files
- Domain Docs To Read Before Calculation Changes
- Protective Tests

Treat changes to methodology, factors, catalog semantics, boundaries, or canonical inventory materialization as domain decisions. Document the reasoning and pause when the change materially affects downstream accounting behavior.

## Local Authority

Project-local docs, task files, tests, and source code remain authoritative for repository structure, implementation details, commands, and current work.

Canonical Workshop OS sources:

- `workshop-os/projects/climate-metrix/project.md`
- `workshop-os/projects/climate-metrix/rules.md`
- `workshop-os/projects/climate-metrix/current-state.md`
- `workshop-os/projects/climate-metrix/decisions.md`
- `workshop-os/identity/user.md`
- `workshop-os/identity/operating-principles.md`
- `workshop-os/policies/default.yaml`

## Guardrails

Agents must preserve:

- GHG calculation correctness, traceability, auditability, and reproducibility.
- Evidence-backed accounting methods, factors, boundaries, scopes, and assumptions.
- A flexible, portable domain model without speculative abstraction.
- Strong tests around calculation behavior and shared domain contracts.
- Security boundaries and secret hygiene.

Pause before:

- major architectural forks;
- destructive filesystem or git actions;
- changes expected to break or delete existing work;
- changes to GHG accounting methodology, factor selection, scope/category mapping, or inventory boundary behavior;
- working directly in the primary checkout for an agentic write task;
- pushing to `main` or mutating protected/shared branches;
- initiating communication with other humans;
- bypassing security controls.

## Durable Write-Back

If a task produces durable knowledge, add it to Workshop OS with source and timestamp:

- project decisions: `workshop-os/projects/climate-metrix/decisions.md`
- current state changes: `workshop-os/projects/climate-metrix/current-state.md`
- reusable facts/preferences/lessons/risks: `workshop-os/memory/`

Do not copy broad Workshop OS context into this repo. Keep this file short and project-local.
