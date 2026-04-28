# Reference crosswalks

This directory holds three classification crosswalks consumed by the
spend-based emissions accounting feature (Phase E1). Files are CSV with
a one-row header. They are loaded into memory by
``ghg_engine.spend_based.crosswalk_resolver`` on demand; they do **not**
sit in SQLite.

## Files

| File | Purpose | Status |
|------|---------|--------|
| `naics_to_bea.csv` | NAICS-2017 6-digit code -> BEA detail-level commodity code | Partial — high-coverage seed set bundled, full coverage requires the BEA Concordances workbook |
| `nace_to_cpa.csv` | NACE Rev. 2 4-digit -> CPA 2.1 6-digit | Partial — illustrative seed set bundled |
| `cpa_to_exiobase.csv` | CPA 2.1 -> EXIOBASE 200-product code | Partial — bundled from pymrio's ``concordances`` module is preferred at runtime |

## Why partial?

A clean public crosswalk in CSV form for each pair was not available
during Phase E1 ingestion. The files bundled here cover the most common
NAICS/NACE/CPA codes the team has tested against during USEEIO and
EXIOBASE smoke-runs — enough to demonstrate the resolver flow end-to-
end. For full coverage, the user can:

1. Download the BEA "Industry-by-NAICS Concordances" workbook from
   https://www.bea.gov/industry/concordances and re-run the
   ``ghg-engine-prototype/scripts/ingest_eeio_factors.py`` script with
   the ``--bea-concordance`` flag. The script will refresh
   ``naics_to_bea.csv`` from that workbook.
2. Use pymrio's bundled concordance tables for CPA <-> EXIOBASE: see
   ``pymrio.tools.iometadata.get_classification_table`` (the EEIO
   ingestion script falls back to those tables when the bundled CSV is
   missing).
3. NACE -> CPA is published by Eurostat (RAMON metadata server). The
   bundled file covers the v1 footprint; pull the full table from
   https://ec.europa.eu/eurostat/ramon/relations/index.cfm if a project
   needs broader coverage.

## Schema

```
naics_to_bea.csv: naics_code,bea_code,bea_label,confidence
nace_to_cpa.csv:  nace_code,cpa_code,cpa_label,confidence
cpa_to_exiobase.csv: cpa_code,exiobase_code,exiobase_label,confidence
```

`confidence` is a free-text field; ``"exact"`` for one-to-one mappings
and ``"approximate"`` for many-to-one bridges where the source code
covers a broader product class than the target code.
