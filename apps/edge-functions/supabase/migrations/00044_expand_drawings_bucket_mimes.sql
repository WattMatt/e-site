-- =============================================================================
-- Migration: 00044_expand_drawings_bucket_mimes.sql
-- Description: Expand the `drawings` Storage bucket's allowed_mime_types to
--              cover CAD formats (.dwg / .dxf / .dgn / .rvt). Without this,
--              the cloud-sync-project edge function (M5) fails the upload
--              for every CAD file the classifier routes to floor_plans —
--              the existing list (PDF + JPEG + PNG) covers PDF drawings
--              only.
--
--              Catch-all `application/octet-stream` is intentional: Dropbox,
--              Drive, and Graph all serve raw CAD files as octet-stream
--              when no provider-specific MIME is known. The edge function
--              gates which files reach this bucket via the classifier in
--              `cloud-sync-project/index.ts`, so octet-stream here is
--              constrained to CAD-extension files in practice — not a
--              broad "any binary" policy.
-- =============================================================================

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
    -- Existing (preserved):
    'application/pdf',
    'image/jpeg',
    'image/png',
    -- CAD formats (new):
    'application/octet-stream',                  -- Dropbox + Graph default for binary CAD
    'application/acad',                          -- AutoCAD .dwg
    'application/x-acad',
    'application/autocad_dwg',
    'image/vnd.dwg',
    'image/x-dwg',
    'application/dxf',                           -- AutoCAD .dxf
    'application/x-dxf',
    'image/vnd.dxf',
    'application/dgn',                           -- MicroStation .dgn
    'application/x-dgn',
    'application/vnd.autodesk.revit'             -- Revit .rvt
]
WHERE id = 'drawings';
