import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import App from "./App";
import "./index.css";
import {
  brand,
  radius,
  shadows,
  surfaces,
  text,
  transitions,
} from "./theme/tokens.js";

// Phase F2 design pass — see plans/design-review-2026-04-30.md.
//
// The theme reads from ``./theme/tokens.js`` so palette / surfaces /
// shadows / typography land in one place. Headlines:
//
//   * No decorative gradient backgrounds (was: radial blue/green washes
//     on the body) — solid warm-off-white in light mode, GitHub-dark-
//     family near-black in dark.
//   * MuiPaper boxShadow drastically softened. Dark mode relies on
//     surface luminosity steps; shadow only carries weight in light.
//   * Paper border switched from primary-tinted to neutral divider.
//   * Typography: Assistant only (Public Sans removed), weight scale
//     restored (600 / 500 / 400 — was all-700).

function buildTheme(mode) {
  const isDark = mode === "dark";
  const palette = {
    mode,
    primary: isDark
      ? {
          main: brand.parametrixBlueDarkMode,
          light: brand.parametrixBlueDarkModeLight,
          dark: brand.parametrixBlueDarkModeDark,
          contrastText: "#07141d",
        }
      : {
          main: brand.parametrixBlue,
          light: brand.parametrixBlueLight,
          dark: brand.parametrixBlueDark,
          contrastText: "#ffffff",
        },
    secondary: isDark
      ? {
          main: brand.forestGreenDarkMode,
          light: brand.forestGreenDarkModeLight,
          dark: brand.forestGreenDarkModeDark,
          contrastText: "#07140d",
        }
      : {
          main: brand.forestGreen,
          light: brand.forestGreenLight,
          dark: brand.forestGreenDark,
          contrastText: "#ffffff",
        },
    background: {
      default: isDark ? surfaces.dark.surface : surfaces.light.surface,
      paper: isDark ? surfaces.dark.raised : surfaces.light.raised,
    },
    text: isDark ? text.dark : text.light,
    divider: isDark ? surfaces.dark.divider : surfaces.light.divider,
  };
  const modeShadows = isDark ? shadows.dark : shadows.light;
  const modeSurfaces = isDark ? surfaces.dark : surfaces.light;

  return createTheme({
    palette,
    shape: { borderRadius: radius.base },
    transitions: { duration: transitions.durations },
    typography: {
      // Assistant is the sole UI face. Loaded via Google Fonts in
      // index.css. System fallbacks keep things readable before the
      // web font lands.
      fontFamily:
        '"Assistant", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, sans-serif',
      // Hierarchy via weight + size, not color. Each step earns its
      // height instead of all-700 collapsing the scale.
      h1: { fontWeight: 600, fontSize: "2rem", lineHeight: 1.25 },
      h2: { fontWeight: 600, fontSize: "1.5rem", lineHeight: 1.3 },
      h3: { fontWeight: 600, fontSize: "1.25rem", lineHeight: 1.35 },
      h4: { fontWeight: 600, fontSize: "1.125rem", lineHeight: 1.4 },
      h5: { fontWeight: 500, fontSize: "1rem", lineHeight: 1.45 },
      h6: { fontWeight: 500, fontSize: "0.875rem", lineHeight: 1.5 },
      subtitle1: { fontWeight: 500, fontSize: "1rem", lineHeight: 1.5 },
      subtitle2: { fontWeight: 500, fontSize: "0.875rem", lineHeight: 1.5 },
      body1: { fontWeight: 400, fontSize: "0.9375rem", lineHeight: 1.55 },
      body2: { fontWeight: 400, fontSize: "0.875rem", lineHeight: 1.55 },
      button: { fontWeight: 500, textTransform: "none", letterSpacing: 0 },
      overline: { fontWeight: 500, letterSpacing: "0.06em" },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ":root": {
            // Sticky-stack heights (used by ActivityInputsPanel + the
            // By-Activity TOC sidebar to align with the app top bar).
            "--sticky-top-height": "64px",
            "--sticky-secondary-height": "112px",
          },
          body: {
            minHeight: "100vh",
            // F2: solid surface color. The pre-F2 radial gradients
            // washed every panel in a soft tint and conflicted with
            // the locked "no decorative color" direction. Solid
            // background lets data-bearing surfaces sit at full
            // contrast.
            background: palette.background.default,
          },
          ".sticky-top-shell": {
            position: "sticky",
            top: 0,
            zIndex: 20,
          },
        },
      },
      MuiPaper: {
        defaultProps: {
          // Raised by default with a single, restrained shadow. Variant
          // "outlined" continues to render border-only (no shadow).
          elevation: 0,
        },
        styleOverrides: {
          root: {
            border: `1px solid ${modeSurfaces.border}`,
            boxShadow: modeShadows.none,
            backgroundImage: "none",
          },
          // ``elevation`` >= 1 gets the restrained raised shadow. The
          // numeric variant index isn't a meaningful design dial in our
          // app — anything from 1-24 collapses to "raised" visually.
          elevation1: { boxShadow: modeShadows.raised },
          elevation2: { boxShadow: modeShadows.raised },
          elevation3: { boxShadow: modeShadows.raised },
          elevation4: { boxShadow: modeShadows.raised },
          elevation5: { boxShadow: modeShadows.raised },
        },
      },
      MuiAccordion: {
        styleOverrides: {
          root: {
            // Clip child content so an expanded table shares the rounded
            // corner with the accordion shell.
            overflow: "hidden",
          },
        },
      },
      MuiButtonBase: {
        // Disable MUI's ripple — combined with the compressed transition
        // durations above, this makes click feedback feel instantaneous.
        defaultProps: { disableRipple: true },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            transition:
              "background-color 80ms ease, box-shadow 80ms ease, border-color 80ms ease, color 80ms ease",
          },
        },
      },
      MuiDialog: {
        defaultProps: { transitionDuration: { enter: 100, exit: 90 } },
        styleOverrides: {
          paper: { boxShadow: modeShadows.overlay },
        },
      },
      MuiDataGrid: {
        styleOverrides: {
          root: ({ theme }) => ({
            // F1.x DataGrid header treatment kept — sticky opaque header
            // bar with a 2px primary-color underline reads as a clear
            // column boundary and survives F2's surface flattening.
            "& .MuiDataGrid-columnHeaders": {
              backgroundColor: theme.palette.background.paper,
              borderBottom: `2px solid ${
                theme.palette.mode === "dark"
                  ? "rgba(121, 186, 224, 0.35)"
                  : "rgba(0, 78, 130, 0.25)"
              }`,
              position: "sticky",
              top: 0,
              zIndex: 3,
            },
            "& .MuiDataGrid-columnHeader": {
              backgroundColor:
                theme.palette.mode === "dark"
                  ? "rgba(78, 159, 207, 0.08)"
                  : "rgba(0, 78, 130, 0.05)",
              borderRight: `1px solid ${theme.palette.divider}`,
            },
            "& .MuiDataGrid-columnHeader:last-of-type": {
              borderRight: "none",
            },
            "& .MuiDataGrid-columnHeaderTitle": {
              fontWeight: 600,
            },
            "& .MuiDataGrid-cell": {
              borderRight: `1px solid ${theme.palette.divider}`,
            },
            "& .MuiDataGrid-cell:last-of-type": {
              borderRight: "none",
            },
          }),
        },
      },
    },
  });
}

function Root() {
  const [mode, setMode] = React.useState("light");
  const theme = React.useMemo(() => buildTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App
        colorMode={mode}
        onToggleColorMode={() => setMode((m) => (m === "light" ? "dark" : "light"))}
      />
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
