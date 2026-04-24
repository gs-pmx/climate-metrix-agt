import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import App from "./App";
import "./index.css";

function buildTheme(mode) {
  const lightPalette = {
    mode: "light",
    primary: { main: "#004e82", light: "#2b6f9d", dark: "#003860", contrastText: "#ffffff" },
    secondary: { main: "#19742c", light: "#3e8e4e", dark: "#0f5520", contrastText: "#ffffff" },
    background: { default: "#f1f3f4", paper: "#ffffff" },
    text: { primary: "#122531", secondary: "#345063" },
  };

  const darkPalette = {
    mode: "dark",
    primary: { main: "#4e9fcf", light: "#79bae0", dark: "#2f7ea9", contrastText: "#07141d" },
    secondary: { main: "#84b26d", light: "#a7c68f", dark: "#648a50", contrastText: "#07140d" },
    background: { default: "#1f2831", paper: "#273542" },
    text: { primary: "#deebf4", secondary: "#b7cad7" },
  };

  // Phase C4 tightens the global corner radius another increment (from 10
  // to 7). The previous 10px value still felt rounded-pillow on dense
  // MUI surfaces (Paper cards, Dialog shells, the chip library in
  // Configure Sources). 7px keeps enough softness to avoid pure sharp
  // edges while visually sharpening the overall data-entry UI. The
  // change cascades through every Paper / Dialog / Chip / Alert / Button
  // / table shell via MUI's `theme.shape.borderRadius` token.
  return createTheme({
    palette: mode === "dark" ? darkPalette : lightPalette,
    shape: { borderRadius: 7 },
    // Post-C4 round-3 item 1: shrink global MUI transition durations so
    // clicks feel instantaneous.
    //
    // Prior polish had already disabled the Button ripple (~550ms), but
    // clicks still felt laggy. Root cause: MUI's default theme ships
    // with `transitions.duration` values that are honored by Button's
    // built-in background/box-shadow/color transitions on hover/active
    // AND by Dialog mount/unmount animations:
    //   - shortest: 150ms (tooltip/hover)
    //   - shorter:  200ms (button background, select)
    //   - short:    250ms (button/chip background)
    //   - standard: 300ms (default)
    //   - complex:  375ms
    //   - enteringScreen: 225ms (Dialog open)
    //   - leavingScreen:  195ms (Dialog close)
    //
    // On a click, the button background darkens over 250ms and a dialog
    // (if that's the action) fades in over 225ms — stacked, that's
    // ~475ms of "the app is still thinking" visual feedback before the
    // user sees the result. Combined with any synchronous state work,
    // it reads as ~half a second of lag even though the handler fired
    // immediately.
    //
    // Compressing everything to <=100ms keeps animations perceptible
    // enough to feel polished (pure 0ms is jarring) while making them
    // finish within a single animation frame-ish window. Dialogs in
    // particular appear almost-instantly, which is what the user
    // expects from a clicked button.
    transitions: {
      duration: {
        shortest: 80,
        shorter: 100,
        short: 100,
        standard: 120,
        complex: 150,
        enteringScreen: 100,
        leavingScreen: 90,
      },
    },
    typography: {
      fontFamily: '"Assistant", "Public Sans", "IBM Plex Sans", "Segoe UI", sans-serif',
      h1: { fontFamily: '"Public Sans", "Assistant", sans-serif', fontWeight: 700 },
      h2: { fontFamily: '"Public Sans", "Assistant", sans-serif', fontWeight: 700 },
      h3: { fontFamily: '"Public Sans", "Assistant", sans-serif', fontWeight: 700 },
      h4: { fontFamily: '"Public Sans", "Assistant", sans-serif', fontWeight: 700 },
      h5: { fontFamily: '"Public Sans", "Assistant", sans-serif', fontWeight: 700 },
      h6: { fontFamily: '"Public Sans", "Assistant", sans-serif', fontWeight: 700 },
      button: { fontWeight: 700, textTransform: "none", letterSpacing: 0.2 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          // Post-C4 sticky-stack CSS variables. Three layers stack from
          // top to bottom inside the scroll container:
          //   Layer 1: app nav bar (compact tabs bar)            -> --sticky-top-height
          //   Layer 2: view-selector + save/run action bar       -> --sticky-secondary-height
          //   Layer 3: By Activity TOC sidebar (see sidebar sx)
          // Post-C4 polish item 1 collapsed the app nav from a full
          // header + tabs (~176px) down to just the tabs row (~64px);
          // the full header now scrolls away naturally and only the
          // tabs remain sticky. Tuning these two numbers is the
          // one-line knob for future adjustments.
          ":root": {
            "--sticky-top-height": "64px",
            "--sticky-secondary-height": "112px",
          },
          body: {
            minHeight: "100vh",
            background:
              mode === "dark"
                ? "radial-gradient(1200px 420px at -8% -10%, rgba(78,159,207,0.2), transparent 60%), radial-gradient(800px 320px at 105% -15%, rgba(132,178,109,0.18), transparent 55%), linear-gradient(180deg, #1f2831 0%, #161d24 100%)"
                : "radial-gradient(1200px 420px at -8% -10%, rgba(179,210,218,0.85), transparent 60%), radial-gradient(900px 320px at 105% -15%, rgba(191,214,158,0.6), transparent 55%), linear-gradient(180deg, #f1f3f4 0%, #ffffff 100%)",
          },
          // Make horizontal overflow containers respond to Shift+wheel as
          // horizontal scroll. Native browsers already do this for
          // overflow:auto elements, but explicitly allow horizontal
          // overscroll so users don't trigger back-navigation gestures.
          ".sticky-top-shell": {
            position: "sticky",
            top: 0,
            zIndex: 20,
            backdropFilter: "blur(6px)",
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: ({ theme }) => ({
            border: `1px solid ${theme.palette.mode === "dark" ? "rgba(121,186,224,0.2)" : "rgba(0,78,130,0.12)"}`,
            boxShadow:
              theme.palette.mode === "dark"
                ? "0 10px 28px rgba(8, 14, 20, 0.45)"
                : "0 10px 30px rgba(0, 48, 86, 0.08)",
            backdropFilter: "blur(1px)",
          }),
        },
      },
      MuiAccordion: {
        styleOverrides: {
          // Clip child content so the expanded table shares the rounded
          // corner with the accordion shell — fixes the sliver-at-the-seam
          // issue when tables are flush to the accordion edge.
          root: {
            overflow: "hidden",
          },
        },
      },
      // Post-C4 item 3: disable MUI's Button ripple animation. The
      // default ripple timing (~550ms) made clicks feel laggy — the
      // action fires synchronously but the visual cue completes after
      // the ripple settles, giving the appearance that the button took
      // half a second to react. Disabling the ripple makes the click
      // feedback instantaneous while MUI still handles hover/focus
      // visuals. disableRipple on the shared MuiButtonBase default
      // propagates to Button, IconButton, ToggleButton, MenuItem, Tab,
      // and Chip (when clickable), so one switch covers every clickable
      // surface in the app.
      MuiButtonBase: {
        defaultProps: {
          disableRipple: true,
        },
      },
      // Post-C4 round-3 item 1b: belts-and-suspenders button transition
      // compression. The `theme.transitions.duration.short` cut above
      // flows into most MUI components automatically, but Button's
      // built-in background-color transition explicitly references
      // `short` via the emotion createTransitions helper at theme build
      // time. If a downstream sx prop re-invokes transitions.create
      // with an older duration, it would bypass our theme override.
      // Pin the Button background transition to ~80ms directly so
      // click feedback never feels draggy regardless of what the
      // component override resolves to.
      MuiButton: {
        styleOverrides: {
          root: {
            transition:
              "background-color 80ms ease, box-shadow 80ms ease, border-color 80ms ease, color 80ms ease",
          },
        },
      },
      // Post-C4 round-3 item 1c: Dialog mount animation also sped up.
      // MUI Dialog's Grow transition reads from
      // theme.transitions.duration.enteringScreen (cut above to 100ms),
      // but some callers pass explicit TransitionProps. Override the
      // default here so every Dialog inherits the snappy timing without
      // per-call-site edits.
      MuiDialog: {
        defaultProps: {
          transitionDuration: { enter: 100, exit: 90 },
        },
      },
      // Post-C4 item 4: give DataGrid column headers a visible contrast
      // against data rows. Previously headers blended into the body — a
      // subtle background tint plus a stronger bottom border and bolder
      // font solves it without shouting. Applied at the theme level so
      // every DataGrid instance gets the treatment uniformly.
      // Post-C4 polish item 2: subtle vertical separators between
      // columns (cells + headers) using the theme's `divider` color so
      // they stay quiet in both light and dark mode. The last cell /
      // header in a row intentionally has no right border so we don't
      // double-draw against the grid's own outer edge.
      MuiDataGrid: {
        styleOverrides: {
          root: ({ theme }) => ({
            "& .MuiDataGrid-columnHeaders": {
              backgroundColor: theme.palette.mode === "dark"
                ? "rgba(78, 159, 207, 0.08)"
                : "rgba(0, 78, 130, 0.05)",
              borderBottom: `2px solid ${theme.palette.mode === "dark"
                ? "rgba(121, 186, 224, 0.35)"
                : "rgba(0, 78, 130, 0.25)"}`,
            },
            "& .MuiDataGrid-columnHeader": {
              backgroundColor: theme.palette.mode === "dark"
                ? "rgba(78, 159, 207, 0.08)"
                : "rgba(0, 78, 130, 0.05)",
              borderRight: `1px solid ${theme.palette.divider}`,
            },
            "& .MuiDataGrid-columnHeader:last-of-type": {
              borderRight: "none",
            },
            "& .MuiDataGrid-columnHeaderTitle": {
              fontWeight: 700,
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
      <App colorMode={mode} onToggleColorMode={() => setMode((m) => (m === "light" ? "dark" : "light"))} />
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
