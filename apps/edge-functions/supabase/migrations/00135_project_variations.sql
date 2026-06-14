-- 00135_project_variations.sql — variation orders + lines; boq_items origin columns.
BEGIN;

-- ─── 1. variation_orders ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects.variation_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id),
  boq_import_id    uuid NOT NULL REFERENCES projects.boq_imports(id),
  vo_no            int  NOT NULL DEFAULT 0,
  vo_date          date NOT NULL,
  title            text NOT NULL,
  reason           text,
  status           text NOT NULL DEFAULT 'draft',
  net_change       numeric(16,2),
  approved_by      uuid REFERENCES public.profiles(id),
  approved_at      timestamptz,
  created_by       uuid REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects.variation_orders DROP CONSTRAINT IF EXISTS variation_orders_status_check;
ALTER TABLE projects.variation_orders ADD CONSTRAINT variation_orders_status_check
  CHECK (status IN ('draft','approved'));

CREATE UNIQUE INDEX IF NOT EXISTS variation_orders_project_no
  ON projects.variation_orders(project_id, vo_no);
CREATE INDEX IF NOT EXISTS variation_orders_project_idx
  ON projects.variation_orders(project_id);

-- per-project auto-numbering trigger
CREATE OR REPLACE FUNCTION projects.variation_orders_set_no() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.vo_no = 0 OR NEW.vo_no IS NULL THEN
    SELECT COALESCE(MAX(vo_no), 0) + 1 INTO NEW.vo_no
      FROM projects.variation_orders WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS variation_orders_set_no ON projects.variation_orders;
CREATE TRIGGER variation_orders_set_no BEFORE INSERT ON projects.variation_orders
  FOR EACH ROW EXECUTE FUNCTION projects.variation_orders_set_no();

-- ─── 2. variation_lines ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS projects.variation_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variation_order_id   uuid NOT NULL REFERENCES projects.variation_orders(id) ON DELETE CASCADE,
  kind                 text NOT NULL,
  boq_item_id          uuid REFERENCES projects.boq_items(id) ON DELETE CASCADE,
  qty_delta            numeric(14,3),
  section_id           uuid REFERENCES projects.boq_sections(id),
  code                 text,
  description          text,
  unit                 text,
  quantity             numeric(14,3),
  rate_model           text,
  supply_rate          numeric(14,4),
  install_rate         numeric(14,4),
  rate                 numeric(14,4),
  value_change         numeric(16,2) NOT NULL,
  materialized_item_id uuid REFERENCES projects.boq_items(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE projects.variation_lines DROP CONSTRAINT IF EXISTS variation_lines_kind_check;
ALTER TABLE projects.variation_lines ADD CONSTRAINT variation_lines_kind_check
  CHECK (kind IN ('adjust','add'));

ALTER TABLE projects.variation_lines DROP CONSTRAINT IF EXISTS variation_lines_rate_model_check;
ALTER TABLE projects.variation_lines ADD CONSTRAINT variation_lines_rate_model_check
  CHECK (rate_model IS NULL OR rate_model IN ('supply_install','single'));

ALTER TABLE projects.variation_lines DROP CONSTRAINT IF EXISTS variation_lines_kind_fields_check;
ALTER TABLE projects.variation_lines ADD CONSTRAINT variation_lines_kind_fields_check
  CHECK ((kind = 'adjust' AND boq_item_id IS NOT NULL)
      OR (kind = 'add' AND section_id IS NOT NULL AND description IS NOT NULL));

CREATE INDEX IF NOT EXISTS variation_lines_vo_idx
  ON projects.variation_lines(variation_order_id);
CREATE INDEX IF NOT EXISTS variation_lines_item_idx
  ON projects.variation_lines(boq_item_id);

-- ─── 3. boq_items: provenance columns ────────────────────────────────────────
-- Additive; all existing rows default to 'contract'.

ALTER TABLE projects.boq_items ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'contract';

ALTER TABLE projects.boq_items DROP CONSTRAINT IF EXISTS boq_items_origin_check;
ALTER TABLE projects.boq_items ADD CONSTRAINT boq_items_origin_check
  CHECK (origin IN ('contract','variation'));

ALTER TABLE projects.boq_items ADD COLUMN IF NOT EXISTS variation_line_id uuid
  REFERENCES projects.variation_lines(id);

-- One materialized boq_item per variation line: concurrent approvals of the
-- same VO cannot double-materialize a line (the second insert hits the index).
CREATE UNIQUE INDEX IF NOT EXISTS boq_items_variation_line_uniq
  ON projects.boq_items(variation_line_id) WHERE variation_line_id IS NOT NULL;

-- ─── 4. updated_at triggers ───────────────────────────────────────────────────

DROP TRIGGER IF EXISTS variation_orders_set_updated_at ON projects.variation_orders;
CREATE TRIGGER variation_orders_set_updated_at BEFORE UPDATE ON projects.variation_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS variation_lines_set_updated_at ON projects.variation_lines;
CREATE TRIGGER variation_lines_set_updated_at BEFORE UPDATE ON projects.variation_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── 5. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE projects.variation_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.variation_lines  ENABLE ROW LEVEL SECURITY;

-- variation_orders: any project member can read; owner/admin/PM can write
DROP POLICY IF EXISTS variation_orders_select ON projects.variation_orders;
CREATE POLICY variation_orders_select ON projects.variation_orders FOR SELECT
  USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS variation_orders_modify ON projects.variation_orders;
CREATE POLICY variation_orders_modify ON projects.variation_orders FOR ALL
  USING (public.user_effective_project_role(project_id, auth.uid())
           IN ('owner','admin','project_manager'))
  WITH CHECK (public.user_effective_project_role(project_id, auth.uid())
           IN ('owner','admin','project_manager'));

-- variation_lines: inherit access from their parent variation_order
DROP POLICY IF EXISTS variation_lines_select ON projects.variation_lines;
CREATE POLICY variation_lines_select ON projects.variation_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects.variation_orders v
                 WHERE v.id = variation_order_id
                   AND public.user_has_project_access(v.project_id)));

DROP POLICY IF EXISTS variation_lines_modify ON projects.variation_lines;
CREATE POLICY variation_lines_modify ON projects.variation_lines FOR ALL
  USING (EXISTS (SELECT 1 FROM projects.variation_orders v
                 WHERE v.id = variation_order_id
                   AND public.user_effective_project_role(v.project_id, auth.uid())
                         IN ('owner','admin','project_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM projects.variation_orders v
                 WHERE v.id = variation_order_id
                   AND public.user_effective_project_role(v.project_id, auth.uid())
                         IN ('owner','admin','project_manager')));

NOTIFY pgrst, 'reload schema';
COMMIT;
