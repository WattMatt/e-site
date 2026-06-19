-- =============================================================================
-- Migration 00146 — gcr.get_client_review_nodes RPC (shopNumber -> node_id map)
-- =============================================================================
-- A granted client reviews the FROZEN outputs-only snapshot (gcr.get_client_review),
-- but a captured proposal must be pinned to a REAL live structure.nodes id so the
-- submit path (gcr.change_requests insert, which FKs + scope-checks node_id against
-- the project's live tenant_db nodes) accepts it. The snapshot carries shopNumber,
-- not node_id, and a client has NO org membership, so they cannot read
-- structure.nodes directly under RLS.
--
-- This SECURITY DEFINER RPC mirrors gcr.get_client_review exactly: it RE-VERIFIES
-- the per-site grant and raises if absent, then returns ONLY { shop_number, node_id }
-- for the project's live tenant_db nodes. It exposes NO cost data — only the
-- identity columns needed to target a proposal. Nothing here can widen the payload.
-- =============================================================================

CREATE OR REPLACE FUNCTION gcr.get_client_review_nodes(p_project_id UUID)
RETURNS TABLE (shop_number TEXT, node_id UUID)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.user_has_client_site_grant(auth.uid(), p_project_id) THEN
    RAISE EXCEPTION 'Not authorised to review this site';
  END IF;

  RETURN QUERY
  SELECT n.shop_number, n.id
  FROM structure.nodes n
  WHERE n.project_id = p_project_id
    AND n.kind = 'tenant_db'
    AND n.deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION gcr.get_client_review_nodes(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
