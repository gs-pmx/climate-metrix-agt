import * as React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { DataGrid } from "@mui/x-data-grid";
import { RepeatableStatusChip, StatusChip, filterErrorsForRow } from "./StatusChip";
import {
  EMPTY_ACTIVITY,
  activityRequiresDetails,
  getAllowedUnits,
  getDefaultUnit,
  isRepeatableActivity,
  withActivityTypeDefaults,
} from "./activityDrafts";
import {
  NumericEditCell,
  SingleSelectEditCell,
  hasMeaningfulData,
  makeGridKeyHandler,
  pairKey,
} from "./gridEditingHelpers";
import { filterApplicableActivities } from "./applicability";
import { formatNumericDisplay } from "./numericFormat";

const SCROLLABLE_TABLE_SX = { width: "100%", overflowX: "auto" };

function ReportingUnitAccordion({
  reportingUnit,
  activitiesByPair,
  selectableActivities,
  reportingUnitCount,
  upsertActivity,
  openDetailsForPair,
  calcErrors,
  show,
}) {
  // Phase C2 filter: only show activities in this unit's applicable list.
  // An empty list keeps legacy permissive behavior (show all).
  const applicableActivities = React.useMemo(
    () => filterApplicableActivities(reportingUnit, selectableActivities),
    [reportingUnit, selectableActivities],
  );

  const gridRows = React.useMemo(
    () => applicableActivities.map((activityType) => {
      const drafts = activitiesByPair.get(pairKey(reportingUnit.id, activityType.activity_type_id)) || [];
      const draft = drafts[0]
        || withActivityTypeDefaults({ ...EMPTY_ACTIVITY, facility_id: reportingUnit.id }, activityType);
      const rowErrors = filterErrorsForRow(calcErrors, reportingUnit.id, activityType.activity_type_id);
      return {
        id: `${reportingUnit.id}__${activityType.activity_type_id}`,
        facility_id: reportingUnit.id,
        activity_type_id: activityType.activity_type_id,
        activity_label: activityType.label,
        scope: activityType.scope,
        activity_value: draft.activity.value,
        activity_unit: draft.activity.unit || getDefaultUnit(activityType),
        draft,
        drafts,
        draft_count: drafts.filter(hasMeaningfulData).length,
        _repeatable: isRepeatableActivity(activityType),
        _unitOptions: getAllowedUnits(activityType),
        _activityType: activityType,
        _rowErrors: rowErrors,
      };
    }),
    [activitiesByPair, applicableActivities, calcErrors, reportingUnit.id],
  );

  const filledCount = gridRows.filter((row) => (row._repeatable ? row.draft_count > 0 : row.activity_value !== "")).length;
  const columns = React.useMemo(
    () => [
      { field: "activity_label", headerName: "Activity", flex: 1, minWidth: 220, editable: false },
      { field: "scope", headerName: "Scope", flex: 0.55, minWidth: 100, editable: false },
      {
        field: "activity_value",
        headerName: "Activity Value",
        flex: 0.8,
        minWidth: 150,
        editable: true,
        renderEditCell: (params) => <NumericEditCell {...params} />,
        valueFormatter: (value) => formatNumericDisplay(value),
        align: "right",
        headerAlign: "right",
        renderCell: (params) => (
          params.row._repeatable ? (
            <Typography variant="body2" color="text.secondary">
              {params.row.draft_count ? `${params.row.draft_count} entries` : "Manage in details"}
            </Typography>
          ) : formatNumericDisplay(params.value)
        ),
      },
      {
        field: "activity_unit",
        headerName: "Unit",
        flex: 0.6,
        minWidth: 120,
        editable: true,
        type: "singleSelect",
        valueOptions: ({ row }) => row?._unitOptions || [],
        renderEditCell: (params) => <SingleSelectEditCell {...params} />,
        renderCell: (params) => (
          params.row._repeatable ? (
            <Typography variant="body2" color="text.secondary">Details</Typography>
          ) : params.value
        ),
      },
      {
        field: "status",
        headerName: "Status",
        flex: 0.75,
        minWidth: 160,
        editable: false,
        sortable: false,
        renderCell: (params) => (
          params.row._repeatable
            ? <RepeatableStatusChip drafts={params.row.drafts} activityType={params.row._activityType} rowErrors={params.row._rowErrors} />
            : <StatusChip draft={params.row.draft} activityType={params.row._activityType} rowErrors={params.row._rowErrors} />
        ),
      },
      {
        field: "details",
        headerName: "Details",
        flex: 0.6,
        minWidth: 120,
        editable: false,
        sortable: false,
        renderCell: (params) => (
          <Button
            size="small"
            variant="outlined"
            onClick={() => openDetailsForPair(reportingUnit.id, params.row.activity_type_id)}
          >
            {params.row._repeatable ? "Manage" : activityRequiresDetails(params.row._activityType) ? "Edit" : "View"}
          </Button>
        ),
      },
    ],
    [openDetailsForPair, reportingUnit.id],
  );

  const processRowUpdate = React.useCallback(
    (newRow) => {
      upsertActivity(newRow.facility_id, newRow._activityType, newRow.activity_value, newRow.activity_unit);
      return newRow;
    },
    [upsertActivity],
  );

  const rowsRef = React.useRef(gridRows);
  rowsRef.current = gridRows;

  const handleCellKeyDown = React.useMemo(
    () => makeGridKeyHandler({
      getRows: () => rowsRef.current,
      editableFields: ["activity_value", "activity_unit"],
      onPasteApply: (updatedRows) => {
        updatedRows.forEach((row) => {
          if (row._repeatable) return;
          upsertActivity(row.facility_id, row._activityType, row.activity_value, row.activity_unit);
        });
      },
      canEditCell: (row) => !row._repeatable,
      show,
    }),
    [show, upsertActivity],
  );

  const legacyPermissive = (reportingUnit.applicable_activity_types || []).length === 0;

  return (
    <Accordion
      defaultExpanded={reportingUnitCount <= 8}
      disableGutters
      sx={{
        overflow: "hidden",
        "& .MuiAccordionDetails-root": { overflow: "hidden" },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: "100%" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {reportingUnit.facility_name}
          </Typography>
          {reportingUnit.state ? <Chip label={reportingUnit.state} size="small" variant="outlined" /> : null}
          {reportingUnit.egrid_subregion ? <Chip label={reportingUnit.egrid_subregion} size="small" variant="outlined" /> : null}
          {legacyPermissive ? (
            <Chip label="Legacy: all sources" size="small" variant="outlined" color="info" />
          ) : null}
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">
            {filledCount}/{applicableActivities.length} activities
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        <Box sx={SCROLLABLE_TABLE_SX}>
          <DataGrid
            rows={gridRows}
            columns={columns}
            processRowUpdate={processRowUpdate}
            onProcessRowUpdateError={() => {}}
            onCellKeyDown={handleCellKeyDown}
            isCellEditable={(params) => !params.row._repeatable && ["activity_value", "activity_unit"].includes(params.field)}
            disableRowSelectionOnClick
            autoHeight
            hideFooter
            sx={{
              minWidth: 820,
              border: "none",
              "& .MuiDataGrid-cell": { alignItems: "center" },
            }}
          />
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

export default function ByReportingUnitTable({
  activitiesByPair,
  reportingUnits,
  selectableActivities,
  upsertActivity,
  openDetailsForPair,
  calcErrors = [],
  show,
}) {
  return (
    <Stack spacing={1}>
      {reportingUnits.map((reportingUnit) => (
        <ReportingUnitAccordion
          key={reportingUnit.id}
          reportingUnit={reportingUnit}
          activitiesByPair={activitiesByPair}
          selectableActivities={selectableActivities}
          reportingUnitCount={reportingUnits.length}
          upsertActivity={upsertActivity}
          openDetailsForPair={openDetailsForPair}
          calcErrors={calcErrors}
          show={show}
        />
      ))}
    </Stack>
  );
}
