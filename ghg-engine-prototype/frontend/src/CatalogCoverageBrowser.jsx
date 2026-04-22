import * as React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

export default function CatalogCoverageBrowser({ activityCatalog }) {
  const grouped = React.useMemo(() => {
    const groups = {};
    for (const activityType of activityCatalog) {
      const group = activityType.ui_metadata?.group || "Other";
      if (!groups[group]) groups[group] = [];
      groups[group].push(activityType);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [activityCatalog]);

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        Catalog Coverage
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Planned and deferred activities are visible here for coverage review but are not available for calculation yet.
      </Typography>
      <Stack spacing={1}>
        {grouped.map(([group, rows]) => (
          <Accordion key={group} disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ width: "100%" }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {group}
                </Typography>
                <Chip label={`${rows.length} activities`} size="small" variant="outlined" />
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1}>
                {rows.map((activityType) => (
                  <Box
                    key={activityType.activity_type_id}
                    sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 1.25 }}
                  >
                    <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
                      <Typography variant="subtitle2">{activityType.label}</Typography>
                      <Chip label={activityType.scope} size="small" variant="outlined" />
                      <Chip label={activityType.implementation_status} size="small" color={
                        activityType.implementation_status === "implemented"
                          ? "success"
                          : activityType.implementation_status === "partial"
                            ? "warning"
                            : "default"
                      } />
                      <Chip label={activityType.method_id} size="small" variant="outlined" />
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                      {activityType.description}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
                      Primary units: {(activityType.allowed_units || []).join(", ") || activityType.default_unit}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                      Fields: {(activityType.input_schema?.fields || []).map((field) => field.label).join(", ")}
                    </Typography>
                    {activityType.accounting_metadata?.partial_reason ? (
                      <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 0.5 }}>
                        Partial support: {activityType.accounting_metadata.partial_reason}
                      </Typography>
                    ) : null}
                  </Box>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
      </Stack>
    </Paper>
  );
}
