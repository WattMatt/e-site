-- =============================================================================
-- Migration 00188 — email_sequence_events: record whether the send happened
-- =============================================================================
-- ⚠ NUMBER IS A PLACEHOLDER. Production `max(version)` in
--   supabase_migrations.schema_migrations reads 00185 at the time of writing;
--   00186 and 00187 are already taken by unmerged work on this same branch, so
--   this file claims 00188. Re-check BOTH `max(version)` and origin/main
--   immediately before applying, and verify by reading the columns back —
--   `db push` keys on the version PREFIX, so a number already in the ledger
--   makes it print "Remote database is up to date", exit 0, and skip this file
--   silently. A green Deploy DB Migrations run is not evidence a migration ran.
--
-- WHY
-- ---
-- sendSequenceEmail() inserts an email_sequence_events row BEFORE calling
-- Resend and, until now, left it exactly as inserted when the send failed. The
-- next run therefore collided on UNIQUE (user_id, sequence_name, step_name) and
-- returned skipped_duplicate — permanently. A failed send was recorded as a
-- completed step and could never be retried, and nothing distinguished the two
-- cases.
--
-- The only signal was resend_message_id, and it was not a reliable one: the
-- success-path UPDATE that wrote it discarded its own error, so a NULL id meant
-- either "the send failed" or "the send succeeded and we could not write the id
-- down". Those two need opposite handling — one is retryable, the other would
-- double-send a real email — so they get separate states rather than one NULL.
--
-- Measured on production before writing this file:
--     SELECT count(*), count(*) FILTER (WHERE resend_message_id IS NULL)
--       FROM public.email_sequence_events;
--     →  246 | 11
-- All 11 fall between 2026-04-20 and 2026-04-27 (a one-week unverified-sender-
-- domain outage that ended at commit 9232fab) and go to three seed fixtures
-- plus the founder. They are backfilled to 'failed' below.
--
-- THE LEDGER
-- ----------
--   pending             inserted, outcome unknown. NEVER retried — the process
--                       may have died after Resend accepted the message.
--   sent                Resend returned 2xx.
--   failed              Resend refused, or the request never completed. The
--                       ONLY retryable state.
--   send_id_unrecorded  Resend returned 2xx but the outcome write failed. The
--                       mail WENT OUT. Never retried.
--
-- Retry is bounded in code by RETRY_WINDOW_MS (3 days from the row's original
-- sent_at) and MAX_SEND_ATTEMPTS (3), which is what makes backfilling those 11
-- April rows to 'failed' safe: they are months outside the window, so they
-- become honest evidence rather than a queue of five-month-old mail waiting to
-- go out the next time a cron fires.
--
-- ⚠ DEPLOY ORDER AND THE GAP IT LEAVES. This migration is inert on its own —
-- the writer is a Deno edge function and the seven lifecycle functions are
-- CLI-deployed, not deployed by merging (they are not listed in
-- deploy-edge-functions.yml). Between applying this and deploying the
-- functions, the old code inserts rows with no `status`, which take the
-- DEFAULT 'pending'. That is the safe direction: 'pending' is never retried, so
-- the behaviour is identical to today's skipped_duplicate. It is not the honest
-- direction — such a row will carry a resend_message_id while still saying
-- 'pending' — so apply this migration and deploy the functions together, and
-- treat `status = 'pending' AND resend_message_id IS NOT NULL` as the signature
-- of a row written by the pre-deploy code.
--
-- Additive and idempotent. No schema created, no function created, no policy
-- changed, so no PostgREST config PATCH is required — a plain column add needs
-- only NOTIFY pgrst, which is at the end.
--
-- Reversible:
--   ALTER TABLE public.email_sequence_events
--     DROP COLUMN status, DROP COLUMN send_attempts, DROP COLUMN failure_reason;
--
-- @verify:begin
-- column: public.email_sequence_events.status
-- column: public.email_sequence_events.send_attempts
-- column: public.email_sequence_events.failure_reason
-- constraint: email_sequence_events_status_check ON public.email_sequence_events
-- index: email_sequence_events_retryable_idx ON public.email_sequence_events
-- @verify:end
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Columns, nullable first so the backfill can classify the existing 246 rows
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.email_sequence_events
    ADD COLUMN IF NOT EXISTS status         TEXT,
    ADD COLUMN IF NOT EXISTS send_attempts  INTEGER,
    ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Backfill
--
-- A row with a Resend message id is proof of a 2xx: that id only exists because
-- Resend returned it. Everything else is the April outage. Note the empty-string
-- case — resendSend() returns `data.id ?? ''`, so a 2xx with no id in the body
-- would land as '' rather than NULL; treating it as sent would be a guess, and
-- 'send_id_unrecorded' is exactly the state for "it went out, we have no id".
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.email_sequence_events
   SET status         = 'sent',
       send_attempts  = 1
 WHERE status IS NULL
   AND resend_message_id IS NOT NULL
   AND resend_message_id <> '';

UPDATE public.email_sequence_events
   SET status         = 'send_id_unrecorded',
       send_attempts  = 1,
       failure_reason = 'backfill 00188: Resend accepted the send but no message id was stored'
 WHERE status IS NULL
   AND resend_message_id = '';

UPDATE public.email_sequence_events
   SET status         = 'failed',
       send_attempts  = 1,
       failure_reason = 'backfill 00188: no Resend message id recorded; '
                     || 'all such rows date from the 2026-04-20..27 unverified-sender-domain outage'
 WHERE status IS NULL
   AND resend_message_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- C. Lock the shape down
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.email_sequence_events
    ALTER COLUMN status        SET DEFAULT 'pending',
    ALTER COLUMN status        SET NOT NULL,
    ALTER COLUMN send_attempts SET DEFAULT 1,
    ALTER COLUMN send_attempts SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'email_sequence_events_status_check'
           AND conrelid = 'public.email_sequence_events'::regclass
    ) THEN
        ALTER TABLE public.email_sequence_events
            ADD CONSTRAINT email_sequence_events_status_check
            CHECK (status IN ('pending', 'sent', 'failed', 'send_id_unrecorded'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'email_sequence_events_send_attempts_check'
           AND conrelid = 'public.email_sequence_events'::regclass
    ) THEN
        ALTER TABLE public.email_sequence_events
            ADD CONSTRAINT email_sequence_events_send_attempts_check
            CHECK (send_attempts >= 1);
    END IF;
END $$;

-- The only state anything queries for: the retry claim, and the operator view
-- of what did not go out. Partial, because it is a handful of rows out of the
-- table's lifetime.
CREATE INDEX IF NOT EXISTS email_sequence_events_retryable_idx
    ON public.email_sequence_events (sent_at)
 WHERE status = 'failed';

COMMENT ON COLUMN public.email_sequence_events.status IS
  'Send outcome. pending = inserted, outcome unknown, NEVER retried (the process '
  'may have died after Resend accepted the message). sent = Resend 2xx. failed = '
  'Resend refused or the request never completed; the only retryable state, '
  'bounded by RETRY_WINDOW_MS and MAX_SEND_ATTEMPTS in _shared/email-sequence.ts. '
  'send_id_unrecorded = Resend 2xx but the outcome write failed — the mail WENT '
  'OUT, so retrying it double-sends.';

COMMENT ON COLUMN public.email_sequence_events.send_attempts IS
  'How many times this (user, sequence, step) has been handed to Resend. Starts '
  'at 1 on insert; the retry claim increments it. Capped by MAX_SEND_ATTEMPTS.';

COMMENT ON COLUMN public.email_sequence_events.failure_reason IS
  'Why the last attempt failed, truncated. NULL on a clean send.';

NOTIFY pgrst, 'reload schema';
