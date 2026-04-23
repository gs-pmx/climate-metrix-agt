import * as React from "react";
import { InputBase, MenuItem, Select } from "@mui/material";
import { useGridApiContext } from "@mui/x-data-grid";
import { formatNumericDisplay, parseNumericInput } from "./numericFormat";
import { hasMeaningfulParamValue } from "./activityDrafts";
import { parseTSV } from "./usePasteHandler";

// Composite key used across bulk-entry grids.
export function pairKey(facilityId, activityTypeId) {
  return `${facilityId}::${activityTypeId}`;
}

export function hasMeaningfulData(draft) {
  if (draft?.activity?.value !== "" && draft?.activity?.value != null) return true;
  return Object.values(draft?.params || {}).some((value) => hasMeaningfulParamValue(value));
}

// Custom DataGrid edit cell for numeric inputs.
//
// Why we don't use the built-in type="number" DataGrid default:
//   * We want to accept thousands-separated values on paste / typing.
//   * We want ArrowUp/ArrowDown to commit and move focus, NOT to increment
//     the numeric value (which is the browser default on <input type=number>).
//   * We want to format on blur (thousands separators) without disturbing
//     caret position during typing.
export function NumericEditCell(props) {
  const { id, field, value, hasFocus } = props;
  const apiRef = useGridApiContext();
  const inputRef = React.useRef(null);
  const initialValue = value == null || value === "" ? "" : String(value);
  const [draft, setDraft] = React.useState(
    typeof value === "number" ? formatNumericDisplay(value) : initialValue,
  );

  React.useEffect(() => {
    if (hasFocus) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        // Select all so typing overwrites, matching the default DataGrid UX.
        try { el.select(); } catch (_) { /* ignore */ }
      }
    }
  }, [hasFocus]);

  const commitValue = React.useCallback(
    (raw) => {
      const parsed = parseNumericInput(raw);
      // Store the parsed number back; if unparseable but non-empty, keep the
      // raw string so validation can surface an "invalid" status.
      const next = parsed == null ? (raw === "" ? "" : raw) : parsed;
      apiRef.current.setEditCellValue({ id, field, value: next });
    },
    [apiRef, field, id],
  );

  const handleChange = (event) => {
    const next = event.target.value;
    setDraft(next);
    commitValue(next);
  };

  const handleBlur = () => {
    const parsed = parseNumericInput(draft);
    if (parsed != null) {
      setDraft(formatNumericDisplay(parsed));
    }
  };

  const handleKeyDown = (event) => {
    // ArrowUp / ArrowDown: commit current value and let DataGrid move focus.
    // We stop propagation of the native number-input increment by using a
    // text input here. Let the DataGrid's own key handler move focus below.
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      // Let the DataGrid handle row navigation by stopping edit mode first.
      // Calling stopCellEditMode here would swallow the key; instead rely on
      // the grid's onCellKeyDown to perform navigation. We only need to
      // make sure the browser's default number-increment doesn't fire — the
      // InputBase below uses type="text", so that's already safe.
    }
  };

  return (
    <InputBase
      inputRef={inputRef}
      value={draft}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      fullWidth
      sx={{
        px: 1,
        "& input": {
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        },
      }}
      inputProps={{
        // Using text (not number) so ArrowUp/Down don't increment the value.
        inputMode: "decimal",
        autoComplete: "off",
        spellCheck: false,
      }}
    />
  );
}

// Custom singleSelect edit cell that does not trap the mousewheel when the
// dropdown is closed. MUI's default Select edit cell in DataGrid uses a
// native-like select that can swallow wheel events; we use a controlled
// MUI Select with explicit handlers so page-scroll still works.
export function SingleSelectEditCell(props) {
  const { id, field, value, hasFocus, colDef } = props;
  const apiRef = useGridApiContext();
  const valueOptions =
    typeof colDef?.valueOptions === "function"
      ? colDef.valueOptions({ row: props.row }) || []
      : colDef?.valueOptions || [];
  const selectRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (hasFocus) {
      // Autofocus the underlying select button so keyboard works.
      try { selectRef.current?.focus(); } catch (_) { /* ignore */ }
    }
  }, [hasFocus]);

  const handleChange = (event) => {
    apiRef.current.setEditCellValue({ id, field, value: event.target.value });
  };

  return (
    <Select
      inputRef={selectRef}
      value={value ?? ""}
      onChange={handleChange}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      variant="standard"
      disableUnderline
      fullWidth
      sx={{ px: 1 }}
    >
      {valueOptions.map((option) => {
        const v = typeof option === "object" ? option.value : option;
        const label = typeof option === "object" ? option.label : option;
        return (
          <MenuItem key={String(v)} value={v}>
            {label}
          </MenuItem>
        );
      })}
    </Select>
  );
}

// Arrow-key + Tab/Enter navigation + clipboard paste handler for a grid.
//
// editableFields is the ordered list of column field names users can step
// through. canEditCell lets callers skip cells that are conditionally
// read-only (for example repeatable rows that redirect to a dialog).
export function makeGridKeyHandler({ getRows, editableFields, onPasteApply, show, canEditCell = () => true }) {
  function advancePosition(rowIndex, fieldIndex, direction) {
    let nextRowIndex = rowIndex;
    let nextFieldIndex = fieldIndex;
    switch (direction) {
      case "up":
        nextRowIndex -= 1;
        break;
      case "down":
        nextRowIndex += 1;
        break;
      case "left":
        if (fieldIndex === 0) {
          nextRowIndex -= 1;
          nextFieldIndex = editableFields.length - 1;
        } else {
          nextFieldIndex -= 1;
        }
        break;
      case "right":
        if (fieldIndex === editableFields.length - 1) {
          nextRowIndex += 1;
          nextFieldIndex = 0;
        } else {
          nextFieldIndex += 1;
        }
        break;
      default:
        break;
    }
    return { nextRowIndex, nextFieldIndex };
  }

  return (params, event) => {
    const key = String(event.key || "");

    // Clipboard paste support.
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "v") {
      event.preventDefault();
      event.defaultMuiPrevented = true;

      navigator.clipboard.readText().then((text) => {
        const parsed = parseTSV(text);
        if (!parsed.length) return;

        const gridRows = getRows();
        const rowIds = gridRows.map((row) => row.id);
        const startRowIndex = rowIds.indexOf(params.id);
        if (startRowIndex < 0) return;

        let startColumnIndex = editableFields.indexOf(params.field);
        if (startColumnIndex < 0) startColumnIndex = 0;

        const updates = [];
        for (let rowOffset = 0; rowOffset < parsed.length; rowOffset += 1) {
          const rowIndex = startRowIndex + rowOffset;
          if (rowIndex >= gridRows.length) break;
          const nextRow = { ...gridRows[rowIndex] };
          let changed = false;
          for (let columnOffset = 0; columnOffset < parsed[rowOffset].length; columnOffset += 1) {
            const columnIndex = startColumnIndex + columnOffset;
            if (columnIndex >= editableFields.length) break;
            const field = editableFields[columnIndex];
            if (!canEditCell(nextRow, field)) continue;
            const cellValue = parsed[rowOffset][columnOffset];
            if (cellValue === "") continue;
            nextRow[field] = cellValue;
            changed = true;
          }
          if (changed) updates.push(nextRow);
        }

        if (updates.length) {
          onPasteApply(updates);
          if (show) show(`Pasted ${updates.length} row(s).`, "success");
        }
      }).catch(() => {
        if (show) show("Could not read clipboard. Check browser permissions.", "warning");
      });
      return;
    }

    // Direction mapping for navigation keys.
    let direction = null;
    if (key === "Tab") direction = event.shiftKey ? "left" : "right";
    else if (key === "Enter") direction = event.shiftKey ? "up" : "down";
    else if (key === "ArrowUp") direction = "up";
    else if (key === "ArrowDown") direction = "down";

    if (!direction) return;

    // Only intercept ArrowUp/ArrowDown in edit mode — in view mode the grid's
    // built-in arrow navigation is already correct (it moves focus without
    // touching values).
    if ((key === "ArrowUp" || key === "ArrowDown") && params.cellMode !== "edit") {
      return;
    }

    const rowIds = getRows().map((row) => row.id);
    const rowIndex = rowIds.indexOf(params.id);
    const fieldIndex = editableFields.indexOf(params.field);
    if (rowIndex < 0 || fieldIndex < 0) return;

    let { nextRowIndex, nextFieldIndex } = advancePosition(rowIndex, fieldIndex, direction);

    let attempts = 0;
    const rows = getRows();
    while (rows[nextRowIndex] && editableFields[nextFieldIndex] && !canEditCell(rows[nextRowIndex], editableFields[nextFieldIndex])) {
      ({ nextRowIndex, nextFieldIndex } = advancePosition(nextRowIndex, nextFieldIndex, direction));
      attempts += 1;
      if (attempts > rows.length * Math.max(editableFields.length, 1)) return;
    }

    const nextRowId = rowIds[nextRowIndex];
    const nextField = editableFields[nextFieldIndex];
    if (nextRowId === undefined || !nextField) return;

    event.preventDefault();
    event.defaultMuiPrevented = true;

    if (params.cellMode === "edit") {
      // Commit current cell's edited value before moving focus.
      params.api.stopCellEditMode({ id: params.id, field: params.field });
    }
    params.api.setCellFocus(nextRowId, nextField);
    params.api.startCellEditMode({ id: nextRowId, field: nextField });
  };
}
