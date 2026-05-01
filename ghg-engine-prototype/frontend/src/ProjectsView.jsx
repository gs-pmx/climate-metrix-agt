import * as React from "react";
import { Paper, Stack } from "@mui/material";

import ProjectSetupForm from "./ProjectSetupForm";
import VersionTimeline from "./VersionTimeline";

// Phase F2 PR 6 — Projects view container.
//
// Replaces the inline ``view === 'projects'`` blob in App.jsx. Owns no
// state; just composes the setup form + version timeline and forwards
// every prop through. Keeping the orchestrator thin makes future view
// adjustments (the deferred marketing-screen redesign with hero / cover
// image) a smaller surface to touch.

export default function ProjectsView(props) {
  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2 }}>
        <ProjectSetupForm
          projectNameDraft={props.projectNameDraft}
          onProjectNameDraftChange={props.onProjectNameDraftChange}
          inventoryYear={props.inventoryYear}
          onInventoryYearChange={props.onInventoryYearChange}
          onCreateProject={props.onCreateProject}
          projects={props.projects}
          activeProjectId={props.activeProjectId}
          onSelectProject={props.onSelectProject}
          hasActiveProject={props.hasActiveProject}
          versionNote={props.versionNote}
          onVersionNoteChange={props.onVersionNoteChange}
          onSaveSnapshot={props.onSaveSnapshot}
          autosaveStatus={props.autosaveStatus}
          autosaveLastSavedAt={props.autosaveLastSavedAt}
          onLoadLatest={props.onLoadLatest}
          projectRenameDraft={props.projectRenameDraft}
          onProjectRenameDraftChange={props.onProjectRenameDraftChange}
          onRenameActiveProject={props.onRenameActiveProject}
          onDeleteActiveProject={props.onDeleteActiveProject}
          projectBusy={props.projectBusy}
          projectError={props.projectError}
        />
      </Paper>

      <Paper sx={{ p: 2 }}>
        <VersionTimeline
          versions={props.projectVersions}
          schemaInfo={props.schemaInfo}
          onLoadVersion={props.onLoadVersion}
          busy={props.projectBusy}
        />
      </Paper>
    </Stack>
  );
}
