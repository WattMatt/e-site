-- 00134_gcr_bulk_save_tenant_assignments.sql
-- One transactional entry point for saving tenant assignment facets in bulk.
-- SECURITY INVOKER: RLS on gcr.tenant_assignments and structure.nodes applies
-- to the calling user unchanged. "Not provided" vs "set to NULL" is carried by
-- the paired p_set_<field> booleans.

CREATE OR REPLACE FUNCTION gcr.bulk_save_tenant_assignments(
  p_project_id        UUID,
  p_node_ids          UUID[],
  p_set_zone          BOOLEAN DEFAULT FALSE,
  p_zone_id           UUID    DEFAULT NULL,
  p_set_participation BOOLEAN DEFAULT FALSE,
  p_participation     TEXT    DEFAULT NULL,
  p_set_category      BOOLEAN DEFAULT FALSE,
  p_shop_category     TEXT    DEFAULT NULL,
  p_set_manual_kw     BOOLEAN DEFAULT FALSE,
  p_manual_kw         NUMERIC DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_expected INT := COALESCE(array_length(p_node_ids, 1), 0);
  v_count    INT;
BEGIN
  IF v_expected = 0 THEN
    RAISE EXCEPTION 'No tenants supplied';
  END IF;
  IF NOT (p_set_zone OR p_set_participation OR p_set_category OR p_set_manual_kw) THEN
    RAISE EXCEPTION 'Nothing to save';
  END IF;
  IF p_set_participation AND p_participation NOT IN ('shared','own','none') THEN
    RAISE EXCEPTION 'Invalid participation';
  END IF;
  IF p_set_category AND p_shop_category IS NOT NULL
     AND p_shop_category NOT IN ('standard','fast_food','restaurant','national','other') THEN
    RAISE EXCEPTION 'Invalid category';
  END IF;

  -- Every node must be a live tenant_db node of this project.
  SELECT count(*) INTO v_count
  FROM structure.nodes n
  WHERE n.id = ANY(p_node_ids)
    AND n.project_id = p_project_id
    AND n.kind = 'tenant_db'
    AND n.deleted_at IS NULL;
  IF v_count <> v_expected THEN
    RAISE EXCEPTION 'One or more shops do not belong to this project';
  END IF;

  IF p_set_zone OR p_set_manual_kw THEN
    INSERT INTO gcr.tenant_assignments (node_id, project_id, organisation_id, zone_id, manual_kw_override)
    SELECT n.id, p_project_id, n.organisation_id,
           CASE WHEN p_set_zone      THEN p_zone_id   ELSE NULL END,
           CASE WHEN p_set_manual_kw THEN p_manual_kw ELSE NULL END
    FROM structure.nodes n
    WHERE n.id = ANY(p_node_ids)
    ON CONFLICT (node_id) DO UPDATE SET
      zone_id            = CASE WHEN p_set_zone      THEN EXCLUDED.zone_id            ELSE gcr.tenant_assignments.zone_id END,
      manual_kw_override = CASE WHEN p_set_manual_kw THEN EXCLUDED.manual_kw_override ELSE gcr.tenant_assignments.manual_kw_override END;
  END IF;

  IF p_set_participation OR p_set_category THEN
    UPDATE structure.nodes SET
      generator_participation = CASE WHEN p_set_participation THEN p_participation ELSE generator_participation END,
      shop_category           = CASE WHEN p_set_category      THEN p_shop_category ELSE shop_category END
    WHERE id = ANY(p_node_ids);
  END IF;

  RETURN v_expected;
END;
$$;

GRANT EXECUTE ON FUNCTION gcr.bulk_save_tenant_assignments TO authenticated;

NOTIFY pgrst, 'reload schema';
