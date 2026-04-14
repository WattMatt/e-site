-- =============================================================================
-- Migration 00013: Add is_active to push_tokens
-- Description: Required by send-notification edge function for token lifecycle.
-- =============================================================================

ALTER TABLE public.push_tokens
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Index for efficient token lookup
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active
  ON public.push_tokens(user_id) WHERE is_active = TRUE;

-- RLS policies for push_tokens
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own push tokens"
  ON public.push_tokens
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
