import * as React from "react";
import { Chip, Stack, Typography } from "@mui/material";

// F2 PR 3 — Scope navigation chips.
//
// Compact horizontal alternative to the prior By-Activity TOC sidebar
// per Stephen's backlog feedback:
//
//   "What I mean for having just the three nav options by scope was to
//    add those to the sticky by-activity/by-ru bar and extending the
//    data entry tables to full width."
//
// The chips live in the sticky view-selector bar in
// ``ActivityInputsPanel`` and only render when ``viewMode === "byActivity"``.
// Click a chip to scroll the corresponding scope section into view; the
// active chip highlights based on scroll-spy state held by the parent.
//
// Scopes are looked up by document anchor (``#scope-${id}``) instead of
// React refs so the component stays decoupled from ``ByActivityTable``.
// ``ByActivityTable`` adds the matching ``id`` attributes to the scope
// container Boxes.

export const SCOPE_CHIP_DEFS = [
  { id: "scope_1", label: "Scope 1" },
  { id: "scope_2", label: "Scope 2" },
  { id: "scope_3", label: "Scope 3" },
];

export function scrollToScope(scopeId) {
  if (typeof document === "undefined") return;
  const node = document.getElementById(`scope-${scopeId}`);
  if (node && typeof node.scrollIntoView === "function") {
    node.scrollIntoView({ behavior: "auto", block: "start" });
  }
}

export default function ScopeChips({
  activeScopeId = "",
  availableScopeIds = null,
  onJump = scrollToScope,
}) {
  // Filter to scopes that actually appear in the catalog tree if the
  // caller supplied a set; default-show all three if not.
  const visible = React.useMemo(() => {
    if (!availableScopeIds) return SCOPE_CHIP_DEFS;
    const set = availableScopeIds instanceof Set
      ? availableScopeIds
      : new Set(availableScopeIds);
    return SCOPE_CHIP_DEFS.filter((scope) => set.has(scope.id));
  }, [availableScopeIds]);

  if (visible.length === 0) return null;

  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      data-testid="scope-chips"
    >
      <Typography variant="body2" color="text.secondary" sx={{ mr: 0.25 }}>
        Jump to:
      </Typography>
      {visible.map((scope) => {
        const active = activeScopeId === scope.id;
        return (
          <Chip
            key={scope.id}
            label={scope.label}
            size="small"
            color={active ? "primary" : "default"}
            variant={active ? "filled" : "outlined"}
            onClick={() => onJump(scope.id)}
            data-testid={`scope-chip-${scope.id}`}
            sx={{ fontWeight: active ? 600 : 500 }}
          />
        );
      })}
    </Stack>
  );
}
