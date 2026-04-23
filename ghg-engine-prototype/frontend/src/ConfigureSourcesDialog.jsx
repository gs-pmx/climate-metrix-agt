import * as React from "react";
import {
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
import {
  collectChecked,
  initialSetFromReportingUnit,
  shouldWarnOnUncheck,
  toggleActivity,
} from "./configureSources";
import { groupActivitiesByScope } from "./applicability";

// Configure-sources dialog for a single Reporting Unit.
//
// Pre-checks any activity types currently in
// `reportingUnit.applicable_activity_types`. When the user unchecks an
// activity that has associated draft data, shows an inline warn text so
// they understand the data is hidden, not deleted.
//
// Props:
//   open - bool; controls visibility.
//   onClose() - fires on cancel/backdrop.
//   reportingUnit - {id, facility_name, applicable_activity_types, ...}
//   activityCatalog - full catalog list (each {activity_type_id, label, scope})
//   existingActivitiesByPair - Set<string> of "facility_id::activity_type_id"
//     keys that currently have draft data. Used to decide if an uncheck
//     warning should appear. Optional; missing -> no warnings.
//   onSave(newList: string[]) - fires when user confirms; `newList` is the
//     updated applicable_activity_types value.
export default function ConfigureSourcesDialog({
  open,
  onClose,
  reportingUnit,
  activityCatalog,
  existingActivitiesByPair,
  onSave,
}) {
  // Seed the dialog's local checked-state each time it opens so cancel
  // cleanly reverts in-flight toggles.
  const [checked, setChecked] = React.useState(() => initialSetFromReportingUnit(reportingUnit));
  React.useEffect(() => {
    if (open) setChecked(initialSetFromReportingUnit(reportingUnit));
  }, [open, reportingUnit]);

  const groups = React.useMemo(() => groupActivitiesByScope(activityCatalog || []), [activityCatalog]);

  const handleToggle = (activityTypeId) => {
    setChecked((prev) => toggleActivity(prev, activityTypeId));
  };

  const handleSave = () => {
    const next = collectChecked(checked, activityCatalog || []);
    onSave?.(next);
  };

  return (
    <Dialog open={Boolean(open)} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Configure sources
        {reportingUnit?.facility_name ? (
          <Typography variant="body2" color="text.secondary">
            {reportingUnit.facility_name}
          </Typography>
        ) : null}
      </DialogTitle>
      <DialogContent dividers sx={{ maxHeight: 520 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Choose which activity types apply to this Reporting Unit. An empty list keeps the legacy "show all" behavior.
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
                  const isChecked = checked.has(id);
                  const warn = shouldWarnOnUncheck({
                    reportingUnit,
                    activityTypeId: id,
                    currentChecked: isChecked,
                    existingPairsSet: existingActivitiesByPair,
                  });
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
          {groups.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No activity types available in the catalog.
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
