-- =============================================================================
-- Migration 00141 — auth_events event-type whitelist: user lifecycle + resend
-- =============================================================================
-- Background:
--   The admin user-management actions log audit rows with event types that were
--   never added to the auth_events.event_type CHECK constraint:
--     - 'user_updated'  (updateUserAction — role / active-status change)
--     - 'user_removed'  (removeUserAction — membership removal)
--   These inserts have been failing the CHECK silently (logAuthEvent is
--   best-effort and swallows the error), so role changes and removals were never
--   audited. This migration aligns the whitelist with the code.
--
--   It also adds 'invite_resent', logged by the new resendInviteAction when an
--   admin re-sends a pending member's branded invite/set-password email.
--
--   Drop + re-add the constraint — same idempotent pattern as migrations 00039
--   and 00079.
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
        'account_email_changed',
        'user_created',
        'user_updated',
        'user_removed',
        'invite_resent'
    ));

NOTIFY pgrst, 'reload schema';
