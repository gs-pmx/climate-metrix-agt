export const UNIT_OPTIONS_BY_SOURCE_TYPE = {
  "natural-gas": ["cubic feet", "therm", "mmbtu"],
  electricity: ["kwh"],
  gasoline: ["gallon", "mile"],
  diesel: ["gallon", "mile"],
  "district-steam": ["mmbtu"],
};

export const EMPTY_ACTIVITY = {
  id: "",
  facility_id: "",
  source_id: "",
  source_label: "",
  source_type: "",
  scope: "",
  metric_group: "",
  metric_subgroup: "",
  activity_value: "",
  activity_unit: "",
  params: {},
};

export function uid() {
  return `id_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeActivityForSubmit(row) {
  const isMiles = String(row.activity_unit).toLowerCase().startsWith("mile");
  const isFuelVehicle = row.source_type === "gasoline" || row.source_type === "diesel";
  if (!isMiles || !isFuelVehicle) {
    return {
      activity: { value: Number(row.activity_value), unit: row.activity_unit },
      params: row.params || {},
    };
  }
  const mpg = Number(row.params?.mpg || 0);
  if (!Number.isFinite(mpg) || mpg <= 0) {
    throw new Error(`${row.source_label || row.source_type}: miles input requires positive mpg.`);
  }
  return {
    activity: { value: Number(row.activity_value) / mpg, unit: "gallon" },
    params: {},
  };
}
