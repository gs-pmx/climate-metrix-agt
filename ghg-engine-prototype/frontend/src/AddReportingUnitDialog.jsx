import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Typography,
} from "@mui/material";
import { buildReportingUnitSelection } from "./configureSources";

// Post-C4 round-4 item 4: shallow-compare two {id:boolean} maps. Used to
// detect whether the user has toggled anything relative to the RU's
// current applicable list before allowing a silent close.
function checkedMapsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (Boolean(a[key]) !== Boolean(b[key])) return false;
  }
  return true;
}

// Per-activity dialog used from the By Activity view header. The dialog
// lists every existing Reporting Unit with a checkbox indicating whether
// the header activity_type_id is in its applicable_activity_types list.
// Saving applies the delta via the parent-provided onSave(checkedById)
// callback which is responsible for mutating state.
//
// The warn-on-uncheck semantics mirror ConfigureSourcesDialog but are
// evaluated per-RU.
//
// Props:
//   open - bool
//   onClose()
//   activityType - the header {activity_type_id, label}
//   reportingUnits - full RU list from app state
//   existingActivitiesByPair - Set<string> of "fid::atid" pair keys with draft data
//   onSave(checkedById: Record<string, boolean>)
export default function AddReportingUnitDialog({
  open,
  onClose,
  activityType,
  reportingUnits,
  existingActivitiesByPair,
  onSave,
}) {
  const initial = React.useMemo(
    () => buildReportingUnitSelection(reportingUnits, activityType?.activity_type_id),
    [reportingUnits, activityType],
  );

  // checkedById mirrors `initial` at open, then tracks toggles.
  const [checkedById, setCheckedById] = React.useState(() => {
    const out = {};
    for (const row of initial) out[row.reportingUnit.id] = row.checked;
    return out;
  });
  // Post-C4 round-4 item 4: snapshot initial checked state for
  // unsaved-changes detection on close without save.
  const [initialCheckedById, setInitialCheckedById] = React.useState(() => {
    const out = {};
    for (const row of initial) out[row.reportingUnit.id] = row.checked;
    return out;
  });
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const out = {};
    for (const row of initial) out[row.reportingUnit.id] = row.checked;
    setCheckedById(out);
    setInitialCheckedById(out);
    setConfirmOpen(false);
  }, [open, initial]);

  const handleToggle = (ruId) => {
    setCheckedById((prev) => ({ ...prev, [ruId]: !prev[ruId] }));
  };

  const handleSave = () => {
    onSave?.(checkedById);
  };

  const isDirty = !checkedMapsEqual(checkedById, initialCheckedById);
  const handleAttemptClose = () => {
    if (isDirty) {
      setConfirmOpen(true);
      return;
    }
    onClose?.();
  };

  const atId = activityType?.activity_type_id;
  const empty = !Array.isArray(reportingUnits) || reportingUnits.length === 0;

  return (
    <Dialog open={Boolean(open)} onClose={handleAttemptClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Add Reporting Unit
        {activityType?.label ? (
          <Typography variant="body2" color="text.secondary">
            {activityType.label}
          </Typography>
        ) : null}
      </DialogTitle>
      <DialogContent dividers>
        {empty ? (
          <Alert severity="info">
            No Reporting Units exist yet. Add one in the Reporting Units tab to get started.
          </Alert>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Toggle which Reporting Units should track this activity type.
            </Typography>
            <Stack>
              {(reportingUnits || []).map((ru) => {
                const isChecked = Boolean(checkedById[ru.id]);
                const initiallyChecked = Array.isArray(ru.applicable_activity_types)
                  && ru.applicable_activity_types.includes(atId);
                const hasData = existingActivitiesByPair
                  && (existingActivitiesByPair instanceof Set
                    ? existingActivitiesByPair.has(`${ru.id}::${atId}`)
                    : Boolean(existingActivitiesByPair[`${ru.id}::${atId}`]));
                const warn = initiallyChecked && !isChecked && hasData;
                return (
                  <Box key={ru.id} sx={{ py: 0.25 }}>
                    <FormControlLabel
                      control={(
                        <Checkbox
                          size="small"
                          checked={isChecked}
                          onChange={() => handleToggle(ru.id)}
                        />
                      )}
                      label={ru.facility_name || ru.id}
                    />
                    {warn ? (
                      <Typography
                        variant="caption"
                        color="warning.main"
                        sx={{ display: "block", ml: 4 }}
                      >
                        This Reporting Unit has existing data - will be hidden, not deleted.
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
            </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleAttemptClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={empty}>Save</Button>
      </DialogActions>
      {/* Post-C4 round-4 item 4: unsaved-changes confirmation — same
          Discard / Cancel / Save branch set as ConfigureSourcesDialog. */}
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Save changes?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            You have unsaved Reporting Unit selections. Save before closing, or discard to revert.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            color="inherit"
            onClick={() => {
              setConfirmOpen(false);
              setCheckedById(initialCheckedById);
              onClose?.();
            }}
          >
            Discard
          </Button>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setConfirmOpen(false);
              handleSave();
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
