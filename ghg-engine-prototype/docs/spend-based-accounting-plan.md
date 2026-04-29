# Spend-Based Emissions Accounting — Implementation Plan

Drafted 2026-04-27. Working from the user's framing: spend-based emissions calculations and commute emissions, structured similarly to fugitive refrigerants (per-RU repeated rows with multiple fields per row), with currency + inflation adjustment, GL-to-EF mapping, and a path to supplier-specific primary-data substitution.

## What spend-based accounting actually is

A Scope 3 calculation method where activity is **financial spend in a category** rather than a physical quantity. Emissions = spend × emissions factor (typically kg CO2e per USD or EUR). Used for:

- **Category 1 — Purchased Goods & Services** (the big one)
- **Category 2 — Capital Goods**
- **Categories 3–8** when supplier-specific data isn't available

The standard simplification: each spend transaction has a GL category (or NAICS code, or supplier industry); each category has an emissions factor; you multiply.

The hard parts:

1. **EF basis vs. transaction basis.** EF datasets are denominated in a specific year and currency (e.g., USEEIO in 2018 USD). User's spend is in their transaction year and currency. Need FX + inflation correction to bring spend to the EF's reference frame before multiplying.
2. **GL chart variation.** Every customer has a different chart of accounts. The mapping from "their GL" to "our EFs" is customer-specific and must live as project-level data, not as a global catalog.
3. **Supplier specificity.** When a supplier provides primary activity data (e.g., a steel supplier reports their own product carbon footprint per ton), spend-based emissions should be substituted out for that supplier — otherwise double-counting.

## Current model review — what we have, what's missing

### What we already have ✓

- **Multi-field activity inputs.** `ActivityTypeDefinition.input_schema.fields[]` supports any number of named fields with kinds (number, enum, string, boolean). Spend rows would use this directly.
- **Repeatable activities.** Fugitive refrigerants set the precedent — many entries per (RU, activity_type) pair, each a structured record. Spend rows fit the same pattern.
- **Per-RU canonicalization filter (Phase C2).** Spend rows respect the same applicability rules as physical-quantity activities.
- **Plugin contract.** EQM plugins receive a `ResolvedActivity` and return result rows. Adding a `SpendBasedMethod` plugin is mechanical given the existing pattern.
- **Inventory persistence.** `calculation_results` already keys on `(facility_id, activity_type_id, gas, ...)` — spend-derived results slot in unchanged.

### What's missing ✗

1. **Spend-based EF data.** Our factors store currently holds physical-quantity factors (kg CO2e / kg fuel, kg CO2e / kWh, etc.). We need to ingest a spend-based EF dataset and tag it as such.
2. **GL mapping data structure.** Per-project mapping from `(gl_code, [reporting_unit_id])` → `factor_id`. Doesn't exist today — needs new SQLite table + DTOs + API.
3. **Currency conversion + inflation tables.** FX rates per `(currency, year)` and inflation indices per year. Don't exist today — need reference data in the backend.
4. **Spend-shaped data entry UI.** Existing By Activity / By RU grids are designed for "primary value + unit" + a small param set. Spend has a fundamentally different shape (`gl_code, spend, currency, supplier, supplier_country, transaction_year`) and high row count (hundreds to thousands). Needs a dedicated surface with bulk import.
5. **Supplier substitution mechanic.** Tagging a supplier as "primary data available" and excluding their spend from the spend-based calc. Brand-new concern.

### Backend changes required

- **New SQLite tables** (additive, behind a migration):
  - `factor_datasets` already exists. Add new dataset rows for spend-based EFs (USEEIO or EXIOBASE).
  - `gl_mappings` new table: `(project_id, reporting_unit_id [nullable], gl_code, factor_id, created_at, updated_at)`. NULL `reporting_unit_id` = project-wide default; non-null = RU-level override that wins over the default.
  - `fx_rates` new table: `(currency, year, rate_to_usd, source)`. Annual average rates.
  - `inflation_indices` new table: `(year, index_value, source)`. Single index series; default to US CPI-U.
- **EF tagging.** Existing `factors` table needs a way to identify spend-based factors (probably a `factor_type` enum: physical | spend). Easier as a new column with default 'physical'; a migration backfills existing rows.
- **New EQM plugin.** `ghg_engine/eqms/spend_based.py`. Reads `gl_code`, `spend`, `currency`, `transaction_year` from `ResolvedActivity.observation.params`. Looks up the GL mapping → factor → EF. Applies FX + inflation. Returns CO2e result rows.
- **New activity type.** `scope3_spend_based` in `data/activity_types.json`. `input_schema` describes the spend-row fields. Repeatable like refrigerants.
- **API endpoints.** GL mappings CRUD: `GET/PUT /projects/{id}/gl-mappings`. Spend factor browsing: `GET /catalog/spend-factors`. The existing analytics endpoint absorbs spend results without changes (results are still per-(facility, activity, scope, category) rows).

## EF dataset choice — start with USEEIO

| Dataset | Coverage | License | Year basis | Categories |
|---|---|---|---|---|
| **USEEIO 2.0** (US EPA) | US only | Public domain | 2018 USD | ~411 commodities |
| **EXIOBASE** | Global, 49 regions | Free for academic; commercial license required | 2007 EUR base, updates available | ~200 products × 49 regions |
| **CEDA** | Global | Paid license | Multiple years | ~430 categories, GHG Protocol certified |

**Recommendation: USEEIO for v1.** Public domain (no licensing friction), well-documented (US EPA publishes the methodology), single-currency simplification, enough granularity to be useful. Add EXIOBASE in a later phase once the architecture is proven.

USEEIO ships as Excel files we'd ingest into `factor_documents`. Each row becomes a factor with `factor_type='spend'`, `unit='kg CO2e/USD'`, `data_year=2018`, attribute fields capturing the BEA commodity code.

## Currency + inflation simplification

User-approved v1 simplification: one FX rate per `(currency, year)`, one inflation index per year.

**Sources:**
- FX: World Bank's annual average exchange rates (free, annual).
- Inflation: US Bureau of Labor Statistics CPI-U or BEA GDP deflator. CPI-U is more conservative; GDP deflator is more accurate for industrial spend.

**Math at calc time:**
```
spend_in_ef_basis = spend_in_transaction_currency
                    × fx_rate(transaction_currency, transaction_year)        # → USD in transaction year
                    × inflation_index(ef_reference_year) / inflation_index(transaction_year)  # → USD in EF year
emissions = spend_in_ef_basis × emissions_factor
```

Backend ships with reasonable bundled FX + CPI data covering 2010-current; admin endpoint to refresh. Users see the inputs in their original currency/year; engine handles the normalization.

## Data entry shape

Each spend row has:

| Field | Required | Notes |
|---|---|---|
| `gl_code` | Yes | Free-text customer GL code or category id |
| `spend` | Yes | Numeric, in transaction currency |
| `currency` | Yes | Enum (USD, EUR, GBP, etc.) — defaults to USD |
| `transaction_year` | Yes | Year the spend happened. Defaults to inventory year. |
| `supplier` | Optional | Free-text supplier name |
| `supplier_country` | Optional | ISO country code |
| `description` | Optional | Free-text line item detail |
| `is_substituted` | Auto/optional | Flag set when primary data substitution is active for this supplier |

Each row is a single entry under the `scope3_spend_based` activity type, keyed to a Reporting Unit (or to a "Global" pseudo-RU for org-level spend that doesn't attribute to a specific RU).

## Where the entry surface lives

User suggested a separate form. Two reasonable shapes:

**Option A: New top-level tab "Spend".** Pros: clearly separated from physical-quantity input, room for bulk-import workflow. Cons: yet another tab; users have to context-switch.

**Option B: New sub-view inside Activity Inputs** (alongside By RU / By Activity / Row by Row): "By Spend" or "Spend Rows". Pros: stays in the data-entry context. Cons: the shape is so different it'll feel like a stranger in that container.

**Recommendation: Option A — new "Spend" tab.** Spend is a different mental model (you're entering financial line items, not measurements) and the row count is going to be much higher. Worth the dedicated surface.

Within the Spend tab:
- **Header:** filters (RU, year, currency), summary chips (total spend by year, est. emissions)
- **GL Mappings panel** (collapsible): list of `gl_code → factor` mappings, project-level + per-RU overrides. CRUD here.
- **Spend rows table:** flat editable table (DataGrid) with the columns above. Bulk paste support, CSV/XLSX import, row delete, per-row "exclude from calc" toggle (for supplier substitution v2).
- **Validation:** rows highlighted if `gl_code` has no mapping, or if currency has no FX rate for the transaction year.

## Implementation plan — five sub-phases

### E1 — Backend foundations (~3-4 days)

- New SQLite tables behind migration: `gl_mappings`, `fx_rates`, `inflation_indices`. Add `factor_type` column to `factors`.
- Reference data bundled: FX rates 2010-2025, US CPI 2010-2025.
- USEEIO 2.0 ingestion: one-time data prep script that loads ~411 factors into `factors` with `factor_type='spend'` and `data_year=2018`.
- New activity type `scope3_spend_based` in `activity_types.json`. Repeatable, scope3, category "Purchased Goods & Services".
- New EQM plugin `SpendBasedMethod` with FX + inflation rollup. Returns standard ResultRecord shape.
- DTOs + API endpoints for `gl_mappings` CRUD, `fx_rates` read, `spend_factors` browse.
- Backend tests for plugin math (FX correction, inflation correction, missing-mapping handling, per-RU override resolution).

### E2 — GL mapping UI (~2 days)

- New API endpoints (already from E1) wired through frontend.
- A "GL Mappings" component (rendered inside the Spend tab, also reachable from Reporting Unit configure-sources later if useful).
- Per-mapping row: `gl_code`, factor (searchable autocomplete from spend factors), optional `reporting_unit_id` for override.
- Bulk import / paste (TSV from spreadsheet).
- Validation: warn on duplicate `(gl_code, reporting_unit_id)`, missing factor, etc.

### E3 — Spend data entry surface (~2-3 days)

- New top-level "Spend" tab in `App.jsx`.
- DataGrid-based row entry with paste, CSV import (use SheetJS or a small CSV parser).
- Per-row validation chips: missing GL mapping → "needs mapping", missing FX rate → "no rate for {year} {currency}".
- Save flow: rows persist as `scope3_spend_based` activity drafts on the active project's snapshot. UI groups them by Reporting Unit, including a "Global" pseudo-RU for unattributed rows.
- Bulk-action toolbar: filter, delete-selected, copy-down.

### E4 — Calculation flow integration (~1 day)

- Spend rows flow through the existing engine pipeline as activity drafts. The repeatable activity pattern handles the multi-row case.
- Coverage / completeness widget includes spend categories.
- Dashboard analytics endpoint includes spend-derived results without changes (they're already in `calculation_results`).
- Frontend dashboards already render correctly because spend results live in the same fact table.

### E5 — Supplier substitution (deferred — its own phase) (~3-4 days)

- Tag suppliers as "primary data available" at project level.
- Spend rows for a tagged supplier excluded from `SpendBasedMethod` output.
- Audit trail: for each excluded spend row, link to the primary activity row that "covered" the spend.
- UI: toggle on supplier, dashboard surfaces the substitution decisions in the coverage widget.

**Total for E1–E4 (the v1 scope): roughly 8-10 days.** E5 is its own phase after the basic pipeline is proven.

## Commute emissions — how does this fit?

The user mentioned commute emissions as a related thread. Commute is conceptually closer to existing physical-quantity activities — distance × mode × emission factor — so it doesn't share the spend-based architecture. But it shares the same shape as the user's concern: many rows per project, with mode/distance per row, optionally per-employee or per-route.

We already have `scope3_employee_commute_*` activity types in the catalog (bus, transit_rail, vehicle). They use the existing `passenger_distance` EQM. For commute, the gap is mostly UX: bulk row entry, employee survey ingestion, modal split estimation when full-resolution data isn't available.

**Recommendation:** treat commute as a separate, smaller pass that follows E1–E4. The spend-based architecture (per-row spend with metadata) is a useful template — commute could reuse the new "high-row-count tab" pattern.

## Resolved decisions (locked 2026-04-27)

| Question | Decision |
|---|---|
| EF datasets | International from day one. Multi-source architecture. Ingest USEEIO 2.2 (US, public) and EXIOBASE 3.8.2 (global, CC) in E1. CEDA-Open from Cornerstone Data later if licensing confirms. Each factor carries `factor_dataset_id`; project selects primary dataset. |
| Unmapped GL behavior | Warn, don't auto-suggest by default. Unmapped rows excluded from totals and surfaced in coverage widget. Suggestion algorithm is a separate, explicit user action — gated to avoid the bad-suggestion-by-default trap. |
| Currency scope (v1) | USD only in UI. Backend currency-aware from day one (`fx_rates` table populated). Adding EUR/GBP later = data + dropdown. |
| Global / Corporate RU | The auto-created first RU is now named **"Corporate"** with corporate starter defaults pre-selected (spend-based, business travel modes, employee commute modes). Subsequent RUs added by users default to empty applicable_activity_types and use facility-typical starters. The Configure Sources dialog gets two preset buttons: "Use facility starters" (current set) and "Use corporate starters" (new). No `typical_scope` hint needed on individual catalog entries. |
| Activity-type fragmentation (modes) | Keep modes as separate activity types in the catalog (different math, different audit trail, different factor templates). Solve the "list grows" UX concern via deeper grouping: Scope > Category > Activity in Configure Sources, mirroring what By Activity sidebar TOC already does. |
| Bulk row entry | Build the bulk-row infrastructure for spend (E3) as a reusable component so commute, business travel, and any future high-row-count repeatable activity can adopt it. |
| GL → EF mapping | Use preset crosswalks. EXIOBASE's Zenodo bundle includes NACE/CPA concordance tables. USEEIO publishes BEA/NAICS crosswalks (likely on Cornerstone). Crosswalks live in the mapping resolver layer, not the user UI — a customer's NAICS GL code can resolve to EXIOBASE factors via NAICS → NACE → EXIOBASE without the user knowing. |

## Still deferred (answer when relevant)

- **Suggestion algorithm tier.** When we eventually build it: Layer 1 (exact text match against known GL chart standards) → Layer 2 (fuzzy match against user's existing mappings). LLM fallback is parked indefinitely — too many opaque taxonomy translation layers (GL → NACE → CPA → EXIOBASE concordance → factor) for blind LLM mapping to be trustworthy. A tag-based lineage system that surfaces every translation layer would be a separate research project; not happening soon. Ship Layer 1 first.
- **Bulk row import.** Future concern; expected to be solved upstream of the UX via a pre-processing pipeline / ingestion endpoint, not by an in-UI mass importer. Spend tab handles row-by-row entry with paste support for v1.
- **Supplier identity canonicalization** (matters for E5 substitution).
- **Inflation methodology.** CPI-U for v1 (broad consumer, conservative). GDP deflator or PPI later if customers demand industry-specific accuracy.
- **Access control on spend data.** Defer until we have multi-user auth.
- **GL chart preset imports.** Customers can paste from spreadsheet in v1; preset imports for common ERPs (NetSuite, QuickBooks chart exports) are a later polish.
