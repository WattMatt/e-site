-- 00122_project_boq_rates.sql
-- Project Rates / BOQ (Phase 1): imported priced Bill of Quantities per project.
-- Adds 3 tables to the existing `projects` schema. No CREATE SCHEMA => no PostgREST PATCH needed.
BEGIN;

-- 1. boq_imports: one row per import (contract baseline + audit/version trail)
CREATE TABLE IF NOT EXISTS projects.boq_imports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id), -- ON DELETE NO ACTION (default): orgs are removed only via admin tooling.
  source_filename  text NOT NULL,
  storage_path     text,
  imported_by      uuid REFERENCES public.profiles(id),
  imported_at      timestamptz NOT NULL DEFAULT now(),
  total_ex_vat     numeric(16,2),
  vat_amount       numeric(16,2),
  total_incl_vat   numeric(16,2),
  line_item_count  int NOT NULL DEFAULT 0,
  is_current       boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS boq_imports_project_idx ON projects.boq_imports(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS boq_imports_one_current
  ON projects.boq_imports(project_id) WHERE is_current;

-- 2. boq_sections: bill/section/category tree (self-referencing)
CREATE TABLE IF NOT EXISTS projects.boq_sections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id          uuid NOT NULL REFERENCES projects.boq_imports(id) ON DELETE CASCADE,
  parent_section_id  uuid,
  kind               text NOT NULL,
  code               text,
  title              text NOT NULL,
  sort_order         int NOT NULL DEFAULT 0,
  node_id            uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Redundant given the PK, but required as the FK target for boq_sections_parent_fk
  -- (composite FK enforces same-import parentage).
  UNIQUE (import_id, id)
);
ALTER TABLE projects.boq_sections DROP CONSTRAINT IF EXISTS boq_sections_kind_check;
ALTER TABLE projects.boq_sections ADD CONSTRAINT boq_sections_kind_check
  CHECK (kind IN ('bill','section','category'));
ALTER TABLE projects.boq_sections DROP CONSTRAINT IF EXISTS boq_sections_no_self_parent;
ALTER TABLE projects.boq_sections ADD CONSTRAINT boq_sections_no_self_parent
  CHECK (parent_section_id IS NULL OR parent_section_id <> id);
-- same-import parent (composite FK; NO ACTION so a project cascade can tear the tree down)
ALTER TABLE projects.boq_sections DROP CONSTRAINT IF EXISTS boq_sections_parent_fk;
ALTER TABLE projects.boq_sections ADD CONSTRAINT boq_sections_parent_fk
  FOREIGN KEY (import_id, parent_section_id)
  REFERENCES projects.boq_sections(import_id, id) ON DELETE NO ACTION;
CREATE INDEX IF NOT EXISTS boq_sections_import_idx ON projects.boq_sections(import_id);
CREATE INDEX IF NOT EXISTS boq_sections_parent_idx ON projects.boq_sections(parent_section_id);

-- 3. boq_items: priced leaf rows
CREATE TABLE IF NOT EXISTS projects.boq_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id     uuid NOT NULL REFERENCES projects.boq_sections(id) ON DELETE CASCADE,
  code           text,
  description    text NOT NULL,
  unit           text,
  quantity       numeric(14,3),
  quantity_mode  text NOT NULL DEFAULT 'measured',
  rate_model     text NOT NULL DEFAULT 'supply_install',
  supply_rate    numeric(14,4),
  install_rate   numeric(14,4),
  rate           numeric(14,4),
  amount         numeric(16,2),
  sort_order     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE projects.boq_items DROP CONSTRAINT IF EXISTS boq_items_quantity_mode_check;
ALTER TABLE projects.boq_items ADD CONSTRAINT boq_items_quantity_mode_check
  CHECK (quantity_mode IN ('measured','rate_only','lump_sum','provisional','pc_sum'));
ALTER TABLE projects.boq_items DROP CONSTRAINT IF EXISTS boq_items_rate_model_check;
ALTER TABLE projects.boq_items ADD CONSTRAINT boq_items_rate_model_check
  CHECK (rate_model IN ('supply_install','single','amount_only'));
CREATE INDEX IF NOT EXISTS boq_items_section_idx ON projects.boq_items(section_id);

-- updated_at triggers (reuse the standard helper)
DROP TRIGGER IF EXISTS boq_imports_set_updated_at ON projects.boq_imports;
CREATE TRIGGER boq_imports_set_updated_at BEFORE UPDATE ON projects.boq_imports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS boq_sections_set_updated_at ON projects.boq_sections;
CREATE TRIGGER boq_sections_set_updated_at BEFORE UPDATE ON projects.boq_sections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS boq_items_set_updated_at ON projects.boq_items;
CREATE TRIGGER boq_items_set_updated_at BEFORE UPDATE ON projects.boq_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: read = project access; write = owner/admin/PM. (App layer adds COST_VIEW_ROLES gating,
-- matching how contract_value is handled: DB read is project-wide, app narrows + hides.)
ALTER TABLE projects.boq_imports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.boq_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.boq_items    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boq_imports_select ON projects.boq_imports;
CREATE POLICY boq_imports_select ON projects.boq_imports FOR SELECT
  USING (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS boq_imports_modify ON projects.boq_imports;
CREATE POLICY boq_imports_modify ON projects.boq_imports FOR ALL
  USING (public.user_effective_project_role(project_id, auth.uid()) IN ('owner','admin','project_manager'))
  WITH CHECK (public.user_effective_project_role(project_id, auth.uid()) IN ('owner','admin','project_manager'));

DROP POLICY IF EXISTS boq_sections_select ON projects.boq_sections;
CREATE POLICY boq_sections_select ON projects.boq_sections FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects.boq_imports i
                 WHERE i.id = import_id AND public.user_has_project_access(i.project_id)));
DROP POLICY IF EXISTS boq_sections_modify ON projects.boq_sections;
CREATE POLICY boq_sections_modify ON projects.boq_sections FOR ALL
  USING (EXISTS (SELECT 1 FROM projects.boq_imports i
                 WHERE i.id = import_id
                   AND public.user_effective_project_role(i.project_id, auth.uid()) IN ('owner','admin','project_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM projects.boq_imports i
                 WHERE i.id = import_id
                   AND public.user_effective_project_role(i.project_id, auth.uid()) IN ('owner','admin','project_manager')));

DROP POLICY IF EXISTS boq_items_select ON projects.boq_items;
CREATE POLICY boq_items_select ON projects.boq_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects.boq_sections s JOIN projects.boq_imports i ON i.id = s.import_id
                 WHERE s.id = section_id AND public.user_has_project_access(i.project_id)));
DROP POLICY IF EXISTS boq_items_modify ON projects.boq_items;
CREATE POLICY boq_items_modify ON projects.boq_items FOR ALL
  USING (EXISTS (SELECT 1 FROM projects.boq_sections s JOIN projects.boq_imports i ON i.id = s.import_id
                 WHERE s.id = section_id
                   AND public.user_effective_project_role(i.project_id, auth.uid()) IN ('owner','admin','project_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM projects.boq_sections s JOIN projects.boq_imports i ON i.id = s.import_id
                 WHERE s.id = section_id
                   AND public.user_effective_project_role(i.project_id, auth.uid()) IN ('owner','admin','project_manager')));

-- Storage bucket for the original .xlsx (private; org-scoped path {org}/{project}/{import}.xlsx)
INSERT INTO storage.buckets (id, name, public) VALUES ('boq-imports','boq-imports',false)
  ON CONFLICT (id) DO NOTHING;
-- Path scheme: {organisation_id}/{project_id}/{import_id}.xlsx — segment [2] is the project.
-- Mirror the table RLS read gate (project access), not just org membership.
DROP POLICY IF EXISTS boq_imports_storage_rw ON storage.objects;
CREATE POLICY boq_imports_storage_rw ON storage.objects FOR ALL
  USING (bucket_id = 'boq-imports'
         AND public.user_has_project_access( ((storage.foldername(name))[2])::uuid ))
  WITH CHECK (bucket_id = 'boq-imports'
         AND public.user_has_project_access( ((storage.foldername(name))[2])::uuid ));

NOTIFY pgrst, 'reload schema';
COMMIT;
