-- ---------------------------------------------------------------------------
-- Migration 00029: Organisation health scores
-- ---------------------------------------------------------------------------
-- Spec: spec-v2.md §17, strategic-analysis-52-customer-health-scoring-v2.md,
--       build-action-plan.md Session 3.
--
-- Stores daily health snapshots per organisation. The cron Edge Function
-- (calculate-health-scores) inserts one row per org per run; historical rows
-- are retained so Phase 2 can compute 7-day / 30-day trends.
--
-- Phase 1 populates `signals` with `login_recency` and `compliance_activity`
-- only (60%/40% weights). Phase 2 widens to the 11-signal model.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organisation_health_scores (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID        NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    score           INTEGER     NOT NULL CHECK (score >= 0 AND score <= 100),
    tier            TEXT        NOT NULL CHECK (tier IN ('green', 'yellow', 'orange', 'red')),
    trend_7d        INTEGER,      -- Δ vs snapshot closest to 7 days ago; nullable until Phase 2.
    trend_30d       INTEGER,      -- Δ vs snapshot closest to 30 days ago; nullable until Phase 2.
    signals         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    calculated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Latest-per-org dashboard query path: (organisation_id, calculated_at DESC).
CREATE INDEX IF NOT EXISTS idx_health_org_date
    ON public.organisation_health_scores (organisation_id, calculated_at DESC);

-- Tier-filter dashboard query path (e.g. list all RED orgs).
CREATE INDEX IF NOT EXISTS idx_health_tier
    ON public.organisation_health_scores (tier, calculated_at DESC);

-- ---------------------------------------------------------------------------
-- RLS: an org's members can read their own org's scores.
-- Inserts are done exclusively by the calculate-health-scores Edge Function
-- using the service role, which bypasses RLS. No public INSERT/UPDATE/DELETE
-- policies are exposed.
-- ---------------------------------------------------------------------------

ALTER TABLE public.organisation_health_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view own health scores"
    ON public.organisation_health_scores;

CREATE POLICY "Org members can view own health scores"
    ON public.organisation_health_scores
    FOR SELECT
    USING (organisation_id = ANY(public.get_user_org_ids()));

-- ---------------------------------------------------------------------------
-- Cron schedule (informational — apply by hand once Edge Function is deployed)
-- ---------------------------------------------------------------------------
-- SAST (UTC+2) 02:00 == UTC 00:00, so cron line is `0 0 * * *`.
--
-- After deploying `calculate-health-scores`, run (from the Supabase SQL editor
-- on the target environment):
--
--   SELECT cron.schedule(
--     'calculate-health-scores-daily',
--     '0 0 * * *',
--     $$ SELECT net.http_post(
--          url := 'https://<project-ref>.functions.supabase.co/calculate-health-scores',
--          headers := jsonb_build_object(
--            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
--            'Content-Type',  'application/json'
--          ),
--          body := '{}'::jsonb
--        ); $$
--   );
--
-- Left as a comment here because scheduling is environment-specific (the
-- project-ref and service-role key differ per environment). The runbook in
-- docs/staging-deployment-checklist.md picks this up as a post-migration step.
-- ---------------------------------------------------------------------------
