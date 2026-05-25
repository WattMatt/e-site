-- 00099_jbcc_module.sql
-- JBCC Procedural Tab — schema, RLS and storage bucket.
-- Spec: SPEC DOCS/2026-05-22-jbcc-procedural-tab-design.md
-- The access entitlement lives in the generic billing.org_feature_unlocks
-- table (created in 00097_org_feature_unlocks.sql); JBCC's feature_key is 'jbcc'.
-- Reference seed (jbcc_notices / jbcc_clauses / jbcc_time_bar_schedule) is
-- appended in Task 1.4 by the extraction script; notice-fields seed is in 00100.

BEGIN;

-- ============================================================================
-- Reference tables (seeded; readable by any authenticated user; no writes)
-- ============================================================================

CREATE TABLE projects.jbcc_notices (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                   text UNIQUE NOT NULL,
  title                  text NOT NULL,
  category               text NOT NULL,
  triggering_clause      text NOT NULL,
  contract               text NOT NULL,
  edition                text NOT NULL,
  time_bar_text          text NOT NULL,
  time_bar_days          integer,
  time_bar_unit          text CHECK (time_bar_unit IN ('WD', 'CD')),
  time_bar_basis         text,
  from_party             text NOT NULL,
  to_party               text NOT NULL,
  purpose                text NOT NULL,
  consequence_of_failure text NOT NULL,
  template_file          text NOT NULL,
  sort_order             integer NOT NULL
);

CREATE TABLE projects.jbcc_notice_fields (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id   uuid NOT NULL REFERENCES projects.jbcc_notices(id) ON DELETE CASCADE,
  placeholder text NOT NULL,
  label       text NOT NULL,
  field_type  text NOT NULL CHECK (field_type IN ('text', 'textarea', 'date', 'number')),
  source      text NOT NULL CHECK (source IN ('recipient', 'sender', 'manual')),
  required    boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL,
  UNIQUE (notice_id, placeholder)
);

CREATE INDEX jbcc_notice_fields_notice_id_idx
  ON projects.jbcc_notice_fields (notice_id);

CREATE TABLE projects.jbcc_clauses (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clause_ref             text NOT NULL,
  contract               text NOT NULL,
  edition                text NOT NULL,
  topic                  text NOT NULL,
  description            text NOT NULL,
  practical_use          text,
  time_bar               text,
  triggering_event       text,
  linked_notice          text,
  consequence_of_failure text,
  sort_order             integer NOT NULL,
  UNIQUE (clause_ref, contract, edition)
);

CREATE TABLE projects.jbcc_time_bar_schedule (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clause      text NOT NULL,
  time_period text NOT NULL,
  parties     text NOT NULL,
  action      text NOT NULL,
  sort_order  integer NOT NULL,
  UNIQUE (clause, sort_order)
);

-- ============================================================================
-- Per-project tables (org-scoped via RLS)
-- ============================================================================

CREATE TABLE projects.jbcc_parties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL,
  party_role      text NOT NULL CHECK (
                    party_role IN (
                      'principal_agent', 'employer', 'guarantor',
                      'subcontractor', 'other'
                    )
                  ),
  name            text NOT NULL,
  company         text,
  address         text,
  email           text,
  phone           text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jbcc_parties_project_id_idx
  ON projects.jbcc_parties (project_id);

CREATE TABLE projects.jbcc_letters (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id    uuid NOT NULL,
  notice_id          uuid NOT NULL REFERENCES projects.jbcc_notices(id),
  recipient_party_id uuid REFERENCES projects.jbcc_parties(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'issued', 'served')),
  field_values       jsonb NOT NULL DEFAULT '{}'::jsonb,
  trigger_date       date,
  deadline_date      date,
  issued_date        date,
  service_method     text CHECK (service_method IN ('hand', 'email', 'registered_post')),
  served_date        date,
  document_path      text NOT NULL,  -- atomic with the .docx upload in generateLetterAction
  notes              text,
  created_by         uuid NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jbcc_letters_project_id_idx ON projects.jbcc_letters (project_id);
CREATE INDEX jbcc_letters_notice_id_idx  ON projects.jbcc_letters (notice_id);
CREATE INDEX jbcc_letters_status_idx     ON projects.jbcc_letters (status);
CREATE INDEX jbcc_letters_deadline_idx   ON projects.jbcc_letters (deadline_date)
  WHERE deadline_date IS NOT NULL;

CREATE TABLE projects.jbcc_letter_attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id       uuid NOT NULL REFERENCES projects.jbcc_letters(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL,
  file_path       text NOT NULL,
  file_name       text NOT NULL,
  mime_type       text,
  size_bytes      integer,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jbcc_letter_attachments_letter_id_idx
  ON projects.jbcc_letter_attachments (letter_id);

-- ============================================================================
-- Row Level Security
-- (Access-entitlement RLS is provided by billing.org_feature_unlocks elsewhere.)
-- ============================================================================

ALTER TABLE projects.jbcc_notices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.jbcc_notice_fields      ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.jbcc_clauses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.jbcc_time_bar_schedule  ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.jbcc_parties            ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.jbcc_letters            ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.jbcc_letter_attachments ENABLE ROW LEVEL SECURITY;

-- Reference tables: any authenticated user may read; no write policies
-- (the seed inserts run as the migration owner; the API surface only reads).
CREATE POLICY jbcc_notices_select_authenticated
  ON projects.jbcc_notices FOR SELECT TO authenticated USING (true);
CREATE POLICY jbcc_notice_fields_select_authenticated
  ON projects.jbcc_notice_fields FOR SELECT TO authenticated USING (true);
CREATE POLICY jbcc_clauses_select_authenticated
  ON projects.jbcc_clauses FOR SELECT TO authenticated USING (true);
CREATE POLICY jbcc_time_bar_schedule_select_authenticated
  ON projects.jbcc_time_bar_schedule FOR SELECT TO authenticated USING (true);

-- Per-project tables: org members can read; editing roles can write.
-- (Mirror the existing diary RLS pattern — see projects.site_diary_entries
-- policies in the migrations if you want to confirm the helper shape.)
CREATE POLICY jbcc_parties_select_member
  ON projects.jbcc_parties FOR SELECT TO authenticated
  USING (organisation_id IN (
    SELECT organisation_id FROM public.user_organisations
     WHERE user_id = auth.uid() AND is_active = true
  ));
CREATE POLICY jbcc_parties_write_editor
  ON projects.jbcc_parties FOR ALL TO authenticated
  USING (organisation_id IN (
    SELECT organisation_id FROM public.user_organisations
     WHERE user_id = auth.uid() AND is_active = true
       AND role IN ('owner', 'admin', 'project_manager', 'contractor')
  ))
  WITH CHECK (organisation_id IN (
    SELECT organisation_id FROM public.user_organisations
     WHERE user_id = auth.uid() AND is_active = true
       AND role IN ('owner', 'admin', 'project_manager', 'contractor')
  ));

CREATE POLICY jbcc_letters_select_member
  ON projects.jbcc_letters FOR SELECT TO authenticated
  USING (organisation_id IN (
    SELECT organisation_id FROM public.user_organisations
     WHERE user_id = auth.uid() AND is_active = true
  ));
CREATE POLICY jbcc_letters_write_editor
  ON projects.jbcc_letters FOR ALL TO authenticated
  USING (organisation_id IN (
    SELECT organisation_id FROM public.user_organisations
     WHERE user_id = auth.uid() AND is_active = true
       AND role IN ('owner', 'admin', 'project_manager', 'contractor')
  ))
  WITH CHECK (organisation_id IN (
    SELECT organisation_id FROM public.user_organisations
     WHERE user_id = auth.uid() AND is_active = true
       AND role IN ('owner', 'admin', 'project_manager', 'contractor')
  ));

CREATE POLICY jbcc_letter_attachments_select_member
  ON projects.jbcc_letter_attachments FOR SELECT TO authenticated
  USING (organisation_id IN (
    SELECT organisation_id FROM public.user_organisations
     WHERE user_id = auth.uid() AND is_active = true
  ));
CREATE POLICY jbcc_letter_attachments_write_editor
  ON projects.jbcc_letter_attachments FOR ALL TO authenticated
  USING (organisation_id IN (
    SELECT organisation_id FROM public.user_organisations
     WHERE user_id = auth.uid() AND is_active = true
       AND role IN ('owner', 'admin', 'project_manager', 'contractor')
  ))
  WITH CHECK (organisation_id IN (
    SELECT organisation_id FROM public.user_organisations
     WHERE user_id = auth.uid() AND is_active = true
       AND role IN ('owner', 'admin', 'project_manager', 'contractor')
  ));

-- ============================================================================
-- Storage bucket — generated letters + attachments live here.
-- ============================================================================

-- NOTE: Storage path convention is {orgId}/projects/{projectId}/letters/{letterId}.docx
-- (orgId is the first path segment so foldername(name)[1] can be matched against
-- the caller's org membership).  generateLetterAction (Phase 6) and the attachment
-- upload action (Phase 7) must construct paths accordingly.
INSERT INTO storage.buckets (id, name, public)
VALUES ('jbcc-letters', 'jbcc-letters', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "jbcc_letters_storage_read_member"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'jbcc-letters'
    AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
  );

CREATE POLICY "jbcc_letters_storage_write_editor"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'jbcc-letters'
    AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
  );

CREATE POLICY "jbcc_letters_storage_delete_editor"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'jbcc-letters'
    AND (storage.foldername(name))[1] = ANY(public.get_user_org_ids()::TEXT[])
  );

COMMIT;
