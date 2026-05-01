# Operational Inventory Coverage Catalog

Last updated: 2026-05-01

This catalog compares the target operational inventory menu against the current Climate Metrix activity catalog, equation modules, and bundled emissions factor documents.

Status meanings:

- **Included**: the activity is represented in `data/activity_types.json`, has a registered EQM, and has a current EF path for ordinary use.
- **Partial**: some activity, EQM, or factor support exists, but the target inventory capability is incomplete.
- **Not supported**: there is no current first-class activity and calculation path.
- **Proposed addition**: recommended as part of a complete operational inventory menu, but not in the minimum list originally supplied.

Basis reviewed:

- `data/activity_types.json`
- `data/emission_factors.json`
- registered EQMs under `ghg_engine/eqms`
- current catalog and audit APIs
- project domain notes in `docs/standards-map.md`, `docs/handoff-notes-2026-04.md`, and `docs/spend-based-accounting-plan.md`

## Critical Additions To The Minimum Menu

The supplied minimum menu is a strong operating inventory baseline. The main additions I would include before calling it complete are:

- Purchased district cooling and chilled water, alongside district steam and heat.
- Capital goods as a separately visible Scope 3 category, not only an optional spend mapping.
- Upstream and downstream leased assets where leased offices, equipment, or fleet are outside the selected operational-control boundary.
- Hotel stays, taxi, ridehail, and other business ground transport.
- Purchased water supply, in addition to wastewater treatment.
- Fuel- and energy-related activities as explicit Scope 3 Category 3 records: upstream fuel production, upstream purchased electricity, and T&D losses.
- Non-road mobile equipment and emergency generators as first-class operational sources.
- Process and industrial gas releases beyond refrigerant-style records: CH4, N2O, SF6, NF3, and other Kyoto gases by released mass.
- Fire suppression system releases.
- Home office or telework energy where employee remote work is material.
- Product and value-chain categories where material: processing, use, and end-of-life of sold products; franchises; and investments.

## Coverage Catalog

### Stationary Energy And Scope 2

| Target capability | Current status | Current support | Main gaps |
| --- | --- | --- | --- |
| Purchased electricity, grid/location-based | Included | `scope2_purchased_electricity_grid_mix` uses `scope2_energy`; bundled eGRID/EIA electricity-generation factors cover location-based grid electricity. | Need ongoing annual factor refresh and residual/source selection policy as new sources are added. |
| Purchased electricity, market-based renewables, PPAs, RECs | Partial | `scope2_purchased_electricity_renewable_purchase` exists and `scope2_energy` supports market-based manual factors and procurement metadata. | No first-class REC/PPA/residual mix factor library, instrument quality checks, or market-boundary validation yet. |
| Onsite electricity generation | Not supported | `scope1_onsite_generation_electricity` is present as planned catalog intent. | No registered onsite-generation EQM, activity inputs, or generator fuel/electric output factor resolution path. |
| Stationary natural gas combustion | Included | `scope1_stationary_natural_gas` uses direct combustion factors from TCR. | Add explicit upstream energy companion records when Scope 3 Category 3 is enabled. |
| Stationary diesel combustion | Partial | `scope1_stationary_diesel` has direct combustion factors for distillate fuel oil/diesel. | Needs cleaner generator/equipment distinctions, unit coverage, and upstream fuel companion treatment. |
| Stationary propane combustion | Included | `scope1_stationary_propane` uses direct propane combustion factors. | Add upstream fuel companion treatment. |
| District steam or heat | Partial | `scope2_purchased_district_steam` has delivered district steam factor support; renewable district steam is planned. | District hot water, district heat, chilled water, and renewable contractual treatment are not complete. |
| District cooling or chilled water | Proposed addition | None. | Add activity, EQM treatment, and source factors. |
| Fuel- and energy-related activities | Partial | Some fuel CI/full-life-cycle and electricity T&D-loss factor records exist. | No explicit Scope 3 Category 3 activity set or calculation path using these factors. |

### Owned And Controlled Mobile Sources

| Target capability | Current status | Current support | Main gaps |
| --- | --- | --- | --- |
| Owned vehicle gasoline | Included | `scope1_mobile_gasoline` with direct combustion factors. | Needs optional upstream companion treatment. |
| Owned vehicle ethanol, E100 | Included | `scope1_mobile_ethanol` with direct factors. | Needs biogenic CO2 reporting treatment and blend support. |
| Owned vehicle diesel | Partial | `scope1_mobile_diesel` has direct diesel factors. | Activity is marked partial; needs clearer fuel subtypes and upstream companion treatment. |
| Owned vehicle biodiesel, B100 | Included | `scope1_mobile_biodiesel` with direct factors. | Needs biogenic CO2 reporting treatment and blend support. |
| Owned vehicle renewable diesel | Included | `scope1_mobile_renewable_diesel` with direct factors. | Needs biogenic CO2 reporting treatment, lifecycle treatment, and blend support. |
| Owned vehicle propane | Included | `scope1_mobile_propane` with direct factors. | Needs optional upstream companion treatment. |
| Owned vehicle CNG | Included | `scope1_mobile_cng` with direct factors. | Needs optional upstream companion treatment. |
| Owned vehicle LNG | Included | `scope1_mobile_lng` with direct factors. | Needs optional upstream companion treatment. |
| Mobile fuel blends | Not supported | None. | Need a blend-composition model that can allocate activity across component fuels and handle fossil/biogenic reporting. |
| Owned EV electricity usage | Included | `scope2_mobile_electricity` reuses `scope2_energy` and electricity-generation factors. | Needs charging-source details, onsite charging treatment, and fleet/vehicle metadata. |
| Owned PHEV split fuel and electricity | Partial | Can be approximated as separate fuel and EV electricity records. | No first-class PHEV activity that accepts electric/fuel split or total VMT with operating assumptions. |
| VMT plus vehicle efficiency fuel estimation | Partial | `distance_plus_efficiency` exists for rental and employee-owned business travel. | Not first-class for owned fleet; currently limited mainly to gasoline/diesel estimation. |
| Non-road equipment and emergency generators | Proposed addition | Can sometimes be approximated with stationary or mobile direct-factor entries. | Needs explicit activities for forklifts, yard equipment, construction equipment, and standby generators. |

### Freight And Distribution

| Target capability | Current status | Current support | Main gaps |
| --- | --- | --- | --- |
| Upstream truck freight | Included | `scope3_upstream_transport_truck_freight` with ton-mile EQM and EPA truck freight factors. | Add carrier-specific factors and fuel-based option. |
| Upstream rail freight | Included | `scope3_upstream_transport_rail_freight` with ton-mile EQM and EPA rail factors. | Add carrier-specific factors and regional distinctions. |
| Upstream ocean freight | Included | `scope3_upstream_transport_ocean_freight` with ton-mile EQM and waterborne craft factors. | Add vessel class and lane-specific factor support. |
| Upstream air freight | Included | `scope3_upstream_transport_air_freight` with ton-mile EQM and aircraft freight factors. | Add route/class-specific factors where available. |
| Downstream freight | Not supported | Upstream freight factors and EQM could be reused. | Needs first-class downstream transportation/distribution activities and Scope 3 category mapping. |
| Other freight modes | Partial | `scope3_upstream_transport_other_freight_fuel` exists as deferred intent. | No active calculation path or general fallback activity. |
| Fuel-based contracted freight | Not supported | Combustion factors exist for many fuels. | Need contracted-freight fuel activity, ownership/boundary rules, and optional carrier data. |

### Business Travel

| Target capability | Current status | Current support | Main gaps |
| --- | --- | --- | --- |
| Rental vehicle, mileage-based | Partial | `scope3_business_travel_rental_vehicle` uses `distance_plus_efficiency` for gasoline/diesel mileage estimation. | No EV, PHEV, propane, CNG, LNG, biodiesel, renewable diesel, or blend support. |
| Rental vehicle, fuel-based | Not supported | Combustion factors exist, but no rental-specific fuel-purchase activity. | Need rental vehicle fuel input path and fuel taxonomy alignment. |
| Employee-owned vehicle business travel | Included | `scope3_business_travel_employee_owned_vehicle` supports mileage plus efficiency using gasoline factors. | Diesel and alternative fuel support is limited. |
| Commercial aviation | Included | `scope3_business_travel_air` with passenger-distance EQM and EPA/DESNZ air factors. | Add cabin class, route distance class, radiative forcing policy, and source selection rules. |
| Business travel bus | Partial | Bus passenger-transport factors exist, but the cataloged bus activity is employee commuting. | Add business-travel bus activity. |
| Business travel heavy rail | Partial | `scope3_business_travel_intercity_rail` exists. | Need clearer heavy rail/intercity rail naming and geography support. |
| Business travel light rail or transit rail | Partial | Transit rail factors exist, but the cataloged transit rail activity is employee commuting. | Add business-travel transit rail activity. |
| Hotel stays and lodging | Proposed addition | None. | Add lodging activity and factor sources. |
| Taxi, ridehail, and other ground transport | Proposed addition | None. | Add passenger-distance or spend/fuel hybrid path. |

### Fugitive, Process, And Industrial Gas Releases

| Target capability | Current status | Current support | Main gaps |
| --- | --- | --- | --- |
| Refrigerant releases | Partial | `scope1_fugitive_refrigerant_release` uses released mass and AR6 GWP factors; bundled factors include HFCs, HFOs, PFCs, CFCs, HCFCs, SF6, NF3, and blends. | Activity is framed around refrigerants; needs service/vendor evidence fields, blend composition policy, and legacy AR4/AR5 policy options. |
| SF6 releases | Partial | SF6 appears in the fugitive selector/factor set. | Needs explicit electrical equipment SF6 activity and asset leakage workflow. |
| NF3 releases | Partial | NF3 appears in the fugitive selector/factor set. | Needs explicit electronics/industrial gas release activity. |
| CH4 fugitive releases | Not supported | None as a general mass-release fugitive activity. | Add direct CH4 release activity for process, pipeline, or equipment leakage where applicable. |
| N2O and other Kyoto gas releases | Not supported | Some fluorinated gases are covered through refrigerant-style factors. | Add general industrial gas release activity and factor taxonomy. |
| Fire suppression systems | Proposed addition | Could be approximated only if gas is present in fugitive factors. | Add fire suppression-specific activity and evidence fields. |

### Waste And Water

| Target capability | Current status | Current support | Main gaps |
| --- | --- | --- | --- |
| Landfilled waste, no methane recovery | Included | `scope3_waste_generated_in_operations` supports landfill without methane recovery. | Needs waste material subtype and region-specific landfill assumptions. |
| Landfilled waste, methane capture and flaring | Included | Waste activity supports landfill flaring treatment. | Needs clearer factor provenance and decay/capture assumption documentation. |
| Landfilled waste, methane capture and energy generation | Included | Waste activity supports landfill electricity recovery treatment. | Needs avoided-emissions policy treatment if ever reported separately. |
| Incinerated waste | Included | Waste activity includes incineration factors. | Add energy recovery distinction if needed. |
| Recycling | Not supported | None. | Add recycling activity and factors by material type. |
| Compost | Not supported | None. | Add compost activity and factors by material type/process. |
| Wastewater treatment | Not supported | None. | Add wastewater activity, treatment system taxonomy, CH4/N2O factors, and service-utility evidence fields. |
| Purchased water supply | Proposed addition | None. | Add purchased water activity and water supply/treatment factors. |

### Employee Commuting

| Target capability | Current status | Current support | Main gaps |
| --- | --- | --- | --- |
| Commute single-occupancy gasoline or diesel vehicle | Not supported | Business-travel vehicle methods could be reused conceptually. | Need employee commuting vehicle activity, occupancy rules, commute days, and survey/bulk-entry workflow. |
| Commute carpool gasoline or diesel vehicle | Not supported | None. | Need occupancy allocation and mode-specific commute activity. |
| Commute EV | Not supported | Scope 2 mobile electricity method could be reused. | Need commute EV activity and allocation policy. |
| Commute PHEV | Not supported | Can only be approximated manually using separate fuel and electricity records. | Need PHEV split logic. |
| Commute bus | Included | `scope3_employee_commuting_bus` with passenger-distance EQM. | Needs survey-mode aggregation workflow. |
| Commute light rail or transit rail | Included | `scope3_employee_commuting_transit_rail` with passenger-distance EQM. | Needs mode split by rail type where factors differ. |
| Commute commuter rail | Partial | Intercity rail and transit rail factors exist. | Need commute-specific commuter rail activity. |
| Walk or bike commute | Not supported | None. | Add zero-emission commute mode for complete survey accounting and denominator tracking. |
| Home office or telework energy | Proposed addition | None. | Add optional telework energy activity if this is material for customers. |

### Purchased Goods, Services, And Supply Chain

| Target capability | Current status | Current support | Main gaps |
| --- | --- | --- | --- |
| Spend-based supply chain emissions | Partial | `scope3_spend_based` EQM exists; reference FX/CPI/crosswalk tables and ingestion tooling support USEEIO/EXIOBASE workflows. | Full spend EF datasets are not bundled in the active catalog; factor governance and mapping review are still needed. |
| Company-specific supplier EFs | Not supported | No general supplier-specific EF ingestion or selection path. | Add supplier factor source records, quality scoring, effective-year rules, and override hierarchy. |
| Material-specific EFs | Not supported | None as physical material input activities. | Add material quantity activities and factor taxonomy. |
| Product-specific EFs | Not supported | None as product quantity activities. | Add product/activity taxonomy and supplier or LCA factor ingestion path. |
| Capital goods | Proposed addition | Could be approximated through spend if mapped. | Add explicit Scope 3 Category 2 catalog treatment. |
| Leased assets | Proposed addition | None. | Add upstream/downstream leased asset activities with boundary controls. |

### Product And Investment Value Chain

These are not always needed for a basic operational inventory, but they are critical for some companies under full Scope 3 reporting.

| Target capability | Current status | Current support | Main gaps |
| --- | --- | --- | --- |
| Processing of sold products | Proposed addition | None. | Add Scope 3 Category 10 activity path. |
| Use of sold products | Proposed addition | None. | Add Scope 3 Category 11 activity path and product-use assumptions. |
| End-of-life treatment of sold products | Proposed addition | None. | Add Scope 3 Category 12 activity path and waste treatment mapping. |
| Franchises | Proposed addition | None. | Add Scope 3 Category 14 activity path. |
| Investments | Proposed addition | None. | Add Scope 3 Category 15 activity path and finance-specific factors/methods. |

## Near-Term Build Order

1. Add first-class catalog activities for the known operational gaps: wastewater, recycling, compost, downstream freight, employee commute vehicles, business travel bus/transit rail, and fuel blends.
2. Add explicit Scope 3 Category 3 fuel- and energy-related activities, because the factor library already contains some upstream and T&D-loss ingredients.
3. Expand vehicle fuel handling from single-fuel enum selection to a reusable fuel taxonomy with blend composition, biogenic reporting treatment, and EV/PHEV split support.
4. Add supplier, material, and product-specific factor workflows after the spend-based source governance is stable.
5. Keep the full-inventory EF catalog endpoint as the audit surface, and extend it as each new activity becomes first-class.
