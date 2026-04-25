import * as React from "react";

import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_STATUS,
  computeDirty,
} from "./autosaveLogic.js";

// Re-export the pure helpers + constants so existing imports of this
// module keep working. The pure logic lives in ``autosaveLogic.js`` so
// the unit tests can run under node's built-in test runner without
// pulling in React.
export { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_STATUS, computeDirty } from "./autosaveLogic.js";
export { nextAutosaveStatus } from "./autosaveLogic.js";

// Phase D1 — autosave with a draft buffer.
//
// The hook debounces save calls 30 seconds after the last edit, and
// also flushes on ``visibilitychange`` to ``hidden`` (tab close /
// window blur) using ``sendBeacon`` when available, falling back to
// ``fetch({keepalive: true})``.
//
// Architecture note: the debounce is a single ``setTimeout`` cleared on
// each new edit. We deliberately avoid stacking a queue — only the
// freshest snapshot needs to land on the server, and the UPSERT on the
// backend means duplicate writes are safe but wasteful.

/**
 * React hook implementing the autosave debounce + visibility flush.
 *
 * Parameters:
 *   - ``snapshot``: the live snapshot to persist. Treated as opaque:
 *     the hook serializes it for change-detection but otherwise hands it
 *     verbatim to ``saveFn``.
 *   - ``saveFn``: async ``(snapshot) => Promise<void>``. The caller
 *     provides whatever payload assembly + auth wrapping is needed.
 *   - ``beaconFn``: optional synchronous ``(snapshot) => boolean``
 *     called on ``visibilitychange``. Should return true when the
 *     beacon was queued. Defaults to a no-op so unit tests can omit it.
 *   - ``enabled``: when false, the hook neither schedules debounced
 *     saves nor flushes on visibility. Used to suspend autosave for
 *     projects that haven't been loaded yet.
 *   - ``debounceMs``: override the 30s default for tests.
 *
 * Returns ``{ status, lastSavedAt, markBaseline, flushNow }``.
 *
 * ``markBaseline(snapshot)`` resets the dirty baseline — call it after
 * a successful explicit save so the autosave loop doesn't re-fire on
 * the just-saved state. ``flushNow()`` cancels the debounce and saves
 * immediately (useful from a "Save Version" button to land any pending
 * edits).
 */
export function useAutosave({
  snapshot,
  saveFn,
  beaconFn,
  enabled = true,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
} = {}) {
  const [status, setStatus] = React.useState(AUTOSAVE_STATUS.IDLE);
  const [lastSavedAt, setLastSavedAt] = React.useState(null);
  const [lastError, setLastError] = React.useState(null);

  // Refs hold values the timeout callback needs without re-creating the
  // timer on every render. The hook would otherwise reset the debounce
  // on every keystroke since React re-runs the effect when deps change.
  const baselineRef = React.useRef(null);
  const snapshotRef = React.useRef(snapshot);
  const saveFnRef = React.useRef(saveFn);
  const beaconFnRef = React.useRef(beaconFn);
  const enabledRef = React.useRef(enabled);
  const timerRef = React.useRef(null);
  const savingRef = React.useRef(false);
  const hasEverSavedRef = React.useRef(false);

  React.useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);
  React.useEffect(() => {
    saveFnRef.current = saveFn;
  }, [saveFn]);
  React.useEffect(() => {
    beaconFnRef.current = beaconFn;
  }, [beaconFn]);
  React.useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const performSave = React.useCallback(async () => {
    const fn = saveFnRef.current;
    const payload = snapshotRef.current;
    if (!fn || payload == null) return;
    savingRef.current = true;
    setStatus(AUTOSAVE_STATUS.SAVING);
    try {
      await fn(payload);
      // Capture the baseline AFTER the save returns so any edits that
      // arrived during the save are still detected as dirty on the next
      // tick (i.e. we never silently swallow a concurrent edit).
      baselineRef.current = JSON.stringify(payload);
      setLastSavedAt(new Date());
      setLastError(null);
      hasEverSavedRef.current = true;
      setStatus(() => {
        const stillDirty = computeDirty(snapshotRef.current, JSON.parse(baselineRef.current));
        return stillDirty ? AUTOSAVE_STATUS.PENDING : AUTOSAVE_STATUS.SAVED;
      });
    } catch (err) {
      setLastError(err || new Error("autosave failed"));
      setStatus(AUTOSAVE_STATUS.ERROR);
    } finally {
      savingRef.current = false;
    }
  }, []);

  // Debounce: each render with a new snapshot resets the timer if and
  // only if the snapshot is dirty relative to the baseline.
  React.useEffect(() => {
    if (!enabled) return undefined;
    if (snapshot == null) return undefined;
    if (baselineRef.current == null) {
      // First time we see this snapshot — capture as baseline so the
      // initial load doesn't immediately count as dirty.
      baselineRef.current = JSON.stringify(snapshot);
      return undefined;
    }
    const dirty = computeDirty(snapshot, JSON.parse(baselineRef.current));
    if (!dirty) {
      // No edits since the last baseline; cancel any pending timer.
      clearTimer();
      if (!savingRef.current) {
        setStatus(hasEverSavedRef.current
          ? (lastError ? AUTOSAVE_STATUS.ERROR : AUTOSAVE_STATUS.SAVED)
          : AUTOSAVE_STATUS.IDLE);
      }
      return undefined;
    }
    setStatus(AUTOSAVE_STATUS.PENDING);
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      performSave();
    }, debounceMs);
    return () => {
      // Cleanup on unmount or before next effect run.
    };
  }, [snapshot, enabled, debounceMs, clearTimer, performSave, lastError]);

  // Visibility flush: when the tab is hidden, fire the beacon (or
  // fallback) so the server gets the latest snapshot before the page
  // potentially unloads.
  React.useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const handler = () => {
      if (!enabledRef.current) return;
      if (document.visibilityState !== "hidden") return;
      const baselineStr = baselineRef.current;
      const current = snapshotRef.current;
      if (current == null || baselineStr == null) return;
      let dirty = false;
      try {
        dirty = JSON.stringify(current) !== baselineStr;
      } catch {
        dirty = true;
      }
      if (!dirty) return;
      const beacon = beaconFnRef.current;
      if (typeof beacon === "function") {
        try {
          beacon(current);
        } catch {
          // sendBeacon failures are silent on the platform too; nothing
          // we can usefully surface here. The next focus/edit will
          // re-arm the debounce.
        }
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // Cleanup any pending timer on unmount.
  React.useEffect(() => () => clearTimer(), [clearTimer]);

  const markBaseline = React.useCallback((nextSnapshot) => {
    baselineRef.current = nextSnapshot == null ? null : JSON.stringify(nextSnapshot);
    setLastError(null);
    hasEverSavedRef.current = false;
    setLastSavedAt(null);
    setStatus(AUTOSAVE_STATUS.IDLE);
    clearTimer();
  }, [clearTimer]);

  const flushNow = React.useCallback(async () => {
    clearTimer();
    await performSave();
  }, [clearTimer, performSave]);

  return { status, lastSavedAt, markBaseline, flushNow };
}
