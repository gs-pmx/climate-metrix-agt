from ghg_engine.units import build_unit_registry, parse_qty, to_unit


def test_energy_units_convert_from_mmbtu_to_kwh():
    ureg = build_unit_registry()

    converted = to_unit(ureg, parse_qty(ureg, 1.0, "mmbtu"), "kwh")

    assert converted.magnitude > 293
