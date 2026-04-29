# Phased Development Plan

Drafted 2026-04-23 after a full audit of backend architecture, API/transport, persistence, planning docs, and git history. The goal is to make the tool feel solid for continued prototype testing while hardening the backend foundation so future frontend work (dashboards, data-entry redesign) flows cleanly from the domain without cascading refactors.

## Backend status check — honest assessment

The architecture has the right shape (hexagonal-ish: `domain/`, `ports/`, `adapters/`, `infrastructure/`) but the seams are porous in ways that will cause frontend refactors to ripple backwards.

### Three foundational problems

**1. `models.py` is both domain type library AND transport schema holder.** Everything imports from it — including `domain/factors.py` (which imports `AccountingMethod`/`FactorRole` from transport). The domain is not self-contained. Every engine layer depends on transport-shaped models: all 7 EQM plugins, application layer, ports, audit, catalog.

**2. The API is the domain.** Response schemas are transparent aliases:
- `ActivityTypeResponse = ActivityTypeDefinition` (literally `pass`)
- `CalculationAuditRow = AuditRecord` (literally `pass`)
- `ProjectSnapshot` embeds `ResultRecord`, `TraceRecord`, `AuditRecord` directly

Adding one field to an internal domain type automatically ships it to the frontend. No versioning, no migration path.

**3. `LegacyCalculationAdapter` does a bidirectional conversion** — transport → domain (`resolve()`) and domain → transport (`to_plugin_inputs()`). EQM plugins accept `ResolvedActivity` as an *optional* parameter; `ActivityRecord`/`CalculationContext` remain primary. Domain exists but isn't first-class.

### Persistence smell

`ProjectStore.save_project_snapshot()` is a fat orchestration façade. It atomically does workspace save + inventory materialization + calculation run creation, and accepts an `activity_catalog` parameter that is literally discarded (`del activity_catalog` on line 557). The split between `sqlite_workspace.py` and `sqlite_inventory.py` is genuinely clean; the problem is callers depend on `ProjectStore`'s orchestration method rather than on the ports.

### Specific gaps blocking frontend evolution

- No structured error envelope. `/calculate` returns flat `HTTPException(400, str(e))`. Row-level error attribution is impossible without backend work.
- `/catalog/factors/preview` has no response schema (returns `df.to_dict(orient="records")` directly).
- `/schema/method/{method_id}` returns plugin-specific `required_params` dicts with no stable shape.
- No version-comparison endpoints (data model supports it, API doesn't expose it).
- No facility-scoped applicability endpoint (needed for checklist feature).

### Test coverage reality check

Overall backend coverage is 39%, not the 84% Codex claimed. Load-bearing gaps: `factor_selector.py` at 12%, `calculation_orchestrator.py` at 36%, `direct_factor.py` at 19%, `scope2_energy.py` at 23%. Address opportunistically as modules are touched.

## UI/UX feedback → backend implication map

| UI/UX item | Backend touchpoint | Risk if done before backend work |
|---|---|---|
| Comma-aware number parsing | None | None |
| Arrow-key nav, cell commit on blur | None | None |
| Paste into Facilities grid | None | None |
| Row-level error flags | **Requires structured per-activity errors** | **High** — flat-string errors can't drive row UI; rework later |
| Single-click detail save | None | None |
| Visual polish (radii, sticky shell, overflow) | None | None |
| Inline supplemental column in "By Activity" | Reads existing `/schema/method/{id}` | Medium — response is plugin-shaped, no stable contract |
| Scope 1/2/3 headers | Reads `scope` on `ActivityTypeDefinition` | None |
| Facility source checklist | **Requires FacilityDraft extension** (JSON additive) | Low if additive; higher if product alignment changes shape |
| Per-facility filtered activity list | Same as checklist | Same |

Most items are pure frontend. Two have real backend dependencies: row-level error attribution (blocked on error envelope) and facility checklist (additive, but needs product alignment).

## Phase A — Frontend light pass (pure ergonomics)

**Goal:** make the tool feel solid for continued testing. Zero backend changes. Ship fast.

- Light structural decomposition of `ActivityInputsPanel.jsx` (1069 lines) and `App.jsx` (859 lines). Extract By Activity and By Facility tables; extract row-status into a hook. No behavior change.
- Shared numeric parse/format helpers (`1,234`, `12,345.67` accepted; formatted on blur with thousands separators).
- Grid commit on cell-level blur/Enter/Tab/arrow; row status updates immediately.
- Override arrow-key behavior in editable numeric cells to navigate, not increment.
- Paste into Facilities grid (reuse pattern from bulk activity grids).
- Horizontal overflow on tables with Shift+mousewheel; stop relying on `density="compact"`.
- Dropdown cells: custom edit cells so mousewheel scrolls the page when dropdown is closed.
- Detail dialog: fix the two-click save race.
- Visual polish: radii 14 → 10, sticky top shell, accordion/table seam cleanup.
- Scope 1/2/3 header grouping in By Activity (cosmetic, no filtering yet).
- UI row states: not-started, missing-details, invalid, complete, partial-support, unsupported. Defer backend-error state to Phase B.

**Duration:** 1–2 focused days.

## Phase B — Backend foundation hardening

**Goal:** frontend changes stop cascading into EQM plugins and model files. Five ordered sub-passes, each independently reviewable.

**B1. Extract domain type aliases (1h).** Move `AccountingMethod`, `FactorRole`, `GwpSetName`, `Scope` from `models.py` into `domain/common.py`. Fix `domain/factors.py` import direction. Verify no other domain files import from transport.

**B2. Create transport DTO layer (2–3h).** New `api/dto.py` with explicit response types: `ActivityTypeDTO`, `ResultRecordDTO`, `TraceRecordDTO`, `AuditRecordDTO`, `CalculationResponseDTO`, `ProjectSnapshotDTO`. Mapper functions at the API boundary. Replace `= ActivityTypeDefinition` aliases with explicit schemas. Lock down `/catalog/factors/preview` and `/schema/method/{method_id}` with stable envelopes.

**B3. Error envelope for calculation (2h).** Structured per-activity errors:
```python
class ActivityCalculationError(BaseModel):
    activity_index: int
    activity_type_id: str | None
    facility_id: str | None
    error_code: str  # "unknown_activity_type", "missing_required_param", ...
    message: str
    details: dict[str, Any] = {}

class CalculationResponse(BaseModel):
    results: list[ResultRecordDTO]
    summary: dict[str, float]
    trace: list[TraceRecordDTO] | None = None
    errors: list[ActivityCalculationError] = []
    partial_success: bool = False
```
Calculation loop accumulates failures instead of bailing at first.

**B4. Decompose ProjectStore (2–3h).** Split into `ProjectService` (orchestration) and thin port-backed accessors at `store.workspace` / `store.inventory`. Drop unused `activity_catalog` parameter. Callers pick the right granularity.

**B5. EQM contract cleanup (3–4h — riskiest).** Change `EQMPlugin.compute()` so `ResolvedActivity` is primary and required; `ActivityRecord`/`CalculationContext` become optional compat shims. Delete `LegacyCalculationAdapter.to_plugin_inputs()`. Update all 7 EQM implementations. Keep `engine.calculate()` signature stable.

**Duration:** 2–3 focused days total.

## Phase C — Features enabled by hardened foundation

**C1. Row-level error attribution (1h frontend).** Pure frontend once B3 ships. Map each `ActivityCalculationError` to its row.

**C2. Reporting Unit source checklist.** Scope locked in `facility-checklist-alignment.md` (2026-04-23). Add `applicable_activity_types: list[str]` to `FacilityDraft` (JSON-embedded, no DB migration). Rename UI surfaces from "Facility" to "Reporting Unit" (internal `FacilityDraft` rename deferred to B2). Per-header "configure sources" button with call-out for unconfigured units. "+ add Reporting Unit" button per activity in By Activity. Unchecked facility/activity pairs hidden in By Activity (soft-hide with warn-on-uncheck in the configure dialog). Checklist is a planning tool with progress surfaces (total / with data / complete). **Backend filter at inventory canonicalization** in `sqlite_inventory.py` ensures unchecked pairs never flow into results — this is the correctness-critical piece. Logical grouping of checkboxes by Scope / category in the configure dialog.

**C3. Stable `/catalog/factors/preview` contract.** Explicit column set, response schema validation.

**C4. Version comparison endpoint.** `GET /projects/{id}/versions/{v1}/diff/{v2}` — in-memory set diff. Data model ready.

**Duration:** 2–3 days.

## Phase D — Dashboard evolution + remaining UI feedback

Deferred until A–C ship. Current `DashboardTab.jsx` (520 lines) is snapshot-local client aggregator. Targets:
- Dedicated analytics endpoints hitting `inventory_activities` / `calculation_results` directly.
- Version comparison UI (from C4).
- Drilldown aggregate → result → audit row.
- Deferred UI/UX notes (sidebar conversion, dashboard aesthetics, extra By Activity/By Facility columns).

## Coverage expectation

Any module touched in Phase A–D gets coverage brought above ~70%. Phase B5 (EQM contract refactor) naturally forces regression coverage.

## Recommended sequence

1. Start Phase A immediately (no-regret ergonomics).
2. In parallel, pin down the facility-checklist product alignment questions.
3. Phase B in order B1 → B5. Each sub-pass ships independently.
4. Phase C once B is complete.
5. Phase D is the payoff — clean substrate, dashboard becomes the showpiece.
