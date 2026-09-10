-- ---------------------------------------------------------------------------
-- Migration 00185: Resend delivery evidence — email_events + email_suppressions
-- ---------------------------------------------------------------------------
-- Why: public.email_sequence_events has carried opened_at / clicked_at since
-- 00030 with the comment "populated by Resend webhook (Phase 2)"
-- (00030_email_sequences.sql:24-25). Phase 2 never shipped. 246 automated
-- emails have been sent to 36 accounts and every opened_at and clicked_at is
-- NULL — a measurement gap, not a behaviour measurement. Q1's entire outcome
-- ships over this channel (§13 item 7's 07:00 recap), so the channel must be
-- measurable before it is designed on.
--
-- public.email_events is the append-only log of every Resend delivery event for
-- EVERY message, sequence mail or not. The recap is not sequence mail and gets
-- no email_sequence_events row, so a second home is required rather than
-- optional.
--
-- public.email_suppressions is §05 :173(4)'s bounce/complaint suppression list,
-- one row per address, and one of the three switches the always-fires
-- notifications honour (§05 :187).
--
-- RLS NOTE, so the limitation is documented rather than discovered: the read
-- policy below serves org owners and admins only. A project_manager reads ZERO
-- rows, and so does every human for an address with no profile — an external
-- notify_rfi_to recipient, a canary. Both are fail-closed and intended; both
-- are verified against production after this migration applies.
--
-- Reversible: DROP TABLE public.email_suppressions; DROP TABLE public.email_events;
--
-- @verify:begin
-- table: public.email_events
-- table: public.email_suppressions
-- constraint: email_events_webhook_id_key ON public.email_events
-- constraint: email_events_event_type_check ON public.email_events
-- constraint: email_events_source_check ON public.email_events
-- constraint: email_suppressions_reason_check ON public.email_suppressions
-- index: email_events_message_id_idx ON public.email_events
-- index: email_events_to_email_idx ON public.email_events
-- policy: email_events_org_admin_read ON public.email_events
-- grant_absent: anon SELECT ON public.email_events
-- grant_absent: anon INSERT ON public.email_events
-- grant_absent: anon UPDATE ON public.email_events
-- grant_absent: anon DELETE ON public.email_events
-- grant_absent: anon SELECT ON public.email_suppressions
-- grant_absent: anon INSERT ON public.email_suppressions
-- grant_absent: anon UPDATE ON public.email_suppressions
-- grant_absent: anon DELETE ON public.email_suppressions
-- grant_absent: authenticated SELECT ON public.email_suppressions
-- @verify:end
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_events (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id        TEXT        NOT NULL UNIQUE,
    resend_message_id TEXT,
    event_type        TEXT        NOT NULL,
    occurred_at       TIMESTAMPTZ NOT NULL,
    retrieved_at      TIMESTAMPTZ,
    to_email          TEXT,
    subject           TEXT,
    bounce_type       TEXT,
    project_id        UUID,
    entity_ref        TEXT,
    source            TEXT        NOT NULL DEFAULT 'webhook',
    payload           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT email_events_event_type_check CHECK (event_type IN (
        'email.sent', 'email.delivered', 'email.delivery_delayed',
        'email.bounced', 'email.complained', 'email.opened', 'email.clicked',
        'email.failed')),
    CONSTRAINT email_events_source_check CHECK (source IN (
        'webhook', 'backfill', 'send_failure'))
);

COMMENT ON TABLE public.email_events IS
  'Append-only Resend delivery events for every message the platform sends. '
  'webhook_id is the svix-id header (or ''backfill:<message_id>'' / '
  '''send_failure:<sequence_event_id>'') and is the idempotency key — Svix '
  'retries reuse the same svix-id.';
COMMENT ON COLUMN public.email_events.occurred_at IS
  'When the event happened. For source=''webhook'' from the payload; for '
  '''backfill'' and ''send_failure'' it is the ORIGINAL send time taken from '
  'email_sequence_events.sent_at, so a weekly bucket over this column is not '
  'a single-day spike. The moment the back-fill observed the state is '
  'retrieved_at.';
COMMENT ON COLUMN public.email_events.retrieved_at IS
  'Only for source=''backfill'': when the Resend retrieve endpoint was asked. '
  'That endpoint returns a last-known state with no timestamp of its own, so '
  'the as-of and the event time are genuinely different facts.';
COMMENT ON COLUMN public.email_events.to_email IS
  'Lower-cased first recipient. The RLS policy and the suppression list both '
  'key on it; the full recipient array is preserved in payload.';
COMMENT ON COLUMN public.email_events.bounce_type IS
  'Resend bounce classification (Permanent / Transient / Undetermined). Only '
  'Permanent suppresses — see public.email_suppressions.';
COMMENT ON COLUMN public.email_events.event_type IS
  '''email.failed'' is a SEND-side failure: the message never left. It is not '
  'a recipient verdict and never suppresses. Without it in this CHECK the '
  'single most actionable negative signal would be 200''d and discarded.';
COMMENT ON COLUMN public.email_events.project_id IS
  'The project the message was about, read from the Resend `project_id` tag. '
  'Deliberately NO foreign key: this is an append-only evidence log and '
  'deleting a project must not rewrite what was delivered. NULL until §13 '
  'item 4''s dispatcher starts sending tags.';
COMMENT ON COLUMN public.email_events.entity_ref IS
  'The thing the message was about, as ''<kind>:<entity_id>'' (or just '
  '''<kind>'' when there is no id), from the Resend tags. The vocabulary is '
  'fixed in apps/web/src/lib/webhooks/resend-events.ts so item 4 and item 7 '
  'send with it rather than each inventing one: kind is recap | rfi | snag | '
  'invite | onboarding | report.';

CREATE INDEX IF NOT EXISTS email_events_message_id_idx
    ON public.email_events (resend_message_id)
    WHERE resend_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_events_to_email_idx
    ON public.email_events (to_email, occurred_at DESC);

-- No index on project_id or entity_ref: nothing reads them yet. The columns
-- exist now because adding them later is a second migration on a live table
-- and another number claim; an index with no query is speculative.

CREATE TABLE IF NOT EXISTS public.email_suppressions (
    email_address       TEXT        PRIMARY KEY,
    reason              TEXT        NOT NULL,
    first_suppressed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_event_at       TIMESTAMPTZ NOT NULL,
    source_message_id   TEXT,
    CONSTRAINT email_suppressions_reason_check CHECK (reason IN ('hard_bounce', 'complaint'))
);

-- NOTE on the form of this comment: COMMENT ON ... IS takes a string CONSTANT,
-- not an expression, so `||` is a syntax error here (42601) — and Postgres also
-- refuses to implicitly concatenate a plain literal with an escape string
-- constant (E'...'), which is how the paragraph breaks were first written. The
-- only form that works is a single literal containing real newlines. Both
-- earlier forms failed the rolled-back dry run against production; this one
-- passes it.
COMMENT ON TABLE public.email_suppressions IS
'Addresses that must not be mailed again: a Permanent bounce or a spam complaint. Maintained ONLY by the Resend webhook, so it is built forward from live events — the historical back-fill cannot populate it, because the Resend retrieve endpoint returns no bounce classification.

WRITE-ONLY UNTIL §13 ITEM 7. Nothing consults this list yet. The seven lifecycle edge functions gate only on hasOptedOut (_shared/email-sequence.ts:121) and will keep mailing a hard-bounced address daily until item 7 wires the consult through packages/shared/src/email/suppression.ts. Until then the protection is a record, not a control; §15 §(b2) Rule 3''s Monday ops review reads this table so a growing list is seen by a human rather than by nobody.

Release is a deliberate data change, not a button: a hard-bounced address is not fixed by un-suppressing it, it is fixed by correcting the address, which is a different address.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- email_events: an org owner/admin may read delivery events for addresses
-- belonging to members of their own org. The EXISTS subquery runs under the
-- caller's RLS on public.profiles and public.user_organisations, both of which
-- already permit org-member visibility (00009_rls_policies.sql:81-89, :95-97),
-- so this policy can never widen what the reader can already see.
--
-- Measured consequences, stated rather than discovered (all 2026-09-10):
--   * 31 of the 36 mailed addresses hold an active user_organisations row —
--     13 contractor, 12 admin, 4 client_viewer, 2 owner — so the 12 admins and
--     2 owners can read their org's events. Good.
--   * A project_manager reads ZERO rows. PMs are the people §04 and §13 put in
--     the chasing role; widening to them is the /settings/users chip in this
--     plan's Deferred table, not this migration.
--   * 5 addresses have no user_organisations row at all (2766mattheus@gmail.com,
--     arno@watsonmattheus.com, demo.owner@wmeng.co.za, demo.pm@wmeng.co.za,
--     spud-test-signup@inboxkitten.com) — service_role only.
--   * Any external notify_rfi_to recipient is invisible to every human.
-- All four are fail-closed and intended. Task 7 Step 6 proves the second one.
--
-- email_suppressions: NO permissive policy at all. Its only consumer is the
-- service-role sender. RLS on with no policy denies every authenticated read.

ALTER TABLE public.email_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_events_org_admin_read ON public.email_events;
CREATE POLICY email_events_org_admin_read
    ON public.email_events
    FOR SELECT TO authenticated
    USING (
        to_email IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.user_organisations uo
              ON uo.user_id = p.id AND uo.is_active
            WHERE lower(p.email) = public.email_events.to_email
              AND public.user_is_org_admin(uo.organisation_id)
        )
    );

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Supabase's bootstrap ALTER DEFAULT PRIVILEGES on schema public grants anon
-- and authenticated arwdDxtm on every new table — INSERT, UPDATE, DELETE and
-- TRUNCATE, not merely SELECT. A new public table is therefore born forgeable.
-- REVOKE ALL, then grant back exactly what the policies gate. Verify with
-- has_table_privilege, never by reading relacl: a NULL relacl IS the grant.

REVOKE ALL ON public.email_events       FROM anon, authenticated;
REVOKE ALL ON public.email_suppressions FROM anon, authenticated;

GRANT SELECT ON public.email_events TO authenticated;   -- gated by the policy above
GRANT ALL    ON public.email_events       TO service_role;
GRANT ALL    ON public.email_suppressions TO service_role;

-- New tables in an existing schema need the schema-cache reload. Only a NEW
-- schema needs the Management-API PostgREST db_schema PATCH; neither table
-- introduces one.
NOTIFY pgrst, 'reload schema';
