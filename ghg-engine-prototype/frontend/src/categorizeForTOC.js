// Phase C4 sidebar-TOC helper.
//
// The Inputs by Activity view grew to ~30 accordions under bare-bones
// Scope 1/2/3 headings. User feedback (items 2 + 17) was that the Scope
// labels were "too small and missable" and the overall view was "just
// too much." The fix is a two-column layout: a sidebar TOC on the left
// with Scope > Subcategory > (activity accordions live on the right).
//
// This module maps each ActivityTypeDefinition to one of a fixed set of
// subcategory buckets aligned with the GHG Protocol Scope 1/2/3 structure
// the user sketched.
//
// The mapping is intentionally hand-authored rather than derived from a
// single catalog column because no single existing field (scope,
// category, metric_group, metric_subgroup, protocol_category_code) is
// rich enough on its own:
//   - `scope` alone can't distinguish Stationary vs Mobile combustion.
//   - `category` ("Stationary Energy" / "Transportation" / "Fugitive
//     Emissions" / "Solid Waste") collapses Scope 3 transport and Scope 1
//     mobile into the same bucket.
//   - `metric_subgroup` is granular enough but doesn't exist for every
//     activity (e.g. refrigerants have it set to null).
//   - `protocol_category_code` is populated only for Scope 3 rows.
//
// The canonical classification therefore uses a small ordered ruleset.
// Ordering matters: the first matching rule wins. Rules are deliberately
// independent so future catalog growth can't silently move an activity
// into the wrong bucket.

// Stable list of subcategory IDs in the order they should appear in the
// sidebar TOC. Downstream renderers import this so the navigation order
// matches the user's sketch.
export const TOC_SUBCATEGORIES = [
  { id: "stationary_combustion", label: "Stationary Combustion", scope: "scope_1" },
  { id: "mobile_combustion", label: "Mobile Combustion", scope: "scope_1" },
  { id: "fugitive_emissions", label: "Fugitive Emissions", scope: "scope_1" },
  { id: "purchased_electricity", label: "Purchased Electricity", scope: "scope_2" },
  { id: "purchased_steam", label: "Purchased Steam", scope: "scope_2" },
  { id: "purchased_heating_cooling", label: "Purchased Heating/Cooling", scope: "scope_2" },
  { id: "supply_chain_capital_goods", label: "Supply Chain and Capital Goods", scope: "scope_3" },
  { id: "upstream_distribution", label: "Upstream Distribution", scope: "scope_3" },
  { id: "waste_generated_in_operations", label: "Waste Generated in Operations", scope: "scope_3" },
  { id: "business_travel", label: "Business Travel", scope: "scope_3" },
  { id: "employee_commute", label: "Employee Commute", scope: "scope_3" },
  { id: "upstream_leased_assets", label: "Upstream Leased Assets", scope: "scope_3" },
  { id: "scope3_other", label: "Other Scope 3", scope: "scope_3" },
  { id: "other", label: "Other", scope: "other" },
];

export const TOC_SCOPES = [
  { id: "scope_1", label: "Scope 1 - Direct emissions" },
  { id: "scope_2", label: "Scope 2 - Purchased energy" },
  { id: "scope_3", label: "Scope 3 - Value chain" },
  { id: "other", label: "Other" },
];

// Normalization helpers kept local to this module so test fixtures can
// emit whatever shape the catalog surfaces without callers having to
// pre-normalize.
function normScope(raw) {
  const s = String(raw || "").toLowerCase();
  if (/(?:^|\b|scope)[\s_]*1(?:\b|$)/.test(s)) return "scope_1";
  if (/(?:^|\b|scope)[\s_]*2(?:\b|$)/.test(s)) return "scope_2";
  if (/(?:^|\b|scope)[\s_]*3(?:\b|$)/.test(s)) return "scope_3";
  return "other";
}

function normStr(raw) {
  return String(raw || "").toLowerCase();
}

// Classify a single catalog activity into a { scope, subcategory } pair.
// Both IDs come from the constant lists above. When no rule matches the
// activity is bucketed into the scope's generic tail ("scope3_other" /
// "other") so it still shows up in the TOC — we prefer a visible
// fallback to an invisible activity.
export function categorizeForTOC(activityType) {
  const scope = normScope(activityType?.scope);
  const category = normStr(activityType?.category);
  const metricGroup = normStr(activityType?.metric_group);
  const metricSubgroup = normStr(activityType?.metric_subgroup);
  const protocolCode = String(activityType?.protocol_category_code || "").trim();
  const id = normStr(activityType?.activity_type_id);

  if (scope === "scope_1") {
    if (category === "fugitive emissions") {
      return { scope, subcategory: "fugitive_emissions" };
    }
    if (category === "transportation") {
      return { scope, subcategory: "mobile_combustion" };
    }
    // Stationary Energy under Scope 1 covers fuel combustion AND onsite
    // generation — both are consumed at the reporting unit and share the
    // user's mental model for "stationary combustion."
    if (category === "stationary energy") {
      return { scope, subcategory: "stationary_combustion" };
    }
    if (metricGroup === "fuel") {
      return { scope, subcategory: "stationary_combustion" };
    }
    if (/refrigerant|fugitive/.test(id)) {
      return { scope, subcategory: "fugitive_emissions" };
    }
    if (/mobile/.test(id)) {
      return { scope, subcategory: "mobile_combustion" };
    }
    return { scope, subcategory: "stationary_combustion" };
  }

  if (scope === "scope_2") {
    if (metricSubgroup === "electricity_mix" || metricSubgroup === "electricity_renewable") {
      return { scope, subcategory: "purchased_electricity" };
    }
    if (metricSubgroup === "steam_mix" || metricSubgroup === "steam_renewable") {
      return { scope, subcategory: "purchased_steam" };
    }
    if (/electric/.test(id)) {
      return { scope, subcategory: "purchased_electricity" };
    }
    if (/steam/.test(id)) {
      return { scope, subcategory: "purchased_steam" };
    }
    // Everything else under Scope 2 is heating/cooling (district chilled
    // water, etc.) — the user's sketch keeps that as its own bucket.
    return { scope, subcategory: "purchased_heating_cooling" };
  }

  if (scope === "scope_3") {
    // Protocol category code (GHG Protocol Scope 3 category number) is
    // the cleanest signal when populated. Fall through to id/label
    // heuristics otherwise so coverage stays predictable as the catalog
    // grows.
    switch (protocolCode) {
      case "1":
      case "2":
        return { scope, subcategory: "supply_chain_capital_goods" };
      case "3":
        // 3.3 "Fuel- and energy-related activities" — bucket under the
        // supply chain row until we sketch a dedicated row.
        return { scope, subcategory: "supply_chain_capital_goods" };
      case "4":
        return { scope, subcategory: "upstream_distribution" };
      case "5":
        return { scope, subcategory: "waste_generated_in_operations" };
      case "6":
        return { scope, subcategory: "business_travel" };
      case "7":
        return { scope, subcategory: "employee_commute" };
      case "8":
        return { scope, subcategory: "upstream_leased_assets" };
      default:
        break;
    }

    if (/business_travel/.test(id)) return { scope, subcategory: "business_travel" };
    if (/commut/.test(id)) return { scope, subcategory: "employee_commute" };
    if (/waste/.test(id)) return { scope, subcategory: "waste_generated_in_operations" };
    if (/upstream_transport|upstream_distribution/.test(id)) {
      return { scope, subcategory: "upstream_distribution" };
    }
    if (/leased/.test(id)) return { scope, subcategory: "upstream_leased_assets" };
    if (/supply_chain|capital_goods|purchased_goods/.test(id)) {
      return { scope, subcategory: "supply_chain_capital_goods" };
    }
    return { scope, subcategory: "scope3_other" };
  }

  return { scope: "other", subcategory: "other" };
}

// Bucket an array of activity types into a scope > subcategory tree
// suitable for rendering. Subcategories with no activities are dropped
// from the output so the sidebar only shows rows the user can actually
// click. Scopes with no active subcategories are likewise omitted.
//
// Returns: [
//   { id, label, subcategories: [{ id, label, activities: [ActivityType, ...] }] }
// ]
export function groupByTOC(activityTypes) {
  const bySub = new Map();
  for (const at of activityTypes || []) {
    const { scope, subcategory } = categorizeForTOC(at);
    const key = `${scope}::${subcategory}`;
    if (!bySub.has(key)) bySub.set(key, []);
    bySub.get(key).push(at);
  }
  const scopes = TOC_SCOPES.map((scope) => {
    const subcategories = TOC_SUBCATEGORIES
      .filter((sub) => sub.scope === scope.id)
      .map((sub) => ({
        id: sub.id,
        label: sub.label,
        activities: bySub.get(`${scope.id}::${sub.id}`) || [],
      }))
      .filter((sub) => sub.activities.length > 0);
    return { id: scope.id, label: scope.label, subcategories };
  });
  return scopes.filter((s) => s.subcategories.length > 0);
}

// Stable anchor id shared by sidebar buttons and content section wrappers
// for scroll-into-view behavior.
export function sectionAnchorId(scopeId, subcategoryId) {
  return `ba-section-${scopeId}-${subcategoryId}`;
}
