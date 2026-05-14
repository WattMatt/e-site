-- =============================================================================
-- Migration 00059 — SANS reference library: category + applicability metadata
-- =============================================================================
-- Adds the two metadata fields the SANS_Reference_Library.xlsx sheets carry
-- in their header block but the seeded rows did not:
--
--   category       TEXT   — table type (MASTER_PROPERTIES, DERATING_DEPTH,
--                           DERATING_TEMPERATURE, EARTH_CONDUCTOR, …)
--   applicable_to  JSONB  — { voltage_class, conductor, insulation, armour,
--                           cores } — which cable construction the table is for
--
-- Master + earth tables use the verified values from the bootstrap data/*.json
-- files. Derating suites use the applicability of the standard they are
-- published for (SANS 1507 LV / SANS 97 MV paper / SANS 1339 MV XLPE).
-- Both columns are nullable — no backfill default, every seeded row is set
-- explicitly below.
-- =============================================================================

ALTER TABLE cable_schedule.sans_tables
    ADD COLUMN IF NOT EXISTS category      TEXT,
    ADD COLUMN IF NOT EXISTS applicable_to JSONB;

UPDATE cable_schedule.sans_tables SET
    category      = 'MASTER_PROPERTIES',
    applicable_to = $j${"voltage_class":"MV","conductor":"BOTH","insulation":"PAPER","armour":"STA","cores":[3]}$j$::jsonb
    WHERE code = 'TABLE_4_2';
UPDATE cable_schedule.sans_tables SET
    category      = 'MASTER_PROPERTIES',
    applicable_to = $j${"voltage_class":"MV","conductor":"BOTH","insulation":"XLPE","armour":"SWA","cores":[3]}$j$::jsonb
    WHERE code = 'TABLE_5_2';
UPDATE cable_schedule.sans_tables SET
    category      = 'MASTER_PROPERTIES',
    applicable_to = $j${"voltage_class":"LV","conductor":"CU","insulation":"PVC","armour":"SWA","cores":[3,4]}$j$::jsonb
    WHERE code = 'TABLE_6_2';
UPDATE cable_schedule.sans_tables SET
    category      = 'MASTER_PROPERTIES',
    applicable_to = $j${"voltage_class":"LV","conductor":"AL","insulation":"PVC","armour":"SWA","cores":[3,4]}$j$::jsonb
    WHERE code = 'TABLE_6_3';
UPDATE cable_schedule.sans_tables SET
    category      = 'MASTER_PROPERTIES',
    applicable_to = $j${"voltage_class":"LV","conductor":"CU","insulation":"XLPE","armour":"SWA","cores":[3,4]}$j$::jsonb
    WHERE code = 'TABLE_6_4';
UPDATE cable_schedule.sans_tables SET
    category      = 'MASTER_PROPERTIES',
    applicable_to = $j${"voltage_class":"LV","conductor":"AL","insulation":"XLPE","armour":"SWA","cores":[3,4]}$j$::jsonb
    WHERE code = 'TABLE_6_5';
UPDATE cable_schedule.sans_tables SET
    category      = 'MASTER_PROPERTIES',
    applicable_to = $j${"voltage_class":"LV","conductor":"CU","insulation":"PVC","armour":"UNARMOURED","cores":[1]}$j$::jsonb
    WHERE code = 'TABLE_6_6';
UPDATE cable_schedule.sans_tables SET
    category      = 'MASTER_PROPERTIES',
    applicable_to = $j${"voltage_class":"LV","conductor":"CU","insulation":"XLPE","armour":"UNARMOURED","cores":[1]}$j$::jsonb
    WHERE code = 'TABLE_6_7';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_DEPTH',
    applicable_to = $j${"voltage_class":"LV","conductor":"ANY","insulation":"ANY","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_6_3_1';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_THERMAL_RESISTIVITY',
    applicable_to = $j${"voltage_class":"LV","conductor":"ANY","insulation":"ANY","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_6_3_2';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_SPACING',
    applicable_to = $j${"voltage_class":"LV","conductor":"ANY","insulation":"ANY","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_6_3_3';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_TEMPERATURE',
    applicable_to = $j${"voltage_class":"LV","conductor":"ANY","insulation":"ANY","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_6_3_4';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_TEMPERATURE',
    applicable_to = $j${"voltage_class":"LV","conductor":"ANY","insulation":"ANY","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_6_3_5';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_GROUPING',
    applicable_to = $j${"voltage_class":"LV","conductor":"ANY","insulation":"ANY","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_6_3_6';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_THERMAL_RESISTIVITY',
    applicable_to = $j${"voltage_class":"LV","conductor":"ANY","insulation":"ANY","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_6_3_7';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_DEPTH',
    applicable_to = $j${"voltage_class":"MV","conductor":"ANY","insulation":"PAPER","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_4_3_1';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_THERMAL_RESISTIVITY',
    applicable_to = $j${"voltage_class":"MV","conductor":"ANY","insulation":"PAPER","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_4_3_2';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_SPACING',
    applicable_to = $j${"voltage_class":"MV","conductor":"ANY","insulation":"PAPER","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_4_3_3';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_TEMPERATURE',
    applicable_to = $j${"voltage_class":"MV","conductor":"ANY","insulation":"PAPER","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_4_3_4';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_TEMPERATURE',
    applicable_to = $j${"voltage_class":"MV","conductor":"ANY","insulation":"PAPER","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_4_3_5';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_THERMAL_RESISTIVITY',
    applicable_to = $j${"voltage_class":"MV","conductor":"ANY","insulation":"PAPER","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_4_3_6';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_DEPTH',
    applicable_to = $j${"voltage_class":"MV","conductor":"ANY","insulation":"XLPE","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_5_2_1';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_THERMAL_RESISTIVITY',
    applicable_to = $j${"voltage_class":"MV","conductor":"ANY","insulation":"XLPE","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_5_2_2';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_SPACING',
    applicable_to = $j${"voltage_class":"MV","conductor":"ANY","insulation":"XLPE","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_5_2_3';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_TEMPERATURE',
    applicable_to = $j${"voltage_class":"MV","conductor":"ANY","insulation":"XLPE","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_5_2_4';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_TEMPERATURE',
    applicable_to = $j${"voltage_class":"MV","conductor":"ANY","insulation":"XLPE","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_5_2_5';
UPDATE cable_schedule.sans_tables SET
    category      = 'DERATING_THERMAL_RESISTIVITY',
    applicable_to = $j${"voltage_class":"MV","conductor":"ANY","insulation":"XLPE","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_5_2_6';
UPDATE cable_schedule.sans_tables SET
    category      = 'CONDUCTOR_PROPERTIES',
    applicable_to = $j${"voltage_class":"LV","conductor":"BOTH","insulation":"ANY","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_6_9';
UPDATE cable_schedule.sans_tables SET
    category      = 'EARTH_CONDUCTOR',
    applicable_to = $j${"voltage_class":"LV","conductor":"CU","insulation":"ANY","armour":"ANY","cores":"ANY"}$j$::jsonb
    WHERE code = 'TABLE_9_1';

NOTIFY pgrst, 'reload schema';
