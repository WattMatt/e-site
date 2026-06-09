-- 00123_node_soft_delete.sql
-- Recycle bin: a soft-delete marker on structure.nodes.
--
-- A soft-deleted node carries deleted_at (+ who, deleted_by). listNodes filters
-- `deleted_at IS NULL` by default, so the node disappears from the tenant
-- schedule + equipment-materials but is kept for Restore. "Delete permanently"
-- runs the existing hard-delete cascade (tenant-delete.actions.ts). Soft-delete
-- removes the node's DRAFT cable supplies (like the hard delete) so the cable
-- schedule never shows a supply to a hidden board; restore therefore brings back
-- the tenant's scope / documents / orders / inspections, but not draft cable
-- wiring (cheap to recreate).
--
-- Additive + nullable — safe to apply ahead of the consuming code.

ALTER TABLE structure.nodes
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Partial index for the recycle-bin query (the few deleted nodes per project).
CREATE INDEX IF NOT EXISTS idx_nodes_deleted_at
  ON structure.nodes (project_id)
  WHERE deleted_at IS NOT NULL;

-- Code uniqueness must apply to LIVE nodes only: a soft delete frees the code
-- for reuse, and a restore that would collide with a live code now fails the
-- partial index (a detectable error) instead of silently producing two visible
-- boards sharing a code. Replaces the original non-partial UNIQUE(project_id,code).
ALTER TABLE structure.nodes DROP CONSTRAINT IF EXISTS nodes_project_id_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS nodes_project_code_active
  ON structure.nodes (project_id, code)
  WHERE deleted_at IS NULL;

-- New columns must be exposed to the PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
