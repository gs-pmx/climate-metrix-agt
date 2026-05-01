import * as React from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { DataGrid } from "@mui/x-data-grid";
import { NumericEditCell } from "./gridEditingHelpers";
import { formatNumericDisplay } from "./numericFormat";
import { autofillSpendRow } from "./spendMappings";
import { validateSpendRow } from "./spendRows";
import { parseTSV } from "./usePasteHandler";

// Phase F2 PR 7 — column order for paste import. Pasted TSV is mapped
// left-to-right onto these fields. The first four are params; the
// fifth lands on activity.value.
const PASTE_COLUMNS = [
  "gl_code",
  "gl_account_name",
  "supplier",
  "supplier_country",
  "spend_value",
];

function rowsFromParsedTsv(parsed) {
  if (!parsed || !parsed.length) return [];
  return parsed.map((cells) => {
    const out = {};
    for (let i = 0; i < PASTE_COLUMNS.length; i += 1) {
      const value = cells[i];
      if (value === undefined || value === "") continue;
      out[PASTE_COLUMNS[i]] = value;
    }
    return out;
  }).filter((row) => Object.keys(row).length > 0);
}

// Phase E3 — per-RU spend transaction entry table.
//
// Each row maps to a ``scope3_spend_based`` activity draft. The
// columns mirror the catalog's ``input_schema`` for that type (post-
// E3 changes: gl_account_name added, transaction_year removed from
// the visible row — it defaults to the project's inventory year on
// the backend). gl_code is the lookup key against the project's GL
// mappings; the human-readable account name rides along for
// traceability and is not part of the calculation.
//
// Validation runs per row and surfaces as a status chip in the first
// column. Codes:
//   - ``missing_gl_code``  blank gl_code; calc would skip / error
//   - ``unmapped_gl_code`` gl_code is set but isn't in this RU's
//                          mapping table; calc would surface this as
//                          the same backend error code
//   - ``missing_spend``    activity.value is blank; warn-only
//
// The component is presentational — all state lives in App.jsx via
// the parent's ``activities`` array. Edits flow up through the
// ``onPatchRow`` callback which the parent funnels into the pure
// ``patchSpendRow`` helper.

const WARNING_LABELS = {
  missing_gl_code: "GL Code is blank — fill in to calculate.",
  unmapped_gl_code: "GL Code has no mapping — open Configure Spend Mapping to add one.",
  missing_spend: "Spend value is blank — enter 0 if intentional, otherwise fill in.",
};

function StatusCell({ warnings }) {
  if (!warnings.length) {
    return (
      <Typography variant="caption" color="success.main">
        OK
      </Typography>
    );
  }
  const tooltipBody = (
    <Stack spacing={0.5}>
      {warnings.map((code) => (
        <span key={code}>{WARNING_LABELS[code] || code}</span>
      ))}
    </Stack>
  );
  return (
    <Tooltip title={tooltipBody} arrow placement="right">
      <Stack direction="row" spacing={0.5} alignItems="center">
        <WarningAmberIcon fontSize="small" color="warning" />
        <Typography variant="caption" color="warning.main">
          {warnings.length}
        </Typography>
      </Stack>
    </Tooltip>
  );
}

function formatSpend(value) {
  if (value === "" || value === null || value === undefined) return "";
  if (typeof value === "number") return formatNumericDisplay(value);
  return String(value);
}

export default function SpendRowsTable({
  rows,
  mappingsForRu,
  onAddRow,
  onPatchRow,
  onDeleteRow,
  onPasteRows,
  show,
}) {
  // Memoize the (row -> warnings) lookup so the chip doesn't recompute
  // on every keystroke in an unrelated cell.
  const warningsByRowId = React.useMemo(() => {
    const out = {};
    for (const row of rows || []) {
      out[row.id] = validateSpendRow(row, mappingsForRu);
    }
    return out;
  }, [rows, mappingsForRu]);

  const tableRows = React.useMemo(
    () =>
      (rows || []).map((row) => ({
        id: row.id,
        gl_code: row.params?.gl_code || "",
        gl_account_name: row.params?.gl_account_name || "",
        supplier: row.params?.supplier || "",
        supplier_country: row.params?.supplier_country || "",
        spend_value: row.activity?.value ?? "",
      })),
    [rows],
  );

  const handleProcessRowUpdate = React.useCallback(
    (newRow, oldRow) => {
      const patch = {};
      if (newRow.gl_code !== oldRow.gl_code) patch["param.gl_code"] = newRow.gl_code;
      if (newRow.gl_account_name !== oldRow.gl_account_name) {
        patch["param.gl_account_name"] = newRow.gl_account_name;
      }
      if (newRow.supplier !== oldRow.supplier) patch["param.supplier"] = newRow.supplier;
      if (newRow.supplier_country !== oldRow.supplier_country) {
        patch["param.supplier_country"] = newRow.supplier_country;
      }
      if (newRow.spend_value !== oldRow.spend_value) {
        patch.activity_value = newRow.spend_value;
      }

      // Autofill: if the user just changed code or name and the other
      // is blank, fill it from the RU's mapping table. Never overwrite
      // a non-blank field — accountants pasting an ERP export may have
      // a custom name for a code, and silent rewrites would erase it.
      let resolvedRow = newRow;
      if (
        newRow.gl_code !== oldRow.gl_code
        || newRow.gl_account_name !== oldRow.gl_account_name
      ) {
        const filled = autofillSpendRow(
          { gl_code: newRow.gl_code, gl_account_name: newRow.gl_account_name },
          mappingsForRu,
        );
        if (filled.gl_account_name !== newRow.gl_account_name) {
          patch["param.gl_account_name"] = filled.gl_account_name;
          resolvedRow = { ...resolvedRow, gl_account_name: filled.gl_account_name };
        }
        if (filled.gl_code !== newRow.gl_code) {
          patch["param.gl_code"] = filled.gl_code;
          resolvedRow = { ...resolvedRow, gl_code: filled.gl_code };
        }
      }

      if (Object.keys(patch).length) onPatchRow(newRow.id, patch);
      return resolvedRow;
    },
    [mappingsForRu, onPatchRow],
  );

  // Paste handler. Reads TSV (the standard paste format from Excel /
  // Google Sheets) from either the paste event's clipboardData or via
  // navigator.clipboard.readText() for the explicit "Paste rows"
  // button. Each pasted row is bulk-appended via the parent's
  // onPasteRows callback so it lands as a fresh spend row, even if
  // the paste exceeds the currently-rendered row count.
  const applyPaste = React.useCallback(
    (text) => {
      if (!onPasteRows) return;
      const parsed = parseTSV(text || "");
      const rowDataList = rowsFromParsedTsv(parsed);
      if (!rowDataList.length) return;
      onPasteRows(rowDataList);
      if (show) {
        show(`Pasted ${rowDataList.length} spend row${rowDataList.length === 1 ? "" : "s"}.`, "success");
      }
    },
    [onPasteRows, show],
  );

  const handlePasteEvent = React.useCallback(
    (event) => {
      // If a cell is in edit mode, the focused element is an <input> /
      // <textarea> — let the cell's own paste handler take over.
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
      if (!text || !text.trim()) {
        if (show) show("Clipboard is empty.", "warning");
        return;
      }
      applyPaste(text);
    } catch (e) {
      if (show) show("Could not read clipboard. Check browser permissions.", "warning");
    }
  }, [applyPaste, show]);

  const columns = React.useMemo(
    () => [
      {
        field: "__status",
        headerName: "Status",
        flex: 0.4,
        sortable: false,
        editable: false,
        renderCell: (params) => (
          <StatusCell warnings={warningsByRowId[params.id] || []} />
        ),
      },
      {
        field: "gl_code",
        headerName: "GL Code",
        flex: 0.7,
        editable: true,
      },
      {
        field: "gl_account_name",
        headerName: "GL Account Name",
        flex: 1.1,
        editable: true,
      },
      {
        field: "supplier",
        headerName: "Supplier",
        flex: 1,
        editable: true,
      },
      {
        field: "supplier_country",
        headerName: "Country",
        flex: 0.6,
        editable: true,
      },
      {
        field: "spend_value",
        headerName: "Spend (USD)",
        type: "number",
        flex: 0.8,
        editable: true,
        renderEditCell: (params) => <NumericEditCell {...params} />,
        valueFormatter: (value) => formatSpend(value),
      },
      {
        field: "__actions",
        headerName: "",
        sortable: false,
        editable: false,
        flex: 0.3,
        renderCell: (params) => (
          <Tooltip title="Delete row">
            <IconButton
              size="small"
              onClick={() => onDeleteRow(params.id)}
              aria-label="delete spend row"
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [warningsByRowId, onDeleteRow],
  );

  return (
    <Stack spacing={1}>
      {/* tabIndex makes the wrapper focusable so a top-level paste
          (after clicking on the table area but before entering a cell)
          gets routed through ``handlePasteEvent``. Cell-level paste
          while editing is still handled by the cell's own input. */}
      <Box
        sx={{ width: "100%" }}
        tabIndex={0}
        onPaste={handlePasteEvent}
      >
        <DataGrid
          rows={tableRows}
          columns={columns}
          processRowUpdate={handleProcessRowUpdate}
          onProcessRowUpdateError={() => {}}
          disableRowSelectionOnClick
          autoHeight
          hideFooter={tableRows.length <= 25}
          sx={{
            border: "none",
            "& .MuiDataGrid-cell": { alignItems: "center" },
          }}
          slots={{
            noRowsOverlay: () => (
              <Stack
                alignItems="center"
                justifyContent="center"
                sx={{ height: "100%", py: 4 }}
              >
                <Typography variant="body2" color="text.secondary">
                  No spend transactions yet — click “Add row” or paste a block from your spreadsheet.
                </Typography>
              </Stack>
            ),
          }}
        />
      </Box>
      <Stack direction="row" spacing={1}>
        <Button startIcon={<AddIcon />} size="small" onClick={onAddRow}>
          Add row
        </Button>
        {onPasteRows ? (
          <Tooltip title="Paste tab-separated rows from a spreadsheet (gl_code, account name, supplier, country, spend).">
            <Button
              startIcon={<ContentPasteIcon />}
              size="small"
              onClick={handlePasteButton}
            >
              Paste rows
            </Button>
          </Tooltip>
        ) : null}
      </Stack>
    </Stack>
  );
}
