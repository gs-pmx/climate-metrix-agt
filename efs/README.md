# Emission Factor Source Library

Last reviewed: 2026-04-29

This folder stores raw or near-raw emissions factor source material for Climate
Metrix. Treat these files as source evidence, not as the canonical application
factor store. Production factor records should still be normalized into the
active app data model with explicit provenance, units, geography, year, gas/GWP
basis, method notes, and license/access constraints.

## Source Index Workflow

`manifest.json` is the reviewed source-release catalog for this folder. It
records source families, local file globs, intended uses, review status, license
review status, and whether a source is only indexed or already has an active
ingestion path.

Build the generated search index from `ghg-engine-prototype`:

```powershell
uv run python tools/index_ef_sources.py
```

The default output is `efs/index/ef_library.sqlite`. The generated SQLite index
captures source releases, files, workbook sheets, CSV headers, zip entries,
column names, inferred column semantics, and full-text search records. It does
not publish factors into the active Climate Metrix factor warehouse.

Use `--skip-hashes` for a faster structural scan when large archives are
already trusted locally:

```powershell
uv run python tools/index_ef_sources.py --skip-hashes
```

## Current Inventory

| Source | Local files | Coverage | Likely Climate Metrix use | Notes and caveats |
|---|---|---|---|---|
| [Ember Yearly Electricity Data](https://ember-energy.org/data/yearly-electricity-data/) | `Ember/yearly_full_release_long_format.csv` | Annual electricity generation, capacity, demand, emissions, and intensity data for global geographies. Local CSV has 371,021 lines and columns for area, year, category, variable, unit, and value. | Global electricity context, country-level electricity intensity fallback, trend analysis. | Updated frequently by Ember. Do not treat as a supplier-specific or residual-mix Scope 2 source. Confirm whether a location-based inventory method should prefer national/regional official factors before using this as default. |
| [EPA eGRID](https://www.epa.gov/egrid/detailed-data) | `epa/egrid2022_data.xlsx`, `epa/egrid2023_data_rev2.xlsx` | U.S. electric power plant, generator, balancing authority, state, national, and eGRID subregion data. Current local files include eGRID2022 and eGRID2023 Revision 2. | U.S. Scope 2 location-based electricity factors, electricity T&D loss support, plant/subregion lookup, power-sector analysis. | EPA pages still listed eGRID2023 Revision 2 as the latest detailed-data release checked on 2026-04-29; search did not find an eGRID2024 detailed release. Re-check before ingestion. |
| [EPA Supply Chain GHG Emission Factors for U.S. Commodities v1.4.0](https://zenodo.org/records/17202747) / [USEEIO](https://www.epa.gov/land-research/us-environmentally-extended-input-output-useeio-models) | `USEEIO/About the Supply Chain Greenhouse Gas Emission Factors v1.4.0.pdf`, `USEEIO/SupplyChainGHGEmissionFactorsv1.4.0.xlsx`, `USEEIO/SI_RelativeChangefromv1.3.0tov1.4.0inSEFs.xlsx`, `USEEIO/USEEIOv2.6.0-phoebe-23.rds` | U.S. commodity supply-chain factors. Zenodo describes factors as kg CO2e per USD 2024 output with AR6 GWP-100 applied, plus by-GHG factors before GWP. | Spend-based Scope 3 purchased goods and services and capital goods, especially where GL/commodity mappings are U.S.-centered. | Preserve the USD year, purchaser-price/output basis, margin treatment, gas basis, and model version. Avoid mixing with EXIOBASE without an explicit method choice. |
| [EXIOBASE 3.8.2](https://zenodo.org/records/5589597) | `EXIOBASE/3.8.2/IOT_2022_ixi.zip`, `EXIOBASE/3.8.2/IOT_2022_pxp.zip`, `EXIOBASE/3.8.2/MRSUT_2022.zip`, `EXIOBASE/3.8.2/*.txt` | Global environmentally extended multi-region input-output tables. Local 2022 archives contain ixi, pxp, and MRSUT forms. | Global spend-based analysis, non-U.S. Scope 3 fallback, cross-region MRIO comparisons. | Zenodo lists v3.8.2 as open and CC-BY-SA; local readme warns that later years rely on now-casting and different environmental extension end dates. Newer EXIOBASE v3.9+ releases have different license terms, so do not upgrade blindly. |
| Oregon DEQ placeholder | `odeq/` | No files currently present. | Reserved for Oregon-specific reporting and clean-fuels materials. | Good next fill: Oregon DEQ reported GHG data, GHG reporting factors, Clean Fuels carbon intensity values, and OR-GREET 4.0 materials. |

## Review Notes

- The library currently has good coverage for U.S. electricity, U.S. spend-based commodity factors, global MRIO, and global electricity context.
- The largest practical gaps are broad organization-reporting factors, waste/material management factors, market-based Scope 2 residual mixes, transportation models, fuel life-cycle carbon intensity sources, and Oregon-specific data.
- Keep raw source files versioned by provider and release year. Prefer paths like `epa/ghg-emission-factors-hub/2025/` or `green-e/residual-mix/2025/` rather than overwriting "latest" files.
- Before a source is used in calculations, record: source URL, access date, release/version, license, allowed use, factor year, geography, units, GWP assessment, biogenic treatment, lifecycle boundary, uncertainty/quality notes, and any transformations.
- Paid or restricted sources should not be added here unless the license is explicit and tracked. In particular, IEA emissions factor products are useful references but are not free/open datasets.

## Recommended Additions

Priority sources to add next:

| Priority | Source | Why add it | Suggested folder | Caveats |
|---|---|---|---|---|
| High | [EPA GHG Emission Factors Hub](https://www.epa.gov/climateleadership/ghg-emission-factors-hub) | Broad default factors for organizational reporting. EPA's 2025 update covers purchased electricity, mobile combustion, upstream/downstream transport, business travel, product transport, employee commuting, and T&D losses. | `epa/ghg-emission-factors-hub/2025/` | Best as a default-factor library, not a substitute for source-specific measured data. Version annually. |
| High | [EPA Waste Reduction Model, WARM](https://www.epa.gov/waste-reduction-model/versions-waste-reduction-model) | Waste and materials management factors for recycling, composting, anaerobic digestion, combustion, landfilling, source reduction, and reuse pathways. | `epa/warm/v16/` | EPA describes WARM as comparative/screening oriented. Do not use as final inventory waste methodology without documenting the accounting choice. |
| High | [IPCC EFDB](https://www.ipcc.ch/working-group/tfi/) and [2019 Refinement](https://www.ipcc.ch/report/2019-refinement-to-the-2006-ipcc-guidelines-for-national-greenhouse-gas-inventories/) | Global default emission factors and parameters, especially for stationary combustion, fugitive emissions, IPPU, AFOLU, waste, and country-method fallback. | `ipcc/efdb/`, `ipcc/2019-refinement/` | EFDB is a library of factors and parameters, not a single harmonized factor set. Selection rules and quality scoring matter. |
| High | [Green-e Residual Mix Emissions Rates](https://resource-solutions.org/residual-mix/) | U.S. residual mix rates for unspecified electricity when market-based Scope 2 evidence is missing. | `green-e/residual-mix/2025/` | Only adjusts for Green-e certified sales, not all specified electricity. Use only within a clear Scope 2 market-based hierarchy. |
| High | [Oregon DEQ GHG reported emissions](https://www.oregon.gov/deq/ghgp/pages/ghg-emissions.aspx) and [Oregon Clean Fuels CI values](https://www.oregon.gov/deq/ghgp/cfp/pages/clean-fuel-pathways.aspx) | Oregon-specific facility, fuel, natural gas, electricity-supplier, and Clean Fuels carbon-intensity material. This fills the empty `odeq/` folder. | `odeq/ghg-reporting/2024/`, `odeq/clean-fuels/2025/` | Clean Fuels CI values are lifecycle transportation-fuel program values, not generic corporate inventory factors. |
| Medium | [UK DESNZ GHG Conversion Factors](https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025) | Broad, well-documented factors for fuels, vehicles, flights, freight, hotels, materials, and other reporting categories. Includes a flat file for automation. | `uk/desnz/2025/` | UK-centered assumptions. Useful international fallback, but do not override better local official factors. |
| Medium | [AIB European Residual Mix](https://www.aib-net.org/facts/european-residual-mix) | European residual mix and attribute mix data for market-based Scope 2. | `aib/residual-mix/2024/` | AIB FAQ notes direct emissions only; no lifecycle calculation and no biogenic carbon emissions. |
| Medium | [NREL Cambium](https://www.nrel.gov/analysis/cambium) | U.S. forward-looking hourly grid emissions and cost metrics for scenario and avoided-emissions analysis. | `nrel/cambium/2024/` | Scenario/projection data, not a historical inventory default. Keep separate from eGRID. |
| Medium | [EPA MOVES5](https://www.epa.gov/moves/latest-version-motor-vehicle-emission-simulator-moves) | On-road and nonroad mobile-source emission modeling at national, county, and project scales. | `epa/moves/5.0.1/` | Model outputs depend heavily on inputs, geography, fleet, fuel, speed, and year. Store both model version and run configuration. |
| Medium | [Argonne/DOE R&D GREET](https://www.energy.gov/cmei/rd-greet-life-cycle-assessment-model) | Fuel, vehicle, hydrogen, SAF, chemical, and materials lifecycle modeling. | `argonne/greet/2025/` | GREET has multiple variants for different regulatory programs. Use the variant that matches the accounting purpose. |
| Medium | [CARB LCFS Certified Carbon Intensities](https://ww2.arb.ca.gov/resources/documents/lcfs-pathway-certified-carbon-intensities) and [CA-GREET](https://ww2.arb.ca.gov/resources/documents/lcfs-life-cycle-analysis-models-and-documentation) | Certified fuel pathway carbon intensities and California-specific fuel LCA models. | `carb/lcfs/2025/` | Program-specific lifecycle CI values in gCO2e/MJ. Do not mix with combustion-only fuel factors without clear boundary labels. |
| Medium | [EPA GHGRP data sets](https://www.epa.gov/ghgreporting/data-sets) | Facility-level and unit/fuel-level reported emissions data for large U.S. sources and suppliers. | `epa/ghgrp/2023/` | Reported emissions data, not generic emission factors. Useful for benchmarking, facility matching, and QA. |
| Medium | [EPA State Inventory Tool](https://www.epa.gov/statelocalenergy/download-state-inventory-and-projection-tool) and [Local GHG Inventory Tool](https://www.epa.gov/statelocalenergy/download-local-greenhouse-gas-inventory-tool) | Spreadsheet modules with default factors and methods for state and local inventories. | `epa/state-inventory-tool/2025/`, `epa/local-ghg-inventory-tool/2025/` | Aggregated state/local inventory methods. Use carefully for corporate facility-level accounting. |
| Lower | [Australia National Greenhouse Accounts Factors](https://www.dcceew.gov.au/climate-change/publications/national-greenhouse-accounts-factors-2025) | Annual official Australian factors and methods, including electricity scope 2 and 3 updates. | `au/nga-factors/2025/` | Australia-specific. Not for NGER statutory reporting unless the relevant NGER requirements are separately followed. |
| Lower | [New Zealand Measuring Emissions Guide](https://environment.govt.nz/what-you-can-do/calculate-your-emissions/measuring-emissions-guide/) | Annual organization-reporting factors, catalogue, flat file, and workbook for New Zealand. | `nz/mfe-measuring-emissions/2025/` | New Zealand-specific. Useful for NZ operations and as a well-documented international reference. |
| Lower | [ADEME Base Carbone](https://data.ademe.fr/datasets/base-carboner) | Public French emissions-factor database with open-license metadata and CSV export. | `fr/ademe-base-carbone/` | French-language source. Requires careful field mapping and source-language metadata preservation. |

## Suggested Triage Order

1. Add EPA GHG Emission Factors Hub 2025 and WARM v16 for immediate Scope 1, Scope 3 category 3, travel, freight, commuting, and waste coverage.
2. Fill `odeq/` with Oregon DEQ GHG reporting and Clean Fuels CI files because the folder already exists and the project likely has regional use cases.
3. Add Green-e and AIB residual mixes before implementing market-based Scope 2 fallback logic.
4. Add IPCC EFDB/2019 Refinement for global defaults and methodology backstops.
5. Add MOVES, GREET, CARB LCFS/CA-GREET, and NREL Cambium only when the app has a modeled transportation, fuel LCA, or scenario-analysis workflow ready to preserve run inputs and assumptions.
