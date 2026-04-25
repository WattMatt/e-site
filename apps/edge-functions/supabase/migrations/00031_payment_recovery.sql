-- ---------------------------------------------------------------------------
-- Migration 00031: Payment recovery tracking (T-064 / Session 5)
-- ---------------------------------------------------------------------------
-- Spec: spec-v2.md §18, strategic-analysis-51-churn-analysis-framework-v2.md §5,
--       build-action-plan.md Session 5.
--
-- Adds columns for the graduated recovery flow + extends two status CHECK
-- constraints. The daily payment-recovery-check Edge Function reads these
-- columns to decide what to email / pause / cancel each day.
--
-- Stage timeline:
--    Day 0  (webhook) — charge.failed increments counter + sends d0 email
--    Day 3  (cron)    — retry-failed email
--    Day 7  (cron)    — final-warning email + status -> 'grace_period'
--    Day 14 (cron)    — pause projects + status -> 'paused'
--    Day 30 (cron)    — cancel subscription
-- ---------------------------------------------------------------------------

-- billing.subscriptions: failure counter + pause timestamp.
ALTER TABLE billing.subscriptions
    ADD COLUMN IF NOT EXISTS payment_failure_count   INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_payment_failure_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paused_at               TIMESTAMPTZ;

-- Extend the subscription status enum with the two transition states.
-- DROP + ADD is safe because the constraint only contained the original set
-- and no rows hold the new values yet.
ALTER TABLE billing.subscriptions
    DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE billing.subscriptions
    ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('active', 'past_due', 'grace_period', 'paused', 'cancelled', 'trialing'));

-- Index for the daily cron — "every subscription with an open failure".
CREATE INDEX IF NOT EXISTS idx_subscriptions_failure_open
    ON billing.subscriptions (last_payment_failure_at)
    WHERE payment_failure_count > 0
      AND status <> 'cancelled';

-- projects.projects: new 'payment_paused' status so the app can restrict writes.
ALTER TABLE projects.projects
    DROP CONSTRAINT IF EXISTS projects_status_check;

ALTER TABLE projects.projects
    ADD CONSTRAINT projects_status_check
    CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled', 'payment_paused'));

-- Partial index to cheaply filter paused projects in banners / dashboards.
CREATE INDEX IF NOT EXISTS idx_projects_payment_paused
    ON projects.projects (organisation_id)
    WHERE status = 'payment_paused';

-- ---------------------------------------------------------------------------
-- Cron schedule (informational — apply per environment after deploying the
-- payment-recovery-check Edge Function). 03:30 SAST (01:30 UTC) — runs after
-- the health-scoring and email-sequence crons so its emails land last.
--
--   SELECT cron.schedule(
--     'payment-recovery-check',
--     '30 1 * * *',
--     $$ SELECT net.http_post(
--          url := 'https://<project-ref>.functions.supabase.co/payment-recovery-check',
--          headers := jsonb_build_object(
--            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
--            'Content-Type',  'application/json'
--          ),
--          body := '{}'::jsonb
--        ); $$
--   );
-- ---------------------------------------------------------------------------
