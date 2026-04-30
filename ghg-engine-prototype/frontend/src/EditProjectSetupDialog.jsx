import * as React from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

// Phase F1.4 — Edit Project Setup dialog. After F1.4 the inventory_year,
// gwp_set, and include_trace settings are read-only by default and
// surface in the project header sub-line. This dialog is the single
// edit affordance for them. The parent owns the underlying state; the
// dialog snapshots it on open, lets the user edit a local copy, and
// commits via ``onSave`` when the user confirms.
//
// The dialog itself is the confirmation step — the inline warning
// makes it explicit that saved calc results are invalidated when any
// of these change. We don't stack a nested confirm dialog on top of
// it (that would feel redundant for a setting screen).
export default function EditProjectSetupDialog({
  open,
  onClose,
  inventoryYear,
  gwpSet,
  includeTrace,
  onSave,
}) {
  const [draftYear, setDraftYear] = React.useState(String(inventoryYear ?? ""));
  const [draftGwp, setDraftGwp] = React.useState(String(gwpSet ?? "AR6"));
  const [draftTrace, setDraftTrace] = React.useState(Boolean(includeTrace));

  // Re-snapshot the current values whenever the dialog re-opens so the
  // user sees the latest state every time, not whatever they typed in
  // a previous open-and-cancel cycle.
  React.useEffect(() => {
    if (open) {
      setDraftYear(String(inventoryYear ?? ""));
      setDraftGwp(String(gwpSet ?? "AR6"));
      setDraftTrace(Boolean(includeTrace));
    }
  }, [open, inventoryYear, gwpSet, includeTrace]);

  const yearNumber = Number(draftYear);
  const yearValid = Number.isFinite(yearNumber) && yearNumber > 1900 && yearNumber < 2100;

  const isDirty =
    String(inventoryYear ?? "") !== draftYear
    || String(gwpSet ?? "AR6") !== draftGwp
    || Boolean(includeTrace) !== draftTrace;

  const handleSave = () => {
    if (!yearValid) return;
    onSave?.({
      inventory_year: yearNumber,
      gwp_set: draftGwp,
      include_trace: draftTrace,
    });
  };

  return (
    <Dialog open={Boolean(open)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Edit Project Setup</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="Inventory Year"
            value={draftYear}
            onChange={(event) => setDraftYear(event.target.value)}
            error={Boolean(draftYear) && !yearValid}
            helperText={!yearValid && draftYear ? "Enter a four-digit year" : " "}
            fullWidth
            data-testid="edit-project-setup-year"
          />
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">
              GWP Set
            </Typography>
            <Select
              value={draftGwp}
              onChange={(event) => setDraftGwp(event.target.value)}
              size="small"
              data-testid="edit-project-setup-gwp"
            >
              <MenuItem value="AR6">AR6</MenuItem>
              <MenuItem value="AR5">AR5</MenuItem>
            </Select>
          </Stack>
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">
              Trace
            </Typography>
            <Select
              value={String(draftTrace)}
              onChange={(event) => setDraftTrace(event.target.value === "true")}
              size="small"
              data-testid="edit-project-setup-trace"
            >
              <MenuItem value="true">Include Trace</MenuItem>
              <MenuItem value="false">No Trace</MenuItem>
            </Select>
          </Stack>
          <Alert severity="warning" variant="outlined">
            Changing these values will invalidate saved calc results. Re-run the calculation
            after saving to refresh dashboards and audit rows.
          </Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          onClick={handleSave}
          variant="contained"
          disabled={!isDirty || !yearValid}
          data-testid="edit-project-setup-save"
        >
          Save Changes
        </Button>
      </DialogActions>
    </Dialog>
  );
}
