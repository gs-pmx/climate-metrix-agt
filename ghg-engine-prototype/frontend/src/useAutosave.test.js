import assert from "node:assert/strict";
import test from "node:test";

// Import from the pure-logic module so the test can run under
// ``node --test`` without React in the dependency graph. The hook itself
// re-exports these symbols, so the production import surface is
// unchanged.
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_STATUS,
  computeDirty,
  nextAutosaveStatus,
} from "./autosaveLogic.js";

// The hook itself wraps DOM APIs (visibilitychange + setTimeout +
// React state). The pure helpers — ``computeDirty`` and
// ``nextAutosaveStatus`` — are factored out so we can unit-test them
// without React, jsdom, or fake-timer plumbing. The hook glues them
// together; if the helpers are right and we exercise the hook by hand
// in the running app, the integration is covered.

test("AUTOSAVE_DEBOUNCE_MS is set to 30 seconds", () => {
  // The product spec calls out 30s explicitly. Lock it down so a
  // future tweak goes through review rather than slipping in unnoticed.
  assert.equal(AUTOSAVE_DEBOUNCE_MS, 30_000);
});

test("AUTOSAVE_STATUS exposes the documented enum values", () => {
  assert.deepEqual(Object.keys(AUTOSAVE_STATUS).sort(), [
    "ERROR",
    "IDLE",
    "PENDING",
    "SAVED",
    "SAVING",
  ]);
  assert.equal(AUTOSAVE_STATUS.IDLE, "idle");
  assert.equal(AUTOSAVE_STATUS.PENDING, "pending");
  assert.equal(AUTOSAVE_STATUS.SAVING, "saving");
  assert.equal(AUTOSAVE_STATUS.SAVED, "saved");
  assert.equal(AUTOSAVE_STATUS.ERROR, "error");
});

test("computeDirty returns false when no baseline has been captured", () => {
  // Pre-load: nothing to compare against, so we must not flag dirty
  // (otherwise the very first render would trigger an autosave).
  assert.equal(computeDirty({ a: 1 }, null), false);
  assert.equal(computeDirty({ a: 1 }, undefined), false);
});

test("computeDirty returns false when current snapshot is null", () => {
  // Defensive: if the caller hasn't constructed the snapshot yet, do
  // not autosave a missing payload.
  assert.equal(computeDirty(null, { a: 1 }), false);
  assert.equal(computeDirty(undefined, { a: 1 }), false);
});

test("computeDirty returns false when current matches baseline", () => {
  const baseline = { snapshot_version: 2, facilities: [], activities: [] };
  const current = { snapshot_version: 2, facilities: [], activities: [] };
  assert.equal(computeDirty(current, baseline), false);
});

test("computeDirty returns true when any field changes", () => {
  const baseline = { snapshot_version: 2, facilities: [{ id: "F1" }] };
  const current = { snapshot_version: 2, facilities: [{ id: "F1", facility_name: "Renamed" }] };
  assert.equal(computeDirty(current, baseline), true);
});

test("computeDirty distinguishes equivalent objects with different key order", () => {
  // JSON.stringify preserves insertion order; reordering keys produces
  // different output. This is acceptable — the snapshot is built by a
  // deterministic mapper (``buildSnapshot``) so reordering shouldn't
  // happen in practice. The test documents the behavior so a future
  // refactor that switches to a deep-equal check is a deliberate change.
  const baseline = { a: 1, b: 2 };
  const reordered = { b: 2, a: 1 };
  assert.equal(computeDirty(reordered, baseline), true);
});

test("nextAutosaveStatus prefers SAVING when a save is in flight", () => {
  // Even if dirty edits arrived during the save, the chip should show
  // "Saving..." until the request resolves. A pending status would
  // suggest the request hasn't started yet.
  assert.equal(
    nextAutosaveStatus({ dirty: true, saving: true, lastError: null, hasEverSaved: true }),
    AUTOSAVE_STATUS.SAVING,
  );
  assert.equal(
    nextAutosaveStatus({ dirty: false, saving: true, lastError: null, hasEverSaved: false }),
    AUTOSAVE_STATUS.SAVING,
  );
});

test("nextAutosaveStatus returns PENDING when dirty and not saving", () => {
  assert.equal(
    nextAutosaveStatus({ dirty: true, saving: false, lastError: null, hasEverSaved: false }),
    AUTOSAVE_STATUS.PENDING,
  );
  assert.equal(
    nextAutosaveStatus({ dirty: true, saving: false, lastError: null, hasEverSaved: true }),
    AUTOSAVE_STATUS.PENDING,
  );
});

test("nextAutosaveStatus returns ERROR when last save failed and not currently dirty/saving", () => {
  assert.equal(
    nextAutosaveStatus({ dirty: false, saving: false, lastError: new Error("nope"), hasEverSaved: true }),
    AUTOSAVE_STATUS.ERROR,
  );
});

test("nextAutosaveStatus returns SAVED after a successful save with no further edits", () => {
  assert.equal(
    nextAutosaveStatus({ dirty: false, saving: false, lastError: null, hasEverSaved: true }),
    AUTOSAVE_STATUS.SAVED,
  );
});

test("nextAutosaveStatus returns IDLE on a freshly loaded project with no edits", () => {
  assert.equal(
    nextAutosaveStatus({ dirty: false, saving: false, lastError: null, hasEverSaved: false }),
    AUTOSAVE_STATUS.IDLE,
  );
});

test("nextAutosaveStatus error precedence does not mask in-flight saves", () => {
  // A retry path: a failed save left ``lastError`` populated, then a
  // fresh edit triggered a debounce, then the new save started. The
  // chip must show "Saving..." until that resolves — not "error".
  assert.equal(
    nextAutosaveStatus({ dirty: true, saving: true, lastError: new Error("prev"), hasEverSaved: true }),
    AUTOSAVE_STATUS.SAVING,
  );
});
