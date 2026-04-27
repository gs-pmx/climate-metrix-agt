// Shared category color palette.
//
// Used by the Phase C4 Configure Sources tag library and available to
// future surfaces that need a per-category color accent (sidebar TOC,
// summary bar charts, etc.). Keeping one canonical map here prevents the
// color for "stationary_combustion" from drifting between views.
//
// Colors are chosen from a chip-friendly palette with sufficient contrast
// for both light and dark MUI themes. The palette covers every
// subcategory id emitted by `categorizeForTOC`; if a future subcategory
// is added there without an entry here, `colorForCategory` returns a
// neutral fallback.

import { TOC_SUBCATEGORIES, categorizeForTOC } from "./categorizeForTOC.js";

// Twelve color tokens. `fg` is used for text rendered on top of `bg`.
// `border` deepens the edge so outlined chips stay visible against the
// Paper background. All values are static hex so they render identically
// in SSR / test environments that do not load MUI.
const PALETTE = {
  stationary_combustion: { bg: "#d9e8f7", fg: "#0b3a62", border: "#6ea3cc" },
  mobile_combustion: { bg: "#fbe3d1", fg: "#7a3a12", border: "#d48555" },
  fugitive_emissions: { bg: "#fadad8", fg: "#7a1f1a", border: "#c66b63" },
  purchased_electricity: { bg: "#eadef8", fg: "#431a73", border: "#8e6ecc" },
  purchased_steam: { bg: "#dff3ee", fg: "#14503e", border: "#52a98e" },
  purchased_heating_cooling: { bg: "#e0f1f5", fg: "#1a5767", border: "#60a8b8" },
  supply_chain_capital_goods: { bg: "#f2e5d0", fg: "#5d4210", border: "#b8945c" },
  upstream_distribution: { bg: "#e1e7f5", fg: "#233770", border: "#728ec6" },
  waste_generated_in_operations: { bg: "#e8ecd5", fg: "#3c5112", border: "#879a5a" },
  business_travel: { bg: "#f7dcea", fg: "#76214a", border: "#c36b94" },
  employee_commute: { bg: "#dfe7e8", fg: "#2a4245", border: "#6a8a8d" },
  upstream_leased_assets: { bg: "#efe1d0", fg: "#5d3a17", border: "#b08a5e" },
  scope3_other: { bg: "#e6e6e8", fg: "#333333", border: "#8a8a8a" },
  other: { bg: "#e6e6e8", fg: "#333333", border: "#8a8a8a" },
};

const FALLBACK = { bg: "#eeeeee", fg: "#333333", border: "#9e9e9e" };

// Saturated mid-tone fallback palette used by data visualizations (the
// emissions treemap in particular) when a category lacks an entry in
// PALETTE. Picked for distinguishability + mid-luminance so they stay
// readable with white text overlays. Indexed deterministically by
// category name so a given category lands on the same color across
// renders. Distinct from FALLBACK (a single neutral gray) which is the
// chip-library catch-all.
const SATURATED_FALLBACK_PALETTE = [
  { bg: "#d6e6ed", fg: "#0d3a4a", border: "#1f6f8b" },
  { bg: "#efd8c4", fg: "#3d1f08", border: "#9c5421" },
  { bg: "#dbcfea", fg: "#241341", border: "#5b3a8b" },
  { bg: "#cee4d5", fg: "#0f3320", border: "#34784a" },
  { bg: "#ebd1e0", fg: "#3d143a", border: "#a14b8e" },
  { bg: "#dde0ea", fg: "#152042", border: "#3a4f8a" },
  { bg: "#ece1c8", fg: "#3a2a08", border: "#a07820" },
];

// Hash a string to a small non-negative integer. Used to pick a stable
// fallback color for a category whose id we have not seen before. We
// avoid using random or insertion-order indices so two renders of the
// same data set agree on color assignment.
function hashStringToIndex(value, modulo) {
  if (typeof value !== "string" || value.length === 0) return 0;
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % modulo;
}

// Return a saturated fallback color tuple keyed deterministically off
// the supplied id string. Useful for analytics surfaces that want a
// distinct, not-washed-out color even for ids the canonical PALETTE
// does not cover.
export function saturatedFallbackColor(id) {
  const idx = hashStringToIndex(id || "other", SATURATED_FALLBACK_PALETTE.length);
  return SATURATED_FALLBACK_PALETTE[idx];
}

// Return the {bg, fg, border} tuple for a subcategory id. Unknown ids
// fall back to a neutral gray so the UI stays readable even when the
// catalog grows ahead of this map.
export function colorForSubcategory(subcategoryId) {
  return PALETTE[subcategoryId] || FALLBACK;
}

// Convenience: derive the color directly from an activity type. Uses
// `categorizeForTOC` so color assignment stays consistent with the
// sidebar TOC grouping without duplicating classification logic.
export function colorForActivity(activityType) {
  const { subcategory } = categorizeForTOC(activityType);
  return colorForSubcategory(subcategory);
}

// Public subcategory list in TOC order with colors attached. Useful for
// a legend row or a pill-library sort.
export function subcategoriesWithColors() {
  return TOC_SUBCATEGORIES.map((sub) => ({
    ...sub,
    color: colorForSubcategory(sub.id),
  }));
}
