-- ---------------------------------------------------------------------------
-- Migration 00019: In-app notifications — add data column + RLS + indexes
-- Sprint 4, T-042
--
-- NOTE: public.notifications already exists from migration 00001.
-- This migration adds the `data` JSONB column used by the edge function
-- and NotificationCentre component, enables RLS, and adds indexes.
-- ---------------------------------------------------------------------------

-- Add data column if not present (stores route, metadata for navigation)
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS data JSONB NOT NULL DEFAULT '{}';

-- Ensure body is NOT NULL (00001 created it as nullable TEXT)
-- Use a safe approach: update nulls first, then add constraint
UPDATE public.notifications SET body = '' WHERE body IS NULL;
ALTER TABLE public.notifications
    ALTER COLUMN body SET NOT NULL,
    ALTER COLUMN body SET DEFAULT '';

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON public.notifications (user_id, is_read, created_at DESC)
    WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON public.notifications (user_id, created_at DESC);

-- RLS: users only see their own notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Drop if exists from prior version, then recreate
DROP POLICY IF EXISTS "notifications_own" ON public.notifications;

CREATE POLICY "notifications_own" ON public.notifications
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
