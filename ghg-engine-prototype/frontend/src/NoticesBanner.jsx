import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";

// Phase C4 warning-stack consolidation.
//
// Prior to this phase, Activity Inputs stacked every partial / unsupported
// notice as its own full-width Alert at the top of the page. Users read
// them once and then spent the rest of the session ignoring them, which
// created alert fatigue and ate real estate.
//
// This component applies the three mitigations from the feedback plan:
//
//   (a) Downgrades purely-informational notices (partial / unsupported
//       activities) from persistent banners into a single compact badge
//       that hides the details until the user asks.
//   (b) Consolidates the stack into one row: a bell icon + count chip
//       that expands on click to show the per-notice list.
//   (c) Makes the consolidated row dismissible with session-scoped state
//       (a simple React state set here — see `storageKey` if we later
//       want persistence across reloads).
//
// Props:
//   notices  - array of { id, severity, title, message }
//   storageKey - optional localStorage key to persist the dismissed set
//                across reloads. When omitted, dismissed state lives in
//                component state for the session only.
export default function NoticesBanner({ notices = [], storageKey = "" }) {
  const [expanded, setExpanded] = React.useState(false);
  const [dismissedIds, setDismissedIds] = React.useState(() => {
    if (!storageKey) return new Set();
    try {
      const raw = window.localStorage.getItem(storageKey);
      const list = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(list) ? list : []);
    } catch (_) {
      return new Set();
    }
  });

  const persistDismissed = React.useCallback(
    (nextSet) => {
      if (!storageKey) return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify([...nextSet]));
      } catch (_) {
        /* storage may be unavailable — best-effort persistence only */
      }
    },
    [storageKey],
  );

  const visibleNotices = React.useMemo(
    () => (notices || []).filter((n) => n && !dismissedIds.has(n.id)),
    [notices, dismissedIds],
  );

  const dismissOne = (id) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      persistDismissed(next);
      return next;
    });
  };

  const dismissAll = () => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      for (const n of visibleNotices) next.add(n.id);
      persistDismissed(next);
      return next;
    });
    setExpanded(false);
  };

  if (!visibleNotices.length) return null;

  const count = visibleNotices.length;
  // Prefer the most severe chip color so a genuine warning gets a visible
  // accent even when it is collapsed into the count badge.
  const severities = visibleNotices.map((n) => n.severity || "info");
  const aggregateSeverity = severities.includes("error")
    ? "error"
    : severities.includes("warning")
      ? "warning"
      : "info";

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1,
        px: 1.25,
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
      }}
      data-testid="notices-banner"
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <NotificationsNoneIcon fontSize="small" color="action" />
        <Chip
          size="small"
          color={aggregateSeverity === "info" ? "default" : aggregateSeverity}
          variant={aggregateSeverity === "info" ? "outlined" : "filled"}
          label={`${count} ${count === 1 ? "notice" : "notices"}`}
        />
        <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
          Catalog advisories (partial / planned activity types in use).
        </Typography>
        <Button
          size="small"
          onClick={() => setExpanded((v) => !v)}
          endIcon={(
            <ExpandMoreIcon
              sx={{
                transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 120ms ease",
              }}
            />
          )}
        >
          {expanded ? "Hide" : "Show"}
        </Button>
        <Button size="small" color="inherit" onClick={dismissAll}>
          Dismiss all
        </Button>
      </Stack>
      <Collapse in={expanded} unmountOnExit>
        <Stack spacing={0.75} sx={{ mt: 0.5 }}>
          {visibleNotices.map((n) => (
            <Alert
              key={n.id}
              severity={n.severity || "info"}
              variant="outlined"
              action={(
                <IconButton size="small" onClick={() => dismissOne(n.id)} aria-label={`Dismiss ${n.title || n.id}`}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              )}
              sx={{ py: 0.25 }}
            >
              {n.title ? <strong>{n.title}: </strong> : null}
              {n.message}
            </Alert>
          ))}
          {visibleNotices.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No active notices.
            </Typography>
          ) : null}
        </Stack>
      </Collapse>
      <Box />
    </Paper>
  );
}
