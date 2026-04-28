import { test } from "node:test";
import assert from "node:assert/strict";

import { flushActiveEdit } from "./flushActiveEdit.js";

test("flushActiveEdit calls blur on the active element when one is focused", async () => {
  let blurCalls = 0;
  const fakeEl = {
    blur: () => {
      blurCalls += 1;
    },
  };
  await flushActiveEdit({ activeElement: fakeEl });
  assert.equal(blurCalls, 1);
});

test("flushActiveEdit is a no-op when there is no document", async () => {
  await flushActiveEdit(null);
  // resolves cleanly — implicit assertion: no throw.
});

test("flushActiveEdit is a no-op when document has no active element", async () => {
  await flushActiveEdit({ activeElement: null });
});

test("flushActiveEdit tolerates an active element whose blur isn't a function", async () => {
  await flushActiveEdit({ activeElement: { blur: undefined } });
});

test("flushActiveEdit swallows a throw from blur() so callers can proceed", async () => {
  const fakeEl = {
    blur: () => {
      throw new Error("boom");
    },
  };
  await flushActiveEdit({ activeElement: fakeEl });
});

test("flushActiveEdit awaits at least one task tick before resolving", async () => {
  // Schedule a sentinel via setTimeout(0) and confirm flushActiveEdit's
  // resolution happens after it: this proves the helper is yielding to
  // the macrotask queue, which is the property React relies on to flush
  // pending state updates.
  let sentinelFired = false;
  setTimeout(() => {
    sentinelFired = true;
  }, 0);
  await flushActiveEdit({ activeElement: null });
  assert.equal(sentinelFired, true);
});
