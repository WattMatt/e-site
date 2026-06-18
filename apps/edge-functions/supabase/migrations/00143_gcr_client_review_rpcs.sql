-- =============================================================================
-- Migration 00143 — gcr.get_client_review RPC (the ONLY client GCR read path)
-- =============================================================================
-- Returns the latest published review snapshot's outputs-only payload for a
-- granted client. SECURITY DEFINER so it can read gcr.review_snapshots without
-- the client needing broad gcr.* access, but it RE-VERIFIES the per-site grant
-- and raises if absent. It returns ONLY the snapshot JSONB (already outputs-only)
-- — it never joins to gcr.settings/zones/zone_generators, so it cannot widen the
-- payload to contractor cost inputs.
-- =============================================================================

CREATE OR REPLACE FUNCTION gcr.get_client_review(p_project_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payload JSONB;
BEGIN
  IF NOT public.user_has_client_site_grant(auth.uid(), p_project_id) THEN
    RAISE EXCEPTION 'Not authorised to review this site';
  END IF;

  SELECT rs.payload
    INTO v_payload
  FROM gcr.review_snapshots rs
  WHERE rs.project_id = p_project_id
  ORDER BY rs.published_for_client_at DESC
  LIMIT 1;

  -- No published snapshot yet -> null (caller renders an empty state).
  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION gcr.get_client_review(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
