// Force any in-edit input (a DataGrid cell, dialog field, etc.) to
// commit its in-flight value, then yield long enough for React's
// batched state updates to flush.
//
// Why: MUI DataGrid keeps an in-edit cell's value in its internal
// edit state. The value only propagates to the parent's React state
// when the cell commits (Enter, Tab, or blur). If a user clicks
// Calculate or Save while a cell is still in edit mode, the click
// blurs the cell — but the resulting ``setActivities`` is queued, and
// the click handler reads ``activities`` from a closure captured
// before the blur. Result: the action runs on stale data.
//
// This helper performs the explicit blur and yields a microtask so
// the caller can subsequently read fresh state via a ref that
// mirrors the React state on every render.
//
// Pure-ish: the only side effects are ``blur()`` on the active
// element and a ``setTimeout(0)`` await. Both are easily faked in
// tests by passing a stand-in ``documentLike``.
export async function flushActiveEdit(
  documentLike = typeof document !== "undefined" ? document : null,
) {
  if (
    documentLike
    && documentLike.activeElement
    && typeof documentLike.activeElement.blur === "function"
  ) {
    try {
      documentLike.activeElement.blur();
    } catch {
      // blur() can throw on detached/destroyed elements (rare). We
      // swallow because the next yield will still let pending state
      // updates flush, which is the load-bearing part.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}
