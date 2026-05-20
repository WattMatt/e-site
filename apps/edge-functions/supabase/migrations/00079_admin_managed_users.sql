-- =============================================================================
-- Migration 00079 — admin-managed users (drop invites, add user_created event)
-- =============================================================================
-- Background:
--   Team invites are removed. Admins now create users directly via the
--   Admin -> Users page; users set their password through the standard
--   recovery flow. See SPEC DOCS/2026-05-20-login-and-user-assignment-spec.md
--   sections 5 and 11.
--
-- Schema delta:
--   1. auth_events.event_type CHECK — add 'user_created' (logged by
--      createUserAction). Drop + re-add the constraint — same idempotent
--      pattern as migration 00039.
--   2. DROP TABLE public.org_invites — the entire invite subsystem is deleted.
--      No table references org_invites (its FKs point outward only), so the
--      drop is safe; CASCADE removes its RLS policies and indexes with it.
-- =============================================================================

-- 1. Extend the auth_events event-type whitelist -----------------------------
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
        'user_created'
    ));

-- 2. Drop the invite subsystem -----------------------------------------------
DROP TABLE IF EXISTS public.org_invites CASCADE;

NOTIFY pgrst, 'reload schema';
