import * as React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { DataGrid } from "@mui/x-data-grid";
import AddReportingUnitDialog from "./AddReportingUnitDialog";
import ByActivitySidebar from "./ByActivitySidebar";
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
import { filterApplicableReportingUnits } from "./applicability";
import { formatNumericDisplay } from "./numericFormat";
import { groupByTOC, sectionAnchorId } from "./categorizeForTOC";

const SCROLLABLE_TABLE_SX = {
  width: "100%",
  overflowX: "auto",
};

function ActivityAccordion({
  activityType,
  activitiesByPair,
  reportingUnits,
  totalActivities,
  upsertActivity,
  openDetailsForPair,
  calcErrors,
  onOpenAddReportingUnit,
  show,
}) {
  const repeatable = isRepeatableActivity(activityType);
  const unitOptions = getAllowedUnits(activityType);

  // Phase C2 filter: only show RUs where the activity is applicable.
  // Legacy permissive units (empty applicable list) keep showing up.
  const applicableReportingUnits = React.useMemo(
    () => filterApplicableReportingUnits(reportingUnits, activityType.activity_type_id),
    [reportingUnits, activityType.activity_type_id],
  );

  const gridRows = React.useMemo(
    () => applicableReportingUnits.map((ru) => {
      const drafts = activitiesByPair.get(pairKey(ru.id, activityType.activity_type_id)) || [];
      const draft = drafts[0]
        || withActivityTypeDefaults({ ...EMPTY_ACTIVITY, facility_id: ru.id }, activityType);
      const rowErrors = filterErrorsForRow(calcErrors, ru.id, activityType.activity_type_id);
      return {
        id: `${activityType.activity_type_id}__${ru.id}`,
        facility_id: ru.id,
        facility_name: ru.facility_name,
        activity_value: draft.activity.value,
        activity_unit: draft.activity.unit || getDefaultUnit(activityType),
        draft,
        drafts,
        draft_count: drafts.filter(hasMeaningfulData).length,
        _repeatable: repeatable,
        _unitOptions: unitOptions,
        _rowErrors: rowErrors,
      };
    }),
    [activitiesByPair, activityType, applicableReportingUnits, calcErrors, repeatable, unitOptions],
  );

  const filledCount = gridRows.filter((row) => (repeatable ? row.draft_count > 0 : row.activity_value !== "")).length;
  const columns = React.useMemo(
    () => repeatable
      ? [
        { field: "facility_name", headerName: "Reporting Unit", flex: 1, editable: false, minWidth: 180 },
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
          renderCell: (params) => <RepeatableStatusChip drafts={params.row.drafts} activityType={activityType} rowErrors={params.row._rowErrors} />,
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
        { field: "facility_name", headerName: "Reporting Unit", flex: 1, editable: false, minWidth: 180 },
        {
          field: "activity_value",
          headerName: "Activity Value",
          flex: 0.8,
          minWidth: 140,
          editable: true,
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
          renderCell: (params) => {
            const liveDraft = {
              ...params.row.draft,
              activity: {
                value: params.row.activity_value,
                unit: params.row.activity_unit,
              },
            };
            return (
              <StatusChip
                draft={liveDraft}
                activityType={activityType}
                rowErrors={params.row._rowErrors}
              />
            );
          },
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
          <Button
            size="small"
            variant="text"
            startIcon={<AddIcon />}
            // Stop propagation so clicking the button does not also toggle
            // the surrounding accordion — MUI forwards clicks to the
            // AccordionSummary otherwise.
            onClick={(event) => {
              event.stopPropagation();
              onOpenAddReportingUnit(activityType);
            }}
          >
            Add Reporting Unit
          </Button>
          <Typography variant="body2" color="text.secondary">
            {filledCount}/{applicableReportingUnits.length} units
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
            hideFooter={applicableReportingUnits.length <= 25}
            sx={{
              minWidth: 720,
              border: "none",
              "& .MuiDataGrid-cell": { alignItems: "center" },
            }}
          />
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

export default function ByActivityTable({
  activitiesByPair,
  reportingUnits,
  selectableActivities,
  upsertActivity,
  openDetailsForPair,
  calcErrors = [],
  onApplyAddReportingUnit,
  existingActivitiesByPair,
  show,
}) {
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [scopeCollapsed, setScopeCollapsed] = React.useState({});
  const [activeSubcategoryId, setActiveSubcategoryId] = React.useState("");
  const [addDialogActivity, setAddDialogActivity] = React.useState(null);

  // Build the TOC tree from the catalog. Falls back to an empty tree
  // when the catalog is still loading.
  const tree = React.useMemo(() => groupByTOC(selectableActivities), [selectableActivities]);

  // Refs for every rendered subcategory section so we can both scroll on
  // click and observe visibility for the scroll-spy.
  const sectionRefs = React.useRef(new Map());
  const registerSectionRef = React.useCallback((key) => (node) => {
    if (!node) {
      sectionRefs.current.delete(key);
    } else {
      sectionRefs.current.set(key, node);
    }
  }, []);

  const handleNavigate = React.useCallback(
    (scopeId, subId) => {
      const key = `${scopeId}::${subId}`;
      const node = sectionRefs.current.get(key);
      if (node && typeof node.scrollIntoView === "function") {
        node.scrollIntoView({ behavior: "smooth", block: "start" });
        setActiveSubcategoryId(subId);
        // If the scope is collapsed make sure we open it so the target
        // section is visible after the scroll lands.
        setScopeCollapsed((prev) => (prev?.[scopeId] ? { ...prev, [scopeId]: false } : prev));
      }
    },
    [],
  );

  // Scroll-spy: the subcategory whose top edge is closest to (but below)
  // the sticky header gets highlighted. IntersectionObserver approximates
  // this by preferring entries crossing a near-top rootMargin.
  React.useEffect(() => {
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length === 0) return;
        const top = visible[0];
        const key = top.target.dataset.tocKey || "";
        const [, subId] = key.split("::");
        if (subId) setActiveSubcategoryId(subId);
      },
      {
        root: null,
        // Top rootMargin should match (top-layer + secondary-layer)
        // approximately so the scroll-spy flags the section just under
        // the sticky stack as active. Uses a fixed px value rather than
        // CSS vars because IntersectionObserver does not accept vars.
        rootMargin: "-288px 0px -60% 0px",
        threshold: [0, 0.1],
      },
    );
    for (const node of sectionRefs.current.values()) observer.observe(node);
    return () => observer.disconnect();
  }, [tree]);

  const handleSaveAdd = (checkedById) => {
    if (addDialogActivity && onApplyAddReportingUnit) {
      onApplyAddReportingUnit(addDialogActivity.activity_type_id, checkedById);
    }
    setAddDialogActivity(null);
  };

  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="flex-start">
      <ByActivitySidebar
        tree={tree}
        activeSubcategoryId={activeSubcategoryId}
        scopeCollapsedState={scopeCollapsed}
        setScopeCollapsedState={setScopeCollapsed}
        onNavigate={handleNavigate}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />

      <Box sx={{ flexGrow: 1, minWidth: 0, width: "100%" }}>
        <Stack spacing={3}>
          {tree.map((scope) => {
            const collapsed = Boolean(scopeCollapsed[scope.id]);
            return (
              <Box key={scope.id}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{
                    py: 1,
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                  onClick={() => setScopeCollapsed((prev) => ({ ...prev, [scope.id]: !prev?.[scope.id] }))}
                  data-testid={`scope-header-${scope.id}`}
                >
                  <ExpandMoreIcon
                    sx={{
                      transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
                      transition: "transform 120ms ease",
                    }}
                  />
                  <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    {scope.label}
                  </Typography>
                  <Box sx={{ flexGrow: 1 }} />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${scope.subcategories.reduce((n, s) => n + s.activities.length, 0)} activities`}
                  />
                </Stack>
                <Divider sx={{ mb: 1 }} />
                <Collapse in={!collapsed} unmountOnExit>
                  <Stack spacing={2}>
                    {scope.subcategories.map((sub) => {
                      const key = `${scope.id}::${sub.id}`;
                      return (
                        <Box
                          key={sub.id}
                          id={sectionAnchorId(scope.id, sub.id)}
                          ref={registerSectionRef(key)}
                          data-toc-key={key}
                          sx={{
                            // Keep anchors clear of both sticky layers
                            // when clicked from the TOC.
                            scrollMarginTop:
                              "calc(var(--sticky-top-height) + var(--sticky-secondary-height) + 16px)",
                          }}
                        >
                          <Typography
                            variant="h6"
                            sx={{ fontWeight: 600, mb: 1, pl: 0.5 }}
                          >
                            {sub.label}
                          </Typography>
                          <Stack spacing={1}>
                            {sub.activities.map((activityType) => (
                              <ActivityAccordion
                                key={activityType.activity_type_id}
                                activityType={activityType}
                                activitiesByPair={activitiesByPair}
                                reportingUnits={reportingUnits}
                                totalActivities={selectableActivities.length}
                                upsertActivity={upsertActivity}
                                openDetailsForPair={openDetailsForPair}
                                calcErrors={calcErrors}
                                onOpenAddReportingUnit={(at) => setAddDialogActivity(at)}
                                show={show}
                              />
                            ))}
                          </Stack>
                        </Box>
                      );
                    })}
                  </Stack>
                </Collapse>
              </Box>
            );
          })}
          {tree.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No selectable activities in the catalog yet.
            </Typography>
          ) : null}
        </Stack>
      </Box>

      <AddReportingUnitDialog
        open={Boolean(addDialogActivity)}
        activityType={addDialogActivity}
        reportingUnits={reportingUnits}
        existingActivitiesByPair={existingActivitiesByPair}
        onClose={() => setAddDialogActivity(null)}
        onSave={handleSaveAdd}
      />
    </Stack>
  );
}
