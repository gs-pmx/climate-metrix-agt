import { test } from "node:test";
import assert from "node:assert/strict";

import { groupVersions, isAutosaveNote } from "./versionGrouping.js";

test("isAutosaveNote: matches the canonical post-calc autosave note", () => {
  assert.equal(isAutosaveNote("Auto-saved after calculation."), true);
});

test("isAutosaveNote: matches autosave notes with trailing variants", () => {
  assert.equal(isAutosaveNote("Auto-saved after calculation (v3)"), true);
});

test("isAutosaveNote: treats manual checkpoint notes as non-autosave", () => {
  assert.equal(isAutosaveNote("Manual checkpoint."), false);
  assert.equal(isAutosaveNote("Checkpoint (Ctrl+S)."), false);
  assert.equal(isAutosaveNote("Initial project scaffold."), false);
  assert.equal(isAutosaveNote("Updated electricity usage"), false);
});

test("isAutosaveNote: treats null / empty / non-string as non-autosave", () => {
  assert.equal(isAutosaveNote(null), false);
  assert.equal(isAutosaveNote(undefined), false);
  assert.equal(isAutosaveNote(""), false);
});

test("groupVersions: returns empty buckets for empty input", () => {
  assert.deepEqual(groupVersions([]), { latest: null, manual: [], autosaves: [] });
  assert.deepEqual(groupVersions(undefined), { latest: null, manual: [], autosaves: [] });
});

test("groupVersions: pulls the first entry as latest regardless of note type", () => {
  const list = [
    { version_number: 7, note: "Auto-saved after calculation." },
    { version_number: 6, note: "Manual checkpoint." },
  ];
  const out = groupVersions(list);
  assert.equal(out.latest, list[0]);
  assert.deepEqual(out.manual, [list[1]]);
  assert.deepEqual(out.autosaves, []);
});

test("groupVersions: buckets non-latest entries by note", () => {
  const list = [
    { version_number: 5, note: "Manual checkpoint." },
    { version_number: 4, note: "Auto-saved after calculation." },
    { version_number: 3, note: "Auto-saved after calculation." },
    { version_number: 2, note: "Initial project scaffold." },
    { version_number: 1, note: null },
  ];
  const out = groupVersions(list);
  assert.equal(out.latest, list[0]);
  assert.deepEqual(out.manual, [list[3], list[4]]);
  assert.deepEqual(out.autosaves, [list[1], list[2]]);
});

test("groupVersions: does not duplicate latest into manual or autosaves", () => {
  const list = [
    { version_number: 2, note: "Manual checkpoint." },
    { version_number: 1, note: "Manual checkpoint." },
  ];
  const out = groupVersions(list);
  assert.equal(out.manual.length, 1);
  assert.equal(out.manual[0], list[1]);
});
