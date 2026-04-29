# Handoff Notes — Climate Metrix / GHG Engine Prototype

Last updated: 2026-04-27, end of a long development sprint.

## What this is

A GHG (greenhouse gas) inventory accounting platform. Users create projects, configure Reporting Units (facilities or organizations), enter activity data (fuel use, electricity, refrigerants, business travel, etc.), and the engine calculates Scope 1/2/3 emissions. Includes a dashboard, audit deliverable surface, completeness audit, and (newly) spend-based Scope 3 accounting via USEEIO + EXIOBASE.

**Repo:** `https://github.com/parametrix-digitalservices/csm-climate-metrix`

**Local path:** `C:\Users\GreenSte\local_repo\pmx_core\climate-metrix\` (Windows, dev paths use forward slashes throughout this doc).

## Project status — where we are

**Foundation:** solid. Domain / transport / persistence cleanly separated after Phase B. Test coverage: 151 backend, 191 frontend, all passing as of last merge.

**Functional surfaces shipped:**
- Reporting Units tab (was "Facilities") — manage entities, configure applicable activity types per unit
- Activity Inputs tab — three views (Row by Row, By Activity, By Reporting Unit) with full data entry
- Catalog tab — browse coverage of supported activity types
- Dashboard tab — KPI cards, scope stack bar, slice-and-dice treemap (RU > category, sized by CO2e), top RUs bar, top contributors table, cross-filter highlight model
- Results tab — calculation outputs
- Audit tab — auditor deliverable surface (intentionally NOT linked from Dashboard)

**Backend has:**
- Activity catalog (~30 activity types, 22 implemented)
- 7 EQM plugins (direct_factor, scope2_energy, refrigerant_mass_to_gwp, waste_mass, distance_plus_efficiency, freight_ton_mile, passenger_distance) + the new spend_based
- Factor backends: in-memory CSV + document/SQLite, dual-format
- Workspace draft state (auto-save, draft buffer with restore banner)
- Inventory canonicalization (immutable inventory_versions + calculation_runs)
- Per-activity error envelope on /calculate (7 error codes plus the two new spend codes)

## Phased history (chronological)

Each phase landed as a PR. Branch naming: `claude/<descriptive>`.

| Phase | What | Status |
|---|---|---|
| A | Frontend ergonomics: numeric parsing, row-status state machine, paste, scope grouping, visual polish, structural decomposition of ActivityInputsPanel.jsx (1069→401 lines) | merged |
| B1 | Domain type aliases moved out of `models.py` into `domain/common.py` | merged |
| B2 | Transport DTO layer (`api/dto.py`); `FacilityDraft` → `ReportingUnitDraft` rename with Pydantic alias for JSON compat | merged |
| B3 | Per-activity calculation error envelope; 7 canonical error codes | merged |
| B4 | `ProjectStore` decomposed into facade + `ProjectService` | merged |
| B5 | EQM plugin contract: `ResolvedActivity` is primary input; bidirectional adapter deleted | merged |
| C1 | Row-level backend-error chip overlay on the data entry tables | merged |
| C2 | Reporting Unit source checklist: applicable_activity_types, configure dialog, inventory canonicalization filter | merged |
| C3 | Five-bug sweep: Reporting Unit name persistence, refrigerant enum, row status flip, EF dialog race, auto-add-with-toast | merged |
| C4 | UX restructuring: sidebar TOC, tag-library Configure Sources, symmetric "+ Add Activity", notices banner consolidation | merged |
| C4 polish (×4 rounds) | KPI typography, treemap colors, click animations, sticky headers, scope demarcation, click responsiveness, configure sources width, delete RU, MPG comma fix, calc-fail UX | merged |
| D1 | Autosave with draft buffer (project_drafts table, useAutosave hook, restore banner) | merged |
| D2 | Completeness audit: coverage helper, banner on Activity Inputs, widget on Dashboard, missing/orphaned chips on RU cards | merged |
| D3 | Analytics endpoint + Dashboard redesign (KPIs, scope bar, treemap, RU bar, top contributors, filter chips, cross-filter highlight) | merged |
| Hotfix | TDZ blank-screen fix in App.jsx (autosave hook ordering) | merged |
| Treemap restructure | Slice-and-dice layout with always-visible RU header, saturated colors, sharp labels, instant tooltip | merged |
| **E1** | **Spend-based emissions backend (just merged)**: USEEIO + EXIOBASE ingestion via pymrio, gl_mappings, fx_rates, inflation_indices, SpendBasedMethod plugin, `scope3_spend_based` activity type, "Corporate" first-RU default | **merged** |

## Roadmap — what's next

### Spend-based Scope 3 series (active)

| Phase | Scope | Status |
|---|---|---|
| E1 | Backend foundation (just shipped) | done |
| E2 | GL mapping editor UI | next |
| E3 | Spend tab data entry surface (separate top-level tab) | after E2 |
| E4 | Calc flow integration polish, coverage/dashboard surfacing of spend results | after E3 |
| E5 | Supplier substitution + hybrid accounting | deferred |

### Other Phase D leftovers

- D5 — version comparison endpoint + UI. Compare two saved versions of a project's inventory. Useful for audit and YoY-proxy.
- D4 was originally dashboard-to-audit drilldown. **Dropped** — the Audit tab is the auditor deliverable surface; analyst drill stays inside the dashboard via cross-filter highlights. If a need surfaces later, it would be reframed as in-dashboard drill detail, not navigation to audit.

### Bigger strategic items (parked)

- Multi-year inventory support (currently single-year per project). User noted PowerBI handles their analytics so this is lower priority.
- Authentication / multi-user (single-user with no auth today).
- Export / report generation (PDF audit deliverable, XLSX inventory output).
- First-time onboarding UX.
- Cloud deployment readiness (env vars, CORS, secrets, Docker).
- Catalog restructuring for grid-power + renewable claims (parked — single dual-method activity vs. two separate types).
- Bulk import for high-row activities (commute, business travel, spend) via upstream pre-processing pipeline rather than in-UI mass importer.
- Compound-data view: tertiary surface showing only rows with secondary entries (mileage, refrigerants).
- Backend test coverage hardening (`factor_selector.py` at 12%, `direct_factor.py` at 19% per earlier audit).

## Architectural notes worth remembering

**Domain / transport boundary** is now clean (post-B). Editing `ActivityRecord` no longer cascades through 20+ files. Any new activity-type concept goes through:
1. Catalog entry in `data/activity_types.json`
2. EQM plugin in `ghg_engine/eqms/<name>.py` registered in `eqms/registry.py`
3. DTO in `api/dto.py` if it has new fields
4. Frontend reads catalog DTO; no special-casing per type

**Persistence**:
- `project_versions` — immutable workspace snapshots (JSON blob)
- `project_drafts` — per-project draft buffer (one row max, auto-save target)
- `inventory_versions` + `inventory_loci` + `inventory_activities` + `calculation_runs` + `calculation_results` — canonical fact tables, write-once on snapshot save
- `factors` + `factor_versions` + `factor_lineages` + `factor_datasets` — emission factor reference store (now multi-source: physical-quantity factors + spend-based factors via `factor_kind` discriminator)
- `factor_documents` — JSON-doc backend for factor lookup
- `gl_mappings`, `fx_rates`, `inflation_indices` — new with E1

**EQM plugin contract** (post-B5):
```python
class EQMPlugin:
    def compute(
        self,
        resolved: ResolvedActivity,
        activity_def: ActivityTypeDefinition,
        factors: FactorRepository,
        *,
        eqm_context: EQMContext | None = None,  # E1 added this
    ) -> tuple[list[ResultRecord], TraceRecord]: ...
```

The `eqm_context` parameter is the seam E2 needs: it carries GL mapping resolver + FX/inflation providers for `SpendBasedMethod`. The orchestrator's `eqm_context_builder` hook is the place to inject these from the request layer.

**Error envelope codes** (per-activity errors on /calculate response):
- `unknown_activity_type` / `invalid_unit` / `missing_required_param` / `invalid_param_value` / `factor_not_found` / `calculation_error` / `validation_error` (B3)
- `unmapped_gl_code` / `missing_fx_rate` (E1)

**Cross-filter highlight model** in Dashboard (D3 + treemap rebuild):
- Filter chips reduce visible data (coarse)
- Selection state highlights within visible data (fine)
- Click toggle: same cell again clears, different cell switches
- Stale-selection auto-clears when filters reduce the highlighted cell out of view

## Key file locations

### Backend (`ghg-engine-prototype/`)

```
api/
  dto.py                       # Transport DTO layer (post-B2). All response shapes live here.
  schemas.py                   # Request schemas + DTO re-exports for legacy import paths.
  routers/
    calculation.py             # /calculate, /calculate/audit; per-activity error accumulation.
    catalog.py                 # /catalog/* including spend-factors.
    projects.py                # /projects/*, including /draft (D1) and /gl-mappings (E1).

ghg_engine/
  domain/                      # Pure domain types: ActivityObservation, OperationalLocus,
                               # InventoryPolicy, ResolvedActivity, CanonicalFactorRecord.
                               # Zero inbound deps on transport.
  application/calculate_inventory.py   # Orchestration entry point.
  services/
    calculation_orchestrator.py        # Per-activity dispatch with eqm_context_builder hook.
    factor_selector.py                 # Factor query scoring/selection.
    locus_resolver.py                  # Geography enrichment.
    analytics.py                       # D3 analytics queries.
  eqms/
    base.py                            # EQMPlugin abc + EQMContext dataclass (E1).
    registry.py                        # Plugin registration.
    direct_factor.py / scope2_energy.py / refrigerant_mass_to_gwp.py / waste_mass.py /
    distance_plus_efficiency.py / freight_ton_mile.py / passenger_distance.py /
    spend_based.py                     # E1 — new.
  spend_based/
    crosswalk_resolver.py              # NAICS/BEA/NACE/CPA/EXIOBASE crosswalks.
  adapters/legacy_calculation.py       # Transport→domain ingress; one-way only post-B5.
  ports/                                # WorkspaceDraftRepository, InventoryRepository,
                                        # FactorQueryRepository, FactorDatasetRepository.
  infrastructure/
    sqlite_workspace.py                 # Workspace + drafts.
    sqlite_inventory.py                 # Inventory + calc runs.
    sqlite_factors.py                   # Factor store (multi-kind post-E1).
  activity_catalog.py                  # Catalog loader + validation. Reads activity_types.json.
  models.py                            # Legacy transport models (re-exports domain aliases).
  factors.py / document_factors.py     # In-memory + document factor repos.
  audit.py                             # Audit row builder.
  gwp.py                               # GWP value lookup tables.

project_store.py                       # Facade + ProjectService (post-B4). Migration registry.
api_main.py                            # FastAPI entry point.
pyproject.toml                         # Backend deps.

data/
  activity_types.json                  # Canonical activity catalog.
  emission_factors.csv                 # Legacy CSV factor seed.
  emission_factors.json                # Document-backend factor seed.
  reference_data/                      # E1: FX, CPI, crosswalk seed data.
    fx_rates.csv
    us_cpi_u.csv
    crosswalks/                        # naics_to_bea, nace_to_cpa, cpa_to_exiobase.

tools/
  ingest_eeio_factors.py               # E1 — runnable USEEIO + EXIOBASE ingestion.

tests/
  test_*.py                            # 151 backend tests as of E1 merge.
```

### Frontend (`ghg-engine-prototype/frontend/src/`)

```
App.jsx                                # Top-level shell + tab routing. Autosave wiring lives here.
main.jsx                               # MUI theme (radius 7, transitions tuned, disableRipple).

Tabs:
ReportingUnitsTab.jsx                  # Manage Reporting Units; configure sources; delete RU.
ActivityInputsPanel.jsx                # Orchestrator for the three entry views.
  ByActivityTable.jsx                  # By Activity grid + sidebar TOC integration.
  ByReportingUnitTable.jsx             # By RU grid (was By Facility).
  RowByRowView.jsx                     # Free-form entry view.
  ByActivitySidebar.jsx                # TOC sidebar with sticky collapse toggle.
ResultsTab.jsx
AuditTab.jsx                           # Auditor deliverable; not linked from Dashboard.
DashboardTab.jsx                       # D3 analytics dashboard.
  dashboard/
    AnalyticsKpiCards.jsx
    ScopeStackBar.jsx                  # Stacked horizontal scope bar with cross-filter overlay.
    EmissionsTreemap.jsx               # Slice-and-dice; manual SVG; per-RU mini-treemap.
    TopReportingUnitsBar.jsx           # Recharts BarChart (per-Cell for highlight).
    TopContributorsTable.jsx           # DataGrid with selection-highlight (no audit drill).
    analyticsState.js                  # Pure helpers: filter, aggregate, build treemap data.
CatalogTab.jsx
CatalogCoverageBrowser.jsx

Dialogs:
ActivityDetailDialog.jsx               # Edit a single activity entry.
RepeatableActivityDialog.jsx           # Edit repeatable rows (refrigerants, spend).
ConfigureSourcesDialog.jsx             # Tag-library Configure Sources; dual starter buttons.
AddReportingUnitDialog.jsx             # Source-first pivot: tag activity → multiple RUs.
AddActivityDialog.jsx                  # RU-first pivot: tag RU → multiple activities.

State / helpers:
activityDrafts.js                      # Draft state, validation, normalize for submit.
applicability.js                       # applicable_activity_types helpers, filterRowsApplicable.
configureSources.js                    # Configure Sources reducer + starter constants.
reportingUnits.js                      # RU CRUD helpers (delete logic).
coverage.js                            # D2 completeness audit calculations.
rowStatus.js                           # Row-status state machine.
useRowStatus.js / useAutosave.js       # React hooks.
StatusChip.jsx                         # Row-status display + filterErrorsForRow.
NoticesBanner.jsx                      # Consolidated notices badge.
AutosaveStatusChip.jsx                 # Save status indicator.
CoverageBanner.jsx / CoverageWidget.jsx # D2 surfaces.
gridEditingHelpers.jsx                 # Numeric edit cell, paste handler, cell-key nav.
numericFormat.js                       # Comma-aware parse/format.
categoryColors.js                      # Subcategory color palette + saturated fallback.
categorizeForTOC.js                    # Catalog → sidebar TOC hierarchy mapping.
api.js                                 # Fetch wrapper; ApiError preserves error envelope.
```

### Docs (`ghg-engine-prototype/docs/`)

```
phased-development-plan.md             # Original plan, includes backend audit.
facility-checklist-alignment.md        # Phase C2 product alignment (RU + applicability).
spend-based-accounting-plan.md         # E1+ scoping doc with locked decisions.
handoff-notes-2026-04.md               # This file.
```

### EEIO source data (NOT in repo, NOT in tests)

```
C:\Users\GreenSte\local_repo\pmx_core\climate-metrix\eeio\
  USEEIO\
    SupplyChainGHGEmissionFactorsv1.4.0.xlsx    # primary; v1 ingestion target
    USEEIOv2.6.0-phoebe-23.rds                  # newer model in R format; not parsed in v1
    *.pdf
  EXIOBASE\3.8.2\
    IOT_2022_pxp.zip                             # primary; via pymrio
    IOT_2022_ixi.zip                             # ignored in v1
    MRSUT_2022.zip                               # ignored in v1
```

Run ingestion post-merge with:
```bash
cd ghg-engine-prototype
uv sync
uv run python tools/ingest_eeio_factors.py \
    --useeio ../eeio/USEEIO/SupplyChainGHGEmissionFactorsv1.4.0.xlsx \
    --exiobase ../eeio/EXIOBASE/3.8.2/IOT_2022_pxp.zip \
    --db state/ghg_projects.sqlite
```

Verified end-to-end on 2026-04-28: USEEIO loads 1016 NAICS-keyed factors at 2022 USD basis (the original ~411 estimate referred to BEA detail-level codes; v1.4.0 actually keys on 6-digit NAICS, which is the right shape for GL mapping). EXIOBASE loads 184 GLOBAL-aggregated factors at 2022 EUR. ``pymrio`` install side-effect downgrades ``openpyxl`` from 3.1.5 to 3.1.0; ``uv sync`` reverts after ingestion.

## Patterns and conventions for future agents

**Git workflow**:
1. User has `main` checked out at `C:\Users\GreenSte\local_repo\pmx_core\climate-metrix\` — that's where they run the dev server.
2. Agents work in isolated worktrees (under `.claude/worktrees/agent-*`). They cannot run `git add` / `git commit` directly — sandbox denies state-mutating git ops.
3. The orchestrating agent (the one talking to the user) commits by switching to a fresh branch from main, copying or cherry-picking the working-tree files from the agent worktree, and pushing. Standard branch name: `claude/<descriptive-name>`.
4. Always run `npm test` (frontend) + `uv run pytest --no-cov` (backend) + `npm run build` before pushing.
5. PR is opened via GitHub URL (gh CLI not auth'd in this env). Provide the user a ready-to-paste title + body.
6. After user merges + pulls, the next agent worktree branches from updated main.

**Test invariants** (as of E1):
- Backend: 151 tests, `uv run pytest --no-cov` from `ghg-engine-prototype/`
- Frontend: 191 tests, `npm test` from `ghg-engine-prototype/frontend/`
- Build: `npm run build` clean, ~30s, recharts adds ~85kB to a lazy-loaded chunk

**Common gotchas**:
- New `.test.js` files must be added to the `test` script in `frontend/package.json` (the runner enumerates files explicitly).
- TDZ on React hooks: declare hook returns above any `useCallback` whose deps reference them. We hit this with autosave (D1 hotfix).
- Pydantic v2 alias config: snapshots use `populate_by_name=True` + `validation_alias=AliasChoices(...)` + `serialization_alias=...` to round-trip legacy JSON keys. `ReportingUnitDraft.name` aliased to `facility_name`; `ProjectSnapshot.reporting_units` aliased to `facilities`.
- DataGrid `valueFormatter` signature is recharts v8 `(value) => ...`, not the older `(params) => params.value`.
- Sandbox often denies `gh auth` and `git commit` for the inner agents. Plan accordingly.

**Documentation expectations**:
- New product features → discuss in chat, save alignment doc to `docs/`, lock decisions before launching the build agent.
- Backend changes that touch data shapes → update `phased-development-plan.md` if the architectural picture moves.

## Open architectural notes for E2 / future work

From the E1 final report, worth carrying forward:

1. **`eqm_context_builder` wiring** — the orchestrator's hook is in place but not yet consumed at the API layer. Simplest path for E2: extend `CalculationContext` with `project_id`, build a closure in `api/dependencies.py` that constructs a context with the active project's GL mappings + FX/inflation providers, pass into `CalculationOrchestrator`. Plugin and tests are structured for this.

2. **Spend factor unit normalization** — USEEIO factors stored as `kg/USD`, EXIOBASE as `kg/EUR`. Plugin's FX correction assumes USD-basis EFs. When a mapping points at an EXIOBASE factor, we either need to also EUR-convert the EF reference year OR pre-normalize EXIOBASE at ingestion. Suggested: ingestion script gains `--target-currency USD` flag that converts EXIOBASE factors using EF-year FX rate. Documented inline in `ingest_eeio_factors.py`.

3. **`reporting_unit_id` in `gl_mappings`** is a free-text foreign key (no SQL FK because RUs aren't first-class persisted entities — they live in JSON snapshots). E2 mapping editor should validate the RU dropdown against the live RU list, not against a DB table.

4. **GL-code suggestion algorithm** explicitly deferred. Layer 1 (exact text match against known taxonomies) when we eventually build it. LLM fallback parked indefinitely.

5. **USEEIO v2.6.0 .rds** in the data folder is unparsed. v2.6.0 is keyed on 2017 USD — different ref year than v1.4.0's 2022 USD. Adding v2.6.0 support is mechanical (R parser + new dataset row) but a separate pass.

## Test counts at last merge

- Backend: 151 passing
- Frontend: 191 passing
- Frontend build: clean (recharts in lazy chunk)
- Both suites green on `main` after E1 merge

## Last things shipped before this handoff

- E1 — spend-based emissions backend (PR merged, pulled to main)
- Treemap restructure (slice-and-dice with RU envelopes, instant tooltip, saturated colors)
- Multiple polish rounds: corner radius 14→10→7, button click responsiveness, Configure Sources width tuning, Delete RU, MPG comma fix, Reporting Unit name persistence fix, calc-fail UX

## What I'd do next session

1. Confirm E1 ingestion works end-to-end on real EEIO files. User runs `scripts/ingest_eeio_factors.py` with the in-place data files. Validates that USEEIO loaded with ~411 commodity factors and EXIOBASE with ~200 product factors (×region or aggregated).
2. **E2: GL mapping editor UI.** Wire up `eqm_context_builder` at the API layer. Build the mapping table editor (live in a panel inside Configure Sources or as its own tab — design call). Per-mapping row: gl_code, factor (autocomplete from /catalog/spend-factors), optional reporting_unit_id override.
3. **E3: Spend tab.** New top-level tab with row-by-row spend entry, paste support, validation chips for unmapped GL / missing FX rate.
4. **E4: Integration polish.** Coverage widget includes spend categories. Dashboard surfaces spend results.

Then back to E5 (supplier substitution) and the broader Phase D leftovers.
