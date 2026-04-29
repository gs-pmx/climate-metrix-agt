import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { api } from "./api";
import SpendMappingDialog from "./SpendMappingDialog";
import SpendRowsTable from "./SpendRowsTable";
import { filterRusWithSpendSelected, groupMappingsByRu } from "./spendMappings";
import {
  appendSpendRow,
  deleteSpendRow,
  getSpendRowsForRu,
  patchSpendRow,
} from "./spendRows";

// Phase E2 + E3 — Spend Inputs tab.
//
// Surfaces one card per Reporting Unit that has the
// ``scope3_spend_based`` activity type selected in its
// ``applicable_activity_types`` checklist. Each card hosts the per-RU
// GL mapping editor (E2) and, once a mapping is configured, the
// per-RU spend transaction table (E3). Rows in the table map 1:1
// onto ``scope3_spend_based`` activity drafts in the project's
// ``activities`` array, so the existing calc / autosave / snapshot
// machinery picks them up without additional wiring.

export default function SpendInputsTab({
  projectId,
  reportingUnits,
  activities,
  setActivities,
  show,
}) {
  const [allMappings, setAllMappings] = React.useState([]);
  const [spendFactors, setSpendFactors] = React.useState([]);
  const [loadingMappings, setLoadingMappings] = React.useState(false);
  const [loadingFactors, setLoadingFactors] = React.useState(false);
  const [error, setError] = React.useState("");
  const [editingRuId, setEditingRuId] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  const spendRus = React.useMemo(
    () => filterRusWithSpendSelected(reportingUnits),
    [reportingUnits],
  );

  // Pull GL mappings whenever the active project changes. The endpoint
  // returns the full project-wide list; we group by RU at render time.
  React.useEffect(() => {
    if (!projectId) {
      setAllMappings([]);
      return;
    }
    let cancelled = false;
    setLoadingMappings(true);
    setError("");
    api
      .getGlMappings(projectId)
      .then((rows) => {
        if (cancelled) return;
        setAllMappings(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(`Could not load GL mappings: ${err.message || "unknown error"}`);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingMappings(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Pull the spend-factor catalog once the tab mounts. The catalog is
  // read-only seed data so it can live for the session; we re-fetch on
  // tab remount which is rare.
  React.useEffect(() => {
    let cancelled = false;
    setLoadingFactors(true);
    api
      .listSpendFactors({ limit: 2000 })
      .then((rows) => {
        if (cancelled) return;
        setSpendFactors(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          (prev) =>
            prev ||
            `Could not load spend factors: ${err.message || "unknown error"}`,
        );
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingFactors(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mappingsByRu = React.useMemo(() => groupMappingsByRu(allMappings), [allMappings]);

  const editingRu = spendRus.find((ru) => ru.id === editingRuId) || null;
  const editingMappings = editingRuId ? mappingsByRu[editingRuId] || [] : [];

  const handleSaveRuMappings = async (ruId, ruMappings) => {
    if (!projectId) return;
    setSaving(true);
    setError("");
    // PUT replaces the whole project's mappings — preserve every other
    // RU's set and replace just this RU's.
    const otherRusMappings = allMappings.filter((m) => m.reporting_unit_id !== ruId);
    const projectDefaults = otherRusMappings.filter((m) => !m.reporting_unit_id);
    const otherRuOnly = otherRusMappings.filter((m) => m.reporting_unit_id);
    const nextThisRu = ruMappings.map((m) => ({
      reporting_unit_id: ruId,
      gl_code: m.gl_code,
      gl_account_name: m.gl_account_name || null,
      factor_id: m.factor_id,
    }));
    const payload = [
      ...projectDefaults.map((m) => ({
        reporting_unit_id: null,
        gl_code: m.gl_code,
        gl_account_name: m.gl_account_name || null,
        factor_id: m.factor_id,
      })),
      ...otherRuOnly.map((m) => ({
        reporting_unit_id: m.reporting_unit_id,
        gl_code: m.gl_code,
        gl_account_name: m.gl_account_name || null,
        factor_id: m.factor_id,
      })),
      ...nextThisRu,
    ];
    try {
      const refreshed = await api.replaceGlMappings(projectId, payload);
      setAllMappings(Array.isArray(refreshed) ? refreshed : []);
      setEditingRuId(null);
      if (show) {
        show(
          `Saved ${nextThisRu.length} mapping${nextThisRu.length === 1 ? "" : "s"} for ${
            editingRu?.facility_name || "Reporting Unit"
          }.`,
          "success",
        );
      }
    } catch (err) {
      setError(`Save failed: ${err.message || "unknown error"}`);
    } finally {
      setSaving(false);
    }
  };

  if (!projectId) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        Create or select a project first to configure spend mappings.
      </Alert>
    );
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Stack spacing={1} sx={{ mb: 2 }}>
        <Typography variant="h6">Spend Inputs</Typography>
        <Typography variant="body2" color="text.secondary">
          Configure GL-code-to-factor mappings for each Reporting Unit
          that has Scope 3 spend-based emissions enabled, then enter
          the underlying spend transactions below the mapping summary.
          Transactions map 1:1 to activity drafts and flow through the
          standard calculation path.
        </Typography>
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      ) : null}

      {spendRus.length === 0 ? (
        <Alert severity="info">
          No Reporting Units have Scope 3 spend-based emissions selected. Open
          the Reporting Units tab and use Configure Sources on a unit to
          enable {`"Scope 3 Spend-Based Emissions"`}, then come back here to
          configure the GL mapping.
        </Alert>
      ) : (
        <Stack spacing={2}>
          {spendRus.map((ru) => {
            const ruMappings = mappingsByRu[ru.id] || [];
            const hasMappings = ruMappings.length > 0;
            const spendRowsForRu = getSpendRowsForRu(activities, ru.id);
            return (
              <Card key={ru.id} variant="outlined">
                <CardContent>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={2}
                    alignItems={{ sm: "center" }}
                    justifyContent="space-between"
                  >
                    <Stack spacing={0.5}>
                      <Typography variant="subtitle1">
                        {ru.facility_name || "(unnamed Reporting Unit)"}
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center">
                        {hasMappings ? (
                          <Chip
                            size="small"
                            label={`${ruMappings.length} GL mapping${
                              ruMappings.length === 1 ? "" : "s"
                            }`}
                            color="primary"
                            variant="outlined"
                          />
                        ) : (
                          <Chip
                            size="small"
                            label="No mappings configured"
                            variant="outlined"
                          />
                        )}
                        {hasMappings ? (
                          <Chip
                            size="small"
                            label={`${spendRowsForRu.length} spend row${
                              spendRowsForRu.length === 1 ? "" : "s"
                            }`}
                            variant="outlined"
                          />
                        ) : null}
                        {loadingMappings ? (
                          <Typography variant="caption" color="text.secondary">
                            loading…
                          </Typography>
                        ) : null}
                      </Stack>
                    </Stack>
                    <Box>
                      <Button
                        variant={hasMappings ? "outlined" : "contained"}
                        startIcon={hasMappings ? <EditOutlinedIcon /> : null}
                        onClick={() => setEditingRuId(ru.id)}
                        disabled={loadingFactors && !spendFactors.length}
                      >
                        {hasMappings ? "Edit Mappings" : "Configure Spend Mapping"}
                      </Button>
                    </Box>
                  </Stack>
                  {hasMappings ? (
                    <>
                      <Divider sx={{ my: 2 }} />
                      <SpendRowsTable
                        rows={spendRowsForRu}
                        mappingsForRu={ruMappings}
                        onAddRow={() =>
                          setActivities((prev) => appendSpendRow(prev, ru.id).activities)
                        }
                        onPatchRow={(id, patch) =>
                          setActivities((prev) => patchSpendRow(prev, id, patch))
                        }
                        onDeleteRow={(id) =>
                          setActivities((prev) => deleteSpendRow(prev, id))
                        }
                      />
                    </>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}

      <SpendMappingDialog
        open={Boolean(editingRu)}
        onClose={() => (saving ? null : setEditingRuId(null))}
        reportingUnit={editingRu}
        initialMappings={editingMappings}
        spendFactors={spendFactors}
        loadingFactors={loadingFactors}
        saving={saving}
        onSave={(rows) => handleSaveRuMappings(editingRuId, rows)}
      />
    </Box>
  );
}
