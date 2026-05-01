import * as React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Collapse,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
  alpha,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { DataGrid } from "@mui/x-data-grid";
import AddReportingUnitDialog from "./AddReportingUnitDialog";
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
import { filterApplicableReportingUnits, getSelectedActivityTypeIds } from "./applicability";
import { formatNumericDisplay } from "./numericFormat";
import { groupByTOC, sectionAnchorId } from "./categorizeForTOC";

// localStorage key for the "Show all activities" toggle. Defaulting to
// OFF means a returning user with no localStorage entry lands on the
// hide-unused view, which is the intended noise-reduced default.
const SHOW_ALL_STORAGE_KEY = "ghg-by-activity-show-all";

const SCROLLABLE_TABLE_SX = {
  width: "100%",
  overflowX: "auto",
};

// Post-C4 round-3 item 3: distinct accent color per scope so the scope
// sections read as clearly separate "bands" while scanning the By
// Activity view. Mapped to MUI's palette slots so the colors move with
// the theme (light/dark) and any future palette tuning.
//
// Post-C4 round-4 item 5: step down from the `.main` saturated slot to
// the `.light` variant for the border color — the original `.main`
// values read as loud against the data-entry UI. We also return the
// `.main` slot separately so callers can derive a very light (<=8%
// alpha) background tint for the whole header bar. That "barely-there
// wash" reinforces the scope boundary without shouting.
//
// Choice of slots:
//   - Scope 1 (direct emissions): error — warm red/orange.
//   - Scope 2 (purchased energy): primary — app blue.
//   - Scope 3 (value chain / indirect): success — green.
// Fallback (unknown scope id): text.secondary with no tint.
function scopeAccentPalette(scopeId) {
  const id = String(scopeId || "").toLowerCase();
  if (id.includes("scope_1") || id === "scope1" || id === "1") {
    return { border: "error.light", tint: "error.main" };
  }
  if (id.includes("scope_2") || id === "scope2" || id === "2") {
    return { border: "primary.light", tint: "primary.main" };
  }
  if (id.includes("scope_3") || id === "scope3" || id === "3") {
    return { border: "success.light", tint: "success.main" };
  }
  return { border: "text.secondary", tint: null };
}

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
  dimmed = false,
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
          align: "center",
          headerAlign: "center",
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
          align: "center",
          headerAlign: "center",
          renderCell: (params) => <RepeatableStatusChip drafts={params.row.drafts} activityType={activityType} rowErrors={params.row._rowErrors} />,
        },
        {
          field: "details",
          headerName: "Details",
          flex: 0.7,
          minWidth: 120,
          editable: false,
          sortable: false,
          align: "center",
          headerAlign: "center",
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
          // Post-C4 round-4 item 1: Unit column centered to match
          // Scope / Status / Details. Prior polish centered those
          // columns but missed Unit, leaving it visually out of step.
          align: "center",
          headerAlign: "center",
        },
        {
          field: "status",
          headerName: "Status",
          flex: 0.75,
          minWidth: 160,
          editable: false,
          sortable: false,
          align: "center",
          headerAlign: "center",
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
          align: "center",
          headerAlign: "center",
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
      // In "Show all" mode an unselected activity should not be expanded
      // by default — the user is browsing the catalog, not entering data.
      // Selected (non-dimmed) activities keep the original auto-expand
      // behavior for small catalogs.
      defaultExpanded={!dimmed && totalActivities <= 8}
      disableGutters
      sx={{
        overflow: "hidden",
        "& .MuiAccordionDetails-root": { overflow: "hidden" },
        // Dim the whole accordion for catalog activities not yet selected
        // by any Reporting Unit. The "+ Add Reporting Unit" button below
        // is undimmed so the discovery affordance still reads bright.
        ...(dimmed && {
          opacity: 0.55,
          transition: "opacity 120ms ease",
          "&:hover, &:focus-within": { opacity: 1 },
        }),
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
            variant={dimmed ? "outlined" : "text"}
            startIcon={<AddIcon />}
            // Stop propagation so clicking the button does not also toggle
            // the surrounding accordion — MUI forwards clicks to the
            // AccordionSummary otherwise.
            onClick={(event) => {
              event.stopPropagation();
              onOpenAddReportingUnit(activityType);
            }}
            // When the surrounding accordion is dimmed (Show-all mode,
            // unselected activity) keep the discovery button at full
            // opacity so it draws the eye as the call to action.
            sx={dimmed ? { opacity: 1 } : undefined}
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
  const [scopeCollapsed, setScopeCollapsed] = React.useState({});
  const [addDialogActivity, setAddDialogActivity] = React.useState(null);

  // "Show all activities" toggle. Default OFF (hide unused) on first
  // visit so users land in the noise-reduced view; localStorage carries
  // the choice across sessions.
  const [showAll, setShowAll] = React.useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage?.getItem(SHOW_ALL_STORAGE_KEY) === "true";
    } catch (_) {
      return false;
    }
  });
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage?.setItem(SHOW_ALL_STORAGE_KEY, showAll ? "true" : "false");
    } catch (_) {
      // localStorage may be disabled (private mode, quota) — silent
      // fallback keeps in-memory toggle state working for the session.
    }
  }, [showAll]);

  // Selected set: activity_type_ids that any RU has explicitly listed.
  // Drives the "hide unused" filter and the dimming in "show all" mode.
  const selectedActivityIds = React.useMemo(
    () => getSelectedActivityTypeIds(reportingUnits),
    [reportingUnits],
  );

  // Build the TOC tree from the catalog. Falls back to an empty tree
  // when the catalog is still loading.
  const fullTree = React.useMemo(() => groupByTOC(selectableActivities), [selectableActivities]);

  // When the toggle is OFF we hide subcategories that contain no
  // selected activities and drop unselected activities from each
  // remaining subcategory. When ON we show the full tree as-is — the
  // dimming happens at the ActivityAccordion level.
  const tree = React.useMemo(() => {
    if (showAll) return fullTree;
    return fullTree
      .map((scope) => ({
        ...scope,
        subcategories: scope.subcategories
          .map((sub) => ({
            ...sub,
            activities: sub.activities.filter((at) =>
              selectedActivityIds.has(at.activity_type_id),
            ),
          }))
          .filter((sub) => sub.activities.length > 0),
      }))
      .filter((scope) => scope.subcategories.length > 0);
  }, [fullTree, showAll, selectedActivityIds]);

  // Visibility counts for the "Showing X of Y" status chip.
  const totalActivityCount = React.useMemo(
    () => fullTree.reduce(
      (n, scope) => n + scope.subcategories.reduce((m, sub) => m + sub.activities.length, 0),
      0,
    ),
    [fullTree],
  );
  const visibleActivityCount = React.useMemo(
    () => tree.reduce(
      (n, scope) => n + scope.subcategories.reduce((m, sub) => m + sub.activities.length, 0),
      0,
    ),
    [tree],
  );

  // F2 PR 3 — the in-component TOC sidebar (``ByActivitySidebar``) was
  // replaced by a horizontal ``ScopeChips`` strip in the parent's
  // sticky toolbar. Scope navigation is now anchor-based: each scope
  // Box below renders an ``id="scope-${scope.id}"`` and the parent
  // calls ``document.getElementById(...).scrollIntoView()`` from the
  // chip click. The previous in-table refs + IntersectionObserver
  // scroll-spy moved up to ``ActivityInputsPanel`` for the same
  // reason.

  const handleSaveAdd = (checkedById) => {
    if (addDialogActivity && onApplyAddReportingUnit) {
      onApplyAddReportingUnit(addDialogActivity.activity_type_id, checkedById);
    }
    setAddDialogActivity(null);
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ width: "100%", minWidth: 0 }}>
        {/*
          "Show all activities" toggle. Sits at the top of the right-hand
          content column rather than alongside the view-mode toggles in
          ActivityInputsPanel — it's specific to the By Activity view
          and keyed off the data showing in this column. The status chip
          updates live so users always see how many activities are
          rendered vs how many exist in the catalog.
        */}
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          sx={{ mb: 2, flexWrap: "wrap", rowGap: 1 }}
          data-testid="by-activity-toggle-bar"
        >
          <FormControlLabel
            control={(
              <Switch
                size="small"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
                inputProps={{ "aria-label": "Show all activities" }}
              />
            )}
            label={(
              <Typography variant="body2">
                {showAll ? "Show all activities" : "Hide unused activities"}
              </Typography>
            )}
          />
          <Chip
            size="small"
            variant="outlined"
            label={`Showing ${visibleActivityCount} of ${totalActivityCount}`}
            data-testid="by-activity-visible-count"
          />
          {showAll ? (
            <Typography variant="caption" color="text.secondary">
              Dimmed rows are catalog activities no Reporting Unit has selected yet.
            </Typography>
          ) : null}
        </Stack>
        <Stack spacing={3}>
          {tree.map((scope, scopeIndex) => {
            const collapsed = Boolean(scopeCollapsed[scope.id]);
            const accent = scopeAccentPalette(scope.id);
            return (
              <Box
                key={scope.id}
                id={`scope-${scope.id}`}
                sx={{
                  // F2 PR 3 — scope-to-scope spacing bumped from 24
                  // (mt: 3) to 40 (mt: 5) per the design review's
                  // "not enough visual space and distinction between
                  // sections" critique. Anchor lands just below the
                  // sticky stack via ``scrollMarginTop`` so a click
                  // from ``ScopeChips`` doesn't park the title under
                  // the toolbar.
                  mt: scopeIndex === 0 ? 0 : 5,
                  scrollMarginTop:
                    "calc(var(--sticky-top-height) + var(--sticky-secondary-height) + 16px)",
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{
                    py: 1,
                    pl: 1.25,
                    pr: 1.25,
                    cursor: "pointer",
                    userSelect: "none",
                    // F2 PR 3 — dropped the colored background fill
                    // (was a 5/8% alpha tint of the scope's accent
                    // hue). The design review flagged Scope 1's
                    // light red band as "risks reading as an error
                    // state"; the same tint logic produced an
                    // unnecessary green/blue wash for Scope 2 and 3.
                    // The 4px left border carries the scope identity
                    // alone — calmer, less risk of confusion with
                    // status colors.
                    borderLeft: "4px solid",
                    borderLeftColor: accent.border,
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
                  <Typography
                    variant="h5"
                    sx={{
                      fontWeight: 700,
                      // Uppercase + loose letter-spacing gives scope
                      // headers the "dominant rhythm" role in the
                      // heading hierarchy; subcategory h6 stays
                      // mixed-case so scopes always read louder.
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      fontSize: "1.15rem",
                    }}
                  >
                    {scope.label}
                  </Typography>
                  <Box sx={{ flexGrow: 1 }} />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${scope.subcategories.reduce((n, s) => n + s.activities.length, 0)} activities`}
                  />
                </Stack>
                {/*
                  Post-C4 round-5 item 3: removed the horizontal rule
                  that previously sat under each scope header. The
                  colored left border + 5/8% alpha tint background +
                  uppercase letter-spacing on the scope label give the
                  header more than enough demarcation; the Divider read
                  as a leftover legacy underline.
                */}
                <Box sx={{ mb: 1 }} />
                <Collapse in={!collapsed} unmountOnExit>
                  {/* Post-C4 round-4 item 6: extra vertical rhythm
                      between subcategories. Prior spacing={2} (16px)
                      felt cramped once the scope header gained its
                      tinted background; bumping to spacing={3} (24px)
                      adds the 8px beat the user asked for. */}
                  <Stack spacing={3}>
                    {scope.subcategories.map((sub, subIndex) => {
                      // F2 PR 3 — the in-table TOC sidebar moved out, so
                      // the per-sub ref + data-toc-key wiring is gone.
                      // The anchor ``id`` stays for direct URL linking.
                      return (
                        <Box
                          key={sub.id}
                          id={sectionAnchorId(scope.id, sub.id)}
                          sx={{
                            // Keep anchors clear of both sticky layers
                            // when clicked from the TOC.
                            scrollMarginTop:
                              "calc(var(--sticky-top-height) + var(--sticky-secondary-height) + 16px)",
                            // Post-C4 round-3 item 3: thin horizontal
                            // rule above each subcategory (except the
                            // first, which already sits right under the
                            // scope's Divider) with padding so it reads
                            // as "new subgroup starts here" without
                            // shouting.
                            //
                            // Post-C4 round-4 item 6: tip the top
                            // padding up from 2 -> 2.5 so the break
                            // between subcategories feels roomier.
                            ...(subIndex > 0 && {
                              borderTop: (t) => `1px solid ${t.palette.divider}`,
                              pt: 2.5,
                            }),
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
                                // In "show all" mode, dim activities the user
                                // hasn't selected anywhere yet so the selected
                                // set still pops while the rest reads as
                                // browseable catalog.
                                dimmed={showAll && !selectedActivityIds.has(activityType.activity_type_id)}
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
          {tree.length === 0 && fullTree.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No selectable activities in the catalog yet.
            </Typography>
          ) : null}
          {tree.length === 0 && fullTree.length > 0 && !showAll ? (
            // "Hide unused" but no Reporting Unit has selected anything yet.
            // Friendly nudge rather than an apparently-empty page.
            <Box
              sx={{
                p: 3,
                borderRadius: 1,
                border: (t) => `1px dashed ${t.palette.divider}`,
                backgroundColor: (t) => alpha(t.palette.text.primary, 0.02),
              }}
              data-testid="by-activity-empty-hidden"
            >
              <Stack spacing={1} alignItems="flex-start">
                <Typography variant="subtitle2">No sources configured yet.</Typography>
                <Typography variant="body2" color="text.secondary">
                  Toggle "Show all" to browse the catalog and add sources to a Reporting Unit.
                </Typography>
                <Button size="small" variant="outlined" onClick={() => setShowAll(true)}>
                  Show all activities
                </Button>
              </Stack>
            </Box>
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
