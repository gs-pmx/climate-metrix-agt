from __future__ import annotations

import pint


def build_unit_registry() -> pint.UnitRegistry:
    ureg = pint.UnitRegistry(autoconvert_offset_to_baseunit=True)
    ureg.define("btu = british_thermal_unit")
    ureg.define("scf = cubic_foot = standard_cubic_foot")
    ureg.define("mmbtu = 1000000 * btu")
    ureg.define("therm = 100000 * btu = therms")
    ureg.define("klb = 1000 * pound = klbs")
    ureg.define("short_ton = 2000 * pound")
    ureg.define("ton_mile = short_ton * mile = ton_miles")
    ureg.define("passenger_mile = mile = passenger_miles")

    aliases = {
        "kwh": "kilowatt_hour",
        "kilowatt-hour": "kilowatt_hour",
        "mj": "megajoule",
        "miles": "mile",
        "mile": "mile",
        "gallons": "gallon",
        "gallon": "gallon",
        "kg": "kilogram",
        "g": "gram",
        "lb": "pound",
        "lbs": "pound",
        "t": "metric_ton",
        "mt": "metric_ton",
        "metric ton": "metric_ton",
        "metric_ton": "metric_ton",
        "cubic feet": "cubic_foot",
        "cubic_foot": "cubic_foot",
        "scf": "scf",
        "btu": "btu",
        "mmbtu": "mmbtu",
        "therm": "therm",
        "therms": "therm",
        "tons": "short_ton",
        "short ton": "short_ton",
        "short-ton": "short_ton",
        "klbs": "klbs",
        "pounds": "pound",
        "kg/kwh": "kilogram / kilowatt_hour",
        "g/kwh": "gram / kilowatt_hour",
        "kg/mmbtu": "kilogram / mmbtu",
        "g/mmbtu": "gram / mmbtu",
        "kg/gal": "kilogram / gallon",
        "g/gal": "gram / gallon",
        "kg/scf": "kilogram / scf",
        "g/scf": "gram / scf",
        "passenger miles": "passenger_miles",
        "passenger-mile": "passenger_miles",
        "short-ton-mile": "ton_miles",
        "kg/short-ton-mile": "kilogram / ton_miles",
        "g/short-ton-mile": "gram / ton_miles",
        "kg/passenger-mile": "kilogram / passenger_miles",
        "g/passenger-mile": "gram / passenger_miles",
        "mt/short-ton": "metric_ton / short_ton",
        "ton-miles / year": "ton_miles",
        "ton-miles": "ton_miles",
    }
    ureg._cmx_aliases = aliases  # type: ignore[attr-defined]
    return ureg

def parse_qty(ureg: pint.UnitRegistry, value: float, unit_label: str) -> pint.Quantity:
    token = getattr(ureg, "_cmx_aliases", {}).get(unit_label.strip().lower(), unit_label)
    return value * ureg(token)

def to_unit(ureg: pint.UnitRegistry, qty: pint.Quantity, unit_label: str) -> pint.Quantity:
    token = getattr(ureg, "_cmx_aliases", {}).get(unit_label.strip().lower(), unit_label)
    return qty.to(token)
