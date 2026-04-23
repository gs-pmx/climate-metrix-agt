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

const SCROLLABLE_TABLE_SX = {
  width: "100%",
  overflowX: "auto",
  // Shift+wheel horizontal scroll is handled natively by the browser when
  // the container overflows; no JS needed for that. We do set min-width on
  // the inner grid to ensure overflow engages on narrow viewports.
};

function ActivityAccordion({
  activityType,
  activitiesByPair,
  facilities,
  totalActivities,
  upsertActivity,
  openDetailsForPair,
  show,
}) {
  const repeatable = isRepeatableActivity(activityType);
  const unitOptions = getAllowedUnits(activityType);
  const gridRows = React.useMemo(
    () => facilities.map((facility) => {
      const drafts = activitiesByPair.get(pairKey(facility.id, activityType.activity_type_id)) || [];
      const draft = drafts[0]
        || withActivityTypeDefaults({ ...EMPTY_ACTIVITY, facility_id: facility.id }, activityType);
      return {
        id: `${activityType.activity_type_id}__${facility.id}`,
        facility_id: facility.id,
        facility_name: facility.facility_name,
        activity_value: draft.activity.value,
        activity_unit: draft.activity.unit || getDefaultUnit(activityType),
        draft,
        drafts,
        draft_count: drafts.filter(hasMeaningfulData).length,
        _repeatable: repeatable,
        _unitOptions: unitOptions,
      };
    }),
    [activitiesByPair, activityType, facilities, repeatable, unitOptions],
  );

  const filledCount = gridRows.filter((row) => (repeatable ? row.draft_count > 0 : row.activity_value !== "")).length;
  const columns = React.useMemo(
    () => repeatable
      ? [
        { field: "facility_name", headerName: "Facility", flex: 1, editable: false, minWidth: 180 },
        {
          field: "draft_count",
          headerName: "Entries",
          flex: 0.7,
          minWidth: 120,
          editable: false,
          sortable: false,
          renderCell: (params) => (
            <Typography variant="body2">
              {params.row.draft_count ? `${params.row.draft_count} entries` : "No entries"}
            </Typography>
          ),
        },
        {
          field: "status",
          headerName: "Status",
          flex: 0.85,
          minWidth: 160,
          editable: false,
          sortable: false,
          renderCell: (params) => <RepeatableStatusChip drafts={params.row.drafts} activityType={activityType} />,
        },
        {
          field: "details",
          headerName: "Details",
          flex: 0.7,
          minWidth: 120,
          editable: false,
          sortable: false,
          renderCell: (params) => (
            <Button
              size="small"
              variant="outlined"
              onClick={() => openDetailsForPair(params.row.facility_id, activityType.activity_type_id)}
            >
              Manage
            </Button>
          ),
        },
      ]
      : [
        { field: "facility_name", headerName: "Facility", flex: 1, editable: false, minWidth: 180 },
        {
          field: "activity_value",
          headerName: "Activity Value",
          flex: 0.8,
          minWidth: 140,
          editable: true,
          // Intentionally NOT type: "number" — our NumericEditCell handles
          // parsing (thousands separators, arrow-key navigation) and the
          // built-in number type would try to coerce/reformat in ways
          // that conflict. valueFormatter handles display.
          renderEditCell: (params) => <NumericEditCell {...params} />,
          valueFormatter: (value) => formatNumericDisplay(value),
          align: "right",
          headerAlign: "right",
        },
        {
          field: "activity_unit",
          headerName: "Unit",
          flex: 0.6,
          minWidth: 120,
          editable: true,
          type: "singleSelect",
          valueOptions: unitOptions,
          renderEditCell: (params) => <SingleSelectEditCell {...params} />,
        },
        {
          field: "status",
          headerName: "Status",
          flex: 0.75,
          minWidth: 160,
          editable: false,
          sortable: false,
          renderCell: (params) => <StatusChip draft={params.row.draft} activityType={activityType} />,
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
              onClick={() => openDetailsForPair(params.row.facility_id, activityType.activity_type_id)}
            >
              {activityRequiresDetails(activityType) ? "Edit" : "View"}
            </Button>
          ),
        },
      ],
    [activityType, openDetailsForPair, repeatable, unitOptions],
  );

  const processRowUpdate = React.useCallback(
    (newRow) => {
      upsertActivity(newRow.facility_id, activityType, newRow.activity_value, newRow.activity_unit);
      return newRow;
    },
    [activityType, upsertActivity],
  );

  const rowsRef = React.useRef(gridRows);
  rowsRef.current = gridRows;

  const handleCellKeyDown = React.useMemo(
    () => (repeatable ? null : makeGridKeyHandler({
      getRows: () => rowsRef.current,
      editableFields: ["activity_value", "activity_unit"],
      onPasteApply: (updatedRows) => {
        updatedRows.forEach((row) => {
          upsertActivity(row.facility_id, activityType, row.activity_value, row.activity_unit);
        });
      },
      show,
    })),
    [activityType, repeatable, show, upsertActivity],
  );

  return (
    <Accordion
      defaultExpanded={totalActivities <= 8}
      disableGutters
      sx={{
        overflow: "hidden",
        // Clip child tables so they share the rounded corner with the
        // accordion shell — fixes the visible sliver at the seam.
        "& .MuiAccordionDetails-root": { overflow: "hidden" },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: "100%" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {activityType.label}
          </Typography>
          <Chip label={activityType.scope} size="small" variant="outlined" />
          <Chip
            label={activityType.implementation_status}
            size="small"
            variant="outlined"
            color={
              activityType.implementation_status === "implemented"
                ? "success"
                : activityType.implementation_status === "partial"
                  ? "warning"
                  : activityType.implementation_status === "planned"
                    ? "info"
                    : "default"
            }
          />
          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="body2" color="text.secondary">
            {filledCount}/{facilities.length} facilities
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
            onCellKeyDown={handleCellKeyDown || undefined}
            disableRowSelectionOnClick
            autoHeight
            hideFooter={facilities.length <= 25}
            sx={{
              minWidth: 720,
              border: "none",
              // Ensure the editable cell fills the height so our custom
              // edit cell aligns with the view renderer.
              "& .MuiDataGrid-cell": { alignItems: "center" },
            }}
          />
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

// Scope 1/2/3 header groups. Purely visual — does not filter.
// Accepts scope values like "scope_1", "scope 1", "Scope 1", "1".
function scopeMatches(raw, digit) {
  const s = String(raw || "").toLowerCase();
  // Look for "1"/"2"/"3" immediately after optional scope prefix and separator.
  const pattern = new RegExp(`(?:^|\\b|scope)[\\s_]*${digit}(?:\\b|$)`);
  return pattern.test(s);
}

const SCOPE_GROUPS = [
  { key: "scope_1", label: "Scope 1 - Direct emissions", match: (s) => scopeMatches(s, 1) },
  { key: "scope_2", label: "Scope 2 - Purchased energy", match: (s) => scopeMatches(s, 2) },
  { key: "scope_3", label: "Scope 3 - Value chain", match: (s) => scopeMatches(s, 3) },
  { key: "other", label: "Other", match: () => true },
];

function groupActivitiesByScope(activities) {
  const buckets = SCOPE_GROUPS.map((group) => ({ ...group, activities: [] }));
  for (const activityType of activities) {
    const bucket = buckets.find((b) => b.match(activityType.scope));
    if (bucket) bucket.activities.push(activityType);
  }
  return buckets.filter((b) => b.activities.length > 0);
}

export default function ByActivityTable({
  activitiesByPair,
  facilities,
  selectableActivities,
  upsertActivity,
  openDetailsForPair,
  show,
}) {
  const groups = React.useMemo(() => groupActivitiesByScope(selectableActivities), [selectableActivities]);
  return (
    <Stack spacing={2}>
      {groups.map((group) => (
        <Stack key={group.key} spacing={1}>
          <Typography variant="overline" sx={{ color: "text.secondary", letterSpacing: 1 }}>
            {group.label}
          </Typography>
          <Stack spacing={1}>
            {group.activities.map((activityType) => (
              <ActivityAccordion
                key={activityType.activity_type_id}
                activityType={activityType}
                activitiesByPair={activitiesByPair}
                facilities={facilities}
                totalActivities={selectableActivities.length}
                upsertActivity={upsertActivity}
                openDetailsForPair={openDetailsForPair}
                show={show}
              />
            ))}
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}
