-- =============================================================================
-- Migration 00187 — billing read gate: make the predicate match the policy name
-- =============================================================================
-- ⚠ NUMBER IS A PLACEHOLDER. Production head is 00185 at the time of writing and
--   several sessions are shipping migrations concurrently. Re-check
--   `max(version)` in supabase_migrations.schema_migrations AND origin/main
--   immediately before applying, and re-verify by reading the policies back —
--   `db push` keys on the version PREFIX, so a number already in the ledger
--   makes it print "up to date", exit 0 and skip this file silently.
--
-- Two policies shipped in 00007 with names that promised a role check and quals
-- that had none:
--
--     "Org admins can view invoices"      USING (organisation_id = ANY (get_user_org_ids()))
--     "Org admins can view subscription"  USING (organisation_id = ANY (get_user_org_ids()))
--
-- get_user_org_ids() filters on is_active only, so both evaluate TRUE for EVERY
-- member of the org at ANY role. Verified on production as the rbac-test
-- CONTRACTOR (018f2d31-…), in a rolled-back transaction:
--
--     SELECT count(*), string_agg(paystack_reference, ',') FROM billing.invoices;
--     →  3 | 92gknwac2z,zputhd9phg,fdgyux6ite
--
-- WM-Consulting has 27 active members — 12 contractors and 3 client_viewers,
-- most of them staff at other firms. Every one of them could read the firm's
-- plan, every amount paid, and every Paystack reference. The references are the
-- live half: /api/paystack/callback took `reference` from the query string and
-- wrote billing.subscriptions with the service client, so a readable reference
-- was a one-click org-wide tier rewrite. The route now gates on OWNER_ADMIN and
-- guards the replay; this migration closes the read that made it a one-click
-- attack instead of a guessing one, and closes direct PostgREST with it.
--
-- The two tables get DIFFERENT treatment, deliberately — see part B.
--
-- Additive/idempotent, no schema created, no new function. `billing` is already
-- in the PostgREST db_schema list, so no config PATCH is needed (a policy change
-- does not touch the schema cache at all; the trailing NOTIFY is belt-and-braces).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- A. billing.invoices — owner/admin only, as the name always claimed
-- ─────────────────────────────────────────────────────────────────────────────
-- The only user-client reader is billingService.getInvoices() from
-- (admin)/settings/billing/page.tsx, which is already requireRolePage(OWNER_ADMIN).
-- Nothing else in the monorepo reads billing.invoices with a user client, so
-- narrowing this to owner/admin costs no live reader. The webhook, the callback,
-- eft-invoice and payment-recovery-check all use the service client, which is
-- BYPASSRLS (verified: pg_roles.rolbypassrls = true for service_role) and is
-- therefore unaffected.
--
-- public.user_is_org_admin() (00177) is reused rather than re-implemented: it is
-- SECURITY DEFINER with row_security off, and returns EXISTS(...) so it is a
-- true boolean and never NULL — the 00183 COALESCE trap does not apply. It does
-- NOT consult current_user for authorisation (the PR #160 #2 lesson).

DROP POLICY IF EXISTS "Org admins can view invoices" ON billing.invoices;
DROP POLICY IF EXISTS invoices_select_org_admin      ON billing.invoices;

CREATE POLICY invoices_select_org_admin
    ON billing.invoices
    FOR SELECT TO authenticated
    USING (
        organisation_id = ANY (public.get_user_org_ids())
        AND public.user_is_org_admin(organisation_id)
    );

-- Defence in depth, 00171/00183 pattern: a RESTRICTIVE policy INTERSECTS rather
-- than unions, so any permissive SELECT policy added to this table later cannot
-- silently reopen the money trail. TO public so anon is covered too.
DROP POLICY IF EXISTS invoices_admin_read_gate ON billing.invoices;

CREATE POLICY invoices_admin_read_gate
    ON billing.invoices
    AS RESTRICTIVE FOR SELECT TO public
    USING (public.user_is_org_admin(organisation_id));

COMMENT ON POLICY invoices_select_org_admin ON billing.invoices IS
  'Owner/admin of the invoiced org only. Replaces 00007''s "Org admins can view invoices", whose qual was bare org membership.';

-- ─────────────────────────────────────────────────────────────────────────────
-- B. billing.subscriptions — renamed to what it does; predicate deliberately
--    UNCHANGED. Read this before "fixing" it.
-- ─────────────────────────────────────────────────────────────────────────────
-- The obvious symmetric change — an owner/admin predicate here too — breaks two
-- live readers that use the USER client at every role, both verified in the
-- worktree:
--
--   • components/layout/PaymentStatusBanner.tsx:51-56 reads `status` and is
--     rendered unconditionally from (admin)/layout.tsx for every non-client_viewer.
--     With an admin-only qual it finds no row, `if (!status) return null` fires,
--     and the "Account paused — read-only mode" warning disappears for exactly
--     the 12 contractors who need to see it.
--   • actions/project.actions.ts:44-56 (checkProjectQuota, called by
--     createProjectAction for any member who can create a project) falls to its
--     `?? 'free'` default and imposes a false 1-project cap org-wide.
--
-- The column-privilege alternative proposed in the audit —
--   REVOKE SELECT (amount_kobo, paystack_customer_code, …) FROM authenticated, anon
-- — was run against production in a rolled-back transaction and is a COMPLETE
-- NO-OP: `authenticated` holds a TABLE-level grant (relacl authenticated=arwd),
-- and PostgreSQL's column-level REVOKE cannot subtract from a table-wide grant.
-- has_column_privilege('authenticated','billing.subscriptions','amount_kobo','SELECT')
-- was still TRUE afterwards. Shipping it would have read as fixed and changed
-- nothing — the fourth-instance failure mode.
--
-- The form that DOES take effect (REVOKE SELECT ON TABLE, then GRANT the safe
-- columns back) was also run on production: it hides amount_kobo correctly, and
-- then the OWNER's own billing page fails, because billingService.getSubscription
-- issues select('*'):
--     OWNER billing page select(*) → ERROR permission denied for table subscriptions
--     narrow select(tier,status)   → OK rows=1
--
-- Closing this properly therefore requires narrowing PaymentStatusBanner and
-- checkProjectQuota to a SECURITY DEFINER RPC (or the service client) and
-- pinning getSubscription to an explicit column list FIRST. That is application
-- work in files owned elsewhere, tracked as a follow-up. Until then the policy
-- keeps its behaviour and merely stops lying about it: org members can read
-- their org's tier, status, amount and Paystack customer code. The invoice
-- trail — the part that enabled the callback replay — is closed above.

DROP POLICY IF EXISTS "Org admins can view subscription" ON billing.subscriptions;
DROP POLICY IF EXISTS subscriptions_select_org_member    ON billing.subscriptions;

CREATE POLICY subscriptions_select_org_member
    ON billing.subscriptions
    FOR SELECT TO authenticated
    USING (organisation_id = ANY (public.get_user_org_ids()));

COMMENT ON POLICY subscriptions_select_org_member ON billing.subscriptions IS
  'Any active member of the org, at any role — NOT admins only. Renamed from 00007''s "Org admins can view subscription", which claimed a role check it never had. PaymentStatusBanner and checkProjectQuota read this with the user client at every role; see migration 00187 for why an admin predicate cannot be added until those are narrowed.';

-- ─────────────────────────────────────────────────────────────────────────────
-- C. anon has no business reading either table
-- ─────────────────────────────────────────────────────────────────────────────
-- Both tables carry `anon=r` from 00007. RLS already yields anon zero rows
-- (get_user_org_ids() is empty when auth.uid() is NULL, and user_is_org_admin
-- is FALSE), so this removes a grant that grants nothing — but it means a future
-- permissive policy cannot hand the money trail to an unauthenticated caller.
-- Both policies above are TO authenticated, so nothing anon does today changes.

REVOKE SELECT ON billing.invoices      FROM anon;
REVOKE SELECT ON billing.subscriptions FROM anon;

NOTIFY pgrst, 'reload schema';
