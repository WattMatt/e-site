-- =============================================================================
-- Migration: 00015_popia_consent.sql
-- Description: Add popia_consent_at to public.profiles.
--              Update handle_new_user trigger to capture consent timestamp
--              from auth.users metadata (passed during sign-up).
-- Spec: § 13.1 — POPIA consent captured before org setup
-- =============================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS popia_consent_at TIMESTAMPTZ;

-- Replace trigger to read popia_consent_at from sign-up metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, popia_consent_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    (NEW.raw_user_meta_data->>'popia_consent_at')::TIMESTAMPTZ
  )
  ON CONFLICT (id) DO UPDATE
    SET popia_consent_at = EXCLUDED.popia_consent_at
    WHERE public.profiles.popia_consent_at IS NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
