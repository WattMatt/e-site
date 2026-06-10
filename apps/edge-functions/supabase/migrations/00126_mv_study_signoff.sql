-- 00126_mv_study_signoff.sql
-- Medium-Voltage protection — the gated-issue sign-off record (spec §9). A
-- protection study is a facet of a cable_schedule.revision; issuing the shared
-- revision (DRAFT→ISSUED) is gated when the revision carries MV data: the
-- 4-tick Pr.Eng sign-off (named approver + curve re-validation manual rev +
-- source-data confirmation + signed validation pack) must be complete first.
-- The gate is app-enforced in issueRevisionAction (assertMvSignoffComplete);
-- this table captures the evidence. One row per revision (revision_id UNIQUE),
-- CASCADE from the revision, RLS matching the cable_schedule org convention
-- (get_user_org_ids + user_is_client_viewer), NOT the structure project-access
-- convention. Cable-only revisions never create a row and are unaffected.

BEGIN;

-- ---------------------------------------------------------------------------
-- mv_study_signoff — one row per revision (the §9 gated-issue evidence)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cable_schedule.mv_study_signoff (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id       UUID NOT NULL REFERENCES public.organisations(id),
    revision_id           UUID NOT NULL UNIQUE REFERENCES cable_schedule.revisions(id) ON DELETE CASCADE,
    pr_eng_name           TEXT,                                                 -- GATE-1: named Pr.Eng approver
    pr_eng_ecsa_reg       TEXT,                                                 -- GATE-1: ECSA registration
    curve_manual_rev      TEXT,                                                 -- GATE-2: curve constants/ranges re-validated vs manual rev ___
    source_data_confirmed BOOLEAN NOT NULL DEFAULT false,                       -- GATE-3: utility/transformer/generator impedances confirmed
    validation_pack_ref   TEXT,                                                 -- GATE-4: signed validation pack reference
    signed_off_by         UUID REFERENCES public.profiles(id),
    signed_off_at         TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER mv_study_signoff_updated_at
    BEFORE UPDATE ON cable_schedule.mv_study_signoff
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE cable_schedule.mv_study_signoff ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mv_study_signoff_rw" ON cable_schedule.mv_study_signoff FOR ALL
    USING      (organisation_id = ANY(public.get_user_org_ids()))
    WITH CHECK (organisation_id = ANY(public.get_user_org_ids()) AND NOT public.user_is_client_viewer(organisation_id));

NOTIFY pgrst, 'reload schema';

COMMIT;
