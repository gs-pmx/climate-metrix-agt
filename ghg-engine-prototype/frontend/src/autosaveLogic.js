// Pure logic for the autosave hook.
//
// The React-aware ``useAutosave`` hook lives in ``useAutosave.js`` and
// imports ``React`` (not available under node's built-in test runner).
// All pure helpers + constants live here so they can be unit-tested
// with ``node --test`` without pulling in the React module graph.

export const AUTOSAVE_STATUS = Object.freeze({
  IDLE: "idle",
  PENDING: "pending",
  SAVING: "saving",
  SAVED: "saved",
  ERROR: "error",
});

export const AUTOSAVE_DEBOUNCE_MS = 30_000;

/**
 * Pure dirty-check used by the autosave hook.
 *
 * Compares two values via ``JSON.stringify``. The hook tracks a
 * baseline string that resets whenever the project is loaded (and again
 * after a successful save), so any local edit that changes the
 * serialized snapshot flips ``dirty`` to true.
 *
 * Edge cases:
 *   - ``current`` and ``baseline`` are both null/undefined: not dirty
 *     (no project loaded yet, or pre-load).
 *   - ``baseline`` is null but ``current`` is set: not dirty until the
 *     first baseline is captured. Without this guard, the very first
 *     render of a freshly loaded project would look dirty.
 */
export function computeDirty(current, baseline) {
  if (baseline == null) return false;
  if (current == null) return false;
  try {
    return JSON.stringify(current) !== JSON.stringify(baseline);
  } catch {
    // Defensive: if JSON serialization throws (cycles, etc.), treat as
    // dirty so the user's edits are not silently lost.
    return true;
  }
}

/**
 * Pure status transition helper. Used by the hook to decide what status
 * to show, factored out so the table is unit-testable.
 *
 * Transition rules:
 *   - saving                     => SAVING (highest precedence; an
 *                                          in-flight save shouldn't be
 *                                          masked by an old error)
 *   - dirty + not saving         => PENDING
 *   - error from last save       => ERROR
 *   - just saved (no later edit) => SAVED
 *   - otherwise                  => IDLE
 */
export function nextAutosaveStatus({ dirty, saving, lastError, hasEverSaved }) {
  if (saving) return AUTOSAVE_STATUS.SAVING;
  if (dirty) return AUTOSAVE_STATUS.PENDING;
  if (lastError) return AUTOSAVE_STATUS.ERROR;
  if (hasEverSaved) return AUTOSAVE_STATUS.SAVED;
  return AUTOSAVE_STATUS.IDLE;
}
