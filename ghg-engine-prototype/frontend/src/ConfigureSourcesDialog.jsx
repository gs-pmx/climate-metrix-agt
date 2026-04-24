import * as React from "react";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  STARTER_DEFAULT_IDS,
  addDefaultsToChecked,
  collectChecked,
  initialSetFromReportingUnit,
  selectAllInScope,
  setDefaultsAsChecked,
  toggleActivity,
} from "./configureSources";
import { categorizeForTOC } from "./categorizeForTOC";
import { colorForActivity, colorForSubcategory } from "./categoryColors";

// Configure-sources dialog for a single Reporting Unit.
//
// Post-C4 redesign (items 6 + 7): panel order is Selected (top) and
// Library (bottom). Selected is the "committed state" — elevated Paper
// with a prominent heading and a count chip, firmer border. Library is
// the "rest of the catalog" — no card, just a subdued section label
// with a faint divider, so it reads as lighter / less load-bearing.
// Pills themselves stay visually consistent across both panels so
// moving a pill between them feels continuous; what differs is the
// container around them.
//
// Behavior summary:
//   - Selected panel (top): three horizontal rows per scope plus a
//     count chip and per-scope "Select all" button. Clicking the x on
//     a pill moves it back to the library. The "Starter defaults"
//     button lives here because it mutates the selection.
//   - Library panel (bottom): all unselected activities, color-coded
//     by subcategory, grouped by scope. Clicking a library pill moves
//     it to the correct selected row based on its scope.
//   - Warn-on-uncheck: removing a pill that has draft data shows an
//     inline warn glyph + tooltip matching the legacy warn copy.
//
// Props stay identical to the previous iteration so callers do not
// need updating.
export default function ConfigureSourcesDialog({
  open,
  onClose,
  reportingUnit,
  activityCatalog,
  existingActivitiesByPair,
  onSave,
}) {
  const [checked, setChecked] = React.useState(() => initialSetFromReportingUnit(reportingUnit));
  React.useEffect(() => {
    if (open) setChecked(initialSetFromReportingUnit(reportingUnit));
  }, [open, reportingUnit]);

  const catalog = activityCatalog || [];

  // Pre-compute the scope/subcategory classification for every catalog
  // entry so we can bucket pills without recomputing inside render maps.
  const catalogWithCategory = React.useMemo(
    () => catalog.map((at) => ({
      activityType: at,
      ...categorizeForTOC(at),
    })),
    [catalog],
  );

  // Bucket unselected activities by scope, then sort by subcategory id
  // so visually similar pills cluster together within each scope column.
  const libraryByScope = React.useMemo(() => {
    const buckets = { scope_1: [], scope_2: [], scope_3: [], other: [] };
    for (const row of catalogWithCategory) {
      if (checked.has(row.activityType.activity_type_id)) continue;
      const key = row.scope in buckets ? row.scope : "other";
      buckets[key].push(row);
    }
    for (const list of Object.values(buckets)) {
      list.sort((a, b) => {
        if (a.subcategory < b.subcategory) return -1;
        if (a.subcategory > b.subcategory) return 1;
        return String(a.activityType.label || "").localeCompare(String(b.activityType.label || ""));
      });
    }
    return buckets;
  }, [catalogWithCategory, checked]);

  // Bucket selected activities by scope for the selected panel's three
  // wrapping rows. Preserves catalog order within each scope.
  const selectedByScope = React.useMemo(() => {
    const buckets = { scope_1: [], scope_2: [], scope_3: [], other: [] };
    for (const row of catalogWithCategory) {
      if (!checked.has(row.activityType.activity_type_id)) continue;
      const key = row.scope in buckets ? row.scope : "other";
      buckets[key].push(row);
    }
    return buckets;
  }, [catalogWithCategory, checked]);

  const handleTogglePill = (activityTypeId) => {
    setChecked((prev) => toggleActivity(prev, activityTypeId));
  };

  const handleSelectAllScope = (scopeId) => {
    setChecked((prev) => {
      const scopeMatch = (raw) => categorizeForTOC({ scope: raw }).scope === scopeId;
      return selectAllInScope(prev, catalog, (s) => scopeMatch(s));
    });
  };

  const handleDefaults = () => {
    setChecked((prev) => {
      if (!prev || prev.size === 0) return setDefaultsAsChecked(catalog);
      return addDefaultsToChecked(prev, catalog);
    });
  };

  const handleSave = () => {
    const next = collectChecked(checked, catalog);
    onSave?.(next);
  };

  const SCOPE_ROWS = [
    { id: "scope_1", label: "Scope 1 - Direct emissions" },
    { id: "scope_2", label: "Scope 2 - Purchased energy" },
    { id: "scope_3", label: "Scope 3 - Value chain" },
  ];

  const defaultsLabel = (!checked || checked.size === 0) ? "Use starter defaults" : "Add starter defaults";

  const hasOther = (libraryByScope.other.length + selectedByScope.other.length) > 0;

  return (
    <Dialog open={Boolean(open)} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        Configure sources
        {reportingUnit?.facility_name ? (
          <Typography variant="body2" color="text.secondary">
            {reportingUnit.facility_name}
          </Typography>
        ) : null}
      </DialogTitle>
      <DialogContent dividers sx={{ maxHeight: "80vh" }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Click a pill in the library to add it. Click the x on a selected pill to remove it. Pills are color-coded by category.
        </Typography>

        {/* Selected panel (top) — committed state. Elevated Paper, firm
            border, prominent h6 heading, count chip in header, subtle
            tinted background. */}
        <Paper
          elevation={3}
          sx={{
            p: 1.75,
            mb: 2.5,
            border: (theme) => `1px solid ${theme.palette.mode === "dark"
              ? "rgba(121, 186, 224, 0.35)"
              : "rgba(0, 78, 130, 0.25)"}`,
            backgroundColor: (theme) => theme.palette.mode === "dark"
              ? "rgba(78, 159, 207, 0.06)"
              : "rgba(0, 78, 130, 0.03)",
          }}
          data-testid="tag-selected-panel"
        >
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.25 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, flexGrow: 1 }}>
              Selected for this Reporting Unit
            </Typography>
            <Chip
              size="small"
              color="primary"
              label={`${checked.size} selected`}
              data-testid="selected-count-chip"
            />
            <Button size="small" variant="outlined" onClick={handleDefaults}>
              {defaultsLabel}
            </Button>
          </Stack>
          <Stack spacing={1.25}>
            {SCOPE_ROWS.map((scope) => {
              const pills = selectedByScope[scope.id] || [];
              return (
                <Box key={scope.id}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <Typography variant="overline" sx={{ color: "text.secondary", letterSpacing: 1, flexGrow: 1 }}>
                      {scope.label}
                    </Typography>
                    <Button size="small" onClick={() => handleSelectAllScope(scope.id)}>
                      Select all {scope.label.split(" - ")[0]}
                    </Button>
                  </Stack>
                  <Divider sx={{ mb: 0.75 }} />
                  {pills.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No {scope.label.split(" - ")[0]} activities selected yet.
                    </Typography>
                  ) : (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                      {pills.map((row) => {
                        const id = row.activityType.activity_type_id;
                        // The legacy `shouldWarnOnUncheck` helper was
                        // parameterized for a checkbox model. In the
                        // pill UX we surface warn whenever the RU has
                        // existing draft data for the activity, because
                        // removing the pill hides (not deletes) that
                        // data.
                        const hasExistingData = (() => {
                          if (!existingActivitiesByPair || !reportingUnit?.id) return false;
                          const key = `${reportingUnit.id}::${id}`;
                          return existingActivitiesByPair instanceof Set
                            ? existingActivitiesByPair.has(key)
                            : Boolean(existingActivitiesByPair[key]);
                        })();
                        return (
                          <SelectedPill
                            key={id}
                            activityType={row.activityType}
                            subcategoryId={row.subcategory}
                            onRemove={() => handleTogglePill(id)}
                            warn={hasExistingData}
                          />
                        );
                      })}
                    </Box>
                  )}
                </Box>
              );
            })}
            {selectedByScope.other.length > 0 ? (
              <Box>
                <Typography variant="overline" sx={{ color: "text.secondary", letterSpacing: 1 }}>
                  Other
                </Typography>
                <Divider sx={{ mb: 0.75 }} />
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                  {selectedByScope.other.map((row) => (
                    <SelectedPill
                      key={row.activityType.activity_type_id}
                      activityType={row.activityType}
                      subcategoryId={row.subcategory}
                      onRemove={() => handleTogglePill(row.activityType.activity_type_id)}
                      warn={false}
                    />
                  ))}
                </Box>
              </Box>
            ) : null}
          </Stack>
        </Paper>

        {/* Library panel (bottom) — available options. No card shell,
            just a subdued label + faint divider. Lighter visual weight
            than the Selected panel above so the user's eye lands on
            the committed state first. */}
        <Box data-testid="tag-library-panel" sx={{ px: 0.5 }}>
          <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.5 }}>
            <Typography variant="subtitle2" sx={{ color: "text.secondary", fontWeight: 600 }}>
              Source library
            </Typography>
            <Typography variant="caption" color="text.secondary">
              click a pill to add it
            </Typography>
          </Stack>
          <Divider sx={{ mb: 1.25 }} />
          <Stack spacing={1.5}>
            {SCOPE_ROWS.map((scope) => {
              const pills = libraryByScope[scope.id] || [];
              return (
                <Box key={scope.id}>
                  <Typography variant="overline" sx={{ color: "text.secondary", letterSpacing: 1 }}>
                    {scope.label}
                  </Typography>
                  <Divider sx={{ mb: 0.75 }} />
                  {pills.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      All {scope.label.split(" - ")[0]} activities are selected.
                    </Typography>
                  ) : (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                      {pills.map((row) => (
                        <LibraryPill
                          key={row.activityType.activity_type_id}
                          activityType={row.activityType}
                          subcategoryId={row.subcategory}
                          onClick={() => handleTogglePill(row.activityType.activity_type_id)}
                        />
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })}
            {hasOther && libraryByScope.other.length > 0 ? (
              <Box>
                <Typography variant="overline" sx={{ color: "text.secondary", letterSpacing: 1 }}>
                  Other
                </Typography>
                <Divider sx={{ mb: 0.75 }} />
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                  {libraryByScope.other.map((row) => (
                    <LibraryPill
                      key={row.activityType.activity_type_id}
                      activityType={row.activityType}
                      subcategoryId={row.subcategory}
                      onClick={() => handleTogglePill(row.activityType.activity_type_id)}
                    />
                  ))}
                </Box>
              </Box>
            ) : null}
          </Stack>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function LibraryPill({ activityType, subcategoryId, onClick }) {
  const color = colorForSubcategory(subcategoryId) || colorForActivity(activityType);
  return (
    <Chip
      size="small"
      icon={<AddIcon sx={{ color: `${color.fg} !important`, fontSize: 16 }} />}
      label={activityType.label}
      onClick={onClick}
      sx={{
        cursor: "pointer",
        backgroundColor: color.bg,
        color: color.fg,
        border: `1px solid ${color.border}`,
        fontWeight: 600,
        "&:hover": { filter: "brightness(0.96)" },
      }}
    />
  );
}

function SelectedPill({ activityType, subcategoryId, onRemove, warn }) {
  const color = colorForSubcategory(subcategoryId) || colorForActivity(activityType);
  const chip = (
    <Chip
      size="small"
      label={(
        <Stack direction="row" spacing={0.5} alignItems="center">
          {warn ? (
            <WarningAmberIcon sx={{ fontSize: 16, color: "warning.main" }} />
          ) : null}
          <span>{activityType.label}</span>
        </Stack>
      )}
      onDelete={onRemove}
      deleteIcon={(
        <IconButton size="small" onMouseDown={(e) => e.stopPropagation()} sx={{ p: 0.25 }}>
          <CloseIcon sx={{ fontSize: 14, color: color.fg }} />
        </IconButton>
      )}
      sx={{
        backgroundColor: color.bg,
        color: color.fg,
        border: `1px solid ${color.border}`,
        fontWeight: 600,
        "& .MuiChip-deleteIcon": { color: color.fg },
      }}
    />
  );
  if (!warn) return chip;
  return (
    <Tooltip title="This Reporting Unit has existing data for this activity - removing will hide, not delete.">
      <span>{chip}</span>
    </Tooltip>
  );
}

// Keep a named export for tests that want to reference the starter list.
export { STARTER_DEFAULT_IDS };
