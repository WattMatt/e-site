-- ---------------------------------------------------------------------------
-- Migration 00221: a project delete no longer fails on orphaned meter channels
-- ---------------------------------------------------------------------------
-- Solar release assembly (after 00207 #218, and the Solar chain 00208-00220). Re-claim the number
-- at apply time: check the ledger, origin/main and every open PR's migration filenames.
--
-- WHY. Proven on production in a rolled-back transaction
-- (scripts/db/assert-solar-meter-channel-orphans.sql: 3 of 5 red on 00208..00220, 5/5 with this):
--   00211 declared meter_channels_source_key as UNIQUE NULLS NOT DISTINCT
--   (meter_id, file_id, source_column), while meter_channels.file_id is ON DELETE SET NULL and
--   meter_files.project_id is ON DELETE CASCADE. Meters are ORG library rows that outlive a project;
--   its files do not. A meter fed by two imported files that share a column name (two exports of one
--   logger, both "kW" — the ordinary case) therefore made DELETE of the project fail with 23505:
--   the cascade set both channels' file_id to NULL, and NULLS NOT DISTINCT counted them as equal.
--
-- WHAT
--   * The constraint keeps its name and columns but uses the default NULLS DISTINCT. Every importer
--     writes a non-NULL file_id, so the import's upsert (ON CONFLICT (meter_id, file_id,
--     source_column), apps/web/src/lib/solar/meter-import/repo.ts) dedupes exactly as before; only
--     orphaned channels — distinct histories whose file went with a project — may now share a
--     column name. Their readings stay with the library meter, as 00211 intended.
--   * Nothing else changes; meter_channels_one_primary_per_file was already NULLS DISTINCT.
--
-- RULES
--   * No transaction control here: the runner wraps the file.
--   * Drop and re-add in one statement, so no window exists without the upsert target.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- constraint: meter_channels_source_key ON solar.meter_channels
-- sql: (SELECT c.contype = 'u' AND strpos(pg_get_constraintdef(c.oid), 'NULLS NOT DISTINCT') = 0 AND strpos(pg_get_constraintdef(c.oid), '(meter_id, file_id, source_column)') > 0 FROM pg_constraint c WHERE c.conname = 'meter_channels_source_key' AND c.conrelid = 'solar.meter_channels'::regclass)
-- behaviour: scripts/db/assert-solar-meter-channel-orphans.sql, every row ok
-- @verify:end

ALTER TABLE solar.meter_channels
    DROP CONSTRAINT meter_channels_source_key,
    ADD CONSTRAINT meter_channels_source_key UNIQUE (meter_id, file_id, source_column);
