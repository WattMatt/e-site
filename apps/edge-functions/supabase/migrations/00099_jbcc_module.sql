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

-- ============================================================================
-- Reference seed (extracted from SPEC DOCS/JBCC/...xlsx by scripts/jbcc/extract-seed.ts)
-- ============================================================================

-- jbcc_notices
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-01', 'Notice of Constructive Change for Additional Work', 'Changes, Delays & Site Conditions', '14.0 / 17.1', 'JBCC PBA / Generic', 'Ed 6', 'Promptly upon receipt of directive', 0, NULL, NULL, 'Contractor', 'Principal Agent', 'Regularises a field directive as a contract instruction and reserves the right to additional time and cost.', 'Work treated as included; loss of additional payment.', 'N-01_Notice_of_Constructive_Change_for_Additional_Work.docx', 1);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-02', 'Notice of Directed Acceleration', 'Changes, Delays & Site Conditions', '17.1 + 23.0', 'JBCC PBA / Generic', 'Ed 6', 'Promptly upon directive', 0, NULL, NULL, 'Contractor', 'Principal Agent', 'Records that the agent has directed acceleration and reserves the right to recover acceleration cost.', 'Acceleration treated as voluntary; cost borne by contractor.', 'N-02_Notice_of_Directed_Acceleration.docx', 2);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-03', 'Notice of Access Delay', 'Changes, Delays & Site Conditions', '23.0', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Promptly upon impediment', 0, NULL, NULL, 'Contractor', 'Principal Agent', 'Documents employer-caused loss of access to a critical area and preserves time and cost recovery.', 'Idle time and cost not recoverable.', 'N-03_Notice_of_Access_Delay.docx', 3);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-04', 'Notice of Late / Defective Owner-Furnished Equipment or Materials', 'Changes, Delays & Site Conditions', '23.0', 'JBCC PBA', 'Ed 6', 'Promptly upon detection', 0, NULL, NULL, 'Contractor', 'Principal Agent', 'Records that owner-furnished items are late or defective and preserves the EOT and additional cost claim.', 'Delay treated as culpable; rework cost borne by contractor.', 'N-04_Notice_of_Late_or_Defective_Owner-Furnished_Equipment_or_Materials.docx', 4);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-05', 'Notice of Differing Site Conditions', 'Changes, Delays & Site Conditions', 'Differing Site Conditions', 'JBCC PBA / Generic', 'Ed 6', 'Promptly upon discovery', 0, NULL, NULL, 'Contractor', 'Principal Agent', 'Records materially differing conditions and triggers a contract instruction with adjustment of value and date.', 'Cost of unforeseen condition borne by contractor.', 'N-05_Notice_of_Differing_Site_Conditions.docx', 5);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-06', 'Notice of Force Majeure', 'Changes, Delays & Site Conditions', 'Force Majeure', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Promptly upon event', 0, NULL, NULL, 'Affected Party', 'Other Party', 'Suspends time-bound obligations for the duration of the event; basis for EOT without loss and expense.', 'Event treated as culpable delay; penalties accrue.', 'N-06_Notice_of_Force_Majeure.docx', 6);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-07', 'Notice of Non-Payment', 'Financial & Security', '25.7 / 19.7 + 28.0', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Day after payment due', 0, NULL, NULL, 'Contractor', 'Employer (copy PA)', 'Records the non-payment, claims mora interest and serves as predicate to suspension or termination.', 'Loss of right to mora interest and to suspend without further notice.', 'N-07_Notice_of_Non-Payment.docx', 7);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-08', 'Notice of Submission of Construction Guarantee', 'Financial & Security', '11.1', 'JBCC PBA', 'Ed 6', 'Within 15 WD of acceptance', 15, 'WD', NULL, 'Contractor', 'Employer', 'Provides evidence that the required security has been delivered.', 'Employer may withhold the first payment certificate.', 'N-08_Notice_of_Submission_of_Construction_Guarantee.docx', 8);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-09', 'Notice of Submission of Advance Payment Guarantee', 'Financial & Security', '11.0 (Advance)', 'JBCC PBA', 'Ed 6', 'Before advance is certified', 0, NULL, NULL, 'Contractor', 'Employer', 'Triggers release of the advance payment.', 'Advance payment not certified.', 'N-09_Notice_of_Submission_of_Advance_Payment_Guarantee.docx', 9);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-10', 'Demand to Employer for Calling Up a Payment Guarantee — Step 1', 'Financial & Security', '11.0 / 25.7', 'JBCC PBA', 'Ed 6', 'On non-payment after certificate', 0, NULL, NULL, 'Contractor', 'Employer', 'Final written demand on the Employer before approaching the guarantor.', 'Premature call on guarantor may be deemed unjustified.', 'N-10_Demand_to_Employer_for_Calling_Up_a_Payment_Guarantee_Step_1.docx', 10);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-11', 'Demand to Guarantor for Calling Up a Payment Guarantee — Step 2', 'Financial & Security', '11.0 / 25.7', 'JBCC PBA', 'Ed 6', 'On expiry of Step 1 demand', 0, NULL, NULL, 'Contractor', 'Guarantor', 'Formal call on the payment guarantee for the certified unpaid amount.', 'Loss of right of recovery against the guarantor.', 'N-11_Demand_to_Guarantor_for_Calling_Up_a_Payment_Guarantee_Step_2.docx', 11);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-12', 'Claim for Extras — Advance of Work', 'Performance & Administrative', '14.0 / 17.1', 'JBCC PBA / Generic', 'Ed 6', 'Before work begins', 0, NULL, NULL, 'Contractor', 'Principal Agent', 'Confirms in writing that a directive is an extra and requests a formal change order before commencement.', 'Work treated as included in the contract sum.', 'N-12_Claim_for_Extras_In_Advance_of_Work.docx', 12);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-13', 'Claim for Extras — After Work Performed', 'Performance & Administrative', '14.0 / 17.1', 'JBCC PBA / Generic', 'Ed 6', 'Promptly upon completion of the extra', 0, NULL, NULL, 'Contractor', 'Principal Agent', 'Submits substantiated cost and time impacts of an emergency or field-directed extra.', 'Recovery of cost may be denied for lack of timely notice.', 'N-13_Claim_for_Extras_After_Work_Performed.docx', 13);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-14', 'Notice of Delay / Notice of Intention to Claim EOT', 'Performance & Administrative', '23.4.2', 'JBCC PBA', 'Ed 6', '20 WD from awareness', 20, 'WD', NULL, 'Contractor', 'Principal Agent', 'Triggers the EOT process and preserves the right to a revised date for practical completion.', 'Forfeiture of the EOT claim.', 'N-14_Notice_of_Delay_Notice_of_Intention_to_Claim_EOT.docx', 14);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-15', 'Quantified EOT Claim Submission', 'Performance & Administrative', '23.5', 'JBCC PBA', 'Ed 6', '40 WD from ability to quantify', 40, 'WD', NULL, 'Contractor', 'Principal Agent', 'Provides the substantiated programme analysis and quantum of the EOT.', 'Claim rejected as unsubstantiated and time-barred.', 'N-15_Quantified_Extension_of_Time_Claim_Submission.docx', 15);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-16', 'Notice of Expense and Loss', 'Performance & Administrative', '26.5', 'JBCC PBA', 'Ed 6', '20 WD from awareness', 20, 'WD', NULL, 'Contractor', 'Principal Agent', 'Preserves the right to recover expense and loss not in the contract sum.', 'Forfeiture of the expense and loss claim.', 'N-16_Notice_of_Possible_Expense_and_Loss.docx', 16);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-17', 'Substantiated Expense and Loss Claim', 'Performance & Administrative', '26.6', 'JBCC PBA', 'Ed 6', '40 WD from ability to quantify', 40, 'WD', NULL, 'Contractor', 'Principal Agent', 'Submits the quantified expense and loss claim with supporting records.', 'Claim may be rejected.', 'N-17_Substantiated_Expense_and_Loss_Claim.docx', 17);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-18', 'Notice of Anticipated Practical Completion', 'Performance & Administrative', '24.0', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'When works are ready', 0, NULL, NULL, 'Contractor', 'Principal Agent', 'Triggers the practical completion inspection and handover process.', 'Penalties continue to accrue; risk does not transfer.', 'N-18_Notice_of_Anticipated_Practical_Completion.docx', 18);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-19', 'Non-compliance Notice to Subcontractor', 'Subcontract', '11.0 (NSCA/SSA)', 'JBCC NSCA / SSA', 'Ed 6', 'Per subcontract default clause', 0, NULL, NULL, 'Contractor', 'Subcontractor', 'Records subcontractor default and starts the rectification clock prior to substitution or security call.', 'Substitution may be deemed wrongful termination.', 'N-19_Non-Compliance_Notice_to_Subcontractor.docx', 19);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-20', 'Subcontractor EOT Pass-Through Notice', 'Subcontract', '3.2 (NSCA/SSA) + 23.4.2', 'JBCC NSCA / SSA', 'Ed 6', 'Sufficient to allow main-contract notice within 20 WD', 20, 'WD', NULL, 'Subcontractor', 'Contractor', 'Notifies the main contractor of a subcontract delay event so it can be passed up the chain.', 'Subcontractor loses time and money rights; main contractor potentially time-barred.', 'N-20_Subcontractor_EOT_Pass-Through_Notice.docx', 20);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-21', 'Notice to Declare Interest', 'Performance & Administrative', '6.3', 'JBCC PBA', 'Ed 6', 'Immediate', 0, NULL, NULL, 'Agent', 'Parties', 'Discloses an interest in the works beyond professional services.', 'Risk of agent decisions being set aside.', 'N-21_Notice_to_Declare_Interest.docx', 21);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-22', 'Notice of Objection to Proof of Insurance', 'Performance & Administrative', '10.3', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Within 5 WD of receipt', 5, 'WD', NULL, 'Party', 'Insuring Party', 'Formally objects to the form or content of proof of insurance.', 'Other party may take out the insurance and recover the premium + 15%.', 'N-22_Notice_of_Objection_to_Proof_of_Insurance.docx', 22);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-23', 'Notice to Principal Agent to Rectify Default (Step 1)', 'Suspension & Termination', '6.4', 'JBCC PBA', 'Ed 6', '5 WD to rectify', 5, 'WD', NULL, 'Contractor', 'Principal Agent (copy Employer)', 'Records the agent''s default and starts the rectification clock.', 'Cannot escalate to suspension; expense and loss not recoverable.', 'N-23_Notice_to_Principal_Agent_to_Rectify_Default_Step_1.docx', 23);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-24', 'Notice of Intention to Suspend (Step 2)', 'Suspension & Termination', '6.4 / 28.0', 'JBCC PBA', 'Ed 6', 'Further 5 / 10 WD', 10, 'WD', NULL, 'Contractor', 'Principal Agent / Employer', 'Warns of imminent suspension if the default is not remedied.', 'Suspension may be treated as repudiation.', 'N-24_Notice_of_Intention_to_Suspend_Step_2.docx', 24);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-25', 'Notice of Suspension (Step 3)', 'Suspension & Termination', '28.0', 'JBCC PBA', 'Ed 6', 'On expiry of Step 2', 0, NULL, NULL, 'Contractor', 'Employer / Principal Agent / All Subcontractors', 'Formally suspends the works and triggers standing-time recoveries.', 'Loss of right to recover standing time and expense.', 'N-25_Notice_of_Suspension_Step_3.docx', 25);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-26', 'Notice of Disagreement / Referral to Adjudication', 'Dispute Resolution', '40.0', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'MWA 22.2: 10 WD', 10, 'WD', NULL, 'Disputing Party', 'Other Party (copy PA)', 'Triggers the dispute resolution mechanism; refers the matter to adjudication under Cl 40.', 'Disagreement may be deemed accepted or time-barred.', 'N-26_Notice_of_Disagreement_and_Referral_to_Adjudication.docx', 26);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-27', 'Notice of Termination', 'Suspension & Termination', '21.0', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Per default notice clause', 0, NULL, NULL, 'Terminating Party', 'Other Party', 'Brings the contract to an end on grounds of material breach.', 'Wrongful termination = repudiation, with damages payable.', 'N-27_Notice_of_Termination.docx', 27);
INSERT INTO projects.jbcc_notices (code, title, category, triggering_clause, contract, edition, time_bar_text, time_bar_days, time_bar_unit, time_bar_basis, from_party, to_party, purpose, consequence_of_failure, template_file, sort_order) VALUES ('N-28', 'Notice of Return of Security', 'Dispute Resolution', '11.8', 'JBCC PBA / MWA', 'Ed 6 / 5.1', '10 WD on expiry / termination', 10, 'WD', NULL, 'Holder', 'Issuing Party', 'Returns the original security to the issuing party.', 'Holder may be liable for the amount of the guarantee.', 'N-28_Notice_of_Return_of_Security.docx', 28);

-- jbcc_clauses
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('1.0', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Contractor''s Obligations', 'Contractor must execute and complete the works as specified and notify the Principal Agent of any discrepancies in the contract documents.', 'Defines the primary scope of work; obliges the contractor to flag errors in drawings or specifications to preserve rights.', 'Immediate', 'Discovery of discrepancy in documents', 'Notice of Discrepancy / Request for Information', 'Contractor accepts the document as correct; loses right to claim extras arising from the discrepancy.', 0) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('2.0', 'JBCC PBA', 'Ed 6', 'Statutory Obligations', 'Parties must comply with all applicable laws, regulations, by-laws, OHS requirements and obtain necessary permits and approvals.', 'Allocates responsibility for statutory compliance to prevent site shut-down or regulatory penalty.', 'Project duration', 'Non-compliance discovered', 'Notice to Rectify Statutory Non-compliance', 'Party in breach bears all consequential cost; possible termination for material breach.', 1) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('6.3', 'JBCC PBA', 'Ed 6', 'Declaration of Interest', 'Principal Agent or agent must declare any interest in the works beyond professional services.', 'Ensures transparency and prevents conflicts of interest in certification and instructions.', 'Immediate on becoming aware', 'Discovery of conflict of interest', 'Notice to Declare Interest', 'Risk of agent decisions being set aside; reputational damage.', 2) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('6.4', 'JBCC PBA', 'Ed 6', 'Principal Agent Non-Performance', 'Contractor may notify the Employer of the Principal Agent''s failure to perform duties and require the default to be rectified.', 'Three-step disciplined process (rectify > intend to suspend > suspend) to compel agent compliance or replacement.', '5 + 5 WD', 'Agent fails to issue instruction, certificate or determination', 'Notice to Principal Agent to Rectify Default', 'Contractor cannot proceed to suspension or claim associated expense and loss.', 3) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('10.3', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Proof of Insurance', 'Party responsible for insurance must provide proof of policy or renewal to the other party.', 'Confirms financial backing for works, public liability and SASRIA cover before site access.', '10 WD', 'Date insurance is required to be in place', 'Notice of Objection to Proof of Insurance', 'Other party may take out the insurance and recover the premium plus 15%.', 4) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('11.1', 'JBCC PBA', 'Ed 6', 'Construction Securities', 'Contractor must provide a Variable or Fixed Construction Guarantee within 15 working days of acceptance.', 'Provides the Employer with financial recourse in case of contractor default; permits waiver of lien.', '15 WD', 'Acceptance of tender', 'Notice of Submission of Construction Guarantee', 'Employer may terminate or withhold first payment until security is provided.', 5) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('11.8', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Return of Securities', 'Party in possession of original security must return it on expiry or termination.', 'Closes the security loop and prevents wrongful retention of the original guarantee.', '10 WD', 'Expiry or termination event', 'Notice of Return of Security', 'Party retaining the original may be liable for the amount of the guarantee.', 6) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('11.0 (Advance)', 'JBCC PBA', 'Ed 6', 'Advance Payment Guarantee', 'Contractor provides an Advance Payment Guarantee equal to the advance payment, reducing as the advance is recouped.', 'Protects the Employer against non-performance after release of the advance.', 'Before advance is certified', 'Advance payment certified', 'Notice of Submission of Advance Payment Guarantee', 'Advance payment will not be certified.', 7) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('13.0', 'JBCC MWA', 'Ed 5.1', 'Valuation and Payment', 'Principal Agent issues monthly payment certificates valuing work executed and materials on site.', 'Establishes the cash-flow rhythm of the project; basis for non-payment, suspension and finance-charge claims.', 'Monthly', 'Issue of payment certificate', 'Notice of Non-Payment', 'Loss of right to claim mora interest or suspend works.', 8) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('13.0 (NSSA)', 'JBCC NSSA / SSA', 'Ed 6', 'Nominated & Selected Subcontractors – Payment Flow', 'Defines payment route from Employer through Contractor to subcontractor; no privity between Employer and subcontractor.', 'Sets responsibility for honouring subcontract payment certificates and the back-to-back relationship.', 'Per main contract', 'Issue of subcontract payment certificate', 'Subcontract Payment Notice', 'Subcontractor''s right of recovery defaults to main contractor only.', 9) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('14.0 / 17.1', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Contract Instructions', 'Principal Agent may issue written instructions varying design, quality, quantity or sequence of the works.', 'Mechanism for variations, defect rectification and rescoping; must be in writing to bind the contractor.', 'Within 5 WD of receipt', 'Receipt of a contract instruction (CI)', 'Notice of Constructive Change / Claim for Extras (Advance)', 'Variation may be deemed included in the contract sum.', 10) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('14.0 (PBA NSC)', 'JBCC PBA', 'Ed 6', 'Nominated Subcontractors', 'Subcontractor selected by the Employer or Principal Agent for specialist work.', 'Employer carries the risk of the nominated subcontractor''s default.', 'Per nomination instruction', 'Nomination instruction issued', 'Notice of Acceptance / Objection to Nomination', 'Forced acceptance with no recourse against the Employer for downstream defaults.', 11) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('15.0 (PBA SSC)', 'JBCC PBA', 'Ed 6', 'Selected Subcontractors', 'Subcontractor chosen from a joint list agreed between Employer and Contractor.', 'Contractor accepts performance and insolvency risk of selected subcontractor.', 'Per selection instruction', 'Selection list issued', 'Notice of Selection / Objection', 'Contractor''s objection rights lapse.', 12) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('23.0', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Revision of Practical Completion Date', 'Contractor entitled to a revised date for practical completion for listed events beyond its control.', 'Avoids penalties / liquidated damages for non-culpable delay events.', 'Per Cl 23.4.2 / 23.5', 'Occurrence of a qualifying delay event', 'Request for Extension of Time and Additional Compensation', 'Penalties continue to accrue against the contractor.', 13) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('23.4.2', 'JBCC PBA', 'Ed 6', 'Notice of Intention to Claim EOT', 'Contractor must notify the Principal Agent of a possible revision of the date for practical completion.', 'Triggers the EOT process; critical time-bar that, once missed, forfeits the claim.', '20 WD', 'Becoming aware of a delay event', 'Notice of Delay / Notice of Intention to Claim', 'Forfeiture of the EOT claim (NV Properties v Radon).', 14) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('23.5', 'JBCC PBA', 'Ed 6', 'Quantified EOT Claim', 'Contractor submits a fully quantified EOT claim with substantiation and revised programme.', 'Provides the agent with the evidence and calculation needed to certify the revised date.', '40 WD', 'End of the delay event / ability to quantify', 'Quantified EOT Claim Submission', 'Claim may be rejected as unsubstantiated and time-barred.', 15) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('17.0', 'JBCC MWA', 'Ed 5.1', 'Revision of Practical Completion (Minor Works)', 'Contractor must report the cause of delay and the days claimed at the next site meeting.', 'Less strict than PBA but still requires recorded notification; preserves the right to additional time.', 'Next site meeting', 'Occurrence of delay event', 'Site Meeting Minute / MWA EOT Notice', 'Delay event treated as culpable; penalties continue.', 16) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('24.0', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Practical Completion', 'Stage at which the works are substantially complete and may be used for the intended purpose.', 'Triggers handover, end of penalty accrual and start of the defects liability period.', 'Per inspection process', 'Contractor''s view that works are ready', 'Notice of Anticipated Practical Completion', 'Penalties continue to accrue; risk does not transfer to Employer.', 17) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('25.7 / 19.7', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Payment of Certified Amount', 'Employer must pay the amount of the payment certificate within the stipulated period.', 'Triggers the contractor''s right to mora interest and, ultimately, to suspend or terminate.', '14 CD', 'Issue of payment certificate', 'Notice of Non-Payment', 'Loss of right to mora interest if not formally claimed.', 18) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('26.5', 'JBCC PBA', 'Ed 6', 'Notice of Possible Expense and Loss', 'Contractor must notify the agent of expense and loss not provided for in the contract sum.', 'Mirrors the EOT notice; required to preserve the loss and expense claim.', '20 WD', 'Becoming aware of expense / loss event', 'Notice of Expense and Loss', 'Forfeiture of the loss and expense claim.', 19) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('26.6', 'JBCC PBA', 'Ed 6', 'Substantiated Expense and Loss Claim', 'Contractor submits the quantified and substantiated expense and loss claim.', 'Provides the agent with the basis to adjust the contract value.', '40 WD', 'Ability to quantify the loss', 'Substantiated Expense and Loss Claim', 'Claim may be rejected as unsubstantiated.', 20) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('26.9.4', 'JBCC PBA', 'Ed 6', 'Adjustment of Preliminaries & Generals', 'P&G amounts are adjusted in accordance with the method elected in the contract data.', 'Recovers time-related overhead when the completion date is revised.', 'With EOT claim', 'EOT awarded', 'P&G Adjustment Submission', 'P&G under-recovery; out-of-pocket overhead.', 21) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('28.0', 'JBCC PBA', 'Ed 6', 'Suspension by Contractor', 'Contractor may suspend the works on 10 WD notice if the Employer is in material default.', 'Lever to compel payment or remedy other material breaches without immediate termination.', '10 WD', 'Employer default (payment, insurance, possession)', 'Notice of Intention to Suspend', 'Loss of right to suspend; potential cash-flow collapse.', 22) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('19.11', 'JBCC MWA', 'Ed 5.1', 'Suspension by Contractor (Minor Works)', 'Contractor may suspend on 3 WD notice for non-payment.', 'Faster suspension lever appropriate to smaller projects.', '3 WD', 'Non-payment of certified amount', 'MWA Notice of Intent to Suspend', 'Cash-flow loss; weakens negotiating position.', 23) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('30.0', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Penalty for Late Completion', 'Contractor liable for the penalty per calendar day for late achievement of practical completion.', 'Liquidated remedy for the Employer; calibrated against the daily holding cost.', 'Per calendar day', 'Failure to achieve practical completion', 'Penalty Deduction Notification', 'Penalty deducted from payment certificates and securities.', 24) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('33.0 / 27.0', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Recovery of Expense and Loss by Employer', 'Employer may recover expense and loss resulting from contractor default, including the cost of completing the works.', 'Set-off against payment certificates and call-up of the construction guarantee.', 'Per recovery event', 'Contractor default', 'Notice of Recovery / Call on Guarantee', 'Loss of right to recover; cost borne by Employer.', 25) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('21.0', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Termination', 'Either party may terminate for material breach (non-payment, failure to give possession, insolvency, etc.).', 'Last-resort remedy; requires strict procedural compliance to avoid wrongful repudiation.', 'Per default notice clause', 'Persistent material breach', 'Notice of Termination', 'Wrongful termination = repudiation, with damages owed.', 26) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('40.0', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Dispute Resolution', 'Disputes are referred first to adjudication and thereafter to arbitration in accordance with the contract.', 'Avoids litigation; adjudicator''s decision is binding pending arbitration.', '10 WD (disagreement = dispute under MWA 22.2)', 'Issue of Notice of Disagreement', 'Notice of Dispute / Referral to Adjudication', 'Dispute may be deemed accepted or time-barred.', 27) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('Differing Site Conditions', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Differing Site Conditions', 'Conditions encountered on site differ materially from those indicated in the contract documents.', 'Triggers a contract instruction and adjustment of contract value and date.', 'Promptly upon discovery', 'Discovery of materially differing condition', 'Notice of Differing Site Conditions', 'Contractor bears the cost of the unforeseen condition.', 28) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('Constructive Change', 'Generic / JBCC', '—', 'Constructive Change', 'Oral, field or implied direction that changes the scope of work without a formal variation order.', 'Establishes a written record so a CI can be regularised and the cost recovered.', 'Promptly upon receipt', 'Receipt of informal direction', 'Notice of Constructive Change', 'Work treated as included in the contract sum.', 29) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('Access Delay', 'Generic / JBCC', '—', 'Access Delay', 'Site access to a specific area or piece of equipment is impeded by others.', 'Documents employer-caused delay on the critical path.', 'Promptly upon impediment', 'Loss of access to critical area', 'Notice of Access Delay', 'Idle labour and plant cost borne by the contractor.', 30) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('Force Majeure', 'JBCC PBA / MWA', 'Ed 6 / 5.1', 'Force Majeure', 'Event beyond the reasonable control of either party (e.g. war, civil commotion, declared disaster).', 'Suspends time-bound obligations; basis for EOT without loss and expense.', 'Promptly upon event', 'Occurrence of force majeure event', 'Notice of Force Majeure', 'Event treated as culpable delay; penalties accrue.', 31) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('3.2 (NSCA/SSA)', 'JBCC NSCA / SSA', 'Ed 6', 'Back-to-Back Pass-Through', 'Subcontractor''s entitlement to time and money mirrors the main contract; subcontractor must notify the contractor within the time-bar that allows the contractor to notify the Employer.', 'Protects the main contractor from being time-barred by subcontractor delay; aligns subcontract and main contract clocks.', 'Per main contract less buffer', 'Subcontractor becomes aware of event', 'Subcontractor EOT Pass-Through Notice', 'Loss of subcontractor''s right to time and money.', 32) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('6.0 (NSCA/SSA)', 'JBCC NSCA / SSA', 'Ed 6', 'Subcontract Instructions', 'Contractor issues subcontract instructions analogous to PBA Cl 17.', 'Maintains chain of command and written record between contractor and subcontractor.', 'Per subcontract', 'Issue of subcontract instruction', 'Subcontract Instruction / Acknowledgement', 'Subcontract instruction may be unenforceable.', 33) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;
INSERT INTO projects.jbcc_clauses (clause_ref, contract, edition, topic, description, practical_use, time_bar, triggering_event, linked_notice, consequence_of_failure, sort_order) VALUES ('11.0 (NSCA/SSA)', 'JBCC NSCA / SSA', 'Ed 6', 'Subcontractor Non-Compliance', 'Contractor may notify the subcontractor of default and require rectification before further action.', 'Step required before main contractor can substitute subcontractor or call security.', 'Per subcontract default clause', 'Subcontractor default', 'Non-Compliance Notice to Subcontractor', 'Risk that substitution is treated as wrongful termination.', 34) ON CONFLICT (clause_ref, contract, edition) DO NOTHING;

-- jbcc_time_bar_schedule
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('PBA 2.5 / MWA 2.5', '1–7 CD', 'Parties / Principal Agent', 'Deemed receipt of notices (email = 1 WD; registered post = 7 CD).', 0) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('PBA 6.4 / MWA 5.4', '5 WD', 'Contractor → PA / Employer', 'Notice to rectify Principal Agent non-performance.', 1) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 5.5', '5 WD', 'Employer', 'Appoint successor agent following contractor''s rectification notice.', 2) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('PBA 10.3 / MWA 10.3', '10 WD', 'Insuring Party', 'Provide proof of insurance / renewal.', 3) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('PBA 11.1 / MWA 9.1.1', '15 WD', 'Parties', 'Submit Construction / Payment Securities.', 4) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 9.1.2', '20 WD', 'Parties', 'Provide replacement securities for EOT.', 5) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 9.1.3', '15 WD', 'Parties', 'Adjust security if contract value increases > 10%.', 6) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('PBA 11.8 / MWA 9.1.4', '10 WD', 'Parties', 'Return original security on expiry or termination.', 7) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 11.0', '15 WD', 'Contractor', 'Submit security, priced document and programme.', 8) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 14.3', '5 WD', 'Contractor', 'Deadline to proceed with a contract instruction.', 9) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('PBA 23.4.2', '20 WD', 'Contractor → PA', 'Notice of possible delay — failure = forfeit EOT claim.', 10) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('PBA 23.5', '40 WD', 'Contractor → PA', 'Submit quantified EOT claim with substantiation.', 11) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 15.4', '5 + 5 WD', 'Contractor → PA / Employer', 'Notice if no completion list issued (deemed completion).', 12) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 16.3', '5 WD', 'PA → Contractor', 'Issue updated list for final completion.', 13) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 17.4.1', '10 WD', 'PA', 'Determine revised date for practical completion.', 14) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 17.4.2', '10 WD', 'PA', 'Determine adjustment of the contract value.', 15) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('PBA 25.7 / MWA 19.7', '14 CD', 'Employer → Contractor', 'Pay the amount of the payment certificate.', 16) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('PBA 26.5', '20 WD', 'Contractor → PA', 'Notice of possible expense and loss — failure = forfeit claim.', 17) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('PBA 26.6', '40 WD', 'Contractor → PA', 'Submit substantiated expense and loss claim.', 18) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 20.4', 'Notice', 'Contractor → PA', 'Notice of possible expense and loss (MWA).', 19) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 21.2', '10 WD', 'Employer (PA) → Contractor', 'Notice of defaults to be remedied before suspension.', 20) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 21.19', '20 WD', 'PA', 'Status report following termination.', 21) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 22.2', '10 WD', 'Either Party', 'Deadline for disagreement to be deemed a dispute.', 22) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('PBA 28.0', '10 WD', 'Contractor → Employer', 'Notice of intention to suspend the works.', 23) ON CONFLICT (clause, sort_order) DO NOTHING;
INSERT INTO projects.jbcc_time_bar_schedule (clause, time_period, parties, action, sort_order) VALUES ('MWA 19.11', '3 WD', 'Contractor → Employer', 'Notice of intention to suspend (Minor Works).', 24) ON CONFLICT (clause, sort_order) DO NOTHING;
