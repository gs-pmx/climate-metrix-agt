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
import { getCompletionState, getDetailFields, getPartialReason } from "./activityDrafts";

function normalizeFieldValue(field, rawValue) {
  if (field.kind === "number") return rawValue;
  if (field.kind === "boolean") return Boolean(rawValue);
  return rawValue;
}

export default function ActivityDetailDialog({
  open,
  activityType,
  draft,
  onClose,
  onSave,
}) {
  const [params, setParams] = React.useState({});

  React.useEffect(() => {
    setParams(draft?.params || {});
  }, [draft]);

  if (!activityType || !draft) return null;

  const detailFields = getDetailFields(activityType);
  const completion = getCompletionState({ ...draft, params }, activityType);
  const partialReason = getPartialReason(activityType);

  const setFieldValue = (field, nextValue) => {
    const key = field.param_key || field.field_id;
    setParams((prev) => ({ ...prev, [key]: normalizeFieldValue(field, nextValue) }));
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{activityType.label}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {activityType.description}
          </Typography>
          {activityType.implementation_status === "partial" ? (
            <Alert severity="warning">
              {partialReason || "This activity is usable, but catalog metadata marks it as partial support. Review the notes below before finalizing."}
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
            return (
              <TextField
                key={key}
                label={field.label}
                value={value}
                type={field.kind === "number" ? "number" : "text"}
                onChange={(event) => setFieldValue(field, event.target.value)}
                helperText={field.help_text || " "}
                fullWidth
              />
            );
          })}
          {completion.errors?.length ? (
            <Alert severity="warning">
              {completion.errors.join(", ")}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onSave(params)}>
          Save Details
        </Button>
      </DialogActions>
    </Dialog>
  );
}
