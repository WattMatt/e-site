-- =============================================================================
-- Migration 00167 — SANS reference library: 2026-07 audit corrections
-- =============================================================================
-- A cell-by-cell audit of the seeded reference library (migrations 00053 /
-- 00056 / 00057 / 00058 / 00059) against the printed Aberdare "Cables Facts &
-- Figures" booklet and the SANS 10142-1:2017 full text found:
--
--   * 9 wrong data cells (workbook transcription slips + misprints in the
--     printed Aberdare source itself, proven from the booklet's own
--     internally-consistent volt-drop/impedance arithmetic) — §1 below.
--   * LV derating factors that diverge from SANS 10142-1:2017 in the
--     non-conservative direction, plus missing SANS rows that the
--     floor-clamping lookup silently papers over — §2.
--   * Mislabelled tables: the "soil resistivity by region" tables are really
--     Aberdare's CORRECTION FACTORS FOR DIRECT SOLAR RADIATION; TABLE_5_2_4
--     is GROUND (not air) temperature; TABLE_9_1 is an Aberdare INTERDAC 3
--     product datasheet, not a SANS 10142-1 earth-conductor table; the seven
--     LV derating tables claim "SANS 1507-3 / 1507-4" (a cable product spec
--     with no derating tables) — §3.
--   * TABLE_5_3 (MV XLPE 1 s earth-fault ratings) never seeded — §4.
--
-- Corrective UPDATEs only (plus row inserts + one new table code) — the
-- earlier seed migrations are not edited in place. Idempotent throughout:
-- jsonb merges are naturally re-runnable, row inserts are guarded by
-- NOT EXISTS, TABLE_5_3 is delete-then-insert like every other seed.
--
-- No schema CREATE/DROP here, so no PostgREST db_schema config PATCH is
-- needed — the closing NOTIFY covers the schema-cache reload.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cell value corrections
-- ---------------------------------------------------------------------------

-- TABLE_6_2, 2.5 mm²: 3φ volt drop 15.636 → 15.363 (digit transposition;
-- Aberdare p38 prints 15,363; √3 × 8.87 = 15.363).
UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"volt_drop_3ph_mv_per_a_per_m": 15.363}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_2' AND r.sort_key = 2.5;

-- TABLE_6_4, 70 mm²: D1 (4-core) 29.71 → 29.81 (transcription slip;
-- Aberdare p40 prints 29,81).
UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"dim_d1_4c_mm": 29.81}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_4' AND r.sort_key = 70;

-- TABLE_6_7 — four misprints in the printed Aberdare source itself, corrected
-- from the booklet's own arithmetic (3φ VD = √3·Z, 1φ VD = 2·Z, exact in all
-- 26 clean single-core rows) plus size-monotonicity:
--   35 mm²  3φ VD      1.71  → 1.171  (√3 × 0.676 = 1.171; 3φ must be < 1φ 1.352)
--   50 mm²  impedance  5.36  → 0.5036 (1.007/2 = 0.5035, 0.872/√3 = 0.5034)
--   70 mm²  1φ air     236   → 326    (transposed digits; 1φ-air/trefoil-air
--                                      ratio 1.276 × 257 ≈ 326; 236 < the
--                                      50 mm² rating is physically impossible)
--   630 mm² impedance  0.889 → 0.0889 (decimal shift; 0.154/√3 = 0.0889)
UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"volt_drop_3ph_mv_per_a_per_m": 1.171}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_7' AND r.sort_key = 35;

UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"impedance_ohm_per_km": 0.5036}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_7' AND r.sort_key = 50;

UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"current_rating_1ph_air_a": 326}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_7' AND r.sort_key = 70;

UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"impedance_ohm_per_km": 0.0889}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_7' AND r.sort_key = 630;

-- TABLE_4_2, 120 mm²: Cu impedance 0.253 → 0.2053 (dropped "0" digit;
-- Aberdare p28 prints 0,2053; monotonic 0.2499 (95) → 0.1739 (150)) and
-- Cu diameter 41.72 → 41.73 (print shows 41,73 in both Cu and Al columns).
UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data
    || '{"cu_impedance_ohm_per_km": 0.2053, "cu_diameter_over_lead_mm": 41.73}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_4_2' AND r.sort_key = 120;

-- TABLE_5_2_6, 120–185 band: coastal 0.60 → 0.62 (Aberdare p35 prints 0,62,
-- identical to the same table on p30 / TABLE_4_3_6).
UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"factor_coastal": 0.62}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_5_2_6' AND r.sort_key = 120;

-- TABLE_9_1, 10 mm²: 1 s short-circuit 0.82 → 1.43 kA. The printed source
-- cell fails its own table's adiabatic identity (16 mm² 2.29 = 143·S and
-- 25 mm² 3.57 = 143·S; k = 143 for XLPE Cu 90→250 °C ⇒ 143 × 10/1000 = 1.43).
UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"short_circuit_1s_ka": 1.43}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_9_1' AND r.sort_key = 10;

-- ---------------------------------------------------------------------------
-- 2. LV derating alignment to SANS 10142-1:2017
-- ---------------------------------------------------------------------------
-- Policy: where SANS 10142-1:2017 publishes a value, the seeded factor is
-- aligned to SANS (the Aberdare booklet is non-conservative in 9 cells);
-- Aberdare-only cells (beyond the SANS range) are retained and flagged in
-- the table notes. Missing SANS rows are added because the lookup clamps
-- out-of-range inputs to the nearest seeded row — a site hotter / deeper /
-- more resistive than the last row silently got too little derating.

-- 2a. TABLE_6_3_1 — depth of laying (SANS 10142-1:2017 Table 6.16, ref 0.5 m)
UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data
    || '{"factor_direct_in_ground": 0.96, "factor_single_way_duct": 0.98}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_3_1' AND r.sort_key = 800;

UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"factor_direct_in_ground": 0.94}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_3_1' AND r.sort_key = 1000;

UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"factor_direct_in_ground": 0.92}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_3_1' AND r.sort_key = 1250;

UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"factor_direct_in_ground": 0.90}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_3_1' AND r.sort_key = 1500;

-- 2000 mm is beyond the SANS T6.16 range (ends 1.5 m) and is retained, but
-- Aberdare's direct factor (0.92) would now sit ABOVE the SANS-aligned
-- 1500 mm row (0.90) — deeper cannot rate higher, and the floor-clamping
-- lookup would hand a 2 m-deep cable the better factor. Clamped to 0.90.
UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"factor_direct_in_ground": 0.90}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_3_1' AND r.sort_key = 2000;

-- New 600 mm row (SANS T6.16 has it; the seed lacked it).
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, 600,
       $r${"depth_mm": 600, "factor_direct_in_ground": 0.98, "factor_single_way_duct": 0.99}$r$::jsonb
FROM cable_schedule.sans_tables t
WHERE t.code = 'TABLE_6_3_1'
  AND NOT EXISTS (
      SELECT 1 FROM cable_schedule.sans_rows r
      WHERE r.table_id = t.id AND r.sort_key = 600
  );

-- 2b. TABLE_6_3_2 — soil thermal resistivity (SANS T6.12, ref 1.2 K·m/W)
UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data
    || '{"factor_direct_in_ground": 1.06, "factor_single_way_duct": 1.02}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_3_2' AND r.sort_key = 1;

UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"factor_single_way_duct": 0.91}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_3_2' AND r.sort_key = 2;

UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"factor_direct_in_ground": 0.76}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_3_2' AND r.sort_key = 2.5;

-- New SANS T6.12 rows: uprating 0.7/0.8/0.9 and derating 3.0/3.5/4.0 K·m/W.
-- Without the high-resistivity rows the lookup's floor-clamp handed ρ = 3.0
-- the 2.5 factor (0.78 vs SANS 0.71 — non-conservative).
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM cable_schedule.sans_tables t,
(VALUES
    (0.7, $r${"resistivity_kmw": 0.7, "factor_direct_in_ground": 1.17, "factor_single_way_duct": 1.07}$r$),
    (0.8, $r${"resistivity_kmw": 0.8, "factor_direct_in_ground": 1.13, "factor_single_way_duct": 1.05}$r$),
    (0.9, $r${"resistivity_kmw": 0.9, "factor_direct_in_ground": 1.09, "factor_single_way_duct": 1.04}$r$),
    (3.0, $r${"resistivity_kmw": 3.0, "factor_direct_in_ground": 0.71, "factor_single_way_duct": 0.83}$r$),
    (3.5, $r${"resistivity_kmw": 3.5, "factor_direct_in_ground": 0.65, "factor_single_way_duct": 0.80}$r$),
    (4.0, $r${"resistivity_kmw": 4.0, "factor_direct_in_ground": 0.61, "factor_single_way_duct": 0.77}$r$)
) AS v(sort_key, row_data)
WHERE t.code = 'TABLE_6_3_2'
  AND NOT EXISTS (
      SELECT 1 FROM cable_schedule.sans_rows r
      WHERE r.table_id = t.id AND r.sort_key = v.sort_key
  );

-- 2c. TABLE_6_3_3 — grouping buried, single horizontal layer (SANS T6.13).
-- Seeded n=2..6 cells already match SANS exactly; extend to n=7..12. Every
-- cell below was read directly from the SANS 10142-1:2017 Table 6.13 text
-- this audit (single-layer section, ground touching/150/300/450/600 and
-- pipes-in-ground touching/300/450/600 columns) — all 9 columns verified,
-- so full rows are inserted.
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM cable_schedule.sans_tables t,
(VALUES
    (7,  $r${"n_cables": 7,  "ground_touching": 0.52, "ground_150mm": 0.65, "ground_300mm": 0.75, "ground_450mm": 0.81, "ground_600mm": 0.86, "duct_touching": 0.70, "duct_300mm": 0.80, "duct_450mm": 0.86, "duct_600mm": 0.89}$r$),
    (8,  $r${"n_cables": 8,  "ground_touching": 0.50, "ground_150mm": 0.64, "ground_300mm": 0.74, "ground_450mm": 0.81, "ground_600mm": 0.85, "duct_touching": 0.69, "duct_300mm": 0.79, "duct_450mm": 0.85, "duct_600mm": 0.89}$r$),
    (9,  $r${"n_cables": 9,  "ground_touching": 0.48, "ground_150mm": 0.63, "ground_300mm": 0.74, "ground_450mm": 0.80, "ground_600mm": 0.85, "duct_touching": 0.68, "duct_300mm": 0.78, "duct_450mm": 0.84, "duct_600mm": 0.88}$r$),
    (10, $r${"n_cables": 10, "ground_touching": 0.47, "ground_150mm": 0.62, "ground_300mm": 0.73, "ground_450mm": 0.80, "ground_600mm": 0.85, "duct_touching": 0.67, "duct_300mm": 0.78, "duct_450mm": 0.84, "duct_600mm": 0.88}$r$),
    (11, $r${"n_cables": 11, "ground_touching": 0.45, "ground_150mm": 0.61, "ground_300mm": 0.72, "ground_450mm": 0.80, "ground_600mm": 0.84, "duct_touching": 0.66, "duct_300mm": 0.77, "duct_450mm": 0.84, "duct_600mm": 0.88}$r$),
    (12, $r${"n_cables": 12, "ground_touching": 0.44, "ground_150mm": 0.60, "ground_300mm": 0.72, "ground_450mm": 0.79, "ground_600mm": 0.84, "duct_touching": 0.65, "duct_300mm": 0.77, "duct_450mm": 0.83, "duct_600mm": 0.87}$r$)
) AS v(sort_key, row_data)
WHERE t.code = 'TABLE_6_3_3'
  AND NOT EXISTS (
      SELECT 1 FROM cable_schedule.sans_rows r
      WHERE r.table_id = t.id AND r.sort_key = v.sort_key
  );

-- 2d. TABLE_6_3_4 — ground temperature (SANS T6.11, ref 25 °C; SANS publishes
-- a 70 °C-conductor (PVC) column only — the XLPE column stays Aberdare's,
-- which is physics-consistent (√-law) and unchanged here).
UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"factor_pvc_70c": 0.94}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_3_4' AND r.sort_key = 30;

UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"factor_pvc_70c": 0.88}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_3_4' AND r.sort_key = 35;

UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"factor_pvc_70c": 0.82}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_3_4' AND r.sort_key = 40;

-- 45/50 °C PVC: beyond the SANS T6.11 range (ends 40 °C). Aberdare's linear
-- 0.80/0.70 is optimistic vs the √((70−T)/45) law the SANS column follows —
-- replaced with the √-law values 0.75/0.67, flagged as extrapolated in notes.
UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"factor_pvc_70c": 0.75}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_3_4' AND r.sort_key = 45;

UPDATE cable_schedule.sans_rows r
SET row_data = r.row_data || '{"factor_pvc_70c": 0.67}'::jsonb
FROM cable_schedule.sans_tables t
WHERE r.table_id = t.id AND t.code = 'TABLE_6_3_4' AND r.sort_key = 50;

-- New 10/15/20 °C uprating rows (SANS T6.11, PVC column). SANS publishes no
-- XLPE ground-temperature uprating values — the factor_xlpe_90c key is
-- deliberately OMITTED on these rows so an XLPE lookup returns an honest
-- null instead of an invented number.
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM cable_schedule.sans_tables t,
(VALUES
    (10, $r${"ambient_c": 10, "factor_pvc_70c": 1.15}$r$),
    (15, $r${"ambient_c": 15, "factor_pvc_70c": 1.11}$r$),
    (20, $r${"ambient_c": 20, "factor_pvc_70c": 1.05}$r$)
) AS v(sort_key, row_data)
WHERE t.code = 'TABLE_6_3_4'
  AND NOT EXISTS (
      SELECT 1 FROM cable_schedule.sans_rows r
      WHERE r.table_id = t.id AND r.sort_key = v.sort_key
  );

-- 2e. TABLE_6_3_5 — air temperature (SANS T6.10, ref 30 °C). Existing
-- 30–45 °C cells match SANS/Aberdare — unchanged. SANS continues the PVC
-- column to 65 °C; without these rows the floor-clamp lookup handed a 50 °C
-- site the 45 °C factor (0.79 vs SANS 0.71 — non-conservative), and the
-- SANS-mandated 60 °C factor (0.50) for cables run in thermal insulation was
-- unreachable. SANS/Aberdare publish NO XLPE value above 45 °C — the
-- factor_xlpe_90c key is deliberately omitted so lookups return an honest
-- null rather than a fabricated factor.
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM cable_schedule.sans_tables t,
(VALUES
    (50, $r${"ambient_c": 50, "factor_pvc_70c": 0.71}$r$),
    (55, $r${"ambient_c": 55, "factor_pvc_70c": 0.61}$r$),
    (60, $r${"ambient_c": 60, "factor_pvc_70c": 0.50}$r$),
    (65, $r${"ambient_c": 65, "factor_pvc_70c": 0.35}$r$)
) AS v(sort_key, row_data)
WHERE t.code = 'TABLE_6_3_5'
  AND NOT EXISTS (
      SELECT 1 FROM cable_schedule.sans_rows r
      WHERE r.table_id = t.id AND r.sort_key = v.sort_key
  );

-- ---------------------------------------------------------------------------
-- 3. Metadata corrections
-- ---------------------------------------------------------------------------

-- 3a. The three "soil resistivity by region" tables are actually Aberdare's
-- "Correction factors for DIRECT SOLAR RADIATION" (cables in free air exposed
-- to the sun; 1000 W/m² coastal vs 1250 W/m² highveld design irradiance).
-- The seeded soil framing + DERATING_THERMAL_RESISTIVITY category would lead
-- an engineer (or future category-driven code) to derate a BURIED cable with
-- a solar factor. Values are correct; every label around them was wrong.
-- (The booklet itself misprints the unit as "Ω/m²" — the quantity is solar
-- irradiance in W/m²; the factors themselves are dimensionless multipliers.)
UPDATE cable_schedule.sans_tables SET
    title       = 'Correction factor — direct solar radiation (LV)',
    description = 'Multiplier for cables installed in air and exposed to direct solar radiation — coastal (1000 W/m²) versus highveld (1250 W/m²) design irradiance, by conductor size band. Not applicable to buried cables.',
    columns     = $cols$[{"key":"size_band","label":"Conductor size band","unit":"mm²","type":"string","align":"left","is_key":true},{"key":"factor_coastal","label":"Coastal (1000 W/m²)","unit":"factor","type":"number","align":"right"},{"key":"factor_highveld","label":"Highveld (1250 W/m²)","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
    notes       = 'sort_key is the lower bound of each size band. Applies only to cables in free air in direct sunlight — never combine with buried-cable factors. Source prints the column unit as "Ω/m²" (a misprint); the quantity is solar irradiance in W/m². No SANS 10142-1 equivalent exists for this table.',
    category    = 'DERATING_SOLAR'
WHERE code = 'TABLE_6_3_7';

UPDATE cable_schedule.sans_tables SET
    title       = 'Correction factor — direct solar radiation (MV paper)',
    description = 'Multiplier for cables installed in air and exposed to direct solar radiation — coastal (1000 W/m²) versus highveld (1250 W/m²) design irradiance, by conductor size band. Not applicable to buried cables.',
    columns     = $cols$[{"key":"size_band","label":"Conductor size band","unit":"mm²","type":"string","align":"left","is_key":true},{"key":"factor_coastal","label":"Coastal (1000 W/m²)","unit":"factor","type":"number","align":"right"},{"key":"factor_highveld","label":"Highveld (1250 W/m²)","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
    notes       = 'sort_key is the lower bound of each size band. Applies only to cables in free air in direct sunlight — never combine with buried-cable factors. The raw workbook sheet bleeds Table 5.2 cable data after these five rows — only the five band rows belong to Table 4.3.6.',
    category    = 'DERATING_SOLAR'
WHERE code = 'TABLE_4_3_6';

UPDATE cable_schedule.sans_tables SET
    title       = 'Correction factor — direct solar radiation (MV XLPE)',
    description = 'Multiplier for cables installed in air and exposed to direct solar radiation — coastal (1000 W/m²) versus highveld (1250 W/m²) design irradiance, by conductor size band. Not applicable to buried cables.',
    columns     = $cols$[{"key":"size_band","label":"Conductor size band","unit":"mm²","type":"string","align":"left","is_key":true},{"key":"factor_coastal","label":"Coastal (1000 W/m²)","unit":"factor","type":"number","align":"right"},{"key":"factor_highveld","label":"Highveld (1250 W/m²)","unit":"factor","type":"number","align":"right"}]$cols$::jsonb,
    notes       = 'sort_key is the lower bound of each size band. Applies only to cables in free air in direct sunlight — never combine with buried-cable factors. The p35 print typos the unit as "Ω/m²"; the identical table on p30 prints W/m². One coastal cell (120–185 band) corrected against a source misprint (2026-07 audit).',
    category    = 'DERATING_SOLAR'
WHERE code = 'TABLE_5_2_6';

-- 3b. TABLE_5_2_4 is GROUND temperature, not air. The printed source header
-- reads "Maximum Conductor Temperature (90 °C) — Ground Temperatures"
-- (25 °C = 1.00 is the GROUND reference; the air table, reference 30 °C, is
-- Table 5.2.5). Labelling it air invited double/mis-application.
UPDATE cable_schedule.sans_tables SET
    title       = 'Derating factor — ground temperature (MV XLPE)',
    description = 'Source header: "Maximum Conductor Temperature (90 °C) — Ground Temperatures". Multiplier for ground temperature across the 25–45 °C range (reference 25 °C = 1.00). For air temperature use Table 5.2.5 (reference 30 °C).',
    columns     = $cols$[{"key":"ambient_c","label":"Ground temperature","unit":"°C","type":"number","decimals":0,"align":"right","is_key":true},{"key":"factor","label":"Factor","unit":"factor","type":"number","align":"right"}]$cols$::jsonb
WHERE code = 'TABLE_5_2_4';

-- 3c. TABLE_5_2 diameter columns: the printed header is "Overall Diameter" —
-- an XLPE/PVC-sheathed SWA cable has no lead sheath. Labels fixed; the JSON
-- keys (*_diameter_over_lead_mm) are left untouched so no row_data or
-- consumer-code rename is required.
UPDATE cable_schedule.sans_tables SET
    columns = $cols$[{"key":"size_mm2","label":"Cable Size","unit":"mm²","type":"number","decimals":0,"align":"right","is_key":true},{"key":"cu_current_rating_ground_a","label":"Cu — Current rating (Ground)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"cu_impedance_ohm_per_km","label":"Cu — Impedance","unit":"Ω/km","type":"number","align":"right"},{"key":"cu_short_circuit_1s_ka","label":"Cu — 1s short circuit rating","unit":"kA","type":"number","align":"right"},{"key":"cu_diameter_over_lead_mm","label":"Cu — Overall Diameter","unit":"mm","type":"number","align":"right"},{"key":"cu_mass_kg_per_km","label":"Cu — Approx. Cable Mass","unit":"kg/km","type":"number","decimals":0,"align":"right"},{"key":"al_current_rating_ground_a","label":"Al — Current rating (Ground)","unit":"A","type":"number","decimals":0,"align":"right"},{"key":"al_impedance_ohm_per_km","label":"Al — Impedance","unit":"Ω/km","type":"number","align":"right"},{"key":"al_short_circuit_1s_ka","label":"Al — 1s short circuit rating","unit":"kA","type":"number","align":"right"},{"key":"al_diameter_over_lead_mm","label":"Al — Overall Diameter","unit":"mm","type":"number","align":"right"},{"key":"al_mass_kg_per_km","label":"Al — Approx. Cable Mass","unit":"kg/km","type":"number","decimals":0,"align":"right"}]$cols$::jsonb
WHERE code = 'TABLE_5_2';

-- 3d. TABLE_9_1 honest relabel. The values are verbatim from Aberdare F&F
-- Table 9.1 — the "Electrical properties" datasheet of INTERDAC 3, a
-- 1900/3300 V 3-phase 4-wire XLPE-insulated APL-tape-screened PE-sheathed
-- underground supply cable (stranded Cu phase + same-size tinned-Cu earth
-- core). SANS 10142-1:2017 contains NO Table 9.1 and no such data table —
-- presenting a 3.3 kV product datasheet as a SANS LV earth-conductor design
-- table could lead an engineer to size LV earth-continuity conductors off
-- it. category is plain TEXT (no CHECK / lookup — verified in 00059), so
-- retiring EARTH_CONDUCTOR for this table needs no schema change.
UPDATE cable_schedule.sans_tables SET
    title              = 'INTERDAC 3 (1900/3300 V underground supply cable) — electrical properties',
    standard           = 'Aberdare Facts & Figures (INTERDAC 3, 1.9/3.3 kV)',
    cable_construction = '3-phase 4-wire XLPE insulated, APL tape screened, PE sheathed 1900/3300 V underground supply cable (stranded Cu phase + same-size tinned-Cu earth core)',
    description        = 'Phase/earth conductor DC resistance (20 °C), impedance at operating temperature, in-ground current rating and 1 s short-circuit rating for INTERDAC 3, Aberdare Table 9.1. NOT a SANS 10142-1 earth-conductor sizing table.',
    notes              = 'Manufacturer product data (Aberdare "Innovative Products" ch. 9), not a SANS earthing design table. Resistances are DC at 20 °C; current rating in ground at 25 °C soil, 500 mm depth, 1.2 K·m/W, 90 °C conductor. Section number 9.1 is Aberdare''s, not SANS 10142-1''s. Do not size LV earth-continuity conductors from this table — SANS 10142-1 Tables 6.25 / 6.28 / 8.1 govern that (not yet in this library). 10 mm² 1 s short-circuit cell corrected 0.82 → 1.43 kA against a source misprint (2026-07 audit; k = 143 adiabatic identity).',
    category           = 'MASTER_PROPERTIES',
    applicable_to      = $j${"voltage_class":"MV","conductor":"CU","insulation":"XLPE","armour":"UNARMOURED","cores":[4]}$j$::jsonb,
    source_ref         = 'Aberdare Cables — Facts & Figures, Table 9.1 (INTERDAC 3); transcribed via CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet'
WHERE code = 'TABLE_9_1';

-- 3e. The seven LV derating tables claimed "SANS 1507-3 / 1507-4" — a cable
-- PRODUCT spec that contains no installation derating tables. True lineage:
-- Aberdare F&F §6.3, whose SANS 10142-1:2017 equivalents are Tables
-- 6.10–6.16. Per-table exact SANS reference recorded in notes.
UPDATE cable_schedule.sans_tables SET
    standard = 'Aberdare Facts & Figures §6.3 (cf. SANS 10142-1:2017)',
    notes    = 'Apply multiplicatively with the other derating factors. Use the in-duct column when the cable runs in a single-way duct. SANS 10142-1:2017 equivalent: Table 6.16 (reference depth 0.5 m). Direct-in-ground factors aligned to SANS T6.16 (2026-07 audit); the 2000 mm row is Aberdare-only (beyond the SANS range), its direct factor clamped to the 1500 mm value (0.90) to keep the table monotonic.'
WHERE code = 'TABLE_6_3_1';

UPDATE cable_schedule.sans_tables SET
    standard = 'Aberdare Facts & Figures §6.3 (cf. SANS 10142-1:2017)',
    notes    = 'Apply multiplicatively with the other derating factors. SANS 10142-1:2017 equivalent: Table 6.12 (reference 1.2 K·m/W). Factors aligned to SANS T6.12, including its 0.7–0.9 uprating and 3.0–4.0 K·m/W rows (2026-07 audit). Factors are averaged over the conductor-size range — consult SANS 10198-4 for size-specific factors.'
WHERE code = 'TABLE_6_3_2';

UPDATE cable_schedule.sans_tables SET
    standard = 'Aberdare Facts & Figures §6.3 (cf. SANS 10142-1:2017)',
    notes    = 'Direct-in-ground columns: touching / 150 / 300 / 450 / 600 mm spacing. In-duct columns: touching / 300 / 450 / 600 mm spacing. SANS 10142-1:2017 equivalent: Table 6.13 (single horizontal layer section — identical values). Rows n = 7–12 added from SANS T6.13 (2026-07 audit). SANS T6.13 also tabulates multi-row formations (1-over-2, 2×2, 2×3, 3×3, 4×3) not carried here.'
WHERE code = 'TABLE_6_3_3';

UPDATE cable_schedule.sans_tables SET
    standard = 'Aberdare Facts & Figures §6.3 (cf. SANS 10142-1:2017)',
    notes    = 'Apply multiplicatively with the other derating factors. SANS 10142-1:2017 equivalent: Table 6.11 (reference 25 °C; SANS publishes the 70 °C-conductor column only). PVC 25–40 °C aligned to SANS T6.11; PVC 45/50 °C are EXTRAPOLATED beyond the SANS range via the √((70−T)/45) law (0.75 / 0.67) — Aberdare''s printed 0.80 / 0.70 overstate capacity; 10–20 °C uprating rows from SANS T6.11 (2026-07 audit). XLPE column is Aberdare manufacturer data (physics-consistent); no XLPE value exists for the 10–20 °C rows.'
WHERE code = 'TABLE_6_3_4';

UPDATE cable_schedule.sans_tables SET
    standard = 'Aberdare Facts & Figures §6.3 (cf. SANS 10142-1:2017)',
    notes    = 'Applies to cables installed in air rather than buried. SANS 10142-1:2017 equivalent: Table 6.10 (reference 30 °C; PVC column identical 30–45 °C; SANS publishes no XLPE column). PVC rows 50–65 °C added from SANS T6.10 (2026-07 audit) — SANS mandates the 60 °C factor for cables run inside thermal insulation. No XLPE value is published above 45 °C: the XLPE key is omitted on those rows, so lookups return null rather than an invented factor.'
WHERE code = 'TABLE_6_3_5';

UPDATE cable_schedule.sans_tables SET
    standard = 'Aberdare Facts & Figures §6.3 (cf. SANS 10142-1:2017)',
    notes    = 'Use the touching column as the conservative default when the trench layout is not yet known. SANS 10142-1:2017 nearest equivalent: Table 6.14, SIMPLIFIED — SANS T6.14 is per-formation (~17 rows) and materially more conservative for enclosed/bunched groups (e.g. n=6 bunched 0.57 vs 0.80 here); these values sit closest to SANS''s single-core-on-tray/ladder rows. Ladder-installed cables with clearance > 2× overall diameter (or > 150 mm) need no grouping derating (Aberdare p45 note = SANS note b). For BURIED groups use Table 6.3.3, not this in-air table.'
WHERE code = 'TABLE_6_3_6';

-- (TABLE_6_3_7 standard: same correction, folded into its 3a UPDATE above —
-- it needs the solar retitle anyway. Set its standard here for symmetry.)
UPDATE cable_schedule.sans_tables SET
    standard = 'Aberdare Facts & Figures §6.3 (cf. SANS 10142-1:2017)'
WHERE code = 'TABLE_6_3_7';

-- 3f. LV master tables 6.2–6.7 — record the SANS/Aberdare reference
-- conditions the ratings assume (previously unstated: notes were NULL), and
-- credit the true source. Tables with corrected cells carry an audit note.
UPDATE cable_schedule.sans_tables SET
    notes      = 'Reference conditions: 30 °C air / 25 °C ground / soil thermal resistivity 1.2 K·m/W / depth of laying 0.5 m; conductor temperature 70 °C (PVC); single circuit. Apply the Table 6.3.1–6.3.6 correction factors for any other installation condition. 1 cell corrected against source misprints (2026-07): 2.5 mm² 3φ volt drop.',
    source_ref = 'Aberdare Cables — Facts & Figures, Table 6.2 (cables to SANS 1507-3); transcribed via CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet'
WHERE code = 'TABLE_6_2';

UPDATE cable_schedule.sans_tables SET
    notes      = 'Reference conditions: 30 °C air / 25 °C ground / soil thermal resistivity 1.2 K·m/W / depth of laying 0.5 m; conductor temperature 70 °C (PVC); single circuit. Apply the Table 6.3.1–6.3.6 correction factors for any other installation condition.',
    source_ref = 'Aberdare Cables — Facts & Figures, Table 6.3 (cables to SANS 1507-3); transcribed via CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet'
WHERE code = 'TABLE_6_3';

UPDATE cable_schedule.sans_tables SET
    notes      = 'Reference conditions: 30 °C air / 25 °C ground / soil thermal resistivity 1.2 K·m/W / depth of laying 0.5 m; single circuit. Rating columns are published at BOTH 70 °C and 90 °C conductor temperature (see column labels). Apply the Table 6.3.1–6.3.6 correction factors for any other installation condition. 1 cell corrected against source misprints (2026-07): 70 mm² D1 (4-core).',
    source_ref = 'Aberdare Cables — Facts & Figures, Table 6.4 (cables to SANS 1507-4); transcribed via CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet'
WHERE code = 'TABLE_6_4';

UPDATE cable_schedule.sans_tables SET
    notes      = 'Current ratings are on the 90 °C conductor-temperature basis (XLPE). Reference conditions: 30 °C air / 25 °C ground / soil thermal resistivity 1.2 K·m/W / depth of laying 0.5 m; single circuit. Apply the Table 6.3.1–6.3.6 correction factors for any other installation condition. Note when comparing against Table 6.4: its unsuffixed columns are 70 °C — use its 90 °C columns for a like-for-like comparison.',
    source_ref = 'Aberdare Cables — Facts & Figures, Table 6.5 (cables to SANS 1507-4); transcribed via CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet'
WHERE code = 'TABLE_6_5';

UPDATE cable_schedule.sans_tables SET
    notes      = 'Reference conditions: 30 °C air / 25 °C ground / soil thermal resistivity 1.2 K·m/W / depth of laying 0.5 m; conductor temperature 70 °C (PVC); single circuit. Apply the Table 6.3.1–6.3.6 correction factors for any other installation condition. SANS 10142-1 publishes no single-core buried/duct ratings — this manufacturer table is the authoritative source for those columns.',
    source_ref = 'Aberdare Cables — Facts & Figures, Table 6.6 (cables to SANS 1507-3); transcribed via CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet'
WHERE code = 'TABLE_6_6';

UPDATE cable_schedule.sans_tables SET
    notes      = 'Reference conditions: 30 °C air / 25 °C ground / soil thermal resistivity 1.2 K·m/W / depth of laying 0.5 m; conductor temperature 90 °C (XLPE); single circuit. Apply the Table 6.3.1–6.3.6 correction factors for any other installation condition. SANS 10142-1 publishes no single-core buried/duct ratings — this manufacturer table is the authoritative source for those columns. 4 cells corrected against source misprints (2026-07): 35 mm² 3φ volt drop, 50 mm² impedance, 70 mm² 1φ air rating, 630 mm² impedance.',
    source_ref = 'Aberdare Cables — Facts & Figures, Table 6.7 (cables to SANS 1507-4); transcribed via CABLE SCHEDULE PMM.xlsx :: FACTS AND FIGURES sheet'
WHERE code = 'TABLE_6_7';

-- ---------------------------------------------------------------------------
-- 4. Seed TABLE_5_3 — MV XLPE 1 s earth-fault ratings
-- ---------------------------------------------------------------------------
-- Deferred by 00058 as a "corrupt extraction" — the workbook extraction bled
-- neighbouring tables, but the printed table itself is tiny and clean:
-- Aberdare §5.4 / Table 5.3, "Typical 1 second Earth Fault ratings for XLPE
-- insulated 6,35/11 kV Type A cables to SANS 1339-1991" (earth-fault path =
-- copper-tape screen + steel-wire armour). Complements TABLE_5_2 (same cable
-- family) for MV earth-fault withstand checks.
-- Idempotent: delete-then-insert, same as every other seed migration.

DELETE FROM cable_schedule.sans_tables WHERE code = 'TABLE_5_3';

WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, notes, source_ref, category, applicable_to
    ) VALUES (
        'TABLE_5_3',
        'Typical 1 second earth-fault ratings — 3-core XLPE 6.35/11 kV (SANS 1339 Type A)',
        'Aberdare Facts & Figures §5.4 (cables to SANS 1339)',
        '5.3',
        '3-core XLPE SWA 6.35/11 kV, individually screened (Type A)',
        'Typical 1 second earth-fault withstand of the earth-fault return path (copper-tape screen + steel-wire armour) for XLPE insulated 6.35/11 kV Type A cables to SANS 1339-1991, by conductor size.',
        $cols$[{"key":"size_mm2","label":"Cable Size","unit":"mm²","type":"number","decimals":0,"align":"right","is_key":true},{"key":"earth_fault_1s_ka","label":"1 s Earth Fault Rating","unit":"kA","type":"number","align":"right"}]$cols$::jsonb,
        'Manufacturer TYPICAL values (screen + armour construction dependent) — verify against the delivered cable''s datasheet for contract work. This is not a SANS 10142-1 table.',
        'Aberdare Cables — Facts & Figures, Table 5.3 (§5.4); extracted from the printed booklet 2026-07 (the workbook''s extraction of this table was corrupt and was never seeded by 00058)',
        'EARTH_FAULT_RATING',
        $j${"voltage_class":"MV","conductor":"ANY","insulation":"XLPE","armour":"SWA","cores":[3]}$j$::jsonb
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, v.sort_key, v.row_data::jsonb
FROM t,
(VALUES
    (25,  $r${"size_mm2": 25,  "earth_fault_1s_ka": 10.4}$r$),
    (35,  $r${"size_mm2": 35,  "earth_fault_1s_ka": 12.2}$r$),
    (50,  $r${"size_mm2": 50,  "earth_fault_1s_ka": 13.1}$r$),
    (70,  $r${"size_mm2": 70,  "earth_fault_1s_ka": 17.6}$r$),
    (95,  $r${"size_mm2": 95,  "earth_fault_1s_ka": 18.7}$r$),
    (120, $r${"size_mm2": 120, "earth_fault_1s_ka": 19.7}$r$),
    (150, $r${"size_mm2": 150, "earth_fault_1s_ka": 20.8}$r$),
    (185, $r${"size_mm2": 185, "earth_fault_1s_ka": 25.0}$r$),
    (240, $r${"size_mm2": 240, "earth_fault_1s_ka": 26.8}$r$),
    (300, $r${"size_mm2": 300, "earth_fault_1s_ka": 28.6}$r$)
) AS v(sort_key, row_data);

-- ---------------------------------------------------------------------------
-- Data-only migration (UPDATEs + row inserts + one new sans_tables row).
-- No schema was created or dropped, so the PostgREST db_schema config PATCH
-- (see CLAUDE.md "Key gotchas") is NOT required — the NOTIFY below is enough.
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
