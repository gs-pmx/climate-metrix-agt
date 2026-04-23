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

  // Slightly tighter corner radius (10 instead of 14) — the previous
  // rounding made table corners show background slivers when accordions
  // expanded, and the new value is visually cleaner at small surfaces
  // like chips and buttons. Accordion/table seam fixes live inside the
  // components that render them.
  return createTheme({
    palette: mode === "dark" ? darkPalette : lightPalette,
    shape: { borderRadius: 10 },
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
