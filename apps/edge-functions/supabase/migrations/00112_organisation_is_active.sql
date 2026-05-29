-- Migration 00112: Add is_active column to public.organisations
-- Part of PR-D (membership system — polish & edge cases).
-- See docs/superpowers/specs/2026-05-29-membership-system-design.md §6.2.

ALTER TABLE public.organisations
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.organisations.is_active IS
  'TRUE for normal organisations. FALSE means the org has been deactivated '
  '(e.g., a sub-org whose contracting relationship ended). Members and project '
  'memberships are intentionally NOT cascaded — see spec §6.2.';
