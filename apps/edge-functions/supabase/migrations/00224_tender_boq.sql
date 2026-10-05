-- 00224_tender_boq.sql
-- E5 slice A: tender BOQ model + import.
--
-- A tender is a project's call for prices on one package (electrical contract,
-- lighting, generator …). Its BOQ is stored ROW-FAITHFUL to the issued workbook:
-- one row per meaningful sheet row, with the sheet name, the Excel row number and
-- the column letters of its rate and amount cells, so slice C can prove a
-- tenderer's priced copy changed no locked cell.
--
-- Tables live in the existing `projects` schema (no CREATE SCHEMA, so no
-- PostgREST db_schema change). Every table is readable and writable ONLY by the
-- project's owner/admin/project_manager — not by every project member: a
-- contractor on site must not see a tender being prepared. Policies are split
-- per verb (no FOR ALL, and nothing RESTRICTIVE that could narrow reads by
-- accident — see the 00205/00206 lesson). Slice B adds the tenderer read path.
--
-- No BEGIN/COMMIT: `db push` and scripts/db/dry-run-migration.sh wrap the file.
-- A COMMIT here ends the dry-run's transaction and persists the migration.

-- ── 1. tenders ─────────────────────────────────────────────────────────────
CREATE TABLE projects.tenders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id),
  package          text NOT NULL,
  title            text NOT NULL,
  revision         text,
  status           text NOT NULL DEFAULT 'draft',
  closing_at       timestamptz,
  source_filename  text,
  source_path      text,
  estimate_filename text,
  estimate_path    text,
  stated_subtotal  numeric(16,2),
  stated_vat       numeric(16,2),
  stated_total     numeric(16,2),
  reconciliation   jsonb,
  structure_diff   jsonb,
  imported_at      timestamptz,
  created_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenders_package_not_blank CHECK (btrim(package) <> ''),
  CONSTRAINT tenders_title_not_blank   CHECK (btrim(title) <> ''),
  CONSTRAINT tenders_status_check
    CHECK (status IN ('draft','issued','closed','adjudicated','cancelled')),
  -- A tender cannot leave draft without a closing time: the sealed-bid rule
  -- (slice C) keys on it.
  CONSTRAINT tenders_closing_required CHECK (status = 'draft' OR closing_at IS NOT NULL)
);
CREATE INDEX tenders_project_idx ON projects.tenders(project_id, created_at DESC);

-- ── 2. tender_boq_items (row-faithful) ─────────────────────────────────────
CREATE TABLE projects.tender_boq_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id       uuid NOT NULL REFERENCES projects.tenders(id) ON DELETE CASCADE,
  sort_order      int  NOT NULL,
  sheet_name      text NOT NULL,
  row_number      int  NOT NULL,
  kind            text NOT NULL,
  bill_code       text NOT NULL,
  code            text,
  description     text NOT NULL DEFAULT '',
  unit            text,
  quantity        numeric(16,4),
  heading_path    text[] NOT NULL DEFAULT '{}',
  rate_cell_type  text,
  fixed_amount    numeric(16,2),
  stated_amount   numeric(16,2),
  rate_column     text,
  amount_column   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_boq_items_kind_check CHECK (kind IN ('heading','item','note','total')),
  CONSTRAINT tender_boq_items_rate_cell_type_check
    CHECK (rate_cell_type IN ('priced','fixed','rate_only','not_priced')),
  -- Items, and only items, carry a rate-cell type.
  CONSTRAINT tender_boq_items_type_iff_item CHECK ((kind = 'item') = (rate_cell_type IS NOT NULL)),
  CONSTRAINT tender_boq_items_row_positive CHECK (row_number > 0),
  CONSTRAINT tender_boq_items_column_letters
    CHECK ((rate_column IS NULL OR rate_column ~ '^[A-Z]{1,3}$')
       AND (amount_column IS NULL OR amount_column ~ '^[A-Z]{1,3}$')),
  CONSTRAINT tender_boq_items_cell_key UNIQUE (tender_id, sheet_name, row_number),
  -- FK target for tender_estimate_lines (same-tender binding).
  CONSTRAINT tender_boq_items_tender_id_id_key UNIQUE (tender_id, id)
);
CREATE INDEX tender_boq_items_order_idx ON projects.tender_boq_items(tender_id, sort_order);

-- ── 3. tender_estimate_lines (WM's internal PRE-PRICED estimate) ───────────
CREATE TABLE projects.tender_estimate_lines (
  item_id     uuid PRIMARY KEY,
  tender_id   uuid NOT NULL,
  rate        numeric(16,4),
  amount      numeric(16,2),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_estimate_lines_item_fk FOREIGN KEY (tender_id, item_id)
    REFERENCES projects.tender_boq_items(tender_id, id) ON DELETE CASCADE
);
CREATE INDEX tender_estimate_lines_tender_idx ON projects.tender_estimate_lines(tender_id);

-- ── 4. tender_requirements ─────────────────────────────────────────────────
CREATE TABLE projects.tender_requirements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id   uuid NOT NULL REFERENCES projects.tenders(id) ON DELETE CASCADE,
  sort_order  int  NOT NULL DEFAULT 0,
  kind        text NOT NULL DEFAULT 'document',
  label       text NOT NULL,
  detail      text,
  mandatory   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_requirements_kind_check CHECK (kind IN ('document','declaration')),
  CONSTRAINT tender_requirements_label_not_blank CHECK (btrim(label) <> '')
);
CREATE INDEX tender_requirements_tender_idx ON projects.tender_requirements(tender_id, sort_order);

-- ── Triggers ───────────────────────────────────────────────────────────────

-- organisation_id is DERIVED from the project, never trusted from the client;
-- created_by is the caller on the user path (the service path may supply it).
CREATE FUNCTION projects.tenders_bind_parents() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  SELECT p.organisation_id INTO NEW.organisation_id
    FROM projects.projects p WHERE p.id = NEW.project_id;
  IF NEW.organisation_id IS NULL THEN
    RAISE EXCEPTION 'tender project % does not exist', NEW.project_id USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenders_bind_parents BEFORE INSERT OR UPDATE ON projects.tenders
  FOR EACH ROW EXECUTE FUNCTION projects.tenders_bind_parents();

-- Once a tender leaves draft its BOQ, estimate and requirements are frozen: a
-- tenderer prices exactly what was issued. A cascade from deleting the tender
-- itself (or its project) must still work, so the lock only applies while the
-- parent row still exists (the cascade runs after the parent is gone).
CREATE FUNCTION projects.tender_children_locked() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tender uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.tender_id ELSE NEW.tender_id END;
  v_status text;
BEGIN
  SELECT t.status INTO v_status FROM projects.tenders t WHERE t.id = v_tender;
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'tender % is %; its BOQ can no longer change', v_tender, v_status
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.tender_id IS DISTINCT FROM NEW.tender_id THEN
    RAISE EXCEPTION 'a BOQ row cannot move to another tender' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER tender_boq_items_locked BEFORE INSERT OR UPDATE OR DELETE ON projects.tender_boq_items
  FOR EACH ROW EXECUTE FUNCTION projects.tender_children_locked();
CREATE TRIGGER tender_estimate_lines_locked BEFORE INSERT OR UPDATE OR DELETE ON projects.tender_estimate_lines
  FOR EACH ROW EXECUTE FUNCTION projects.tender_children_locked();
CREATE TRIGGER tender_requirements_locked BEFORE INSERT OR UPDATE OR DELETE ON projects.tender_requirements
  FOR EACH ROW EXECUTE FUNCTION projects.tender_children_locked();

-- Status only moves forward, and once a tender leaves draft the facts its
-- bidders priced against are frozen: its project, the imported workbooks and
-- the stored reconciliation. Without this an owner/admin/PM could PATCH an
-- issued tender back to draft over PostgREST, edit the BOQ and re-issue it.
-- The closing time may only be extended (slice C's sealed-bid rule keys on it).
CREATE FUNCTION projects.tenders_status_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'draft'  AND NEW.status IN ('issued','cancelled'))
    OR (OLD.status = 'issued' AND NEW.status IN ('closed','cancelled'))
    OR (OLD.status = 'closed' AND NEW.status IN ('adjudicated','cancelled'))
  ) THEN
    RAISE EXCEPTION 'a tender cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '55000';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'a tender cannot move to another project' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'issued' THEN
    IF NEW.closing_at <= now() THEN
      RAISE EXCEPTION 'the closing time must be in the future when a tender is issued' USING ERRCODE = '23514';
    END IF;
    IF NEW.imported_at IS NULL THEN
      RAISE EXCEPTION 'import the BOQ before issuing the tender' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD.status <> 'draft' THEN
    IF NEW.closing_at IS DISTINCT FROM OLD.closing_at
       AND (NEW.closing_at IS NULL OR NEW.closing_at < OLD.closing_at) THEN
      RAISE EXCEPTION 'an issued tender''s closing time can only be extended' USING ERRCODE = '55000';
    END IF;
    IF NEW.source_path IS DISTINCT FROM OLD.source_path
       OR NEW.source_filename IS DISTINCT FROM OLD.source_filename
       OR NEW.estimate_path IS DISTINCT FROM OLD.estimate_path
       OR NEW.estimate_filename IS DISTINCT FROM OLD.estimate_filename
       OR NEW.reconciliation IS DISTINCT FROM OLD.reconciliation
       OR NEW.structure_diff IS DISTINCT FROM OLD.structure_diff
       OR NEW.imported_at IS DISTINCT FROM OLD.imported_at
       OR NEW.stated_subtotal IS DISTINCT FROM OLD.stated_subtotal
       OR NEW.stated_vat IS DISTINCT FROM OLD.stated_vat
       OR NEW.stated_total IS DISTINCT FROM OLD.stated_total
       OR NEW.package IS DISTINCT FROM OLD.package
       OR NEW.revision IS DISTINCT FROM OLD.revision THEN
      RAISE EXCEPTION 'the import of an issued tender is frozen' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tenders_status_guard BEFORE UPDATE ON projects.tenders
  FOR EACH ROW EXECUTE FUNCTION projects.tenders_status_guard();

CREATE TRIGGER tenders_set_updated_at BEFORE UPDATE ON projects.tenders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tender_boq_items_set_updated_at BEFORE UPDATE ON projects.tender_boq_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tender_requirements_set_updated_at BEFORE UPDATE ON projects.tender_requirements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Access helper ──────────────────────────────────────────────────────────
-- Definer function so child-table policies need no join through RLS-protected
-- parents. NULL-safe: a non-member resolves to NULL, coalesced to false.
CREATE FUNCTION projects.user_can_manage_tender(p_tender_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT public.user_effective_project_role(t.project_id, auth.uid())
              IN ('owner','admin','project_manager')
       FROM projects.tenders t WHERE t.id = p_tender_id),
    false)
$$;
REVOKE ALL ON FUNCTION projects.user_can_manage_tender(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.user_can_manage_tender(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION projects.user_can_manage_tender(uuid) TO authenticated, service_role;

-- Atomic import: replace a draft's BOQ and estimate and stamp the tender in ONE
-- transaction, holding the tender row lock so two imports cannot interleave.
-- SECURITY INVOKER: every statement runs under the caller's row security, so
-- this grants nothing the per-table policies do not already grant.
CREATE FUNCTION projects.tender_replace_boq(p_tender_id uuid, p_meta jsonb, p_rows jsonb, p_estimate jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_status text;
  v_items  integer;
BEGIN
  SELECT t.status INTO v_status FROM projects.tenders t WHERE t.id = p_tender_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'tender not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft tender can be re-imported' USING ERRCODE = '55000';
  END IF;

  DELETE FROM projects.tender_boq_items WHERE tender_id = p_tender_id;

  INSERT INTO projects.tender_boq_items
    (tender_id, sort_order, sheet_name, row_number, kind, bill_code, code, description, unit,
     quantity, heading_path, rate_cell_type, fixed_amount, stated_amount, rate_column, amount_column)
  SELECT p_tender_id, r.sort_order, r.sheet_name, r.row_number, r.kind, r.bill_code, r.code,
         coalesce(r.description, ''), r.unit, r.quantity, coalesce(r.heading_path, '{}'),
         r.rate_cell_type, r.fixed_amount, r.stated_amount, r.rate_column, r.amount_column
    FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS r(
         sort_order int, sheet_name text, row_number int, kind text, bill_code text, code text,
         description text, unit text, quantity numeric, heading_path text[], rate_cell_type text,
         fixed_amount numeric, stated_amount numeric, rate_column text, amount_column text);

  INSERT INTO projects.tender_estimate_lines (item_id, tender_id, rate, amount)
  SELECT i.id, p_tender_id, e.rate, e.amount
    FROM jsonb_to_recordset(coalesce(p_estimate, '[]'::jsonb)) AS e(sheet_name text, row_number int, rate numeric, amount numeric)
    JOIN projects.tender_boq_items i
      ON i.tender_id = p_tender_id AND i.sheet_name = e.sheet_name AND i.row_number = e.row_number AND i.kind = 'item';

  SELECT count(*) INTO v_items FROM projects.tender_boq_items WHERE tender_id = p_tender_id AND kind = 'item';

  UPDATE projects.tenders SET
    source_filename   = p_meta->>'source_filename',
    source_path       = p_meta->>'source_path',
    estimate_filename = p_meta->>'estimate_filename',
    estimate_path     = p_meta->>'estimate_path',
    stated_subtotal   = (p_meta->>'stated_subtotal')::numeric,
    stated_vat        = (p_meta->>'stated_vat')::numeric,
    stated_total      = (p_meta->>'stated_total')::numeric,
    reconciliation    = p_meta->'reconciliation',
    structure_diff    = p_meta->'structure_diff',
    imported_at       = now()
  WHERE id = p_tender_id;

  RETURN v_items;
END $$;
REVOKE ALL ON FUNCTION projects.tender_replace_boq(uuid, jsonb, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.tender_replace_boq(uuid, jsonb, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION projects.tender_replace_boq(uuid, jsonb, jsonb, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION projects.tenders_status_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.tenders_status_guard() FROM anon, authenticated;
REVOKE ALL ON FUNCTION projects.tenders_bind_parents() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.tenders_bind_parents() FROM anon, authenticated;
REVOKE ALL ON FUNCTION projects.tender_children_locked() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION projects.tender_children_locked() FROM anon, authenticated;

-- ── Row security ───────────────────────────────────────────────────────────
ALTER TABLE projects.tenders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_boq_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_estimate_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_requirements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.tenders               FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_boq_items      FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_estimate_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.tender_requirements   FORCE ROW LEVEL SECURITY;

CREATE POLICY tenders_select ON projects.tenders FOR SELECT TO authenticated
  USING (COALESCE(public.user_effective_project_role(project_id, auth.uid()), '') IN ('owner','admin','project_manager'));
CREATE POLICY tenders_insert ON projects.tenders FOR INSERT TO authenticated
  WITH CHECK (COALESCE(public.user_effective_project_role(project_id, auth.uid()), '') IN ('owner','admin','project_manager'));
CREATE POLICY tenders_update ON projects.tenders FOR UPDATE TO authenticated
  USING (COALESCE(public.user_effective_project_role(project_id, auth.uid()), '') IN ('owner','admin','project_manager'))
  WITH CHECK (COALESCE(public.user_effective_project_role(project_id, auth.uid()), '') IN ('owner','admin','project_manager'));
-- Only a draft may be deleted by a user; an issued tender is a record.
CREATE POLICY tenders_delete ON projects.tenders FOR DELETE TO authenticated
  USING (status = 'draft'
         AND COALESCE(public.user_effective_project_role(project_id, auth.uid()), '') IN ('owner','admin','project_manager'));

CREATE POLICY tender_boq_items_select ON projects.tender_boq_items FOR SELECT TO authenticated
  USING (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_boq_items_insert ON projects.tender_boq_items FOR INSERT TO authenticated
  WITH CHECK (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_boq_items_update ON projects.tender_boq_items FOR UPDATE TO authenticated
  USING (projects.user_can_manage_tender(tender_id)) WITH CHECK (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_boq_items_delete ON projects.tender_boq_items FOR DELETE TO authenticated
  USING (projects.user_can_manage_tender(tender_id));

CREATE POLICY tender_estimate_lines_select ON projects.tender_estimate_lines FOR SELECT TO authenticated
  USING (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_estimate_lines_insert ON projects.tender_estimate_lines FOR INSERT TO authenticated
  WITH CHECK (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_estimate_lines_update ON projects.tender_estimate_lines FOR UPDATE TO authenticated
  USING (projects.user_can_manage_tender(tender_id)) WITH CHECK (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_estimate_lines_delete ON projects.tender_estimate_lines FOR DELETE TO authenticated
  USING (projects.user_can_manage_tender(tender_id));

CREATE POLICY tender_requirements_select ON projects.tender_requirements FOR SELECT TO authenticated
  USING (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_requirements_insert ON projects.tender_requirements FOR INSERT TO authenticated
  WITH CHECK (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_requirements_update ON projects.tender_requirements FOR UPDATE TO authenticated
  USING (projects.user_can_manage_tender(tender_id)) WITH CHECK (projects.user_can_manage_tender(tender_id));
CREATE POLICY tender_requirements_delete ON projects.tender_requirements FOR DELETE TO authenticated
  USING (projects.user_can_manage_tender(tender_id));

REVOKE ALL ON projects.tenders, projects.tender_boq_items,
              projects.tender_estimate_lines, projects.tender_requirements FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects.tenders, projects.tender_boq_items,
              projects.tender_estimate_lines, projects.tender_requirements TO authenticated;
GRANT ALL ON projects.tenders, projects.tender_boq_items,
             projects.tender_estimate_lines, projects.tender_requirements TO service_role;

-- ── Storage: private bucket, written and read only by the server ───────────
-- No storage.objects policy is created for it, so neither anon nor
-- authenticated can touch it; the app mints signed upload/download URLs with
-- the service role AFTER its own role check.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('tender-files', 'tender-files', false, 52428800)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- @verify:begin
-- table: projects.tenders
-- table: projects.tender_boq_items
-- table: projects.tender_estimate_lines
-- table: projects.tender_requirements
-- column: projects.tender_boq_items.rate_cell_type
-- column: projects.tender_boq_items.amount_column
-- constraint: tenders_closing_required ON projects.tenders
-- constraint: tender_boq_items_type_iff_item ON projects.tender_boq_items
-- constraint: tender_boq_items_cell_key ON projects.tender_boq_items
-- constraint: tender_estimate_lines_item_fk ON projects.tender_estimate_lines
-- function: projects.user_can_manage_tender(uuid)
-- function: projects.tenders_bind_parents()
-- function: projects.tender_children_locked()
-- trigger: tenders_bind_parents ON projects.tenders
-- trigger: tender_boq_items_locked ON projects.tender_boq_items
-- trigger: tender_estimate_lines_locked ON projects.tender_estimate_lines
-- trigger: tender_requirements_locked ON projects.tender_requirements
-- policy: tenders_select ON projects.tenders
-- policy: tenders_delete ON projects.tenders
-- policy: tender_boq_items_select ON projects.tender_boq_items
-- policy: tender_estimate_lines_select ON projects.tender_estimate_lines
-- policy: tender_requirements_select ON projects.tender_requirements
-- grant_present: authenticated SELECT ON projects.tenders
-- grant_absent: anon SELECT ON projects.tenders
-- grant_absent: anon SELECT ON projects.tender_estimate_lines
-- grant_absent: anon EXECUTE ON projects.user_can_manage_tender(uuid)
-- sql: (SELECT bool_and(relrowsecurity AND relforcerowsecurity) FROM pg_class WHERE oid IN ('projects.tenders'::regclass, 'projects.tender_boq_items'::regclass, 'projects.tender_estimate_lines'::regclass, 'projects.tender_requirements'::regclass))
-- sql: (SELECT NOT public FROM storage.buckets WHERE id = 'tender-files')
-- sql: (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%tender-files%')
-- function: projects.tenders_status_guard()
-- function: projects.tender_replace_boq(uuid, jsonb, jsonb, jsonb)
-- trigger: tenders_status_guard ON projects.tenders
-- grant_absent: anon EXECUTE ON projects.tender_replace_boq(uuid, jsonb, jsonb, jsonb)
-- sql: (SELECT count(*) = 4 FROM pg_policies WHERE schemaname = 'projects' AND tablename IN ('tenders','tender_boq_items','tender_estimate_lines','tender_requirements') AND cmd = 'SELECT')
-- sql: (SELECT qual LIKE '%project_manager%' AND qual NOT LIKE '%user_has_project_access%' FROM pg_policies WHERE schemaname = 'projects' AND policyname = 'tenders_select')
-- sql: (SELECT bool_and(qual LIKE '%user_can_manage_tender%') FROM pg_policies WHERE schemaname = 'projects' AND tablename IN ('tender_boq_items','tender_estimate_lines','tender_requirements') AND cmd = 'SELECT')
-- sql: (SELECT bool_and(permissive = 'PERMISSIVE') FROM pg_policies WHERE schemaname = 'projects' AND tablename LIKE 'tender%')
-- @verify:end
