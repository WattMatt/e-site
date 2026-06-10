-- 00127_project_valuations.sql — dated valuations + payment-certificate lines.
BEGIN;

CREATE TABLE IF NOT EXISTS projects.valuations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id   uuid NOT NULL REFERENCES public.organisations(id),
  boq_import_id     uuid NOT NULL REFERENCES projects.boq_imports(id),
  valuation_no      int  NOT NULL DEFAULT 0,
  valuation_date    date NOT NULL,
  status            text NOT NULL DEFAULT 'draft',
  retention_pct     numeric(5,2) NOT NULL,
  gross_to_date     numeric(16,2),
  retention_amount  numeric(16,2),
  net_to_date       numeric(16,2),
  previous_net      numeric(16,2),
  due_ex_vat        numeric(16,2),
  vat_amount        numeric(16,2),
  due_incl_vat      numeric(16,2),
  report_id         uuid REFERENCES projects.reports(id),
  notes             text,
  created_by        uuid REFERENCES public.profiles(id),
  certified_by      uuid REFERENCES public.profiles(id),
  certified_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE projects.valuations DROP CONSTRAINT IF EXISTS valuations_status_check;
ALTER TABLE projects.valuations ADD CONSTRAINT valuations_status_check CHECK (status IN ('draft','certified'));
CREATE UNIQUE INDEX IF NOT EXISTS valuations_project_no ON projects.valuations(project_id, valuation_no);
CREATE INDEX IF NOT EXISTS valuations_project_idx ON projects.valuations(project_id);

-- per-project valuation_no (mirror 00120 snag_visits numbering)
CREATE OR REPLACE FUNCTION projects.valuations_set_no() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.valuation_no = 0 OR NEW.valuation_no IS NULL THEN
    SELECT COALESCE(MAX(valuation_no), 0) + 1 INTO NEW.valuation_no
      FROM projects.valuations WHERE project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS valuations_set_no ON projects.valuations;
CREATE TRIGGER valuations_set_no BEFORE INSERT ON projects.valuations
  FOR EACH ROW EXECUTE FUNCTION projects.valuations_set_no();

CREATE TABLE IF NOT EXISTS projects.valuation_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valuation_id      uuid NOT NULL REFERENCES projects.valuations(id) ON DELETE CASCADE,
  boq_item_id       uuid NOT NULL REFERENCES projects.boq_items(id) ON DELETE CASCADE,
  input_method      text NOT NULL,
  percent_complete  numeric(6,3),
  qty_complete      numeric(14,3),
  value_to_date     numeric(16,2) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE projects.valuation_lines DROP CONSTRAINT IF EXISTS valuation_lines_method_check;
ALTER TABLE projects.valuation_lines ADD CONSTRAINT valuation_lines_method_check CHECK (input_method IN ('percent','quantity','section'));
CREATE UNIQUE INDEX IF NOT EXISTS valuation_lines_uniq ON projects.valuation_lines(valuation_id, boq_item_id);
CREATE INDEX IF NOT EXISTS valuation_lines_valuation_idx ON projects.valuation_lines(valuation_id);

DROP TRIGGER IF EXISTS valuations_set_updated_at ON projects.valuations;
CREATE TRIGGER valuations_set_updated_at BEFORE UPDATE ON projects.valuations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS valuation_lines_set_updated_at ON projects.valuation_lines;
CREATE TRIGGER valuation_lines_set_updated_at BEFORE UPDATE ON projects.valuation_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE projects.valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.valuation_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS valuations_select ON projects.valuations;
CREATE POLICY valuations_select ON projects.valuations FOR SELECT
  USING (public.user_has_project_access(project_id));
DROP POLICY IF EXISTS valuations_modify ON projects.valuations;
CREATE POLICY valuations_modify ON projects.valuations FOR ALL
  USING (public.user_effective_project_role(project_id, auth.uid()) IN ('owner','admin','project_manager'))
  WITH CHECK (public.user_effective_project_role(project_id, auth.uid()) IN ('owner','admin','project_manager'));

DROP POLICY IF EXISTS valuation_lines_select ON projects.valuation_lines;
CREATE POLICY valuation_lines_select ON projects.valuation_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects.valuations v WHERE v.id = valuation_id AND public.user_has_project_access(v.project_id)));
DROP POLICY IF EXISTS valuation_lines_modify ON projects.valuation_lines;
CREATE POLICY valuation_lines_modify ON projects.valuation_lines FOR ALL
  USING (EXISTS (SELECT 1 FROM projects.valuations v WHERE v.id = valuation_id
                 AND public.user_effective_project_role(v.project_id, auth.uid()) IN ('owner','admin','project_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM projects.valuations v WHERE v.id = valuation_id
                 AND public.user_effective_project_role(v.project_id, auth.uid()) IN ('owner','admin','project_manager')));

NOTIFY pgrst, 'reload schema';
COMMIT;
