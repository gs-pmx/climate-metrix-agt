import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  FormControlLabel,
} from "@mui/material";
import {
  EMPTY_ACTIVITY,
  getActivitySupportNotice,
  getAllowedUnits,
  getCompletionState,
  getDetailFields,
  getFieldUnits,
  hasMeaningfulParamValue,
  getPrimaryField,
  uid,
  withActivityTypeDefaults,
} from "./activityDrafts";

function hasMeaningfulData(draft) {
  if (draft?.activity?.value !== "" && draft?.activity?.value != null) return true;
  return Object.values(draft?.params || {}).some((value) => hasMeaningfulParamValue(value));
}

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

export default function RepeatableActivityDialog({
  open,
  activityType,
  facilityId,
  facilityName,
  drafts,
  onClose,
  onSave,
}) {
  const [localDrafts, setLocalDrafts] = React.useState([]);

  React.useEffect(() => {
    if (!activityType) {
      setLocalDrafts([]);
      return;
    }
    const nextDrafts = (drafts?.length ? drafts : [
      withActivityTypeDefaults(
        {
          ...EMPTY_ACTIVITY,
          id: uid(),
          facility_id: facilityId || "",
          activity_type_id: activityType.activity_type_id,
          params: {},
        },
        activityType,
      ),
    ]).map((draft) => withActivityTypeDefaults({ ...draft, params: { ...(draft.params || {}) } }, activityType));
    setLocalDrafts(nextDrafts);
  }, [activityType, drafts, facilityId]);

  if (!activityType) return null;

  const unitOptions = getAllowedUnits(activityType);
  const detailFields = getDetailFields(activityType);
  const primaryField = getPrimaryField(activityType);
  const supportNotice = getActivitySupportNotice(activityType);

  const updateDraft = (draftId, updater) => {
    setLocalDrafts((prev) => prev.map((draft) => (draft.id === draftId ? updater(draft) : draft)));
  };

  const addEntry = () => {
    setLocalDrafts((prev) => [
      ...prev,
      withActivityTypeDefaults(
        {
          ...EMPTY_ACTIVITY,
          id: uid(),
          facility_id: facilityId || "",
          activity_type_id: activityType.activity_type_id,
          params: {},
        },
        activityType,
      ),
    ]);
  };

  const removeEntry = (draftId) => {
    setLocalDrafts((prev) => prev.filter((draft) => draft.id !== draftId));
  };

  const saveEntries = () => {
    const cleaned = localDrafts
      .filter((draft) => hasMeaningfulData(draft))
      .map((draft) => withActivityTypeDefaults(draft, activityType));
    onSave(cleaned);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Stack spacing={0.5}>
          <Typography variant="h6">{activityType.label}</Typography>
          <Typography variant="body2" color="text.secondary">
            {facilityName ? `${facilityName}` : "Repeatable entries"}
          </Typography>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
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
          {localDrafts.map((draft, index) => {
            const completion = getCompletionState(draft, activityType);
            return (
              <Box
                key={draft.id}
                sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}
              >
                <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }} sx={{ mb: 1.5 }}>
                  <Typography variant="subtitle2">Entry {index + 1}</Typography>
                  <Chip label={completion.label} color={completion.color} size="small" variant="outlined" />
                  <Box sx={{ flexGrow: 1 }} />
                  <Button color="error" size="small" onClick={() => removeEntry(draft.id)}>
                    Remove
                  </Button>
                </Stack>
                <Stack spacing={1.5}>
                  <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                    <TextField
                      label={primaryField?.label || "Activity Value"}
                      type="number"
                      value={draft.activity.value}
                      onChange={(event) => updateDraft(draft.id, (current) => ({
                        ...current,
                        activity: { ...current.activity, value: event.target.value },
                      }))}
                      fullWidth
                    />
                    <Select
                      value={draft.activity.unit || unitOptions[0] || ""}
                      onChange={(event) => updateDraft(draft.id, (current) => ({
                        ...current,
                        activity: { ...current.activity, unit: event.target.value },
                      }))}
                      sx={{ minWidth: 180 }}
                    >
                      {unitOptions.map((unit) => (
                        <MenuItem key={unit} value={unit}>
                          {unit}
                        </MenuItem>
                      ))}
                    </Select>
                  </Stack>
                  {detailFields.map((field) => {
                    const key = field.param_key || field.field_id;
                    const value = draft.params?.[key] ?? "";
                    if (field.kind === "quantity") {
                      const quantityValue = normalizeQuantityParam(field, value);
                      const unitOptions = getFieldUnits(field);
                      return (
                        <Box key={key}>
                          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                            {field.label}
                          </Typography>
                          <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
                            <TextField
                              type="number"
                              value={quantityValue.value}
                              onChange={(event) => updateDraft(draft.id, (current) => ({
                                ...current,
                                params: {
                                  ...current.params,
                                  [key]: normalizeFieldValue(field, {
                                    ...quantityValue,
                                    value: event.target.value,
                                  }),
                                },
                              }))}
                              fullWidth
                            />
                            <Select
                              value={quantityValue.unit}
                              onChange={(event) => updateDraft(draft.id, (current) => ({
                                ...current,
                                params: {
                                  ...current.params,
                                  [key]: normalizeFieldValue(field, {
                                    ...quantityValue,
                                    unit: event.target.value,
                                  }),
                                },
                              }))}
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
                            onChange={(event) => updateDraft(draft.id, (current) => ({
                              ...current,
                              params: { ...current.params, [key]: normalizeFieldValue(field, event.target.value) },
                            }))}
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
                              onChange={(event) => updateDraft(draft.id, (current) => ({
                                ...current,
                                params: { ...current.params, [key]: normalizeFieldValue(field, event.target.checked) },
                              }))}
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
                        type={field.kind === "number" ? "number" : "text"}
                        value={value}
                        onChange={(event) => updateDraft(draft.id, (current) => ({
                          ...current,
                          params: { ...current.params, [key]: normalizeFieldValue(field, event.target.value) },
                        }))}
                        helperText={field.help_text || " "}
                        fullWidth
                      />
                    );
                  })}
                </Stack>
                {completion.errors?.length ? (
                  <>
                    <Divider sx={{ my: 1.5 }} />
                    <Alert severity="warning">
                      {completion.errors.join(", ")}
                    </Alert>
                  </>
                ) : null}
              </Box>
            );
          })}
          <Button variant="outlined" onClick={addEntry}>
            Add Entry
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={saveEntries}>
          Save Entries
        </Button>
      </DialogActions>
    </Dialog>
  );
}
