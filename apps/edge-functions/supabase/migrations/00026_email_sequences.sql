-- ---------------------------------------------------------------------------
-- Migration 00026: Email sequence tracking (T-063 / build-action-plan Session 4)
-- ---------------------------------------------------------------------------
-- Spec: spec-v2.md §18, strategic-analysis-50-customer-communication-automation-v2.md.
--
-- Backs the lifecycle email system. Every send writes one row; the UNIQUE
-- constraint on (user_id, sequence_name, step_name) makes re-runs idempotent
-- so a cron that fires twice on the same day doesn't double-send.
--
-- Resend webhook callbacks (opens / clicks) UPDATE the matching row via
-- resend_message_id — so the column is indexed.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_sequence_events (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organisation_id   UUID        REFERENCES public.organisations(id) ON DELETE SET NULL,
    sequence_name     TEXT        NOT NULL,     -- 'onboarding' | 'reengagement' | 'conversion'
    step_name         TEXT        NOT NULL,     -- 'd0' | 'd1' | 'd3' | 'd7' | 'd14' | 'inactive_7d' | ...
    to_email          TEXT        NOT NULL,
    subject           TEXT        NOT NULL,
    resend_message_id TEXT,                     -- set once Resend accepts the send
    sent_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    opened_at         TIMESTAMPTZ,              -- populated by Resend webhook (Phase 2)
    clicked_at        TIMESTAMPTZ,              -- populated by Resend webhook (Phase 2)
    metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (user_id, sequence_name, step_name)
);

CREATE INDEX IF NOT EXISTS idx_email_seq_user_seq
    ON public.email_sequence_events (user_id, sequence_name);

CREATE INDEX IF NOT EXISTS idx_email_seq_sent
    ON public.email_sequence_events (sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_seq_resend_id
    ON public.email_sequence_events (resend_message_id)
    WHERE resend_message_id IS NOT NULL;

-- RLS: users can view their own history; inserts/updates are service-role only.
ALTER TABLE public.email_sequence_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_view_own_email_events" ON public.email_sequence_events;
CREATE POLICY "users_view_own_email_events"
    ON public.email_sequence_events
    FOR SELECT
    USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- POPIA: marketing-email opt-out flag. An unsubscribe request flips this to
-- TRUE; the email-sequence helper in the Edge Function checks it before send.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS marketing_emails_opted_out BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- Cron schedule (informational — apply by hand per environment after the
-- Edge Functions are deployed). All lifecycle triggers run daily at 03:00 SAST
-- (== 01:00 UTC) to avoid overlap with the 02:00 SAST health-scoring cron.
--
--   SELECT cron.schedule('onboarding-email-d1',  '0 1 * * *',  $$ SELECT net.http_post( ... '/onboarding-email-d1'  ... ) $$);
--   SELECT cron.schedule('onboarding-email-d3',  '5 1 * * *',  $$ SELECT net.http_post( ... '/onboarding-email-d3'  ... ) $$);
--   SELECT cron.schedule('onboarding-email-d7',  '10 1 * * *', $$ SELECT net.http_post( ... '/onboarding-email-d7'  ... ) $$);
--   SELECT cron.schedule('onboarding-email-d14', '15 1 * * *', $$ SELECT net.http_post( ... '/onboarding-email-d14' ... ) $$);
--   SELECT cron.schedule('reengagement-check',   '20 1 * * *', $$ SELECT net.http_post( ... '/reengagement-check'   ... ) $$);
--
-- onboarding-email-d0 and conversion-prompt are event-triggered (not cron).
-- See the Edge Function headers for wiring notes.
-- ---------------------------------------------------------------------------
