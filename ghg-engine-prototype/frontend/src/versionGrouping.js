// Phase F2 PR 6 — version-history grouping for the Projects view.
//
// Splits a chronologically-sorted (newest first) version list into three
// buckets so the timeline UI can render them with different emphasis:
//
//   * latest     — single most-recent version, always shown prominently.
//   * manual     — deliberate user saves (Save Snapshot button, Ctrl+S,
//                  initial scaffold, named checkpoints).
//   * autosaves  — versions written by the post-calculation autosave
//                  path. Collapsed by default in the UI.
//
// The split is heuristic by ``note`` text: anything matching the
// post-calc autosave string is bucketed as autosave; everything else
// (including null / empty notes) is treated as a manual checkpoint.
// The note text comes from ``saveCurrentVersion`` callers in App.jsx
// — see the AUTOSAVE_NOTE_PREFIX constant below for the canonical
// string.

export const AUTOSAVE_NOTE_PREFIX = "Auto-saved after calculation";

export function isAutosaveNote(note) {
  if (note == null) return false;
  return String(note).startsWith(AUTOSAVE_NOTE_PREFIX);
}

export function groupVersions(versions) {
  const list = Array.isArray(versions) ? versions : [];
  if (list.length === 0) {
    return { latest: null, manual: [], autosaves: [] };
  }
  const [latest, ...rest] = list;
  const manual = [];
  const autosaves = [];
  for (const v of rest) {
    if (isAutosaveNote(v?.note)) autosaves.push(v);
    else manual.push(v);
  }
  return { latest, manual, autosaves };
}
