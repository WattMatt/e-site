-- =============================================================================
-- Migration 00225 — Standards reference model: editions, citations, visibility
-- =============================================================================
-- The SANS reference library (00053 → 00167) is a table-of-tables:
-- cable_schedule.sans_tables (one row per table) + sans_rows (row_data JSONB).
-- This migration makes it edition-aware and citation-bearing WITHOUT changing
-- how the cable calculator reads it:
--
--   * cable_schedule.ref_standards — the registry of source documents: code,
--     edition, year, status (current / superseded), whether the PDF is in the
--     WM standards library. A superseded edition stays registered, and its
--     tables stay queryable; status says which one to use.
--   * sans_tables gains standard_id + clause (where the table comes from),
--     provenance ('transcribed' for the legacy Aberdare-workbook tables,
--     'extracted' for tables read out of a standard's PDF by
--     scripts/standards/extract.ts), verification (the audit's verdict on a
--     legacy table, written by scripts/standards/load.ts) and
--     visibility_org_id.
--   * sans_rows gains citation: { clause, page_pdf, page_printed, … }. A row
--     of an 'extracted' table cannot exist without one — enforced here, not
--     by convention.
--
-- NO TABLE DATA IN THIS FILE. The repository is public and SANS documents are
-- licensed: the standards' numbers are loaded by script from the local
-- library into the database and never committed. This file carries schema and
-- registry metadata only (document codes, editions and titles as printed on
-- each document's cover).
--
-- Visibility (owner decision D2, default "WM org only"): an extracted table is
-- stamped with visibility_org_id and only active members of that org can read
-- it or its rows. The legacy tables keep visibility_org_id NULL — every org's
-- cable calculator reads them. The restrictive policies are FOR SELECT only:
-- there is no authenticated write path to these tables (no write policy has
-- ever existed), and a RESTRICTIVE FOR ALL would be the 00205 trap.
--
-- No schema CREATE/DROP, so no PostgREST db_schema PATCH; NOTIFY at the end.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Registry of source documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cable_schedule.ref_standards (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code           TEXT NOT NULL,             -- 'SANS 10142-1'
    edition        TEXT NOT NULL,             -- '3.1' as printed on the document
    year           INT,                       -- 2021
    title          TEXT NOT NULL,
    publisher      TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('standard', 'manufacturer')),
    status         TEXT NOT NULL CHECK (status IN ('current', 'superseded', 'withdrawn')),
    superseded_by  UUID REFERENCES cable_schedule.ref_standards(id) ON DELETE RESTRICT,
    in_library     BOOLEAN NOT NULL DEFAULT false,
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ref_standards_code_edition_key UNIQUE (code, edition),
    CONSTRAINT ref_standards_superseded_has_successor
        CHECK (status <> 'superseded' OR superseded_by IS NOT NULL),
    CONSTRAINT ref_standards_not_self_superseded CHECK (superseded_by IS DISTINCT FROM id)
);

DROP TRIGGER IF EXISTS ref_standards_updated_at ON cable_schedule.ref_standards;
CREATE TRIGGER ref_standards_updated_at
    BEFORE UPDATE ON cable_schedule.ref_standards
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE cable_schedule.ref_standards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ref_standards_read ON cable_schedule.ref_standards;
CREATE POLICY ref_standards_read ON cable_schedule.ref_standards
    FOR SELECT TO authenticated USING (true);

-- The schema's default privileges hand authenticated INSERT/UPDATE/DELETE on
-- every new table. A registry no app path writes keeps SELECT only.
REVOKE ALL ON cable_schedule.ref_standards FROM anon, authenticated;
GRANT SELECT ON cable_schedule.ref_standards TO authenticated;
GRANT ALL ON cable_schedule.ref_standards TO service_role;

-- Seed: documents in the WM standards library, as printed on each cover.
INSERT INTO cable_schedule.ref_standards (code, edition, year, title, publisher, kind, status, in_library, notes) VALUES
  ('SANS 10142-1', '3.1', 2021, 'The wiring of premises — Part 1: Low-voltage installations', 'SABS', 'standard', 'current', true,
   'Latest edition held in the WM library (2026-10-05).'),
  ('SANS 10142-1', '2',   2017, 'The wiring of premises — Part 1: Low-voltage installations', 'SABS', 'standard', 'current', true, NULL),
  ('SANS 10142-1', '1.8', 2012, 'The wiring of premises — Part 1: Low-voltage installations', 'SABS', 'standard', 'current', true, NULL),
  ('SANS 10400-XA', '2', 2021, 'The application of the National Building Regulations — Part XA: Energy usage in buildings', 'SABS', 'standard', 'current', true,
   'Latest edition held in the WM library (2026-10-05).'),
  ('SANS 10400-XA', '1', 2011, 'The application of the National Building Regulations — Part XA: Energy usage in buildings', 'SABS', 'standard', 'current', true, NULL),
  ('SANS 204',    '1',   2011, 'Energy efficiency in buildings', 'SABS', 'standard', 'current', true, NULL),
  ('SANS 1411-1', '2.2', 2020, 'Materials of insulated electric cables and flexible cords — Part 1: Conductors', 'SABS', 'standard', 'current', true, NULL),
  ('SANS 10313',  '3.1', 2010, 'Protection against lightning — Physical damage to structures and life hazard', 'SABS', 'standard', 'current', true, NULL),
  ('SANS 1029',   '3.1', 2016, 'Miniature substations for rated a.c. voltages up to and including 24 kV', 'SABS', 'standard', 'current', true, NULL),
  ('SANS 10114-1', '3',  2005, 'Interior lighting — Part 1: Artificial lighting of interiors', 'SABS', 'standard', 'current', true, NULL),
  ('SANS 780',    '4',   2009, 'Distribution transformers', 'SABS', 'standard', 'current', true, NULL),
  ('Aberdare Cables Facts & Figures', 'as transcribed', NULL, 'Cables — Facts & Figures (manufacturer booklet)', 'Aberdare Cables', 'manufacturer', 'current', false,
   'Source of the legacy cable tables (transcribed via the firm''s CABLE SCHEDULE workbook). The booklet is not in the WM standards library.')
ON CONFLICT (code, edition) DO NOTHING;

-- Supersession, from each newer document's own "supersedes" statement.
UPDATE cable_schedule.ref_standards o SET status = 'superseded', superseded_by = n.id
  FROM cable_schedule.ref_standards n
 WHERE o.code = 'SANS 10142-1' AND o.edition = '2'   AND n.code = 'SANS 10142-1' AND n.edition = '3.1';
UPDATE cable_schedule.ref_standards o SET status = 'superseded', superseded_by = n.id
  FROM cable_schedule.ref_standards n
 WHERE o.code = 'SANS 10142-1' AND o.edition = '1.8' AND n.code = 'SANS 10142-1' AND n.edition = '2';
UPDATE cable_schedule.ref_standards o SET status = 'superseded', superseded_by = n.id
  FROM cable_schedule.ref_standards n
 WHERE o.code = 'SANS 10400-XA' AND o.edition = '1' AND n.code = 'SANS 10400-XA' AND n.edition = '2';

-- ---------------------------------------------------------------------------
-- 2. Tables: source, clause, provenance, verification, visibility
-- ---------------------------------------------------------------------------
ALTER TABLE cable_schedule.sans_tables
    ADD COLUMN IF NOT EXISTS standard_id       UUID REFERENCES cable_schedule.ref_standards(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS clause            TEXT,
    ADD COLUMN IF NOT EXISTS provenance        TEXT NOT NULL DEFAULT 'transcribed',
    ADD COLUMN IF NOT EXISTS verification      JSONB,
    ADD COLUMN IF NOT EXISTS visibility_org_id UUID REFERENCES public.organisations(id) ON DELETE CASCADE;

ALTER TABLE cable_schedule.sans_tables DROP CONSTRAINT IF EXISTS sans_tables_provenance_check;
ALTER TABLE cable_schedule.sans_tables ADD CONSTRAINT sans_tables_provenance_check
    CHECK (provenance IN ('transcribed', 'extracted'));
ALTER TABLE cable_schedule.sans_tables DROP CONSTRAINT IF EXISTS sans_tables_extracted_is_sourced;
ALTER TABLE cable_schedule.sans_tables ADD CONSTRAINT sans_tables_extracted_is_sourced
    CHECK (provenance <> 'extracted' OR (standard_id IS NOT NULL AND btrim(coalesce(clause, '')) <> ''));
ALTER TABLE cable_schedule.sans_tables DROP CONSTRAINT IF EXISTS sans_tables_verification_shape;
ALTER TABLE cable_schedule.sans_tables ADD CONSTRAINT sans_tables_verification_shape
    CHECK (verification IS NULL OR coalesce(
        jsonb_typeof(verification) = 'object'
        AND verification->>'status' IN ('verified', 'partially_verified', 'mismatch', 'not_checkable'), false));

CREATE INDEX IF NOT EXISTS idx_sans_tables_standard_id ON cable_schedule.sans_tables(standard_id);

-- Legacy tables: their data came from the Aberdare booklet via the firm's
-- workbook, whatever product standard the `standard` column names.
UPDATE cable_schedule.sans_tables t
   SET standard_id = s.id,
       clause      = 'Table ' || t.section_number
  FROM cable_schedule.ref_standards s
 WHERE s.code = 'Aberdare Cables Facts & Figures' AND s.edition = 'as transcribed'
   AND t.provenance = 'transcribed' AND t.standard_id IS NULL;

-- 00167 noted "No SANS 10142-1 equivalent exists" for the LV solar-radiation
-- table. The 2026-10-05 audit compared all ten cells with SANS 10142-1:2021
-- Table 6.19 and found every one equal, so the note was wrong.
UPDATE cable_schedule.sans_tables
   SET notes = replace(notes, 'No SANS 10142-1 equivalent exists for this table.',
                       'Same factors as SANS 10142-1 Table 6.19 (direct solar radiation); see the verification on this table.')
 WHERE code = 'TABLE_6_3_7';

-- ---------------------------------------------------------------------------
-- 3. Rows: a citation on every value of an extracted table
-- ---------------------------------------------------------------------------
ALTER TABLE cable_schedule.sans_rows ADD COLUMN IF NOT EXISTS citation JSONB;

ALTER TABLE cable_schedule.sans_rows DROP CONSTRAINT IF EXISTS sans_rows_citation_shape;
ALTER TABLE cable_schedule.sans_rows ADD CONSTRAINT sans_rows_citation_shape
    -- coalesce(…, false): a missing key makes jsonb_typeof() NULL, and a CHECK
    -- that evaluates to NULL PASSES. Without it a citation lacking its printed
    -- page was accepted (caught by the assertion file on the first dry run).
    CHECK (citation IS NULL OR coalesce(
        jsonb_typeof(citation) = 'object'
        AND jsonb_typeof(citation->'page_pdf') = 'number'
        AND jsonb_typeof(citation->'page_printed') = 'number'
        AND (citation->>'page_pdf')::numeric >= 1
        AND (citation->>'page_printed')::numeric >= 1
        AND btrim(coalesce(citation->>'clause', '')) <> '', false));

CREATE OR REPLACE FUNCTION cable_schedule.sans_rows_require_citation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.citation IS NULL AND EXISTS (
       SELECT 1 FROM cable_schedule.sans_tables t
        WHERE t.id = NEW.table_id AND t.provenance = 'extracted') THEN
    RAISE EXCEPTION 'a row of an extracted reference table needs a citation (clause, PDF page, printed page)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sans_rows_require_citation ON cable_schedule.sans_rows;
CREATE TRIGGER sans_rows_require_citation
    BEFORE INSERT OR UPDATE ON cable_schedule.sans_rows
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.sans_rows_require_citation();

CREATE OR REPLACE FUNCTION cable_schedule.sans_tables_extracted_rows_cited()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.provenance = 'extracted' AND EXISTS (
       SELECT 1 FROM cable_schedule.sans_rows r
        WHERE r.table_id = NEW.id AND r.citation IS NULL) THEN
    RAISE EXCEPTION 'table % has uncited rows and cannot be marked extracted', NEW.code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sans_tables_extracted_rows_cited ON cable_schedule.sans_tables;
CREATE TRIGGER sans_tables_extracted_rows_cited
    BEFORE UPDATE OF provenance ON cable_schedule.sans_tables
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.sans_tables_extracted_rows_cited();

REVOKE EXECUTE ON FUNCTION cable_schedule.sans_rows_require_citation()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION cable_schedule.sans_tables_extracted_rows_cited() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Visibility (D2): restrictive, SELECT only
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS sans_tables_visibility ON cable_schedule.sans_tables;
CREATE POLICY sans_tables_visibility ON cable_schedule.sans_tables
    AS RESTRICTIVE FOR SELECT
    USING (visibility_org_id IS NULL OR visibility_org_id = ANY (public.get_user_org_ids()));

DROP POLICY IF EXISTS sans_rows_visibility ON cable_schedule.sans_rows;
CREATE POLICY sans_rows_visibility ON cable_schedule.sans_rows
    AS RESTRICTIVE FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM cable_schedule.sans_tables t
         WHERE t.id = sans_rows.table_id
           AND (t.visibility_org_id IS NULL OR t.visibility_org_id = ANY (public.get_user_org_ids()))));

NOTIFY pgrst, 'reload schema';

-- @verify:begin
-- table: cable_schedule.ref_standards
-- function: cable_schedule.sans_rows_require_citation()
-- function: cable_schedule.sans_tables_extracted_rows_cited()
-- column: cable_schedule.sans_tables.standard_id
-- column: cable_schedule.sans_tables.provenance
-- column: cable_schedule.sans_tables.verification
-- column: cable_schedule.sans_tables.visibility_org_id
-- column: cable_schedule.sans_rows.citation
-- constraint: sans_tables_extracted_is_sourced ON cable_schedule.sans_tables
-- constraint: sans_rows_citation_shape ON cable_schedule.sans_rows
-- trigger: sans_rows_require_citation ON cable_schedule.sans_rows
-- trigger: sans_tables_extracted_rows_cited ON cable_schedule.sans_tables
-- policy: sans_tables_visibility ON cable_schedule.sans_tables RESTRICTIVE
-- policy: sans_rows_visibility ON cable_schedule.sans_rows RESTRICTIVE
-- grant_absent: anon SELECT ON cable_schedule.ref_standards
-- grant_absent: authenticated INSERT ON cable_schedule.ref_standards
-- sql: (SELECT status = 'superseded' AND superseded_by IS NOT NULL FROM cable_schedule.ref_standards WHERE code = 'SANS 10142-1' AND edition = '2')
-- sql: (SELECT count(*) = 0 FROM pg_policy WHERE polname IN ('sans_tables_visibility', 'sans_rows_visibility') AND polcmd <> 'r')
-- behaviour: scripts/db/assert-standards-reference-model.sql, every row ok
-- @verify:end
