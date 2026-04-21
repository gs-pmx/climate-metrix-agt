"""
Climate-Metrix EF Database Migration Script
============================================
Reads ef_database_2025.xlsx (EF Schema tab) and produces MongoDB-importable
JSON files for all collections defined in the schema reference.

Usage:
    python migrate_ef_database.py

Outputs (in ./output/):
    emission_factors.json   — core factor documents
    sources.json            — source/publisher reference documents
    grid_regions.json       — eGRID subregion geography
    ghg_metadata.json       — greenhouse gas properties & GWPs
    unit_definitions.json   — canonical unit metadata
    migration_report.json   — summary stats and any warnings
"""

import json
import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd

# ──────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────

INPUT_FILE = "/mnt/user-data/uploads/ef_database_2025.xlsx"
SHEET_NAME = "EF Schema"
OUTPUT_DIR = Path("/home/claude/output")
OUTPUT_DIR.mkdir(exist_ok=True)

NOW = datetime.now(timezone.utc).isoformat()

# ──────────────────────────────────────────────
# Mapping tables
# ──────────────────────────────────────────────

# emission-category + class → domain
DOMAIN_MAP = {
    ("stationary-energy", "energy", "electricity"): "electricity-generation",
    ("stationary-energy", "energy", "district-steam"): "combustion",
    ("stationary-energy", "energy", None): "combustion",
    ("mobile-combustion", "energy", None): "combustion",
    ("mobile-combustion", "fuel", None): "combustion",
    ("mobile-combustion", "vehicle", None): "passenger-transport",
    ("fugitive-emission", "refrigerant|fugitive", None): "refrigerant-release",
    ("3.4-upstream-transportation-distribution", "contracted-freight", None): "freight-transport",
    ("3.6-business-travel", "business-travel", None): "passenger-transport",
    ("3.7-employee-commute", "commute", None): "passenger-transport",
    ("3.5-waste-operations", "waste", None): "waste-decomposition",
}

LIFE_CYCLE_MAP = {
    "smokestack|tailpipe": "direct",
    "full-life-cycle": "full_life_cycle",
    "downstream": "downstream",
}

UNIT_BASIS_MAP = {
    "btu/scf": "energy",
    "kg/mmbtu": "energy",
    "mmbtu/short_ton": "energy",
    "mmbtu/gal": "energy",
    "btu/lb": "energy",
    "kWh/lb": "energy",
    "mj/gal": "energy",
    "btu/passenger_mile": "energy",
    "kg/gal": "volume",
    "g/gal": "volume",
    "kg/scf": "volume",
    "g/scf": "volume",
    "kg/kWh": "energy",
    "lb/MWh": "energy",
    "gwp-100": "dimensionless",
    "unitless": "dimensionless",
    "mi/gal": "volume",
    "g/mj": "energy",
    "g/mmbtu": "energy",
    "kg/short-ton-mile": "distance",
    "g/short-ton-mile": "distance",
    "kg/passenger-mile": "distance",
    "g/passenger-mile": "distance",
    "kg/short-ton": "mass",
    "g/short-ton": "mass",
    "metric-tons-co2e/short-ton": "mass",
    "unit": "dimensionless",
}

# eGRID subregion code → name + NERC region + state mappings
EGRID_REGIONS = {
    "AKGD": {"name": "ASCC Alaska Grid", "nerc": "ASCC", "states": ["AK"]},
    "AKMS": {"name": "ASCC Miscellaneous", "nerc": "ASCC", "states": ["AK"]},
    "AZNM": {"name": "WECC Southwest", "nerc": "WECC", "states": ["AZ", "NM"]},
    "CAMX": {"name": "WECC California", "nerc": "WECC", "states": ["CA"]},
    "ERCT": {"name": "ERCOT All", "nerc": "ERCOT", "states": ["TX"]},
    "FRCC": {"name": "FRCC All", "nerc": "FRCC", "states": ["FL"]},
    "HIMS": {"name": "HICC Miscellaneous", "nerc": "HICC", "states": ["HI"]},
    "HIOA": {"name": "HICC Oahu", "nerc": "HICC", "states": ["HI"]},
    "MROE": {"name": "MRO East", "nerc": "MRO", "states": ["WI", "MI", "IA"]},
    "MROW": {"name": "MRO West", "nerc": "MRO", "states": ["MN", "ND", "SD", "NE", "MT", "IA"]},
    "NEWE": {"name": "NPCC New England", "nerc": "NPCC", "states": ["CT", "MA", "ME", "NH", "RI", "VT"]},
    "NWPP": {"name": "WECC Northwest", "nerc": "WECC", "states": ["WA", "OR", "ID", "MT", "WY", "NV", "UT"]},
    "NYCW": {"name": "NPCC NYC/Westchester", "nerc": "NPCC", "states": ["NY"]},
    "NYLI": {"name": "NPCC Long Island", "nerc": "NPCC", "states": ["NY"]},
    "NYUP": {"name": "NPCC Upstate NY", "nerc": "NPCC", "states": ["NY"]},
    "PRMS": {"name": "Puerto Rico Miscellaneous", "nerc": "None", "states": ["PR"]},
    "RFCE": {"name": "RFC East", "nerc": "RFC", "states": ["PA", "NJ", "DE", "MD", "DC", "VA"]},
    "RFCM": {"name": "RFC Michigan", "nerc": "RFC", "states": ["MI"]},
    "RFCW": {"name": "RFC West", "nerc": "RFC", "states": ["OH", "IN", "WV", "KY"]},
    "RMPA": {"name": "WECC Rockies", "nerc": "WECC", "states": ["CO", "WY"]},
    "SPNO": {"name": "SPP North", "nerc": "SPP", "states": ["KS", "NE", "OK"]},
    "SPSO": {"name": "SPP South", "nerc": "SPP", "states": ["OK", "AR", "LA"]},
    "SRMV": {"name": "SERC Mississippi Valley", "nerc": "SERC", "states": ["AR", "LA", "MS", "MO"]},
    "SRMW": {"name": "SERC Midwest", "nerc": "SERC", "states": ["MO", "IL"]},
    "SRSO": {"name": "SERC South", "nerc": "SERC", "states": ["AL", "GA"]},
    "SRTV": {"name": "SERC Tennessee Valley", "nerc": "SERC", "states": ["TN", "KY", "VA", "NC", "GA"]},
    "SRVC": {"name": "SERC Virginia/Carolina", "nerc": "SERC", "states": ["VA", "NC", "SC"]},
}

# Sources reference data
SOURCES = {
    "tcr": {
        "name": "The Climate Registry",
        "short_name": "TCR",
        "organization_type": "registry",
        "base_url": "https://theclimateregistry.org/registries-resources/protocols/",
        "update_frequency": "annual",
        "typical_publication_month": 3,
    },
    "epa": {
        "name": "Environmental Protection Agency",
        "short_name": "EPA",
        "organization_type": "government-agency",
        "base_url": "https://www.epa.gov/climateleadership/ghg-emission-factors-hub",
        "update_frequency": "annual",
        "typical_publication_month": 4,
    },
    "egrid": {
        "name": "EPA Emissions & Generation Resource Integrated Database",
        "short_name": "eGRID",
        "organization_type": "government-database",
        "base_url": "https://www.epa.gov/egrid",
        "update_frequency": "annual",
        "typical_publication_month": 1,
    },
    "ipcc": {
        "name": "Intergovernmental Panel on Climate Change",
        "short_name": "IPCC",
        "organization_type": "international-body",
        "base_url": "https://www.ipcc.ch/",
        "update_frequency": "per-assessment-cycle",
        "typical_publication_month": None,
    },
    "greet": {
        "name": "R&D GREET Model (Argonne National Lab)",
        "short_name": "GREET",
        "organization_type": "national-lab-model",
        "base_url": "https://greet.anl.gov/",
        "update_frequency": "annual",
        "typical_publication_month": 10,
    },
    "desnz": {
        "name": "UK Department for Energy Security and Net Zero",
        "short_name": "DESNZ",
        "organization_type": "government-agency",
        "base_url": "https://www.gov.uk/government/organisations/department-for-energy-security-and-net-zero",
        "update_frequency": "annual",
        "typical_publication_month": 6,
    },
    "eia": {
        "name": "U.S. Energy Information Administration",
        "short_name": "EIA",
        "organization_type": "government-agency",
        "base_url": "https://www.eia.gov/",
        "update_frequency": "annual",
        "typical_publication_month": None,
    },
    "or-greet4.0": {
        "name": "Oregon GREET 4.0 Model",
        "short_name": "OR-GREET4.0",
        "organization_type": "state-model",
        "base_url": "https://www.oregon.gov/deq/ghgp/pages/default.aspx",
        "update_frequency": "periodic",
        "typical_publication_month": None,
    },
    "usdot": {
        "name": "U.S. Department of Transportation",
        "short_name": "USDOT",
        "organization_type": "government-agency",
        "base_url": "https://www.transportation.gov/",
        "update_frequency": "annual",
        "typical_publication_month": None,
    },
    "odeq": {
        "name": "Oregon Department of Environmental Quality",
        "short_name": "ODEQ",
        "organization_type": "state-agency",
        "base_url": "https://www.oregon.gov/deq/",
        "update_frequency": "annual",
        "typical_publication_month": None,
    },
    "afleet": {
        "name": "AFLEET Tool (Argonne National Lab)",
        "short_name": "AFLEET",
        "organization_type": "national-lab-model",
        "base_url": "https://afleet.es.anl.gov/",
        "update_frequency": "annual",
        "typical_publication_month": None,
    },
    "ecology": {
        "name": "Washington Department of Ecology",
        "short_name": "Ecology",
        "organization_type": "state-agency",
        "base_url": "https://ecology.wa.gov/",
        "update_frequency": "annual",
        "typical_publication_month": None,
    },
    "ornl": {
        "name": "Oak Ridge National Laboratory",
        "short_name": "ORNL",
        "organization_type": "national-lab",
        "base_url": "https://www.ornl.gov/",
        "update_frequency": "periodic",
        "typical_publication_month": None,
    },
    "epa-calculated": {
        "name": "EPA (Calculated/Derived)",
        "short_name": "EPA (calculated)",
        "organization_type": "derived",
        "base_url": "https://www.epa.gov/climateleadership/ghg-emission-factors-hub",
        "update_frequency": "annual",
        "typical_publication_month": None,
    },
}


# ──────────────────────────────────────────────
# Helper functions
# ──────────────────────────────────────────────

def clean(val):
    """Return None for NaN/empty, otherwise stripped string."""
    if pd.isna(val) or val == "" or val == "-":
        return None
    if isinstance(val, str):
        return val.strip()
    return val


def clean_numeric(val):
    """Return float or None."""
    if pd.isna(val):
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def clean_int(val):
    """Return int or None."""
    if pd.isna(val):
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None


def clean_bool(val):
    """Return bool or None."""
    if pd.isna(val):
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() in ("true", "yes", "1")
    return bool(val)


def resolve_domain(row):
    """Map emission-category + class + type → domain."""
    ecat = clean(row["emission-category"])
    cls = clean(row["class"])
    typ = clean(row["type"])

    # Check exact match with type first
    key_with_type = (ecat, cls, typ)
    if key_with_type in DOMAIN_MAP:
        return DOMAIN_MAP[key_with_type]

    # Then match without type
    key_without_type = (ecat, cls, None)
    if key_without_type in DOMAIN_MAP:
        return DOMAIN_MAP[key_without_type]

    return "unknown"


def resolve_life_cycle_stage(val):
    """Map spreadsheet life-cycle-stage → schema life_cycle_stage."""
    cleaned = clean(val)
    if cleaned is None:
        return None
    return LIFE_CYCLE_MAP.get(cleaned, cleaned)


def resolve_unit_basis(unit_label):
    """Determine the measurement basis family from the unit label."""
    if unit_label is None:
        return "dimensionless"
    ul = str(unit_label).strip().lower()
    # Try direct match
    for key, basis in UNIT_BASIS_MAP.items():
        if ul == key.lower():
            return basis
    # Heuristic fallbacks
    if "/gal" in ul or "/scf" in ul or "/liter" in ul:
        return "volume"
    if "/mmbtu" in ul or "/mwh" in ul or "/kwh" in ul or "/btu" in ul or "/mj" in ul:
        return "energy"
    if "/ton" in ul or "/lb" in ul or "/kg" in ul:
        return "mass"
    if "/mile" in ul or "/km" in ul:
        return "distance"
    return "dimensionless"


def resolve_unit_parts(unit_label):
    """Split unit_label into numerator and denominator."""
    if unit_label is None:
        return None, None
    ul = str(unit_label).strip()
    if "/" in ul:
        parts = ul.split("/", 1)
        return parts[0].strip(), parts[1].strip()
    return ul, None


def resolve_geographic_specificity(row, domain):
    """Determine how geographically specific this factor is."""
    state = clean(row.get("state"))
    grid_code = clean(row.get("description")) if domain == "electricity-generation" else None
    subregion = clean(row.get("subregion"))

    if state:
        return "state"
    if grid_code and domain == "electricity-generation":
        return "subregion"
    if subregion:
        return "regional"
    country = clean(row.get("country"))
    if country:
        return "national"
    return "global"


def resolve_source_id(val):
    """Normalize source_entity_short to a source_id key."""
    if pd.isna(val) or val is None:
        return None
    s = str(val).strip().lower()
    mapping = {
        "tcr": "tcr",
        "epa": "epa",
        "egrid": "egrid",
        "greet": "greet",
        "ipcc": "ipcc",
        "desnz": "desnz",
        "eia": "eia",
        "or-greet4.0": "or-greet4.0",
        "usdot": "usdot",
        "odeq": "odeq",
        "afleet": "afleet",
        "ecology": "ecology",
        "ornl": "ornl",
        "epa (calculated)": "epa-calculated",
    }
    return mapping.get(s, s)


def build_lineage_id(row, domain):
    """
    Build a stable lineage identifier that stays constant across data-year vintages.
    Format: {source}::{type}::{attribute}::{subtype}
    """
    source = resolve_source_id(row["source_entity_short"]) or "unknown"
    typ = clean(row["type"]) or "unknown"
    attr = clean(row["attribute"]) or "unknown"
    subtype = clean(row["description"]) or "default"

    # For electricity-generation, the grid region code is the key differentiator
    if domain == "electricity-generation":
        grid_code = subtype
        return f"{source}::{typ}::{attr}::{grid_code}"

    return f"{source}::{typ}::{attr}::{subtype}"


def build_factor_key(row):
    """Use existing factor_name_full or generate one."""
    existing = clean(row.get("factor_name_full"))
    if existing:
        return existing

    # Generate a key for rows missing factor_name_full
    typ = clean(row["type"]) or "unknown"
    ul = clean(row["unit_label"]) or "unit"
    desc = clean(row["description"]) or "default"
    attr = clean(row["attribute"]) or "factor"
    src = resolve_source_id(row["source_entity_short"]) or "unknown"
    dy = clean_int(row.get("data_year")) or ""
    ry = clean_int(row.get("report_year")) or ""

    parts = [typ, str(ul).replace("/", "-per-"), desc, attr, src]
    if dy:
        parts.append(f"d{dy}")
    if ry:
        parts.append(f"r{ry}")

    return "_".join(parts)


def resolve_maintenance_status(val):
    """Map annual_maintenance column to structured status."""
    cleaned = clean(val)
    if cleaned is None:
        return "needs-review"
    mapping = {
        "check": "needs-review",
        "update": "needs-update",
        "none": "verified",
    }
    return mapping.get(cleaned.lower(), "needs-review")


def make_oid_placeholder(seed_string):
    """
    Generate a deterministic hex string from seed for repeatable pseudo-ObjectId.
    In real MongoDB, _id would be auto-generated ObjectId.
    We use this for cross-references in the JSON output.
    """
    return hashlib.md5(seed_string.encode()).hexdigest()[:24]


# ──────────────────────────────────────────────
# Load and clean data
# ──────────────────────────────────────────────

print("Loading spreadsheet...")
df = pd.read_excel(INPUT_FILE, sheet_name=SHEET_NAME, header=None)
headers = df.iloc[4].tolist()
data = df.iloc[5:].copy()
data.columns = headers

# Drop echo header rows and empty rows
data = data[data["emission-category"].notna()]
data = data[data["emission-category"] != "emission-category"]
data = data[data["type"].notna()]

print(f"Loaded {len(data)} clean factor rows")

# ──────────────────────────────────────────────
# Build emission_factors collection
# ──────────────────────────────────────────────

print("Building emission_factors documents...")
factors = []
warnings = []
seen_keys = {}

for idx, (_, row) in enumerate(data.iterrows()):
    domain = resolve_domain(row)

    # Build factor key and handle duplicates
    factor_key = build_factor_key(row)
    if factor_key in seen_keys:
        seen_keys[factor_key] += 1
        factor_key = f"{factor_key}__dup{seen_keys[factor_key]}"
        warnings.append(f"Duplicate factor_key resolved: {factor_key}")
    else:
        seen_keys[factor_key] = 0

    lineage_id = build_lineage_id(row, domain)

    # Geography
    grid_region_code = None
    if domain == "electricity-generation":
        grid_region_code = clean(row["description"])

    geo_spec = resolve_geographic_specificity(row, domain)

    # Unit parsing
    unit_label = clean(row["unit_label"])
    # Handle the odd numeric unit_label values
    if isinstance(row["unit_label"], (int, float)) and not pd.isna(row["unit_label"]):
        unit_label = str(row["unit_label"])
        warnings.append(f"Row {idx}: numeric unit_label '{unit_label}' for {factor_key}")

    unit_num_raw = clean(row.get("unit_1"))
    unit_den_raw = clean(row.get("unit_2"))
    if unit_num_raw is None and unit_label:
        unit_num_raw, unit_den_raw = resolve_unit_parts(unit_label)

    # Maintenance
    maint_status = resolve_maintenance_status(row.get("annual_maintenance"))

    # Tags from pmx_tools / eqms
    tags = []
    pmx = clean(row.get("pmx_tools"))
    if pmx and pmx != "pmx_tools":
        tags.append(pmx)
    eqms = clean(row.get("eqms"))
    if eqms and eqms != "eqms":
        tags.append(eqms)

    # Provenance
    source_id = resolve_source_id(row.get("source_entity_short"))

    doc = {
        "_id": make_oid_placeholder(factor_key),
        "lineage_id": lineage_id,
        "factor_key": factor_key,

        "classification": {
            "domain": domain,
            "class": clean(row["class"]),
            "type": clean(row["type"]),
            "subtype": clean(row["description"]),
            "life_cycle_stage": resolve_life_cycle_stage(row.get("life-cycle-stage")),
        },

        "geography": {
            "region": clean(row.get("region")),
            "country": clean(row.get("country")),
            "state": clean(row.get("state")),
            "grid_region_code": grid_region_code,
            "geographic_specificity": geo_spec,
        },

        "factor": {
            "attribute": clean(row["attribute"]),
            "greenhouse_gas": clean(row["greenhouse_gas"]) if clean(row["greenhouse_gas"]) != "-" else None,
            "value": clean_numeric(row["value"]),
            "unit_label": unit_label,
            "unit_numerator": unit_num_raw,
            "unit_denominator": unit_den_raw,
            "unit_basis": resolve_unit_basis(unit_label),
        },

        "provenance": {
            "source_id": source_id,
            "source_detail": clean(row.get("location_in_source")),
            "confidence_level": clean(row.get("confidence_level")) or "moderate",
            "data_year": clean_int(row.get("data_year")),
            "report_year": clean_int(row.get("report_year")),
            "is_complete": clean_bool(row.get("is_complete")) if clean_bool(row.get("is_complete")) is not None else False,
        },

        "versioning": {
            "version": 1,
            "is_current": True,
            "superseded_by": None,
            "supersedes": None,
        },

        "maintenance": {
            "status": maint_status,
            "review_cycle": "annual",
            "next_review_date": "2026-01-15",
            "last_verified_date": None,
            "last_verified_by": None,
            "notes": clean(row.get("comment")),
        },

        "related_factors": [],
        "tags": tags,
        "created_at": NOW,
        "updated_at": NOW,
    }

    factors.append(doc)

print(f"  Built {len(factors)} emission_factor documents")


# ──────────────────────────────────────────────
# Build related_factors cross-references
# ──────────────────────────────────────────────

print("Building related_factors cross-references...")

lineage_index = {}
for f in factors:
    lid = f["lineage_id"]
    if lid not in lineage_index:
        lineage_index[lid] = []
    lineage_index[lid].append(f)

# Group factors by (domain, type, subtype, source) to find gas siblings and unit variants
grouping_index = {}
for f in factors:
    key = (
        f["classification"]["domain"],
        f["classification"]["type"],
        f["classification"]["subtype"],
        f["provenance"]["source_id"],
        f["provenance"]["data_year"],
    )
    if key not in grouping_index:
        grouping_index[key] = []
    grouping_index[key].append(f)

ref_count = 0
for key, group in grouping_index.items():
    if len(group) < 2:
        continue
    for f in group:
        for other in group:
            if other["_id"] == f["_id"]:
                continue
            if other["factor"]["attribute"] != f["factor"]["attribute"]:
                # Different attribute (e.g., co2-ef vs ch4-ef) = same_fuel_different_gas
                # But only link EF attributes, not heat-content to co2-ef
                f_is_ef = f["factor"]["attribute"].endswith("-ef")
                o_is_ef = other["factor"]["attribute"].endswith("-ef")
                if f_is_ef and o_is_ef:
                    ref = {
                        "relationship": "same_fuel_different_gas",
                        "lineage_id": other["lineage_id"],
                        "description": f"{other['factor']['greenhouse_gas']} factor for same fuel/source",
                    }
                    if ref not in f["related_factors"]:
                        f["related_factors"].append(ref)
                        ref_count += 1
                elif f_is_ef and other["factor"]["attribute"] == "heat-content":
                    ref = {
                        "relationship": "heat_content",
                        "lineage_id": other["lineage_id"],
                        "description": f"Heat content for {f['classification']['type']}",
                    }
                    if ref not in f["related_factors"]:
                        f["related_factors"].append(ref)
                        ref_count += 1

# Also link unit variants (same type + gas + source but different unit_basis)
unit_variant_index = {}
for f in factors:
    key = (
        f["classification"]["domain"],
        f["classification"]["type"],
        f["factor"]["attribute"],
        f["factor"]["greenhouse_gas"],
        f["provenance"]["source_id"],
        f["provenance"]["data_year"],
    )
    if key not in unit_variant_index:
        unit_variant_index[key] = []
    unit_variant_index[key].append(f)

for key, group in unit_variant_index.items():
    if len(group) < 2:
        continue
    bases = set(f["factor"]["unit_basis"] for f in group)
    if len(bases) < 2:
        continue
    for f in group:
        for other in group:
            if other["_id"] == f["_id"]:
                continue
            if other["factor"]["unit_basis"] != f["factor"]["unit_basis"]:
                ref = {
                    "relationship": "unit_variant",
                    "lineage_id": other["lineage_id"],
                    "description": f"Same factor in {other['factor']['unit_label']} ({other['factor']['unit_basis']} basis)",
                }
                if ref not in f["related_factors"]:
                    f["related_factors"].append(ref)
                    ref_count += 1

print(f"  Added {ref_count} cross-references")


# ──────────────────────────────────────────────
# Build sources collection
# ──────────────────────────────────────────────

print("Building sources documents...")

# Gather source_detail entries per source for the "tables" sub-docs
source_tables = {}
for f in factors:
    sid = f["provenance"]["source_id"]
    detail = f["provenance"]["source_detail"]
    attr = f["factor"]["attribute"]
    domain = f["classification"]["domain"]
    if sid and detail:
        if sid not in source_tables:
            source_tables[sid] = {}
        if detail not in source_tables[sid]:
            source_tables[sid][detail] = {"attributes": set(), "domains": set()}
        source_tables[sid][detail]["attributes"].add(attr)
        source_tables[sid][detail]["domains"].add(domain)

sources_docs = []
for sid, sdata in SOURCES.items():
    tables = []
    if sid in source_tables:
        for detail, meta in source_tables[sid].items():
            tables.append({
                "ref": detail[:80] if len(detail) > 80 else detail,
                "title": detail,
                "covers_attributes": sorted(meta["attributes"]),
                "covers_domains": sorted(meta["domains"]),
            })
    doc = {
        "_id": sid,
        "name": sdata["name"],
        "short_name": sdata["short_name"],
        "organization_type": sdata["organization_type"],
        "base_url": sdata["base_url"],
        "tables": tables,
        "update_frequency": sdata["update_frequency"],
        "typical_publication_month": sdata["typical_publication_month"],
        "last_checked": "2025-04-01",
        "notes": None,
    }
    sources_docs.append(doc)

print(f"  Built {len(sources_docs)} source documents")


# ──────────────────────────────────────────────
# Build grid_regions collection
# ──────────────────────────────────────────────

print("Building grid_regions documents...")

# Start with our predefined map, then add any codes found in data that we missed
found_codes = set()
for f in factors:
    code = f["geography"]["grid_region_code"]
    if code:
        found_codes.add(code)

grid_docs = []
for code, info in EGRID_REGIONS.items():
    grid_docs.append({
        "_id": code,
        "subregion_name": info["name"],
        "nerc_region": info["nerc"],
        "applicable_states": info["states"],
        "egrid_data_year": 2022,
        "notes": None,
    })

# Any codes in data but not in our map
missing_codes = found_codes - set(EGRID_REGIONS.keys())
for code in sorted(missing_codes):
    # Try to find the subregion name from the spreadsheet
    matching = [f for f in factors if f["geography"]["grid_region_code"] == code]
    subregion_name = None
    for m in matching:
        # The subregion column in original data had the full name
        # We'll pull it from the original dataframe
        pass
    grid_docs.append({
        "_id": code,
        "subregion_name": code,
        "nerc_region": "unknown",
        "applicable_states": [],
        "egrid_data_year": 2022,
        "notes": "Auto-generated during migration — needs manual review of state mappings.",
    })
    warnings.append(f"eGRID code '{code}' not in predefined map — needs manual state mapping")

print(f"  Built {len(grid_docs)} grid_region documents ({len(missing_codes)} need review)")


# ──────────────────────────────────────────────
# Build ghg_metadata collection
# ──────────────────────────────────────────────

print("Building ghg_metadata documents...")

# Extract GWP data from the refrigerant/fugitive rows
ghg_docs_map = {}

# First: standard gases
ghg_docs_map["co2"] = {
    "_id": "co2",
    "name": "Carbon Dioxide",
    "chemical_formula": "CO2",
    "category": "kyoto-direct",
    "gwp": {"ar4_100yr": 1, "ar5_100yr": 1, "ar6_100yr": 1},
    "is_kyoto_gas": True,
    "notes": "Reference gas. GWP is 1 by definition.",
}
ghg_docs_map["ch4"] = {
    "_id": "ch4",
    "name": "Methane",
    "chemical_formula": "CH4",
    "category": "kyoto-direct",
    "gwp": {"ar4_100yr": 25, "ar5_100yr": 28, "ar6_100yr": 27.9},
    "is_kyoto_gas": True,
    "notes": "GWP varies by AR version and whether carbon-cycle feedbacks are included.",
}
ghg_docs_map["n2o"] = {
    "_id": "n2o",
    "name": "Nitrous Oxide",
    "chemical_formula": "N2O",
    "category": "kyoto-direct",
    "gwp": {"ar4_100yr": 298, "ar5_100yr": 265, "ar6_100yr": 273},
    "is_kyoto_gas": True,
    "notes": None,
}

# Extract GWPs from the fugitive emission rows
for f in factors:
    if f["classification"]["domain"] != "refrigerant-release":
        continue
    attr = f["factor"]["attribute"]
    gas_id = f["factor"]["greenhouse_gas"]
    value = f["factor"]["value"]
    name = f["classification"]["subtype"]

    if gas_id is None or value is None:
        continue

    if gas_id not in ghg_docs_map:
        # Determine category from type
        gas_type = f["classification"]["type"]
        category_map = {
            "hfc": "hfc",
            "pfc": "pfc",
            "hfo": "hfo",
            "cfc": "cfc",
            "hcfc": "hcfc",
            "sulfur-fluoride": "sulfur-fluoride",
            "nitrogen-fluoride": "nitrogen-fluoride",
        }
        cat = category_map.get(gas_type, gas_type)

        ghg_docs_map[gas_id] = {
            "_id": gas_id,
            "name": name or gas_id,
            "chemical_formula": None,
            "category": cat,
            "gwp": {},
            "is_kyoto_gas": cat in ("hfc", "pfc", "sulfur-fluoride", "nitrogen-fluoride"),
            "notes": None,
        }

    # Assign GWP by attribute
    if attr == "gwp-100-ar6":
        ghg_docs_map[gas_id]["gwp"]["ar6_100yr"] = value
    elif attr == "gwp-100-ar4":
        ghg_docs_map[gas_id]["gwp"]["ar4_100yr"] = value

ghg_docs = list(ghg_docs_map.values())
print(f"  Built {len(ghg_docs)} ghg_metadata documents")


# ──────────────────────────────────────────────
# Build unit_definitions collection
# ──────────────────────────────────────────────

print("Building unit_definitions documents...")

UNIT_DEFS = [
    {"_id": "kg", "name": "Kilogram", "symbol": "kg", "dimension": "mass", "si_unit": "kilogram", "conversion_to_si": 1},
    {"_id": "g", "name": "Gram", "symbol": "g", "dimension": "mass", "si_unit": "kilogram", "conversion_to_si": 0.001},
    {"_id": "lb", "name": "Pound", "symbol": "lb", "dimension": "mass", "si_unit": "kilogram", "conversion_to_si": 0.453592},
    {"_id": "short_ton", "name": "Short Ton (US)", "symbol": "short ton", "dimension": "mass", "si_unit": "kilogram", "conversion_to_si": 907.185},
    {"_id": "metric_tonne", "name": "Metric Tonne", "symbol": "t", "dimension": "mass", "si_unit": "kilogram", "conversion_to_si": 1000},
    {"_id": "mmbtu", "name": "Million BTU", "symbol": "MMBtu", "dimension": "energy", "si_unit": "joule", "conversion_to_si": 1055055852.62},
    {"_id": "btu", "name": "British Thermal Unit", "symbol": "Btu", "dimension": "energy", "si_unit": "joule", "conversion_to_si": 1055.056},
    {"_id": "kwh", "name": "Kilowatt-hour", "symbol": "kWh", "dimension": "energy", "si_unit": "joule", "conversion_to_si": 3600000},
    {"_id": "mwh", "name": "Megawatt-hour", "symbol": "MWh", "dimension": "energy", "si_unit": "joule", "conversion_to_si": 3600000000},
    {"_id": "mj", "name": "Megajoule", "symbol": "MJ", "dimension": "energy", "si_unit": "joule", "conversion_to_si": 1000000},
    {"_id": "gal", "name": "US Gallon", "symbol": "gal", "dimension": "volume", "si_unit": "liter", "conversion_to_si": 3.78541},
    {"_id": "scf", "name": "Standard Cubic Foot", "symbol": "scf", "dimension": "volume", "si_unit": "liter", "conversion_to_si": 28.3168},
    {"_id": "mile", "name": "Mile", "symbol": "mi", "dimension": "distance", "si_unit": "meter", "conversion_to_si": 1609.34},
    {"_id": "passenger_mile", "name": "Passenger-Mile", "symbol": "passenger-mile", "dimension": "distance", "si_unit": "composite", "conversion_to_si": None, "notes": "Composite unit: 1 passenger transported 1 mile."},
    {"_id": "short_ton_mile", "name": "Short Ton-Mile", "symbol": "short-ton-mile", "dimension": "distance", "si_unit": "composite", "conversion_to_si": None, "notes": "Composite unit: 1 short ton transported 1 mile."},
    {"_id": "unitless", "name": "Unitless / Dimensionless", "symbol": "-", "dimension": "dimensionless", "si_unit": None, "conversion_to_si": None},
    {"_id": "gwp_100", "name": "Global Warming Potential (100-year)", "symbol": "GWP-100", "dimension": "dimensionless", "si_unit": None, "conversion_to_si": None, "notes": "Relative to CO2 = 1."},
]

print(f"  Built {len(UNIT_DEFS)} unit_definition documents")


# ──────────────────────────────────────────────
# Write output files
# ──────────────────────────────────────────────

def write_json(data, filename):
    path = OUTPUT_DIR / filename
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=str)
    print(f"  Wrote {path} ({len(data)} documents)")

print("\nWriting output files...")
write_json(factors, "emission_factors.json")
write_json(sources_docs, "sources.json")
write_json(grid_docs, "grid_regions.json")
write_json(ghg_docs, "ghg_metadata.json")
write_json(UNIT_DEFS, "unit_definitions.json")


# ──────────────────────────────────────────────
# Migration report
# ──────────────────────────────────────────────

# Compute stats
domain_counts = {}
for f in factors:
    d = f["classification"]["domain"]
    domain_counts[d] = domain_counts.get(d, 0) + 1

source_counts = {}
for f in factors:
    s = f["provenance"]["source_id"] or "unknown"
    source_counts[s] = source_counts.get(s, 0) + 1

geo_spec_counts = {}
for f in factors:
    g = f["geography"]["geographic_specificity"]
    geo_spec_counts[g] = geo_spec_counts.get(g, 0) + 1

attr_counts = {}
for f in factors:
    a = f["factor"]["attribute"]
    attr_counts[a] = attr_counts.get(a, 0) + 1

ref_total = sum(len(f["related_factors"]) for f in factors)

report = {
    "migration_date": NOW,
    "source_file": INPUT_FILE,
    "total_input_rows": len(data),
    "total_factors_created": len(factors),
    "total_sources_created": len(sources_docs),
    "total_grid_regions_created": len(grid_docs),
    "total_ghg_metadata_created": len(ghg_docs),
    "total_unit_definitions_created": len(UNIT_DEFS),
    "total_cross_references": ref_total,
    "factors_by_domain": dict(sorted(domain_counts.items(), key=lambda x: -x[1])),
    "factors_by_source": dict(sorted(source_counts.items(), key=lambda x: -x[1])),
    "factors_by_geographic_specificity": dict(sorted(geo_spec_counts.items(), key=lambda x: -x[1])),
    "factors_by_attribute": dict(sorted(attr_counts.items(), key=lambda x: -x[1])),
    "warnings": warnings,
    "warnings_count": len(warnings),
}

write_json(report, "migration_report.json")

print(f"\n{'='*60}")
print(f"MIGRATION COMPLETE")
print(f"{'='*60}")
print(f"  Factors:          {len(factors)}")
print(f"  Sources:          {len(sources_docs)}")
print(f"  Grid Regions:     {len(grid_docs)}")
print(f"  GHG Metadata:     {len(ghg_docs)}")
print(f"  Unit Definitions: {len(UNIT_DEFS)}")
print(f"  Cross-references: {ref_total}")
print(f"  Warnings:         {len(warnings)}")
print(f"\nBy domain:")
for d, c in sorted(domain_counts.items(), key=lambda x: -x[1]):
    print(f"    {d:30s} {c:>4}")
print(f"\nBy source:")
for s, c in sorted(source_counts.items(), key=lambda x: -x[1]):
    print(f"    {s:30s} {c:>4}")
print(f"\nAll files written to {OUTPUT_DIR}/")
