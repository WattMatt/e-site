-- 00191_marketplace_money_and_mv_paywall.sql
--
-- Pre-go-live payments hardening. Three independent closures, all latent today
-- (Paystack is in test mode, the marketplace is behind a default-off flag, and
-- production holds 0 paystack_subaccounts, 0 commissions, 2 seed orders and 0
-- MV subscriptions) and all of which become permanent per-supplier / per-user
-- state the moment real money moves.
--
-- Numbering: origin/main and supabase_migrations.schema_migrations both topped
-- out at 00189 when this was written; 00190 is claimed by a concurrent session.
-- ⚠ `supabase db push` keys on the version PREFIX, so a number already in the
-- ledger makes it print "up to date", exit 0 and skip the file silently. After
-- applying, READ THE EFFECTS BACK (the verification queries at the foot of this
-- file) — a green Deploy DB Migrations run is not evidence the file ran.
--
-- The block below mechanises the verification queries at the foot of this file.
-- Three of its claims are not expressible as existence checks:
--   · Part A's grant layer is a COLUMN-level grant sitting where a table-level
--     one used to be. has_table_privilege ignores column grants — which is
--     exactly what makes `grant_absent: authenticated UPDATE ON
--     marketplace.orders` the right assertion for the table level — so the
--     column level needs has_column_privilege, asserted positively for
--     status/notes and negatively for every money column.
--   · Both RESTRICTIVE MV policies are FOR ALL, not FOR SELECT. A policy
--     directive proves the name and the RESTRICTIVE kind but not the command,
--     and the write half of the paywall lives in the command.
--   · Both new functions are SECURITY DEFINER. order_protected_columns_unchanged
--     reads the stored row from inside the very policy it is called by; without
--     prosecdef it recurses or reads nothing and the RESTRICTIVE check silently
--     stops being a check.
--
-- @verify:begin
-- function: marketplace.order_protected_columns_unchanged(jsonb)
-- function: marketplace.set_order_quote(uuid, numeric)
-- sql: (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'marketplace' AND p.proname IN ('set_order_quote', 'order_protected_columns_unchanged') AND p.prosecdef) = 2
-- grant_present: authenticated EXECUTE ON marketplace.order_protected_columns_unchanged(jsonb)
-- grant_present: authenticated EXECUTE ON marketplace.set_order_quote(uuid, numeric)
-- grant_absent: anon EXECUTE ON marketplace.order_protected_columns_unchanged(jsonb)
-- grant_absent: anon EXECUTE ON marketplace.set_order_quote(uuid, numeric)
-- policy: orders_money_columns_immutable ON marketplace.orders  -- RESTRICTIVE
-- grant_absent: authenticated UPDATE ON marketplace.orders
-- sql: has_column_privilege('authenticated', 'marketplace.orders', 'status', 'UPDATE') AND has_column_privilege('authenticated', 'marketplace.orders', 'notes', 'UPDATE') AND NOT has_column_privilege('authenticated', 'marketplace.orders', 'total_amount', 'UPDATE') AND NOT has_column_privilege('authenticated', 'marketplace.orders', 'commission_rate', 'UPDATE') AND NOT has_column_privilege('authenticated', 'marketplace.orders', 'commission_amount', 'UPDATE') AND NOT has_column_privilege('authenticated', 'marketplace.orders', 'payment_status', 'UPDATE') AND NOT has_column_privilege('authenticated', 'marketplace.orders', 'paystack_reference', 'UPDATE') AND NOT has_column_privilege('authenticated', 'marketplace.orders', 'paystack_split_code', 'UPDATE')
-- grant_present: authenticated SELECT ON marketplace.paystack_subaccounts
-- grant_absent: authenticated INSERT ON marketplace.paystack_subaccounts
-- grant_absent: authenticated UPDATE ON marketplace.paystack_subaccounts
-- grant_absent: authenticated DELETE ON marketplace.paystack_subaccounts
-- grant_absent: anon INSERT ON marketplace.paystack_subaccounts
-- grant_absent: anon UPDATE ON marketplace.paystack_subaccounts
-- grant_absent: anon DELETE ON marketplace.paystack_subaccounts
-- policy: fault_results_require_mv_access ON cable_schedule.fault_results  -- RESTRICTIVE
-- policy: discrimination_checks_require_mv_access ON cable_schedule.discrimination_checks  -- RESTRICTIVE
-- sql: (SELECT count(*) FROM pg_policies WHERE schemaname = 'cable_schedule' AND policyname IN ('fault_results_require_mv_access', 'discrimination_checks_require_mv_access') AND permissive = 'RESTRICTIVE' AND cmd = 'ALL') = 2
-- behaviour: buyer PATCHes their own marketplace.orders row with total_amount = 0.01
--            over PostgREST -> refused at the grant layer AND at the policy layer
-- behaviour: contractor (payer) calls marketplace.set_order_quote -> 42501
-- behaviour: supplier calls set_order_quote on a non-pending order -> 42501
-- behaviour: a non-WM member without an MV seat SELECTs cable_schedule.fault_results
--            -> 0 rows; all 27 WM members are unaffected (WM-org bypass inside
--            public.user_has_mv_access)
-- @verify:end
-- ═══════════════════════════════════════════════════════════════════════════
-- A. marketplace.orders — the buyer must not be able to set the price they pay
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Verified on production 2026-09-11: `authenticated` held a TABLE-level UPDATE
-- grant on marketplace.orders, so has_column_privilege was true for
-- total_amount, commission_rate, commission_amount, payment_status, paid_at,
-- paystack_reference and paystack_split_code. The only UPDATE policy —
-- "Contractors and suppliers can update orders" — is PERMISSIVE with
-- USING (contractor_org_id = ANY get_user_org_ids() OR supplier_org_id = ANY …)
-- and with_check NULL, and get_user_org_ids() is role-blind. marketplace-payment
-- charges `order.total_amount`, so a buyer could PATCH their own order to 0.01
-- through PostgREST and be charged one cent, set commission_rate to 0 or 1, or
-- forge payment_status='paid' — which also permanently blocks legitimate
-- payment via the "already paid" 409.
--
-- Two layers that fail INDEPENDENTLY:
--   (1) the grant layer — `authenticated` may update only status and notes;
--   (2) the policy layer — a RESTRICTIVE WITH CHECK that pins every protected
--       column to its stored value, so even if a table-level grant is ever
--       restored the write is still refused.
--
-- ⚠ A column-level REVOKE cannot subtract from a table-level grant (proven on
-- this database for billing.subscriptions). The table-level REVOKE below must
-- come FIRST and the GRANT after it; do not reorder.

REVOKE UPDATE ON TABLE marketplace.orders FROM authenticated;
GRANT  UPDATE (status, notes) ON TABLE marketplace.orders TO authenticated;

-- Whole-row comparator for the RESTRICTIVE policy. jsonb rather than 15
-- scalar parameters so that adding a column to marketplace.orders cannot
-- silently drop it out of the protected set — new columns are simply not in
-- the list and must be added deliberately.
--
-- SECURITY DEFINER (owner: postgres, which holds BYPASSRLS) so the stored-row
-- read does not recurse through this same policy. It performs NO authorisation
-- of its own and never consults current_user — it only answers "did these
-- columns change?".
CREATE OR REPLACE FUNCTION marketplace.order_protected_columns_unchanged(p_new jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_old jsonb;
    v_col text;
    -- Money and identity. Everything a buyer or supplier must never rewrite
    -- through a direct UPDATE. total_amount is here too: the supplier's quote
    -- goes through marketplace.set_order_quote() below, which authorises it.
    v_protected CONSTANT text[] := ARRAY[
        'id', 'contractor_org_id', 'supplier_org_id', 'supplier_id', 'project_id',
        'created_by', 'created_at', 'currency',
        'total_amount', 'commission_rate', 'commission_amount',
        'payment_status', 'paid_at', 'paystack_reference', 'paystack_split_code'
    ];
BEGIN
    SELECT to_jsonb(o) INTO v_old
    FROM marketplace.orders o
    WHERE o.id = (p_new ->> 'id')::uuid;

    -- No stored row means the id itself was rewritten. Refuse.
    IF v_old IS NULL THEN
        RETURN false;
    END IF;

    FOREACH v_col IN ARRAY v_protected LOOP
        IF (v_old -> v_col) IS DISTINCT FROM (p_new -> v_col) THEN
            RETURN false;
        END IF;
    END LOOP;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION marketplace.order_protected_columns_unchanged(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace.order_protected_columns_unchanged(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION marketplace.order_protected_columns_unchanged(jsonb) TO authenticated;

DROP POLICY IF EXISTS orders_money_columns_immutable ON marketplace.orders;
CREATE POLICY orders_money_columns_immutable
    ON marketplace.orders
    AS RESTRICTIVE
    FOR UPDATE
    TO authenticated
    WITH CHECK (marketplace.order_protected_columns_unchanged(to_jsonb(orders)));

-- The one legitimate money write from a user session: the supplier quoting on
-- an order. Previously this went through updateOrderStatusAction, whose only
-- gate was `if (!user)` — so the BUYER could set the amount they would be
-- charged. Authorisation here is explicit and positive.
CREATE OR REPLACE FUNCTION marketplace.set_order_quote(
    p_order_id uuid,
    p_total_amount numeric
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_order marketplace.orders%ROWTYPE;
BEGIN
    SELECT * INTO v_order FROM marketplace.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
    END IF;

    -- Only the SUPPLIER organisation quotes. The contractor is the payer.
    -- get_user_org_ids() and user_is_client_viewer() both resolve through
    -- auth.uid(), not current_user, so they remain correct inside a
    -- SECURITY DEFINER body.
    IF v_order.supplier_org_id IS NULL
       OR NOT (v_order.supplier_org_id = ANY (public.get_user_org_ids()))
       OR public.user_is_client_viewer(v_order.supplier_org_id) THEN
        RAISE EXCEPTION 'Only the supplier organisation may quote on this order'
            USING ERRCODE = '42501';
    END IF;

    -- Never re-price a charge that has been initialised, paid or refunded.
    IF v_order.payment_status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'This order is no longer awaiting payment'
            USING ERRCODE = '42501';
    END IF;

    IF p_total_amount IS NULL OR p_total_amount <= 0 THEN
        RAISE EXCEPTION 'Quote must be a positive amount' USING ERRCODE = '22023';
    END IF;

    UPDATE marketplace.orders
       SET total_amount = p_total_amount,
           updated_at   = now()
     WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION marketplace.set_order_quote(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION marketplace.set_order_quote(uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION marketplace.set_order_quote(uuid, numeric) TO authenticated;

COMMENT ON FUNCTION marketplace.set_order_quote(uuid, numeric) IS
    'Supplier-authorised price change on a pending order. The ONLY path by '
    'which a user session may write marketplace.orders.total_amount — direct '
    'UPDATE is refused by both the column grant and orders_money_columns_immutable.';

-- ═══════════════════════════════════════════════════════════════════════════
-- B. marketplace.paystack_subaccounts — payout bindings are route-only
-- ═══════════════════════════════════════════════════════════════════════════
--
-- This table decides where a supplier's money lands. Verified on production
-- 2026-09-11: RLS is enabled with exactly ONE policy (subaccounts_select_own_org,
-- cmd=SELECT), yet `authenticated` holds INSERT, UPDATE and DELETE grants. The
-- grants were dead weight — RLS refused the writes with 42501, which is why
-- POST /api/paystack/subaccount could mint a live Paystack subaccount against a
-- real bank account and then fail to save it.
--
-- The route now writes with the service client AFTER an OWNER_ADMIN gate
-- against the supplier's own organisation. Deliberately NOT closed with new
-- INSERT/UPDATE policies: a write policy would make payout bindings creatable
-- over direct PostgREST, a capability nothing needs. Removing the grants means
-- the table cannot be written from a user session at all, whatever policies
-- exist now or later.

REVOKE INSERT, UPDATE, DELETE ON TABLE marketplace.paystack_subaccounts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE marketplace.paystack_subaccounts FROM anon;

COMMENT ON TABLE marketplace.paystack_subaccounts IS
    'Supplier payout bindings. Writable ONLY by the service role, via '
    'POST /api/paystack/subaccount after an owner/admin gate on the supplier''s '
    'organisation. User sessions hold SELECT and nothing else (00191).';

-- ═══════════════════════════════════════════════════════════════════════════
-- C. Medium-Voltage results — close the read side the page gate cannot reach
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The R2 000/user/yr MV paywall was enforced only in page.tsx files. The
-- application side is now gated (POST /api/medium-voltage/study returns 402,
-- and the four paid server actions refuse), but cable_schedule is an exposed
-- PostgREST schema and `authenticated` holds SELECT on fault_results and
-- discrimination_checks under a policy qualifying on user_has_project_access()
-- — TRUE for any project_members row at any role. No app gate can close that.
--
-- public.user_has_mv_access(uuid) is SECURITY DEFINER with EXECUTE granted to
-- authenticated (verified: has_function_privilege('authenticated', …) = true,
-- and false for anon), so it is callable from an RLS predicate.
--
-- FOR ALL rather than FOR SELECT: with the USING clause doubling as the
-- WITH CHECK for INSERT/UPDATE, this also stops a non-subscriber writing
-- results directly over PostgREST. service_role and postgres hold BYPASSRLS,
-- so report generation and the migration tooling are unaffected.
--
-- Blast radius measured on production 2026-09-11 before writing this:
--   · all 131 fault_results rows belong to WM-Consulting;
--   · all 27 members of that org are WM members, whom user_has_mv_access
--     exempts unconditionally (its first EXISTS is a WM-org bypass);
--   · discrimination_checks holds 0 rows;
--   · the only 2 non-WM project_members sit on a project with no MV results.
-- Nobody loses access to anything they can read today.

DROP POLICY IF EXISTS fault_results_require_mv_access ON cable_schedule.fault_results;
CREATE POLICY fault_results_require_mv_access
    ON cable_schedule.fault_results
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (COALESCE(public.user_has_mv_access(auth.uid()), false));

DROP POLICY IF EXISTS discrimination_checks_require_mv_access ON cable_schedule.discrimination_checks;
CREATE POLICY discrimination_checks_require_mv_access
    ON cable_schedule.discrimination_checks
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (COALESCE(public.user_has_mv_access(auth.uid()), false));

-- ⚠ COALESCE is not decoration. user_has_mv_access returns boolean and cannot
-- itself be NULL here, but the same shape without COALESCE has bitten this
-- database before (user_effective_project_role + `NULL IN (...)` in 00183),
-- and a NULL in a RESTRICTIVE USING reads as "not true" only by accident of
-- the RESTRICTIVE semantics. Keep it explicit.

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- Verification — run these AFTER applying. A green workflow proves nothing.
-- ═══════════════════════════════════════════════════════════════════════════
--
--   -- A: money columns unwritable, status/notes still writable
--   SELECT c.column_name,
--          has_column_privilege('authenticated','marketplace.orders',c.column_name,'UPDATE')
--   FROM information_schema.columns c
--   WHERE c.table_schema='marketplace' AND c.table_name='orders'
--   ORDER BY 1;          -- expect true ONLY for notes and status
--
--   SELECT policyname, permissive, cmd FROM pg_policies
--   WHERE schemaname='marketplace' AND tablename='orders'
--     AND policyname='orders_money_columns_immutable';   -- RESTRICTIVE / UPDATE
--
--   -- B: no user-session writes to payout bindings
--   SELECT privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='marketplace' AND table_name='paystack_subaccounts'
--     AND grantee='authenticated';                        -- expect SELECT only
--
--   -- C: MV read gate present, and anon cannot execute the new functions
--   SELECT tablename, policyname, permissive FROM pg_policies
--   WHERE schemaname='cable_schedule'
--     AND policyname LIKE '%require_mv_access';
--
--   SELECT p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='marketplace'
--     AND p.proname IN ('set_order_quote','order_protected_columns_unchanged');
--   -- expect anon_exec false, auth_exec true. NEVER read proacl for this:
--   -- a NULL proacl looks empty but IS the PUBLIC grant.
