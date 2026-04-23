// Shared parse/format helpers for numeric inputs across the app.
//
// Goals:
//   - Accept user-typed values with thousands separators ("1,234", "12,345.67").
//   - Accept plain numbers ("1234", "1234.5").
//   - Return null (never throw) for empty / invalid input.
//   - Format numbers for display with thousands separators and up to 6
//     significant decimal places, trimming trailing zeros.
//
// We format on BLUR, not while typing, so the caret does not jump around.

const MAX_DISPLAY_DECIMALS = 6;

export function parseNumericInput(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const str = String(value).trim();
  if (str === "") return null;
  // Strip thousands separators. Keep leading minus, digits, and a decimal point.
  const stripped = str.replace(/,/g, "");
  // Reject strings that, after stripping commas, still contain characters
  // that would make Number() return NaN or a surprising value.
  if (!/^-?(\d+)(\.\d*)?$|^-?\.\d+$/.test(stripped)) {
    return null;
  }
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

export function formatNumericDisplay(value) {
  if (value == null || value === "") return "";
  // If the value is a string that doesn't parse cleanly, pass it through
  // unchanged — this lets the UI show invalid input back to the user so
  // they can correct it, rather than silently blanking the cell.
  if (typeof value === "string") {
    const parsedFromString = parseNumericInput(value);
    if (parsedFromString == null) return value;
    return formatNumericDisplay(parsedFromString);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const sign = value < 0 ? "-" : "";
  const absValue = Math.abs(value);
  // Split into integer and fractional parts, using a fixed-precision
  // representation to avoid floating-point artifacts like 0.1 + 0.2.
  const [intPart, fracPart = ""] = absValue
    .toFixed(MAX_DISPLAY_DECIMALS)
    .split(".");
  const trimmedFrac = fracPart.replace(/0+$/, "");
  const intWithSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${intWithSeparators}${trimmedFrac ? "." + trimmedFrac : ""}`;
}

// Convenience helper used by edit-cell components: given raw user input,
// return both the parsed number and the display-ready string. Lets the
// caller decide whether to store the number or the formatted string.
export function normalizeNumericInput(value) {
  const parsed = parseNumericInput(value);
  return {
    parsed,
    display: parsed == null ? (value == null ? "" : String(value)) : formatNumericDisplay(parsed),
  };
}
