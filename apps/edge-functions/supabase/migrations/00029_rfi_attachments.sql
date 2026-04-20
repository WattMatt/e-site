-- =============================================================================
-- Migration: 00029_rfi_attachments.sql
-- Description: RFI attachments storage bucket + floor-plan annotation metadata.
--              Existing public.attachments table already supports entity_type
--              values 'rfi' and 'rfi_response' — this migration adds:
--                1. A dedicated `rfi-attachments` storage bucket with RLS
--                2. Table `public.rfi_annotations` linking an attachment row
--                   to its source floor plan + serialised scene graph (for
--                   non-destructive re-editing).
--                3. UPDATE + DELETE RLS on public.attachments (previously only
--                   had SELECT + INSERT) so annotations can be revised.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Storage bucket: rfi-attachments
-- Path convention: {org_id}/{project_id}/{rfi_id}/{filename}
-- Accepts images, PDFs, and the annotated-floorplan PNGs emitted by the
-- floor-plan annotator. 20MB cap — covers hi-res phone photos + A3 scans.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'rfi-attachments',
    'rfi-attachments',
    false,
    20971520,  -- 20MB
    ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Org members can read RFI attachments"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'rfi-attachments'
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

CREATE POLICY "Org members can upload RFI attachments"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'rfi-attachments'
        AND auth.uid() IS NOT NULL
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

CREATE POLICY "Org members can update RFI attachments"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'rfi-attachments'
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

CREATE POLICY "Org members can delete RFI attachments"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'rfi-attachments'
        AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
    );

-- ---------------------------------------------------------------------------
-- public.rfi_annotations
-- Links a rendered attachment (the composited PNG the user sees) back to
-- its source floor plan and the serialised Konva/Skia scene graph, so the
-- user can reopen and edit the annotation instead of starting from scratch.
-- ---------------------------------------------------------------------------
CREATE TABLE public.rfi_annotations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id      UUID NOT NULL REFERENCES public.organisations(id),
    attachment_id        UUID NOT NULL REFERENCES public.attachments(id) ON DELETE CASCADE,
    source_floor_plan_id UUID REFERENCES tenants.floor_plans(id) ON DELETE SET NULL,
    annotation_data      JSONB NOT NULL,
    -- scene graph: { version, canvas: {w,h}, shapes: [{type, points, color, strokeWidth, ...}] }
    created_by           UUID REFERENCES public.profiles(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (attachment_id)
);

CREATE INDEX idx_rfi_annotations_org        ON public.rfi_annotations(organisation_id);
CREATE INDEX idx_rfi_annotations_floor_plan ON public.rfi_annotations(source_floor_plan_id);

CREATE TRIGGER rfi_annotations_updated_at
    BEFORE UPDATE ON public.rfi_annotations
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.rfi_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view annotations"
    ON public.rfi_annotations FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can insert annotations"
    ON public.rfi_annotations FOR INSERT
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can update annotations"
    ON public.rfi_annotations FOR UPDATE
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can delete annotations"
    ON public.rfi_annotations FOR DELETE
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- ---------------------------------------------------------------------------
-- Fill gap in public.attachments RLS — 00009 only added SELECT + INSERT.
-- Needed so annotations can be rewritten (re-upload composited PNG) and
-- attachments can be removed by their uploader / org admins.
-- ---------------------------------------------------------------------------
CREATE POLICY "Org members can update attachments"
    ON public.attachments FOR UPDATE
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can delete attachments"
    ON public.attachments FOR DELETE
    USING (organisation_id = ANY(public.get_user_org_ids()));
