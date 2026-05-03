import * as React from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";

// Phase F2 PR 11 — manage-reporting-units dialog.
//
// Pre-PR-11 the Reporting Units tab stacked one ``ReportingUnitCard``
// per RU directly above the geo details table. With more than ~6 RUs
// (or any RU with a long source list pushing height) the geo table
// dropped well below the fold. PR 11 collapses the inline list into
// a tight summary line and moves the per-RU management into this
// dialog.
//
// Composition: the dialog body is the same ``ReportingUnitCard``
// stack as before, plus an "+ Add Reporting Unit" button at the top.
// The ``Configure sources`` button on each card opens the existing
// ``ConfigureSourcesDialog`` as a nested dialog — MUI handles
// the stacking and focus management.
//
// State, callbacks, and layout for ReportingUnitCard come from the
// parent (``ReportingUnitsTab``) which still owns the underlying
// reporting units state.
export default function ManageReportingUnitsDialog({
  open,
  onClose,
  reportingUnits,
  onAddReportingUnit,
  renderReportingUnitCard,
}) {
  return (
    <Dialog open={Boolean(open)} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Configure reporting units</DialogTitle>
      <DialogContent dividers>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ mb: 1.5 }}
        >
          <Typography variant="body2" color="text.secondary">
            Add new units, configure sources, or delete existing ones.
          </Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={onAddReportingUnit}
          >
            Add Reporting Unit
          </Button>
        </Stack>
        {reportingUnits.length === 0 ? (
          <Box sx={{ py: 4, textAlign: "center" }}>
            <Typography color="text.secondary">
              No reporting units yet. Click <em>Add Reporting Unit</em> to start.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={1}>
            {reportingUnits.map((ru) => renderReportingUnitCard(ru))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained">
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
