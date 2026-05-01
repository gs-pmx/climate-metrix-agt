import * as React from "react";
import {
  Box,
  Button,
  Collapse,
  Divider,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";

import { groupVersions } from "./versionGrouping";

// Phase F2 PR 6 — version-history timeline.
//
// Replaces the previous DataGrid-styled TableContainer with a grouped
// list per the design review's priority refactor #2:
//
//   * Latest   — most-recent version, always shown prominently.
//   * Manual   — deliberate checkpoints; bold weight + filled dot.
//   * Autosaves — post-calc autosaves; muted treatment, collapsed by default.
//
// Inventory year / GWP / trace are dropped from the row default — the
// metadata banner inside the project view already surfaces the active
// project's settings; per-row variation across saved versions is rare
// and was contributing to the "every row equally weighted" criticism.

function formatTimestamp(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString();
}

function VersionRow({ version, variant, onLoad, busy }) {
  // ``variant`` controls the visual emphasis. ``latest`` and ``manual``
  // share a filled forest-green dot; ``autosave`` uses a muted outlined
  // dot. The note text follows the same primary/secondary split.
  const isMuted = variant === "autosave";
  const dotColor = isMuted ? "transparent" : "secondary.main";
  const dotBorder = isMuted ? "1.5px solid" : "none";
  const dotBorderColor = isMuted ? "text.secondary" : "transparent";

  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{ py: 0.75 }}
    >
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          bgcolor: dotColor,
          border: dotBorder,
          borderColor: dotBorderColor,
          flexShrink: 0,
        }}
      />
      <Typography
        variant="body2"
        sx={{
          fontWeight: isMuted ? 400 : 500,
          color: isMuted ? "text.secondary" : "text.primary",
          minWidth: 36,
        }}
      >
        v{version.version_number}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ minWidth: 170, fontVariantNumeric: "tabular-nums" }}
      >
        {formatTimestamp(version.created_at)}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          flexGrow: 1,
          color: isMuted ? "text.secondary" : "text.primary",
          fontWeight: isMuted ? 400 : 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={version.note || ""}
      >
        {version.note || <em style={{ opacity: 0.6 }}>(no note)</em>}
      </Typography>
      <Button
        size="small"
        onClick={() => onLoad(version)}
        disabled={busy}
      >
        Load
      </Button>
    </Stack>
  );
}

function SectionHeader({ label, count }) {
  return (
    <Typography
      variant="caption"
      sx={{
        textTransform: "uppercase",
        letterSpacing: 0.6,
        color: "text.secondary",
        fontWeight: 600,
      }}
    >
      {label}
      {typeof count === "number" ? ` (${count})` : ""}
    </Typography>
  );
}

export default function VersionTimeline({
  versions,
  schemaInfo,
  onLoadVersion,
  busy = false,
}) {
  const { latest, manual, autosaves } = React.useMemo(
    () => groupVersions(versions),
    [versions],
  );
  const [showAutosaves, setShowAutosaves] = React.useState(false);

  return (
    <Stack spacing={1.5}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <Typography variant="h6">Version History</Typography>
        {schemaInfo ? (
          <Typography variant="caption" color="text.secondary">
            SQLite schema v{schemaInfo.current_version}
          </Typography>
        ) : null}
      </Stack>

      {!latest ? (
        <Typography color="text.secondary" variant="body2">
          No versions saved yet.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          <Box>
            <SectionHeader label="Latest" />
            <VersionRow
              version={latest}
              variant="latest"
              onLoad={onLoadVersion}
              busy={busy}
            />
          </Box>

          {manual.length > 0 ? (
            <>
              <Divider />
              <Box>
                <SectionHeader label="Manual checkpoints" count={manual.length} />
                <Stack divider={<Divider light />}>
                  {manual.map((v) => (
                    <VersionRow
                      key={v.version_id}
                      version={v}
                      variant="manual"
                      onLoad={onLoadVersion}
                      busy={busy}
                    />
                  ))}
                </Stack>
              </Box>
            </>
          ) : null}

          {autosaves.length > 0 ? (
            <>
              <Divider />
              <Box>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <IconButton
                    size="small"
                    onClick={() => setShowAutosaves((open) => !open)}
                    aria-label={showAutosaves ? "Collapse autosaves" : "Expand autosaves"}
                  >
                    {showAutosaves ? (
                      <KeyboardArrowDownIcon fontSize="small" />
                    ) : (
                      <KeyboardArrowRightIcon fontSize="small" />
                    )}
                  </IconButton>
                  <SectionHeader label="Autosaves" count={autosaves.length} />
                </Stack>
                <Collapse in={showAutosaves} unmountOnExit>
                  <Stack divider={<Divider light />} sx={{ pl: 4 }}>
                    {autosaves.map((v) => (
                      <VersionRow
                        key={v.version_id}
                        version={v}
                        variant="autosave"
                        onLoad={onLoadVersion}
                        busy={busy}
                      />
                    ))}
                  </Stack>
                </Collapse>
              </Box>
            </>
          ) : null}
        </Stack>
      )}
    </Stack>
  );
}
