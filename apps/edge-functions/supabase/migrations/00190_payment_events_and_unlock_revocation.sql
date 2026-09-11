-- =============================================================================
-- Migration 00190 — payment-event log, feature-unlock revocation, billing
--                   notification types
-- =============================================================================
-- ⚠ NUMBER: production head was 00189 (drop_notify_rfi_to) when this was
--   written, and 00186–00189 were claimed by concurrent sessions. Re-check
--   `max(version)` in supabase_migrations.schema_migrations AND origin/main
--   immediately before applying — `supabase db push` keys on the version
--   PREFIX, so a number already in the ledger makes it print "up to date",
--   exit 0 and skip this file SILENTLY. Verify by reading the objects back,
--   not by a green workflow.
--
-- Supports three findings in the Paystack pre-go-live audit. Paystack is in
-- test mode today, so none of this is exploitable yet; all of it fires the
-- moment live mode is switched on.
--
--  #16  No refund / dispute / chargeback handler existed in either webhook,
--       and billing.org_feature_unlocks had NO revoke path anywhere in the
--       monorepo — a refunded R1,999 JBCC unlock was permanent access
--       removable only by a hand-written DELETE. The live Terms of Service
--       (legal/terms/page.tsx) already promises a "payment-event log" that
--       did not exist in any schema. The first refund is already scheduled:
--       the go-live runbook instructs refunding the live smoke-test charge.
--
--  #17  A SECOND, distinct reference for a feature an org already holds
--       violates org_feature_unlocks_organisation_id_feature_key_key, was
--       console.error'd, and the handler still wrote a PAID invoice and
--       returned 200. That charge now raises a notification to a human.
--
--  Additive and idempotent. No schema is created, so no PostgREST config
--  PATCH is required (the CLAUDE.md PGRST002 condition applies only to
--  CREATE/DROP SCHEMA); a plain NOTIFY is enough for the new table.
--
-- Two things here CANNOT be proved by existence alone and carry sql: predicates
-- instead. public.has_feature ALREADY EXISTED before this migration, so
-- `function: public.has_feature(uuid,text)` is true whether or not the CREATE OR
-- REPLACE ran — the body must be read back for `revoked_at IS NULL`, or the
-- revoke path is unproven while the block looks full. Likewise
-- notifications_type_check existed since 00173; the constraint directive proves
-- a constraint of that name is attached, the sql: predicate proves it is THIS
-- version of it (three new values present, and site_form_distributed still
-- there, so a re-declaration that dropped an old value is caught too).
-- billing.payment_events is deny-by-default rather than policy-gated, which is
-- a property of relrowsecurity + relforcerowsecurity + the ABSENCE of any
-- policy; all three are asserted, because the table holds raw Paystack payloads
-- carrying customer PII.
--
-- @verify:begin
-- table: billing.payment_events
-- index: uq_payment_events_type_reference ON billing.payment_events
-- index: idx_payment_events_reference ON billing.payment_events
-- index: idx_payment_events_org ON billing.payment_events
-- sql: EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'billing' AND c.relname = 'payment_events' AND c.relrowsecurity AND c.relforcerowsecurity)
-- sql: NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'billing' AND tablename = 'payment_events')
-- grant_absent: anon SELECT ON billing.payment_events
-- grant_absent: anon INSERT ON billing.payment_events
-- grant_absent: anon UPDATE ON billing.payment_events
-- grant_absent: anon DELETE ON billing.payment_events
-- grant_absent: authenticated SELECT ON billing.payment_events
-- grant_absent: authenticated INSERT ON billing.payment_events
-- grant_absent: authenticated UPDATE ON billing.payment_events
-- grant_absent: authenticated DELETE ON billing.payment_events
-- grant_present: service_role SELECT ON billing.payment_events
-- grant_present: service_role INSERT ON billing.payment_events
-- column: billing.org_feature_unlocks.revoked_at
-- column: billing.org_feature_unlocks.revoked_reason
-- index: idx_org_feature_unlocks_active ON billing.org_feature_unlocks
-- function: public.has_feature(uuid, text)
-- sql: pg_get_functiondef('public.has_feature(uuid,text)'::regprocedure) LIKE '%revoked_at IS NULL%'
-- constraint: notifications_type_check ON public.notifications
-- sql: EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check' AND pg_get_constraintdef(oid) LIKE '%billing_duplicate_charge%' AND pg_get_constraintdef(oid) LIKE '%billing_refund_processed%' AND pg_get_constraintdef(oid) LIKE '%billing_dispute_opened%' AND pg_get_constraintdef(oid) LIKE '%site_form_distributed%')
-- behaviour: refund webhook -> payment_events row + org_feature_unlocks.revoked_at set,
--            and public.has_feature(org, 'jbcc') flips to false for that org
-- behaviour: a re-delivered Paystack event for the same (event_type, reference) ->
--            payload UPDATEd, no duplicate row, no 500
-- behaviour: WM-Consulting still passes has_feature unconditionally, revoked or not
-- @verify:end
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- A. billing.payment_events — the durable record the ToS already promises
-- ─────────────────────────────────────────────────────────────────────────────
-- Written ONLY by /api/paystack/webhook with the service client. Refunds,
-- disputes and any charge that could not be attributed to an org land here so
-- there is evidence money moved even when no invoice row could be written.
--
-- Idempotent on (event_type, paystack_reference): Paystack re-delivers, and a
-- re-delivery must update the payload rather than pile up rows or 500.

CREATE TABLE IF NOT EXISTS billing.payment_events (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type          text        NOT NULL,
    paystack_reference  text        NOT NULL,
    organisation_id     uuid        REFERENCES public.organisations(id) ON DELETE SET NULL,
    user_id             uuid        REFERENCES auth.users(id)           ON DELETE SET NULL,
    amount_kobo         bigint,
    payload             jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_type_reference
    ON billing.payment_events (event_type, paystack_reference);

CREATE INDEX IF NOT EXISTS idx_payment_events_reference
    ON billing.payment_events (paystack_reference);

CREATE INDEX IF NOT EXISTS idx_payment_events_org
    ON billing.payment_events (organisation_id);

COMMENT ON TABLE billing.payment_events IS
  'Append-style Paystack event log (refunds, disputes, unattributable charges). Service-role only — the payload column carries raw Paystack bodies including customer email.';

-- RLS on with NO permissive policy: deny-by-default for every PostgREST role.
-- service_role is BYPASSRLS, so the webhook is unaffected. The raw payload
-- contains customer PII, so this is deliberately NOT readable by the org.
ALTER TABLE billing.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing.payment_events FORCE ROW LEVEL SECURITY;

-- The `billing` schema has table default privileges that grant `anon` and
-- `authenticated` at creation time (the same Supabase ALTER DEFAULT PRIVILEGES
-- behaviour that made `REVOKE ... FROM PUBLIC` insufficient in PR #160 #1).
-- Name both roles explicitly rather than trusting PUBLIC.
REVOKE ALL ON billing.payment_events FROM PUBLIC;
REVOKE ALL ON billing.payment_events FROM anon;
REVOKE ALL ON billing.payment_events FROM authenticated;
GRANT  ALL ON billing.payment_events TO   service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- B. billing.org_feature_unlocks — a revoke path that actually revokes
-- ─────────────────────────────────────────────────────────────────────────────
-- The unlock row is kept, not deleted: it is the only durable record that the
-- money was taken and later returned. Access is removed by the predicate in
-- public.has_feature below.

ALTER TABLE billing.org_feature_unlocks
    ADD COLUMN IF NOT EXISTS revoked_at     timestamptz,
    ADD COLUMN IF NOT EXISTS revoked_reason text;

COMMENT ON COLUMN billing.org_feature_unlocks.revoked_at IS
  'Set by the Paystack refund handler. public.has_feature ignores revoked rows, so this genuinely removes access rather than recording an intention to.';

CREATE INDEX IF NOT EXISTS idx_org_feature_unlocks_active
    ON billing.org_feature_unlocks (organisation_id, feature_key)
    WHERE revoked_at IS NULL;

-- public.has_feature is THE gate — apps/web/src/lib/features.ts calls it as an
-- RPC and fails closed on error, and the DB function is what every server
-- action ultimately consults. Adding the predicate here closes the revoke path
-- for every caller at once.
--
-- CREATE OR REPLACE preserves the existing ACL, so the PR #160 #1 anon-EXECUTE
-- trap does not apply: no new grant is created. The WM-Consulting bypass and
-- the STABLE / SECURITY DEFINER qualifiers are carried over verbatim.
CREATE OR REPLACE FUNCTION public.has_feature(p_org_id uuid, p_feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$
    SELECT
        p_org_id = 'dddddddd-0000-0000-0000-000000000001'::uuid
        OR EXISTS (
            SELECT 1 FROM billing.org_feature_unlocks
            WHERE organisation_id = p_org_id
              AND feature_key     = p_feature_key
              AND revoked_at IS NULL
        );
$function$;

COMMENT ON FUNCTION public.has_feature(uuid, text) IS
  'Per-org paid add-on gate. Ignores rows revoked by a Paystack refund (00190). WM-Consulting always passes.';

-- ─────────────────────────────────────────────────────────────────────────────
-- C. public.notifications — billing event types
-- ─────────────────────────────────────────────────────────────────────────────
-- Re-declared in full (the 00178 pattern): a CHECK cannot be extended in place,
-- and enumerating the whole set keeps the constraint readable in one place.
-- Every existing value is preserved — dropping one would make the trigger that
-- writes it fail at runtime, silently, on a path nobody re-tests.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
    type = ANY (ARRAY[
        'snag_status_changed',
        'rfi_assigned',
        'rfi_closed',
        'rfi_response',
        'grn_recorded',
        'inspection_assigned',
        'inspection_awaiting_verification',
        'inspection_certified',
        'inspection_re_inspect_required',
        'inspection_revoked',
        'inspection_abandoned',
        'qc_issued',
        'rfi_created',
        'snag_created',
        'diary_created',
        'qc_comment',
        'snag_visit_completed',
        'site_form_distributed',
        -- 00190 — Paystack money events that must reach a person, not a log line
        'billing_duplicate_charge',
        'billing_refund_processed',
        'billing_dispute_opened'
    ]::text[])
);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Verification (run AFTER applying — a green deploy workflow is NOT evidence
-- the migration ran; db push skips a file whose version prefix is already in
-- the ledger and exits 0):
--
--   SELECT to_regclass('billing.payment_events');                 -- not null
--   SELECT has_table_privilege('anon','billing.payment_events','SELECT');  -- f
--   SELECT has_table_privilege('authenticated','billing.payment_events','SELECT'); -- f
--   SELECT column_name FROM information_schema.columns
--     WHERE table_schema='billing' AND table_name='org_feature_unlocks'
--       AND column_name IN ('revoked_at','revoked_reason');       -- 2 rows
--   SELECT pg_get_functiondef('public.has_feature(uuid,text)'::regprocedure)
--     LIKE '%revoked_at IS NULL%';                                -- t
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname='notifications_type_check';                   -- 21 values
-- =============================================================================
