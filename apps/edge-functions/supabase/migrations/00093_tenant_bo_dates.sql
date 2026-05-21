-- =============================================================================
-- Migration 00091 — beneficial occupation (BO) date tracking
-- =============================================================================
-- Background:
--   The Tenant Schedule hands shops over to tenants on "beneficial occupation"
--   (BO) dates — counted back from a single project opening date (typically
--   90 / 60 / 45 / 30 days, larger tenants getting longer periods). This
--   migration adds the three columns that anchor BO tracking. Every derived
--   value (effective BO date, material-order required-by date, RAG status) is
--   computed in the application layer — packages/shared/src/structure/bo.service.ts
--   — nothing derived is stored.
--
--   Design: SPEC DOCS/2026-05-21-tenant-bo-dates-design.md
--
-- Schema delta:
--   + projects.projects.opening_date            — one opening date per project
--   + structure.tenant_details.bo_period_days   — per-tenant BO period in days
--   + structure.tenant_details.bo_date_override — optional negotiated BO date
--
-- Non-destructive: ADD COLUMN only, all nullable, no data rewrite, no new
--   schema / RLS / grants / indexes. The added columns inherit each table's
--   existing row-level-security policies. IF NOT EXISTS guards make
--   re-application a no-op.
--
-- This migration does NOT apply to any database — apply via the controller.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. projects.projects.opening_date
--    The single centre/mall opening date. All tenant BO dates count back
--    from it.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE projects.projects
  ADD COLUMN IF NOT EXISTS opening_date DATE;

COMMENT ON COLUMN projects.projects.opening_date IS
  'Project opening date. Tenant beneficial-occupation dates are counted back from this.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. structure.tenant_details — BO period + optional override
--    bo_period_days   : days before the opening date that this tenant takes
--                       beneficial occupation (typically 90/60/45/30; any
--                       positive integer is allowed). NULL = not set.
--    bo_date_override : a negotiated BO date that deviates from the computed
--                       opening_date - bo_period_days. NULL = use the computed
--                       date. Effective BO date = bo_date_override ?? computed.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE structure.tenant_details
  ADD COLUMN IF NOT EXISTS bo_period_days INTEGER
    CHECK (bo_period_days IS NULL OR bo_period_days > 0);

ALTER TABLE structure.tenant_details
  ADD COLUMN IF NOT EXISTS bo_date_override DATE;

COMMENT ON COLUMN structure.tenant_details.bo_period_days IS
  'Days before the project opening date this tenant takes beneficial occupation.';
COMMENT ON COLUMN structure.tenant_details.bo_date_override IS
  'Optional negotiated BO date; overrides the computed opening_date - bo_period_days.';
