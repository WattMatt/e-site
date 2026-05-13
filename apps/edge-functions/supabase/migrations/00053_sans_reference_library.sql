-- =============================================================================
-- Migration 00053 — SANS reference library: schema + bundled seed
-- =============================================================================
-- Per spec §10:
--   "All tables must be embedded with the same table structure, column
--    headings, and section numbering as the source workbook so an
--    engineer can reference them inside the app. Each table is
--    read-only and version-stamped against its standard."
--
-- Modelled as generic table-of-tables (a row in sans_tables + N rows in
-- sans_rows with row_data JSONB). This way one schema serves every SANS
-- reference table (4.2 / 4.3.x / 5.2 / 6.x / 7.x / 8.x / 9.x) without
-- 25+ bespoke schemas. The TypeScript layer provides typed accessors per
-- standard.
--
-- Bundled tables are owned by the system (no organisation_id). Per-
-- project overrides (when an Excel F&F sheet is imported) live in a
-- separate sans_overrides table — same row shape but scoped per project.
-- This migration ships only the bundled schema + the seed for Table 6.4
-- (4-core XLPE/SWA/PVC to SANS 1507-4) and derating Tables 6.3.1–6.3.5.
-- More tables land via follow-up seed migrations as the data is
-- transcribed from the firm's standard FACTS AND FIGURES sheet.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. sans_tables: one row per logical reference table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cable_schedule.sans_tables (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Unique stable code matching the workbook (e.g. "TABLE_6_4",
    -- "TABLE_6_3_1"). Lets app code address tables by name without
    -- depending on UUIDs.
    code                TEXT NOT NULL UNIQUE,
    title               TEXT NOT NULL,
    standard            TEXT NOT NULL,    -- "SANS 1507-4", "SANS 1339"
    section_number      TEXT,             -- "6.4", "6.3.1"
    cable_construction  TEXT,             -- "4-core XLPE SWA PVC-sheathed 600/1000 V"
    description         TEXT,             -- short summary shown above table
    -- Column definitions for the rendering layer. Array of
    -- { key, label, unit?, type, width?, align?, decimals? }.
    columns             JSONB NOT NULL,
    -- Optional human-readable footnotes shown beneath the table.
    notes               TEXT,
    -- Source of the data (e.g. "Aberdare Datasheet rev 2024",
    -- "SANS 1507-4:2017"). For audit + drift tracking.
    source_ref          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sans_tables_standard
    ON cable_schedule.sans_tables(standard);

CREATE TRIGGER sans_tables_updated_at
    BEFORE UPDATE ON cable_schedule.sans_tables
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. sans_rows: row data for each table, keyed by stable lookup key
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cable_schedule.sans_rows (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id            UUID NOT NULL REFERENCES cable_schedule.sans_tables(id) ON DELETE CASCADE,
    -- Sort order within the table (ascending). For current-rating tables
    -- this is the conductor size; for derating tables this is an index.
    sort_key            NUMERIC NOT NULL,
    -- Free-form row payload matching the columns definition. Keys must
    -- match a column.key from sans_tables.columns.
    row_data            JSONB NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sans_rows_table
    ON cable_schedule.sans_rows(table_id, sort_key);

-- ---------------------------------------------------------------------------
-- 3. sans_overrides: per-project override library
-- ---------------------------------------------------------------------------
-- When an engineer imports a project-specific FACTS AND FIGURES sheet
-- (§16.11), the parsed tables land here. The app uses overrides where
-- present, falls back to the bundled library otherwise.
CREATE TABLE IF NOT EXISTS cable_schedule.sans_overrides (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organisation_id     UUID NOT NULL REFERENCES public.organisations(id),
    table_code          TEXT NOT NULL,     -- matches sans_tables.code
    columns             JSONB NOT NULL,
    rows                JSONB NOT NULL,    -- array of row_data objects
    source_ref          TEXT,
    notes               TEXT,
    created_by          UUID REFERENCES public.profiles(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, table_code)
);

CREATE INDEX IF NOT EXISTS idx_sans_overrides_project
    ON cable_schedule.sans_overrides(project_id);

CREATE TRIGGER sans_overrides_updated_at
    BEFORE UPDATE ON cable_schedule.sans_overrides
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Bundled library: readable by everyone, writable only by service_role.
ALTER TABLE cable_schedule.sans_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE cable_schedule.sans_rows   ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sans_tables_world_read" ON cable_schedule.sans_tables FOR SELECT USING (true);
CREATE POLICY "sans_rows_world_read"   ON cable_schedule.sans_rows   FOR SELECT USING (true);

-- Overrides: per-org write, scoped client_viewer read.
ALTER TABLE cable_schedule.sans_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sans_ov_select"
    ON cable_schedule.sans_overrides FOR SELECT
    USING (
        organisation_id = ANY(public.get_user_org_ids())
        AND (
            NOT public.user_is_client_viewer(organisation_id)
            OR EXISTS (
                SELECT 1 FROM projects.project_members pm
                WHERE pm.project_id = sans_overrides.project_id
                  AND pm.user_id   = auth.uid()
                  AND pm.is_active = TRUE
            )
        )
    );
CREATE POLICY "sans_ov_write" ON cable_schedule.sans_overrides FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

-- Inherit the cable_schedule default privileges from migration 00052.

-- ===========================================================================
-- SEED: Table 6.4 — 4-core XLPE/SWA/PVC 600/1000 V to SANS 1507-4
-- ===========================================================================
-- Standard published current ratings + DC/AC resistance for copper.
-- Source: SANS 1507-4:2017 + Aberdare Cables technical data manual.
-- Ratings shown are at conductor temperature 90 °C, ambient 30 °C,
-- ground thermal resistivity 1.0 K·m/W, depth of laying 0.5 m, ungrouped.

WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, cable_construction,
        description, columns, source_ref
    ) VALUES (
        'TABLE_6_4',
        '4-core XLPE/SWA/PVC 600/1000 V — current rating + impedance',
        'SANS 1507-4',
        '6.4',
        '4-core XLPE SWA PVC-sheathed 600/1000 V copper conductor',
        'Base current ratings at 90 °C conductor, 30 °C ambient, ' ||
            '1.0 K·m/W thermal resistivity, depth 0.5 m, ungrouped. ' ||
            'Apply derating factors from Tables 6.3.1–6.3.5 for ' ||
            'installation conditions other than reference.',
        $$[
            {"key": "size_mm2",            "label": "Size",             "unit": "mm²",   "type": "number", "decimals": 0, "align": "right"},
            {"key": "rating_direct_buried","label": "Direct buried",    "unit": "A",     "type": "number", "decimals": 0, "align": "right"},
            {"key": "rating_in_duct",      "label": "In duct (ground)", "unit": "A",     "type": "number", "decimals": 0, "align": "right"},
            {"key": "rating_in_air",       "label": "In air",           "unit": "A",     "type": "number", "decimals": 0, "align": "right"},
            {"key": "dc_resistance",       "label": "DC R @ 20 °C",     "unit": "Ω/km",  "type": "number", "decimals": 4, "align": "right"},
            {"key": "ac_resistance",       "label": "AC R @ 90 °C",     "unit": "Ω/km",  "type": "number", "decimals": 4, "align": "right"},
            {"key": "reactance",           "label": "Reactance",        "unit": "Ω/km",  "type": "number", "decimals": 4, "align": "right"},
            {"key": "short_circuit_1s",    "label": "1 s SC rating",    "unit": "kA",    "type": "number", "decimals": 2, "align": "right"}
        ]$$::jsonb,
        'SANS 1507-4:2017; Aberdare Cables technical manual'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, r.sort_key, r.row_data::jsonb
FROM t,
LATERAL (VALUES
    (1.5,   '{"size_mm2": 1.5,   "rating_direct_buried": 27,   "rating_in_duct": 22,   "rating_in_air": 23,   "dc_resistance": 12.1000, "ac_resistance": 12.1000, "reactance": 0.1080, "short_circuit_1s": 0.21}'),
    (2.5,   '{"size_mm2": 2.5,   "rating_direct_buried": 36,   "rating_in_duct": 29,   "rating_in_air": 31,   "dc_resistance": 7.4100,  "ac_resistance": 7.4100,  "reactance": 0.1020, "short_circuit_1s": 0.36}'),
    (4,     '{"size_mm2": 4,     "rating_direct_buried": 46,   "rating_in_duct": 37,   "rating_in_air": 41,   "dc_resistance": 4.6100,  "ac_resistance": 4.6100,  "reactance": 0.0960, "short_circuit_1s": 0.57}'),
    (6,     '{"size_mm2": 6,     "rating_direct_buried": 56,   "rating_in_duct": 46,   "rating_in_air": 52,   "dc_resistance": 3.0800,  "ac_resistance": 3.0800,  "reactance": 0.0940, "short_circuit_1s": 0.86}'),
    (10,    '{"size_mm2": 10,    "rating_direct_buried": 75,   "rating_in_duct": 61,   "rating_in_air": 72,   "dc_resistance": 1.8300,  "ac_resistance": 1.8300,  "reactance": 0.0900, "short_circuit_1s": 1.43}'),
    (16,    '{"size_mm2": 16,    "rating_direct_buried": 98,   "rating_in_duct": 79,   "rating_in_air": 96,   "dc_resistance": 1.1500,  "ac_resistance": 1.1600,  "reactance": 0.0860, "short_circuit_1s": 2.29}'),
    (25,    '{"size_mm2": 25,    "rating_direct_buried": 127,  "rating_in_duct": 102,  "rating_in_air": 126,  "dc_resistance": 0.7270,  "ac_resistance": 0.7340,  "reactance": 0.0860, "short_circuit_1s": 3.58}'),
    (35,    '{"size_mm2": 35,    "rating_direct_buried": 154,  "rating_in_duct": 123,  "rating_in_air": 156,  "dc_resistance": 0.5240,  "ac_resistance": 0.5310,  "reactance": 0.0830, "short_circuit_1s": 5.01}'),
    (50,    '{"size_mm2": 50,    "rating_direct_buried": 184,  "rating_in_duct": 147,  "rating_in_air": 189,  "dc_resistance": 0.3870,  "ac_resistance": 0.3930,  "reactance": 0.0810, "short_circuit_1s": 7.15}'),
    (70,    '{"size_mm2": 70,    "rating_direct_buried": 230,  "rating_in_duct": 184,  "rating_in_air": 240,  "dc_resistance": 0.2680,  "ac_resistance": 0.2750,  "reactance": 0.0790, "short_circuit_1s": 10.01}'),
    (95,    '{"size_mm2": 95,    "rating_direct_buried": 279,  "rating_in_duct": 222,  "rating_in_air": 293,  "dc_resistance": 0.1930,  "ac_resistance": 0.2010,  "reactance": 0.0770, "short_circuit_1s": 13.59}'),
    (120,   '{"size_mm2": 120,   "rating_direct_buried": 320,  "rating_in_duct": 254,  "rating_in_air": 339,  "dc_resistance": 0.1530,  "ac_resistance": 0.1620,  "reactance": 0.0760, "short_circuit_1s": 17.16}'),
    (150,   '{"size_mm2": 150,   "rating_direct_buried": 364,  "rating_in_duct": 289,  "rating_in_air": 390,  "dc_resistance": 0.1240,  "ac_resistance": 0.1340,  "reactance": 0.0760, "short_circuit_1s": 21.45}'),
    (185,   '{"size_mm2": 185,   "rating_direct_buried": 414,  "rating_in_duct": 328,  "rating_in_air": 446,  "dc_resistance": 0.0991,  "ac_resistance": 0.1100,  "reactance": 0.0760, "short_circuit_1s": 26.46}'),
    (240,   '{"size_mm2": 240,   "rating_direct_buried": 480,  "rating_in_duct": 380,  "rating_in_air": 524,  "dc_resistance": 0.0754,  "ac_resistance": 0.0879,  "reactance": 0.0760, "short_circuit_1s": 34.32}'),
    (300,   '{"size_mm2": 300,   "rating_direct_buried": 543,  "rating_in_duct": 430,  "rating_in_air": 600,  "dc_resistance": 0.0601,  "ac_resistance": 0.0742,  "reactance": 0.0750, "short_circuit_1s": 42.90}'),
    (400,   '{"size_mm2": 400,   "rating_direct_buried": 615,  "rating_in_duct": 487,  "rating_in_air": 690,  "dc_resistance": 0.0470,  "ac_resistance": 0.0630,  "reactance": 0.0750, "short_circuit_1s": 57.20}')
) AS r(sort_key, row_data);

-- ===========================================================================
-- SEED: Table 6.3.1 — Derating: depth of laying (cable in ground)
-- ===========================================================================
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, description, columns, source_ref
    ) VALUES (
        'TABLE_6_3_1',
        'Derating factor — depth of laying',
        'SANS 1507-3 / 1507-4',
        '6.3.1',
        'Multiplier applied to base current rating when the cable is ' ||
            'buried at a depth other than the reference 0.5 m.',
        $$[
            {"key": "depth_mm",  "label": "Depth",  "unit": "mm", "type": "number", "decimals": 0, "align": "right"},
            {"key": "factor",    "label": "Factor", "unit": null, "type": "number", "decimals": 3, "align": "right"}
        ]$$::jsonb,
        'SANS 1507:2017 Annex B'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, r.sort_key, r.row_data::jsonb
FROM t,
LATERAL (VALUES
    (400,  '{"depth_mm": 400,  "factor": 1.020}'),
    (500,  '{"depth_mm": 500,  "factor": 1.000}'),
    (600,  '{"depth_mm": 600,  "factor": 0.985}'),
    (800,  '{"depth_mm": 800,  "factor": 0.965}'),
    (1000, '{"depth_mm": 1000, "factor": 0.945}'),
    (1250, '{"depth_mm": 1250, "factor": 0.925}'),
    (1500, '{"depth_mm": 1500, "factor": 0.910}'),
    (1750, '{"depth_mm": 1750, "factor": 0.900}'),
    (2000, '{"depth_mm": 2000, "factor": 0.890}'),
    (2500, '{"depth_mm": 2500, "factor": 0.875}'),
    (3000, '{"depth_mm": 3000, "factor": 0.860}')
) AS r(sort_key, row_data);

-- ===========================================================================
-- SEED: Table 6.3.2 — Derating: soil thermal resistivity
-- ===========================================================================
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, description, columns, source_ref
    ) VALUES (
        'TABLE_6_3_2',
        'Derating factor — soil thermal resistivity',
        'SANS 1507-3 / 1507-4',
        '6.3.2',
        'Multiplier applied for soil thermal resistivity other than 1.0 K·m/W.',
        $$[
            {"key": "resistivity_kmw", "label": "Thermal resistivity", "unit": "K·m/W", "type": "number", "decimals": 1, "align": "right"},
            {"key": "factor",          "label": "Factor",              "unit": null,    "type": "number", "decimals": 3, "align": "right"}
        ]$$::jsonb,
        'SANS 1507:2017 Annex B'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, r.sort_key, r.row_data::jsonb
FROM t,
LATERAL (VALUES
    (0.7, '{"resistivity_kmw": 0.7, "factor": 1.140}'),
    (0.8, '{"resistivity_kmw": 0.8, "factor": 1.090}'),
    (0.9, '{"resistivity_kmw": 0.9, "factor": 1.040}'),
    (1.0, '{"resistivity_kmw": 1.0, "factor": 1.000}'),
    (1.2, '{"resistivity_kmw": 1.2, "factor": 0.930}'),
    (1.5, '{"resistivity_kmw": 1.5, "factor": 0.850}'),
    (2.0, '{"resistivity_kmw": 2.0, "factor": 0.760}'),
    (2.5, '{"resistivity_kmw": 2.5, "factor": 0.700}'),
    (3.0, '{"resistivity_kmw": 3.0, "factor": 0.650}')
) AS r(sort_key, row_data);

-- ===========================================================================
-- SEED: Table 6.3.3 — Derating: number of cables in a group
-- ===========================================================================
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, description, columns, source_ref
    ) VALUES (
        'TABLE_6_3_3',
        'Derating factor — number of cables in a group',
        'SANS 1507-3 / 1507-4',
        '6.3.3',
        'Multiplier applied when N multi-core cables are buried in a single trench, touching.',
        $$[
            {"key": "n_cables", "label": "Number in group", "unit": null, "type": "number", "decimals": 0, "align": "right"},
            {"key": "factor",   "label": "Factor",          "unit": null, "type": "number", "decimals": 3, "align": "right"}
        ]$$::jsonb,
        'SANS 1507:2017 Annex B'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, r.sort_key, r.row_data::jsonb
FROM t,
LATERAL (VALUES
    (1,  '{"n_cables": 1,  "factor": 1.000}'),
    (2,  '{"n_cables": 2,  "factor": 0.870}'),
    (3,  '{"n_cables": 3,  "factor": 0.770}'),
    (4,  '{"n_cables": 4,  "factor": 0.720}'),
    (5,  '{"n_cables": 5,  "factor": 0.680}'),
    (6,  '{"n_cables": 6,  "factor": 0.650}'),
    (7,  '{"n_cables": 7,  "factor": 0.620}'),
    (8,  '{"n_cables": 8,  "factor": 0.600}'),
    (9,  '{"n_cables": 9,  "factor": 0.580}'),
    (10, '{"n_cables": 10, "factor": 0.570}')
) AS r(sort_key, row_data);

-- ===========================================================================
-- SEED: Table 6.3.4 — Derating: ambient temperature (XLPE 90 °C conductor)
-- ===========================================================================
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, description, columns, source_ref
    ) VALUES (
        'TABLE_6_3_4',
        'Derating factor — ambient temperature (XLPE 90 °C)',
        'SANS 1507-4',
        '6.3.4',
        'Multiplier for ambient temperature other than reference 30 °C, XLPE 90 °C conductor.',
        $$[
            {"key": "ambient_c", "label": "Ambient", "unit": "°C", "type": "number", "decimals": 0, "align": "right"},
            {"key": "factor",    "label": "Factor",  "unit": null, "type": "number", "decimals": 3, "align": "right"}
        ]$$::jsonb,
        'SANS 1507-4:2017 Annex B'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, r.sort_key, r.row_data::jsonb
FROM t,
LATERAL (VALUES
    (15, '{"ambient_c": 15, "factor": 1.130}'),
    (20, '{"ambient_c": 20, "factor": 1.090}'),
    (25, '{"ambient_c": 25, "factor": 1.040}'),
    (30, '{"ambient_c": 30, "factor": 1.000}'),
    (35, '{"ambient_c": 35, "factor": 0.960}'),
    (40, '{"ambient_c": 40, "factor": 0.910}'),
    (45, '{"ambient_c": 45, "factor": 0.870}'),
    (50, '{"ambient_c": 50, "factor": 0.820}'),
    (55, '{"ambient_c": 55, "factor": 0.760}'),
    (60, '{"ambient_c": 60, "factor": 0.710}')
) AS r(sort_key, row_data);

-- ===========================================================================
-- SEED: Table 6.3.5 — Derating: ambient temperature (PVC 70 °C conductor)
-- ===========================================================================
WITH t AS (
    INSERT INTO cable_schedule.sans_tables (
        code, title, standard, section_number, description, columns, source_ref
    ) VALUES (
        'TABLE_6_3_5',
        'Derating factor — ambient temperature (PVC 70 °C)',
        'SANS 1507-3',
        '6.3.5',
        'Multiplier for ambient temperature other than reference 30 °C, PVC 70 °C conductor.',
        $$[
            {"key": "ambient_c", "label": "Ambient", "unit": "°C", "type": "number", "decimals": 0, "align": "right"},
            {"key": "factor",    "label": "Factor",  "unit": null, "type": "number", "decimals": 3, "align": "right"}
        ]$$::jsonb,
        'SANS 1507-3:2017 Annex B'
    )
    RETURNING id
)
INSERT INTO cable_schedule.sans_rows (table_id, sort_key, row_data)
SELECT t.id, r.sort_key, r.row_data::jsonb
FROM t,
LATERAL (VALUES
    (15, '{"ambient_c": 15, "factor": 1.170}'),
    (20, '{"ambient_c": 20, "factor": 1.120}'),
    (25, '{"ambient_c": 25, "factor": 1.060}'),
    (30, '{"ambient_c": 30, "factor": 1.000}'),
    (35, '{"ambient_c": 35, "factor": 0.940}'),
    (40, '{"ambient_c": 40, "factor": 0.870}'),
    (45, '{"ambient_c": 45, "factor": 0.790}'),
    (50, '{"ambient_c": 50, "factor": 0.710}'),
    (55, '{"ambient_c": 55, "factor": 0.610}')
) AS r(sort_key, row_data);

NOTIFY pgrst, 'reload schema';
