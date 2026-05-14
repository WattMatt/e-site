-- =============================================================================
-- Migration 00058 — SANS reference library: MV derating suites + Table 6.9
-- =============================================================================
-- Seeds 13 reference tables curated from the firm's FACTS AND FIGURES workbook
-- (sans-bootstrap/excel/SANS_Reference_Library.xlsx "(raw)" sheets):
--
--   TABLE_4_3_1..4_3_6  SANS 97    MV paper-insulated cable derating suite
--   TABLE_5_2_1..5_2_6  SANS 1339  MV XLPE cable derating suite
--   TABLE_6_9           SANS 1507  conductor temp limits + short-circuit k
--
-- Reference-only: these are NOT wired into lookupDeratingFactors() — the
-- auto cable-rating calculation stays LV-only (Tables 6.3.x). These tables
-- populate the SANS reference viewer so an engineer can read the MV derating
-- factors when sizing 11 kV cables by hand.
--
-- Matrix tables (4.3.3 / 5.2.3) and band tables (4.3.6 / 5.2.1 / 5.2.6) were
-- hand-normalised from the transposed/multi-header workbook layout — see the
-- generator script for the source mapping. Table 6.9 came without column
-- headers; column meanings are inferred (documented in the table notes).
--
-- Deferred (corrupt or composite source extractions, need judgement): 5.3
-- (earth-fault rating, bleeds all of 6.2–6.7), 7.1 (~5 sub-tables incl. ACSR
-- overhead conductors), 9.2 (transposed earth-cable construction).
--
-- Idempotent: deletes the 13 codes first (sans_rows cascade) then re-inserts.
-- =============================================================================

DELETE FROM cable_schedule.sans_tables WHERE code IN (
    'TABLE_4_3_1', 'TABLE_4_3_2', 'TABLE_4_3_3', 'TABLE_4_3_4', 'TABLE_4_3_5', 'TABLE_4_3_6', 'TABLE_5_2_1', 'TABLE_5_2_2', 'TABLE_5_2_3', 'TABLE_5_2_4', 'TABLE_5_2_5', 'TABLE_5_2_6', 'TABLE_6_9'
);

-- --------------------------------------------------------------------------
-- TABLE_4_3_1 — Derating factor — depth of laying (MV paper)
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_4_3_1',
        'Derating factor — depth of laying (MV paper)',
        'SANS 97',
        '4.3.1',
        NULL,
        'Multiplier applied to the base current rating of a SANS 97 paper-insulated MV cable buried at a depth other than the reference.',
        $cols$[{"key":"depth_mm","label":"Depth of laying","unit":"mm","type":"number","decimals":0,"align":"right","is_key":true},{"key":"factor_direct_in_ground","label":"Direct in ground","unit":"factor","type":"number","align":"right"},{"key":"factor_single_way_duct","label":"In single-way ducts","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Apply multiplicatively with the other Table 4.3.x derating factors.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 4.3.1'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (800, $r${"depth_mm":800,"factor_direct_in_ground":1,"factor_single_way_duct":1}$r$),
    (1000, $r${"depth_mm":1000,"factor_direct_in_ground":0.98,"factor_single_way_duct":0.99}$r$),
    (1250, $r${"depth_mm":1250,"factor_direct_in_ground":0.96,"factor_single_way_duct":0.97}$r$),
    (1500, $r${"depth_mm":1500,"factor_direct_in_ground":0.95,"factor_single_way_duct":0.96}$r$),
    (2000, $r${"depth_mm":2000,"factor_direct_in_ground":0.92,"factor_single_way_duct":0.94}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_4_3_2 — Derating factor — soil thermal resistivity (MV paper)
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_4_3_2',
        'Derating factor — soil thermal resistivity (MV paper)',
        'SANS 97',
        '4.3.2',
        NULL,
        'Multiplier for soil thermal resistivity other than the reference 1.2 K·m/W, SANS 97 paper-insulated MV cable.',
        $cols$[{"key":"resistivity_kmw","label":"Thermal resistivity","unit":"K·m/W","type":"number","align":"right","is_key":true},{"key":"factor_direct_in_ground","label":"Direct in ground","unit":"factor","type":"number","align":"right"},{"key":"factor_single_way_duct","label":"In single-way ducts","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Apply multiplicatively with the other Table 4.3.x derating factors.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 4.3.2'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (1, $r${"resistivity_kmw":1,"factor_direct_in_ground":1.07,"factor_single_way_duct":1.03}$r$),
    (1.2, $r${"resistivity_kmw":1.2,"factor_direct_in_ground":1,"factor_single_way_duct":1}$r$),
    (1.5, $r${"resistivity_kmw":1.5,"factor_direct_in_ground":0.92,"factor_single_way_duct":0.95}$r$),
    (2, $r${"resistivity_kmw":2,"factor_direct_in_ground":0.84,"factor_single_way_duct":0.88}$r$),
    (2.5, $r${"resistivity_kmw":2.5,"factor_direct_in_ground":0.75,"factor_single_way_duct":0.82}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_4_3_3 — Derating factor — grouping by axial spacing (MV paper)
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_4_3_3',
        'Derating factor — grouping by axial spacing (MV paper)',
        'SANS 97',
        '4.3.3',
        NULL,
        'Multiplier for N grouped SANS 97 MV cables, by axial spacing between cables.',
        $cols$[{"key":"n_cables","label":"Number in group","unit":null,"type":"number","decimals":0,"align":"right","is_key":true},{"key":"ground_touching","label":"Ground — touching","unit":"factor","type":"number","align":"right"},{"key":"ground_150mm","label":"Ground — 150 mm","unit":"factor","type":"number","align":"right"},{"key":"ground_300mm","label":"Ground — 300 mm","unit":"factor","type":"number","align":"right"},{"key":"ground_450mm","label":"Ground — 450 mm","unit":"factor","type":"number","align":"right"},{"key":"ground_600mm","label":"Ground — 600 mm","unit":"factor","type":"number","align":"right"},{"key":"duct_touching","label":"Duct — touching","unit":"factor","type":"number","align":"right"},{"key":"duct_300mm","label":"Duct — 300 mm","unit":"factor","type":"number","align":"right"},{"key":"duct_450mm","label":"Duct — 450 mm","unit":"factor","type":"number","align":"right"},{"key":"duct_600mm","label":"Duct — 600 mm","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Direct-in-ground columns: touching / 150 / 300 / 450 / 600 mm. In-duct columns: touching / 300 / 450 / 600 mm.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 4.3.3'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (2, $r${"n_cables":2,"ground_touching":0.8,"ground_150mm":0.85,"ground_300mm":0.89,"ground_450mm":0.9,"ground_600mm":0.92,"duct_touching":0.88,"duct_300mm":0.91,"duct_450mm":0.93,"duct_600mm":0.94}$r$),
    (3, $r${"n_cables":3,"ground_touching":0.69,"ground_150mm":0.75,"ground_300mm":0.8,"ground_450mm":0.84,"ground_600mm":0.86,"duct_touching":0.8,"duct_300mm":0.84,"duct_450mm":0.87,"duct_600mm":0.89}$r$),
    (4, $r${"n_cables":4,"ground_touching":0.63,"ground_150mm":0.7,"ground_300mm":0.77,"ground_450mm":0.8,"ground_600mm":0.84,"duct_touching":0.75,"duct_300mm":0.81,"duct_450mm":0.84,"duct_600mm":0.87}$r$),
    (5, $r${"n_cables":5,"ground_touching":0.57,"ground_150mm":0.66,"ground_300mm":0.73,"ground_450mm":0.78,"ground_600mm":0.81,"duct_touching":0.71,"duct_300mm":0.77,"duct_450mm":0.82,"duct_600mm":0.85}$r$),
    (6, $r${"n_cables":6,"ground_touching":0.55,"ground_150mm":0.63,"ground_300mm":0.71,"ground_450mm":0.76,"ground_600mm":0.8,"duct_touching":0.69,"duct_300mm":0.75,"duct_450mm":0.8,"duct_600mm":0.84}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_4_3_4 — Derating factor — ground temperature (MV paper)
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_4_3_4',
        'Derating factor — ground temperature (MV paper)',
        'SANS 97',
        '4.3.4',
        NULL,
        'Multiplier for ground temperature other than the reference 25 °C. Maximum conductor temperature 70 °C.',
        $cols$[{"key":"ambient_c","label":"Ground temperature","unit":"°C","type":"number","decimals":0,"align":"right","is_key":true},{"key":"factor","label":"Factor","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Source header reads "Groung Temperatures" (workbook typo for ground temperatures).',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 4.3.4'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (25, $r${"ambient_c":25,"factor":1}$r$),
    (30, $r${"ambient_c":30,"factor":0.95}$r$),
    (35, $r${"ambient_c":35,"factor":0.9}$r$),
    (40, $r${"ambient_c":40,"factor":0.85}$r$),
    (45, $r${"ambient_c":45,"factor":0.8}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_4_3_5 — Derating factor — air temperature (MV paper)
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_4_3_5',
        'Derating factor — air temperature (MV paper)',
        'SANS 97',
        '4.3.5',
        NULL,
        'Multiplier for ambient air temperature other than the reference 30 °C. Maximum conductor temperature 70 °C.',
        $cols$[{"key":"ambient_c","label":"Air temperature","unit":"°C","type":"number","decimals":0,"align":"right","is_key":true},{"key":"factor","label":"Factor","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        NULL,
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 4.3.5'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (25, $r${"ambient_c":25,"factor":1.1}$r$),
    (30, $r${"ambient_c":30,"factor":1}$r$),
    (35, $r${"ambient_c":35,"factor":0.94}$r$),
    (40, $r${"ambient_c":40,"factor":0.87}$r$),
    (45, $r${"ambient_c":45,"factor":0.79}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_4_3_6 — Derating factor — soil resistivity by region (MV paper)
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_4_3_6',
        'Derating factor — soil resistivity by region (MV paper)',
        'SANS 97',
        '4.3.6',
        NULL,
        'Regional soil-resistivity multiplier by conductor size band — coastal (1000 Ω·m²) versus highveld (1250 Ω·m²) ground conditions.',
        $cols$[{"key":"size_band","label":"Conductor size band","unit":"mm²","type":"string","align":"left","is_key":true},{"key":"factor_coastal","label":"Coastal (1000 Ω·m²)","unit":"factor","type":"number","align":"right"},{"key":"factor_highveld","label":"Highveld (1250 Ω·m²)","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'sort_key is the lower bound of each size band. The raw workbook sheet bleeds Table 5.2 cable data after these five rows — only the five band rows belong to Table 4.3.6.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 4.3.6'
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
-- TABLE_5_2_1 — Derating factor — depth of laying (MV XLPE)
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_5_2_1',
        'Derating factor — depth of laying (MV XLPE)',
        'SANS 1339',
        '5.2.1',
        NULL,
        'Multiplier applied to the base current rating of a SANS 1339 XLPE MV cable buried within a depth band other than the reference.',
        $cols$[{"key":"depth_band","label":"Depth of laying","unit":"mm","type":"string","align":"left","is_key":true},{"key":"factor_direct_in_ground","label":"Direct in ground","unit":"factor","type":"number","align":"right"},{"key":"factor_single_way_duct","label":"In single-way ducts","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Depth is tabulated as a band; sort_key is the lower bound of each band.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 5.2.1'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (500, $r${"depth_band":"500 - 800","factor_direct_in_ground":1,"factor_single_way_duct":1}$r$),
    (850, $r${"depth_band":"850 - 1000","factor_direct_in_ground":0.97,"factor_single_way_duct":0.96}$r$),
    (1050, $r${"depth_band":"1050 - 1200","factor_direct_in_ground":0.95,"factor_single_way_duct":0.95}$r$),
    (1250, $r${"depth_band":"1250 - 1400","factor_direct_in_ground":0.93,"factor_single_way_duct":0.95}$r$),
    (1450, $r${"depth_band":"1450 - 1600","factor_direct_in_ground":0.92,"factor_single_way_duct":0.94}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_5_2_2 — Derating factor — soil thermal resistivity (MV XLPE)
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_5_2_2',
        'Derating factor — soil thermal resistivity (MV XLPE)',
        'SANS 1339',
        '5.2.2',
        NULL,
        'Multiplier for soil thermal resistivity other than the reference 1.2 K·m/W, SANS 1339 XLPE MV cable.',
        $cols$[{"key":"resistivity_kmw","label":"Thermal resistivity","unit":"K·m/W","type":"number","align":"right","is_key":true},{"key":"factor_direct_in_ground","label":"Direct in ground","unit":"factor","type":"number","align":"right"},{"key":"factor_single_way_duct","label":"In single-way ducts","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Apply multiplicatively with the other Table 5.2.x derating factors.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 5.2.2'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (0.7, $r${"resistivity_kmw":0.7,"factor_direct_in_ground":1.23,"factor_single_way_duct":1.28}$r$),
    (1, $r${"resistivity_kmw":1,"factor_direct_in_ground":1.08,"factor_single_way_duct":1.12}$r$),
    (1.2, $r${"resistivity_kmw":1.2,"factor_direct_in_ground":1,"factor_single_way_duct":1}$r$),
    (1.5, $r${"resistivity_kmw":1.5,"factor_direct_in_ground":0.9,"factor_single_way_duct":0.93}$r$),
    (2, $r${"resistivity_kmw":2,"factor_direct_in_ground":0.8,"factor_single_way_duct":0.85}$r$),
    (2.5, $r${"resistivity_kmw":2.5,"factor_direct_in_ground":0.72,"factor_single_way_duct":0.8}$r$),
    (3, $r${"resistivity_kmw":3,"factor_direct_in_ground":0.66,"factor_single_way_duct":0.74}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_5_2_3 — Derating factor — grouping by axial spacing (MV XLPE)
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_5_2_3',
        'Derating factor — grouping by axial spacing (MV XLPE)',
        'SANS 1339',
        '5.2.3',
        NULL,
        'Multiplier for N grouped SANS 1339 MV cables, by axial spacing between cables.',
        $cols$[{"key":"n_cables","label":"Number in group","unit":null,"type":"number","decimals":0,"align":"right","is_key":true},{"key":"ground_touching","label":"Ground — touching","unit":"factor","type":"number","align":"right"},{"key":"ground_250mm","label":"Ground — 250 mm","unit":"factor","type":"number","align":"right"},{"key":"ground_700mm","label":"Ground — 700 mm","unit":"factor","type":"number","align":"right"},{"key":"duct_touching","label":"Duct — touching","unit":"factor","type":"number","align":"right"},{"key":"duct_250mm","label":"Duct — 250 mm","unit":"factor","type":"number","align":"right"},{"key":"duct_700mm","label":"Duct — 700 mm","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Direct-in-ground and in-duct columns: touching / 250 / 700 mm spacing.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 5.2.3'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (2, $r${"n_cables":2,"ground_touching":0.79,"ground_250mm":0.85,"ground_700mm":0.87,"duct_touching":0.87,"duct_250mm":0.91,"duct_700mm":0.93}$r$),
    (3, $r${"n_cables":3,"ground_touching":0.69,"ground_250mm":0.75,"ground_700mm":0.79,"duct_touching":0.8,"duct_250mm":0.86,"duct_700mm":0.91}$r$),
    (4, $r${"n_cables":4,"ground_touching":0.63,"ground_250mm":0.68,"ground_700mm":0.75,"duct_touching":0.75,"duct_250mm":0.8,"duct_700mm":0.87}$r$),
    (5, $r${"n_cables":5,"ground_touching":0.58,"ground_250mm":0.64,"ground_700mm":0.72,"duct_touching":0.72,"duct_250mm":0.78,"duct_700mm":0.86}$r$),
    (6, $r${"n_cables":6,"ground_touching":0.55,"ground_250mm":0.6,"ground_700mm":0.69,"duct_touching":0.69,"duct_250mm":0.74,"duct_700mm":0.83}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_5_2_4 — Derating factor — air temperature, 25–45 °C (MV XLPE)
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_5_2_4',
        'Derating factor — air temperature, 25–45 °C (MV XLPE)',
        'SANS 1339',
        '5.2.4',
        NULL,
        'Source header: "Maximum Conductor Temperature (90 °C) — Air Temperatures". Multiplier for ambient temperature across the 25–45 °C range.',
        $cols$[{"key":"ambient_c","label":"Air temperature","unit":"°C","type":"number","decimals":0,"align":"right","is_key":true},{"key":"factor","label":"Factor","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        NULL,
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 5.2.4'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (25, $r${"ambient_c":25,"factor":1}$r$),
    (30, $r${"ambient_c":30,"factor":0.96}$r$),
    (35, $r${"ambient_c":35,"factor":0.92}$r$),
    (40, $r${"ambient_c":40,"factor":0.88}$r$),
    (45, $r${"ambient_c":45,"factor":0.84}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_5_2_5 — Derating factor — air temperature, 30–50 °C (MV XLPE)
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_5_2_5',
        'Derating factor — air temperature, 30–50 °C (MV XLPE)',
        'SANS 1339',
        '5.2.5',
        NULL,
        'Source header: "Maximum Conductor Temperature (90 °C) — Air Temperatures". Multiplier for ambient temperature across the 30–50 °C range.',
        $cols$[{"key":"ambient_c","label":"Air temperature","unit":"°C","type":"number","decimals":0,"align":"right","is_key":true},{"key":"factor","label":"Factor","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        NULL,
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 5.2.5'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (30, $r${"ambient_c":30,"factor":1}$r$),
    (35, $r${"ambient_c":35,"factor":0.95}$r$),
    (40, $r${"ambient_c":40,"factor":0.89}$r$),
    (45, $r${"ambient_c":45,"factor":0.84}$r$),
    (50, $r${"ambient_c":50,"factor":0.78}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_5_2_6 — Derating factor — soil resistivity by region (MV XLPE)
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_5_2_6',
        'Derating factor — soil resistivity by region (MV XLPE)',
        'SANS 1339',
        '5.2.6',
        NULL,
        'Regional soil-resistivity multiplier by conductor size band — coastal (1000 Ω·m²) versus highveld (1250 Ω·m²) ground conditions.',
        $cols$[{"key":"size_band","label":"Conductor size band","unit":"mm²","type":"string","align":"left","is_key":true},{"key":"factor_coastal","label":"Coastal (1000 Ω·m²)","unit":"factor","type":"number","align":"right"},{"key":"factor_highveld","label":"Highveld (1250 Ω·m²)","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'sort_key is the lower bound of each size band.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 5.2.6'
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
    (120, $r${"size_band":"120 - 185","factor_coastal":0.6,"factor_highveld":0.49}$r$),
    (240, $r${"size_band":"240 - 400","factor_coastal":0.59,"factor_highveld":0.44}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_6_9 — Conductor temperature limits and short-circuit k-factors
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_9',
        'Conductor temperature limits and short-circuit k-factors',
        'SANS 1507-3 / 1507-4',
        '6.9',
        NULL,
        'Maximum normal-operating and short-circuit conductor temperatures, and the adiabatic short-circuit k-factor, by insulation and conductor material.',
        $cols$[{"key":"insulation","label":"Insulation","unit":null,"type":"string","align":"left","is_key":true},{"key":"conductor","label":"Conductor","unit":null,"type":"string","align":"left"},{"key":"max_operating_temp_c","label":"Max operating temp","unit":"°C","type":"number","decimals":0,"align":"right"},{"key":"max_short_circuit_temp_c","label":"Max short-circuit temp","unit":"°C","type":"number","decimals":0,"align":"right"},{"key":"k_factor","label":"Short-circuit k-factor","unit":null,"type":"number","decimals":0,"align":"right"}]$cols$::jsonb,
        'The raw workbook sheet supplied this table without column headers. Column meanings inferred from the values: 70/90 °C are the standard PVC/XLPE maximum operating temperatures, 160/250 °C the short-circuit limits, and 115/76/143/92 the adiabatic k constants (I²t = k²·S²).',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 6.9'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (1, $r${"insulation":"PVC","conductor":"Copper","max_operating_temp_c":70,"max_short_circuit_temp_c":160,"k_factor":115}$r$),
    (2, $r${"insulation":"PVC","conductor":"Aluminium","max_operating_temp_c":70,"max_short_circuit_temp_c":160,"k_factor":76}$r$),
    (3, $r${"insulation":"XLPE","conductor":"Copper","max_operating_temp_c":90,"max_short_circuit_temp_c":250,"k_factor":143}$r$),
    (4, $r${"insulation":"XLPE","conductor":"Aluminium","max_operating_temp_c":90,"max_short_circuit_temp_c":250,"k_factor":92}$r$)
) AS v(sort_key, row_data);

NOTIFY pgrst, 'reload schema';
