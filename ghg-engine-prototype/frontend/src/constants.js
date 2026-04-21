export const UNIT_OPTIONS_BY_SOURCE_TYPE = {
  "natural-gas": ["cubic feet", "therm", "mmbtu"],
  electricity: ["kwh"],
  gasoline: ["gallon"],
  diesel: ["gallon"],
  "district-steam": ["mmbtu"],
};

export const EMPTY_ACTIVITY = {
  id: "",
  facility_id: "",
  activity_type_id: "",
  source_id: "",
  source_label: "",
  source_type: "",
  scope: "",
  metric_group: "",
  metric_subgroup: "",
  method_id: "",
  activity_value: "",
  activity_unit: "",
  params: {},
};

export function uid() {
  return `id_${Math.random().toString(36).slice(2, 10)}`;
}

export function unitOptionsForSource(source) {
  if (!source) return [];
  if (source.method_id === "miles_to_fuel") {
    return source.allowed_units?.length ? source.allowed_units : ["mile"];
  }
  if (source.allowed_units?.length) return source.allowed_units;
  const base = UNIT_OPTIONS_BY_SOURCE_TYPE[source.source_type] || [source.default_unit];
  return Array.from(new Set(base.filter(Boolean)));
}

export function normalizeActivityForSubmit(row) {
  if (row.method_id === "miles_to_fuel") {
    const mpg = Number(row.params?.mpg || 0);
    if (!Number.isFinite(mpg) || mpg <= 0) {
      throw new Error(`${row.source_label || row.source_type}: miles input requires positive mpg.`);
    }
    return {
      activity: { value: Number(row.activity_value), unit: row.activity_unit },
      params: { ...(row.params || {}), mpg, fuel_type: row.source_type },
    };
  }
  return {
    activity: { value: Number(row.activity_value), unit: row.activity_unit },
    params: row.params || {},
  };
}
