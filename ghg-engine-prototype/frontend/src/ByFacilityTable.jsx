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
import { RepeatableStatusChip, StatusChip } from "./StatusChip";
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
import { formatNumericDisplay } from "./numericFormat";

const SCROLLABLE_TABLE_SX = { width: "100%", overflowX: "auto" };

function FacilityAccordion({
  facility,
  activitiesByPair,
  selectableActivities,
  facilityCount,
  upsertActivity,
  openDetailsForPair,
  show,
}) {
  const gridRows = React.useMemo(
    () => selectableActivities.map((activityType) => {
      const drafts = activitiesByPair.get(pairKey(facility.id, activityType.activity_type_id)) || [];
      const draft = drafts[0]
        || withActivityTypeDefaults({ ...EMPTY_ACTIVITY, facility_id: facility.id }, activityType);
      return {
        id: `${facility.id}__${activityType.activity_type_id}`,
        facility_id: facility.id,
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
      };
    }),
    [activitiesByPair, facility.id, selectableActivities],
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
        // NumericEditCell handles parsing; built-in type: "number" would
        // conflict with thousands-separator input. See ByActivityTable.
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
            ? <RepeatableStatusChip drafts={params.row.drafts} activityType={params.row._activityType} />
            : <StatusChip draft={params.row.draft} activityType={params.row._activityType} />
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
            onClick={() => openDetailsForPair(facility.id, params.row.activity_type_id)}
          >
            {params.row._repeatable ? "Manage" : activityRequiresDetails(params.row._activityType) ? "Edit" : "View"}
          </Button>
        ),
      },
    ],
    [facility.id, openDetailsForPair],
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

  return (
    <Accordion
      defaultExpanded={facilityCount <= 8}
      disableGutters
      sx={{
        overflow: "hidden",
        "& .MuiAccordionDetails-root": { overflow: "hidden" },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: "100%" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {facility.facility_name}
          </Typography>
          {facility.state ? <Chip label={facility.state} size="small" variant="outlined" /> : null}
          {facility.egrid_subregion ? <Chip label={facility.egrid_subregion} size="small" variant="outlined" /> : null}
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">
            {filledCount}/{selectableActivities.length} activities
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

export default function ByFacilityTable({
  activitiesByPair,
  facilities,
  selectableActivities,
  upsertActivity,
  openDetailsForPair,
  show,
}) {
  return (
    <Stack spacing={1}>
      {facilities.map((facility) => (
        <FacilityAccordion
          key={facility.id}
          facility={facility}
          activitiesByPair={activitiesByPair}
          selectableActivities={selectableActivities}
          facilityCount={facilities.length}
          upsertActivity={upsertActivity}
          openDetailsForPair={openDetailsForPair}
          show={show}
        />
      ))}
    </Stack>
  );
}
