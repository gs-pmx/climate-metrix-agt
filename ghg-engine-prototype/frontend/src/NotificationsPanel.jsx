import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { buildNotifications } from "./notices";

// Phase F1.2 — Notifications panel.
//
// Replaces the persistent top-of-page banners (CoverageBanner + the
// stack-collapsed-to-row NoticesBanner) with a side drawer triggered
// from the sidebar's notifications icon. Same data, different
// surface; see ``notices.js`` for the pure builders.
//
// The panel renders two sections in priority order:
//
//   * Coverage status — a single Alert with the same messaging the
//     banner used to show, plus a "View details" affordance for
//     missing / orphaned / errored sources.
//   * Catalog advisories — per-activity-type notes about partial or
//     planned activities the user has data for.
//
// When everything is clean the panel still renders so the user can
// confirm nothing is wrong; it just shows a single success row.

export default function NotificationsPanel({
  open,
  onClose,
  coverage,
  activities,
  activityTypesById = {},
  activityLabelById = {},
}) {
  const { items } = React.useMemo(
    () => buildNotifications({ coverage, activities, activityTypesById }),
    [coverage, activities, activityTypesById],
  );

  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailMode, setDetailMode] = React.useState("missing");

  const detailRows = React.useMemo(() => {
    if (!coverage) return [];
    if (detailMode === "errored") return coverage.erroredPairs || [];
    if (detailMode === "orphaned") return coverage.orphanedPairs || [];
    return coverage.missingPairs || [];
  }, [coverage, detailMode]);

  const detailTitle = (() => {
    if (detailMode === "errored") return "Sources with calculation errors";
    if (detailMode === "orphaned") return "Excluded activity data";
    return "Sources missing data";
  })();

  const openDetails = (kind) => {
    setDetailMode(kind);
    setDetailOpen(true);
  };

  const coverageItems = items.filter((n) => n.id.startsWith("coverage::"));
  const advisoryItems = items.filter((n) => !n.id.startsWith("coverage::"));

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        PaperProps={{ sx: { width: { xs: "100%", sm: 420 } } }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}
        >
          <Typography variant="h6">Notifications</Typography>
          <IconButton size="small" onClick={onClose} aria-label="close notifications">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Box sx={{ px: 2, py: 2, overflowY: "auto" }}>
          <Stack spacing={2.5}>
            <Box>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ display: "block", mb: 1 }}
              >
                Coverage
              </Typography>
              {coverageItems.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Configure source applicability on a Reporting Unit to start
                  tracking coverage.
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {coverageItems.map((n) => (
                    <Alert
                      key={n.id}
                      severity={n.severity}
                      variant="outlined"
                      action={
                        n.detailKind ? (
                          <Button
                            color="inherit"
                            size="small"
                            onClick={() => openDetails(n.detailKind)}
                          >
                            View details
                          </Button>
                        ) : null
                      }
                    >
                      {n.title ? <strong>{n.title}: </strong> : null}
                      {n.message}
                    </Alert>
                  ))}
                </Stack>
              )}
            </Box>

            <Divider />

            <Box>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ display: "block", mb: 1 }}
              >
                Catalog advisories
              </Typography>
              {advisoryItems.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No partial or planned activity types in use.
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {advisoryItems.map((n) => (
                    <Alert key={n.id} severity={n.severity} variant="outlined">
                      {n.title ? <strong>{n.title}: </strong> : null}
                      {n.message}
                    </Alert>
                  ))}
                </Stack>
              )}
            </Box>
          </Stack>
        </Box>
      </Drawer>

      <Dialog
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{detailTitle}</DialogTitle>
        <DialogContent dividers>
          {detailRows.length === 0 ? (
            <Typography color="text.secondary">Nothing to show.</Typography>
          ) : (
            <List dense disablePadding>
              {detailRows.map((pair, idx) => {
                const unitName =
                  pair.unit?.facility_name?.trim() || "Untitled Reporting Unit";
                const activityLabel =
                  activityLabelById[pair.activityTypeId] || pair.activityTypeId;
                const secondary =
                  detailMode === "orphaned" && pair.draftCount
                    ? `${pair.draftCount} draft ${
                        pair.draftCount === 1 ? "entry" : "entries"
                      } preserved but not in inventory`
                    : null;
                return (
                  <ListItem
                    key={`${pair.unit?.id || idx}::${pair.activityTypeId}`}
                    disableGutters
                  >
                    <ListItemText
                      primary={`${unitName}: ${activityLabel}`}
                      secondary={secondary}
                    />
                  </ListItem>
                );
              })}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
