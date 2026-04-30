// Branding marks rendered as inline SVG so they (a) honor ``currentColor``
// for the wordmark text — letting the chrome's text-color token theme
// the logo across light + dark — and (b) keep the brand-fixed accent
// red anchored regardless of mode.
//
// The Parametrix logo is the corporate mark; ClimateMetrix is the
// product mark. They render side-by-side in the non-sticky header.
// Both use Assistant for typographic continuity with the rest of the
// UI (loaded via Google Fonts in ``index.css``).

export const BRAND_RED = "#d92626";

export function ParametrixLogo({ height = 22, title = "Parametrix" }) {
  // F2 PR 1 originally placed a small brand-red square at the top
  // right — meant to mirror the PDF brand mark's accent dot. After
  // the live smoke test it read as a stray dot rather than a
  // recognizable brand element. Removed; the wordmark stands alone
  // and the viewBox tightens to drop the empty space the square left
  // behind.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 32"
      role="img"
      aria-label={title}
      height={height}
      style={{ display: "block" }}
    >
      <title>{title}</title>
      <text
        x="0"
        y="26"
        fontFamily="Assistant, system-ui, sans-serif"
        fontSize="28"
        fontWeight="800"
        letterSpacing="-0.01em"
        fill="currentColor"
      >
        Parametrix
      </text>
    </svg>
  );
}

export function ClimateMetrixWordmark({ height = 20, title = "ClimateMetrix" }) {
  // "Climate" in the chrome's text color, "Metrix" in brand red — the
  // same split used in the original product logotype.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 220 32"
      role="img"
      aria-label={title}
      height={height}
      style={{ display: "block" }}
    >
      <title>{title}</title>
      <text
        x="0"
        y="26"
        fontFamily="Assistant, system-ui, sans-serif"
        fontSize="24"
        fontWeight="700"
        letterSpacing="-0.005em"
      >
        <tspan fill="currentColor">Climate</tspan>
        <tspan fill={BRAND_RED}>Metrix</tspan>
      </text>
    </svg>
  );
}
