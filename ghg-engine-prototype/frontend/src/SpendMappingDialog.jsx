import * as React from "react";
import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

import { findFactorByIdentifier } from "./spendMappings";
import { parseTSV } from "./usePasteHandler";

// Phase E2 — per-RU GL mapping editor.
//
// Each row pairs a customer GL code (and optional human-readable
// account name) with a spend-based emission factor from the seeded
// catalog. ``factor_id`` stored in the mapping is the factor's
// ``source_record_key`` (e.g. ``useeio:541110``), which is what the
// orchestrator's resolver feeds into the spend-based plugin.
//
// The dialog operates on a single RU's mappings only. The parent
// (SpendInputsTab) is responsible for merging this RU's edits back
// into the project-wide mapping list before PUT.

const ROW_TEMPLATE = () => ({
  __id: Math.random().toString(36).slice(2, 10),
  gl_code: "",
  gl_account_name: "",
  factor_id: "",
});

function asEditableRow(mapping) {
  return {
    __id: Math.random().toString(36).slice(2, 10),
    gl_code: mapping?.gl_code || "",
    gl_account_name: mapping?.gl_account_name || "",
    factor_id: mapping?.factor_id || "",
  };
}

function indexFactorsById(factors) {
  const map = {};
  for (const f of factors || []) {
    if (f?.source_record_key) map[f.source_record_key] = f;
  }
  return map;
}

function factorLabel(factor) {
  if (!factor) return "";
  const desc = factor.description || factor.factor_type || factor.source_record_key;
  const src = factor.source_id ? ` — ${factor.source_id}` : "";
  return `${desc}${src}`;
}

export default function SpendMappingDialog({
  open,
  onClose,
  reportingUnit,
  initialMappings,
  spendFactors,
  loadingFactors,
  onSave,
  saving,
}) {
  const [rows, setRows] = React.useState([]);

  // Reset working state every time the dialog opens. Without this, the
  // user re-opens the dialog and sees their previous in-flight edits.
  React.useEffect(() => {
    if (!open) return;
    const seeded = (initialMappings || []).map(asEditableRow);
    setRows(seeded.length ? seeded : [ROW_TEMPLATE()]);
  }, [open, initialMappings]);

  const factorsById = React.useMemo(() => indexFactorsById(spendFactors), [spendFactors]);

  const updateRow = (id, patch) => {
    setRows((prev) => prev.map((r) => (r.__id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.__id !== id);
      return next.length ? next : [ROW_TEMPLATE()];
    });
  };

  const addRow = () => setRows((prev) => [...prev, ROW_TEMPLATE()]);

  // Phase F2 PR 8 — paste a block from the user's chart-of-accounts
  // spreadsheet directly into the mapping editor. TSV columns are
  // mapped left-to-right onto: gl_code, gl_account_name,
  // factor_identifier (a source_record_key like "useeio:541110" or a
  // factor description like "Legal Services"). Unmatched factor
  // strings come through as blank factor_id so the user sees the row
  // and can resolve via the Autocomplete; the gl_code + name still
  // import.
  //
  // Behavior on existing state: if the editor's only row is the
  // default empty template, the paste replaces it. Otherwise pasted
  // rows are appended after the existing ones.
  const applyPaste = React.useCallback(
    (text) => {
      const parsed = parseTSV(text || "");
      if (!parsed.length) return 0;
      const pastedRows = parsed
        .map((cells) => {
          const code = String(cells[0] ?? "").trim();
          const name = String(cells[1] ?? "").trim();
          const factorIdent = String(cells[2] ?? "").trim();
          if (!code && !name && !factorIdent) return null;
          const factor = factorIdent ? findFactorByIdentifier(spendFactors, factorIdent) : null;
          return {
            __id: Math.random().toString(36).slice(2, 10),
            gl_code: code,
            gl_account_name: name,
            factor_id: factor?.source_record_key || "",
          };
        })
        .filter(Boolean);
      if (!pastedRows.length) return 0;
      setRows((prev) => {
        const onlyEmptyDefault =
          prev.length === 1
          && !prev[0].gl_code
          && !prev[0].gl_account_name
          && !prev[0].factor_id;
        if (onlyEmptyDefault) return pastedRows;
        return [...prev, ...pastedRows];
      });
      return pastedRows.length;
    },
    [spendFactors],
  );

  const handlePasteEvent = React.useCallback(
    (event) => {
      // Cell editors are inputs — let their own paste handler take
      // over so users can still paste a single value into one field.
      const tag = event.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const text = event.clipboardData?.getData("text/plain") || "";
      if (!text.trim()) return;
      event.preventDefault();
      applyPaste(text);
    },
    [applyPaste],
  );

  const handlePasteButton = React.useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) return;
      applyPaste(text);
    } catch (e) {
      // Clipboard read can fail on permissions; the user can still
      // paste with Ctrl+V on the dialog body itself.
    }
  }, [applyPaste]);

  const validRows = rows
    .map((r) => ({
      gl_code: (r.gl_code || "").trim(),
      gl_account_name: (r.gl_account_name || "").trim() || null,
      factor_id: (r.factor_id || "").trim(),
    }))
    .filter((r) => r.gl_code && r.factor_id);

  const dropped = rows.length - validRows.length;
  const duplicateGlCodes = (() => {
    const seen = new Set();
    const dups = new Set();
    for (const r of validRows) {
      if (seen.has(r.gl_code)) dups.add(r.gl_code);
      seen.add(r.gl_code);
    }
    return dups;
  })();

  const canSave = !saving && validRows.length > 0 && duplicateGlCodes.size === 0;

  const handleSave = () => {
    if (!canSave) return;
    onSave(validRows);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="spend-mapping-dialog-title"
    >
      <DialogTitle id="spend-mapping-dialog-title">
        Configure Spend Mapping
        {reportingUnit?.facility_name ? ` — ${reportingUnit.facility_name}` : ""}
      </DialogTitle>
      <DialogContent dividers onPaste={handlePasteEvent}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Pair each GL code from this Reporting Unit's chart of accounts with the
          spend-based emission factor it should resolve to. The account name is
          a human-readable label for your records and does not affect the
          calculation. GL code is the lookup key.
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: "20%" }}>GL Code</TableCell>
                <TableCell sx={{ width: "30%" }}>GL Account Name (optional)</TableCell>
                <TableCell sx={{ width: "45%" }}>Emission Factor</TableCell>
                <TableCell sx={{ width: "5%" }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const isDup = row.gl_code && duplicateGlCodes.has(row.gl_code.trim());
                return (
                  <TableRow key={row.__id} hover>
                    <TableCell>
                      <TextField
                        size="small"
                        fullWidth
                        value={row.gl_code}
                        onChange={(e) => updateRow(row.__id, { gl_code: e.target.value })}
                        placeholder="e.g. 5100"
                        error={isDup}
                        helperText={isDup ? "Duplicate GL code in this RU" : ""}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        fullWidth
                        value={row.gl_account_name}
                        onChange={(e) =>
                          updateRow(row.__id, { gl_account_name: e.target.value })
                        }
                        placeholder="e.g. Office Supplies"
                      />
                    </TableCell>
                    <TableCell>
                      <Autocomplete
                        size="small"
                        options={spendFactors || []}
                        loading={loadingFactors}
                        getOptionLabel={(opt) => factorLabel(opt)}
                        isOptionEqualToValue={(opt, val) =>
                          (opt?.source_record_key || "") === (val?.source_record_key || "")
                        }
                        value={factorsById[row.factor_id] || null}
                        onChange={(_e, val) =>
                          updateRow(row.__id, {
                            factor_id: val?.source_record_key || "",
                          })
                        }
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            placeholder={
                              loadingFactors ? "Loading factors…" : "Select a factor"
                            }
                          />
                        )}
                        renderOption={(props, opt) => (
                          <Box component="li" {...props} key={opt.source_record_key}>
                            <Stack>
                              <Typography variant="body2">
                                {opt.description || opt.factor_type || opt.source_record_key}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {opt.source_id}
                                {opt.factor_type ? ` · ${opt.factor_type}` : ""}
                                {opt.unit_label ? ` · ${opt.unit_label}` : ""}
                              </Typography>
                            </Stack>
                          </Box>
                        )}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Remove row">
                        <IconButton
                          size="small"
                          onClick={() => removeRow(row.__id)}
                          aria-label="remove mapping row"
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
          <Button startIcon={<AddIcon />} size="small" onClick={addRow}>
            Add row
          </Button>
          <Tooltip title="Paste tab-separated mappings: GL code, account name, factor (source_record_key or description).">
            <Button
              startIcon={<ContentPasteIcon />}
              size="small"
              onClick={handlePasteButton}
            >
              Paste mappings
            </Button>
          </Tooltip>
          {dropped > 0 ? (
            <Typography variant="caption" color="text.secondary">
              {dropped} incomplete row{dropped === 1 ? "" : "s"} will be skipped on save.
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!canSave}
        >
          {saving ? "Saving…" : "Save mappings"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
