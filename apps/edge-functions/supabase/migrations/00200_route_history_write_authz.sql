-- 00200_route_history_write_authz.sql
-- ============================================================================
-- cable_schedule.route_history — bind its parents and add the RESTRICTIVE
-- write-role gate every other cable_schedule table carries.
--
-- WHY. 00199 created route_history with one permissive INSERT policy whose
-- role test — cable_schedule.user_can_edit_schedule(organisation_id) — is
-- keyed on the row's OWN organisation_id, which is client-supplied and bound
-- by no trigger. That is the exact shape 00193 replaced on the six core
-- tables: an owner of org A could, over raw REST, write a history row that
-- names org A but points at org B's route and revision. The application never
-- does this (every action derives the parents from the supply), but the
-- database did not refuse it, and packages/db's
-- cable-schedule-write-role-rls contract test — which asks that every table
-- accepting writes carry a RESTRICTIVE INSERT/UPDATE/DELETE gate keyed on a
-- user_can_edit_* helper — failed the build for exactly this reason.
--
-- WHAT.
--   1. bind_route_history_parents(): BEFORE INSERT OR UPDATE, derives
--      supply_id, revision_id and organisation_id from the route (00192's
--      bind_supply_route_parents shape). Whatever the client sent is discarded.
--   2. Three RESTRICTIVE policies keyed on user_can_edit_revision(revision_id).
--      BEFORE ROW triggers run before WITH CHECK, so the gate sees the BOUND
--      revision, not the claimed one. UPDATE and DELETE have no permissive
--      policy and stay refused; their RESTRICTIVE twins exist so the gate is
--      complete if anyone ever adds one.
--
-- No new schema, no new table: a NOTIFY is enough.
--
-- Rollback:
--   DROP TRIGGER route_history_bind_parents ON cable_schedule.route_history;
--   DROP FUNCTION cable_schedule.bind_route_history_parents();
--   DROP POLICY hist_write_authz_insert ON cable_schedule.route_history;
--   DROP POLICY hist_write_authz_update ON cable_schedule.route_history;
--   DROP POLICY hist_write_authz_delete ON cable_schedule.route_history;
--
-- @verify:begin
-- function: cable_schedule.bind_route_history_parents()
-- trigger: route_history_bind_parents ON cable_schedule.route_history
-- policy: hist_write_authz_insert ON cable_schedule.route_history  -- RESTRICTIVE
-- policy: hist_write_authz_update ON cable_schedule.route_history  -- RESTRICTIVE
-- policy: hist_write_authz_delete ON cable_schedule.route_history  -- RESTRICTIVE
-- policy: route_history_select ON cable_schedule.route_history
-- policy: route_history_insert ON cable_schedule.route_history
-- grant_absent: anon EXECUTE ON cable_schedule.bind_route_history_parents()
-- grant_absent: anon INSERT ON cable_schedule.route_history
-- sql: (SELECT count(*) = 3 FROM pg_policies WHERE schemaname = 'cable_schedule' AND tablename = 'route_history' AND permissive = 'RESTRICTIVE' AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%user_can_edit_revision%')
-- sql: (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'cable_schedule' AND tablename = 'route_history' AND permissive = 'PERMISSIVE' AND cmd IN ('UPDATE', 'DELETE', 'ALL'))
-- behaviour: an INSERT naming a foreign organisation_id lands with the route's own organisation_id; a caller without owner/admin/project_manager in the route's org is refused
-- @verify:end

-- ── 1. Parents are derived, not accepted ─────────────────────────────────────

CREATE OR REPLACE FUNCTION cable_schedule.bind_route_history_parents()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_supply_id   UUID;
    v_revision_id UUID;
    v_org_id      UUID;
BEGIN
    SELECT r.supply_id, r.revision_id, r.organisation_id
      INTO v_supply_id, v_revision_id, v_org_id
    FROM cable_schedule.supply_routes r
    WHERE r.id = NEW.route_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'cable_schedule.route_history: route % not found or not visible', NEW.route_id
            USING ERRCODE = 'raise_exception';
    END IF;

    -- Derived, not accepted. Whatever the client sent is discarded.
    NEW.supply_id       := v_supply_id;
    NEW.revision_id     := v_revision_id;
    NEW.organisation_id := v_org_id;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION cable_schedule.bind_route_history_parents() IS
'BEFORE INSERT/UPDATE on route_history: overwrites supply_id, revision_id and organisation_id with the route''s own, so a history row can never name a parent other than the route it belongs to. SECURITY INVOKER on purpose — the lookup runs under the caller''s RLS and fails closed on a route they cannot see.';

REVOKE ALL ON FUNCTION cable_schedule.bind_route_history_parents() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS route_history_bind_parents ON cable_schedule.route_history;
CREATE TRIGGER route_history_bind_parents
    BEFORE INSERT OR UPDATE ON cable_schedule.route_history
    FOR EACH ROW EXECUTE FUNCTION cable_schedule.bind_route_history_parents();

-- ── 2. RESTRICTIVE write-role gate (00193 shape) ─────────────────────────────

DROP POLICY IF EXISTS "hist_write_authz_insert" ON cable_schedule.route_history;
DROP POLICY IF EXISTS "hist_write_authz_update" ON cable_schedule.route_history;
DROP POLICY IF EXISTS "hist_write_authz_delete" ON cable_schedule.route_history;

CREATE POLICY "hist_write_authz_insert" ON cable_schedule.route_history
    AS RESTRICTIVE FOR INSERT TO authenticated, anon
    WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));

CREATE POLICY "hist_write_authz_update" ON cable_schedule.route_history
    AS RESTRICTIVE FOR UPDATE TO authenticated, anon
    USING      (cable_schedule.user_can_edit_revision(revision_id))
    WITH CHECK (cable_schedule.user_can_edit_revision(revision_id));

CREATE POLICY "hist_write_authz_delete" ON cable_schedule.route_history
    AS RESTRICTIVE FOR DELETE TO authenticated, anon
    USING (cable_schedule.user_can_edit_revision(revision_id));

NOTIFY pgrst, 'reload schema';
