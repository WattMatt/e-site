-- =============================================================================
-- Migration 00056 — SANS reference library: bootstrap seed (10 tables)
-- =============================================================================
-- Seeds the SANS reference library from the firm's verified FACTS AND FIGURES
-- workbook (CABLE SCHEDULE PMM.xlsx). Ten tables, transcribed and structured
-- against /sans-bootstrap/sans_reference_schema.json:
--
--   TABLE_4_2    SANS 97      3-core PILC/STA 6.35/11 kV (Cu + Al)
--   TABLE_5_2    SANS 1339    3-core XLPE/SWA 6.35/11 kV (Cu + Al)
--   TABLE_6_2    SANS 1507-3  PVC/SWA 600/1000 V copper
--   TABLE_6_3    SANS 1507-3  PVC/SWA 600/1000 V aluminium
--   TABLE_6_3_1  SANS 1507    Derating — depth of laying
--   TABLE_6_6    SANS 1507-3  single-core unarmoured PVC 600/1000 V copper
--   TABLE_6_4    SANS 1507-4  XLPE/SWA 600/1000 V copper
--   TABLE_6_5    SANS 1507-4  XLPE/SWA 600/1000 V aluminium
--   TABLE_6_7    SANS 1507-4  single-core unarmoured XLPE 600/1000 V copper
--   TABLE_9_1    SANS 10142-1 Earth conductor (header only — rows TBC)
--
-- Migration 00053 shipped hand-typed placeholders for TABLE_6_4 and
-- TABLE_6_3_1 ("More tables land via follow-up seed migrations as the data
-- is transcribed..."). This migration supersedes both with the verified
-- workbook data, carrying the source-workbook column headings per spec §10.
-- Derating Tables 6.3.2–6.3.5 from 00053 are left untouched — they have no
-- bootstrap equivalent and the derating calculation still reads them.
--
-- Idempotent: deletes the 10 codes first (sans_rows cascade) then re-inserts.
-- =============================================================================

DELETE FROM cable_schedule.sans_tables WHERE code IN (
    'TABLE_4_2', 'TABLE_5_2', 'TABLE_6_2', 'TABLE_6_3', 'TABLE_6_3_1', 'TABLE_6_6', 'TABLE_6_4', 'TABLE_6_5', 'TABLE_6_7', 'TABLE_9_1'
);

-- --------------------------------------------------------------------------
-- TABLE_4_2 — Electrical and Physical Properties of 3-core Paper Insulated Lead Covered Double Steel Tape Armoured Jute Served 6.35/11 kV cables
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_4_2',
        'Electrical and Physical Properties of 3-core Paper Insulated Lead Covered Double Steel Tape Armoured Jute Served 6.35/11 kV cables',
        'SANS 97',
        '4.2',
        '3-core PAPER STA copper / aluminium',
        'to SANS 97 Table 17 (General purpose belted)',
        $cols$[{"key":"size_mm2","label":"Cable Size","unit":"mm²","type":"number","decimals":0,"align":"right","is_key":true},{"key":"cu_current_rating_ground_a","label":"Cu — Current rating (Ground)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"cu_impedance_ohm_per_km","label":"Cu — Impedance","unit":"Ω/km","type":"number","align":"right"},{"key":"cu_short_circuit_1s_ka","label":"Cu — 1 second short circuit rating","unit":"kA","type":"number","align":"right"},{"key":"cu_diameter_over_lead_mm","label":"Cu — Diameter over lead","unit":"mm","type":"number","align":"right"},{"key":"cu_mass_kg_per_km","label":"Cu — Approx. Cable Mass","unit":"kg/km","type":"number","decimals":0,"align":"right"},{"key":"al_current_rating_ground_a","label":"Al — Current rating (Ground)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"al_impedance_ohm_per_km","label":"Al — Impedance","unit":"Ω/km","type":"number","align":"right"},{"key":"al_short_circuit_1s_ka","label":"Al — 1 second short circuit rating","unit":"kA","type":"number","align":"right"},{"key":"al_diameter_over_lead_mm","label":"Al — Diameter over lead","unit":"mm","type":"number","align":"right"},{"key":"al_mass_kg_per_km","label":"Al — Approx. Cable Mass","unit":"kg/km","type":"number","decimals":0,"align":"right"}]$cols$::jsonb,
        'Current ratings are for direct burial in ground at standard conditions. Apply derating factors from Tables 4.3.1–4.3.6 for non-standard conditions.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, rows 11–20'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (25, $r${"size_mm2":25,"cu_current_rating_ground_a":105,"cu_impedance_ohm_per_km":0.8779,"cu_short_circuit_1s_ka":2.875,"cu_diameter_over_lead_mm":31.38,"cu_mass_kg_per_km":4890,"al_current_rating_ground_a":80,"al_impedance_ohm_per_km":1.4421,"al_short_circuit_1s_ka":1.9,"al_diameter_over_lead_mm":31.38,"al_mass_kg_per_km":4415}$r$),
    (35, $r${"size_mm2":35,"cu_current_rating_ground_a":130,"cu_impedance_ohm_per_km":0.6371,"cu_short_circuit_1s_ka":4.025,"cu_diameter_over_lead_mm":33.64,"cu_mass_kg_per_km":5710,"al_current_rating_ground_a":100,"al_impedance_ohm_per_km":1.0492,"al_short_circuit_1s_ka":2.66,"al_diameter_over_lead_mm":33.64,"al_mass_kg_per_km":5055}$r$),
    (50, $r${"size_mm2":50,"cu_current_rating_ground_a":160,"cu_impedance_ohm_per_km":0.4751,"cu_short_circuit_1s_ka":5.75,"cu_diameter_over_lead_mm":33.49,"cu_mass_kg_per_km":6020,"al_current_rating_ground_a":125,"al_impedance_ohm_per_km":0.7777,"al_short_circuit_1s_ka":3.8,"al_diameter_over_lead_mm":33.49,"al_mass_kg_per_km":5195}$r$),
    (70, $r${"size_mm2":70,"cu_current_rating_ground_a":195,"cu_impedance_ohm_per_km":0.3365,"cu_short_circuit_1s_ka":8.05,"cu_diameter_over_lead_mm":36.5,"cu_mass_kg_per_km":7080,"al_current_rating_ground_a":155,"al_impedance_ohm_per_km":0.5423,"al_short_circuit_1s_ka":5.32,"al_diameter_over_lead_mm":36.5,"al_mass_kg_per_km":5790}$r$),
    (95, $r${"size_mm2":95,"cu_current_rating_ground_a":235,"cu_impedance_ohm_per_km":0.2499,"cu_short_circuit_1s_ka":10.925,"cu_diameter_over_lead_mm":39.33,"cu_mass_kg_per_km":8260,"al_current_rating_ground_a":185,"al_impedance_ohm_per_km":0.3972,"al_short_circuit_1s_ka":7.22,"al_diameter_over_lead_mm":39.33,"al_mass_kg_per_km":6505}$r$),
    (120, $r${"size_mm2":120,"cu_current_rating_ground_a":265,"cu_impedance_ohm_per_km":0.253,"cu_short_circuit_1s_ka":13.8,"cu_diameter_over_lead_mm":41.72,"cu_mass_kg_per_km":9440,"al_current_rating_ground_a":210,"al_impedance_ohm_per_km":0.3183,"al_short_circuit_1s_ka":9.12,"al_diameter_over_lead_mm":41.73,"al_mass_kg_per_km":7225}$r$),
    (150, $r${"size_mm2":150,"cu_current_rating_ground_a":295,"cu_impedance_ohm_per_km":0.1739,"cu_short_circuit_1s_ka":17.25,"cu_diameter_over_lead_mm":44.36,"cu_mass_kg_per_km":10770,"al_current_rating_ground_a":235,"al_impedance_ohm_per_km":0.264,"al_short_circuit_1s_ka":11.4,"al_diameter_over_lead_mm":44.36,"al_mass_kg_per_km":7980}$r$),
    (185, $r${"size_mm2":185,"cu_current_rating_ground_a":335,"cu_impedance_ohm_per_km":0.1481,"cu_short_circuit_1s_ka":21.275,"cu_diameter_over_lead_mm":47.42,"cu_mass_kg_per_km":12290,"al_current_rating_ground_a":265,"al_impedance_ohm_per_km":0.2166,"al_short_circuit_1s_ka":14.06,"al_diameter_over_lead_mm":47.42,"al_mass_kg_per_km":8870}$r$),
    (240, $r${"size_mm2":240,"cu_current_rating_ground_a":380,"cu_impedance_ohm_per_km":0.1245,"cu_short_circuit_1s_ka":27.6,"cu_diameter_over_lead_mm":52.14,"cu_mass_kg_per_km":14480,"al_current_rating_ground_a":305,"al_impedance_ohm_per_km":0.1734,"al_short_circuit_1s_ka":18.24,"al_diameter_over_lead_mm":52.14,"al_mass_kg_per_km":10050}$r$),
    (300, $r${"size_mm2":300,"cu_current_rating_ground_a":425,"cu_impedance_ohm_per_km":0.1106,"cu_short_circuit_1s_ka":34.5,"cu_diameter_over_lead_mm":56.15,"cu_mass_kg_per_km":16940,"al_current_rating_ground_a":340,"al_impedance_ohm_per_km":0.1472,"al_short_circuit_1s_ka":22.8,"al_diameter_over_lead_mm":56.15,"al_mass_kg_per_km":11415}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_5_2 — Electrical and Physical Properties of 3-core XLPE Insulated PVC Bedded SWA PVC Sheathed 6.35/11 kV cables
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_5_2',
        'Electrical and Physical Properties of 3-core XLPE Insulated PVC Bedded SWA PVC Sheathed 6.35/11 kV cables',
        'SANS 1339',
        '5.2',
        '3-core XLPE SWA copper / aluminium',
        'to SANS 1339 Type A (Individually screened)',
        $cols$[{"key":"size_mm2","label":"Cable Size","unit":"mm²","type":"number","decimals":0,"align":"right","is_key":true},{"key":"cu_current_rating_ground_a","label":"Cu — Current rating (Ground)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"cu_impedance_ohm_per_km","label":"Cu — Impedance","unit":"Ω/km","type":"number","align":"right"},{"key":"cu_short_circuit_1s_ka","label":"Cu — 1s short circuit rating","unit":"kA","type":"number","align":"right"},{"key":"cu_diameter_over_lead_mm","label":"Cu — Diameter over lead","unit":"mm","type":"number","align":"right"},{"key":"cu_mass_kg_per_km","label":"Cu — Approx. Cable Mass","unit":"kg/km","type":"number","decimals":0,"align":"right"},{"key":"al_current_rating_ground_a","label":"Al — Current rating (Ground)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"al_impedance_ohm_per_km","label":"Al — Impedance","unit":"Ω/km","type":"number","align":"right"},{"key":"al_short_circuit_1s_ka","label":"Al — 1s short circuit rating","unit":"kA","type":"number","align":"right"},{"key":"al_diameter_over_lead_mm","label":"Al — Diameter over lead","unit":"mm","type":"number","align":"right"},{"key":"al_mass_kg_per_km","label":"Al — Approx. Cable Mass","unit":"kg/km","type":"number","decimals":0,"align":"right"}]$cols$::jsonb,
        'Aluminium values not published for 25 mm² and 35 mm² in source table.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, rows 76–85'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (25, $r${"size_mm2":25,"cu_current_rating_ground_a":140,"cu_impedance_ohm_per_km":0.9353,"cu_short_circuit_1s_ka":3.575,"cu_diameter_over_lead_mm":47.3,"cu_mass_kg_per_km":4655,"al_current_rating_ground_a":null,"al_impedance_ohm_per_km":null,"al_short_circuit_1s_ka":null,"al_diameter_over_lead_mm":null,"al_mass_kg_per_km":null}$r$),
    (35, $r${"size_mm2":35,"cu_current_rating_ground_a":170,"cu_impedance_ohm_per_km":0.6783,"cu_short_circuit_1s_ka":5.005,"cu_diameter_over_lead_mm":49.7,"cu_mass_kg_per_km":5215,"al_current_rating_ground_a":null,"al_impedance_ohm_per_km":null,"al_short_circuit_1s_ka":null,"al_diameter_over_lead_mm":null,"al_mass_kg_per_km":null}$r$),
    (50, $r${"size_mm2":50,"cu_current_rating_ground_a":200,"cu_impedance_ohm_per_km":0.5067,"cu_short_circuit_1s_ka":7.15,"cu_diameter_over_lead_mm":52.6,"cu_mass_kg_per_km":5895,"al_current_rating_ground_a":155,"al_impedance_ohm_per_km":0.8284,"al_short_circuit_1s_ka":4.6,"al_diameter_over_lead_mm":52.6,"al_mass_kg_per_km":5015}$r$),
    (70, $r${"size_mm2":70,"cu_current_rating_ground_a":240,"cu_impedance_ohm_per_km":0.3581,"cu_short_circuit_1s_ka":10.01,"cu_diameter_over_lead_mm":56.3,"cu_mass_kg_per_km":6995,"al_current_rating_ground_a":190,"al_impedance_ohm_per_km":0.5767,"al_short_circuit_1s_ka":6.44,"al_diameter_over_lead_mm":56.3,"al_mass_kg_per_km":5635}$r$),
    (95, $r${"size_mm2":95,"cu_current_rating_ground_a":290,"cu_impedance_ohm_per_km":0.2665,"cu_short_circuit_1s_ka":13.585,"cu_diameter_over_lead_mm":60.5,"cu_mass_kg_per_km":8170,"al_current_rating_ground_a":225,"al_impedance_ohm_per_km":0.4213,"al_short_circuit_1s_ka":8.74,"al_diameter_over_lead_mm":60.5,"al_mass_kg_per_km":6340}$r$),
    (120, $r${"size_mm2":120,"cu_current_rating_ground_a":325,"cu_impedance_ohm_per_km":0.2187,"cu_short_circuit_1s_ka":17.16,"cu_diameter_over_lead_mm":64.2,"cu_mass_kg_per_km":9370,"al_current_rating_ground_a":255,"al_impedance_ohm_per_km":0.3375,"al_short_circuit_1s_ka":11.04,"al_diameter_over_lead_mm":64.2,"al_mass_kg_per_km":7045}$r$),
    (150, $r${"size_mm2":150,"cu_current_rating_ground_a":360,"cu_impedance_ohm_per_km":0.1847,"cu_short_circuit_1s_ka":21.45,"cu_diameter_over_lead_mm":68.8,"cu_mass_kg_per_km":11240,"al_current_rating_ground_a":285,"al_impedance_ohm_per_km":0.2795,"al_short_circuit_1s_ka":13.8,"al_diameter_over_lead_mm":68.8,"al_mass_kg_per_km":8350}$r$),
    (185, $r${"size_mm2":185,"cu_current_rating_ground_a":410,"cu_impedance_ohm_per_km":0.1571,"cu_short_circuit_1s_ka":26.455,"cu_diameter_over_lead_mm":72.8,"cu_mass_kg_per_km":12775,"al_current_rating_ground_a":320,"al_impedance_ohm_per_km":0.2285,"al_short_circuit_1s_ka":17.02,"al_diameter_over_lead_mm":72.8,"al_mass_kg_per_km":9245}$r$),
    (240, $r${"size_mm2":240,"cu_current_rating_ground_a":470,"cu_impedance_ohm_per_km":0.1317,"cu_short_circuit_1s_ka":34.32,"cu_diameter_over_lead_mm":79.1,"cu_mass_kg_per_km":14955,"al_current_rating_ground_a":370,"al_impedance_ohm_per_km":0.1821,"al_short_circuit_1s_ka":22.08,"al_diameter_over_lead_mm":79.1,"al_mass_kg_per_km":10580}$r$),
    (300, $r${"size_mm2":300,"cu_current_rating_ground_a":520,"cu_impedance_ohm_per_km":0.116,"cu_short_circuit_1s_ka":42.9,"cu_diameter_over_lead_mm":85.6,"cu_mass_kg_per_km":17865,"al_current_rating_ground_a":420,"al_impedance_ohm_per_km":0.1535,"al_short_circuit_1s_ka":27.6,"al_diameter_over_lead_mm":85.6,"al_mass_kg_per_km":12070}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_6_2 — Electrical and Physical Properties of PVC CU cables 600/1000 V
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_2',
        'Electrical and Physical Properties of PVC CU cables 600/1000 V',
        'SANS 1507-3',
        '6.2',
        '3/4-core PVC SWA copper',
        NULL,
        $cols$[{"key":"size_mm2","label":"Cable Size","unit":"mm²","type":"number","align":"right","is_key":true},{"key":"current_rating_ground_a","label":"Current Rating, Ground","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_duct_a","label":"Current Rating, Ducts","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_air_a","label":"Current Rating, Air","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"impedance_ohm_per_km","label":"Impedance","unit":"Ω/km","type":"number","align":"right"},{"key":"volt_drop_3ph_mv_per_a_per_m","label":"3φ Volt drop","unit":"mV/A/m","type":"number","align":"right"},{"key":"volt_drop_1ph_mv_per_a_per_m","label":"1φ Volt drop","unit":"mV/A/m","type":"number","align":"right"},{"key":"dim_d1_3c_mm","label":"D1 (3-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d1_4c_mm","label":"D1 (4-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d_3c_mm","label":"d (3-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d_4c_mm","label":"d (4-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d2_3c_mm","label":"D2 (3-core)","unit":"mm","type":"number","align":"right"}]$cols$::jsonb,
        NULL,
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (1.5, $r${"size_mm2":1.5,"current_rating_ground_a":24,"current_rating_duct_a":20,"current_rating_air_a":19,"impedance_ohm_per_km":14.48,"volt_drop_3ph_mv_per_a_per_m":25.08,"volt_drop_1ph_mv_per_a_per_m":28.956,"dim_d1_3c_mm":8.51,"dim_d1_4c_mm":9.33,"dim_d_3c_mm":1.25,"dim_d_4c_mm":1.25,"dim_d2_3c_mm":14.13}$r$),
    (2.5, $r${"size_mm2":2.5,"current_rating_ground_a":32,"current_rating_duct_a":26,"current_rating_air_a":26,"impedance_ohm_per_km":8.87,"volt_drop_3ph_mv_per_a_per_m":15.636,"volt_drop_1ph_mv_per_a_per_m":17.734,"dim_d1_3c_mm":9.61,"dim_d1_4c_mm":10.56,"dim_d_3c_mm":1.25,"dim_d_4c_mm":1.25,"dim_d2_3c_mm":15.23}$r$),
    (4, $r${"size_mm2":4,"current_rating_ground_a":42,"current_rating_duct_a":34,"current_rating_air_a":35,"impedance_ohm_per_km":5.52,"volt_drop_3ph_mv_per_a_per_m":9.561,"volt_drop_1ph_mv_per_a_per_m":11.034,"dim_d1_3c_mm":11.4,"dim_d1_4c_mm":12.57,"dim_d_3c_mm":1.25,"dim_d_4c_mm":1.25,"dim_d2_3c_mm":17.02}$r$),
    (6, $r${"size_mm2":6,"current_rating_ground_a":53,"current_rating_duct_a":43,"current_rating_air_a":45,"impedance_ohm_per_km":3.69,"volt_drop_3ph_mv_per_a_per_m":6.391,"volt_drop_1ph_mv_per_a_per_m":7.374,"dim_d1_3c_mm":12.58,"dim_d1_4c_mm":13.9,"dim_d_3c_mm":1.25,"dim_d_4c_mm":1.25,"dim_d2_3c_mm":18.4}$r$),
    (10, $r${"size_mm2":10,"current_rating_ground_a":70,"current_rating_duct_a":58,"current_rating_air_a":62,"impedance_ohm_per_km":2.19,"volt_drop_3ph_mv_per_a_per_m":3.793,"volt_drop_1ph_mv_per_a_per_m":4.384,"dim_d1_3c_mm":14.59,"dim_d1_4c_mm":16.14,"dim_d_3c_mm":1.25,"dim_d_4c_mm":1.25,"dim_d2_3c_mm":20.41}$r$),
    (16, $r${"size_mm2":16,"current_rating_ground_a":91,"current_rating_duct_a":75,"current_rating_air_a":83,"impedance_ohm_per_km":1.38,"volt_drop_3ph_mv_per_a_per_m":2.39,"volt_drop_1ph_mv_per_a_per_m":2.759,"dim_d1_3c_mm":16.55,"dim_d1_4c_mm":19.18,"dim_d_3c_mm":1.25,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":22.37}$r$),
    (25, $r${"size_mm2":25,"current_rating_ground_a":119,"current_rating_duct_a":96,"current_rating_air_a":110,"impedance_ohm_per_km":0.8749,"volt_drop_3ph_mv_per_a_per_m":1.515,"volt_drop_1ph_mv_per_a_per_m":1.749,"dim_d1_3c_mm":19.46,"dim_d1_4c_mm":21.34,"dim_d_3c_mm":1.6,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":26.46}$r$),
    (35, $r${"size_mm2":35,"current_rating_ground_a":143,"current_rating_duct_a":116,"current_rating_air_a":135,"impedance_ohm_per_km":0.6335,"volt_drop_3ph_mv_per_a_per_m":1.097,"volt_drop_1ph_mv_per_a_per_m":1.267,"dim_d1_3c_mm":20.89,"dim_d1_4c_mm":23.97,"dim_d_3c_mm":1.6,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":27.89}$r$),
    (50, $r${"size_mm2":50,"current_rating_ground_a":169,"current_rating_duct_a":138,"current_rating_air_a":163,"impedance_ohm_per_km":0.4718,"volt_drop_3ph_mv_per_a_per_m":0.817,"volt_drop_1ph_mv_per_a_per_m":0.944,"dim_d1_3c_mm":24.26,"dim_d1_4c_mm":28.14,"dim_d_3c_mm":1.6,"dim_d_4c_mm":2,"dim_d2_3c_mm":31.46}$r$),
    (70, $r${"size_mm2":70,"current_rating_ground_a":210,"current_rating_duct_a":171,"current_rating_air_a":207,"impedance_ohm_per_km":0.3325,"volt_drop_3ph_mv_per_a_per_m":0.576,"volt_drop_1ph_mv_per_a_per_m":0.665,"dim_d1_3c_mm":27.07,"dim_d1_4c_mm":31.29,"dim_d_3c_mm":2,"dim_d_4c_mm":2,"dim_d2_3c_mm":35.47}$r$),
    (95, $r${"size_mm2":95,"current_rating_ground_a":251,"current_rating_duct_a":205,"current_rating_air_a":251,"impedance_ohm_per_km":0.246,"volt_drop_3ph_mv_per_a_per_m":0.427,"volt_drop_1ph_mv_per_a_per_m":0.492,"dim_d1_3c_mm":31.19,"dim_d1_4c_mm":35.82,"dim_d_3c_mm":2,"dim_d_4c_mm":2,"dim_d2_3c_mm":39.99}$r$),
    (120, $r${"size_mm2":120,"current_rating_ground_a":285,"current_rating_duct_a":234,"current_rating_air_a":290,"impedance_ohm_per_km":0.2012,"volt_drop_3ph_mv_per_a_per_m":0.348,"volt_drop_1ph_mv_per_a_per_m":0.402,"dim_d1_3c_mm":33.38,"dim_d1_4c_mm":38.1,"dim_d_3c_mm":2,"dim_d_4c_mm":2,"dim_d2_3c_mm":42.18}$r$),
    (150, $r${"size_mm2":150,"current_rating_ground_a":320,"current_rating_duct_a":263,"current_rating_air_a":332,"impedance_ohm_per_km":0.1698,"volt_drop_3ph_mv_per_a_per_m":0.294,"volt_drop_1ph_mv_per_a_per_m":0.339,"dim_d1_3c_mm":36.68,"dim_d1_4c_mm":42.05,"dim_d_3c_mm":2,"dim_d_4c_mm":2.5,"dim_d2_3c_mm":45.98}$r$),
    (185, $r${"size_mm2":185,"current_rating_ground_a":361,"current_rating_duct_a":298,"current_rating_air_a":378,"impedance_ohm_per_km":0.1445,"volt_drop_3ph_mv_per_a_per_m":0.25,"volt_drop_1ph_mv_per_a_per_m":0.289,"dim_d1_3c_mm":40.82,"dim_d1_4c_mm":46.75,"dim_d_3c_mm":2.5,"dim_d_4c_mm":2.5,"dim_d2_3c_mm":51.12}$r$),
    (240, $r${"size_mm2":240,"current_rating_ground_a":416,"current_rating_duct_a":344,"current_rating_air_a":445,"impedance_ohm_per_km":0.122,"volt_drop_3ph_mv_per_a_per_m":0.211,"volt_drop_1ph_mv_per_a_per_m":0.244,"dim_d1_3c_mm":46.43,"dim_d1_4c_mm":53.06,"dim_d_3c_mm":2.5,"dim_d_4c_mm":2.5,"dim_d2_3c_mm":57.13}$r$),
    (300, $r${"size_mm2":300,"current_rating_ground_a":465,"current_rating_duct_a":385,"current_rating_air_a":510,"impedance_ohm_per_km":0.109,"volt_drop_3ph_mv_per_a_per_m":0.189,"volt_drop_1ph_mv_per_a_per_m":0.218,"dim_d1_3c_mm":51.1,"dim_d1_4c_mm":58.53,"dim_d_3c_mm":2.5,"dim_d_4c_mm":2.5,"dim_d2_3c_mm":62.2}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_6_3 — Electrical and Physical Properties of PVC AL cables 600/1000 V
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_3',
        'Electrical and Physical Properties of PVC AL cables 600/1000 V',
        'SANS 1507-3',
        '6.3',
        '3/4-core PVC SWA aluminium',
        NULL,
        $cols$[{"key":"size_mm2","label":"Cable Size","unit":"mm²","type":"number","align":"right","is_key":true},{"key":"current_rating_ground_a","label":"Current Rating, Ground","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_duct_a","label":"Current Rating, Ducts","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_air_a","label":"Current Rating, Air","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"impedance_ohm_per_km","label":"Impedance","unit":"Ω/km","type":"number","align":"right"},{"key":"volt_drop_3ph_mv_per_a_per_m","label":"3φ Volt drop","unit":"mV/A/m","type":"number","align":"right"},{"key":"volt_drop_1ph_mv_per_a_per_m","label":"1φ Volt drop","unit":"mV/A/m","type":"number","align":"right"},{"key":"dim_d1_3c_mm","label":"D1 (3-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d1_4c_mm","label":"D1 (4-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d_3c_mm","label":"d (3-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d_4c_mm","label":"d (4-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d2_3c_mm","label":"D2 (3-core)","unit":"mm","type":"number","align":"right"}]$cols$::jsonb,
        NULL,
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (25, $r${"size_mm2":25,"current_rating_ground_a":90,"current_rating_duct_a":73,"current_rating_air_a":80,"impedance_ohm_per_km":1.4446,"volt_drop_3ph_mv_per_a_per_m":2.502,"volt_drop_1ph_mv_per_a_per_m":2.889,"dim_d1_3c_mm":17.76,"dim_d1_4c_mm":20.65,"dim_d_3c_mm":1.6,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":24.76}$r$),
    (35, $r${"size_mm2":35,"current_rating_ground_a":108,"current_rating_duct_a":87,"current_rating_air_a":99,"impedance_ohm_per_km":1.0465,"volt_drop_3ph_mv_per_a_per_m":1.813,"volt_drop_1ph_mv_per_a_per_m":2.093,"dim_d1_3c_mm":19.33,"dim_d1_4c_mm":21.93,"dim_d_3c_mm":1.6,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":26.33}$r$),
    (50, $r${"size_mm2":50,"current_rating_ground_a":129,"current_rating_duct_a":104,"current_rating_air_a":119,"impedance_ohm_per_km":0.7749,"volt_drop_3ph_mv_per_a_per_m":1.342,"volt_drop_1ph_mv_per_a_per_m":1.549,"dim_d1_3c_mm":21.87,"dim_d1_4c_mm":25.05,"dim_d_3c_mm":1.6,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":29.07}$r$),
    (70, $r${"size_mm2":70,"current_rating_ground_a":158,"current_rating_duct_a":130,"current_rating_air_a":151,"impedance_ohm_per_km":0.5388,"volt_drop_3ph_mv_per_a_per_m":0.933,"volt_drop_1ph_mv_per_a_per_m":1.078,"dim_d1_3c_mm":24.76,"dim_d1_4c_mm":29.27,"dim_d_3c_mm":1.6,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":31.96}$r$),
    (95, $r${"size_mm2":95,"current_rating_ground_a":192,"current_rating_duct_a":157,"current_rating_air_a":186,"impedance_ohm_per_km":0.3934,"volt_drop_3ph_mv_per_a_per_m":0.681,"volt_drop_1ph_mv_per_a_per_m":0.787,"dim_d1_3c_mm":28.68,"dim_d1_4c_mm":33.73,"dim_d_3c_mm":2,"dim_d_4c_mm":2,"dim_d2_3c_mm":37.08}$r$),
    (120, $r${"size_mm2":120,"current_rating_ground_a":219,"current_rating_duct_a":179,"current_rating_air_a":216,"impedance_ohm_per_km":0.3148,"volt_drop_3ph_mv_per_a_per_m":0.545,"volt_drop_1ph_mv_per_a_per_m":0.629,"dim_d1_3c_mm":31.09,"dim_d1_4c_mm":35.44,"dim_d_3c_mm":2,"dim_d_4c_mm":2,"dim_d2_3c_mm":39.89}$r$),
    (150, $r${"size_mm2":150,"current_rating_ground_a":245,"current_rating_duct_a":201,"current_rating_air_a":250,"impedance_ohm_per_km":0.2607,"volt_drop_3ph_mv_per_a_per_m":0.452,"volt_drop_1ph_mv_per_a_per_m":0.521,"dim_d1_3c_mm":33.99,"dim_d1_4c_mm":39.39,"dim_d_3c_mm":2,"dim_d_4c_mm":2.5,"dim_d2_3c_mm":42.79}$r$),
    (185, $r${"size_mm2":185,"current_rating_ground_a":278,"current_rating_duct_a":229,"current_rating_air_a":287,"impedance_ohm_per_km":0.2133,"volt_drop_3ph_mv_per_a_per_m":0.369,"volt_drop_1ph_mv_per_a_per_m":0.427,"dim_d1_3c_mm":37.8,"dim_d1_4c_mm":44.51,"dim_d_3c_mm":2,"dim_d_4c_mm":2.5,"dim_d2_3c_mm":47.1}$r$),
    (240, $r${"size_mm2":240,"current_rating_ground_a":324,"current_rating_duct_a":268,"current_rating_air_a":342,"impedance_ohm_per_km":0.1708,"volt_drop_3ph_mv_per_a_per_m":0.296,"volt_drop_1ph_mv_per_a_per_m":0.342,"dim_d1_3c_mm":42.6,"dim_d1_4c_mm":50.04,"dim_d_3c_mm":2.5,"dim_d_4c_mm":2.5,"dim_d2_3c_mm":52.9}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_6_3_1 — Derating Factors — Depth of laying
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_3_1',
        'Derating Factors — Depth of laying',
        'SANS 1507',
        '6.3.1',
        NULL,
        NULL,
        $cols$[{"key":"depth_mm","label":"Depth of Laying","unit":"mm","type":"number","decimals":0,"align":"right","is_key":true},{"key":"factor_direct_in_ground","label":"Direct in Ground","unit":"factor","type":"number","align":"right"},{"key":"factor_single_way_duct","label":"In Single Way Ducts","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
        'Apply multiplicatively with other derating factors.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 6.3.1'
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
-- TABLE_6_6 — Electrical and Physical Properties of single core unarmoured PVC insulated PVC sheathed 600/1000 V cables
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_6',
        'Electrical and Physical Properties of single core unarmoured PVC insulated PVC sheathed 600/1000 V cables',
        'SANS 1507-3',
        '6.6',
        '1-core PVC unarmoured copper',
        NULL,
        $cols$[{"key":"size_mm2","label":"Cable Size","unit":"mm²","type":"number","align":"right","is_key":true},{"key":"current_rating_1ph_ground_a","label":"1φ Current Rating (Ground)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_1ph_air_a","label":"1φ Current Rating (Air)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"volt_drop_1ph_mv_per_a_per_m","label":"1φ Volt drop","unit":"mV/A/m","type":"number","align":"right"},{"key":"current_rating_3ph_ground_a","label":"3φ Trefoil Current Rating (Ground)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_3ph_duct_a","label":"3φ Trefoil Current Rating (Duct)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_3ph_air_a","label":"3φ Trefoil Current Rating (Air)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"volt_drop_3ph_mv_per_a_per_m","label":"3φ Volt drop","unit":"mV/A/m","type":"number","align":"right"},{"key":"impedance_ohm_per_km","label":"Impedance","unit":"Ω/km","type":"number","align":"right"},{"key":"dim_d1_mm","label":"D1","unit":"mm","type":"number","align":"right"},{"key":"dim_d2_mm","label":"D2","unit":"mm","type":"number","align":"right"},{"key":"mass_kg_per_km","label":"Nominal Mass","unit":"kg/km","type":"number","decimals":0,"align":"right"}]$cols$::jsonb,
        NULL,
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 6.6'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (25, $r${"size_mm2":25,"current_rating_1ph_ground_a":118,"current_rating_1ph_air_a":126,"volt_drop_1ph_mv_per_a_per_m":1.75,"current_rating_3ph_ground_a":127,"current_rating_3ph_duct_a":111,"current_rating_3ph_air_a":112,"volt_drop_3ph_mv_per_a_per_m":1.52,"impedance_ohm_per_km":0.8767,"dim_d1_mm":5.95,"dim_d2_mm":11.91,"mass_kg_per_km":366}$r$),
    (35, $r${"size_mm2":35,"current_rating_1ph_ground_a":156,"current_rating_1ph_air_a":156,"volt_drop_1ph_mv_per_a_per_m":1.27,"current_rating_3ph_ground_a":153,"current_rating_3ph_duct_a":132,"current_rating_3ph_air_a":141,"volt_drop_3ph_mv_per_a_per_m":1.1,"impedance_ohm_per_km":0.6356,"dim_d1_mm":7,"dim_d2_mm":12.96,"mass_kg_per_km":469}$r$),
    (50, $r${"size_mm2":50,"current_rating_1ph_ground_a":186,"current_rating_1ph_air_a":191,"volt_drop_1ph_mv_per_a_per_m":0.95,"current_rating_3ph_ground_a":180,"current_rating_3ph_duct_a":155,"current_rating_3ph_air_a":172,"volt_drop_3ph_mv_per_a_per_m":0.82,"impedance_ohm_per_km":0.4745,"dim_d1_mm":8.15,"dim_d2_mm":15.15,"mass_kg_per_km":632}$r$),
    (70, $r${"size_mm2":70,"current_rating_1ph_ground_a":232,"current_rating_1ph_air_a":246,"volt_drop_1ph_mv_per_a_per_m":0.67,"current_rating_3ph_ground_a":221,"current_rating_3ph_duct_a":190,"current_rating_3ph_air_a":223,"volt_drop_3ph_mv_per_a_per_m":0.58,"impedance_ohm_per_km":0.3356,"dim_d1_mm":9.79,"dim_d2_mm":16.57,"mass_kg_per_km":880}$r$),
    (95, $r${"size_mm2":95,"current_rating_1ph_ground_a":281,"current_rating_1ph_air_a":300,"volt_drop_1ph_mv_per_a_per_m":0.5,"current_rating_3ph_ground_a":265,"current_rating_3ph_duct_a":226,"current_rating_3ph_air_a":273,"volt_drop_3ph_mv_per_a_per_m":0.43,"impedance_ohm_per_km":0.25,"dim_d1_mm":11.54,"dim_d2_mm":19.04,"mass_kg_per_km":1160}$r$),
    (120, $r${"size_mm2":120,"current_rating_1ph_ground_a":324,"current_rating_1ph_air_a":349,"volt_drop_1ph_mv_per_a_per_m":0.41,"current_rating_3ph_ground_a":301,"current_rating_3ph_duct_a":256,"current_rating_3ph_air_a":318,"volt_drop_3ph_mv_per_a_per_m":0.36,"impedance_ohm_per_km":0.2054,"dim_d1_mm":12.96,"dim_d2_mm":20.24,"mass_kg_per_km":1413}$r$),
    (150, $r${"size_mm2":150,"current_rating_1ph_ground_a":370,"current_rating_1ph_air_a":404,"volt_drop_1ph_mv_per_a_per_m":0.35,"current_rating_3ph_ground_a":338,"current_rating_3ph_duct_a":287,"current_rating_3ph_air_a":369,"volt_drop_3ph_mv_per_a_per_m":0.3,"impedance_ohm_per_km":0.1734,"dim_d1_mm":14.39,"dim_d2_mm":22.07,"mass_kg_per_km":1734}$r$),
    (185, $r${"size_mm2":185,"current_rating_1ph_ground_a":424,"current_rating_1ph_air_a":463,"volt_drop_1ph_mv_per_a_per_m":0.3,"current_rating_3ph_ground_a":381,"current_rating_3ph_duct_a":323,"current_rating_3ph_air_a":424,"volt_drop_3ph_mv_per_a_per_m":0.26,"impedance_ohm_per_km":0.1499,"dim_d1_mm":16.1,"dim_d2_mm":24.08,"mass_kg_per_km":2145}$r$),
    (240, $r${"size_mm2":240,"current_rating_1ph_ground_a":498,"current_rating_1ph_air_a":549,"volt_drop_1ph_mv_per_a_per_m":0.25,"current_rating_3ph_ground_a":442,"current_rating_3ph_duct_a":372,"current_rating_3ph_air_a":504,"volt_drop_3ph_mv_per_a_per_m":0.22,"impedance_ohm_per_km":0.1268,"dim_d1_mm":18.71,"dim_d2_mm":27.81,"mass_kg_per_km":2725}$r$),
    (300, $r${"size_mm2":300,"current_rating_1ph_ground_a":566,"current_rating_1ph_air_a":635,"volt_drop_1ph_mv_per_a_per_m":0.23,"current_rating_3ph_ground_a":499,"current_rating_3ph_duct_a":419,"current_rating_3ph_air_a":584,"volt_drop_3ph_mv_per_a_per_m":0.2,"impedance_ohm_per_km":0.1131,"dim_d1_mm":21.45,"dim_d2_mm":30.75,"mass_kg_per_km":3375}$r$),
    (400, $r${"size_mm2":400,"current_rating_1ph_ground_a":651,"current_rating_1ph_air_a":742,"volt_drop_1ph_mv_per_a_per_m":0.21,"current_rating_3ph_ground_a":565,"current_rating_3ph_duct_a":472,"current_rating_3ph_air_a":679,"volt_drop_3ph_mv_per_a_per_m":0.18,"impedance_ohm_per_km":0.1028,"dim_d1_mm":24.3,"dim_d2_mm":34.1,"mass_kg_per_km":4395}$r$),
    (500, $r${"size_mm2":500,"current_rating_1ph_ground_a":740,"current_rating_1ph_air_a":835,"volt_drop_1ph_mv_per_a_per_m":0.19,"current_rating_3ph_ground_a":634,"current_rating_3ph_duct_a":532,"current_rating_3ph_air_a":778,"volt_drop_3ph_mv_per_a_per_m":0.17,"impedance_ohm_per_km":0.0963,"dim_d1_mm":26.51,"dim_d2_mm":37.13,"mass_kg_per_km":5299}$r$),
    (630, $r${"size_mm2":630,"current_rating_1ph_ground_a":836,"current_rating_1ph_air_a":953,"volt_drop_1ph_mv_per_a_per_m":0.18,"current_rating_3ph_ground_a":718,"current_rating_3ph_duct_a":603,"current_rating_3ph_air_a":892,"volt_drop_3ph_mv_per_a_per_m":0.15,"impedance_ohm_per_km":0.089,"dim_d1_mm":33.15,"dim_d2_mm":43.62,"mass_kg_per_km":6965}$r$),
    (800, $r${"size_mm2":800,"current_rating_1ph_ground_a":931,"current_rating_1ph_air_a":1086,"volt_drop_1ph_mv_per_a_per_m":0.17,"current_rating_3ph_ground_a":792,"current_rating_3ph_duct_a":689,"current_rating_3ph_air_a":1020,"volt_drop_3ph_mv_per_a_per_m":0.15,"impedance_ohm_per_km":0.0852,"dim_d1_mm":37.7,"dim_d2_mm":49,"mass_kg_per_km":9118}$r$),
    (1000, $r${"size_mm2":1000,"current_rating_1ph_ground_a":1041,"current_rating_1ph_air_a":1216,"volt_drop_1ph_mv_per_a_per_m":0.16,"current_rating_3ph_ground_a":856,"current_rating_3ph_duct_a":741,"current_rating_3ph_air_a":1149,"volt_drop_3ph_mv_per_a_per_m":0.14,"impedance_ohm_per_km":0.0819,"dim_d1_mm":42.25,"dim_d2_mm":53.45,"mass_kg_per_km":11050}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_6_4 — Electrical and Physical Properties of XLPE CU cables 600/1000 V
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_4',
        'Electrical and Physical Properties of XLPE CU cables 600/1000 V',
        'SANS 1507-4',
        '6.4',
        '3/4-core XLPE SWA copper',
        NULL,
        $cols$[{"key":"size_mm2","label":"Cable Size","unit":"mm²","type":"number","align":"right","is_key":true},{"key":"current_rating_ground_70c_a","label":"Current Rating, Ground, 70°C","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_ground_90c_a","label":"Current Rating, Ground, 90°C","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_duct_70c_a","label":"Current Rating, Ducts, 70°C","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_duct_90c_a","label":"Current Rating, Ducts, 90°C","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_air_70c_a","label":"Current Rating, Air, 70°C","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_air_90c_a","label":"Current Rating, Air, 90°C","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"impedance_ohm_per_km","label":"Impedance","unit":"Ω/km","type":"number","align":"right"},{"key":"volt_drop_3ph_mv_per_a_per_m","label":"3φ Volt drop","unit":"mV/A/m","type":"number","align":"right"},{"key":"volt_drop_1ph_mv_per_a_per_m","label":"1φ Volt drop","unit":"mV/A/m","type":"number","align":"right"},{"key":"dim_d1_3c_mm","label":"D1 (3-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d1_4c_mm","label":"D1 (4-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d_3c_mm","label":"d (3-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d_4c_mm","label":"d (4-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d2_3c_mm","label":"D2 (3-core)","unit":"mm","type":"number","align":"right"}]$cols$::jsonb,
        NULL,
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (1.5, $r${"size_mm2":1.5,"current_rating_ground_70c_a":26,"current_rating_ground_90c_a":30,"current_rating_duct_70c_a":21,"current_rating_duct_90c_a":25,"current_rating_air_70c_a":16,"current_rating_air_90c_a":22,"impedance_ohm_per_km":15.43,"volt_drop_3ph_mv_per_a_per_m":26.726,"volt_drop_1ph_mv_per_a_per_m":30.861,"dim_d1_3c_mm":8.08,"dim_d1_4c_mm":8.85,"dim_d_3c_mm":1.25,"dim_d_4c_mm":1.25,"dim_d2_3c_mm":13.7}$r$),
    (2.5, $r${"size_mm2":2.5,"current_rating_ground_70c_a":34,"current_rating_ground_90c_a":40,"current_rating_duct_70c_a":28,"current_rating_duct_90c_a":32,"current_rating_air_70c_a":21,"current_rating_air_90c_a":30,"impedance_ohm_per_km":9.45,"volt_drop_3ph_mv_per_a_per_m":16.368,"volt_drop_1ph_mv_per_a_per_m":18.9,"dim_d1_3c_mm":9.18,"dim_d1_4c_mm":10.08,"dim_d_3c_mm":1.25,"dim_d_4c_mm":1.25,"dim_d2_3c_mm":14.8}$r$),
    (4, $r${"size_mm2":4,"current_rating_ground_70c_a":45,"current_rating_ground_90c_a":52,"current_rating_duct_70c_a":36,"current_rating_duct_90c_a":42,"current_rating_air_70c_a":28,"current_rating_air_90c_a":39,"impedance_ohm_per_km":5.88,"volt_drop_3ph_mv_per_a_per_m":10.184,"volt_drop_1ph_mv_per_a_per_m":11.761,"dim_d1_3c_mm":10.06,"dim_d1_4c_mm":11.07,"dim_d_3c_mm":1.25,"dim_d_4c_mm":1.25,"dim_d2_3c_mm":15.68}$r$),
    (6, $r${"size_mm2":6,"current_rating_ground_70c_a":55,"current_rating_ground_90c_a":64,"current_rating_duct_70c_a":44,"current_rating_duct_90c_a":52,"current_rating_air_70c_a":35,"current_rating_air_90c_a":49,"impedance_ohm_per_km":3.93,"volt_drop_3ph_mv_per_a_per_m":6.807,"volt_drop_1ph_mv_per_a_per_m":7.862,"dim_d1_3c_mm":11.25,"dim_d1_4c_mm":12.4,"dim_d_3c_mm":1.25,"dim_d_4c_mm":1.25,"dim_d2_3c_mm":16.87}$r$),
    (10, $r${"size_mm2":10,"current_rating_ground_70c_a":75,"current_rating_ground_90c_a":87,"current_rating_duct_70c_a":60,"current_rating_duct_90c_a":70,"current_rating_air_70c_a":48,"current_rating_air_90c_a":68,"impedance_ohm_per_km":2.33,"volt_drop_3ph_mv_per_a_per_m":4.053,"volt_drop_1ph_mv_per_a_per_m":4.663,"dim_d1_3c_mm":13.25,"dim_d1_4c_mm":14.64,"dim_d_3c_mm":1.25,"dim_d_4c_mm":1.25,"dim_d2_3c_mm":19.07}$r$),
    (16, $r${"size_mm2":16,"current_rating_ground_70c_a":94,"current_rating_ground_90c_a":110,"current_rating_duct_70c_a":76,"current_rating_duct_90c_a":89,"current_rating_air_70c_a":60,"current_rating_air_90c_a":85,"impedance_ohm_per_km":1.46,"volt_drop_3ph_mv_per_a_per_m":2.546,"volt_drop_1ph_mv_per_a_per_m":2.924,"dim_d1_3c_mm":15.21,"dim_d1_4c_mm":17.68,"dim_d_3c_mm":1.25,"dim_d_4c_mm":1.25,"dim_d2_3c_mm":21.03}$r$),
    (25, $r${"size_mm2":25,"current_rating_ground_70c_a":123,"current_rating_ground_90c_a":143,"current_rating_duct_70c_a":98,"current_rating_duct_90c_a":116,"current_rating_air_70c_a":107,"current_rating_air_90c_a":132,"impedance_ohm_per_km":0.9313,"volt_drop_3ph_mv_per_a_per_m":1.613,"volt_drop_1ph_mv_per_a_per_m":1.863,"dim_d1_3c_mm":18.13,"dim_d1_4c_mm":19.86,"dim_d_3c_mm":1.6,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":25.13}$r$),
    (35, $r${"size_mm2":35,"current_rating_ground_70c_a":148,"current_rating_ground_90c_a":172,"current_rating_duct_70c_a":119,"current_rating_duct_90c_a":139,"current_rating_air_70c_a":132,"current_rating_air_90c_a":163,"impedance_ohm_per_km":0.6738,"volt_drop_3ph_mv_per_a_per_m":1.167,"volt_drop_1ph_mv_per_a_per_m":1.348,"dim_d1_3c_mm":19.56,"dim_d1_4c_mm":22.32,"dim_d_3c_mm":1.6,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":26.56}$r$),
    (50, $r${"size_mm2":50,"current_rating_ground_70c_a":177,"current_rating_ground_90c_a":206,"current_rating_duct_70c_a":142,"current_rating_duct_90c_a":167,"current_rating_air_70c_a":163,"current_rating_air_90c_a":200,"impedance_ohm_per_km":0.5009,"volt_drop_3ph_mv_per_a_per_m":0.868,"volt_drop_1ph_mv_per_a_per_m":1.002,"dim_d1_3c_mm":22.49,"dim_d1_4c_mm":25.76,"dim_d_3c_mm":1.6,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":29.69}$r$),
    (70, $r${"size_mm2":70,"current_rating_ground_70c_a":216,"current_rating_ground_90c_a":252,"current_rating_duct_70c_a":175,"current_rating_duct_90c_a":205,"current_rating_air_70c_a":206,"current_rating_air_90c_a":253,"impedance_ohm_per_km":0.3521,"volt_drop_3ph_mv_per_a_per_m":0.61,"volt_drop_1ph_mv_per_a_per_m":0.704,"dim_d1_3c_mm":25.74,"dim_d1_4c_mm":29.71,"dim_d_3c_mm":2,"dim_d_4c_mm":2,"dim_d2_3c_mm":32.94}$r$),
    (95, $r${"size_mm2":95,"current_rating_ground_70c_a":258,"current_rating_ground_90c_a":302,"current_rating_duct_70c_a":209,"current_rating_duct_90c_a":248,"current_rating_air_70c_a":251,"current_rating_air_90c_a":312,"impedance_ohm_per_km":0.2589,"volt_drop_3ph_mv_per_a_per_m":0.448,"volt_drop_1ph_mv_per_a_per_m":0.518,"dim_d1_3c_mm":28.76,"dim_d1_4c_mm":33.1,"dim_d_3c_mm":2,"dim_d_4c_mm":2,"dim_d2_3c_mm":37.16}$r$),
    (120, $r${"size_mm2":120,"current_rating_ground_70c_a":293,"current_rating_ground_90c_a":344,"current_rating_duct_70c_a":238,"current_rating_duct_90c_a":282,"current_rating_air_70c_a":291,"current_rating_air_90c_a":362,"impedance_ohm_per_km":0.2109,"volt_drop_3ph_mv_per_a_per_m":0.365,"volt_drop_1ph_mv_per_a_per_m":0.422,"dim_d1_3c_mm":31.39,"dim_d1_4c_mm":35.87,"dim_d_3c_mm":2,"dim_d_4c_mm":2,"dim_d2_3c_mm":40.19}$r$),
    (150, $r${"size_mm2":150,"current_rating_ground_70c_a":329,"current_rating_ground_90c_a":387,"current_rating_duct_70c_a":268,"current_rating_duct_90c_a":318,"current_rating_air_70c_a":334,"current_rating_air_90c_a":416,"impedance_ohm_per_km":0.1775,"volt_drop_3ph_mv_per_a_per_m":0.307,"volt_drop_1ph_mv_per_a_per_m":0.355,"dim_d1_3c_mm":34.69,"dim_d1_4c_mm":40.12,"dim_d_3c_mm":2.5,"dim_d_4c_mm":2.5,"dim_d2_3c_mm":43.49}$r$),
    (185, $r${"size_mm2":185,"current_rating_ground_70c_a":371,"current_rating_ground_90c_a":435,"current_rating_duct_70c_a":302,"current_rating_duct_90c_a":359,"current_rating_air_70c_a":383,"current_rating_air_90c_a":478,"impedance_ohm_per_km":0.15,"volt_drop_3ph_mv_per_a_per_m":0.26,"volt_drop_1ph_mv_per_a_per_m":0.3,"dim_d1_3c_mm":39.05,"dim_d1_4c_mm":44.77,"dim_d_3c_mm":2.5,"dim_d_4c_mm":2.5,"dim_d2_3c_mm":49.35}$r$),
    (240, $r${"size_mm2":240,"current_rating_ground_70c_a":428,"current_rating_ground_90c_a":498,"current_rating_duct_70c_a":349,"current_rating_duct_90c_a":413,"current_rating_air_70c_a":453,"current_rating_air_90c_a":557,"impedance_ohm_per_km":0.1247,"volt_drop_3ph_mv_per_a_per_m":0.216,"volt_drop_1ph_mv_per_a_per_m":0.249,"dim_d1_3c_mm":44.22,"dim_d1_4c_mm":50.58,"dim_d_3c_mm":2.5,"dim_d_4c_mm":2.5,"dim_d2_3c_mm":54.52}$r$),
    (300, $r${"size_mm2":300,"current_rating_ground_70c_a":482,"current_rating_ground_90c_a":558,"current_rating_duct_70c_a":401,"current_rating_duct_90c_a":471,"current_rating_air_70c_a":520,"current_rating_air_90c_a":634,"impedance_ohm_per_km":0.1099,"volt_drop_3ph_mv_per_a_per_m":0.19,"volt_drop_1ph_mv_per_a_per_m":0.219,"dim_d1_3c_mm":48.45,"dim_d1_4c_mm":55.56,"dim_d_3c_mm":2.5,"dim_d_4c_mm":2.5,"dim_d2_3c_mm":58.35}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_6_5 — Electrical and Physical Properties of XLPE AL cables 600/1000 V
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_5',
        'Electrical and Physical Properties of XLPE AL cables 600/1000 V',
        'SANS 1507-4',
        '6.5',
        '3/4-core XLPE SWA aluminium',
        NULL,
        $cols$[{"key":"size_mm2","label":"Cable Size","unit":"mm²","type":"number","align":"right","is_key":true},{"key":"current_rating_ground_a","label":"Current Rating, Ground","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_duct_a","label":"Current Rating, Ducts","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_air_a","label":"Current Rating, Air","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"impedance_ohm_per_km","label":"Impedance","unit":"Ω/km","type":"number","align":"right"},{"key":"volt_drop_3ph_mv_per_a_per_m","label":"3φ Volt drop","unit":"mV/A/m","type":"number","align":"right"},{"key":"volt_drop_1ph_mv_per_a_per_m","label":"1φ Volt drop","unit":"mV/A/m","type":"number","align":"right"},{"key":"dim_d1_3c_mm","label":"D1 (3-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d1_4c_mm","label":"D1 (4-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d_3c_mm","label":"d (3-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d_4c_mm","label":"d (4-core)","unit":"mm","type":"number","align":"right"},{"key":"dim_d2_3c_mm","label":"D2 (3-core)","unit":"mm","type":"number","align":"right"}]$cols$::jsonb,
        NULL,
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (25, $r${"size_mm2":25,"current_rating_ground_a":115,"current_rating_duct_a":92,"current_rating_air_a":108,"impedance_ohm_per_km":1.5408,"volt_drop_3ph_mv_per_a_per_m":2.669,"volt_drop_1ph_mv_per_a_per_m":3.082,"dim_d1_3c_mm":15.53,"dim_d1_4c_mm":19.16,"dim_d_3c_mm":1.25,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":21.53}$r$),
    (35, $r${"size_mm2":35,"current_rating_ground_a":138,"current_rating_duct_a":111,"current_rating_air_a":131,"impedance_ohm_per_km":1.1159,"volt_drop_3ph_mv_per_a_per_m":1.933,"volt_drop_1ph_mv_per_a_per_m":2.232,"dim_d1_3c_mm":18,"dim_d1_4c_mm":20.44,"dim_d_3c_mm":1.6,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":25}$r$),
    (50, $r${"size_mm2":50,"current_rating_ground_a":164,"current_rating_duct_a":132,"current_rating_air_a":160,"impedance_ohm_per_km":0.8258,"volt_drop_3ph_mv_per_a_per_m":1.43,"volt_drop_1ph_mv_per_a_per_m":1.652,"dim_d1_3c_mm":20.09,"dim_d1_4c_mm":23.06,"dim_d_3c_mm":1.6,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":27.09}$r$),
    (70, $r${"size_mm2":70,"current_rating_ground_a":199,"current_rating_duct_a":161,"current_rating_air_a":200,"impedance_ohm_per_km":0.5736,"volt_drop_3ph_mv_per_a_per_m":0.994,"volt_drop_1ph_mv_per_a_per_m":1.147,"dim_d1_3c_mm":23.43,"dim_d1_4c_mm":27.38,"dim_d_3c_mm":1.6,"dim_d_4c_mm":1.6,"dim_d2_3c_mm":30.63}$r$),
    (95, $r${"size_mm2":95,"current_rating_ground_a":238,"current_rating_duct_a":194,"current_rating_air_a":245,"impedance_ohm_per_km":0.4178,"volt_drop_3ph_mv_per_a_per_m":0.724,"volt_drop_1ph_mv_per_a_per_m":0.836,"dim_d1_3c_mm":25.85,"dim_d1_4c_mm":30.99,"dim_d_3c_mm":1.6,"dim_d_4c_mm":2,"dim_d2_3c_mm":33.05}$r$),
    (120, $r${"size_mm2":120,"current_rating_ground_a":272,"current_rating_duct_a":221,"current_rating_air_a":285,"impedance_ohm_per_km":0.3337,"volt_drop_3ph_mv_per_a_per_m":0.578,"volt_drop_1ph_mv_per_a_per_m":0.667,"dim_d1_3c_mm":29.09,"dim_d1_4c_mm":33.2,"dim_d_3c_mm":2,"dim_d_4c_mm":2,"dim_d2_3c_mm":37.49}$r$),
    (150, $r${"size_mm2":150,"current_rating_ground_a":306,"current_rating_duct_a":249,"current_rating_air_a":328,"impedance_ohm_per_km":0.2756,"volt_drop_3ph_mv_per_a_per_m":0.477,"volt_drop_1ph_mv_per_a_per_m":0.551,"dim_d1_3c_mm":32.15,"dim_d1_4c_mm":36.75,"dim_d_3c_mm":2,"dim_d_4c_mm":2,"dim_d2_3c_mm":40.95}$r$),
    (185, $r${"size_mm2":185,"current_rating_ground_a":344,"current_rating_duct_a":283,"current_rating_air_a":378,"impedance_ohm_per_km":0.2247,"volt_drop_3ph_mv_per_a_per_m":0.389,"volt_drop_1ph_mv_per_a_per_m":0.449,"dim_d1_3c_mm":36.02,"dim_d1_4c_mm":42.52,"dim_d_3c_mm":2,"dim_d_4c_mm":2.5,"dim_d2_3c_mm":45.32}$r$),
    (240, $r${"size_mm2":240,"current_rating_ground_a":392,"current_rating_duct_a":325,"current_rating_air_a":438,"impedance_ohm_per_km":0.1785,"volt_drop_3ph_mv_per_a_per_m":0.309,"volt_drop_1ph_mv_per_a_per_m":0.357,"dim_d1_3c_mm":40.39,"dim_d1_4c_mm":50.4,"dim_d_3c_mm":2.5,"dim_d_4c_mm":2.5,"dim_d2_3c_mm":50.69}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_6_7 — Electrical and Physical Properties of single core unarmoured XLPE insulated PVC sheathed 600/1000 V cables
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_6_7',
        'Electrical and Physical Properties of single core unarmoured XLPE insulated PVC sheathed 600/1000 V cables',
        'SANS 1507-4',
        '6.7',
        '1-core XLPE unarmoured copper',
        NULL,
        $cols$[{"key":"size_mm2","label":"Cable Size","unit":"mm²","type":"number","align":"right","is_key":true},{"key":"current_rating_1ph_ground_a","label":"1φ Current Rating (Ground)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_1ph_air_a","label":"1φ Current Rating (Air)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"volt_drop_1ph_mv_per_a_per_m","label":"1φ Volt drop","unit":"mV/A/m","type":"number","align":"right"},{"key":"current_rating_3ph_ground_a","label":"3φ Trefoil Current Rating (Ground)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_3ph_duct_a","label":"3φ Trefoil Current Rating (Duct)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"current_rating_3ph_air_a","label":"3φ Trefoil Current Rating (Air)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"volt_drop_3ph_mv_per_a_per_m","label":"3φ Volt drop","unit":"mV/A/m","type":"number","align":"right"},{"key":"impedance_ohm_per_km","label":"Impedance","unit":"Ω/km","type":"number","align":"right"},{"key":"dim_d1_mm","label":"D1","unit":"mm","type":"number","align":"right"},{"key":"dim_d2_mm","label":"D2","unit":"mm","type":"number","align":"right"},{"key":"mass_kg_per_km","label":"Nominal Mass","unit":"kg/km","type":"number","decimals":0,"align":"right"}]$cols$::jsonb,
        NULL,
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 6.7'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (25, $r${"size_mm2":25,"current_rating_1ph_ground_a":169,"current_rating_1ph_air_a":174,"volt_drop_1ph_mv_per_a_per_m":1.866,"current_rating_3ph_ground_a":151,"current_rating_3ph_duct_a":137,"current_rating_3ph_air_a":137,"volt_drop_3ph_mv_per_a_per_m":1.616,"impedance_ohm_per_km":0.9332,"dim_d1_mm":5.95,"dim_d2_mm":11.81,"mass_kg_per_km":328}$r$),
    (35, $r${"size_mm2":35,"current_rating_1ph_ground_a":205,"current_rating_1ph_air_a":211,"volt_drop_1ph_mv_per_a_per_m":1.352,"current_rating_3ph_ground_a":181,"current_rating_3ph_duct_a":164,"current_rating_3ph_air_a":167,"volt_drop_3ph_mv_per_a_per_m":1.71,"impedance_ohm_per_km":0.676,"dim_d1_mm":7,"dim_d2_mm":12.86,"mass_kg_per_km":426}$r$),
    (50, $r${"size_mm2":50,"current_rating_1ph_ground_a":245,"current_rating_1ph_air_a":257,"volt_drop_1ph_mv_per_a_per_m":1.007,"current_rating_3ph_ground_a":213,"current_rating_3ph_duct_a":192,"current_rating_3ph_air_a":203,"volt_drop_3ph_mv_per_a_per_m":0.872,"impedance_ohm_per_km":5.36,"dim_d1_mm":8.15,"dim_d2_mm":14.38,"mass_kg_per_km":567}$r$),
    (70, $r${"size_mm2":70,"current_rating_1ph_ground_a":302,"current_rating_1ph_air_a":236,"volt_drop_1ph_mv_per_a_per_m":0.71,"current_rating_3ph_ground_a":260,"current_rating_3ph_duct_a":235,"current_rating_3ph_air_a":257,"volt_drop_3ph_mv_per_a_per_m":0.615,"impedance_ohm_per_km":0.3552,"dim_d1_mm":9.79,"dim_d2_mm":16.22,"mass_kg_per_km":824}$r$),
    (95, $r${"size_mm2":95,"current_rating_1ph_ground_a":366,"current_rating_1ph_air_a":404,"volt_drop_1ph_mv_per_a_per_m":0.526,"current_rating_3ph_ground_a":312,"current_rating_3ph_duct_a":281,"current_rating_3ph_air_a":318,"volt_drop_3ph_mv_per_a_per_m":0.456,"impedance_ohm_per_km":0.2631,"dim_d1_mm":11.54,"dim_d2_mm":17.97,"mass_kg_per_km":1071}$r$),
    (120, $r${"size_mm2":120,"current_rating_1ph_ground_a":422,"current_rating_1ph_air_a":475,"volt_drop_1ph_mv_per_a_per_m":0.431,"current_rating_3ph_ground_a":355,"current_rating_3ph_duct_a":319,"current_rating_3ph_air_a":372,"volt_drop_3ph_mv_per_a_per_m":0.373,"impedance_ohm_per_km":0.2154,"dim_d1_mm":12.96,"dim_d2_mm":19.32,"mass_kg_per_km":1304}$r$),
    (150, $r${"size_mm2":150,"current_rating_1ph_ground_a":480,"current_rating_1ph_air_a":542,"volt_drop_1ph_mv_per_a_per_m":0.363,"current_rating_3ph_ground_a":397,"current_rating_3ph_duct_a":356,"current_rating_3ph_air_a":426,"volt_drop_3ph_mv_per_a_per_m":0.315,"impedance_ohm_per_km":0.1818,"dim_d1_mm":14.39,"dim_d2_mm":21.42,"mass_kg_per_km":1628}$r$),
    (185, $r${"size_mm2":185,"current_rating_1ph_ground_a":554,"current_rating_1ph_air_a":629,"volt_drop_1ph_mv_per_a_per_m":0.309,"current_rating_3ph_ground_a":449,"current_rating_3ph_duct_a":402,"current_rating_3ph_air_a":494,"volt_drop_3ph_mv_per_a_per_m":0.268,"impedance_ohm_per_km":0.1545,"dim_d1_mm":16.1,"dim_d2_mm":23.63,"mass_kg_per_km":1995}$r$),
    (240, $r${"size_mm2":240,"current_rating_1ph_ground_a":656,"current_rating_1ph_air_a":753,"volt_drop_1ph_mv_per_a_per_m":0.259,"current_rating_3ph_ground_a":522,"current_rating_3ph_duct_a":466,"current_rating_3ph_air_a":594,"volt_drop_3ph_mv_per_a_per_m":0.224,"impedance_ohm_per_km":0.1295,"dim_d1_mm":18.71,"dim_d2_mm":26.69,"mass_kg_per_km":2461}$r$),
    (300, $r${"size_mm2":300,"current_rating_1ph_ground_a":766,"current_rating_1ph_air_a":881,"volt_drop_1ph_mv_per_a_per_m":0.229,"current_rating_3ph_ground_a":589,"current_rating_3ph_duct_a":524,"current_rating_3ph_air_a":692,"volt_drop_3ph_mv_per_a_per_m":0.199,"impedance_ohm_per_km":0.1149,"dim_d1_mm":21.45,"dim_d2_mm":30.05,"mass_kg_per_km":3182}$r$),
    (400, $r${"size_mm2":400,"current_rating_1ph_ground_a":902,"current_rating_1ph_air_a":1045,"volt_drop_1ph_mv_per_a_per_m":0.207,"current_rating_3ph_ground_a":668,"current_rating_3ph_duct_a":592,"current_rating_3ph_air_a":807,"volt_drop_3ph_mv_per_a_per_m":0.179,"impedance_ohm_per_km":0.1035,"dim_d1_mm":24.3,"dim_d2_mm":33.3,"mass_kg_per_km":4117}$r$),
    (500, $r${"size_mm2":500,"current_rating_1ph_ground_a":1040,"current_rating_1ph_air_a":1182,"volt_drop_1ph_mv_per_a_per_m":0.192,"current_rating_3ph_ground_a":750,"current_rating_3ph_duct_a":664,"current_rating_3ph_air_a":925,"volt_drop_3ph_mv_per_a_per_m":0.167,"impedance_ohm_per_km":0.0963,"dim_d1_mm":26.51,"dim_d2_mm":36.33,"mass_kg_per_km":5032}$r$),
    (630, $r${"size_mm2":630,"current_rating_1ph_ground_a":1229,"current_rating_1ph_air_a":1417,"volt_drop_1ph_mv_per_a_per_m":0.178,"current_rating_3ph_ground_a":848,"current_rating_3ph_duct_a":746,"current_rating_3ph_air_a":1094,"volt_drop_3ph_mv_per_a_per_m":0.154,"impedance_ohm_per_km":0.889,"dim_d1_mm":33.15,"dim_d2_mm":42.79,"mass_kg_per_km":6641}$r$),
    (800, $r${"size_mm2":800,"current_rating_1ph_ground_a":1366,"current_rating_1ph_air_a":1603,"volt_drop_1ph_mv_per_a_per_m":0.171,"current_rating_3ph_ground_a":942,"current_rating_3ph_duct_a":823,"current_rating_3ph_air_a":1254,"volt_drop_3ph_mv_per_a_per_m":0.148,"impedance_ohm_per_km":0.0856,"dim_d1_mm":37.7,"dim_d2_mm":48.84,"mass_kg_per_km":8535}$r$),
    (1000, $r${"size_mm2":1000,"current_rating_1ph_ground_a":1486,"current_rating_1ph_air_a":1790,"volt_drop_1ph_mv_per_a_per_m":0.166,"current_rating_3ph_ground_a":1025,"current_rating_3ph_duct_a":892,"current_rating_3ph_air_a":1400,"volt_drop_3ph_mv_per_a_per_m":0.144,"impedance_ohm_per_km":0.0831,"dim_d1_mm":42.25,"dim_d2_mm":54.21,"mass_kg_per_km":10676}$r$)
) AS v(sort_key, row_data);

-- --------------------------------------------------------------------------
-- TABLE_9_1 — Earth Conductor — Resistance, Current Rating, 1 Second Short Circuit Rating
-- --------------------------------------------------------------------------
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref
    ) VALUES (
        'TABLE_9_1',
        'Earth Conductor — Resistance, Current Rating, 1 Second Short Circuit Rating',
        'SANS 10142-1',
        '9.1',
        NULL,
        NULL,
        $cols$[{"key":"size_mm2","label":"Earth Conductor Size","unit":"mm²","type":"number","align":"right","is_key":true},{"key":"resistance_ohm_per_km","label":"Resistance","unit":"Ω/km","type":"number","align":"right"},{"key":"current_rating_a","label":"Current Rating","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"short_circuit_1s_ka","label":"1 Second Short Circuit Rating","unit":"kA","type":"number","align":"right"}]$cols$::jsonb,
        'Populate from manufacturer table 9.1. This is a placeholder header with the canonical column ids.',
        'CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet, Table 9.1 (header only)'
    )
    RETURNING id
)
SELECT id FROM t;

NOTIFY pgrst, 'reload schema';
