// Phase E2 — pure helpers backing the Spend Inputs tab. Pulled out
// of the .jsx component so node --test can import them directly
// without a JSX transform.

export const SPEND_BASED_ACTIVITY_ID = "scope3_spend_based";

export function filterRusWithSpendSelected(reportingUnits) {
  return (reportingUnits || []).filter((ru) =>
    Array.isArray(ru?.applicable_activity_types)
      ? ru.applicable_activity_types.includes(SPEND_BASED_ACTIVITY_ID)
      : false,
  );
}

// Bucket project-wide GL mappings by reporting_unit_id. Project-wide
// defaults (reporting_unit_id === null) land under the
// ``__project_default__`` sentinel so callers can read the per-RU map
// uniformly.
export function groupMappingsByRu(mappings) {
  const grouped = {};
  for (const m of mappings || []) {
    const key = m.reporting_unit_id || "__project_default__";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  }
  return grouped;
}

// Phase F2 PR 7 — autofill helpers used by the spend rows table.
//
// ``findMappingByCode`` / ``findMappingByName`` are case-insensitive,
// trim-tolerant lookups against a single RU's mapping list. They
// return the first match (account names aren't strictly unique in
// the data model, but accountants typically keep them distinct;
// silent first-match keeps the autofill path simple).
//
// ``autofillSpendRow`` is the rule used both for keystroke updates
// and pasted rows: when the user supplies one of code/name and the
// other is blank, fill the blank from the mapping. We never
// overwrite a non-blank field — accountants pasting an ERP export
// often have custom names that differ from the seeded mapping, and
// silently rewriting them would erase deliberate input.

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function findMappingByCode(mappings, glCode) {
  const target = normalize(glCode);
  if (!target) return null;
  for (const m of mappings || []) {
    if (normalize(m?.gl_code) === target) return m;
  }
  return null;
}

export function findMappingByName(mappings, accountName) {
  const target = normalize(accountName);
  if (!target) return null;
  for (const m of mappings || []) {
    if (normalize(m?.gl_account_name) === target) return m;
  }
  return null;
}

// Phase F2 PR 8 — resolve a pasted factor identifier against the
// spend-factor catalog. Tries source_record_key first (the canonical
// id stored in the mapping row), then case-insensitive description
// match. Returns the factor or null. First match wins —
// descriptions aren't strictly unique, but accountants paste a single
// factor per GL code, so silent first-match is the right call.
export function findFactorByIdentifier(factors, identifier) {
  const target = String(identifier ?? "").trim();
  if (!target) return null;
  const targetLower = target.toLowerCase();
  for (const f of factors || []) {
    if (f?.source_record_key === target) return f;
  }
  for (const f of factors || []) {
    if (typeof f?.description === "string" && f.description.toLowerCase() === targetLower) {
      return f;
    }
  }
  return null;
}

// Apply the code<->name autofill rule to a single row's params. Pure
// function; returns a new params object only if a fill occurred,
// otherwise returns the original reference (so callers can detect a
// no-op via reference equality).
//
// ``params`` is the row's current params shape ({ gl_code,
// gl_account_name, ... }). ``mappings`` is the RU's mapping list.
export function autofillSpendRow(params, mappings) {
  const code = String(params?.gl_code ?? "").trim();
  const name = String(params?.gl_account_name ?? "").trim();
  if (code && !name) {
    const hit = findMappingByCode(mappings, code);
    if (hit?.gl_account_name) {
      return { ...params, gl_account_name: hit.gl_account_name };
    }
  } else if (!code && name) {
    const hit = findMappingByName(mappings, name);
    if (hit?.gl_code) {
      return { ...params, gl_code: hit.gl_code };
    }
  }
  return params;
}
