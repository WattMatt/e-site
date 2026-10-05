-- ---------------------------------------------------------------------------
-- Migration 00225: Rate library (E6) — catalogue, sources, lines, immutable
-- observations, CPI index values, access log.
-- ---------------------------------------------------------------------------
-- ⚠ NUMBER: claim it at APPLY time. Immediately before applying, re-check
-- THREE places: the ledger max(version), origin/main's migration filenames and
-- every OPEN PR's migration filenames (#235 holds 00224 on 2026-10-05). If
-- 00225 is taken, renumber this file and scripts/db/assert-rate-library-roles.sql.
--
-- Spec: docs/superpowers/specs/2026-10-05-rate-library-design.md
--
-- WHAT.
--   public.rate_items              catalogue (code + signature unique per org)
--   public.rate_sources            one priced document (contractor, project,
--                                  province, priced_on = escalation base)
--   public.rate_source_lines       every parsed line; CONTENT immutable, review
--                                  state (match_status …) mutable
--   public.rate_observations       confirmed (item, rate) facts; IMMUTABLE —
--                                  a correction is a new row superseding it,
--                                  a retraction is a 'void' row
--   public.rate_observations_active  view: not superseded, kind = observation
--   public.rate_index_values       monthly index series (Stats SA CPI seeded)
--   public.rate_library_access_log who viewed / exported what
--
-- WHO. Contractor rates are commercially confidential. Every rate table is
-- readable and writable ONLY by an active member of the owning organisation
-- whose ORG role is owner, admin or project_manager (COST_VIEW_ROLES). No
-- project-scoped role reaches them: a contractor, supplier, inspector or
-- client_viewer sees nothing, wherever they are promoted. The access log is
-- readable by owner/admin only. Policies are PERMISSIVE and per verb (no
-- FOR ALL — see 00205/00206), FORCE RLS on every table, no DELETE anywhere.
--
-- NO BEGIN/COMMIT: scripts/db/dry-run-migration.sh wraps this in BEGIN … ROLLBACK.
-- No new schema, so no PostgREST db_schema PATCH (playbook §7).
-- ---------------------------------------------------------------------------
-- @verify:begin
-- table: public.rate_items
-- table: public.rate_sources
-- table: public.rate_source_lines
-- table: public.rate_observations
-- table: public.rate_index_values
-- table: public.rate_library_access_log
-- view: public.rate_observations_active
-- function: public.rate_library_can_access(uuid)
-- function: public.rate_library_is_admin(uuid)
-- function: public.rate_library_bind()
-- function: public.rate_source_lines_guard()
-- function: public.rate_observations_guard()
-- trigger: rate_observations_guard ON public.rate_observations
-- trigger: rate_source_lines_guard ON public.rate_source_lines
-- policy: rate_items_select ON public.rate_items PERMISSIVE
-- policy: rate_observations_select ON public.rate_observations PERMISSIVE
-- policy: rate_observations_insert ON public.rate_observations PERMISSIVE
-- policy: rate_library_access_log_select ON public.rate_library_access_log PERMISSIVE
-- grant_absent: anon SELECT ON public.rate_observations
-- grant_absent: anon SELECT ON public.rate_items
-- grant_absent: anon SELECT ON public.rate_sources
-- grant_absent: anon SELECT ON public.rate_source_lines
-- grant_absent: anon SELECT ON public.rate_library_access_log
-- grant_absent: authenticated UPDATE ON public.rate_observations
-- grant_absent: authenticated DELETE ON public.rate_observations
-- grant_absent: authenticated DELETE ON public.rate_items
-- grant_absent: authenticated DELETE ON public.rate_source_lines
-- sql: (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_class c WHERE c.oid IN ('public.rate_items'::regclass, 'public.rate_sources'::regclass, 'public.rate_source_lines'::regclass, 'public.rate_observations'::regclass, 'public.rate_index_values'::regclass, 'public.rate_library_access_log'::regclass))
-- sql: (SELECT count(*) = 0 FROM pg_policy WHERE polrelid IN ('public.rate_items'::regclass, 'public.rate_sources'::regclass, 'public.rate_source_lines'::regclass, 'public.rate_observations'::regclass, 'public.rate_library_access_log'::regclass) AND (polcmd IN ('d', '*') OR NOT polpermissive))
-- sql: (SELECT count(*) = 140 AND min(month) = DATE '2015-01-01' AND max(month) = DATE '2026-08-01' FROM public.rate_index_values WHERE series = 'statssa_cpi_headline')
-- sql: (SELECT value = 100.0 FROM public.rate_index_values WHERE series = 'statssa_cpi_headline' AND month = DATE '2024-12-01')
-- sql: (SELECT reloptions::text LIKE '%security_invoker=true%' FROM pg_class WHERE oid = 'public.rate_observations_active'::regclass)
-- grant_absent: anon EXECUTE ON public.rate_library_can_access(uuid)
-- grant_absent: anon EXECUTE ON public.rate_library_is_admin(uuid)
-- sql: (SELECT bool_and(NOT p.prosecdef) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('rate_library_can_access', 'rate_library_is_admin', 'rate_library_bind', 'rate_source_lines_guard', 'rate_observations_guard'))
-- behaviour: scripts/db/assert-rate-library-roles.sql — every row ok
-- @verify:end

-- ── 0. Gate functions (invoker rights: a user reads only their own memberships) ──
CREATE OR REPLACE FUNCTION public.rate_library_can_access(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_organisations uo
                  WHERE uo.user_id = auth.uid() AND uo.organisation_id = p_org
                    AND uo.is_active AND uo.role IN ('owner', 'admin', 'project_manager'))
$$;
CREATE OR REPLACE FUNCTION public.rate_library_is_admin(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_organisations uo
                  WHERE uo.user_id = auth.uid() AND uo.organisation_id = p_org
                    AND uo.is_active AND uo.role IN ('owner', 'admin'))
$$;
REVOKE ALL ON FUNCTION public.rate_library_can_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rate_library_is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_library_can_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rate_library_is_admin(uuid) TO authenticated, service_role;

-- ── 1. Tables ───────────────────────────────────────────────────────────────
CREATE TABLE public.rate_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  code             text NOT NULL CHECK (btrim(code) <> ''),
  signature        text NOT NULL CHECK (btrim(signature) <> ''),
  category         text NOT NULL,
  description      text NOT NULL CHECK (btrim(description) <> ''),
  unit             text NOT NULL,
  attributes       jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT rate_items_attributes_object CHECK (jsonb_typeof(attributes) = 'object'),
  origin           text NOT NULL DEFAULT 'rule' CHECK (origin IN ('rule', 'manual')),
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_items_org_code_key UNIQUE (organisation_id, code),
  CONSTRAINT rate_items_org_signature_key UNIQUE (organisation_id, signature),
  UNIQUE (organisation_id, id)
);

CREATE TABLE public.rate_sources (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('boq_import', 'historical_file', 'tender_submission', 'manual')),
  source_ref       text NOT NULL CHECK (btrim(source_ref) <> ''),
  contractor_name  text NOT NULL CHECK (btrim(contractor_name) <> ''),
  project_id       uuid REFERENCES projects.projects(id) ON DELETE SET NULL,
  project_label    text,
  province         text CHECK (province IN ('Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
                                            'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape')),
  priced_on        date NOT NULL,
  priced_on_basis  text NOT NULL CHECK (priced_on_basis IN ('document_date', 'import_date', 'submission_date', 'stated')),
  source_file      text,
  total_ex_vat     numeric(16,2),
  reconciliation   jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(reconciliation) = 'object'),
  imported_by      uuid REFERENCES auth.users(id),
  imported_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_sources_org_kind_ref_key UNIQUE (organisation_id, kind, source_ref),
  UNIQUE (organisation_id, id)
);

CREATE TABLE public.rate_source_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL,
  source_id          uuid NOT NULL,
  sheet              text,
  row_ref            text,
  code               text,
  section_path       text[] NOT NULL DEFAULT '{}',
  description        text NOT NULL,
  unit               text,
  quantity           numeric(16,3),
  supply_rate        numeric(14,4),
  install_rate       numeric(14,4),
  rate               numeric(14,4),
  amount             numeric(16,2),
  group_key          text NOT NULL,
  match_status       text NOT NULL CHECK (match_status IN ('auto_confirmed', 'confirmed', 'suggested', 'unmatched', 'excluded', 'rejected')),
  exclusion_reason   text CHECK (exclusion_reason IN ('pc_or_provisional', 'percentage', 'unpriced', 'lump_sum', 'not_a_rate')),
  suggested_item_id  uuid,
  matched_item_id    uuid,
  match_method       text CHECK (match_method IN ('rule', 'manual', 'ai')),
  match_detail       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(match_detail) = 'object'),
  reviewed_by        uuid REFERENCES auth.users(id),
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Same-org binding through composite keys: a line can never point at another org's source or item.
  CONSTRAINT rate_source_lines_source_fk FOREIGN KEY (organisation_id, source_id) REFERENCES public.rate_sources(organisation_id, id) ON DELETE CASCADE,
  CONSTRAINT rate_source_lines_suggested_fk FOREIGN KEY (organisation_id, suggested_item_id) REFERENCES public.rate_items(organisation_id, id),
  CONSTRAINT rate_source_lines_matched_fk FOREIGN KEY (organisation_id, matched_item_id) REFERENCES public.rate_items(organisation_id, id),
  CONSTRAINT rate_source_lines_status_consistent CHECK (
    (match_status IN ('auto_confirmed', 'confirmed') AND matched_item_id IS NOT NULL)
    OR (match_status = 'excluded' AND exclusion_reason IS NOT NULL AND matched_item_id IS NULL)
    OR (match_status IN ('suggested', 'unmatched', 'rejected') AND matched_item_id IS NULL)),
  UNIQUE (organisation_id, id)
);
CREATE INDEX rate_source_lines_source_idx ON public.rate_source_lines (source_id);
CREATE INDEX rate_source_lines_queue_idx ON public.rate_source_lines (organisation_id, match_status, group_key);

CREATE TABLE public.rate_observations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL,
  kind             text NOT NULL DEFAULT 'observation' CHECK (kind IN ('observation', 'void')),
  rate_item_id     uuid NOT NULL,
  source_id        uuid NOT NULL,
  source_line_id   uuid,
  supersedes_id    uuid REFERENCES public.rate_observations(id),
  occurrences      integer NOT NULL DEFAULT 1 CHECK (occurrences >= 1),
  unit             text NOT NULL,
  supply_rate      numeric(14,4),
  install_rate     numeric(14,4),
  rate             numeric(14,4),
  contractor_name  text NOT NULL,
  project_id       uuid,
  project_label    text,
  province         text,
  priced_on        date NOT NULL,
  note             text,
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_observations_item_fk FOREIGN KEY (organisation_id, rate_item_id) REFERENCES public.rate_items(organisation_id, id),
  CONSTRAINT rate_observations_source_fk FOREIGN KEY (organisation_id, source_id) REFERENCES public.rate_sources(organisation_id, id),
  CONSTRAINT rate_observations_line_fk FOREIGN KEY (organisation_id, source_line_id) REFERENCES public.rate_source_lines(organisation_id, id),
  -- A row is superseded at most once: corrections form a chain, never a fork.
  CONSTRAINT rate_observations_supersedes_once UNIQUE (supersedes_id),
  CONSTRAINT rate_observations_shape CHECK (
    (kind = 'observation' AND rate > 0)
    OR (kind = 'void' AND supersedes_id IS NOT NULL AND rate IS NULL AND supply_rate IS NULL AND install_rate IS NULL))
);
CREATE INDEX rate_observations_item_idx ON public.rate_observations (rate_item_id, priced_on);
CREATE INDEX rate_observations_org_idx ON public.rate_observations (organisation_id);

CREATE TABLE public.rate_index_values (
  series  text NOT NULL CHECK (series IN ('statssa_cpi_headline')),
  month   date NOT NULL CHECK (extract(day FROM month) = 1),
  value   numeric(10,3) NOT NULL CHECK (value > 0),
  source  text NOT NULL,
  PRIMARY KEY (series, month)
);

CREATE TABLE public.rate_library_access_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES auth.users(id),
  action           text NOT NULL CHECK (action IN ('view_library', 'view_item', 'view_review', 'view_sources', 'export_budget', 'price_from_library')),
  target           text,
  detail           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_library_access_log_org_idx ON public.rate_library_access_log (organisation_id, created_at DESC);

-- ── 2. Attribution binding (never trusted from the client) ──────────────────
CREATE OR REPLACE FUNCTION public.rate_library_bind()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    CASE TG_TABLE_NAME
      WHEN 'rate_items' THEN
        IF TG_OP = 'INSERT' THEN NEW.created_by := auth.uid(); NEW.created_at := now(); END IF;
      WHEN 'rate_sources' THEN NEW.imported_by := auth.uid(); NEW.imported_at := now();
      WHEN 'rate_observations' THEN NEW.created_by := auth.uid(); NEW.created_at := now();
      WHEN 'rate_library_access_log' THEN NEW.user_id := auth.uid(); NEW.created_at := now();
      WHEN 'rate_source_lines' THEN
        IF TG_OP = 'UPDATE' AND NEW.match_status IS DISTINCT FROM OLD.match_status THEN
          NEW.reviewed_by := auth.uid(); NEW.reviewed_at := now();
        END IF;
      ELSE NULL;
    END CASE;
  END IF;
  IF TG_TABLE_NAME = 'rate_items' AND TG_OP = 'UPDATE' THEN
    IF NEW.organisation_id <> OLD.organisation_id OR NEW.signature <> OLD.signature OR NEW.code <> OLD.code THEN
      RAISE EXCEPTION 'rate_items: organisation, signature and code are immutable' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at; NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.rate_library_bind() FROM PUBLIC, anon;

CREATE TRIGGER rate_items_bind BEFORE INSERT OR UPDATE ON public.rate_items FOR EACH ROW EXECUTE FUNCTION public.rate_library_bind();
CREATE TRIGGER rate_sources_bind BEFORE INSERT ON public.rate_sources FOR EACH ROW EXECUTE FUNCTION public.rate_library_bind();
CREATE TRIGGER rate_observations_bind BEFORE INSERT ON public.rate_observations FOR EACH ROW EXECUTE FUNCTION public.rate_library_bind();
CREATE TRIGGER rate_library_access_log_bind BEFORE INSERT ON public.rate_library_access_log FOR EACH ROW EXECUTE FUNCTION public.rate_library_bind();
CREATE TRIGGER rate_source_lines_bind BEFORE UPDATE ON public.rate_source_lines FOR EACH ROW EXECUTE FUNCTION public.rate_library_bind();

-- ── 3. Immutability ─────────────────────────────────────────────────────────
-- Observations: no UPDATE, no DELETE, for anyone (service role included). The
-- grants are revoked too; this trigger is the floor under the grants.
CREATE OR REPLACE FUNCTION public.rate_observations_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'rate_observations are immutable: insert a correcting row with supersedes_id instead' USING ERRCODE = '42501';
  END IF;
  -- INSERT: a superseding row stays in its organisation.
  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.rate_observations o WHERE o.id = NEW.supersedes_id AND o.organisation_id = NEW.organisation_id) THEN
    RAISE EXCEPTION 'rate_observations: supersedes_id must name an observation in the same organisation' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.rate_observations_guard() FROM PUBLIC, anon;
CREATE TRIGGER rate_observations_guard BEFORE INSERT OR UPDATE OR DELETE ON public.rate_observations
  FOR EACH ROW EXECUTE FUNCTION public.rate_observations_guard();

-- Source lines: what the document said never changes; only the review state does.
CREATE OR REPLACE FUNCTION public.rate_source_lines_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'rate_source_lines cannot be deleted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.organisation_id, NEW.source_id, NEW.sheet, NEW.row_ref, NEW.code, NEW.section_path, NEW.description, NEW.unit,
      NEW.quantity, NEW.supply_rate, NEW.install_rate, NEW.rate, NEW.amount, NEW.group_key, NEW.created_at)
     IS DISTINCT FROM
     (OLD.organisation_id, OLD.source_id, OLD.sheet, OLD.row_ref, OLD.code, OLD.section_path, OLD.description, OLD.unit,
      OLD.quantity, OLD.supply_rate, OLD.install_rate, OLD.rate, OLD.amount, OLD.group_key, OLD.created_at) THEN
    RAISE EXCEPTION 'rate_source_lines: the line as priced is immutable; only its review state may change' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.rate_source_lines_guard() FROM PUBLIC, anon;
-- Deletion by the parent source's cascade is the one exception (sources have no DELETE grant either).
CREATE TRIGGER rate_source_lines_guard BEFORE UPDATE ON public.rate_source_lines
  FOR EACH ROW EXECUTE FUNCTION public.rate_source_lines_guard();

-- ── 4. Active observations view (invoker rights: the caller's RLS applies) ──
CREATE VIEW public.rate_observations_active WITH (security_invoker = true) AS
  SELECT o.* FROM public.rate_observations o
   WHERE o.kind = 'observation'
     AND NOT EXISTS (SELECT 1 FROM public.rate_observations n WHERE n.supersedes_id = o.id);

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.rate_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_sources            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_source_lines       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_observations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_index_values       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_library_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_items              FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rate_sources            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rate_source_lines       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rate_observations       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rate_index_values       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rate_library_access_log FORCE ROW LEVEL SECURITY;

CREATE POLICY rate_items_select ON public.rate_items FOR SELECT TO authenticated USING (public.rate_library_can_access(organisation_id));
CREATE POLICY rate_items_insert ON public.rate_items FOR INSERT TO authenticated WITH CHECK (public.rate_library_can_access(organisation_id));
CREATE POLICY rate_items_update ON public.rate_items FOR UPDATE TO authenticated
  USING (public.rate_library_can_access(organisation_id)) WITH CHECK (public.rate_library_can_access(organisation_id));

CREATE POLICY rate_sources_select ON public.rate_sources FOR SELECT TO authenticated USING (public.rate_library_can_access(organisation_id));
CREATE POLICY rate_sources_insert ON public.rate_sources FOR INSERT TO authenticated WITH CHECK (public.rate_library_can_access(organisation_id));

CREATE POLICY rate_source_lines_select ON public.rate_source_lines FOR SELECT TO authenticated USING (public.rate_library_can_access(organisation_id));
CREATE POLICY rate_source_lines_insert ON public.rate_source_lines FOR INSERT TO authenticated WITH CHECK (public.rate_library_can_access(organisation_id));
CREATE POLICY rate_source_lines_update ON public.rate_source_lines FOR UPDATE TO authenticated
  USING (public.rate_library_can_access(organisation_id)) WITH CHECK (public.rate_library_can_access(organisation_id));

CREATE POLICY rate_observations_select ON public.rate_observations FOR SELECT TO authenticated USING (public.rate_library_can_access(organisation_id));
CREATE POLICY rate_observations_insert ON public.rate_observations FOR INSERT TO authenticated WITH CHECK (public.rate_library_can_access(organisation_id));

CREATE POLICY rate_index_values_select ON public.rate_index_values FOR SELECT TO authenticated USING (true);

CREATE POLICY rate_library_access_log_select ON public.rate_library_access_log FOR SELECT TO authenticated USING (public.rate_library_is_admin(organisation_id));
CREATE POLICY rate_library_access_log_insert ON public.rate_library_access_log FOR INSERT TO authenticated WITH CHECK (public.rate_library_can_access(organisation_id));

-- ── 6. Grants (public's default privileges granted ALL to anon/authenticated) ──
REVOKE ALL ON public.rate_items, public.rate_sources, public.rate_source_lines, public.rate_observations,
              public.rate_index_values, public.rate_library_access_log, public.rate_observations_active FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.rate_items TO authenticated;
GRANT SELECT, INSERT ON public.rate_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.rate_source_lines TO authenticated;
GRANT SELECT, INSERT ON public.rate_observations TO authenticated;
GRANT SELECT ON public.rate_observations_active TO authenticated;
GRANT SELECT ON public.rate_index_values TO authenticated;
GRANT SELECT, INSERT ON public.rate_library_access_log TO authenticated;
GRANT ALL ON public.rate_items, public.rate_sources, public.rate_source_lines, public.rate_index_values,
             public.rate_library_access_log, public.rate_observations_active TO service_role;
GRANT SELECT, INSERT ON public.rate_observations TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.rate_observations FROM service_role;

-- ── 7. Seed: Stats SA CPI headline (Dec 2024 = 100), P0141 CPIHistory Table B1 ──
INSERT INTO public.rate_index_values (series, month, value, source)
SELECT 'statssa_cpi_headline', make_date(t.y, u.m::int, 1), u.v,
       'Stats SA P0141 CPIHistory.pdf Table B1 (Dec 2024=100), retrieved 2026-10-05'
  FROM (VALUES
    (2015, ARRAY[61.6,62,62.9,63.5,63.7,63.9,64.6,64.6,64.6,64.8,64.8,64.9]::numeric[]),
    (2016, ARRAY[65.5,66.3,66.8,67.4,67.5,67.9,68.5,68.4,68.5,68.8,69.1,69.3]::numeric[]),
    (2017, ARRAY[69.8,70.5,71,71,71.2,71.4,71.6,71.7,72,72.2,72.3,72.6]::numeric[]),
    (2018, ARRAY[72.8,73.4,73.6,74.2,74.3,74.6,75.3,75.2,75.5,75.9,76,75.9]::numeric[]),
    (2019, ARRAY[75.7,76.3,77,77.4,77.7,78,78.2,78.5,78.6,78.6,78.7,78.9]::numeric[]),
    (2020, ARRAY[79.2,79.9,80.2,79.8,79.2,79.7,80.7,80.9,81,81.2,81.2,81.3]::numeric[]),
    (2021, ARRAY[81.7,82.2,82.8,83.3,83.4,83.5,84.5,84.8,85,85.3,85.6,86.1]::numeric[]),
    (2022, ARRAY[86.3,86.8,87.7,88.2,88.8,89.8,91.1,91.3,91.4,91.7,92,92.3]::numeric[]),
    (2023, ARRAY[92.2,92.9,93.9,94.2,94.4,94.6,95.4,95.7,96.3,97.2,97.1,97.1]::numeric[]),
    (2024, ARRAY[97.2,98.1,98.9,99.1,99.3,99.4,99.8,99.9,100,99.9,99.9,100]::numeric[]),
    (2025, ARRAY[100.3,101.2,101.6,101.9,102.1,102.4,103.3,103.2,103.4,103.5,103.4,103.6]::numeric[]),
    (2026, ARRAY[103.8,104.2,104.8,106,106.7,107.5,107.7,107.7]::numeric[])
  ) AS t(y, vals)
  CROSS JOIN LATERAL unnest(t.vals) WITH ORDINALITY AS u(v, m);

NOTIFY pgrst, 'reload schema';
