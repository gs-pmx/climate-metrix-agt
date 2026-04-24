import assert from "node:assert/strict";
import test from "node:test";

import { TOC_SUBCATEGORIES } from "./categorizeForTOC.js";
import {
  colorForActivity,
  colorForSubcategory,
  subcategoriesWithColors,
} from "./categoryColors.js";

test("colorForSubcategory returns a {bg, fg, border} tuple for every known subcategory", () => {
  for (const sub of TOC_SUBCATEGORIES) {
    const color = colorForSubcategory(sub.id);
    assert.ok(color.bg, `missing bg for ${sub.id}`);
    assert.ok(color.fg, `missing fg for ${sub.id}`);
    assert.ok(color.border, `missing border for ${sub.id}`);
  }
});

test("colorForSubcategory falls back gracefully for unknown ids", () => {
  const color = colorForSubcategory("not_in_palette_ever");
  assert.ok(color.bg);
  assert.ok(color.fg);
});

test("colorForActivity picks by subcategory classification", () => {
  const a = {
    activity_type_id: "scope1_stationary_natural_gas",
    scope: "Scope 1",
    category: "Stationary Energy",
    metric_group: "fuel",
  };
  const b = {
    activity_type_id: "scope1_mobile_diesel",
    scope: "Scope 1",
    category: "Transportation",
    metric_group: "fuel",
  };
  const aColor = colorForActivity(a);
  const bColor = colorForActivity(b);
  assert.notEqual(aColor.bg, bColor.bg, "stationary combustion and mobile should differ");
});

test("subcategoriesWithColors returns full list in TOC order", () => {
  const list = subcategoriesWithColors();
  assert.equal(list.length, TOC_SUBCATEGORIES.length);
  assert.deepEqual(
    list.map((r) => r.id),
    TOC_SUBCATEGORIES.map((r) => r.id),
  );
  for (const row of list) {
    assert.ok(row.color, `missing color for ${row.id}`);
  }
});
