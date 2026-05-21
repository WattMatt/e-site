-- =============================================================================
-- Migration 00086 — admin user-management follow-ups
-- =============================================================================
-- Follow-ups to the admin-managed-users feature (migration 00079). Both
-- statements are idempotent.
--
-- NOTE: these were also applied directly to the cloud database via the
-- Supabase Management API on 2026-05-21 — the migrations folder was under
-- concurrent edit, so a `db push` was not viable. This file is the tracked
-- record so fresh environments / `db reset` reproduce the change.
--
--   1. auth_events.event_type CHECK — add 'user_updated' and 'user_removed'
--      (logged by updateUserAction / removeUserAction).
--   2. Backfill: promote each organisation's founder to 'owner' where the org
--      has no active owner. createOrganisationAction recorded web-signup
--      founders as 'admin' (fixed forward in commit e0f040c); owner-gated
--      paths were unreachable for them. Founder = the membership with
--      invited_by IS NULL (admin-created / invited members carry an invited_by).
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
        'user_created',
        'user_updated',
        'user_removed'
    ));

-- 2. Promote founders of owner-less organisations to 'owner' -----------------
UPDATE public.user_organisations uo
SET    role = 'owner'
WHERE  uo.invited_by IS NULL
  AND  uo.role <> 'owner'
  AND  NOT EXISTS (
         SELECT 1
         FROM   public.user_organisations o
         WHERE  o.organisation_id = uo.organisation_id
           AND  o.role = 'owner'
           AND  o.is_active = TRUE
       );

NOTIFY pgrst, 'reload schema';
