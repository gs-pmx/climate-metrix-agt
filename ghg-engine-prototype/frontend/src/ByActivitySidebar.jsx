import * as React from "react";
import {
  Box,
  Button,
  Chip,
  Collapse,
  Drawer,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MenuIcon from "@mui/icons-material/Menu";

import { sectionAnchorId } from "./categorizeForTOC";

// Phase C4 sidebar TOC for the Inputs by Activity view.
//
// Renders a collapsible table-of-contents grouped by Scope > Subcategory.
// On desktop the sidebar takes the first column of the panel. On narrow
// viewports the sidebar becomes a drawer that overlays rather than
// consuming horizontal real estate.
//
// Behavior:
//   - Click a subcategory row -> smooth-scroll the content to that
//     section's anchor id.
//   - Scope header is clickable -> toggles expansion of the scope's
//     subcategory list. Default: all scopes open.
//   - `activeSubcategoryId` (from scroll-spy in the parent) gets a
//     highlighted style.
//
// Props:
//   tree                 - groupByTOC output: [{ id, label, subcategories: [{ id, label, activities: [] }] }]
//   activeSubcategoryId  - the sub.id currently in view (scroll-spy)
//   scopeCollapsedState  - { [scope.id]: boolean } — true means collapsed
//   setScopeCollapsedState - setter for the above
//   onNavigate(scope.id, sub.id) - click handler, parent scrolls into view
//   sidebarOpen          - desktop-only collapse toggle
//   setSidebarOpen       - setter for the above
export default function ByActivitySidebar({
  tree = [],
  activeSubcategoryId = "",
  scopeCollapsedState,
  setScopeCollapsedState,
  onNavigate,
  sidebarOpen,
  setSidebarOpen,
}) {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down("md"));
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const toggleScope = (scopeId) => {
    setScopeCollapsedState((prev) => ({ ...prev, [scopeId]: !prev?.[scopeId] }));
  };

  const handleClickSubcategory = (scopeId, subId) => {
    onNavigate?.(scopeId, subId);
    if (narrow) setDrawerOpen(false);
  };

  const tocList = (
    <Stack spacing={0.5} sx={{ p: 1, minWidth: 220 }} data-testid="toc-list">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 0.5 }}>
        <Typography variant="overline" sx={{ letterSpacing: 1, color: "text.secondary", flexGrow: 1 }}>
          Navigation
        </Typography>
        {!narrow ? (
          <Tooltip title="Collapse sidebar">
            <IconButton size="small" onClick={() => setSidebarOpen(false)} aria-label="Collapse sidebar">
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>
      {tree.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
          No activities in this catalog.
        </Typography>
      ) : null}
      {tree.map((scope) => {
        const collapsed = Boolean(scopeCollapsedState?.[scope.id]);
        return (
          <Box key={scope.id}>
            <Button
              fullWidth
              size="small"
              onClick={() => toggleScope(scope.id)}
              startIcon={(
                <ExpandMoreIcon
                  fontSize="small"
                  sx={{
                    transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                    transition: "transform 120ms ease",
                  }}
                />
              )}
              sx={{
                justifyContent: "flex-start",
                textTransform: "none",
                color: "text.primary",
                fontWeight: 700,
                px: 1,
              }}
            >
              {scope.label}
            </Button>
            <Collapse in={!collapsed} unmountOnExit>
              <Stack spacing={0.25} sx={{ pl: 3.5, py: 0.25 }}>
                {scope.subcategories.map((sub) => {
                  const isActive = activeSubcategoryId === sub.id;
                  return (
                    <Button
                      key={sub.id}
                      size="small"
                      onClick={() => handleClickSubcategory(scope.id, sub.id)}
                      sx={{
                        justifyContent: "flex-start",
                        textTransform: "none",
                        color: isActive ? "primary.main" : "text.secondary",
                        fontWeight: isActive ? 700 : 500,
                        backgroundColor: isActive ? "action.selected" : "transparent",
                        px: 1,
                        py: 0.25,
                        minHeight: 28,
                        "&:hover": { backgroundColor: "action.hover" },
                      }}
                    >
                      <Box sx={{ flexGrow: 1, textAlign: "left" }}>{sub.label}</Box>
                      <Chip
                        size="small"
                        label={sub.activities.length}
                        sx={{
                          height: 18,
                          fontSize: 11,
                          ml: 1,
                          "& .MuiChip-label": { px: 0.75 },
                        }}
                        variant="outlined"
                      />
                    </Button>
                  );
                })}
              </Stack>
            </Collapse>
          </Box>
        );
      })}
    </Stack>
  );

  // Narrow viewport: drawer + floating "open navigation" button. The
  // drawer closes itself after a navigation click so the content is
  // visible again.
  if (narrow) {
    return (
      <>
        <Button
          size="small"
          variant="outlined"
          startIcon={<MenuIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ alignSelf: "flex-start", mb: 1 }}
          data-testid="toc-open-drawer"
        >
          Navigate
        </Button>
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} anchor="left">
          <Box sx={{ width: 280 }}>{tocList}</Box>
        </Drawer>
      </>
    );
  }

  if (!sidebarOpen) {
    return (
      <Tooltip title="Show navigation">
        <IconButton
          size="small"
          onClick={() => setSidebarOpen(true)}
          aria-label="Show navigation"
          sx={{ alignSelf: "flex-start", mt: 0.5 }}
          data-testid="toc-expand"
        >
          <ChevronRightIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        width: 260,
        flexShrink: 0,
        position: "sticky",
        // Stack below the sticky top bar (Layer 1) AND the view-selector
        // bar (Layer 2). Previously hardcoded to 72px, which caused the
        // TOC to be visually overlapped by the top bar. The CSS vars
        // resolve to the combined height of both sticky layers above.
        top: "calc(var(--sticky-top-height) + var(--sticky-secondary-height) + 16px)",
        alignSelf: "flex-start",
        maxHeight: "calc(100vh - var(--sticky-top-height) - var(--sticky-secondary-height) - 32px)",
        overflowY: "auto",
      }}
      data-testid="toc-sidebar"
    >
      {tocList}
    </Paper>
  );
}

// Re-export anchor helper so consumers don't need to import from two
// modules.
export { sectionAnchorId };
