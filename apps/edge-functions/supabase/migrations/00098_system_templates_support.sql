-- 00098_system_templates_support.sql
-- Adds a "system template" scope to inspections.templates: a template with
-- organisation_id IS NULL is a system template, published by WM-Consulting
-- and visible to every organisation that has unlocked the 'inspections'
-- feature (see migration 00097).
--
-- Org-scoped templates continue to work exactly as before (own org reads,
-- owner/admin writes). System templates are read by any member of an
-- unlocked org (excluding client_viewer-only roles) and written only by
-- WM-Consulting owners/admins.
--
-- NB: this migration does NOT migrate any existing templates. The 12
-- currently-seeded WM templates remain org-scoped; promoting them to system
-- templates is a separate, deliberate decision per template.

BEGIN;

-- ---------------------------------------------------------------------------
-- Schema: organisation_id becomes nullable, with two partial unique indexes
-- replacing the single UNIQUE constraint.
-- ---------------------------------------------------------------------------
ALTER TABLE inspections.templates
    ALTER COLUMN organisation_id DROP NOT NULL;

-- Drop the original (organisation_id, template_id, version) UNIQUE constraint
-- so we can scope uniqueness per-scope via partial unique indexes — Postgres
-- treats NULL as distinct in plain UNIQUE constraints, which would let two
-- system templates collide on (template_id, version).
ALTER TABLE inspections.templates
    DROP CONSTRAINT IF EXISTS templates_organisation_id_template_id_version_key;

CREATE UNIQUE INDEX IF NOT EXISTS templates_org_template_version_idx
    ON inspections.templates (organisation_id, template_id, version)
    WHERE organisation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS templates_system_template_version_idx
    ON inspections.templates (template_id, version)
    WHERE organisation_id IS NULL;

-- ---------------------------------------------------------------------------
-- RLS: select / insert / update policies replaced to handle both scopes.
-- The existing RESTRICTIVE templates_block_client_viewer is left in place —
-- public.user_is_client_viewer(NULL) returns FALSE (the EXISTS subquery
-- finds no rows), so it correctly allows system-template reads, and the
-- new templates_select policy enforces the client_viewer exclusion for
-- system templates via the role <> 'client_viewer' check below.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS templates_select ON inspections.templates;
CREATE POLICY templates_select ON inspections.templates FOR SELECT TO authenticated
    USING (
        -- Own-org templates (unchanged behaviour)
        (organisation_id IS NOT NULL
         AND organisation_id = ANY(public.get_user_org_ids()))
        OR
        -- System templates: visible to non-client-viewer members of any
        -- organisation that has the 'inspections' feature unlocked.
        (organisation_id IS NULL AND EXISTS (
            SELECT 1 FROM public.user_organisations uo
            WHERE uo.user_id      = auth.uid()
              AND uo.is_active    = TRUE
              AND uo.role        <> 'client_viewer'
              AND public.has_feature(uo.organisation_id, 'inspections')
        ))
    );

DROP POLICY IF EXISTS templates_insert ON inspections.templates;
CREATE POLICY templates_insert ON inspections.templates FOR INSERT TO authenticated
    WITH CHECK (
        -- Own-org templates: owner/admin in that org (unchanged)
        (organisation_id IS NOT NULL
         AND organisation_id = ANY(public.get_user_org_ids())
         AND EXISTS (
             SELECT 1 FROM public.user_organisations
             WHERE user_id         = auth.uid()
               AND organisation_id = inspections.templates.organisation_id
               AND role IN ('owner','admin')
         ))
        OR
        -- System templates: only WM-Consulting owners/admins may publish.
        (organisation_id IS NULL AND EXISTS (
            SELECT 1 FROM public.user_organisations
            WHERE user_id         = auth.uid()
              AND organisation_id = 'dddddddd-0000-0000-0000-000000000001'::uuid
              AND role IN ('owner','admin')
        ))
    );

DROP POLICY IF EXISTS templates_update ON inspections.templates;
CREATE POLICY templates_update ON inspections.templates FOR UPDATE TO authenticated
    USING (
        (organisation_id IS NOT NULL
         AND organisation_id = ANY(public.get_user_org_ids())
         AND EXISTS (
             SELECT 1 FROM public.user_organisations
             WHERE user_id         = auth.uid()
               AND organisation_id = inspections.templates.organisation_id
               AND role IN ('owner','admin')
         ))
        OR
        (organisation_id IS NULL AND EXISTS (
            SELECT 1 FROM public.user_organisations
            WHERE user_id         = auth.uid()
              AND organisation_id = 'dddddddd-0000-0000-0000-000000000001'::uuid
              AND role IN ('owner','admin')
        ))
    );

NOTIFY pgrst, 'reload schema';

COMMIT;
