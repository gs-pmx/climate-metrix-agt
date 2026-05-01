import * as React from "react";
import {
  Alert,
  Button,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import AutosaveStatusChip from "./AutosaveStatusChip";

// Phase F2 PR 6 — compressed Project Setup form.
//
// Rebuild of the inline App.jsx blob per the design review priority
// refactor #2. Three compact rows replace the previous tall stack:
//
//   1. Create — name + year + "Create Project".
//   2. Active project — selector + version-note + Save Snapshot +
//      autosave chip + Load Latest.
//   3. Rename / delete — rename field + Rename + Delete buttons.
//
// All state lives in App.jsx; this component is purely presentational.

export default function ProjectSetupForm({
  // Create row
  projectNameDraft,
  onProjectNameDraftChange,
  inventoryYear,
  onInventoryYearChange,
  onCreateProject,
  // Active project row
  projects,
  activeProjectId,
  onSelectProject,
  hasActiveProject,
  versionNote,
  onVersionNoteChange,
  onSaveSnapshot,
  autosaveStatus,
  autosaveLastSavedAt,
  onLoadLatest,
  // Rename / delete row
  projectRenameDraft,
  onProjectRenameDraftChange,
  onRenameActiveProject,
  onDeleteActiveProject,
  // Shared
  projectBusy,
  projectError,
}) {
  return (
    <Stack spacing={1.5}>
      <Typography variant="h6">Project Setup</Typography>

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.25}
        alignItems={{ md: "center" }}
      >
        <TextField
          label="Project Name"
          placeholder="2026 Corporate Inventory"
          value={projectNameDraft}
          onChange={(event) => onProjectNameDraftChange(event.target.value)}
          size="small"
          sx={{ minWidth: 280, flexGrow: 1 }}
        />
        <TextField
          label="Inventory Year"
          value={inventoryYear}
          onChange={(event) => onInventoryYearChange(event.target.value)}
          size="small"
          sx={{ width: 160 }}
        />
        <Button
          variant="contained"
          onClick={onCreateProject}
          disabled={projectBusy}
        >
          Create Project
        </Button>
      </Stack>

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.25}
        alignItems={{ md: "center" }}
      >
        <Select
          displayEmpty
          value={activeProjectId}
          onChange={(event) => onSelectProject(event.target.value)}
          size="small"
          sx={{ minWidth: 280 }}
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
          onChange={(event) => onVersionNoteChange(event.target.value)}
          size="small"
          sx={{ minWidth: 260, flexGrow: 1 }}
        />
        <Button
          variant="outlined"
          disabled={!hasActiveProject || projectBusy}
          onClick={onSaveSnapshot}
        >
          Save Snapshot
        </Button>
        {hasActiveProject ? (
          <AutosaveStatusChip status={autosaveStatus} lastSavedAt={autosaveLastSavedAt} />
        ) : null}
        <Button
          variant="outlined"
          disabled={!hasActiveProject || projectBusy}
          onClick={onLoadLatest}
        >
          Load Latest
        </Button>
      </Stack>

      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.25}
        alignItems={{ md: "center" }}
      >
        <TextField
          label="Rename Active Project"
          value={projectRenameDraft}
          onChange={(event) => onProjectRenameDraftChange(event.target.value)}
          size="small"
          sx={{ minWidth: 280, flexGrow: 1 }}
          disabled={!hasActiveProject}
        />
        <Button
          variant="outlined"
          disabled={!hasActiveProject || projectBusy}
          onClick={onRenameActiveProject}
        >
          Rename
        </Button>
        <Button
          variant="outlined"
          color="error"
          disabled={!hasActiveProject || projectBusy}
          onClick={onDeleteActiveProject}
        >
          Delete Project
        </Button>
      </Stack>

      {projectError ? <Alert severity="error">{projectError}</Alert> : null}
    </Stack>
  );
}
