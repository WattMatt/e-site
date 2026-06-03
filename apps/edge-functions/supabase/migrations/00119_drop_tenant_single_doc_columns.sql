-- 00119: drop the superseded single-file columns (applied after 00118 + the new code are live)
ALTER TABLE structure.tenant_details DROP COLUMN IF EXISTS layout_drawing_path;
ALTER TABLE structure.tenant_details DROP COLUMN IF EXISTS scope_document_path;
NOTIFY pgrst, 'reload schema';
