import * as React from "react";
import { Stack } from "@mui/material";
import CatalogCoverageBrowser from "./CatalogCoverageBrowser";

// Post-C4 item 5: the Catalog Coverage browser used to render at the
// bottom of the Activity Inputs tab where it competed for attention
// with the primary data-entry surface. It is informational / reference
// content, so it moves to its own top-level "Catalog" tab. This shell
// is intentionally thin — just a light intro header plus the existing
// coverage browser — but keeps a separate module so future reference
// surfaces (e.g., emission factor browser) can slot in next to it.
export default function CatalogTab({ activityCatalog }) {
  // F2 PR 5 — dropped the "Reference view of every activity type
  // available in the catalog..." persistent intro paragraph.
  // The browser below is self-explanatory.
  return (
    <Stack spacing={2}>
      <CatalogCoverageBrowser activityCatalog={activityCatalog} />
    </Stack>
  );
}
