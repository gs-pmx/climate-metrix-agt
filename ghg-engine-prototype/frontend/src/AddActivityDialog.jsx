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
  Divider,
  FormControlLabel,
  Stack,
  Typography,
} from "@mui/material";
import { buildActivitySelection } from "./configureSources";
import { groupActivitiesByScope } from "./applicability";

// Mirror of AddReportingUnitDialog for the By Reporting Unit view.
//
// The By Activity view has a "+ Add Reporting Unit" button on each
// activity accordion header: "this activity, which RUs should track it?"
// The symmetric flow for By Reporting Unit is: "this RU, which
// activities should it track?" Configure Sources (the tag library
// dialog) does the comprehensive version of that; this dialog is the
// quicker, targeted cousin that opens from the card header itself.
//
// Props:
//   open - bool
//   onClose()
//   reportingUnit - {id, facility_name, applicable_activity_types}
//   activityCatalog - selectable activity-type catalog list
//   existingActivitiesByPair - Set<string> "fid::atid" pair keys with draft data
//   onSave(checkedById: Record<activity_type_id, boolean>)
//
// The onSave contract matches `makeApplyPerReportingUnitUpdate` in
// configureSources.js — pass the map straight into the updater factory.
export default function AddActivityDialog({
  open,
  onClose,
  reportingUnit,
  activityCatalog,
  existingActivitiesByPair,
  onSave,
}) {
  const selection = React.useMemo(
    () => buildActivitySelection(reportingUnit, activityCatalog || []),
    [reportingUnit, activityCatalog],
  );

  // checkedById mirrors `selection` at open, then tracks toggles.
  const [checkedById, setCheckedById] = React.useState(() => {
    const out = {};
    for (const row of selection) out[row.activityType.activity_type_id] = row.checked;
    return out;
  });

  React.useEffect(() => {
    if (!open) return;
    const out = {};
    for (const row of selection) out[row.activityType.activity_type_id] = row.checked;
    setCheckedById(out);
  }, [open, selection]);

  const handleToggle = (atId) => {
    setCheckedById((prev) => ({ ...prev, [atId]: !prev[atId] }));
  };

  const handleSave = () => {
    onSave?.(checkedById);
  };

  // Group rendering so users can scan by scope, matching the existing
  // ConfigureSourcesDialog's scope-oriented layout vocabulary.
  const groups = React.useMemo(
    () => groupActivitiesByScope(activityCatalog || []),
    [activityCatalog],
  );

  const empty = !Array.isArray(activityCatalog) || activityCatalog.length === 0;

  return (
    <Dialog open={Boolean(open)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Add Activity
        {reportingUnit?.facility_name ? (
          <Typography variant="body2" color="text.secondary">
            {reportingUnit.facility_name}
          </Typography>
        ) : null}
      </DialogTitle>
      <DialogContent dividers sx={{ maxHeight: 520 }}>
        {empty ? (
          <Alert severity="info">
            No activity types available in the catalog.
          </Alert>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Toggle which activity types this Reporting Unit should track. Use Configure Sources for the full tag-library view.
            </Typography>
            <Stack spacing={2}>
              {groups.map((group) => (
                <Box key={group.key}>
                  <Typography variant="overline" sx={{ color: "text.secondary", letterSpacing: 1 }}>
                    {group.label}
                  </Typography>
                  <Divider sx={{ mb: 0.5 }} />
                  <Stack>
                    {group.activities.map((activityType) => {
                      const id = activityType.activity_type_id;
                      const isChecked = Boolean(checkedById[id]);
                      const initiallyChecked = Array.isArray(reportingUnit?.applicable_activity_types)
                        && reportingUnit.applicable_activity_types.includes(id);
                      const hasData = existingActivitiesByPair
                        && (existingActivitiesByPair instanceof Set
                          ? existingActivitiesByPair.has(`${reportingUnit?.id}::${id}`)
                          : Boolean(existingActivitiesByPair[`${reportingUnit?.id}::${id}`]));
                      const warn = initiallyChecked && !isChecked && hasData;
                      return (
                        <Box key={id} sx={{ py: 0.25 }}>
                          <FormControlLabel
                            control={(
                              <Checkbox
                                size="small"
                                checked={isChecked}
                                onChange={() => handleToggle(id)}
                              />
                            )}
                            label={activityType.label}
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
                </Box>
              ))}
            </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={empty}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
