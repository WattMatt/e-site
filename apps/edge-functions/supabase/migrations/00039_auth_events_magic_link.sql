-- =============================================================================
-- Migration: 00039_auth_events_magic_link.sql
-- Description: Extend the auth_events CHECK constraint to include
--              'magic_link_requested'. Pulled forward from #11 because that
--              item logs the new event type.
--
-- The auth_events table was created in 00038 with a finite CHECK list.
-- Rather than mutate 00038 (already committed), this migration drops and
-- recreates the constraint with the additional value. Idempotent on
-- repeated runs — DROP CONSTRAINT IF EXISTS then ADD.
-- =============================================================================

ALTER TABLE public.auth_events
    DROP CONSTRAINT IF EXISTS auth_events_event_type_check;

ALTER TABLE public.auth_events
    ADD CONSTRAINT auth_events_event_type_check CHECK (event_type IN (
        'login',
        'logout',
        'password_changed',
        'password_reset_requested',
        'magic_link_requested',
        'lockout',
        'mfa_enrolled',
        'mfa_unenrolled',
        'account_deleted',
        'account_email_changed'
    ));

NOTIFY pgrst, 'reload schema';
