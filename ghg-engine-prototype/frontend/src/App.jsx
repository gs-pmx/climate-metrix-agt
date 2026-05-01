import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import { ParametrixLogo, ClimateMetrixWordmark } from "./branding/Logos";
import { api, ApiError, saveDraftViaBeacon } from "./api";
import {
  EMPTY_ACTIVITY,
  buildSnapshot,
  createEmptyDraft,
  hydrateDraft,
  isCalculableActivity,
  uid,
  withActivityTypeDefaults,
} from "./activityDrafts";
import { buildCalculationPayload } from "./calculationPayload";
import { filterRowsApplicable } from "./applicability";
import { computeProjectCoverage, formatCoverageSummary } from "./coverage";
import { CORPORATE_STARTER_DEFAULT_IDS } from "./configureSources";
import {
  removeActivitiesForReportingUnit,
  removeReportingUnitFromList,
} from "./reportingUnits";
import { useAutosave } from "./useAutosave";
import { flushActiveEdit } from "./flushActiveEdit";
import AutosaveStatusChip from "./AutosaveStatusChip";
import Sidebar from "./Sidebar";
import NotificationsPanel from "./NotificationsPanel";
import EditProjectSetupDialog from "./EditProjectSetupDialog";
import { buildNotifications } from "./notices";

const ActivityInputsPanel = React.lazy(() => import("./ActivityInputsPanel"));
const ReportingUnitsTab = React.lazy(() => import("./ReportingUnitsTab"));
const SpendInputsTab = React.lazy(() => import("./SpendInputsTab"));
const ResultsTab = React.lazy(() => import("./ResultsTab"));
const DashboardTab = React.lazy(() => import("./DashboardTab"));
const AuditTab = React.lazy(() => import("./AuditTab"));
const CatalogTab = React.lazy(() => import("./CatalogTab"));

function LazyTabFallback() {
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary">
        Loading tab...
      </Typography>
    </Paper>
  );
}

// The on-the-wire JSON key for backward compatibility with existing
// SQLite snapshots remains ``facilities`` (see api/dto.py), but the
// product concept is a ``Reporting Unit``. ``applicable_activity_types``
// is the Phase C2 source checklist — empty list keeps legacy permissive
// behavior; non-empty list gates the per-RU grid.
const EMPTY_REPORTING_UNIT = {
  id: "",
  facility_name: "",
  location: "",
  region: "",
  country: "US",
  state: "",
  egrid_subregion: "",
  reporting_group: "",
  owned_leased: "Owned",
  applicable_activity_types: [],
};

function useSnack() {
  const [snack, setSnack] = React.useState({ open: false, msg: "", sev: "success" });
  const show = React.useCallback((msg, sev = "success") => setSnack({ open: true, msg, sev }), []);
  const close = React.useCallback(() => setSnack((s) => ({ ...s, open: false })), []);
  return { snack, show, close };
}

function groupByReportingUnit(rows) {
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.facility_id]) grouped[row.facility_id] = [];
    grouped[row.facility_id].push(row);
  }
  return grouped;
}

function ensureRowsWithIds(rows, makeRow) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [{ ...makeRow(), id: uid() }];
  }
  return rows.map((row) => ({ ...row, id: row.id || uid() }));
}

// Normalize a Reporting Unit loaded from a snapshot: fill in an empty
// `applicable_activity_types` when the legacy snapshot predates Phase C2
// so the rest of the UI can treat "no list" and "show all" identically.
function normalizeReportingUnit(row) {
  return {
    ...row,
    applicable_activity_types: Array.isArray(row?.applicable_activity_types)
      ? row.applicable_activity_types
      : [],
  };
}

function formatTimestamp(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString();
}

function toMetricTons(value, unit = "kg") {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const u = String(unit || "").toLowerCase().trim();
  if (u === "kg" || u === "kilogram" || u === "kilograms") return n / 1000;
  if (u === "g" || u === "gram" || u === "grams") return n / 1_000_000;
  if (u === "metric ton" || u === "metric tons" || u === "tonne" || u === "tonnes" || u === "t") return n;
  return n / 1000;
}

function toMetricTonFactor(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || !unit || !String(unit).includes("/")) return { value: null, unit: "" };
  const [numeratorRaw, denominatorRaw] = String(unit).split("/", 2).map((x) => x.trim());
  const numerator = numeratorRaw.toLowerCase();
  let mtValue = null;
  if (["kg", "kilogram", "kilograms"].includes(numerator)) mtValue = n / 1000;
  else if (["g", "gram", "grams"].includes(numerator)) mtValue = n / 1_000_000;
  else if (["metric ton", "metric tons", "tonne", "tonnes", "t"].includes(numerator)) mtValue = n;
  return {
    value: mtValue,
    unit: mtValue == null ? "" : `metric ton/${denominatorRaw}`,
  };
}

// Scroll distance (in px) past which the full header fades out and the
// compact sticky bar takes over. Kept well above 0 so the collapse feels
// intentional and doesn't flicker for mousewheel nudges.
const COLLAPSED_HEADER_SCROLL_THRESHOLD = 48;

function useIsScrolled(threshold = COLLAPSED_HEADER_SCROLL_THRESHOLD) {
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let ticking = false;
    const update = () => {
      ticking = false;
      setScrolled(window.scrollY > threshold);
    };
    const handler = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };
    // Initialize from current position so the compact bar shows up on a
    // deep-linked/hash-navigated page without waiting for a scroll event.
    update();
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [threshold]);
  return scrolled;
}

// Measure the sticky top bar's rendered height and publish it as the
// `--sticky-top-height` CSS variable on document root. Downstream sticky
// bars (view-selector, TOC sidebar) read this variable for their own
// `top` offsets — measuring dynamically keeps the layers flush even when
// the bar's actual height differs from the hardcoded fallback in
// main.jsx (e.g. MUI tab size changes, future additions to the bar).
function useStickyTopHeightVar(ref) {
  React.useLayoutEffect(() => {
    if (typeof window === "undefined") return undefined;
    const node = ref.current;
    if (!node) return undefined;
    const update = () => {
      const height = node.getBoundingClientRect().height;
      if (height > 0) {
        document.documentElement.style.setProperty(
          "--sticky-top-height",
          `${Math.round(height)}px`,
        );
      }
    };
    update();
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(update)
      : null;
    if (observer) observer.observe(node);
    window.addEventListener("resize", update);
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref]);
}

export default function App({ colorMode = "light", onToggleColorMode = () => {} }) {
  const { snack, show, close } = useSnack();
  // Phase F1 — sidebar-mediated views. ``view`` selects between the
  // project-context tab surface and the project-agnostic
  // Projects / Catalog surfaces that previously lived in the tab
  // strip. Tab indices stay stable inside ``view === 'project'`` so
  // the existing tab-content rendering continues to work; tabs 0
  // (Projects) and 7 (Catalog) are no longer rendered in the strip.
  const [view, setView] = React.useState("projects");
  const [tab, setTab] = React.useState(1);
  const isScrolled = useIsScrolled();
  const topBarRef = React.useRef(null);
  useStickyTopHeightVar(topBarRef);
  const [activityCatalog, setActivityCatalog] = React.useState([]);
  const [projects, setProjects] = React.useState([]);
  const [projectVersions, setProjectVersions] = React.useState([]);
  const [activeProjectId, setActiveProjectId] = React.useState("");
  const [projectNameDraft, setProjectNameDraft] = React.useState("");
  const [projectRenameDraft, setProjectRenameDraft] = React.useState("");
  const [versionNote, setVersionNote] = React.useState("");
  const [projectBusy, setProjectBusy] = React.useState(false);
  const [facilities, setFacilities] = React.useState([{ ...EMPTY_REPORTING_UNIT, id: uid(), facility_name: "Corporate", applicable_activity_types: [...CORPORATE_STARTER_DEFAULT_IDS] }]);
  // Session-only Set of Reporting Unit IDs that were created in this
  // browser session AND have never been configured (applicable list is
  // still empty). Used by ReportingUnitsTab to highlight the Configure
  // Sources button with an onboarding accent. Not persisted.
  const [newlyCreatedReportingUnitIds, setNewlyCreatedReportingUnitIds] = React.useState(() => new Set());
  const [activities, setActivities] = React.useState([createEmptyDraft()]);
  // Mirror activities/facilities into refs so async handlers (run
  // calculation, save version) can read the latest state after a
  // ``flushActiveEdit`` yield, instead of the closure-captured value
  // from the render that registered the click handler. The assignment
  // runs on every render and is synchronously consistent with state.
  const activitiesRef = React.useRef(activities);
  activitiesRef.current = activities;
  const facilitiesRef = React.useRef(facilities);
  facilitiesRef.current = facilities;
  const [inventoryYear, setInventoryYear] = React.useState(String(new Date().getFullYear()));
  const [gwpSet, setGwpSet] = React.useState("AR6");
  const [includeTrace, setIncludeTrace] = React.useState(true);
  // Phase F1.4 — these three settings are read-only inside the project
  // view by default; the only edit affordance is the EditProjectSetupDialog
  // opened from the non-sticky header. The dialog is the explicit
  // confirmation for an action that invalidates saved calc results.
  const [editProjectSetupOpen, setEditProjectSetupOpen] = React.useState(false);
  const [calculating, setCalculating] = React.useState(false);
  const [resultRows, setResultRows] = React.useState([]);
  const [summaryRows, setSummaryRows] = React.useState([]);
  const [traceRows, setTraceRows] = React.useState([]);
  const [auditRows, setAuditRows] = React.useState([]);
  const [calcErrors, setCalcErrors] = React.useState([]);
  const [catalogError, setCatalogError] = React.useState("");
  const [projectError, setProjectError] = React.useState("");
  const [schemaInfo, setSchemaInfo] = React.useState(null);
  // Phase D1: when a project is loaded and a newer-than-latest-version
  // draft exists in the backend, hold it here until the user accepts or
  // discards via the restore banner. ``null`` means no banner shown.
  const [pendingDraft, setPendingDraft] = React.useState(null);
  // F2 PR 4 — restore-banner session dismissal. The Alert used to be
  // unconditional whenever a draft existed; per the design review's
  // "instructional copy too persistent" critique, users now get an X
  // button to hide the banner for the current draft. Dismissal is
  // keyed off ``pendingDraft.updated_at`` so a freshly-saved draft
  // (different timestamp) re-surfaces the banner. Reload re-shows
  // too — there's no on-disk persistence of the dismissal.
  const [restoreBannerDismissedFor, setRestoreBannerDismissedFor] = React.useState(null);

  const hasActiveProject = Boolean(activeProjectId);
  const activeProject = React.useMemo(
    () => projects.find((p) => p.project_id === activeProjectId) || null,
    [projects, activeProjectId],
  );

  const activityTypesById = React.useMemo(
    () => Object.fromEntries(activityCatalog.map((activityType) => [activityType.activity_type_id, activityType])),
    [activityCatalog],
  );
  const activityLabelById = React.useMemo(
    () => Object.fromEntries(activityCatalog.map((activityType) => [activityType.activity_type_id, activityType.label])),
    [activityCatalog],
  );
  const facilityNameById = React.useMemo(
    () => Object.fromEntries(facilities.map((f) => [f.id, f.facility_name || f.id])),
    [facilities],
  );
  const dataEntryFacilities = React.useMemo(
    () => facilities.filter((facility) => String(facility.facility_name || "").trim()),
    [facilities],
  );
  const dataEntryFacilityIds = React.useMemo(
    () => new Set(dataEntryFacilities.map((facility) => facility.id)),
    [dataEntryFacilities],
  );
  const facilityOptions = React.useMemo(
    () => dataEntryFacilities.map((f) => ({ value: f.id, label: f.facility_name })),
    [dataEntryFacilities],
  );

  // Phase D2 — single source of truth for project-level source coverage.
  // Computed once at the App level so the Reporting Units tab chips,
  // Activity Inputs banner, and Dashboard widget all read the same
  // numbers. Cheap pure helper (see coverage.js).
  const projectCoverage = React.useMemo(
    () => computeProjectCoverage({
      reportingUnits: facilities,
      activities,
      calcErrors,
    }),
    [activities, calcErrors, facilities],
  );
  const coverageSummaryText = React.useMemo(
    () => formatCoverageSummary(projectCoverage),
    [projectCoverage],
  );

  const refreshProjects = React.useCallback(async () => {
    const list = await api.listProjects();
    const rows = Array.isArray(list) ? list : [];
    setProjects(rows);
    return rows;
  }, []);

  const refreshVersions = React.useCallback(
    async (projectId) => {
      if (!projectId) {
        setProjectVersions([]);
        return [];
      }
      const rows = await api.listProjectVersions(projectId);
      const result = Array.isArray(rows) ? rows : [];
      setProjectVersions(result);
      return result;
    },
    [],
  );

  const applySnapshot = React.useCallback((payload) => {
    const snap = payload?.snapshot || {};
    const normalizedFacilities = ensureRowsWithIds(
      snap.facilities,
      () => ({ ...EMPTY_REPORTING_UNIT }),
    ).map(normalizeReportingUnit);
    setFacilities(normalizedFacilities);
    // Build the (id -> display name) lookup from the snapshot's own
    // facilities so result/audit rows render the Reporting Unit name
    // correctly on load. The backend ``ResultRecordDTO`` carries only
    // ``facility_id`` (no name field), so without this lookup the
    // Results / Audit grids fall back to the raw uid and the column
    // appears blank or unreadable.
    const snapFacilityNameById = Object.fromEntries(
      normalizedFacilities.map((unit) => [unit.id, unit.facility_name || unit.id]),
    );
    setActivities(
      Array.isArray(snap.activities) && snap.activities.length > 0
        ? snap.activities.map((draft) => hydrateDraft(draft, activityTypesById[draft.activity_type_id]))
        : [createEmptyDraft()],
    );
    setResultRows(
      (snap.result_rows || []).map((row, i) => ({
        id: row.id || `${i}`,
        ...row,
        value: toMetricTons(row.value, row.unit),
        unit: "metric ton",
        facility_name: snapFacilityNameById[row.facility_id] || row.facility_id,
        activity_label:
          row.activity_label
          || activityTypesById[row.activity_type_id]?.label
          || row.activity_type_id,
      })),
    );
    setSummaryRows(
      (snap.summary_rows || []).map((row, i) => {
        const key = String(row.key || "");
        const parts = key.split("|");
        const unitFromKey = parts.length >= 5 ? parts[4] : "kg";
        if (parts.length >= 5) parts[4] = "metric ton";
        return {
          id: row.id || `${i}`,
          ...row,
          key: parts.length >= 5 ? parts.join("|") : key,
          value: toMetricTons(row.value, unitFromKey),
        };
      }),
    );
    setTraceRows((snap.trace_rows || []).map((row, i) => ({ id: row.id || `${i}`, ...row })));
    setAuditRows(
      (snap.audit_rows || []).map((row, i) => ({
        id: row.id || `a_${i}`,
        ...row,
        facility_name: snapFacilityNameById[row.facility_id] || row.facility_id,
        activity_label:
          row.activity_label
          || activityTypesById[row.activity_type_id]?.label
          || row.activity_type_id,
      })),
    );
    setInventoryYear(String(payload?.inventory_year || new Date().getFullYear()));
    setGwpSet(String(payload?.gwp_set || "AR6"));
    setIncludeTrace(Boolean(payload?.include_trace ?? true));
  }, [activityTypesById]);

  const loadLatestSnapshot = React.useCallback(
    async (projectId) => {
      if (!projectId) return null;
      try {
        const payload = await api.getProjectSnapshot(projectId);
        applySnapshot(payload);
        // Return so the caller can compare ``created_at`` against any
        // pending draft's ``updated_at`` to decide whether to show the
        // restore banner.
        return payload;
      } catch (e) {
        const msg = String(e?.message || e);
        if (!msg.includes("404")) {
          show(`Failed to load latest snapshot: ${msg}`, "error");
        }
        return null;
      }
    },
    [applySnapshot, show],
  );

  // Phase D1: after loading the latest version, ask the backend for a
  // draft. If it exists AND is newer than the latest version, surface
  // the restore banner. If older (shouldn't happen — drafts clear on
  // version save — but defensively), discard silently. If no draft,
  // no banner.
  const checkForDraft = React.useCallback(
    async (projectId, latestVersionPayload) => {
      if (!projectId) return;
      let draft;
      try {
        draft = await api.loadDraft(projectId);
      } catch (e) {
        const msg = String(e?.message || e);
        if (!msg.includes("404")) {
          // Soft-fail: surfacing a banner is best-effort. Don't block
          // the user from working if the draft endpoint hiccups.
          show(`Failed to check for unsaved draft: ${msg}`, "warning");
        }
        setPendingDraft(null);
        return;
      }
      if (!draft) {
        setPendingDraft(null);
        return;
      }
      const latestCreatedAt = latestVersionPayload?.created_at || null;
      if (latestCreatedAt && draft.updated_at <= latestCreatedAt) {
        // Stale draft — version save was supposed to clear it but
        // somehow didn't. Discard silently rather than offering a
        // confusing "restore" prompt for older state.
        try {
          await api.deleteDraft(projectId);
        } catch {
          // ignore
        }
        setPendingDraft(null);
        return;
      }
      setPendingDraft(draft);
    },
    [show],
  );

  // Phase D1 — autosave wiring. Must come BEFORE saveCurrentVersion and
  // selectProject because both useCallback their deps on
  // autosaveMarkBaseline; declaring it later puts these closures into a
  // temporal dead zone and the app blanks on first render.
  //
  // Build the live snapshot every render so the autosave hook can
  // dirty-check it. ``null`` whenever there's no active project so the
  // hook short-circuits.
  const liveSnapshot = React.useMemo(() => {
    if (!activeProjectId) return null;
    return buildSnapshot({
      facilities,
      activities,
      resultRows,
      summaryRows,
      traceRows,
      auditRows,
    });
  }, [activeProjectId, facilities, activities, resultRows, summaryRows, traceRows, auditRows]);

  const autosaveSave = React.useCallback(
    async (snapshot) => {
      if (!activeProjectId) return;
      await api.saveDraft(activeProjectId, {
        inventory_year: Number(inventoryYear) || new Date().getFullYear(),
        gwp_set: gwpSet,
        include_trace: includeTrace,
        snapshot,
      });
    },
    [activeProjectId, inventoryYear, gwpSet, includeTrace],
  );

  const autosaveBeacon = React.useCallback(
    (snapshot) => {
      if (!activeProjectId) return false;
      return saveDraftViaBeacon(activeProjectId, {
        inventory_year: Number(inventoryYear) || new Date().getFullYear(),
        gwp_set: gwpSet,
        include_trace: includeTrace,
        snapshot,
      });
    },
    [activeProjectId, inventoryYear, gwpSet, includeTrace],
  );

  const autosave = useAutosave({
    snapshot: liveSnapshot,
    saveFn: autosaveSave,
    beaconFn: autosaveBeacon,
    // Don't fire autosaves while a restore banner is up — the user is
    // about to choose between the draft and the latest version, and an
    // autosave during that window would race with whichever they pick.
    enabled: hasActiveProject && !pendingDraft,
  });
  const autosaveMarkBaseline = autosave.markBaseline;

  const saveCurrentVersion = React.useCallback(
    async (note, overrides = null) => {
      if (!activeProjectId) {
        show("Create or select a project first.", "warning");
        return;
      }
      // Commit any in-edit DataGrid cell or TextField before snapshotting,
      // otherwise the saved version misses the in-flight edit and a later
      // reload would silently revert the user's typing to the prior value.
      await flushActiveEdit();
      // ``overrides`` lets callers inject just-computed result rows that
      // haven't yet flushed through React state into closure (the auto-save
      // path at the end of ``runCalculation``). Closure-captured fields
      // are still used for the no-overrides case.
      const resolvedResultRows = overrides?.resultRows ?? resultRows;
      const resolvedSummaryRows = overrides?.summaryRows ?? summaryRows;
      const resolvedTraceRows = overrides?.traceRows ?? traceRows;
      const resolvedAuditRows = overrides?.auditRows ?? auditRows;
      setProjectBusy(true);
      try {
        const snapshotPayload = buildSnapshot({
          facilities: facilitiesRef.current,
          activities: activitiesRef.current,
          resultRows: resolvedResultRows,
          summaryRows: resolvedSummaryRows,
          traceRows: resolvedTraceRows,
          auditRows: resolvedAuditRows,
        });
        const saved = await api.saveProjectVersion(activeProjectId, {
          inventory_year: Number(inventoryYear),
          gwp_set: gwpSet,
          include_trace: includeTrace,
          snapshot: snapshotPayload,
          note: note || null,
        });
        await refreshVersions(activeProjectId);
        await refreshProjects();
        // Phase D1: the explicit version is the new baseline. The
        // backend already deleted the draft row inside the same
        // transaction; reset the autosave baseline locally too so the
        // chip flips back to "All changes saved".
        autosaveMarkBaseline(snapshotPayload);
        show(`Saved version v${saved.version_number}.`, "success");
        return saved;
      } catch (e) {
        show(`Save failed: ${e.message || e}`, "error");
        throw e;
      } finally {
        setProjectBusy(false);
      }
    },
    [
      activeProjectId,
      activities,
      auditRows,
      autosaveMarkBaseline,
      facilities,
      gwpSet,
      includeTrace,
      inventoryYear,
      refreshProjects,
      refreshVersions,
      resultRows,
      show,
      summaryRows,
      traceRows,
    ],
  );

  React.useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (hasActiveProject) saveCurrentVersion("Checkpoint (Ctrl+S).");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hasActiveProject, saveCurrentVersion]);

  const selectProject = React.useCallback(
    async (projectId) => {
      setActiveProjectId(projectId);
      const p = projects.find((x) => x.project_id === projectId);
      if (p) {
        setInventoryYear(String(p.inventory_year));
        setProjectRenameDraft(p.name);
      }
      // Reset autosave baseline; the freshly loaded snapshot will
      // become the new baseline once ``applySnapshot`` runs.
      autosaveMarkBaseline(null);
      setPendingDraft(null);
      await refreshVersions(projectId);
      const latest = await loadLatestSnapshot(projectId);
      await checkForDraft(projectId, latest);
      // Loading a project from the sidebar drops the user back into
      // the project tab surface (Reporting Units by default). Without
      // this they'd stay on the Projects sidebar view and see no tabs.
      setView("project");
      setTab(1);
    },
    [autosaveMarkBaseline, checkForDraft, loadLatestSnapshot, projects, refreshVersions],
  );

  React.useEffect(() => {
    const loadCatalog = async () => {
      try {
        const rows = await api.listActivityTypes();
        if (!Array.isArray(rows)) {
          throw new Error("Catalog API returned non-array payload.");
        }
        setActivityCatalog(rows);
        setCatalogError("");
      } catch (e) {
        setActivityCatalog([]);
        setCatalogError(String(e.message || e));
        show(`Failed to load activity catalog: ${e.message}`, "error");
      }
    };
    loadCatalog();
  }, [show]);

  React.useEffect(() => {
    let mounted = true;
    const loadProjectsAndSelect = async () => {
      try {
        const schema = await api.getSchemaMigrations();
        setSchemaInfo(schema);
        const rows = await refreshProjects();
        if (!mounted) return;
        setProjectError("");
        if (!activeProjectId && rows.length > 0) {
          const newest = rows[0];
          setActiveProjectId(newest.project_id);
          setInventoryYear(String(newest.inventory_year));
          setProjectRenameDraft(newest.name);
          await refreshVersions(newest.project_id);
          const latest = await loadLatestSnapshot(newest.project_id);
          await checkForDraft(newest.project_id, latest);
          // Drop the user straight into the project workspace on
          // auto-select; otherwise they land on the Projects sidebar
          // view with no obvious way into the tabs.
          setView("project");
          setTab(1);
        }
      } catch (e) {
        if (!mounted) return;
        setProjectError(String(e.message || e));
        show(`Failed to load projects: ${e.message || e}`, "error");
      }
    };
    loadProjectsAndSelect();
    return () => {
      mounted = false;
    };
  }, [activeProjectId, checkForDraft, loadLatestSnapshot, refreshProjects, refreshVersions, show]);

  const createProject = async () => {
    const cleanName = projectNameDraft.trim();
    const year = Number(inventoryYear);
    if (cleanName.length < 2) {
      show("Project name must be at least 2 characters.", "warning");
      return;
    }
    if (!Number.isFinite(year) || year < 1900 || year > 3000) {
      show("Inventory year must be between 1900 and 3000.", "warning");
      return;
    }
    setProjectBusy(true);
    try {
      const project = await api.createProject({ name: cleanName, inventory_year: year });
      setProjectNameDraft("");
      const initialFacilities = [{ ...EMPTY_REPORTING_UNIT, id: uid(), facility_name: "Corporate", applicable_activity_types: [...CORPORATE_STARTER_DEFAULT_IDS] }];
      const initialActivities = [createEmptyDraft()];
      setFacilities(initialFacilities);
      setActivities(initialActivities);
      setResultRows([]);
      setSummaryRows([]);
      setTraceRows([]);
      setAuditRows([]);
      setActiveProjectId(project.project_id);
      setProjectRenameDraft(project.name);
      await api.saveProjectVersion(project.project_id, {
        inventory_year: year,
        gwp_set: gwpSet,
        include_trace: includeTrace,
        snapshot: buildSnapshot({
          facilities: initialFacilities,
          activities: initialActivities,
          resultRows: [],
          summaryRows: [],
          traceRows: [],
          auditRows: [],
        }),
        note: "Initial project scaffold.",
      });
      await refreshProjects();
      await refreshVersions(project.project_id);
      await loadLatestSnapshot(project.project_id);
      show(`Project "${project.name}" created.`, "success");
      // Drop into the new project's Reporting Units tab so the user
      // can start configuring sources immediately.
      setView("project");
      setTab(1);
    } catch (e) {
      show(`Project creation failed: ${e.message || e}`, "error");
    } finally {
      setProjectBusy(false);
    }
  };

  const renameActiveProject = async () => {
    if (!activeProjectId) return;
    const nextName = projectRenameDraft.trim();
    if (nextName.length < 2) {
      show("Project name must be at least 2 characters.", "warning");
      return;
    }
    setProjectBusy(true);
    try {
      await api.renameProject(activeProjectId, { name: nextName });
      const rows = await refreshProjects();
      const fresh = rows.find((p) => p.project_id === activeProjectId);
      if (fresh) {
        setProjectRenameDraft(fresh.name);
      }
      show("Project renamed.", "success");
    } catch (e) {
      show(`Project rename failed: ${e.message || e}`, "error");
    } finally {
      setProjectBusy(false);
    }
  };

  const deleteActiveProject = async () => {
    if (!activeProjectId) return;
    const approved = window.confirm("Delete this project and all saved versions? This cannot be undone.");
    if (!approved) return;
    setProjectBusy(true);
    try {
      await api.deleteProject(activeProjectId);
      setActiveProjectId("");
      setProjectRenameDraft("");
      setProjectVersions([]);
      setFacilities([{ ...EMPTY_REPORTING_UNIT, id: uid(), facility_name: "Corporate", applicable_activity_types: [...CORPORATE_STARTER_DEFAULT_IDS] }]);
      setActivities([createEmptyDraft()]);
      setResultRows([]);
      setSummaryRows([]);
      setTraceRows([]);
      setAuditRows([]);
      const rows = await refreshProjects();
      if (rows.length > 0) {
        await selectProject(rows[0].project_id);
      }
      show("Project deleted.", "success");
    } catch (e) {
      show(`Project delete failed: ${e.message || e}`, "error");
    } finally {
      setProjectBusy(false);
    }
  };

  const downloadAuditCsv = () => {
    if (!auditRows.length) {
      show("No audit rows available to export.", "warning");
      return;
    }
    const exportRows = auditRows.map((row) => ({
      ...row,
      co2_result_mt: toMetricTons(row.co2_result_kg, "kg"),
      ch4_result_mt: toMetricTons(row.ch4_result_kg, "kg"),
      n2o_result_mt: toMetricTons(row.n2o_result_kg, "kg"),
      co2e_result_mt: toMetricTons(row.co2e_result_kg, "kg"),
      factor_co2_mt: toMetricTonFactor(row.factor_co2_value, row.factor_co2_unit).value,
      factor_co2_mt_unit: toMetricTonFactor(row.factor_co2_value, row.factor_co2_unit).unit,
      factor_ch4_mt: toMetricTonFactor(row.factor_ch4_value, row.factor_ch4_unit).value,
      factor_ch4_mt_unit: toMetricTonFactor(row.factor_ch4_value, row.factor_ch4_unit).unit,
      factor_n2o_mt: toMetricTonFactor(row.factor_n2o_value, row.factor_n2o_unit).value,
      factor_n2o_mt_unit: toMetricTonFactor(row.factor_n2o_value, row.factor_n2o_unit).unit,
    }));
    const cols = Object.keys(exportRows[0]).filter((k) => !["id", "co2_result_kg", "ch4_result_kg", "n2o_result_kg", "co2e_result_kg"].includes(k));
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = cols.join(",");
    const lines = exportRows.map((row) => cols.map((c) => esc(row[c])).join(","));
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ghg_audit_${activeProject?.name || "project"}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Phase D1 — restore-banner actions.
  //
  // ``restoreDraft`` pulls the draft snapshot into local state via the
  // existing ``applySnapshot`` mapper. The resulting state will look
  // dirty against the loaded-version baseline, so the autosave hook
  // will start its 30-second debounce — that's intentional, the user
  // may keep editing immediately.
  //
  // ``discardDraft`` deletes the server-side draft and dismisses the
  // banner so the user works from the latest committed version.
  const restoreDraft = React.useCallback(() => {
    if (!pendingDraft) return;
    applySnapshot({
      snapshot: pendingDraft.snapshot,
      inventory_year: pendingDraft.inventory_year,
      gwp_set: pendingDraft.gwp_set,
      include_trace: pendingDraft.include_trace,
    });
    setPendingDraft(null);
    show("Draft restored. Autosave is on.", "success");
  }, [applySnapshot, pendingDraft, show]);

  const discardDraft = React.useCallback(async () => {
    if (!pendingDraft || !activeProjectId) {
      setPendingDraft(null);
      return;
    }
    try {
      await api.deleteDraft(activeProjectId);
      show("Discarded unsaved draft.", "info");
    } catch (e) {
      show(`Failed to discard draft: ${e.message || e}`, "warning");
    } finally {
      setPendingDraft(null);
    }
  }, [activeProjectId, pendingDraft, show]);

  const addReportingUnit = React.useCallback(() => {
    const id = uid();
    setFacilities((prev) => [...prev, { ...EMPTY_REPORTING_UNIT, id }]);
    // Mark this one for the onboarding highlight. The badge clears itself
    // once the user saves a non-empty applicable_activity_types list.
    setNewlyCreatedReportingUnitIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Hard-delete a Reporting Unit. Pure-data filter logic lives in
  // reportingUnits.js so it can be unit-tested; this callback handles
  // the React-state side effects that can't be unit-tested:
  //   - facilities and activities lists shrink in lock-step
  //   - any pending "newly-created" highlight for this id clears
  //   - any open dialog that referenced the unit (calc errors are
  //     keyed by facility_id, which is fine to leave in place — the
  //     filter helper will simply find no matching grid row)
  // Wired into the Reporting Units tab's per-card delete affordance;
  // confirmation lives in ReportingUnitsTab so the card's surrounding
  // context (unit name, draft data count) is available there.
  const removeReportingUnit = React.useCallback((id) => {
    if (!id) return;
    setFacilities((prev) => removeReportingUnitFromList(prev, id));
    setActivities((prev) => removeActivitiesForReportingUnit(prev, id));
    setNewlyCreatedReportingUnitIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    // Drop any backend errors keyed to this facility; otherwise stale
    // chips remain bound to a Reporting Unit that no longer exists and
    // pop up if the user re-creates a unit and reuses an id (rare but
    // possible via uid collision over a long session).
    setCalcErrors((prev) => prev.filter((err) => err?.facility_id !== id));
  }, []);

  const runCalculation = async () => {
    // Commit any in-edit DataGrid cell so the latest typed value lands
    // in React state before we read it. Without this, a cursor still
    // parked in a cell loses its in-flight value and the calc runs on
    // the previously-committed (stale) data — which is the bug Stephen
    // reported as "data reverts to a previous state on calculate".
    await flushActiveEdit();
    // After the yield, refs hold the post-commit state. Re-derive the
    // gating checks (RU presence, applicable rows) from the refs rather
    // than the closure-captured values that ran when the click handler
    // was bound.
    const facilitiesNow = facilitiesRef.current;
    const activitiesNow = activitiesRef.current;
    const dataEntryFacilitiesNow = facilitiesNow.filter(
      (facility) => String(facility.facility_name || "").trim(),
    );
    const dataEntryFacilityIdsNow = new Set(
      dataEntryFacilitiesNow.map((facility) => facility.id),
    );

    if (!hasActiveProject) {
      show("Create or select a project first.", "warning");
      setView("projects");
      return;
    }
    if (!dataEntryFacilitiesNow.length) {
      show("Add at least one named Reporting Unit before entering activity data.", "warning");
      setView("project");
      setTab(1);
      return;
    }
    const allPopulatedRows = activitiesNow.filter(
      (draft) =>
        dataEntryFacilityIdsNow.has(draft.facility_id)
        && draft.activity_type_id
        && draft.activity?.value !== "",
    );
    if (!allPopulatedRows.length) {
      show("Add at least one activity row with facility, activity, and value.", "warning");
      return;
    }

    // Filter out rows for (RU, activity) pairs that aren't in the RU's
    // applicable_activity_types list. Deselected sources must not flow
    // into the /calculate payload even when they still carry data —
    // otherwise the engine trips on missing params (e.g., fuel efficiency
    // MPG) for sources the user has explicitly excluded. The underlying
    // draft data is preserved in the snapshot (soft-hide).
    const rows = filterRowsApplicable(allPopulatedRows, facilitiesNow);
    const deselectedCount = allPopulatedRows.length - rows.length;
    if (!rows.length) {
      show(
        deselectedCount
          ? `All ${deselectedCount} populated row(s) are for deselected sources — nothing to calculate. Enable the sources on each Reporting Unit's Configure Sources dialog to include them.`
          : "Add at least one activity row with facility, activity, and value.",
        "warning",
      );
      return;
    }
    if (deselectedCount) {
      show(
        `Skipped ${deselectedCount} row(s) for sources that are not selected on their Reporting Unit.`,
        "info",
      );
    }

    const calculableRows = rows.filter((draft) => isCalculableActivity(activityTypesById[draft.activity_type_id]));
    const skippedRows = rows.filter((draft) => !isCalculableActivity(activityTypesById[draft.activity_type_id]));
    if (!calculableRows.length) {
      show(
        skippedRows.length
          ? "Only unsupported activities have data right now. Add at least one implemented or partial activity to calculate."
          : "Add at least one calculable activity row before running the inventory.",
        "warning",
      );
      return;
    }

    const grouped = groupByReportingUnit(calculableRows);
    const mergedResults = [];
    const mergedTrace = [];
    const mergedAudit = [];
    const mergedErrors = [];
    const summaryMap = {};
    // Clear stale per-row error chips from a previous run before dispatching
    // the new batch; otherwise old errors linger until the new response
    // arrives and chips across several facilities update piecemeal.
    setCalcErrors([]);
    setCalculating(true);
    let totalFailure = false;
    let totalFailureMessage = "";
    // F2 PR 5 — always fetch the audit envelope. F1.5 introduced a
    // ``needsAudit = tab === 6`` gate to skip the audit endpoint
    // when the user wasn't on the Audit tab; the rationale was
    // SQLite traffic. F1.5's perf fixes (pint cache, factor LRU,
    // request-scoped get_by_factor_id cache) closed that gap to
    // single-digit ms — ``/calculate/audit`` now costs ~3ms more
    // than ``/calculate``. The gate's behavioral cost (Audit tab
    // looks blank until the user re-runs Calc from there) is no
    // longer worth its perf benefit. Always calling the audit
    // endpoint keeps the audit data in step with the rest of the
    // calc state.
    try {
      for (const [facilityId, facilityRows] of Object.entries(grouped)) {
        const fac = facilitiesNow.find((f) => f.id === facilityId);
        const payload = buildCalculationPayload({
          projectId: activeProjectId,
          inventoryYear,
          gwpSet,
          includeTrace,
          facility: fac,
          rows: facilityRows,
          activityTypesById,
          // PR B — ship the project's applicability map so the backend
          // can filter inapplicable rows defensively (the existing
          // client-side filter is the UX/bandwidth pre-filter).
          reportingUnits: facilitiesNow,
        });
        let response;
        try {
          response = await api.calculateAudit(payload);
        } catch (err) {
          // On total failure the backend still returns the structured
          // envelope (with populated errors[]) alongside HTTP 400. Capture
          // those errors for row attribution, then keep iterating other
          // facilities so we can still surface their results/errors.
          if (err instanceof ApiError && err.body && Array.isArray(err.body.errors)) {
            for (const ee of err.body.errors) mergedErrors.push(ee);
            totalFailure = true;
            totalFailureMessage = err.message || totalFailureMessage;
            continue;
          }
          throw err;
        }
        for (const rr of response.results || []) mergedResults.push(rr);
        for (const tr of response.trace || []) mergedTrace.push(tr);
        for (const ar of response.audit_rows || []) mergedAudit.push(ar);
        for (const ee of response.errors || []) mergedErrors.push(ee);
        for (const [k, v] of Object.entries(response.summary || {})) {
          summaryMap[k] = (summaryMap[k] || 0) + Number(v);
        }
      }
      const transformedResultRows = mergedResults.map((r, i) => ({
        id: `${i}`,
        ...r,
        value: toMetricTons(r.value, r.unit),
        unit: "metric ton",
        facility_name: facilityNameById[r.facility_id] || r.facility_id,
        activity_label:
          r.activity_label
          || activityLabelById[r.activity_type_id]
          || r.activity_type_id,
      }));
      const transformedTraceRows = mergedTrace.map((r, i) => ({ id: `${i}`, ...r }));
      const transformedAuditRows = mergedAudit.map((r, i) => ({
        id: `a_${i}`,
        ...r,
        facility_name: facilityNameById[r.facility_id] || r.facility_id,
        activity_label:
          r.activity_label
          || activityLabelById[r.activity_type_id]
          || r.activity_type_id,
      }));
      setResultRows(transformedResultRows);
      setTraceRows(transformedTraceRows);
      setAuditRows(transformedAuditRows);
      const metricTonSummary = {};
      for (const [key, value] of Object.entries(summaryMap)) {
        const parts = key.split("|");
        const unit = parts.length >= 5 ? parts[4] : "kg";
        if (parts.length >= 5) parts[4] = "metric ton";
        const nextKey = parts.length >= 5 ? parts.join("|") : key;
        metricTonSummary[nextKey] = (metricTonSummary[nextKey] || 0) + toMetricTons(value, unit);
      }
      const transformedSummaryRows = Object.entries(metricTonSummary).map(
        ([key, value], i) => ({ id: `${i}`, key, value }),
      );
      setSummaryRows(transformedSummaryRows);
      setCalcErrors(mergedErrors);
      const partialSuccess = mergedErrors.length > 0 && mergedResults.length > 0;
      const totalFailureNoResults = totalFailure && mergedResults.length === 0;
      // Auto-save the post-calc state for audit. The dashboard updates
      // via in-memory state (Option B) and does NOT depend on this
      // save firing — display is decoupled from persistence. We pass
      // the freshly-computed rows as overrides so the snapshot reflects
      // this calc even though the React state setters above haven't
      // flushed through closure yet.
      if (mergedResults.length > 0) {
        try {
          await saveCurrentVersion("Auto-saved after calculation.", {
            resultRows: transformedResultRows,
            summaryRows: transformedSummaryRows,
            traceRows: transformedTraceRows,
            auditRows: transformedAuditRows,
          });
        } catch (saveErr) {
          // ``saveCurrentVersion`` already toasts; the dashboard works
          // regardless. No further action needed here.
        }
      }
      if (totalFailureNoResults) {
        // All activities failed. Keep the user on the data-entry tab so
        // they can see the per-row chips flip to "Calc error". Snackbar
        // surfaces the first error message; tooltips cover the rest.
        show(`Calculation failed: ${totalFailureMessage || "all activities errored"}`, "error");
      } else if (partialSuccess) {
        // Post-C4 round-5 item 4: previously partialSuccess flipped the
        // tab to Results (3), which whisked the user away from the
        // row-level error chips just as they appeared. The snackbar
        // would auto-dismiss two seconds later and the user was left on
        // the Results tab wondering what happened. Now we stay on the
        // data-entry tab when ANY row failed so the per-row Calc error
        // chips are immediately visible. The snackbar still names the
        // count — the row chips are the persistent surface.
        show(
          `Some activities failed to calculate (${mergedErrors.length}) — see row details.`,
          "warning",
        );
      } else {
        setView("project");
        setTab(4);
        if (skippedRows.length) {
          show(
            `Calculation complete. Skipped ${skippedRows.length} unsupported activity row${skippedRows.length === 1 ? "" : "s"} that are not calculable yet.`,
            "warning",
          );
        } else {
          show("Calculation complete", "success");
        }
      }
    } catch (e) {
      // Fall-through path for non-ApiError failures (network, 5xx, etc.).
      // Structured 400s are handled inline above and populate calcErrors.
      show(`Calculation failed: ${e.message}`, "error");
    } finally {
      setCalculating(false);
    }
  };

  // Phase F1.2 — Notifications panel state. The badge count + items
  // come from the unified notices builder; the open-flag is local to
  // App so the sidebar's notifications icon can drive it.
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);
  const notifications = React.useMemo(
    () => buildNotifications({
      coverage: projectCoverage,
      activities,
      activityTypesById,
    }),
    [projectCoverage, activities, activityTypesById],
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      <Sidebar
        activeView={view}
        onSelectView={(next) => {
          setView(next);
          // Returning to project mode lands on whatever tab the user
          // last had open within project mode (existing ``tab`` state).
        }}
        notificationCount={notifications.badge}
        onOpenNotifications={() => setNotificationsOpen(true)}
      />
      <NotificationsPanel
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        coverage={projectCoverage}
        activities={activities}
        activityTypesById={activityTypesById}
        activityLabelById={activityLabelById}
      />
      <EditProjectSetupDialog
        open={editProjectSetupOpen}
        onClose={() => setEditProjectSetupOpen(false)}
        inventoryYear={inventoryYear}
        gwpSet={gwpSet}
        includeTrace={includeTrace}
        onSave={({ inventory_year, gwp_set, include_trace }) => {
          setInventoryYear(String(inventory_year));
          setGwpSet(gwp_set);
          setIncludeTrace(include_trace);
          setEditProjectSetupOpen(false);
        }}
      />
      {/*
        Phase F2 PR 2 — generous bottom padding so the last data-entry
        row (or any tab's tail content) can sit mid-screen rather than
        glued to the viewport edge. Per Stephen's backlog item:
        "Add some kind of scroll buffer at the bottom so we can see
        the bottom data entry tables in mid screen rather than stuck
        at the very bottom." 12 spacing units = 96px on the standard
        8pt grid; comfortably reveals the next chunk of the page.
      */}
      <Container
        maxWidth="xl"
        sx={{ pt: { xs: 2, md: 3 }, pb: { xs: 6, md: 12 }, flexGrow: 1 }}
      >
      {/*
        Post-C4 polish item 1: split the former single sticky shell into
        two cooperating elements:
          1. A non-sticky full header Paper that scrolls away naturally.
          2. A sticky compact bar that carries the tabs at all times and
             fades in a compact project chip after the user scrolls past
             the header. This gives the user one visual anchor at the top
             of the page instead of two.
        The tabs Paper itself is the sticky top layer — its height feeds
        the `--sticky-top-height` CSS variable so downstream sticky bars
        (view-selector in ActivityInputsPanel, TOC sidebar) line up.
      */}
      <Box
        sx={{
          // F2 PR 5 — title bar is no longer wrapped in a Paper. Per
          // Stephen's smoke-test feedback after PR 4: "remove the
          // bubble background on the top section entirely — land it
          // on the background so we eliminate one more bubble
          // element". The sticky tabs below have their own opaque
          // bgcolor and ``position: sticky``; on scroll, the title
          // bar scrolls naturally up under them. The opacity-fade +
          // pointer-events dance from prior phases is gone — the
          // sticky bar covers the title bar without help.
          mb: 1,
          py: { xs: 1, md: 1.25 },
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          alignItems={{ md: "center" }}
          spacing={1}
        >
          {/* F2 PR 5 — uniform spacing across the header row. Both
              dividers now use the same dimensions (1.5px wide,
              text-secondary at 0.4 opacity) and inherit the parent
              Stack's ``spacing={2}`` rhythm with no extra mx
              overrides — Stephen's PR 4 smoke flagged the prior
              uneven spacing (extra margin on the second divider) and
              the inconsistent divider weights (one too thick, one
              too thin). */}
          <Stack
            direction="row"
            spacing={2}
            alignItems="center"
            sx={{ color: "text.primary", minWidth: 0, flexWrap: "wrap", rowGap: 0.5 }}
          >
            <ParametrixLogo height={22} />
            <Box
              sx={{
                width: "1.5px",
                alignSelf: "stretch",
                bgcolor: "text.secondary",
                opacity: 0.4,
                borderRadius: 1,
              }}
            />
            <ClimateMetrixWordmark height={20} />
            {activeProject ? (
              <>
                <Box
                  sx={{
                    width: "1.5px",
                    alignSelf: "stretch",
                    bgcolor: "text.secondary",
                    opacity: 0.4,
                    borderRadius: 1,
                  }}
                />
                <Typography
                  variant="h4"
                  sx={{
                    color: "text.primary",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  data-testid="project-page-title"
                >
                  {activeProject.name}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  data-testid="project-setup-summary"
                  sx={{ whiteSpace: "nowrap" }}
                >
                  {`${inventoryYear} · GWP ${gwpSet} · Trace ${includeTrace ? "on" : "off"}`}
                </Typography>
              </>
            ) : null}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
            {activeProject ? (
              <Button
                // F2 PR 4 — toned down from outlined to text variant.
                // Edit Project Setup is a rare action; the outlined
                // weight made it compete with the primary
                // Run Calculation button in the sticky bar above.
                variant="text"
                size="small"
                onClick={() => setEditProjectSetupOpen(true)}
                data-testid="edit-project-setup-button"
              >
                Edit Project Setup
              </Button>
            ) : null}
            <Tooltip
              title={colorMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              <IconButton
                size="small"
                onClick={onToggleColorMode}
                aria-label={colorMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {colorMode === "dark" ? (
                  <LightModeOutlinedIcon fontSize="small" />
                ) : (
                  <DarkModeOutlinedIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </Box>

      <Paper
        ref={topBarRef}
        sx={{
          px: 1.5,
          pt: 0.5,
          position: "sticky",
          top: 0,
          zIndex: (theme) => theme.zIndex.appBar,
          mb: 2,
          // Opaque fill so scrolling rows don't read through. Matches the
          // view-selector bar below for a contiguous top stack.
          bgcolor: "background.paper",
        }}
        data-testid="app-top-bar"
      >
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ width: "100%" }}>
          {/*
            Phase F1 — tabs render only in project view; Projects and
            Catalog are now sidebar-mediated. ``value`` props keep the
            internal indices stable (1..6) so the existing tab-content
            rendering below continues to work without index shifting.
          */}
          {view === "project" ? (
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ flexGrow: 1, minHeight: 48 }}>
              <Tab value={1} label="Reporting Units" disabled={!hasActiveProject} />
              <Tab value={2} label="Activity Inputs" disabled={!hasActiveProject} />
              <Tab value={3} label="Spend Inputs" disabled={!hasActiveProject} />
              <Tab value={4} label="Results" disabled={!hasActiveProject} />
              <Tab value={5} label="Dashboard" disabled={!hasActiveProject} />
              <Tab value={6} label="Audit" disabled={!hasActiveProject} />
            </Tabs>
          ) : (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexGrow: 1, py: 1.5 }}>
              <Typography variant="subtitle1">
                {view === "projects" ? "Projects" : view === "catalog" ? "Catalog" : ""}
              </Typography>
              {hasActiveProject ? (
                <Chip
                  color="primary"
                  size="small"
                  label={`Open ${activeProject.name}`}
                  onClick={() => { setView("project"); setTab(1); }}
                  sx={{ cursor: "pointer" }}
                />
              ) : null}
            </Stack>
          )}
          {isScrolled && activeProject && view === "project" ? (
            // F2 PR 3 — pre-PR-3 this was a green chip
            // (``color="secondary"``). It collided with
            // ``AutosaveStatusChip``'s success-green "Saved" pill;
            // the two read as two status indicators next to each
            // other rather than "page identity" + "save status".
            // Replaced with a plain text label — the project name is
            // wayfinding, not state.
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 600,
                color: "text.primary",
                pl: 0.5,
                pr: 1.5,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                opacity: isScrolled ? 1 : 0,
                transition: "opacity 180ms ease",
              }}
              data-testid="scrolled-project-label"
            >
              {activeProject.name}
            </Typography>
          ) : null}
          {hasActiveProject ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <AutosaveStatusChip status={autosave.status} lastSavedAt={autosave.lastSavedAt} />
              <Button
                variant="outlined"
                size="small"
                onClick={() => saveCurrentVersion("Manual checkpoint.")}
                disabled={projectBusy}
              >
                Save Version
              </Button>
              <Button
                variant="contained"
                size="small"
                onClick={runCalculation}
                disabled={calculating}
              >
                {calculating ? "Calculating..." : "Run Calculation"}
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </Paper>

      {/*
        Phase D1 — restore banner. Surfaces when a draft was found on
        project load that's newer than the latest committed version.
        Non-blocking: tabs remain interactive.
        Phase F2 PR 4 — gained an X dismiss button. Dismissal is
        keyed off the draft's ``updated_at`` so a fresh draft (newer
        timestamp) re-shows the banner; reload also re-shows.
      */}
      {pendingDraft && restoreBannerDismissedFor !== pendingDraft.updated_at ? (
        <Alert
          severity="info"
          data-testid="autosave-restore-banner"
          sx={{ mb: 2 }}
          action={
            // MUI's ``Alert`` swallows the default close icon when
            // ``action`` is set, so we surface the dismiss control
            // manually alongside Restore / Discard.
            <Stack direction="row" spacing={1} alignItems="center">
              <Button color="inherit" size="small" onClick={restoreDraft}>
                Restore draft
              </Button>
              <Button color="inherit" size="small" onClick={discardDraft}>
                Discard draft
              </Button>
              <IconButton
                size="small"
                color="inherit"
                aria-label="Hide restore banner"
                onClick={() => setRestoreBannerDismissedFor(pendingDraft.updated_at)}
                data-testid="autosave-restore-banner-dismiss"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          }
        >
          You have unsaved changes from{" "}
          {pendingDraft.updated_at ? formatTimestamp(pendingDraft.updated_at) : "earlier"}. Restore them?
        </Alert>
      ) : null}

      {view === "projects" && (
        <Stack spacing={2}>
          <Paper sx={{ p: 2 }}>
            <Stack spacing={1.5}>
              <Typography variant="h6">Project Setup</Typography>
              <Typography variant="body2" color="text.secondary">
                Enter project name and inventory year, then save snapshots as your data evolves.
              </Typography>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.25}>
                <TextField
                  label="Project Name"
                  placeholder="2026 Corporate Inventory"
                  value={projectNameDraft}
                  onChange={(e) => setProjectNameDraft(e.target.value)}
                  sx={{ minWidth: 280 }}
                />
                <TextField
                  label="Current Inventory Year"
                  value={inventoryYear}
                  onChange={(e) => setInventoryYear(e.target.value)}
                  sx={{ width: 220 }}
                />
                <Button variant="contained" onClick={createProject} disabled={projectBusy}>
                  Create Project
                </Button>
              </Stack>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} alignItems={{ md: "center" }}>
                <Select
                  displayEmpty
                  value={activeProjectId}
                  onChange={(e) => selectProject(e.target.value)}
                  sx={{ minWidth: 330 }}
                >
                  <MenuItem value="">
                    <em>Select Existing Project</em>
                  </MenuItem>
                  {projects.map((p) => (
                    <MenuItem key={p.project_id} value={p.project_id}>
                      {p.name} (v{p.latest_version})
                    </MenuItem>
                  ))}
                </Select>
                <TextField
                  label="Version Note (optional)"
                  placeholder="Updated electricity usage and refrigerants."
                  value={versionNote}
                  onChange={(e) => setVersionNote(e.target.value)}
                  sx={{ minWidth: 300, flexGrow: 1 }}
                />
                <Button variant="outlined" disabled={!hasActiveProject || projectBusy} onClick={() => saveCurrentVersion(versionNote)}>
                  Save Snapshot
                </Button>
                {hasActiveProject ? (
                  <AutosaveStatusChip status={autosave.status} lastSavedAt={autosave.lastSavedAt} />
                ) : null}
                <Button
                  variant="outlined"
                  disabled={!hasActiveProject || projectBusy}
                  onClick={async () => {
                    await loadLatestSnapshot(activeProjectId);
                    setView("project");
                    setTab(1);
                    show("Loaded latest snapshot.", "success");
                  }}
                >
                  Load Latest
                </Button>
              </Stack>
              <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} alignItems={{ md: "center" }}>
                <TextField
                  label="Rename Active Project"
                  value={projectRenameDraft}
                  onChange={(e) => setProjectRenameDraft(e.target.value)}
                  sx={{ minWidth: 330 }}
                  disabled={!hasActiveProject}
                />
                <Button variant="outlined" disabled={!hasActiveProject || projectBusy} onClick={renameActiveProject}>
                  Rename
                </Button>
                <Button variant="outlined" color="error" disabled={!hasActiveProject || projectBusy} onClick={deleteActiveProject}>
                  Delete Project
                </Button>
              </Stack>
              {projectError ? <Alert severity="error">{projectError}</Alert> : null}
            </Stack>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Version History
            </Typography>
            {schemaInfo ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                SQLite schema version: v{schemaInfo.current_version}
              </Typography>
            ) : null}
            {projectVersions.length === 0 ? (
              <Typography color="text.secondary">No versions saved yet.</Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Version</TableCell>
                      <TableCell>Timestamp</TableCell>
                      <TableCell>Inventory Year</TableCell>
                      <TableCell>GWP</TableCell>
                      <TableCell>Trace</TableCell>
                      <TableCell>Note</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {projectVersions.map((v) => (
                      <TableRow key={v.version_id}>
                        <TableCell>v{v.version_number}</TableCell>
                        <TableCell>{formatTimestamp(v.created_at)}</TableCell>
                        <TableCell>{v.inventory_year}</TableCell>
                        <TableCell>{v.gwp_set}</TableCell>
                        <TableCell>{v.include_trace ? "Yes" : "No"}</TableCell>
                        <TableCell>{v.note || "-"}</TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            onClick={async () => {
                              try {
                                const payload = await api.getProjectSnapshot(activeProjectId, v.version_number);
                                applySnapshot(payload);
                                setView("project");
                                setTab(1);
                                show(`Loaded version v${v.version_number}.`, "success");
                              } catch (e) {
                                show(`Failed to load version: ${e.message || e}`, "error");
                              }
                            }}
                          >
                            Load
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Stack>
      )}

      {view === "project" && tab === 1 && hasActiveProject && (
        <React.Suspense fallback={<LazyTabFallback />}>
          <ReportingUnitsTab
            reportingUnits={facilities}
            setReportingUnits={setFacilities}
            onAddReportingUnit={addReportingUnit}
            onRemoveReportingUnit={removeReportingUnit}
            activityCatalog={activityCatalog}
            activities={activities}
            newlyCreatedIds={newlyCreatedReportingUnitIds}
          />
        </React.Suspense>
      )}

      {view === "project" && tab === 2 && hasActiveProject && (
        <React.Suspense fallback={<LazyTabFallback />}>
          <ActivityInputsPanel
            activities={activities}
            setActivities={setActivities}
            reportingUnits={dataEntryFacilities}
            setReportingUnits={setFacilities}
            activityCatalog={activityCatalog}
            activityTypesById={activityTypesById}
            activityLabelById={activityLabelById}
            facilityOptions={facilityOptions}
            runCalculation={runCalculation}
            calculating={calculating}
            saveCurrentVersion={saveCurrentVersion}
            catalogError={catalogError}
            calcErrors={calcErrors}
            coverage={projectCoverage}
            show={show}
          />
        </React.Suspense>
      )}

      {view === "project" && tab === 3 && hasActiveProject && (
        <React.Suspense fallback={<LazyTabFallback />}>
          <SpendInputsTab
            projectId={activeProjectId}
            reportingUnits={dataEntryFacilities}
            activities={activities}
            setActivities={setActivities}
            show={show}
          />
        </React.Suspense>
      )}

      {view === "project" && tab === 4 && hasActiveProject && (
        <React.Suspense fallback={<LazyTabFallback />}>
          <ResultsTab
            resultRows={resultRows}
            summaryRows={summaryRows}
            traceRows={traceRows}
            onSaveResults={saveCurrentVersion}
            coverage={projectCoverage}
            coverageSummaryText={coverageSummaryText}
            activityLabelById={activityLabelById}
            onJumpToActivityInputs={() => { setView("project"); setTab(2); }}
          />
        </React.Suspense>
      )}

      {view === "project" && tab === 5 && hasActiveProject && (
        <React.Suspense fallback={<LazyTabFallback />}>
          {/*
            Option-B refactor: the dashboard now derives its analytics
            rows from the in-memory ``resultRows`` React state instead
            of round-tripping to ``GET /projects/{id}/analytics``. The
            endpoint is still wired and available for future cross-
            version queries (compare v3 to v5, PDF export); the live
            tab just doesn't depend on it.
          */}
          <DashboardTab
            projectId={activeProjectId}
            resultRows={resultRows}
            activityTypesById={activityTypesById}
          />
        </React.Suspense>
      )}

      {view === "project" && tab === 6 && hasActiveProject && (
        <React.Suspense fallback={<LazyTabFallback />}>
          <AuditTab
            auditRows={auditRows}
            onExportAuditCsv={downloadAuditCsv}
          />
        </React.Suspense>
      )}

      {view === "catalog" && (
        <React.Suspense fallback={<LazyTabFallback />}>
          <CatalogTab activityCatalog={activityCatalog} />
        </React.Suspense>
      )}

      {!hasActiveProject && view === "project" ? (
        <Alert severity="info" sx={{ mt: 2 }}>
          Create or select a project from the Projects panel (left sidebar) to unlock data entry and calculation tabs.
        </Alert>
      ) : null}

      {/*
        Post-C4 round-5 item 4: error/warning toasts get a longer
        autoHide window so the user has time to read them before
        attention shifts to the row-level chips. Success toasts keep
        the previous 2.6s. The row chip stays the persistent surface;
        the toast is just confirmation.
      */}
      <Snackbar
        open={snack.open}
        autoHideDuration={snack.sev === "error" || snack.sev === "warning" ? 6000 : 2600}
        onClose={close}
      >
        <Alert severity={snack.sev} onClose={close} variant="filled">
          {snack.msg}
        </Alert>
      </Snackbar>
      </Container>
    </Box>
  );
}
