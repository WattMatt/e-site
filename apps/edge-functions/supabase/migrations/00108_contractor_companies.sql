-- 00108_contractor_companies.sql
--
-- Introduces a first-class "contractor company" entity within an organisation
-- so site agents working for the same outside firm can be grouped, filtered,
-- and bulk-managed. Companies are scoped to YOUR org (organisation_id); they
-- are NOT separate auth tenants. A user belongs to at most one contractor
-- company within an org (via user_organisations.contractor_company_id).
--
-- This is intentionally lighter than the marketplace's contractor_org_id
-- (which refers to public.organisations) — different concept, different
-- table, no conflation.
--
-- Reversible:
--   ALTER TABLE public.user_organisations DROP COLUMN contractor_company_id;
--   DROP TABLE projects.contractor_companies;
-- ---------------------------------------------------------------------------

-- ── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE projects.contractor_companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID REFERENCES public.profiles(id),
    UNIQUE (organisation_id, name)
);

COMMENT ON TABLE projects.contractor_companies IS
  'Lightweight contractor-company entity scoped to an organisation. Used to '
  'group external site agents (users with role contractor/inspector/supplier) '
  'so they can be managed as a unit. Distinct from the marketplace '
  'contractor_org_id concept which refers to public.organisations.';

CREATE INDEX idx_contractor_companies_org_active
  ON projects.contractor_companies (organisation_id, active);

-- ── Membership link ────────────────────────────────────────────────────────

ALTER TABLE public.user_organisations
    ADD COLUMN contractor_company_id UUID NULL
        REFERENCES projects.contractor_companies(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.user_organisations.contractor_company_id IS
  'Optional grouping label. NULL means internal / unaffiliated. The referenced '
  'company must belong to the same organisation_id as this membership row '
  '(enforced by the org-scoped UI; not a DB constraint to keep it cheap).';

CREATE INDEX idx_user_organisations_contractor_company
  ON public.user_organisations (contractor_company_id)
  WHERE contractor_company_id IS NOT NULL;

-- ── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE projects.contractor_companies ENABLE ROW LEVEL SECURITY;

-- Any active org member can SELECT companies in their org (needed for the
-- dropdown when adding members; client_viewers see the names too — names
-- are not sensitive).
CREATE POLICY "Org members can view contractor companies"
    ON projects.contractor_companies FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- Writes restricted to org owner/admin/PM via the web layer (server actions
-- enforce ORG_WRITE_ROLES). At the DB level, allow any active org member to
-- INSERT/UPDATE/DELETE so the web gate is the single source of role policy —
-- matches the pattern used for projects.project_members in 00027.
CREATE POLICY "Org members can insert contractor companies"
    ON projects.contractor_companies FOR INSERT
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can update contractor companies"
    ON projects.contractor_companies FOR UPDATE
    USING (organisation_id = ANY(public.get_user_org_ids()));

CREATE POLICY "Org members can delete contractor companies"
    ON projects.contractor_companies FOR DELETE
    USING (organisation_id = ANY(public.get_user_org_ids()));
