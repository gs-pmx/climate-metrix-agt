// Phase F2 design tokens.
//
// Centralized values that the MUI theme builder reads. Lifting these out
// of ``main.jsx`` keeps the theme construction readable and gives later
// design passes one place to tune. Per ``plans/design-direction-2026-04.md``:
//
//   * Color is functional only. No decorative gradients or rainbow chips.
//   * Hierarchy via weight + size, not color.
//   * Warm neutrals for the foundation; surface luminosity does the work
//     in dark mode (no heavy shadows).
//   * 8pt-grid spacing scale with generous card / section padding.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
//
// Primary: Parametrix corporate blue (PDF brand spec).
// Secondary: forest green — climate-domain accent. Sits at a different
// luminosity from MUI's default success-green so it doesn't collide
// with status semantics.
// Brand red: the Parametrix accent square. Reserved for the brand mark
// only — does not appear elsewhere in the chrome.

export const brand = {
  parametrixBlue: "#004e82",
  parametrixBlueLight: "#2b6f9d",
  parametrixBlueDark: "#003860",
  forestGreen: "#19742c",
  forestGreenLight: "#3e8e4e",
  forestGreenDark: "#0f5520",
  // Brand-mark accent only.
  accentRed: "#d92626",
  // Dark-mode-friendly variants of the same hues — bumped lightness so
  // they sit comfortably on near-black surfaces without going hot.
  parametrixBlueDarkMode: "#79bae0",
  parametrixBlueDarkModeLight: "#a4d0e9",
  parametrixBlueDarkModeDark: "#4e9fcf",
  forestGreenDarkMode: "#a7c68f",
  forestGreenDarkModeLight: "#c1d8ac",
  forestGreenDarkModeDark: "#84b26d",
};

// Three-tier surface stack per the design direction:
//   surface  = page background
//   raised   = cards / panels / sticky bars
//   overlay  = dialogs / popovers
// Light mode gets a slightly warm off-white so the eye doesn't fatigue
// over long data-entry sessions; dark mode uses GitHub-dark-family
// near-blacks with one luminosity step between each tier.

export const surfaces = {
  light: {
    // F2 PR 1 originally moved this to ``#f7f5f0`` (warm cream).
    // After PR 1 corrections landed Stephen flagged the page as ever
    // so slightly warm — wanting a notch cooler to lift the
    // foreground/background contrast. Restored to the pre-F2 cool
    // neutral. Most components paint over the body's gradient anyway,
    // but ``palette.background.default`` flows into Container fallbacks
    // and any deep-nested Box that references the token, so the value
    // still reads.
    surface: "#f1f3f4",
    raised: "#ffffff",
    overlay: "#ffffff",
    border: "rgba(20, 24, 30, 0.08)",
    divider: "rgba(20, 24, 30, 0.06)",
  },
  dark: {
    surface: "#0d1117", // GitHub-dark-family
    raised: "#161b22",
    overlay: "#1f242c",
    border: "rgba(220, 230, 240, 0.08)",
    divider: "rgba(220, 230, 240, 0.06)",
  },
};

// Foreground text. Two roles: primary (body / headings) and secondary
// (labels, metadata, deemphasized copy).

export const text = {
  light: {
    primary: "#13212c",
    secondary: "#4c606e",
  },
  dark: {
    primary: "#e6edf3",
    secondary: "#9aa9b6",
  },
};

// ---------------------------------------------------------------------------
// Spacing scale
// ---------------------------------------------------------------------------
//
// MUI's ``theme.spacing`` is 8px-based by default; we keep that. These
// named tokens give the rest of the app symbolic handles instead of
// scattering ``p: 2`` / ``p: 1.75`` across components.

export const spacing = {
  inline: 1,        //  8px — tight inline gap (chip clusters, icon + label)
  cardSnug: 2,      // 16px — narrow card padding (sticky bar interior)
  card: 3,          // 24px — standard card padding (Papers across the app)
  section: 5,       // 40px — between major page sections
  sectionLarge: 6,  // 48px — between hero and content blocks
};

// ---------------------------------------------------------------------------
// Radius scale
// ---------------------------------------------------------------------------
//
// The C4 polish landed at 7px global. Keeping it; explicit named handle
// here so future component-level tightening (e.g. chips) has one source.

export const radius = {
  base: 7,
  chip: 6,
  pill: 999,
};

// ---------------------------------------------------------------------------
// Shadow scale
// ---------------------------------------------------------------------------
//
// Pre-F2 the MuiPaper override applied ``0 10px 28-30px`` shadows to
// every Paper plus a 1px backdrop blur — too aggressive for a data
// tool. Replaced with restrained tokens. Dark mode relies on surface
// luminosity steps; shadow-as-elevation only carries weight in light.

export const shadows = {
  light: {
    none: "none",
    raised: "0 1px 2px rgba(15, 25, 35, 0.06), 0 1px 3px rgba(15, 25, 35, 0.04)",
    overlay: "0 6px 16px rgba(15, 25, 35, 0.10)",
    sticky: "0 2px 6px rgba(15, 25, 35, 0.05)",
  },
  dark: {
    none: "none",
    // Subtle inner border + low-opacity drop instead of a heavy shadow.
    raised: "0 1px 2px rgba(0, 0, 0, 0.30)",
    overlay: "0 8px 20px rgba(0, 0, 0, 0.45)",
    sticky: "0 1px 0 rgba(0, 0, 0, 0.4)",
  },
};

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export const transitions = {
  durations: {
    shortest: 80,
    shorter: 100,
    short: 100,
    standard: 100,
    complex: 120,
    enteringScreen: 100,
    leavingScreen: 90,
  },
};
