-- ---------------------------------------------------------------------------
-- Migration 00037: rfi_annotations columns repair
-- ---------------------------------------------------------------------------
-- Discovery 2026-05-03 (during canvas browser-verify): the staging
-- `public.rfi_annotations` table is missing three columns that migration
-- 00033 was supposed to create:
--   - rfi_id               UUID NOT NULL FK projects.rfis
--   - source_floor_plan_id UUID FK tenants.floor_plans
--   - created_by           UUID FK public.profiles
--
-- Likely cause: the table was created via a different migration earlier
-- (with only id/organisation_id/attachment_id/annotation_data/timestamps),
-- and 00033's plain CREATE TABLE silently failed/no-op'd on staging.
--
-- Verified via `GET /rest/v1/` OpenAPI spec — only 6 columns present, not
-- the 9 declared in migration 00033.
--
-- Repair: idempotent ADD COLUMN IF NOT EXISTS for the three missing.
-- Safe because the table is empty on staging today (verified via
-- HEAD count = 0). The NOT NULL on rfi_id is enforced post-add since no
-- rows exist to violate it.
-- ---------------------------------------------------------------------------

ALTER TABLE public.rfi_annotations
    ADD COLUMN IF NOT EXISTS rfi_id UUID,
    ADD COLUMN IF NOT EXISTS source_floor_plan_id UUID,
    ADD COLUMN IF NOT EXISTS created_by UUID;

-- Add the FKs (drop+add for idempotency).
ALTER TABLE public.rfi_annotations
    DROP CONSTRAINT IF EXISTS rfi_annotations_rfi_id_fkey;
ALTER TABLE public.rfi_annotations
    ADD CONSTRAINT rfi_annotations_rfi_id_fkey
    FOREIGN KEY (rfi_id) REFERENCES projects.rfis(id) ON DELETE CASCADE;

ALTER TABLE public.rfi_annotations
    DROP CONSTRAINT IF EXISTS rfi_annotations_source_floor_plan_id_fkey;
ALTER TABLE public.rfi_annotations
    ADD CONSTRAINT rfi_annotations_source_floor_plan_id_fkey
    FOREIGN KEY (source_floor_plan_id) REFERENCES tenants.floor_plans(id) ON DELETE SET NULL;

ALTER TABLE public.rfi_annotations
    DROP CONSTRAINT IF EXISTS rfi_annotations_created_by_fkey;
ALTER TABLE public.rfi_annotations
    ADD CONSTRAINT rfi_annotations_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.profiles(id);

-- Enforce NOT NULL on rfi_id now that the column exists. Table is empty
-- on staging so this is safe; if applied to a future env with data,
-- pre-populate rfi_id first.
ALTER TABLE public.rfi_annotations
    ALTER COLUMN rfi_id SET NOT NULL;

-- Index used by the RFI detail page query and the re-edit deep-link.
CREATE INDEX IF NOT EXISTS idx_rfi_annotations_rfi_id
    ON public.rfi_annotations(rfi_id);
CREATE INDEX IF NOT EXISTS idx_rfi_annotations_source_floor_plan_id
    ON public.rfi_annotations(source_floor_plan_id);

-- Reload PostgREST so the new columns are in the API schema cache.
NOTIFY pgrst, 'reload schema';
