-- ============================================================================
-- Migration 00072: Inspection abandon audit columns + notification type
--
-- Adds abandoned_by + abandoned_reason to inspections.inspections (the
-- abandoned_at column already exists from 00066). Extends
-- notifications_type_check with 'inspection_abandoned'.
--
-- Safe to re-run: all ADD COLUMN use IF NOT EXISTS; constraint is
-- DROP + ADD (idempotent).
-- ============================================================================

-- 1. Audit columns for abandon -----------------------------------------------

ALTER TABLE inspections.inspections
  ADD COLUMN IF NOT EXISTS abandoned_by     UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS abandoned_reason TEXT;

COMMENT ON COLUMN inspections.inspections.abandoned_by
  IS 'User who marked this inspection abandoned. NULL when status != abandoned.';
COMMENT ON COLUMN inspections.inspections.abandoned_reason
  IS 'Free-text reason recorded at abandon time.';

-- 2. Extend notifications.type CHECK -----------------------------------------
-- Current values (from 00066):
--   snag_status_changed, rfi_assigned, rfi_closed, rfi_response, grn_recorded,
--   inspection_assigned, inspection_awaiting_verification, inspection_certified,
--   inspection_re_inspect_required, inspection_revoked

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    -- pre-existing types (from 00066)
    'snag_status_changed',
    'rfi_assigned',
    'rfi_closed',
    'rfi_response',
    'grn_recorded',
    -- inspection lifecycle types (from 00066)
    'inspection_assigned',
    'inspection_awaiting_verification',
    'inspection_certified',
    'inspection_re_inspect_required',
    'inspection_revoked',
    -- new: abandon event
    'inspection_abandoned'
  )
);
