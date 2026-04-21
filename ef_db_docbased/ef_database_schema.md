# Climate-Metrix Emission Factor Database — Schema Reference

**Version:** 0.1-draft
**Date:** April 14, 2026
**Database Engine:** MongoDB (Community Edition or Atlas)
**Database Name:** `climate_metrix`

---

## Design Principles

1. **Physical truth over reporting convention.** Factor documents describe the relationship between an activity input and a greenhouse gas output. GHG Protocol scope, reporting category, and framework assignments live in the application layer, not here.

2. **One fact, one document.** Each factor value exists exactly once. If gasoline CO₂ applies across Scopes 1, 3.4, and 3.7, it's stored once and referenced from multiple activity types.

3. **Selection-oriented structure.** Every field on a factor document exists to support one of two functions: (a) helping the application find the right factor, or (b) establishing provenance for audit purposes.

4. **Version without duplication.** When a source publishes updated values, the new factor is a new document linked to the same lineage. Historical calculations remain traceable to the factor version they used.

---

## Collections Overview

| Collection | Purpose | Approximate Size |
|---|---|---|
| `emission_factors` | Core factor values with full provenance | ~600+ documents |
| `sources` | Reference data for publishing organizations | ~15 documents |
| `grid_regions` | eGRID subregion geography and state mappings | ~30 documents |
| `ghg_metadata` | Gas properties, GWP values by assessment report | ~200 documents |
| `unit_definitions` | Canonical unit metadata and conversion factors | ~40 documents |
| `activity_types` | Reporting-context mappings (app layer, included for completeness) | ~50+ documents |

---

## Collection: `emission_factors`

This is the primary collection. Each document represents a single emission factor value from a single source for a single data year.

### Full Document Schema

```json
{
  "_id": ObjectId("..."),

  "lineage_id": "tcr::natural-gas::co2-ef::us-weighted-avg",
  "factor_key": "natural-gas_kg-per-mmbtu_us-weighted-avg_co2-ef_tcr_d2024_r2024",

  "classification": {
    "domain": "combustion",
    "class": "energy",
    "type": "natural-gas",
    "subtype": "us-weighted-avg",
    "life_cycle_stage": "direct"
  },

  "geography": {
    "region": "North America",
    "country": "USA",
    "state": null,
    "grid_region_code": null,
    "geographic_specificity": "national"
  },

  "factor": {
    "attribute": "co2-ef",
    "greenhouse_gas": "co2",
    "value": 53.06,
    "unit_label": "kg/mmbtu",
    "unit_numerator": "kg",
    "unit_denominator": "mmbtu",
    "unit_basis": "energy"
  },

  "provenance": {
    "source_id": "tcr",
    "source_detail": "Table 1.1 U.S. Default Factors for Calculating CO2 Emissions from Combustion of Fossil Fuel and Biomass",
    "confidence_level": "high",
    "data_year": 2024,
    "report_year": 2024,
    "is_complete": true
  },

  "versioning": {
    "version": 1,
    "is_current": true,
    "superseded_by": null,
    "supersedes": null
  },

  "maintenance": {
    "status": "verified",
    "review_cycle": "annual",
    "next_review_date": "2026-01-15",
    "last_verified_date": "2025-04-01",
    "last_verified_by": null,
    "notes": null
  },

  "related_factors": [
    {
      "relationship": "unit_variant",
      "lineage_id": "tcr::natural-gas::co2-ef::us-weighted-avg::per-scf",
      "description": "Same factor expressed in kg/scf (volume basis)"
    },
    {
      "relationship": "same_fuel_different_gas",
      "lineage_id": "tcr::natural-gas::ch4-ef::energy-industry-default",
      "description": "CH4 factor for same fuel type"
    }
  ],

  "tags": [],
  "created_at": "2025-04-14T00:00:00Z",
  "updated_at": "2025-04-14T00:00:00Z"
}
```

### Field Reference

#### Root Identifiers

| Field | Type | Required | Purpose |
|---|---|---|---|
| `_id` | ObjectId | Auto | MongoDB's internal immutable reference. Used as the durable pointer in calculation records, API responses, and cross-collection joins. Never changes. |
| `lineage_id` | String | Yes | Stable identifier for the "same factor across time." Format: `{source}::{type}::{attribute}::{description_variant}`. Does NOT include year — all annual vintages of a given factor share the same lineage_id. Indexed, unique when combined with `provenance.data_year`. |
| `factor_key` | String | Yes | Human-readable composite key matching the current spreadsheet's `factor_name_full`. Unique per document. Preserved for backward compatibility and manual lookup. |

**How IDs work together:**
- `_id` → machine reference, never exposed to users, never changes
- `lineage_id` → "which factor is this, regardless of vintage?" Used to query the latest version of a recurring factor.
- `factor_key` → "which specific row from the spreadsheet is this?" Bridging key for migration and human debugging.

#### `classification` — What physical process does this factor describe?

| Field | Type | Required | Description |
|---|---|---|---|
| `domain` | String | Yes | The physical/chemical process producing emissions. Controlled vocabulary — see below. |
| `class` | String | Yes | Broad material class. Carried forward from current schema. |
| `type` | String | Yes | Specific fuel, gas, mode, or material. E.g., `natural-gas`, `diesel`, `hfc`, `electricity`. |
| `subtype` | String | No | Variant or blend specification. E.g., `us-weighted-avg`, `distillate-fuel-oil-2`, `motor-gasoline-default`, `mixed-electric-power`. |
| `life_cycle_stage` | String | No | Which part of the life cycle this factor covers. Controlled vocabulary — see below. |

**`domain` controlled vocabulary:**

| Value | Replaces (current `emission-category`) | Meaning |
|---|---|---|
| `combustion` | `stationary-energy`, `mobile-combustion` | Burning fuel — stationary or mobile. The factor doesn't care which. |
| `electricity-generation` | `stationary-energy` (electricity rows) | Grid-delivered electricity and associated generation emissions. |
| `refrigerant-release` | `fugitive-emission` | Release of fluorinated gases (HFCs, PFCs, HCFCs, etc.). |
| `freight-transport` | `3.4-upstream-transportation-distribution` | Movement of goods by any mode. |
| `passenger-transport` | `3.6-business-travel`, `3.7-employee-commute` | Movement of people by any mode. |
| `waste-decomposition` | `3.5-waste-operations` | Landfill or treatment process emissions. |
| `industrial-process` | (future) | Process emissions from cement, steel, chemicals, etc. |
| `land-use` | (future) | Agriculture, forestry, land-use-change. |

Note: `combustion` deliberately merges stationary and mobile. The physical chemistry of burning gasoline doesn't change based on whether it's a generator or a truck. If the application needs to distinguish stationary vs. mobile, it does so at the activity layer.

**`life_cycle_stage` controlled vocabulary:**

| Value | Description |
|---|---|
| `direct` | Emissions at the point of combustion or release. Replaces `smokestack\|tailpipe`. |
| `upstream` | Well-to-tank / cradle-to-gate emissions from fuel extraction, processing, and delivery. |
| `downstream` | Post-use emissions (rare for most factor types). |
| `full_life_cycle` | Cradle-to-grave factor inclusive of all stages. |
| `generation` | For electricity: emissions at the power plant. |
| `delivered` | For electricity: generation + T&D losses. |

#### `geography` — Where does this factor apply?

| Field | Type | Required | Description |
|---|---|---|---|
| `region` | String | Yes | Continental region. E.g., `North America`, `Europe`. |
| `country` | String | Yes | ISO-style country code or name. E.g., `USA`, `UK`. |
| `state` | String | No | State/province. Populated when the factor is state-specific. |
| `grid_region_code` | String | No | eGRID subregion code (e.g., `CAMX`, `NWPP`, `ERCT`). Only for electricity-generation factors. References `grid_regions` collection. |
| `geographic_specificity` | String | Yes | How localized this factor is. One of: `global`, `national`, `regional`, `subregion`, `state`, `site`. Used by the app to select the most granular available factor. |

**Selection logic note:** When multiple factors match a query at different specificity levels, the application should prefer the most specific available. E.g., if a `subregion`-level electricity factor exists for the user's location, prefer it over a `national` average. The `geographic_specificity` field enables this ranking without complex geographic joins.

#### `factor` — The actual value

| Field | Type | Required | Description |
|---|---|---|---|
| `attribute` | String | Yes | What the factor measures. E.g., `co2-ef`, `ch4-ef`, `n2o-ef`, `co2e-ef`, `heat-content`, `gwp-100-ar6`, `T&D-loss`, `energy-intensity`, `mpg`. |
| `greenhouse_gas` | String | Yes | The specific gas, or `-` for non-GHG attributes like heat content. E.g., `co2`, `ch4`, `n2o`, `co2e`, `hfc_134a`, `-`. |
| `value` | Number | Yes | The numeric factor value. |
| `unit_label` | String | Yes | Human-readable compound unit. E.g., `kg/mmbtu`, `lb/MWh`, `g/gal`, `btu/scf`, `gwp-100`, `unitless`. |
| `unit_numerator` | String | Yes | The numerator unit (what you're measuring). E.g., `kg`, `g`, `lb`, `btu`, `mmbtu`, `kWh`. |
| `unit_denominator` | String | No | The denominator unit (per what). E.g., `mmbtu`, `gal`, `MWh`, `scf`, `short-ton-mile`, `passenger-mile`. Null for dimensionless values like GWP. |
| `unit_basis` | String | Yes | The measurement basis family. One of: `energy`, `volume`, `mass`, `distance`, `area`, `dimensionless`. Enables the app to quickly filter to the unit family it needs. |

#### `provenance` — Where did this value come from?

| Field | Type | Required | Description |
|---|---|---|---|
| `source_id` | String | Yes | Foreign key to the `sources` collection. E.g., `tcr`, `epa`, `ipcc`, `egrid`. |
| `source_detail` | String | No | Specific table, page, or section within the source. E.g., `Table 1.1 U.S. Default Factors for Calculating CO2 Emissions...` |
| `confidence_level` | String | Yes | One of: `high`, `moderate`, `low`. |
| `data_year` | Integer | Yes | The year the underlying data represents. |
| `report_year` | Integer | No | The publication year of the source document. May differ from `data_year` (e.g., 2024 eGRID data published in 2025). |
| `is_complete` | Boolean | Yes | Whether this factor has been fully validated. `false` for provisional or partially-sourced entries. |

**Audit trail note:** The combination of `source_id` + `source_detail` + `data_year` constitutes the full citation. An auditor can follow `source_id` → `sources` collection → `base_url` to reach the original publication, then use `source_detail` to locate the specific table or page. The `data_year` / `report_year` distinction captures the common pattern where EPA publishes 2024-vintage data in a 2025 report.

#### `versioning` — Factor history tracking

| Field | Type | Required | Description |
|---|---|---|---|
| `version` | Integer | Yes | Incrementing version number within a lineage. |
| `is_current` | Boolean | Yes | `true` for the active version. Only one document per `lineage_id` should have `is_current: true`. |
| `superseded_by` | ObjectId | No | Points to the newer version's `_id`, if this factor has been updated. |
| `supersedes` | ObjectId | No | Points to the older version's `_id`. Creates a doubly-linked version chain. |

**Version workflow:** When 2025 TCR factors are published:
1. Insert new document with `version: 2`, `is_current: true`, new `data_year`.
2. Update old document: set `is_current: false`, set `superseded_by` to new document's `_id`.
3. Set new document's `supersedes` to old document's `_id`.
4. Any historical calculation that referenced the old `_id` retains its audit trail.

#### `maintenance` — Operational upkeep tracking

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | String | Yes | One of: `verified`, `needs-review`, `needs-update`, `deprecated`. |
| `review_cycle` | String | No | How often this factor should be checked. E.g., `annual`, `biennial`, `on-publication`. |
| `next_review_date` | Date | No | When this factor next needs review. |
| `last_verified_date` | Date | No | When someone last confirmed the value against its source. |
| `last_verified_by` | String | No | Who performed the last verification (user ID or name). |
| `notes` | String | No | Free-text maintenance notes. |

#### `related_factors` — Explicit cross-references

| Field | Type | Description |
|---|---|---|
| `relationship` | String | One of: `unit_variant` (same factor in different units), `same_fuel_different_gas` (CO₂/CH₄/N₂O siblings), `heat_content` (the energy conversion factor for this fuel), `regional_variant` (same factor for a different geography). |
| `lineage_id` | String | The related factor's lineage_id. |
| `description` | String | Human-readable note about the relationship. |

---

## Collection: `sources`

Reference data for each publishing organization or dataset. Eliminates repetition of source metadata across factor documents.

```json
{
  "_id": "tcr",
  "name": "The Climate Registry",
  "short_name": "TCR",
  "organization_type": "registry",
  "base_url": "https://theclimateregistry.org/registries-resources/protocols/",
  "tables": [
    {
      "ref": "Table 1.1",
      "title": "U.S. Default Factors for Calculating CO2 Emissions from Combustion of Fossil Fuel and Biomass",
      "covers_attributes": ["co2-ef", "heat-content"],
      "covers_domains": ["combustion"]
    },
    {
      "ref": "Table 1.9",
      "title": "U.S. Default Factors for Calculating CH4 and N2O Emissions by Fuel Type",
      "covers_attributes": ["ch4-ef", "n2o-ef"],
      "covers_domains": ["combustion"]
    }
  ],
  "update_frequency": "annual",
  "typical_publication_month": 3,
  "last_checked": "2025-04-01",
  "notes": "Publishes protocol updates annually. Tables updated based on EPA and EIA source data."
}
```

```json
{
  "_id": "egrid",
  "name": "EPA Emissions & Generation Resource Integrated Database",
  "short_name": "eGRID",
  "organization_type": "government-database",
  "base_url": "https://www.epa.gov/egrid",
  "tables": [
    {
      "ref": "SRL (Subregion Level)",
      "title": "eGRID Subregion-Level Emission Rates",
      "covers_attributes": ["co2-ef", "ch4-ef", "n2o-ef"],
      "covers_domains": ["electricity-generation"]
    }
  ],
  "update_frequency": "annual",
  "typical_publication_month": 1,
  "last_checked": "2025-04-01",
  "notes": "Data typically lags 2 years. 2022 data published Jan 2024."
}
```

```json
{
  "_id": "epa",
  "name": "Environmental Protection Agency",
  "short_name": "EPA",
  "organization_type": "government-agency",
  "base_url": "https://www.epa.gov/climateleadership/ghg-emission-factors-hub",
  "tables": [
    {
      "ref": "GHG Emission Factors Hub",
      "title": "EPA GHG Emission Factors Hub",
      "covers_attributes": ["co2-ef", "ch4-ef", "n2o-ef", "co2e-ef"],
      "covers_domains": ["combustion", "freight-transport", "passenger-transport", "waste-decomposition"]
    }
  ],
  "update_frequency": "annual",
  "typical_publication_month": 4,
  "last_checked": "2025-04-01",
  "notes": null
}
```

```json
{
  "_id": "ipcc",
  "name": "Intergovernmental Panel on Climate Change",
  "short_name": "IPCC",
  "organization_type": "international-body",
  "base_url": "https://www.ipcc.ch/",
  "tables": [
    {
      "ref": "AR6 Annex III",
      "title": "Global Warming Potentials - Sixth Assessment Report",
      "covers_attributes": ["gwp-100-ar6"],
      "covers_domains": ["refrigerant-release"]
    }
  ],
  "update_frequency": "per-assessment-cycle",
  "typical_publication_month": null,
  "last_checked": "2025-04-01",
  "notes": "Assessment reports published roughly every 7 years. AR6 published 2021-2023."
}
```

---

## Collection: `grid_regions`

Maps eGRID subregion codes to geography, enabling the application to resolve a user's state to the appropriate electricity factor.

```json
{
  "_id": "CAMX",
  "subregion_name": "WECC California",
  "nerc_region": "WECC",
  "applicable_states": ["CA"],
  "egrid_data_year": 2022,
  "notes": null
}
```

```json
{
  "_id": "NWPP",
  "subregion_name": "WECC Northwest",
  "nerc_region": "WECC",
  "applicable_states": ["WA", "OR", "ID", "MT", "WY", "NV", "UT"],
  "egrid_data_year": 2022,
  "notes": "Some states span multiple subregions. Application should use ZIP-to-subregion mapping for precision."
}
```

```json
{
  "_id": "ERCT",
  "subregion_name": "ERCOT All",
  "nerc_region": "ERCOT",
  "applicable_states": ["TX"],
  "egrid_data_year": 2022,
  "notes": "Covers most of Texas. Small portions of TX fall under WECC or SPP."
}
```

**Usage note:** Some states span multiple eGRID subregions. For initial implementation, state-level mapping is sufficient. For precision, a ZIP-code-to-subregion lookup can be added later without changing the factor schema.

---

## Collection: `ghg_metadata`

Properties of individual greenhouse gases, including GWP values by IPCC assessment report. Separated from emission factors because GWPs change only when a new AR is published (roughly every 7 years) and are referenced across all factor types.

```json
{
  "_id": "co2",
  "name": "Carbon Dioxide",
  "chemical_formula": "CO2",
  "category": "kyoto-direct",
  "gwp": {
    "ar4_100yr": 1,
    "ar5_100yr": 1,
    "ar6_100yr": 1
  },
  "is_kyoto_gas": true,
  "notes": "Reference gas. GWP is 1 by definition."
}
```

```json
{
  "_id": "hfc_134a",
  "name": "HFC-134a",
  "chemical_formula": "CH2FCF3",
  "category": "hfc",
  "gwp": {
    "ar4_100yr": 1430,
    "ar5_100yr": 1300,
    "ar6_100yr": 1526
  },
  "is_kyoto_gas": true,
  "cas_number": "811-97-2",
  "common_applications": ["automotive-ac", "commercial-refrigeration", "foam-blowing"],
  "notes": null
}
```

```json
{
  "_id": "ch4",
  "name": "Methane",
  "chemical_formula": "CH4",
  "category": "kyoto-direct",
  "gwp": {
    "ar4_100yr": 25,
    "ar5_100yr": 28,
    "ar6_100yr": 27.9
  },
  "is_kyoto_gas": true,
  "includes_carbon_cycle_feedback": {
    "ar5_with_feedback": 34,
    "ar6_with_feedback": 29.8
  },
  "notes": "GWP varies significantly depending on whether carbon-cycle feedbacks are included. GHG Protocol currently uses AR5 without feedback (28). Some frameworks are transitioning to AR6."
}
```

---

## Collection: `unit_definitions`

Canonical metadata for each unit, supporting programmatic unit conversion in the application layer.

```json
{
  "_id": "mmbtu",
  "name": "Million British Thermal Units",
  "symbol": "MMBtu",
  "dimension": "energy",
  "si_equivalent": 1055055852.62,
  "si_unit": "joule",
  "conversion_to_si": 1055055852.62,
  "notes": "1 MMBtu = 1,000,000 Btu. Common US energy unit for natural gas and fuel heat content."
}
```

```json
{
  "_id": "kg",
  "name": "Kilogram",
  "symbol": "kg",
  "dimension": "mass",
  "si_equivalent": 1,
  "si_unit": "kilogram",
  "conversion_to_si": 1,
  "notes": null
}
```

```json
{
  "_id": "short_ton",
  "name": "Short Ton",
  "symbol": "short ton",
  "dimension": "mass",
  "si_equivalent": 907.185,
  "si_unit": "kilogram",
  "conversion_to_si": 907.185,
  "notes": "US ton. 2,000 lb. Not to be confused with metric tonne (1,000 kg) or long ton (2,240 lb)."
}
```

---

## Collection: `activity_types` (Application Layer)

This collection lives in the climate-metrix application database, not the emission factor reference database. Included here to show the complete picture of how scope, framework, and reporting category are handled.

Each activity type defines a reporting context and contains the query template for finding the appropriate emission factor(s).

```json
{
  "_id": "fleet-vehicle-gasoline",
  "activity_name": "Company Fleet Gasoline Consumption",
  "description": "Direct combustion of gasoline in company-owned or controlled vehicles.",

  "reporting": {
    "ghg_scope": "scope-1",
    "ghg_subcategory": "1.1-mobile-combustion",
    "frameworks": {
      "ghg_protocol": { "category": "scope-1", "guidance": "Mobile Combustion" },
      "tcr": { "category": "mobile-combustion", "protocol_section": "Chapter 8" },
      "iso_14064": { "category": "direct-ghg-mobile", "clause": "6.2" }
    }
  },

  "factor_selection": {
    "primary_query": {
      "domain": "combustion",
      "type": "gasoline",
      "attribute": { "$in": ["co2-ef", "ch4-ef", "n2o-ef"] },
      "life_cycle_stage": "direct",
      "unit_basis": "volume"
    },
    "supplementary_queries": [
      {
        "purpose": "heat_content_for_energy_conversion",
        "query": {
          "domain": "combustion",
          "type": "gasoline",
          "attribute": "heat-content"
        }
      }
    ],
    "geographic_preference": "most_specific_available",
    "vintage_preference": "match_report_year"
  },

  "input_units": {
    "expected": "gallons",
    "alternatives": ["mmbtu", "therms"]
  },

  "output": {
    "gases": ["co2", "ch4", "n2o"],
    "rollup": "co2e",
    "gwp_source_preference": "ar6_100yr"
  }
}
```

```json
{
  "_id": "employee-commute-gasoline",
  "activity_name": "Employee Commute — Personal Gasoline Vehicle",
  "description": "Gasoline combustion in employee-owned vehicles used for commuting.",

  "reporting": {
    "ghg_scope": "scope-3",
    "ghg_subcategory": "3.7-employee-commuting",
    "frameworks": {
      "ghg_protocol": { "category": "scope-3-category-7", "guidance": "Employee Commuting" },
      "tcr": { "category": "optional-scope-3", "protocol_section": "Chapter 15" },
      "iso_14064": { "category": "indirect-ghg-transport", "clause": "6.5.7" }
    }
  },

  "factor_selection": {
    "primary_query": {
      "domain": "combustion",
      "type": "gasoline",
      "attribute": { "$in": ["co2-ef", "ch4-ef", "n2o-ef"] },
      "life_cycle_stage": "direct",
      "unit_basis": "volume"
    },
    "geographic_preference": "most_specific_available",
    "vintage_preference": "match_report_year"
  },

  "input_units": {
    "expected": "gallons",
    "alternatives": ["miles"]
  },

  "output": {
    "gases": ["co2", "ch4", "n2o"],
    "rollup": "co2e",
    "gwp_source_preference": "ar6_100yr"
  }
}
```

Note: Both activity types above query the **exact same factors** from `emission_factors`. The scope and framework context differ, but the physical emission factor does not.

```json
{
  "_id": "purchased-electricity",
  "activity_name": "Purchased Grid Electricity",
  "description": "Electricity purchased from the grid for facility operations.",

  "reporting": {
    "ghg_scope": "scope-2",
    "ghg_subcategory": "2.1-purchased-electricity",
    "frameworks": {
      "ghg_protocol": { "category": "scope-2", "guidance": "Scope 2 Guidance, Location-Based" },
      "tcr": { "category": "indirect-electricity", "protocol_section": "Chapter 10" },
      "iso_14064": { "category": "indirect-ghg-energy", "clause": "6.3" }
    }
  },

  "factor_selection": {
    "primary_query": {
      "domain": "electricity-generation",
      "type": "electricity",
      "attribute": { "$in": ["co2-ef", "ch4-ef", "n2o-ef"] },
      "life_cycle_stage": "generation"
    },
    "resolution_strategy": "resolve_grid_region_from_facility_state",
    "geographic_preference": "subregion",
    "vintage_preference": "most_recent_available"
  },

  "input_units": {
    "expected": "kWh",
    "alternatives": ["MWh"]
  },

  "output": {
    "gases": ["co2", "ch4", "n2o"],
    "rollup": "co2e",
    "gwp_source_preference": "ar6_100yr"
  }
}
```

---

## Recommended Indexes

```javascript
// Primary selection queries
db.emission_factors.createIndex({ "classification.domain": 1, "classification.type": 1, "factor.attribute": 1 })
db.emission_factors.createIndex({ "classification.type": 1, "factor.greenhouse_gas": 1, "provenance.data_year": -1 })

// Geographic lookups (especially electricity)
db.emission_factors.createIndex({ "geography.grid_region_code": 1, "factor.attribute": 1 })
db.emission_factors.createIndex({ "geography.country": 1, "geography.state": 1, "geography.geographic_specificity": 1 })

// Lineage and versioning
db.emission_factors.createIndex({ "lineage_id": 1, "versioning.is_current": 1 })
db.emission_factors.createIndex({ "lineage_id": 1, "provenance.data_year": -1 })

// Factor key (unique, backward compat)
db.emission_factors.createIndex({ "factor_key": 1 }, { unique: true })

// Maintenance workflow
db.emission_factors.createIndex({ "maintenance.status": 1, "maintenance.next_review_date": 1 })

// Source lookups
db.emission_factors.createIndex({ "provenance.source_id": 1 })

// Grid region state resolution
db.grid_regions.createIndex({ "applicable_states": 1 })
```

---

## JSON Schema Validation (MongoDB)

Apply to the `emission_factors` collection to enforce required fields and value constraints without sacrificing document flexibility.

```javascript
db.createCollection("emission_factors", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: [
        "lineage_id",
        "factor_key",
        "classification",
        "geography",
        "factor",
        "provenance",
        "versioning"
      ],
      properties: {
        lineage_id: { bsonType: "string" },
        factor_key: { bsonType: "string" },
        classification: {
          bsonType: "object",
          required: ["domain", "class", "type"],
          properties: {
            domain: {
              bsonType: "string",
              enum: [
                "combustion",
                "electricity-generation",
                "refrigerant-release",
                "freight-transport",
                "passenger-transport",
                "waste-decomposition",
                "industrial-process",
                "land-use",
                "conversion"
              ]
            },
            class: { bsonType: "string" },
            type: { bsonType: "string" },
            subtype: { bsonType: ["string", "null"] },
            life_cycle_stage: {
              bsonType: ["string", "null"],
              enum: ["direct", "upstream", "downstream", "full_life_cycle", "generation", "delivered", null]
            }
          }
        },
        geography: {
          bsonType: "object",
          required: ["country", "geographic_specificity"],
          properties: {
            geographic_specificity: {
              bsonType: "string",
              enum: ["global", "national", "regional", "subregion", "state", "site"]
            }
          }
        },
        factor: {
          bsonType: "object",
          required: ["attribute", "greenhouse_gas", "value", "unit_label", "unit_basis"],
          properties: {
            value: { bsonType: ["double", "int", "decimal"] },
            unit_basis: {
              bsonType: "string",
              enum: ["energy", "volume", "mass", "distance", "area", "dimensionless", "count"]
            }
          }
        },
        provenance: {
          bsonType: "object",
          required: ["source_id", "confidence_level", "data_year", "is_complete"],
          properties: {
            confidence_level: {
              bsonType: "string",
              enum: ["high", "moderate", "low"]
            },
            data_year: { bsonType: "int" },
            is_complete: { bsonType: "bool" }
          }
        },
        versioning: {
          bsonType: "object",
          required: ["version", "is_current"],
          properties: {
            version: { bsonType: "int" },
            is_current: { bsonType: "bool" }
          }
        }
      }
    }
  }
})
```

---

## Example Queries

### Find the current CO₂ factor for natural gas combustion

```javascript
db.emission_factors.findOne({
  "classification.domain": "combustion",
  "classification.type": "natural-gas",
  "factor.attribute": "co2-ef",
  "factor.unit_basis": "energy",
  "geography.country": "USA",
  "versioning.is_current": true
})
```

### Get all current factors for a fuel type (CO₂, CH₄, N₂O together)

```javascript
db.emission_factors.find({
  "classification.domain": "combustion",
  "classification.type": "diesel",
  "factor.attribute": { $in: ["co2-ef", "ch4-ef", "n2o-ef"] },
  "factor.unit_basis": "volume",
  "classification.life_cycle_stage": "direct",
  "versioning.is_current": true
}).sort({ "factor.greenhouse_gas": 1 })
```

### Resolve electricity factor for a facility in Oregon

```javascript
// Step 1: Find the eGRID subregion for Oregon
const region = db.grid_regions.findOne({ applicable_states: "OR" })

// Step 2: Get the electricity factors for that subregion
db.emission_factors.find({
  "classification.domain": "electricity-generation",
  "geography.grid_region_code": region._id,
  "factor.attribute": { $in: ["co2-ef", "ch4-ef", "n2o-ef"] },
  "versioning.is_current": true
})
```

### Find all factors needing review before next reporting cycle

```javascript
db.emission_factors.find({
  "maintenance.status": { $in: ["needs-review", "needs-update"] },
  "maintenance.next_review_date": { $lte: new Date("2026-03-01") }
}).sort({ "maintenance.next_review_date": 1 })
```

### Get the full version history of a factor

```javascript
db.emission_factors.find({
  "lineage_id": "tcr::natural-gas::co2-ef::us-weighted-avg"
}).sort({ "versioning.version": 1 })
```

### Look up GWP for CO₂-equivalent rollup

```javascript
const gas = db.ghg_metadata.findOne({ _id: "ch4" })
const gwp = gas.gwp.ar6_100yr  // 27.9
```

---

## Migration Notes

### Mapping current spreadsheet columns → new schema

| Current Column | New Location | Notes |
|---|---|---|
| `id` | dropped | Replaced by `_id` (auto), `lineage_id`, and `factor_key` |
| `region` | `geography.region` | Direct mapping |
| `country` | `geography.country` | Direct mapping |
| `subregion` | `geography.grid_region_code` or `grid_regions` | eGRID full names move to `grid_regions` collection |
| `state` | `geography.state` | Direct mapping |
| `emission-category` | `classification.domain` | Remapped to physics-based vocabulary. Scope removed. |
| `sector` | `classification.domain` (informing value) | Absorbed into domain logic |
| `subsector` | `classification.subtype` (if relevant) | Absorbed or dropped |
| `class` | `classification.class` | Direct mapping |
| `type` | `classification.type` | Direct mapping |
| `life-cycle-stage` | `classification.life_cycle_stage` | Remapped: `smokestack\|tailpipe` → `direct` |
| `description` | `classification.subtype` | Renamed for clarity |
| `attribute` | `factor.attribute` | Direct mapping |
| `greenhouse_gas` | `factor.greenhouse_gas` | Direct mapping |
| `value` | `factor.value` | Direct mapping, ensure numeric type |
| `unit_label` | `factor.unit_label` | Direct mapping |
| `unit_1` | `factor.unit_numerator` | Renamed |
| `unit_2` | `factor.unit_denominator` | Renamed |
| `data_year` | `provenance.data_year` | Moved under provenance |
| `source_entity` | `sources` collection (`name`) | Normalized out |
| `source_entity_short` | `provenance.source_id` → `sources._id` | Becomes foreign key |
| `factor_name_full` | `factor_key` | Preserved as unique human-readable key |
| `factor_short_name` | dropped | Redundant with structured fields |
| `factor_label` | dropped | Can be generated from structured fields |
| `confidence_level` | `provenance.confidence_level` | Moved under provenance |
| `last_updated` | `maintenance.last_verified_date` | Clarified meaning |
| `report_year` | `provenance.report_year` | Moved under provenance |
| `is_complete` | `provenance.is_complete` | Moved under provenance |
| `source_url` | `sources` collection (`base_url`) | Normalized out |
| `location_in_source` | `provenance.source_detail` | Renamed |
| `annual_maintenance` | `maintenance.status` | Expanded to structured object |
| `comment` | `maintenance.notes` | Renamed |
| `pmx_tools` | `tags[]` | Moved to flat tags array |
| `frameworks` | (removed from factor) | Moved to `activity_types.reporting.frameworks` |
| `eqms` | `tags[]` | Moved to flat tags array |
