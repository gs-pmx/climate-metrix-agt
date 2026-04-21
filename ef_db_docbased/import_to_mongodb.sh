#!/usr/bin/env bash
# ============================================================
# Climate-Metrix EF Database — MongoDB Import Script
# ============================================================
#
# Prerequisites:
#   1. MongoDB Community Edition installed (6.0+ recommended)
#      - macOS:   brew install mongodb-community
#      - Ubuntu:  https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/
#      - Or use MongoDB Atlas free tier: https://www.mongodb.com/cloud/atlas
#
#   2. mongoimport tool available (included with MongoDB Database Tools)
#      - https://www.mongodb.com/try/download/database-tools
#
#   3. mongosh (MongoDB Shell) for creating indexes and validation
#      - https://www.mongodb.com/try/download/shell
#
# Usage:
#   chmod +x import_to_mongodb.sh
#   ./import_to_mongodb.sh
#
# To target a remote MongoDB (e.g., Atlas):
#   export MONGO_URI="mongodb+srv://user:pass@cluster.mongodb.net"
#   ./import_to_mongodb.sh
# ============================================================

set -euo pipefail

DB_NAME="climate_metrix"
MONGO_URI="${MONGO_URI:-mongodb://localhost:27017}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "============================================================"
echo "Climate-Metrix EF Database Import"
echo "============================================================"
echo "Target: ${MONGO_URI}/${DB_NAME}"
echo ""

# ── Step 1: Import collections ────────────────────────────────

import_collection() {
    local collection="$1"
    local file="$2"
    echo "Importing ${collection}..."
    mongoimport \
        --uri="${MONGO_URI}" \
        --db="${DB_NAME}" \
        --collection="${collection}" \
        --file="${SCRIPT_DIR}/${file}" \
        --jsonArray \
        --drop
    echo "  ✓ ${collection} imported"
}

import_collection "emission_factors"  "emission_factors.json"
import_collection "sources"           "sources.json"
import_collection "grid_regions"      "grid_regions.json"
import_collection "ghg_metadata"      "ghg_metadata.json"
import_collection "unit_definitions"  "unit_definitions.json"

echo ""
echo "All collections imported."

# ── Step 2: Create indexes and validation ─────────────────────

echo ""
echo "Creating indexes and schema validation..."

mongosh "${MONGO_URI}/${DB_NAME}" --quiet << 'MONGOSH'

// ── Indexes ──

// Primary selection queries
db.emission_factors.createIndex(
  { "classification.domain": 1, "classification.type": 1, "factor.attribute": 1 },
  { name: "idx_domain_type_attr" }
);
db.emission_factors.createIndex(
  { "classification.type": 1, "factor.greenhouse_gas": 1, "provenance.data_year": -1 },
  { name: "idx_type_gas_year" }
);

// Geographic lookups
db.emission_factors.createIndex(
  { "geography.grid_region_code": 1, "factor.attribute": 1 },
  { name: "idx_grid_region_attr" }
);
db.emission_factors.createIndex(
  { "geography.country": 1, "geography.state": 1, "geography.geographic_specificity": 1 },
  { name: "idx_geo_country_state_spec" }
);

// Lineage and versioning
db.emission_factors.createIndex(
  { "lineage_id": 1, "versioning.is_current": 1 },
  { name: "idx_lineage_current" }
);
db.emission_factors.createIndex(
  { "lineage_id": 1, "provenance.data_year": -1 },
  { name: "idx_lineage_year" }
);

// Factor key (unique)
db.emission_factors.createIndex(
  { "factor_key": 1 },
  { name: "idx_factor_key", unique: true }
);

// Maintenance workflow
db.emission_factors.createIndex(
  { "maintenance.status": 1, "maintenance.next_review_date": 1 },
  { name: "idx_maintenance" }
);

// Source lookups
db.emission_factors.createIndex(
  { "provenance.source_id": 1 },
  { name: "idx_source" }
);

// Grid regions
db.grid_regions.createIndex(
  { "applicable_states": 1 },
  { name: "idx_states" }
);

// GHG metadata
db.ghg_metadata.createIndex(
  { "category": 1 },
  { name: "idx_ghg_category" }
);

print("  ✓ Indexes created");


// ── Schema Validation ──

db.runCommand({
  collMod: "emission_factors",
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["lineage_id", "factor_key", "classification", "geography", "factor", "provenance", "versioning"],
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
                "combustion", "electricity-generation", "refrigerant-release",
                "freight-transport", "passenger-transport", "waste-decomposition",
                "industrial-process", "land-use", "conversion"
              ]
            }
          }
        },
        geography: {
          bsonType: "object",
          required: ["geographic_specificity"],
          properties: {
            geographic_specificity: {
              bsonType: "string",
              enum: ["global", "national", "regional", "subregion", "state", "site"]
            }
          }
        },
        factor: {
          bsonType: "object",
          required: ["attribute", "value", "unit_basis"],
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
          required: ["confidence_level", "is_complete"],
          properties: {
            confidence_level: { bsonType: "string", enum: ["high", "moderate", "low"] },
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
  },
  validationLevel: "moderate",
  validationAction: "warn"
});

print("  ✓ Schema validation applied");


// ── Quick verification ──

const counts = {
  emission_factors: db.emission_factors.countDocuments(),
  sources: db.sources.countDocuments(),
  grid_regions: db.grid_regions.countDocuments(),
  ghg_metadata: db.ghg_metadata.countDocuments(),
  unit_definitions: db.unit_definitions.countDocuments(),
};

print("\n  Document counts:");
for (const [col, count] of Object.entries(counts)) {
  print(`    ${col}: ${count}`);
}

// Quick domain distribution
print("\n  Factors by domain:");
db.emission_factors.aggregate([
  { $group: { _id: "$classification.domain", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).forEach(doc => {
  print(`    ${doc._id}: ${doc.count}`);
});

print("\n  ✓ Import complete and verified");

MONGOSH

echo ""
echo "============================================================"
echo "Import complete! Your database is ready."
echo ""
echo "Next steps:"
echo "  1. Browse in MongoDB Compass (free): https://www.mongodb.com/products/compass"
echo "     Connect to: ${MONGO_URI}"
echo "     Database:   ${DB_NAME}"
echo ""
echo "  2. Query from the shell:"
echo "     mongosh ${MONGO_URI}/${DB_NAME}"
echo ""
echo "  3. Review the migration_report.json for any warnings"
echo "============================================================"
