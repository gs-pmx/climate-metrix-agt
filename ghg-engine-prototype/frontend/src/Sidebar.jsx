import * as React from "react";
import {
  Badge,
  Box,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import LibraryBooksOutlinedIcon from "@mui/icons-material/LibraryBooksOutlined";
import NotificationsNoneOutlinedIcon from "@mui/icons-material/NotificationsNoneOutlined";
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";

// Phase F1 — vertical-rail sidebar.
//
// Always-visible icon rail at ~56px wide, floor-to-ceiling. Items
// switch the main view ('project' / 'projects' / 'catalog') or pop
// a panel (notifications, future). Hovering an icon reveals its
// label tooltip; clicking selects.
//
// Item contract: ``view`` (mode-switcher) items set the parent's
// ``activeView`` and own the main content area. ``panel`` items are
// not yet implemented in F1 — the notifications icon is wired up as
// a stub for the F1.2 info-bubble migration.
//
// The rail can also be expanded to show inline labels for users who
// want full text without entering a mode (the small chevron at the
// bottom toggles). Expanded state is local to the sidebar; it does
// not change the parent's view selection.

const RAIL_WIDTH = 44;
const RAIL_EXPANDED_WIDTH = 200;

const VIEW_ITEMS = [
  {
    id: "project",
    label: "Active project",
    icon: null, // Project mode is the default; no rail icon — the top
                // bar's project label is the affordance for "you're
                // looking at the project". Returning to project mode
                // happens by clicking that label or by clicking a
                // currently-active sidebar item again.
    hidden: true,
  },
  {
    id: "projects",
    label: "Projects",
    icon: FolderOutlinedIcon,
  },
  {
    id: "catalog",
    label: "Catalog",
    icon: LibraryBooksOutlinedIcon,
  },
];

export default function Sidebar({
  activeView = "project",
  onSelectView = () => {},
  notificationCount = 0,
  onOpenNotifications = null,
}) {
  const [expanded, setExpanded] = React.useState(false);
  const width = expanded ? RAIL_EXPANDED_WIDTH : RAIL_WIDTH;

  return (
    <Box
      role="navigation"
      aria-label="Primary"
      sx={{
        width,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        position: "sticky",
        top: 0,
        height: "100vh",
        transition: "width 160ms ease",
      }}
    >
      <Stack
        spacing={0.25}
        sx={{ pt: 1, px: expanded ? 0.75 : 0.5, alignItems: "stretch" }}
      >
        {VIEW_ITEMS.filter((item) => !item.hidden).map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <SidebarItem
              key={item.id}
              expanded={expanded}
              active={isActive}
              icon={<Icon fontSize="small" />}
              label={item.label}
              onClick={() => onSelectView(item.id)}
            />
          );
        })}
      </Stack>

      <Box sx={{ flexGrow: 1 }} />

      <Stack spacing={0.25} sx={{ pb: 1, px: expanded ? 0.75 : 0.5 }}>
        <SidebarItem
          expanded={expanded}
          active={false}
          icon={
            <Badge
              color="primary"
              badgeContent={notificationCount}
              invisible={!notificationCount}
              overlap="circular"
            >
              <NotificationsNoneOutlinedIcon fontSize="small" />
            </Badge>
          }
          label="Notifications"
          onClick={() => {
            if (onOpenNotifications) onOpenNotifications();
          }}
          // F1 stub — wired in the F1.2 info-bubble migration. Disabled
          // until then so the user doesn't see an empty panel.
          disabled={!onOpenNotifications}
        />
        <Divider sx={{ my: 0.25 }} />
        <Tooltip
          title={expanded ? "Collapse navigation" : "Expand navigation"}
          placement="right"
        >
          <IconButton
            size="small"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "collapse navigation" : "expand navigation"}
            sx={{
              alignSelf: expanded ? "flex-end" : "center",
              transform: expanded ? "rotate(0deg)" : "rotate(180deg)",
              transition: "transform 160ms ease",
              p: 0.5,
            }}
          >
            <KeyboardArrowLeftIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

function SidebarItem({ expanded, active, icon, label, onClick, disabled }) {
  const content = (
    <Box
      onClick={disabled ? undefined : onClick}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: expanded ? 1 : 0,
        py: 0.75,
        borderRadius: 1,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        bgcolor: active ? "action.selected" : "transparent",
        color: active ? "primary.main" : "text.secondary",
        justifyContent: expanded ? "flex-start" : "center",
        "&:hover": disabled
          ? undefined
          : {
              bgcolor: active ? "action.selected" : "action.hover",
              color: active ? "primary.main" : "text.primary",
            },
        "&:focus-visible": {
          outline: 2,
          outlineColor: "primary.main",
          outlineOffset: 1,
        },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24 }}>
        {icon}
      </Box>
      {expanded ? (
        <Typography variant="body2" sx={{ fontWeight: active ? 500 : 400 }}>
          {label}
        </Typography>
      ) : null}
    </Box>
  );

  if (expanded) return content;
  return (
    <Tooltip title={label} placement="right">
      {content}
    </Tooltip>
  );
}
