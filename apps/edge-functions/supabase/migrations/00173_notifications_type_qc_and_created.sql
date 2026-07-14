-- ============================================================================
-- Migration 00173: notifications.type CHECK — add QC + "created" bell types
--
-- Root cause (found during QC-reports prod verification)
-- --------------------------------------------------------
-- public.notifications.type carries a CHECK constraint (notifications_type_check,
-- last set in 00072). The shared bell path (apps/web/src/lib/notify.ts →
-- send-notification edge function) is "never-throw": when an INSERT violates the
-- CHECK it is swallowed and NO bell row is written. Several module bell types
-- were added over time WITHOUT extending this constraint, so their bells have
-- been silently failing in production:
--   * qc_issued     — QC reports (this feature, apps/web/src/lib/qc-email.ts)
--   * rfi_created    — RFI create   (apps/web/src/actions/rfi.actions.ts)
--   * snag_created   — Snag create  (apps/web/src/lib/snag-email.ts)
--   * diary_created  — Diary create (apps/web/src/lib/diary-email.ts)
-- (The emails for these events go through send-email, a separate path, and were
-- unaffected — only the in-app bell was dropped.)
--
-- This migration extends the enum with those four types. Purely additive and
-- idempotent; mirrors the 00066 → 00072 extension pattern. No new bell type is
-- introduced here beyond what the app already dispatches.
--
-- Safe to re-run: constraint is DROP IF EXISTS + ADD.
--
-- This migration does NOT apply to any database — apply via the controller.
-- ============================================================================

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
    -- abandon event (from 00072)
    'inspection_abandoned',
    -- new (00173): QC reports + the previously-missing "created" bells
    'qc_issued',
    'rfi_created',
    'snag_created',
    'diary_created'
  )
);
