import * as React from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

// Phase D2 — coverage banner shown above the data-entry surfaces.
//
// One persistent banner that classifies the project's source coverage
// into one of:
//   - all complete (success)
//   - missing data (warning)
//   - calc errors  (error)
//   - orphaned data (info)
//
// When `totalApplicable === 0` (no applicable lists configured anywhere)
// the banner stays hidden — the planning model is a user opt-in and we
// don't want to nag projects that haven't engaged with it yet.
//
// Dismissible per-session via local useState (not persisted) so users
// can hide it once they've absorbed the message but it returns next
// session as a fresh prompt.
export default function CoverageBanner({
  coverage,
  activityLabelById = {},
}) {
  const [dismissed, setDismissed] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [detailMode, setDetailMode] = React.useState("missing");

  if (!coverage || coverage.totalApplicable === 0) return null;
  if (dismissed) return null;

  const total = coverage.totalApplicable;
  const { missing, errored, orphaned, complete } = coverage;

  let severity = "success";
  let message;
  let detailKind = null;
  if (errored > 0) {
    severity = "error";
    message = `${errored} of ${total} sources have calculation errors.`;
    detailKind = "errored";
  } else if (missing > 0) {
    severity = "warning";
    message = `${missing} of ${total} sources have no data yet.`;
    detailKind = "missing";
  } else if (orphaned > 0) {
    severity = "info";
    message = `All ${total} sources complete, ${orphaned} ${orphaned === 1 ? "activity has" : "activities have"} data that isn't included in your inventory.`;
    detailKind = "orphaned";
  } else {
    severity = "success";
    message = `All sources have data and calculate cleanly (${complete}/${total}).`;
  }

  const openDetails = (kind) => {
    setDetailMode(kind);
    setDetailOpen(true);
  };

  const detailRows = (() => {
    if (detailMode === "errored") return coverage.erroredPairs;
    if (detailMode === "orphaned") return coverage.orphanedPairs;
    return coverage.missingPairs;
  })();
  const detailTitle = (() => {
    if (detailMode === "errored") return "Sources with calculation errors";
    if (detailMode === "orphaned") return "Orphaned activity data";
    return "Sources missing data";
  })();

  return (
    <>
      <Alert
        severity={severity}
        data-testid="coverage-banner"
        action={
          <Stack direction="row" spacing={0.5} alignItems="center">
            {detailKind ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => openDetails(detailKind)}
                data-testid="coverage-banner-view-details"
              >
                View details
              </Button>
            ) : null}
            <IconButton
              size="small"
              color="inherit"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss coverage banner"
              data-testid="coverage-banner-dismiss"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        }
      >
        {message}
      </Alert>

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
                const unitName = pair.unit?.facility_name?.trim() || "Untitled Reporting Unit";
                const activityLabel = activityLabelById[pair.activityTypeId] || pair.activityTypeId;
                const secondary = detailMode === "orphaned" && pair.draftCount
                  ? `${pair.draftCount} draft ${pair.draftCount === 1 ? "entry" : "entries"} preserved but not in inventory`
                  : null;
                return (
                  <ListItem key={`${pair.unit?.id || idx}::${pair.activityTypeId}`} disableGutters>
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
