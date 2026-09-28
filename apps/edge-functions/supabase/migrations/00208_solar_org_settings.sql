-- ---------------------------------------------------------------------------
-- Migration 00208: Solar org settings, notification types, product events
-- ---------------------------------------------------------------------------
-- ⚠ NUMBER: claim it at APPLY time, not now. Immediately before applying,
-- re-check THREE places: the ledger max(version), origin/main's migration
-- filenames, and the migration filenames in every OPEN PR (feat/solar-phase-1b
-- included). If 00208 is taken, renumber this file (and the header of
-- scripts/db/assert-solar-org-settings-roles.sql) above the head first.
-- Claiming a number is not holding it: the head moves when someone APPLIES.
--
-- Spec: docs/solar/01-functional-spec.md §11 (org settings), §1.2/§1.3
-- (request + approval notifications), §0.4 rule 8 (solar_* product events);
-- docs/solar/03-data-model-and-security.md §2 (org_settings: org_id,
-- settings jsonb versioned, updated_by). Defaults live in code
-- (@esite/shared solar/org-settings.ts), seeded from D-05, D-07, D-16.
--
-- WHAT.
--   1. solar.org_settings — one row per organisation; the JSON of defaults
--      every new case copies. Owners/admins of the org read and write it;
--      nobody deletes it (a case snapshot never depends on the row existing).
--   2. public.notifications type CHECK re-declared IN FULL with four Solar
--      types (00190's list + solar_*). A type missing here makes the bell
--      insert fail silently in send-notification.
--   3. public.product_events event CHECK re-declared IN FULL with five
--      solar_* verbs (00199's list + solar_*). packages/shared PRODUCT_EVENTS
--      and its contract test change in the same PR.
--
-- 00207's schema-wide @verify directives are re-checked on every deploy and
-- this migration conforms to each: FORCE RLS on the new relkind 'r' table; no
-- RESTRICTIVE policy covering SELECT anywhere in solar; the SECURITY DEFINER
-- bind function revokes EXECUTE from PUBLIC and anon.
--
-- NO BEGIN/COMMIT in this file: scripts/db/dry-run-migration.sh wraps it in
-- BEGIN … ROLLBACK, and a COMMIT here would make that dry run permanent.
-- ---------------------------------------------------------------------------

-- @verify:begin
-- table: solar.org_settings
-- constraint: org_settings_settings_is_object ON solar.org_settings
-- function: solar.org_settings_bind()
-- trigger: org_settings_bind ON solar.org_settings
-- policy: org_settings_select ON solar.org_settings PERMISSIVE
-- policy: org_settings_insert ON solar.org_settings PERMISSIVE
-- policy: org_settings_update ON solar.org_settings PERMISSIVE
-- grant_absent: anon SELECT ON solar.org_settings
-- grant_absent: authenticated DELETE ON solar.org_settings
-- grant_absent: anon EXECUTE ON solar.org_settings_bind()
-- sql: (SELECT c.relrowsecurity AND c.relforcerowsecurity FROM pg_class c WHERE c.oid = 'solar.org_settings'::regclass)
-- sql: (SELECT count(*) = 0 FROM pg_policy WHERE polrelid = 'solar.org_settings'::regclass AND polcmd IN ('d', '*'))
-- constraint: notifications_type_check ON public.notifications
-- sql: EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check' AND pg_get_constraintdef(oid) LIKE '%solar_subscribe_requested%' AND pg_get_constraintdef(oid) LIKE '%solar_access_requested%' AND pg_get_constraintdef(oid) LIKE '%solar_access_changed%' AND pg_get_constraintdef(oid) LIKE '%solar_access_declined%' AND pg_get_constraintdef(oid) LIKE '%billing_dispute_opened%' AND pg_get_constraintdef(oid) LIKE '%site_form_distributed%')
-- constraint: product_events_event_check ON public.product_events
-- sql: (SELECT pg_get_constraintdef(oid) LIKE '%solar_subscribe_requested%' AND pg_get_constraintdef(oid) LIKE '%solar_access_requested%' AND pg_get_constraintdef(oid) LIKE '%solar_access_changed%' AND pg_get_constraintdef(oid) LIKE '%solar_site_saved%' AND pg_get_constraintdef(oid) LIKE '%solar_settings_saved%' AND pg_get_constraintdef(oid) LIKE '%cable_route_sheet_exported%' FROM pg_constraint WHERE conrelid = 'public.product_events'::regclass AND conname = 'product_events_event_check')
-- behaviour: scripts/db/assert-solar-org-settings-roles.sql — every row ok
-- @verify:end

-- ── 1. solar.org_settings ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar.org_settings (
    organisation_id  UUID PRIMARY KEY REFERENCES public.organisations(id) ON DELETE CASCADE,
    settings         JSONB NOT NULL DEFAULT '{}'::jsonb
                       CONSTRAINT org_settings_settings_is_object CHECK (jsonb_typeof(settings) = 'object'),
    version          INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_by       UUID REFERENCES auth.users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The organisation is the row's identity: immutable. Attribution and
-- timestamps are bound, never trusted from the client.
CREATE OR REPLACE FUNCTION solar.org_settings_bind()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.organisation_id <> OLD.organisation_id THEN
            RAISE EXCEPTION 'solar.org_settings: organisation_id is immutable' USING ERRCODE = '42501';
        END IF;
        NEW.created_at := OLD.created_at;
    END IF;
    IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL THEN NEW.created_at := NOW(); END IF;
    NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by);
    NEW.updated_at := NOW();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION solar.org_settings_bind() FROM PUBLIC;
REVOKE ALL ON FUNCTION solar.org_settings_bind() FROM anon;
CREATE TRIGGER org_settings_bind BEFORE INSERT OR UPDATE ON solar.org_settings
    FOR EACH ROW EXECUTE FUNCTION solar.org_settings_bind();

ALTER TABLE solar.org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar.org_settings FORCE ROW LEVEL SECURITY;
-- Per verb, PERMISSIVE only (00207 forbids a RESTRICTIVE read policy in solar).
-- Owners/admins of the org only: the defaults include rate cards (money).
CREATE POLICY org_settings_select ON solar.org_settings FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_organisations uo
                    WHERE uo.user_id = auth.uid() AND uo.organisation_id = org_settings.organisation_id
                      AND uo.is_active AND uo.role IN ('owner', 'admin')));
CREATE POLICY org_settings_insert ON solar.org_settings FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM public.user_organisations uo
                         WHERE uo.user_id = auth.uid() AND uo.organisation_id = org_settings.organisation_id
                           AND uo.is_active AND uo.role IN ('owner', 'admin')));
CREATE POLICY org_settings_update ON solar.org_settings FOR UPDATE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_organisations uo
                    WHERE uo.user_id = auth.uid() AND uo.organisation_id = org_settings.organisation_id
                      AND uo.is_active AND uo.role IN ('owner', 'admin')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.user_organisations uo
                         WHERE uo.user_id = auth.uid() AND uo.organisation_id = org_settings.organisation_id
                           AND uo.is_active AND uo.role IN ('owner', 'admin')));
-- No DELETE policy and no DELETE grant.

GRANT SELECT, INSERT, UPDATE ON solar.org_settings TO authenticated;
-- The schema's default privileges granted DELETE/TRUNCATE at CREATE TABLE; take them back.
REVOKE DELETE, TRUNCATE ON solar.org_settings FROM authenticated;
GRANT ALL ON solar.org_settings TO service_role;
REVOKE ALL ON solar.org_settings FROM anon;

-- ── 2. Notification types (re-declared in full: 00190's list + Solar) ───────
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
        'billing_duplicate_charge',
        'billing_refund_processed',
        'billing_dispute_opened',
        -- 00208: Solar access requests and decisions
        'solar_subscribe_requested',
        'solar_access_requested',
        'solar_access_changed',
        'solar_access_declined'
    ]::text[])
);

-- ── 3. Product events (re-declared in full: 00199's list + Solar) ───────────
ALTER TABLE public.product_events DROP CONSTRAINT IF EXISTS product_events_event_check;
ALTER TABLE public.product_events ADD CONSTRAINT product_events_event_check CHECK (event IN (
    'rfi_created',
    'rfi_responded',
    'rfi_closed',
    'snag_resolved',
    'project_created',
    'project_deleted',
    'marketplace_order_placed',
    'onboarding_started',
    'backfill_completed',
    'cable_route_leg_saved',
    'cable_route_assigned',
    'cable_route_sheet_exported',
    'solar_subscribe_requested',
    'solar_access_requested',
    'solar_access_changed',
    'solar_site_saved',
    'solar_settings_saved'
));

NOTIFY pgrst, 'reload schema';
