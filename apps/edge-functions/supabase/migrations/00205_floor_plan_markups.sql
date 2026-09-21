-- ---------------------------------------------------------------------------
-- Migration 00205: tenants.floor_plan_markups
-- ---------------------------------------------------------------------------
-- Spec: docs/superpowers/specs/2026-09-21-markup-save-open-design.md
--
-- WHY. A markup could not be saved without an RFI. `public.rfi_annotations`
-- (00033) is `rfi_id NOT NULL` with `UNIQUE (attachment_id)`, so the only Save
-- in the drawing viewer is literally labelled "Attach to RFI", and the rail
-- panel that lists markups links AWAY to the RFI rather than reopening the
-- scene. The owner asked where the save button was; the answer was that the
-- product had never had one. Production agrees: `rfi_annotations` held ZERO
-- rows across the lifetime of the system, and `qc_entry_photos.annotation_data`
-- held zero as well. That is not a rarely wanted feature. It is a flow that
-- does not work, so no rows exist.
--
-- The codebase already carried TWO private forks of "a markup scene attached
-- to a drawing" (rfi_annotations.annotation_data for RFIs,
-- qc_entry_photos.annotation_data for QC). A third fork was the wrong answer
-- for the same reason a third report table was in 00183: this is one object.
--
-- WHAT A ROW IS. One named, reopenable markup layer on one drawing, shared
-- within the project the way routes are. The scene graph already carries
-- `pageIndex` per shape and `pageCount`, so a single row covers every page of
-- a multi-page PDF and no page dimension is needed here.
--
-- THE FILE ANCHOR IS THE POINT OF file_path. Markup coordinates are raw
-- image-space pixels. They replay exactly, because a PDF is rasterised at a
-- hardcoded getViewport({ scale: 2 }) and a raster uses naturalWidth/Height,
-- neither of which varies by device or session. What does vary is the FILE:
-- cloud-sync adopts a newer revision by swapping `file_path` on this same
-- drawing row. So the file the geometry was drawn against is stamped at save
-- time, and the viewer compares it on open. There is no honest transformation
-- between two arbitrary revisions of a PDF, so the app WARNS and never tries
-- to re-align. Being told is the whole ask.
--
-- This migration creates schema only. No backfill exists or is needed: both
-- older stores are empty.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: tenants.floor_plan_markups
-- column: tenants.floor_plan_markups.scene
-- column: tenants.floor_plan_markups.file_path
-- column: tenants.floor_plan_markups.source_revision_id
-- column: tenants.floor_plan_markups.project_id
-- constraint: floor_plan_markups_name_not_blank ON tenants.floor_plan_markups
-- constraint: floor_plan_markups_scene_is_object ON tenants.floor_plan_markups
-- constraint: floor_plan_markups_plan_name_key ON tenants.floor_plan_markups
-- index: floor_plan_markups_plan_updated_idx ON tenants.floor_plan_markups
-- function: tenants.floor_plan_markups_bind_parents()
-- trigger: floor_plan_markups_bind_parents ON tenants.floor_plan_markups
-- trigger: floor_plan_markups_updated_at ON tenants.floor_plan_markups
-- policy: floor_plan_markups_select ON tenants.floor_plan_markups
-- policy: floor_plan_markups_write ON tenants.floor_plan_markups
-- policy: floor_plan_markups_write_authz ON tenants.floor_plan_markups RESTRICTIVE
-- grant_present: authenticated SELECT ON tenants.floor_plan_markups
-- grant_absent: anon SELECT ON tenants.floor_plan_markups
-- grant_absent: anon EXECUTE ON tenants.floor_plan_markups_bind_parents()
-- sql: (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'tenants.floor_plan_markups'::regclass)
-- @verify:end

-- ── 1. The table ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants.floor_plan_markups (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Both bound by trigger from the drawing, never trusted from the client.
    organisation_id    UUID NOT NULL REFERENCES public.organisations(id),
    project_id         UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,

    floor_plan_id      UUID NOT NULL REFERENCES tenants.floor_plans(id) ON DELETE CASCADE,

    name               TEXT NOT NULL,

    /* SceneGraph: { version, canvas: {w,h}, shapes: [...], pageCount }. Each
       shape carries its own pageIndex, so one row spans every page. */
    scene              JSONB NOT NULL,

    /* The file this geometry was drawn against. Compared with the drawing's
       current file_path on open; a difference raises a warning banner. */
    file_path          TEXT NOT NULL,
    /* The cloud revision of that file when known. NULL for drawings that were
       uploaded directly rather than synced. */
    source_revision_id TEXT,

    created_by         UUID REFERENCES public.profiles(id),
    updated_by         UUID REFERENCES public.profiles(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT floor_plan_markups_plan_name_key UNIQUE (floor_plan_id, name),
    CONSTRAINT floor_plan_markups_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT floor_plan_markups_scene_is_object CHECK (jsonb_typeof(scene) = 'object')
);

CREATE INDEX IF NOT EXISTS floor_plan_markups_plan_updated_idx
    ON tenants.floor_plan_markups (floor_plan_id, updated_at DESC);

COMMENT ON TABLE tenants.floor_plan_markups IS
'One named, reopenable markup layer on one drawing, shared within the project. This is the object the product was missing: before it, a markup could only be stored as an RFI attachment (rfi_annotations is rfi_id NOT NULL), so "save my work on this drawing" had nowhere to live and the only Save button said "Attach to RFI". Attaching to an RFI is now one export of a saved markup rather than the only way to keep it.';

COMMENT ON COLUMN tenants.floor_plan_markups.file_path IS
'The drawing file this geometry was drawn against, stamped at save time. Cloud-sync adopts a newer revision by swapping file_path on the SAME floor_plans row, which would leave these pixel coordinates pointing at different pixels. On open the app compares this with the drawing''s current file_path and warns when they differ. It does not attempt to re-align: no honest transformation exists between two arbitrary revisions of a PDF.';

COMMENT ON COLUMN tenants.floor_plan_markups.scene IS
'The Konva scene graph, identical in shape to rfi_annotations.annotation_data so a saved markup can still be attached to an RFI without translation. Stored as vectors, never as a flattened image, because an image cannot be reopened and edited; the composited PNG remains an export concern and keeps living in the rfi-attachments bucket.';

-- ── 2. Parents are derived, never supplied ────────────────────────────────────
-- The 00199 / 00200 binding shape. A client that can name its own
-- organisation_id in a permissive policy can hand a row to a foreign org.

CREATE OR REPLACE FUNCTION tenants.floor_plan_markups_bind_parents()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT fp.organisation_id, fp.project_id
    INTO NEW.organisation_id, NEW.project_id
    FROM tenants.floor_plans fp
   WHERE fp.id = NEW.floor_plan_id;
  IF NEW.project_id IS NULL THEN
    RAISE EXCEPTION 'floor_plan_markups: drawing % not found', NEW.floor_plan_id USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION tenants.floor_plan_markups_bind_parents() FROM PUBLIC;
-- Named explicitly: Supabase's ALTER DEFAULT PRIVILEGES grants anon EXECUTE at
-- creation as a SEPARATE grant, so REVOKE FROM PUBLIC does not remove it (00183).
REVOKE ALL ON FUNCTION tenants.floor_plan_markups_bind_parents() FROM anon;

DROP TRIGGER IF EXISTS floor_plan_markups_bind_parents ON tenants.floor_plan_markups;
CREATE TRIGGER floor_plan_markups_bind_parents
    BEFORE INSERT OR UPDATE ON tenants.floor_plan_markups
    FOR EACH ROW EXECUTE FUNCTION tenants.floor_plan_markups_bind_parents();

DROP TRIGGER IF EXISTS floor_plan_markups_updated_at ON tenants.floor_plan_markups;
CREATE TRIGGER floor_plan_markups_updated_at
    BEFORE UPDATE ON tenants.floor_plan_markups
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. Row security ───────────────────────────────────────────────────────────

ALTER TABLE tenants.floor_plan_markups ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants.floor_plan_markups FORCE ROW LEVEL SECURITY;

-- Read: anyone on the project except a client viewer. Markups are internal
-- working layers; what a client is shown is the RFI the markup was attached to.
DROP POLICY IF EXISTS floor_plan_markups_select ON tenants.floor_plan_markups;
CREATE POLICY floor_plan_markups_select ON tenants.floor_plan_markups FOR SELECT
    USING (
        public.user_has_project_access(project_id)
        AND COALESCE(public.user_effective_project_role(project_id), '') <> 'client_viewer'
    );

-- Write, permissive half: membership. On its own this is a membership test and
-- NOT an authorisation test, which is exactly the 00051 mistake. It is paired
-- with the RESTRICTIVE gate below, and both must pass.
DROP POLICY IF EXISTS floor_plan_markups_write ON tenants.floor_plan_markups;
CREATE POLICY floor_plan_markups_write ON tenants.floor_plan_markups FOR ALL
    TO authenticated
    USING      (public.user_has_project_access(project_id))
    WITH CHECK (public.user_has_project_access(project_id));

-- Write, restrictive half: the role gate, mirroring MARKUP_WRITE_ROLES in
-- @esite/shared. COALESCE because user_effective_project_role returns NULL for
-- a non-member and `NULL IN (...)` is NULL, not FALSE (00183).
DROP POLICY IF EXISTS floor_plan_markups_write_authz ON tenants.floor_plan_markups;
CREATE POLICY floor_plan_markups_write_authz ON tenants.floor_plan_markups
    AS RESTRICTIVE FOR ALL
    TO authenticated
    USING (
        COALESCE(public.user_effective_project_role(project_id), '')
            IN ('owner', 'admin', 'project_manager', 'contractor')
    )
    WITH CHECK (
        COALESCE(public.user_effective_project_role(project_id), '')
            IN ('owner', 'admin', 'project_manager', 'contractor')
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON tenants.floor_plan_markups TO authenticated;
GRANT ALL ON tenants.floor_plan_markups TO service_role;
REVOKE ALL ON tenants.floor_plan_markups FROM anon;

NOTIFY pgrst, 'reload schema';
