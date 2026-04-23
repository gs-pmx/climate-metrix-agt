import assert from "node:assert/strict";
import test from "node:test";

import {
  formatNumericDisplay,
  normalizeNumericInput,
  parseNumericInput,
} from "./numericFormat.js";

test("parseNumericInput accepts plain integers and decimals", () => {
  assert.equal(parseNumericInput("1234"), 1234);
  assert.equal(parseNumericInput("1234.5"), 1234.5);
  assert.equal(parseNumericInput("0.25"), 0.25);
  assert.equal(parseNumericInput(".5"), 0.5);
});

test("parseNumericInput strips thousands separators", () => {
  assert.equal(parseNumericInput("1,234"), 1234);
  assert.equal(parseNumericInput("12,345.67"), 12345.67);
  assert.equal(parseNumericInput("1,234,567.89"), 1234567.89);
});

test("parseNumericInput handles negative numbers", () => {
  assert.equal(parseNumericInput("-1,234.5"), -1234.5);
  assert.equal(parseNumericInput("-0.1"), -0.1);
});

test("parseNumericInput returns null for empty or invalid input", () => {
  assert.equal(parseNumericInput(""), null);
  assert.equal(parseNumericInput("   "), null);
  assert.equal(parseNumericInput(null), null);
  assert.equal(parseNumericInput(undefined), null);
  assert.equal(parseNumericInput("abc"), null);
  assert.equal(parseNumericInput("1.2.3"), null);
  assert.equal(parseNumericInput("--5"), null);
});

test("parseNumericInput passes through finite numbers and rejects NaN/Infinity", () => {
  assert.equal(parseNumericInput(42), 42);
  assert.equal(parseNumericInput(Number.NaN), null);
  assert.equal(parseNumericInput(Number.POSITIVE_INFINITY), null);
});

test("parseNumericInput does not throw on unexpected input", () => {
  assert.doesNotThrow(() => parseNumericInput({}));
  assert.doesNotThrow(() => parseNumericInput([]));
  assert.equal(parseNumericInput({}), null);
});

test("formatNumericDisplay renders with thousands separators", () => {
  assert.equal(formatNumericDisplay(1234), "1,234");
  assert.equal(formatNumericDisplay(1234567.89), "1,234,567.89");
  assert.equal(formatNumericDisplay(0), "0");
});

test("formatNumericDisplay trims trailing zero decimals", () => {
  assert.equal(formatNumericDisplay(1234.5), "1,234.5");
  assert.equal(formatNumericDisplay(1234.1), "1,234.1");
  assert.equal(formatNumericDisplay(1234.12000), "1,234.12");
});

test("formatNumericDisplay caps fractional digits at 6 significant places", () => {
  assert.equal(formatNumericDisplay(1.1234567), "1.123457");
  assert.equal(formatNumericDisplay(0.1234564), "0.123456");
});

test("formatNumericDisplay handles negatives and nullish", () => {
  assert.equal(formatNumericDisplay(-1234.5), "-1,234.5");
  assert.equal(formatNumericDisplay(null), "");
  assert.equal(formatNumericDisplay(undefined), "");
  assert.equal(formatNumericDisplay(""), "");
});

test("formatNumericDisplay accepts strings (round-trips through parse)", () => {
  assert.equal(formatNumericDisplay("1,234.50"), "1,234.5");
  // Unparseable strings pass through unchanged so the UI can show invalid
  // input back to the user instead of silently blanking the cell.
  assert.equal(formatNumericDisplay("not a number"), "not a number");
});

test("normalizeNumericInput exposes both parsed and display forms", () => {
  assert.deepEqual(normalizeNumericInput("1,234.5"), {
    parsed: 1234.5,
    display: "1,234.5",
  });
  assert.deepEqual(normalizeNumericInput(""), { parsed: null, display: "" });
  assert.deepEqual(normalizeNumericInput("bad"), { parsed: null, display: "bad" });
});
