import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import {
  getActivitySupportNotice,
  getDetailFields,
  getFieldUnits,
} from "./activityDrafts";
import { classifyRow, ROW_STATUS } from "./rowStatus";
import { formatNumericDisplay, parseNumericInput } from "./numericFormat";

function normalizeFieldValue(field, rawValue) {
  if (field.kind === "number") return rawValue;
  if (field.kind === "boolean") return Boolean(rawValue);
  return rawValue;
}

function normalizeQuantityParam(field, rawValue) {
  const unitOptions = getFieldUnits(field);
  return {
    value: rawValue?.value ?? "",
    unit: rawValue?.unit || unitOptions[0] || "",
  };
}

// Numeric text field that accepts thousands separators and formats on blur.
// Matches the behavior of the grid's NumericEditCell so UX is consistent
// between inline grid editing and the detail dialog.
function NumericField({ value, onChange, ...rest }) {
  const [draft, setDraft] = React.useState(() => {
    if (value === "" || value == null) return "";
    const parsed = parseNumericInput(value);
    return parsed == null ? String(value) : formatNumericDisplay(parsed);
  });

  React.useEffect(() => {
    const parsed = parseNumericInput(value);
    const currentParsed = parseNumericInput(draft);
    if (parsed !== currentParsed) {
      setDraft(value === "" || value == null ? "" : (parsed == null ? String(value) : formatNumericDisplay(parsed)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <TextField
      {...rest}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        onChange(next);
      }}
      onBlur={() => {
        const parsed = parseNumericInput(draft);
        if (parsed != null) {
          const formatted = formatNumericDisplay(parsed);
          setDraft(formatted);
          onChange(formatted);
        }
      }}
      inputProps={{ inputMode: "decimal", autoComplete: "off", spellCheck: false, ...(rest.inputProps || {}) }}
    />
  );
}

export default function ActivityDetailDialog({
  open,
  activityType,
  draft,
  onClose,
  onSave,
}) {
  const [params, setParams] = React.useState({});

  // Reset edit state whenever the dialog opens with a fresh draft. We also
  // reset when the dialog transitions to closed so re-opening the same
  // draft after a cancel starts from the saved state, not stale edits.
  React.useEffect(() => {
    if (open && draft) {
      setParams(draft.params || {});
    } else if (!open) {
      setParams({});
    }
  }, [open, draft]);

  // Keep rendering the Dialog shell so MUI can animate out. We only suppress
  // the body when we have no data to render yet — this prevents the
  // "second click needed to dismiss" bug when draft becomes null mid-render.
  const renderBody = Boolean(activityType && draft);
  const detailFields = renderBody ? getDetailFields(activityType) : [];
  const classification = renderBody
    ? classifyRow({ ...draft, params }, activityType)
    : { status: ROW_STATUS.NOT_STARTED, fieldErrors: {}, missingRequired: [] };
  const supportNotice = renderBody ? getActivitySupportNotice(activityType) : null;

  const setFieldValue = (field, nextValue) => {
    const key = field.param_key || field.field_id;
    setParams((prev) => ({ ...prev, [key]: normalizeFieldValue(field, nextValue) }));
  };

  const handleSave = () => {
    // Guard against empty dialog data (shouldn't happen in practice).
    if (!renderBody) {
      onClose();
      return;
    }
    onSave(params);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{renderBody ? activityType.label : ""}</DialogTitle>
      <DialogContent dividers>
        {renderBody ? (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {activityType.description}
            </Typography>
            {supportNotice ? (
              <Alert severity={supportNotice.severity}>
                {supportNotice.message}
              </Alert>
            ) : null}
            {(activityType.input_schema?.notes || []).map((note) => (
              <Alert key={note} severity="info">
                {note}
              </Alert>
            ))}
            {detailFields.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No secondary details are required for this activity.
              </Typography>
            ) : null}
            {detailFields.map((field) => {
              const key = field.param_key || field.field_id;
              const value = params[key] ?? "";
              if (field.kind === "quantity") {
                const quantityValue = normalizeQuantityParam(field, value);
                const unitOptions = getFieldUnits(field);
                return (
                  <Box key={key}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                      {field.label}
                    </Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                      <NumericField
                        value={quantityValue.value}
                        onChange={(next) => setFieldValue(field, {
                          ...quantityValue,
                          value: next,
                        })}
                        fullWidth
                      />
                      <Select
                        value={quantityValue.unit}
                        onChange={(event) => setFieldValue(field, {
                          ...quantityValue,
                          unit: event.target.value,
                        })}
                        sx={{ minWidth: 180 }}
                      >
                        {unitOptions.map((option) => (
                          <MenuItem key={option} value={option}>
                            {option}
                          </MenuItem>
                        ))}
                      </Select>
                    </Stack>
                    {field.help_text ? (
                      <Typography variant="caption" color="text.secondary">
                        {field.help_text}
                      </Typography>
                    ) : null}
                  </Box>
                );
              }
              if (field.kind === "enum") {
                return (
                  <Box key={key}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                      {field.label}
                    </Typography>
                    <Select
                      fullWidth
                      value={value}
                      onChange={(event) => setFieldValue(field, event.target.value)}
                    >
                      {!field.required ? <MenuItem value="">None</MenuItem> : null}
                      {field.options.map((option) => (
                        <MenuItem key={option} value={option}>
                          {option}
                        </MenuItem>
                      ))}
                    </Select>
                    {field.help_text ? (
                      <Typography variant="caption" color="text.secondary">
                        {field.help_text}
                      </Typography>
                    ) : null}
                  </Box>
                );
              }
              if (field.kind === "boolean") {
                return (
                  <FormControlLabel
                    key={key}
                    control={(
                      <Switch
                        checked={Boolean(value)}
                        onChange={(event) => setFieldValue(field, event.target.checked)}
                      />
                    )}
                    label={field.label}
                  />
                );
              }
              if (field.kind === "number") {
                return (
                  <NumericField
                    key={key}
                    label={field.label}
                    value={value}
                    onChange={(next) => setFieldValue(field, next)}
                    helperText={field.help_text || " "}
                    fullWidth
                  />
                );
              }
              return (
                <TextField
                  key={key}
                  label={field.label}
                  value={value}
                  onChange={(event) => setFieldValue(field, event.target.value)}
                  helperText={field.help_text || " "}
                  fullWidth
                />
              );
            })}
            {classification.status === ROW_STATUS.INVALID ? (
              <Alert severity="error">
                {Object.entries(classification.fieldErrors).map(([k, v]) => `${k}: ${v}`).join(" | ")}
              </Alert>
            ) : null}
            {classification.status === ROW_STATUS.MISSING_DETAILS && classification.missingRequired.length ? (
              <Alert severity="warning">
                Missing: {classification.missingRequired.join(", ")}
              </Alert>
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          Save Details
        </Button>
      </DialogActions>
    </Dialog>
  );
}
