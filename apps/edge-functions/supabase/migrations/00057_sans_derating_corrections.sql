-- =============================================================================
-- Migration 00057 — SANS reference library: derating corrections + earth table
-- =============================================================================
-- A coverage audit of the source FACTS AND FIGURES workbook against what was
-- seeded found three defects, all corrected here:
--
--   1. TABLE_6_3_1 (seeded by 00056) carried the WRONG data — the bootstrap
--      file sans-bootstrap/data/SANS_1507-3/6_3_1.json is mislabelled: its
--      rows are actually Table 4.3.1 (MV-paper depth derating), not 6.3.1.
--      Re-seeded here with the real LV Table 6.3.1 (depths 500–2000 mm).
--
--   2. TABLE_6_3_2..6_3_5 (hand-typed in 00053) were placeholder values that
--      do not match the workbook — wrong row counts, wrong numbers, wrong
--      structure. The live derating calculation (lookupDeratingFactors)
--      reads these, so cable derating has been computing off invented
--      factors. Replaced with the real LV derating suite 6.3.2–6.3.7.
--
--   3. TABLE_9_1 (seeded empty by 00056) — the workbook stores this table
--      transposed (sizes as columns), so the extractor produced 0 rows.
--      Normalised to one row per size (10 / 16 / 25 mm²) here.
--
-- Scope note: the MV derating suites (4.3.x / 5.2.x) and the reference
-- tables 6.9 / 7.1 / 9.2 exist in the source but are intentionally deferred
-- to a later migration — this migration covers the LV derating path that
-- feeds the live cable-rating calculation.
--
-- Source: CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet (all_tables.json
-- catalogue). Transposed / matrix tables hand-normalised — see gen script.
-- Idempotent: deletes the 8 codes first (sans_rows cascade) then re-inserts.
-- =============================================================================

DELETE FROM cable_schedule.sans_tables WHERE code IN (
    'TABLE_6_3_1', 'TABLE_6_3_2', 'TABLE_6_3_3', 'TABLE_6_3_4', 'TABLE_6_3_5', 'TABLE_6_3_6', 'TABLE_6_3_7', 'TABLE_9_1'
);

-- --------------------------------------------------------------------------
-- TABLE_6_3_1 — Derating factor — depth of laying
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_3_1',
        'Derating factor — depth of laying',
        'SANS 1507-3 / 1507-4',
        '6.3.1',
        NULL,
        'Multiplier applied to the base current rating when an LV cable is buried at a depth other than the reference 500 mm.',
        $cols$[{"key":"depth_mm","label":"Depth of laying","unit":"mm","type":"number","decimals":0,"align":"right","is_key":true},{"key":"factor_direct_in_ground","label":"Direct in ground","unit":"factor","type":"number","align":"right"},{"key":"factor_single_way_duct","label":"In single-way ducts","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Apply multiplicatively with the other derating factors. Use the in-duct column when the cable runs in a single-way duct.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 6.3.1'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (500, $r${"depth_mm":500,"factor_direct_in_ground":1,"factor_single_way_duct":1}$r$),
    (800, $r${"depth_mm":800,"factor_direct_in_ground":0.97,"factor_single_way_duct":0.97}$r$),
    (1000, $r${"depth_mm":1000,"factor_direct_in_ground":0.95,"factor_single_way_duct":0.96}$r$),
    (1250, $r${"depth_mm":1250,"factor_direct_in_ground":0.94,"factor_single_way_duct":0.95}$r$),
    (1500, $r${"depth_mm":1500,"factor_direct_in_ground":0.93,"factor_single_way_duct":0.94}$r$),
    (2000, $r${"depth_mm":2000,"factor_direct_in_ground":0.92,"factor_single_way_duct":0.93}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_6_3_2 — Derating factor — soil thermal resistivity
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_3_2',
        'Derating factor — soil thermal resistivity',
        'SANS 1507-3 / 1507-4',
        '6.3.2',
        NULL,
        'Multiplier applied for soil thermal resistivity other than the reference 1.2 K·m/W.',
        $cols$[{"key":"resistivity_kmw","label":"Thermal resistivity","unit":"K·m/W","type":"number","align":"right","is_key":true},{"key":"factor_direct_in_ground","label":"Direct in ground","unit":"factor","type":"number","align":"right"},{"key":"factor_single_way_duct","label":"In single-way ducts","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Apply multiplicatively with the other derating factors.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 6.3.2'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (1, $r${"resistivity_kmw":1,"factor_direct_in_ground":1.08,"factor_single_way_duct":1.04}$r$),
    (1.2, $r${"resistivity_kmw":1.2,"factor_direct_in_ground":1,"factor_single_way_duct":1}$r$),
    (1.5, $r${"resistivity_kmw":1.5,"factor_direct_in_ground":0.93,"factor_single_way_duct":0.96}$r$),
    (2, $r${"resistivity_kmw":2,"factor_direct_in_ground":0.83,"factor_single_way_duct":0.88}$r$),
    (2.5, $r${"resistivity_kmw":2.5,"factor_direct_in_ground":0.78,"factor_single_way_duct":0.87}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_6_3_3 — Derating factor — grouping by axial spacing
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_3_3',
        'Derating factor — grouping by axial spacing',
        'SANS 1507-3 / 1507-4',
        '6.3.3',
        NULL,
        'Multiplier for N grouped multi-core cables, by axial spacing between cables. Touching = no clearance.',
        $cols$[{"key":"n_cables","label":"Number in group","unit":null,"type":"number","decimals":0,"align":"right","is_key":true},{"key":"ground_touching","label":"Ground — touching","unit":"factor","type":"number","align":"right"},{"key":"ground_150mm","label":"Ground — 150 mm","unit":"factor","type":"number","align":"right"},{"key":"ground_300mm","label":"Ground — 300 mm","unit":"factor","type":"number","align":"right"},{"key":"ground_450mm","label":"Ground — 450 mm","unit":"factor","type":"number","align":"right"},{"key":"ground_600mm","label":"Ground — 600 mm","unit":"factor","type":"number","align":"right"},{"key":"duct_touching","label":"Duct — touching","unit":"factor","type":"number","align":"right"},{"key":"duct_300mm","label":"Duct — 300 mm","unit":"factor","type":"number","align":"right"},{"key":"duct_450mm","label":"Duct — 450 mm","unit":"factor","type":"number","align":"right"},{"key":"duct_600mm","label":"Duct — 600 mm","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Direct-in-ground columns: touching / 150 / 300 / 450 / 600 mm spacing. In-duct columns: touching / 300 / 450 / 600 mm spacing.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 6.3.3'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (2, $r${"n_cables":2,"ground_touching":0.81,"ground_150mm":0.87,"ground_300mm":0.91,"ground_450mm":0.93,"ground_600mm":0.94,"duct_touching":0.9,"duct_300mm":0.93,"duct_450mm":0.95,"duct_600mm":0.96}$r$),
    (3, $r${"n_cables":3,"ground_touching":0.7,"ground_150mm":0.78,"ground_300mm":0.84,"ground_450mm":0.87,"ground_600mm":0.9,"duct_touching":0.82,"duct_300mm":0.87,"duct_450mm":0.9,"duct_600mm":0.93}$r$),
    (4, $r${"n_cables":4,"ground_touching":0.63,"ground_150mm":0.74,"ground_300mm":0.81,"ground_450mm":0.86,"ground_600mm":0.89,"duct_touching":0.78,"duct_300mm":0.85,"duct_450mm":0.89,"duct_600mm":0.91}$r$),
    (5, $r${"n_cables":5,"ground_touching":0.59,"ground_150mm":0.7,"ground_300mm":0.78,"ground_450mm":0.83,"ground_600mm":0.87,"duct_touching":0.75,"duct_300mm":0.82,"duct_450mm":0.87,"duct_600mm":0.9}$r$),
    (6, $r${"n_cables":6,"ground_touching":0.55,"ground_150mm":0.67,"ground_300mm":0.76,"ground_450mm":0.82,"ground_600mm":0.86,"duct_touching":0.72,"duct_300mm":0.81,"duct_450mm":0.86,"duct_600mm":0.9}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_6_3_4 — Derating factor — ground temperature
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_3_4',
        'Derating factor — ground temperature',
        'SANS 1507-3 / 1507-4',
        '6.3.4',
        NULL,
        'Multiplier for ground temperature other than the reference 25 °C. Separate columns for PVC (70 °C) and XLPE (90 °C) conductor ratings.',
        $cols$[{"key":"ambient_c","label":"Ground temperature","unit":"°C","type":"number","decimals":0,"align":"right","is_key":true},{"key":"factor_pvc_70c","label":"PVC (70 °C conductor)","unit":"factor","type":"number","align":"right"},{"key":"factor_xlpe_90c","label":"XLPE (90 °C conductor)","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Apply multiplicatively with the other derating factors.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 6.3.4'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (25, $r${"ambient_c":25,"factor_pvc_70c":1,"factor_xlpe_90c":1}$r$),
    (30, $r${"ambient_c":30,"factor_pvc_70c":0.95,"factor_xlpe_90c":0.96}$r$),
    (35, $r${"ambient_c":35,"factor_pvc_70c":0.9,"factor_xlpe_90c":0.92}$r$),
    (40, $r${"ambient_c":40,"factor_pvc_70c":0.85,"factor_xlpe_90c":0.88}$r$),
    (45, $r${"ambient_c":45,"factor_pvc_70c":0.8,"factor_xlpe_90c":0.82}$r$),
    (50, $r${"ambient_c":50,"factor_pvc_70c":0.7,"factor_xlpe_90c":0.76}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_6_3_5 — Derating factor — air temperature
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_3_5',
        'Derating factor — air temperature',
        'SANS 1507-3 / 1507-4',
        '6.3.5',
        NULL,
        'Multiplier for ambient air temperature other than the reference 30 °C. Separate columns for PVC (70 °C) and XLPE (90 °C) conductor ratings.',
        $cols$[{"key":"ambient_c","label":"Air temperature","unit":"°C","type":"number","decimals":0,"align":"right","is_key":true},{"key":"factor_pvc_70c","label":"PVC (70 °C conductor)","unit":"factor","type":"number","align":"right"},{"key":"factor_xlpe_90c","label":"XLPE (90 °C conductor)","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Applies to cables installed in air rather than buried.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 6.3.5'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (30, $r${"ambient_c":30,"factor_pvc_70c":1,"factor_xlpe_90c":1}$r$),
    (35, $r${"ambient_c":35,"factor_pvc_70c":0.94,"factor_xlpe_90c":0.95}$r$),
    (40, $r${"ambient_c":40,"factor_pvc_70c":0.87,"factor_xlpe_90c":0.89}$r$),
    (45, $r${"ambient_c":45,"factor_pvc_70c":0.79,"factor_xlpe_90c":0.84}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_6_3_6 — Derating factor — number of cables in a group
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_3_6',
        'Derating factor — number of cables in a group',
        'SANS 1507-3 / 1507-4',
        '6.3.6',
        NULL,
        'Multiplier by number of grouped cables, for cables touching versus laid with clearance D between them.',
        $cols$[{"key":"n_cables","label":"Number of cables","unit":null,"type":"number","decimals":0,"align":"right","is_key":true},{"key":"factor_touching","label":"Cables touching","unit":"factor","type":"number","align":"right"},{"key":"factor_clearance_d","label":"Clearance D between cables","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Use the touching column as the conservative default when the trench layout is not yet known.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 6.3.6'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (1, $r${"n_cables":1,"factor_touching":1,"factor_clearance_d":1}$r$),
    (2, $r${"n_cables":2,"factor_touching":0.9,"factor_clearance_d":0.95}$r$),
    (3, $r${"n_cables":3,"factor_touching":0.84,"factor_clearance_d":0.9}$r$),
    (6, $r${"n_cables":6,"factor_touching":0.8,"factor_clearance_d":0.88}$r$),
    (9, $r${"n_cables":9,"factor_touching":0.75,"factor_clearance_d":0.85}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_6_3_7 — Derating factor — soil resistivity by region
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_3_7',
        'Derating factor — soil resistivity by region',
        'SANS 1507-3 / 1507-4',
        '6.3.7',
        NULL,
        'Regional soil-resistivity multiplier by conductor size band — coastal (1000 Ω·m²) versus highveld (1250 Ω·m²) ground conditions.',
        $cols$[{"key":"size_band","label":"Conductor size band","unit":"mm²","type":"string","align":"left","is_key":true},{"key":"factor_coastal","label":"Coastal (1000 Ω·m²)","unit":"factor","type":"number","align":"right"},{"key":"factor_highveld","label":"Highveld (1250 Ω·m²)","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'sort_key is the lower bound of each size band.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 6.3.7'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (1.5, $r${"size_band":"1.5 - 10","factor_coastal":0.7,"factor_highveld":0.62}$r$),
    (16, $r${"size_band":"16 - 35","factor_coastal":0.68,"factor_highveld":0.57}$r$),
    (50, $r${"size_band":"50 - 95","factor_coastal":0.65,"factor_highveld":0.53}$r$),
    (120, $r${"size_band":"120 - 185","factor_coastal":0.62,"factor_highveld":0.49}$r$),
    (240, $r${"size_band":"240 - 400","factor_coastal":0.59,"factor_highveld":0.44}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_9_1 — Earth conductor — resistance, current rating, 1 s short-circuit rating
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_9_1',
        'Earth conductor — resistance, current rating, 1 s short-circuit rating',
        'SANS 10142-1',
        '9.1',
        NULL,
        'Phase and earth conductor resistance, loop impedance, current rating and 1 second short-circuit rating for LV earth-continuity conductors.',
        $cols$[{"key":"size_mm2","label":"Cable size","unit":"mm²","type":"number","decimals":0,"align":"right","is_key":true},{"key":"phase_resistance_ohm_per_km","label":"Phase conductor resistance","unit":"Ω/km","type":"number","align":"right"},{"key":"earth_resistance_ohm_per_km","label":"Earth conductor resistance","unit":"Ω/km","type":"number","align":"right"},{"key":"impedance_ohm_per_km","label":"Impedance (Z)","unit":"Ω/km","type":"number","align":"right"},{"key":"current_rating_a","label":"Current rating","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"short_circuit_1s_ka","label":"1 s short-circuit rating","unit":"kA","type":"number","align":"right"}]$cols$::jsonb,
        'Source workbook stores this table transposed (sizes as columns); values normalised to one row per size here.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 9.1'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (10, $r${"size_mm2":10,"phase_resistance_ohm_per_km":1.83,"earth_resistance_ohm_per_km":1.83,"impedance_ohm_per_km":2.34,"current_rating_a":80,"short_circuit_1s_ka":0.82}$r$),
    (16, $r${"size_mm2":16,"phase_resistance_ohm_per_km":1.15,"earth_resistance_ohm_per_km":1.15,"impedance_ohm_per_km":1.47,"current_rating_a":105,"short_circuit_1s_ka":2.29}$r$),
    (25, $r${"size_mm2":25,"phase_resistance_ohm_per_km":0.73,"earth_resistance_ohm_per_km":0.73,"impedance_ohm_per_km":0.93,"current_rating_a":135,"short_circuit_1s_ka":3.57}$r$)
) AS v(sort_key, row_data);

NOTIFY pgrst, 'reload schema';
