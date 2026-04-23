import * as React from "react";
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { StatusChip, filterErrorsForRow } from "./StatusChip";
import {
  activityRequiresDetails,
  getAllowedUnits,
  isRepeatableActivity,
} from "./activityDrafts";
import { formatNumericDisplay, parseNumericInput } from "./numericFormat";

// Numeric text field that formats on blur. We keep the draft string in
// local state so the caret doesn't jump while typing.
function NumericField({ value, onChange, ...rest }) {
  const [draft, setDraft] = React.useState(() => {
    if (value === "" || value == null) return "";
    const parsed = parseNumericInput(value);
    return parsed == null ? String(value) : formatNumericDisplay(parsed);
  });

  // Sync down when the outside value changes to a different parsed number.
  React.useEffect(() => {
    const parsed = parseNumericInput(value);
    const currentParsed = parseNumericInput(draft);
    if (parsed !== currentParsed) {
      setDraft(value === "" || value == null ? "" : (parsed == null ? String(value) : formatNumericDisplay(parsed)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <TextField
      {...rest}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        onChange(next);
      }}
      onBlur={() => {
        const parsed = parseNumericInput(draft);
        if (parsed != null) {
          const formatted = formatNumericDisplay(parsed);
          setDraft(formatted);
          onChange(formatted);
        }
      }}
      inputProps={{ inputMode: "decimal", autoComplete: "off", spellCheck: false, ...(rest.inputProps || {}) }}
    />
  );
}

export default function RowByRowView({
  activities,
  activityTypesById,
  facilityOptions,
  activityOptions,
  updateDraft,
  addActivity,
  removeActivity,
  openDetails,
  catalogError,
  calcErrors = [],
}) {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="h6">Activity Inputs</Typography>
        <Button variant="outlined" onClick={addActivity}>
          Add Activity Row
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Use this view for one-off edits. Bulk paste, spreadsheet-style entry, and Enter-to-next-row navigation are available in the By Activity and By Facility views.
      </Typography>
      {catalogError ? (
        <Alert severity="error" sx={{ mb: 1 }}>
          Failed to load activity catalog: {catalogError}
        </Alert>
      ) : null}
      <TableContainer sx={{ maxHeight: 520, border: "1px solid", borderColor: "divider", borderRadius: 2, overflowX: "auto" }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell>Facility</TableCell>
              <TableCell>Activity</TableCell>
              <TableCell>Activity Value</TableCell>
              <TableCell>Unit</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Details</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {activities.map((draft) => {
              const activityType = activityTypesById[draft.activity_type_id];
              const unitOptions = getAllowedUnits(activityType);
              const rowErrors = filterErrorsForRow(calcErrors, draft.facility_id, draft.activity_type_id);
              return (
                <TableRow key={draft.id}>
                  <TableCell sx={{ minWidth: 210 }}>
                    <Select
                      size="small"
                      value={draft.facility_id}
                      onChange={(event) => updateDraft(draft.id, { facility_id: event.target.value })}
                      fullWidth
                    >
                      {facilityOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell sx={{ minWidth: 280 }}>
                    <Select
                      size="small"
                      value={draft.activity_type_id}
                      onChange={(event) => updateDraft(draft.id, { activity_type_id: event.target.value })}
                      fullWidth
                    >
                      {activityOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell sx={{ minWidth: 160 }}>
                    <NumericField
                      size="small"
                      value={draft.activity.value}
                      onChange={(next) => updateDraft(draft.id, { activity: { ...draft.activity, value: next } })}
                      fullWidth
                    />
                  </TableCell>
                  <TableCell sx={{ minWidth: 170 }}>
                    <Select
                      size="small"
                      value={draft.activity.unit}
                      onChange={(event) => updateDraft(draft.id, { activity: { ...draft.activity, unit: event.target.value } })}
                      fullWidth
                    >
                      {unitOptions.map((unit) => (
                        <MenuItem key={unit} value={unit}>
                          {unit}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell sx={{ minWidth: 160 }}>
                    <StatusChip draft={draft} activityType={activityType} rowErrors={rowErrors} />
                  </TableCell>
                  <TableCell sx={{ minWidth: 120 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!activityType}
                      onClick={() => openDetails(draft.id)}
                    >
                      {isRepeatableActivity(activityType) ? "Entry Details" : activityRequiresDetails(activityType) ? "Edit" : "View"}
                    </Button>
                  </TableCell>
                  <TableCell sx={{ minWidth: 120 }}>
                    <Button color="error" size="small" onClick={() => removeActivity(draft.id)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

export { NumericField };
