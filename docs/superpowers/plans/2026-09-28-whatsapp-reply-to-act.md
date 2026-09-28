# WhatsApp Reply-to-Act Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let E-Site users and invited external foremen receive work-item nudges on WhatsApp and act on them (acknowledge, mark done, reply with a photo or note), with every action recorded in E-Site under that person's identity and rules.

**Architecture:**
- **Delivery:** Meta WhatsApp Cloud API, called from two Supabase edge functions: `whatsapp-webhook` (HMAC-authenticated, stores then processes) and `whatsapp-worker` (cron-driven outbox drain).
- **Storage:** a new `whatsapp` schema holds links, outbox, inbound log, templates and settings.
- **Acting as the user:** each action goes through a SECURITY DEFINER function owned by a dedicated `whatsapp_actor` role that is a member of `authenticated` and has no BYPASSRLS. The function sets the user's JWT claims first, so the real RLS policies and triggers judge the action. No parallel copy of the rules exists.
- **Pure logic** lives once in `packages/shared/src/whatsapp/core.ts` and is byte-copied to the edge.

**Tech Stack:**
- Postgres (Supabase), PL/pgSQL, pg_cron.
- Supabase Edge (Deno, TypeScript); the edge code is tested under vitest in `apps/web`.
- Next.js 15 server actions and pages; zod; vitest.
- Meta Graph API `v23.0`.

**Spec:** `docs/superpowers/specs/2026-09-28-whatsapp-reply-to-act-design.md`. **§9 "Plan-time amendments" wins over §§1–8.**

---

## Read this before Task 1

**Phases**
- **Phase 1 (Tasks 1–20)** does NOT depend on item 3 (#193) and can be built, merged and deployed dark (sending off). It supports manual `task` items end to end.
- **Phase 2 (Tasks 21–23)** needs #193 (`00202_work_item_source_mirrors_and_backfill.sql`) applied to production, and adds the snag and RFI Mark-done adapters.
- **Task 24** is the deploy runbook.
- **Task 25** is go-live, and needs Meta onboarding (spec §8 step 0) finished.

**Repo facts you will otherwise get wrong**
- Work in the worktree `…/ESITE.V1/wt-whatsapp` (branch `docs/whatsapp-reply-to-act`). **Never** switch the shared `esite/` checkout; other sessions own it.
- Production has **0** `projects.work_items` today. SQL tests create their own items inside rolled-back transactions.
- **Events on `projects.work_item_events`:**
  - They are written only by the trigger `projects.append_work_item_event()`.
  - The table has **no** `detail` column.
  - The verb CHECK is **unnamed** (auto-named), and the migration drops it by lookup.
  - `authenticated` has no INSERT on this table.
- **The transition guard `projects.work_items_transition_guard()`:**
  - It skips every authority check when `auth.uid() IS NULL` (the service role).
  - Never do a user action with a plain service-role UPDATE, because that bypasses the gatekeeper-only-close rule.
  - Act through the `wa_*` functions, which set claims.
- **`projects.project_settings`:**
  - PK is `id`, with `project_id UNIQUE`.
  - The existing toggles are `notify_rfi_email`, `notify_snag_email`, `notify_diary_email`, `notify_qc_email` and `notify_form_email`.
  - Adding a toggle means touching the zod schema, defaults, mappers, restore list, `getNotificationConfig`, `IntegrationsPanel` and `page.tsx`. `notification-toggles.contract.test.ts` fails if any of those is missing a **consumer**.
- **Edge functions:**
  - They have no Deno tests. Tests live in `apps/web/src/**` with `// @vitest-environment node` and import the edge source by relative path (`../../../../edge-functions/supabase/functions/...`).
  - A function under test exports `handler`, and its last line is `Deno.serve(handler)`.
- **`apps/web/src/lib/edge-function-jwt.contract.test.ts` enforces:**
  - Every function directory has a line in `apps/edge-functions/deploy.sh`.
  - A function importing `requireServiceRole` must never be deployed `--no-verify-jwt`.
  - No `atob(` appears in any `index.ts`.
  - No edge→edge Authorization is built from `SUPABASE_SERVICE_ROLE_KEY`.
- **Migrations:**
  - **The next free number is claimed at APPLY time, not now.** The file is written as `00207_whatsapp_reply_to_act.sql`. In Task 24 you re-check the ledger, `origin/main` and open-PR migration filenames, and rename if anything has taken 00207. (#191 holds `00201` and #193 holds `00202`; both are stranded and will renumber above the head when they land.)
  - Every migration ≥ 00185 needs a `-- @verify:begin … -- @verify:end` block. A `sql:` payload is executed verbatim, so **never put prose on a `sql:` line or its continuation lines**; use `/* */`.
- **Run all three suites before any push that touches a migration:**
  - `pnpm --filter web test`
  - `pnpm --filter @esite/shared test`
  - `pnpm --filter @esite/db test:ci`
- **SQL dry-runs:**
  - Run them with `scripts/db/dry-run-migration.sh <migration.sql> <assertions.sql>`, which wraps them as `BEGIN; <migration>; <file>; ROLLBACK;` against production over the Management API.
  - The **last statement** of an assertions file must return `(check text, ok boolean)` rows.
  - The Management API returns only the last result set.
- **Fixture:**
  - `018f2d31-bbe8-4cc1-bbdd-63af0187081e` is `rbac-test@e-site.live`, a contractor on WM-Consulting and a project member of KINGSWALK only.
  - `dbcfb404-0753-4042-85a1-020cbfacafca` is (657) MAMAILA PHASE 2, where the fixture is NOT a member.
  - Never email or WhatsApp the fixture.
- **Commits:** end every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File structure

| Path | Responsibility |
|---|---|
| `packages/shared/src/whatsapp/core.ts` | **Canonical** pure logic: constants, phone normalisation, payload codec, STOP/START, target resolution, quiet hours, done routing. No imports. |
| `packages/shared/src/whatsapp/core.test.ts` | Unit tests for core. |
| `packages/shared/src/whatsapp/index.ts` | Re-export `core`. |
| `packages/shared/scripts/sync-whatsapp-core.mjs` | Copies core.ts to the edge with a generated header. |
| `apps/edge-functions/supabase/functions/_shared/whatsapp/core.ts` | GENERATED copy. Never edit. |
| `apps/edge-functions/supabase/functions/_shared/whatsapp/signature.ts` | `X-Hub-Signature-256` verification. |
| `…/_shared/whatsapp/meta-client.ts` | Graph API client and error classification. |
| `…/_shared/whatsapp/parse.ts` | Flattens the webhook body into messages and statuses. |
| `…/_shared/whatsapp/templates.ts` | Builds template sends per trigger, plus human dates. |
| `…/_shared/whatsapp/processor.ts` | One inbound message → one outcome (the reply-to-act brain). |
| `…/_shared/whatsapp/worker.ts` | Outbox drain: quiet hours, cap, retries, classification. |
| `…/_shared/whatsapp/store.ts` | Supabase-backed implementations of the processor and worker stores (thin glue). |
| `apps/edge-functions/supabase/functions/whatsapp-webhook/index.ts` | GET verify handshake; POST verify HMAC → store → process inline. |
| `apps/edge-functions/supabase/functions/whatsapp-worker/index.ts` | Service-role cron endpoint: drain outbox and retry pending inbound. |
| `apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql` | Schema, role, functions, triggers, cron, grants, `@verify`. |
| `scripts/db/assert-whatsapp-schema.sql` | Dry-run assertions: objects, grants, owner, no leaks. |
| `scripts/db/assert-whatsapp-actor.sql` | Dry-run assertions: acting-as-user outcomes under real RLS. |
| `scripts/db/assert-whatsapp-enqueue.sql` | Dry-run assertions: outbox enqueue and due sweep. |
| `apps/web/src/lib/whatsapp/*.test.ts` | Vitest for all edge modules and both handlers. |
| `apps/web/src/lib/whatsapp/core-sync.contract.test.ts` | Asserts the edge copy is byte-identical to canonical. |
| `apps/web/src/lib/whatsapp/kick-worker.ts` | Web → worker invocation (OTP and opt-in immediacy). |
| `apps/web/src/actions/whatsapp-link.actions.ts` (+ test) | Personal number: request code, confirm, remove, quiet hours. |
| `apps/web/src/actions/whatsapp-invite.actions.ts` (+ test) | PM invites an external by WhatsApp. |
| `apps/web/src/actions/whatsapp-admin.actions.ts` (+ test) | Admin: sending switch, alert email. |
| `apps/web/src/app/(admin)/settings/account/WhatsAppLinkPanel.tsx` | Personal link UI. |
| `apps/web/src/app/(admin)/settings/whatsapp/page.tsx` (+ panel) | Admin dashboard. |
| `apps/web/src/app/(admin)/projects/[id]/settings/members/AddByWhatsAppModal.tsx` | Invite UI. |
| `apps/web/src/app/(admin)/projects/[id]/items/[ref]/page.tsx` | Minimal item page: detail, notes, photos, WhatsApp log. |
| `apps/web/src/app/wa/[itemId]/route.ts` | "Open in E-Site" redirect → item page. |
| `apps/edge-functions/supabase/functions/auth-email-hook/index.ts` | Refuse placeholder addresses. |
| `docs/rbac-matrix.md` | New rows. |
| `docs/whatsapp-runbook.md` | Deploy, templates, cron, verification. |

---

# PHASE 1 — independent of #193

## Task 1: Spike — prove the `whatsapp_actor` pattern on production (rolled back)

The whole "act as the user" design rests on four Postgres facts:
1. `postgres` can create a role and grant it `authenticated`.
2. A SECURITY DEFINER function owned by that role is subject to RLS.
3. `set_config('request.jwt.claims', …, true)` inside it makes `auth.uid()` the user.
4. The transition guard then fires under that identity.

Prove all four before building on them.

**Files:**
- Create: `scripts/db/fixtures/noop.sql`
- Create: `scripts/db/assert-whatsapp-actor-spike.sql`

- [ ] **Step 1: Create the no-op migration**

```sql
-- scripts/db/fixtures/noop.sql — a migration that does nothing; used as the
-- <migration> argument when an assertions file carries its own DDL.
SELECT 1;
```

- [ ] **Step 2: Write the spike file**

```sql
-- scripts/db/assert-whatsapp-actor-spike.sql
-- Proves the whatsapp_actor pattern inside a rolled-back transaction:
--   (1) postgres can CREATE ROLE and GRANT authenticated to it,
--   (2) a SECURITY DEFINER function owned by it is subject to RLS,
--   (3) set_config('request.jwt.claims') inside it makes auth.uid() the user,
--   (4) the work-item transition guard fires under that identity.
-- Run: scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-whatsapp-actor-spike.sql

CREATE ROLE whatsapp_actor_spike NOLOGIN NOINHERIT;
ALTER ROLE whatsapp_actor_spike INHERIT;
GRANT authenticated TO whatsapp_actor_spike;
GRANT whatsapp_actor_spike TO postgres;

SELECT set_config('x.c', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);
SELECT set_config('x.kw', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.c')::uuid AND pm.is_active
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.pm', projects.resolve_project_pm(current_setting('x.kw')::uuid)::text, true);
SELECT set_config('x.mamaila', 'dbcfb404-0753-4042-85a1-020cbfacafca', true);
SELECT set_config('x.pm_m', projects.resolve_project_pm(current_setting('x.mamaila')::uuid)::text, true);

DO $$ BEGIN
  IF current_setting('x.kw', true) IS NULL OR current_setting('x.pm', true) IS NULL
     OR current_setting('x.pm_m', true) IS NULL THEN
    RAISE EXCEPTION 'fixture precondition: KINGSWALK/MAMAILA or their PMs not resolvable';
  END IF;
END $$;

-- Item A on KINGSWALK: the contractor holds the ball, the PM signs off.
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA spike A',
         current_setting('x.c')::uuid, current_setting('x.pm')::uuid, current_setting('x.pm')::uuid,
         'open', current_date + 3
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid
  RETURNING id)
SELECT set_config('x.a', (SELECT id::text FROM ins), true);

-- Item B on MAMAILA: the contractor has no access at all.
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA spike B',
         current_setting('x.pm_m')::uuid, current_setting('x.pm_m')::uuid, current_setting('x.pm_m')::uuid,
         'open', current_date + 3
    FROM projects.projects p WHERE p.id = current_setting('x.mamaila')::uuid
  RETURNING id)
SELECT set_config('x.b', (SELECT id::text FROM ins), true);

CREATE FUNCTION public.wa_spike_advance(p_user uuid, p_item uuid, p_to text)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  UPDATE projects.work_items SET status = p_to WHERE id = p_item;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
EXCEPTION WHEN OTHERS THEN
  RETURN -1;
END $fn$;
ALTER FUNCTION public.wa_spike_advance(uuid,uuid,text) OWNER TO whatsapp_actor_spike;

CREATE TEMP TABLE _r (k text PRIMARY KEY, v text);
INSERT INTO _r VALUES
  ('owner',       (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.wa_spike_advance(uuid,uuid,text)'::regprocedure)),
  ('b_by_c',      public.wa_spike_advance(current_setting('x.c')::uuid,  current_setting('x.b')::uuid, 'answered')::text),
  ('a_close_by_c',public.wa_spike_advance(current_setting('x.c')::uuid,  current_setting('x.a')::uuid, 'closed')::text),
  ('a_ans_by_c',  public.wa_spike_advance(current_setting('x.c')::uuid,  current_setting('x.a')::uuid, 'answered')::text),
  ('a_close_by_pm',public.wa_spike_advance(current_setting('x.pm')::uuid, current_setting('x.a')::uuid, 'closed')::text);
INSERT INTO _r VALUES
  ('a_status', (SELECT status FROM projects.work_items WHERE id = current_setting('x.a')::uuid)),
  ('ev_actor', (SELECT string_agg(coalesce(actor_id::text,'NULL') || ':' || verb, ',' ORDER BY seq)
                  FROM projects.work_item_events WHERE work_item_id = current_setting('x.a')::uuid));

SELECT * FROM (VALUES
  ('function is owned by the spike role',               (SELECT v FROM _r WHERE k='owner') = 'whatsapp_actor_spike'),
  ('RLS applies: contractor sees 0 rows of a MAMAILA item', (SELECT v FROM _r WHERE k='b_by_c') = '0'),
  ('guard applies: contractor cannot close (raises)',   (SELECT v FROM _r WHERE k='a_close_by_c') = '-1'),
  ('holder may move open -> answered',                  (SELECT v FROM _r WHERE k='a_ans_by_c') = '1'),
  ('gatekeeper may close',                              (SELECT v FROM _r WHERE k='a_close_by_pm') = '1'),
  ('final status is closed',                            (SELECT v FROM _r WHERE k='a_status') = 'closed'),
  ('events carry the acting user, not NULL',            (SELECT v FROM _r WHERE k='ev_actor')
                                                           LIKE '%' || current_setting('x.c') || ':status_changed%'
                                                       AND (SELECT v FROM _r WHERE k='ev_actor')
                                                           LIKE '%' || current_setting('x.pm') || ':closed%')
) AS t("check", ok);
```

- [ ] **Step 3: Run it**

Run: `scripts/db/dry-run-migration.sh scripts/db/fixtures/noop.sql scripts/db/assert-whatsapp-actor-spike.sql`
Expected: seven rows, all `ok = true`.

- [ ] **Step 4: Mutation — prove RLS, not luck, produced row 2**

Temporarily change `OWNER TO whatsapp_actor_spike` to `OWNER TO postgres` and re-run.
Expected: row 2 (`RLS applies`) goes **false** (`b_by_c = 1`, because postgres bypasses RLS). Revert the change.

- [ ] **Step 5: If Step 3 fails on `GRANT authenticated`** (insufficient privilege, since `postgres` lacks ADMIN on `authenticated`):

**STOP.** Do not continue to Task 4. Report the error text to the owner. The fallback design keeps the `wa_*` functions postgres-owned. Each then asserts access explicitly with `projects.user_can_read_work_item(p_item)` plus the `work_items_update_gate` predicate, and ships with a *differential* assertion: for every fixture (user, item) pair, a real `SET LOCAL ROLE authenticated` UPDATE in a savepoint must succeed if and only if the `wa_*` call succeeds. That is a design change and needs sign-off.

- [ ] **Step 6: Commit**

```bash
git add scripts/db/fixtures/noop.sql scripts/db/assert-whatsapp-actor-spike.sql
git commit -m "test(whatsapp): spike proving the whatsapp_actor RLS pattern

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Shared core — constants, phone, keywords, payloads

**Files:**
- Create: `packages/shared/src/whatsapp/core.ts`
- Create: `packages/shared/src/whatsapp/core.test.ts`
- Create: `packages/shared/src/whatsapp/index.ts`
- Modify: `packages/shared/src/index.ts` (append an export)

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/whatsapp/core.test.ts
import { describe, it, expect } from 'vitest'
import {
  normalisePhone, fromMetaWaId, maskPhone, classifyKeyword,
  encodePayload, decodePayload, placeholderEmailFor, isPlaceholderEmail,
} from './core'

const U = '3f1c2e4a-9b7d-4c1e-8a2b-1234567890ab'

describe('normalisePhone', () => {
  it.each([
    ['082 123 4567', '+27821234567'],
    ['0821234567', '+27821234567'],
    ['27821234567', '+27821234567'],
    ['+27 (82) 123-4567', '+27821234567'],
    ['0027821234567', '+27821234567'],
    ['+447700900123', '+447700900123'],
  ])('%s -> %s', (input, out) => expect(normalisePhone(input)).toBe(out))

  it.each(['', 'abc', '082123456', '+2782123456789', '+0821234567', '12345'])(
    'rejects %s', (input) => expect(normalisePhone(input)).toBeNull())
})

describe('fromMetaWaId', () => {
  it('prefixes + to Meta digits', () => expect(fromMetaWaId('27821234567')).toBe('+27821234567'))
  it('accepts non-ZA ids', () => expect(fromMetaWaId('447700900123')).toBe('+447700900123'))
  it('rejects junk', () => expect(fromMetaWaId('27abc')).toBeNull())
})

describe('maskPhone', () => {
  it('keeps country, prefix and last four', () => expect(maskPhone('+27821234567')).toBe('+27 82 *** 4567'))
})

describe('classifyKeyword', () => {
  it.each(['STOP', 'stop', ' Stop. ', 'unsubscribe', 'OPT OUT', 'stopp'])('%s is stop', (t) =>
    expect(classifyKeyword(t)).toBe('stop'))
  it.each(['START', 'start', 'Opt in'])('%s is start', (t) => expect(classifyKeyword(t)).toBe('start'))
  it.each(['stop the pump on DB3', 'ok', ''])('%s is neither', (t) => expect(classifyKeyword(t)).toBeNull())
})

describe('payload codec', () => {
  it.each([
    { kind: 'ack', itemId: U },
    { kind: 'done', itemId: U },
    { kind: 'optin', answer: 'yes', linkId: U },
    { kind: 'optin', answer: 'no', linkId: U },
    { kind: 'wrong', target: 'note', id: U },
    { kind: 'wrong', target: 'attachment', id: U },
    { kind: 'pick', itemId: U },
  ] as const)('round-trips %o', (p) => expect(decodePayload(encodePayload(p))).toEqual(p))

  it.each([null, undefined, '', 'ack', 'ack:not-a-uuid', 'nuke:' + U, 'optin:maybe:' + U, 'wrong:file:' + U])(
    'rejects %s', (s) => expect(decodePayload(s as string)).toBeNull())
})

describe('placeholder email', () => {
  it('is on the no-MX domain and recognised', () => {
    const e = placeholderEmailFor(U)
    expect(e).toBe(`wa-${U}@wa.e-site.live`)
    expect(isPlaceholderEmail(e)).toBe(true)
    expect(isPlaceholderEmail('WA-X@WA.E-SITE.LIVE')).toBe(true)
    expect(isPlaceholderEmail('arno@wmeng.co.za')).toBe(false)
    expect(isPlaceholderEmail(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- src/whatsapp/core.test.ts`
Expected: FAIL, `Cannot find module './core'`.

- [ ] **Step 3: Implement (first half of core.ts)**

```ts
// packages/shared/src/whatsapp/core.ts
//
// CANONICAL SOURCE. `node packages/shared/scripts/sync-whatsapp-core.mjs` copies
// this file byte-for-byte (behind a generated header) to
// apps/edge-functions/supabase/functions/_shared/whatsapp/core.ts, and
// apps/web/src/lib/whatsapp/core-sync.contract.test.ts fails if they differ.
// It must stay import-free so Deno and Node load it identically.

export const CONSENT_TEXT_VERSION = '2026-09-28.1'
export const PLACEHOLDER_EMAIL_DOMAIN = 'wa.e-site.live'
export const DAILY_ITEM_CAP = 8
export const ACTIVE_ITEM_TTL_MS = 24 * 60 * 60 * 1000
export const WRONG_ITEM_WINDOW_MS = 15 * 60 * 1000
export const PENDING_DONE_TTL_MS = 30 * 60 * 1000
export const BURST_WINDOW_MS = 60 * 1000
export const OTP_TTL_MS = 10 * 60 * 1000
export const OTP_MAX_ATTEMPTS = 5
export const OTP_MAX_SENDS_PER_HOUR = 3
export const SAST_OFFSET_MINUTES = 120
export const OPEN_ITEMS_LIST_MAX = 10

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function placeholderEmailFor(userId: string): string {
  return `wa-${userId}@${PLACEHOLDER_EMAIL_DOMAIN}`
}

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.toLowerCase().endsWith('@' + PLACEHOLDER_EMAIL_DOMAIN)
}

/** Free text a person typed → E.164, defaulting to South Africa. Null if not a plausible number. */
export function normalisePhone(input: string): string | null {
  if (typeof input !== 'string') return null
  let s = input.trim().replace(/[\s\-().]/g, '')
  if (s.startsWith('00')) s = '+' + s.slice(2)
  if (/^0\d{9}$/.test(s)) s = '+27' + s.slice(1)
  else if (/^27\d{9}$/.test(s)) s = '+' + s
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null
  if (s.startsWith('+27') && s.length !== 12) return null
  return s
}

/** Meta's `from` / `wa_id` is digits without a plus. */
export function fromMetaWaId(waId: string): string | null {
  if (typeof waId !== 'string' || !/^[1-9]\d{7,14}$/.test(waId)) return null
  return '+' + waId
}

export function maskPhone(e164: string): string {
  return `${e164.slice(0, 3)} ${e164.slice(3, 5)} *** ${e164.slice(-4)}`
}

export type Keyword = 'stop' | 'start' | null
const STOP_WORDS = new Set(['STOP', 'STOPP', 'UNSUBSCRIBE', 'OPT OUT', 'OPTOUT', 'STOP ALL'])
const START_WORDS = new Set(['START', 'UNSTOP', 'OPT IN', 'OPTIN'])

export function classifyKeyword(text: string): Keyword {
  const t = (text ?? '').toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim()
  if (STOP_WORDS.has(t)) return 'stop'
  if (START_WORDS.has(t)) return 'start'
  return null
}

export type Payload =
  | { kind: 'ack'; itemId: string }
  | { kind: 'done'; itemId: string }
  | { kind: 'optin'; answer: 'yes' | 'no'; linkId: string }
  | { kind: 'wrong'; target: 'note' | 'attachment'; id: string }
  | { kind: 'pick'; itemId: string }

export function encodePayload(p: Payload): string {
  switch (p.kind) {
    case 'ack':
    case 'done':
    case 'pick':
      return `${p.kind}:${p.itemId}`
    case 'optin':
      return `optin:${p.answer}:${p.linkId}`
    case 'wrong':
      return `wrong:${p.target}:${p.id}`
  }
}

export function decodePayload(s: string | null | undefined): Payload | null {
  if (typeof s !== 'string') return null
  const parts = s.split(':')
  if (parts.length === 2) {
    const [kind, id] = parts
    if (!UUID.test(id)) return null
    if (kind === 'ack' || kind === 'done' || kind === 'pick') return { kind, itemId: id }
    return null
  }
  if (parts.length === 3) {
    const [kind, mid, id] = parts
    if (!UUID.test(id)) return null
    if (kind === 'optin' && (mid === 'yes' || mid === 'no')) return { kind, answer: mid, linkId: id }
    if (kind === 'wrong' && (mid === 'note' || mid === 'attachment')) return { kind, target: mid, id }
  }
  return null
}
```

```ts
// packages/shared/src/whatsapp/index.ts
export * from './core'
```

Append to `packages/shared/src/index.ts`:

```ts
// WhatsApp reply-to-act — pure core shared with the edge (byte-copied).
export * from './whatsapp'
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- src/whatsapp/core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/whatsapp packages/shared/src/index.ts
git commit -m "feat(whatsapp): shared core — phone, keywords, payload codec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Shared core — target resolution, quiet hours, done routing

**Files:**
- Modify: `packages/shared/src/whatsapp/core.ts` (append)
- Modify: `packages/shared/src/whatsapp/core.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
// append to packages/shared/src/whatsapp/core.test.ts
import { resolveTarget, nextSendTime, sastDate, isWithin, doneRouteFor } from './core'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2026-10-01T10:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

describe('resolveTarget', () => {
  const base = { payloadItemId: null, contextItemId: null, pendingDoneItemId: null, pendingDoneAt: null,
                 pendingDoneWants: 'photo' as const,
                 activeItemId: null, activeItemAt: null, isImage: false, now: NOW }
  it('a pending ANSWER captures the next TEXT, not a photo', () => {
    const p = { ...base, pendingDoneItemId: A, pendingDoneAt: ago(60_000), pendingDoneWants: 'answer' as const }
    expect(resolveTarget({ ...p, isImage: false })).toEqual({ kind: 'item', itemId: A, via: 'pending_done' })
    expect(resolveTarget({ ...p, isImage: true })).toEqual({ kind: 'pick' })
  })
  it('button wins over everything', () =>
    expect(resolveTarget({ ...base, payloadItemId: A, contextItemId: B, activeItemId: B, activeItemAt: ago(1000) }))
      .toEqual({ kind: 'item', itemId: A, via: 'button' }))
  it('swipe-reply context wins over active item', () =>
    expect(resolveTarget({ ...base, contextItemId: A, activeItemId: B, activeItemAt: ago(1000) }))
      .toEqual({ kind: 'item', itemId: A, via: 'context' }))
  it('pending done captures the next PHOTO', () =>
    expect(resolveTarget({ ...base, isImage: true, pendingDoneItemId: A, pendingDoneAt: ago(60_000), activeItemId: B, activeItemAt: ago(1000) }))
      .toEqual({ kind: 'item', itemId: A, via: 'pending_done' }))
  it('pending done does NOT capture text', () =>
    expect(resolveTarget({ ...base, isImage: false, pendingDoneItemId: A, pendingDoneAt: ago(60_000), activeItemId: B, activeItemAt: ago(1000) }))
      .toEqual({ kind: 'item', itemId: B, via: 'active' }))
  it('expired pending done is ignored', () =>
    expect(resolveTarget({ ...base, isImage: true, pendingDoneItemId: A, pendingDoneAt: ago(31 * 60_000) }))
      .toEqual({ kind: 'pick' }))
  it('active item within 24h is used', () =>
    expect(resolveTarget({ ...base, activeItemId: B, activeItemAt: ago(23 * 3600_000) }))
      .toEqual({ kind: 'item', itemId: B, via: 'active' }))
  it('stale active item forces a pick, never a guess', () =>
    expect(resolveTarget({ ...base, activeItemId: B, activeItemAt: ago(25 * 3600_000) }))
      .toEqual({ kind: 'pick' }))
  it('nothing known forces a pick', () => expect(resolveTarget(base)).toEqual({ kind: 'pick' }))
})

describe('nextSendTime (SAST = UTC+2, overnight window 18:00-06:30)', () => {
  it.each([
    ['2026-10-01T17:00:00Z', '2026-10-02T04:30:00.000Z'], // 19:00 SAST -> next 06:30
    ['2026-10-01T21:59:00Z', '2026-10-02T04:30:00.000Z'], // 23:59 SAST
    ['2026-10-01T22:30:00Z', '2026-10-02T04:30:00.000Z'], // 00:30 SAST next day
    ['2026-10-01T03:00:00Z', '2026-10-01T04:30:00.000Z'], // 05:00 SAST same day
    ['2026-10-01T04:30:00Z', '2026-10-01T04:30:00.000Z'], // exactly 06:30 -> send now
    ['2026-10-01T08:00:00Z', '2026-10-01T08:00:00.000Z'], // 10:00 -> send now
    ['2026-10-01T15:59:00Z', '2026-10-01T15:59:00.000Z'], // 17:59 -> send now
  ])('%s -> %s', (now, out) =>
    expect(nextSendTime(new Date(now), '18:00:00', '06:30:00').toISOString()).toBe(out))

  it('daytime window 12:00-13:00', () =>
    expect(nextSendTime(new Date('2026-10-01T10:30:00Z'), '12:00', '13:00').toISOString())
      .toBe('2026-10-01T11:00:00.000Z'))
  it('equal start/end means no quiet hours', () =>
    expect(nextSendTime(NOW, '00:00', '00:00')).toEqual(NOW))
})

describe('sastDate / isWithin', () => {
  it('rolls the date at SAST midnight, not UTC', () => {
    expect(sastDate(new Date('2026-10-01T21:59:00Z'))).toBe('2026-10-01')
    expect(sastDate(new Date('2026-10-01T22:00:00Z'))).toBe('2026-10-02')
  })
  it('isWithin', () => {
    expect(isWithin(ago(1000), NOW, 2000)).toBe(true)
    expect(isWithin(ago(3000), NOW, 2000)).toBe(false)
    expect(isWithin(null, NOW, 2000)).toBe(false)
  })
})

describe('doneRouteFor', () => {
  it.each([
    ['task', 'manual', 'spine'],
    ['snag', 'manual', 'spine'],
    ['snag', 'split', 'spine'],
    ['snag', 'mirror', 'snag'],
    ['rfi', 'mirror', 'rfi'],
    ['inspection', 'mirror', 'link_out'],
    ['qc_defect', 'mirror', 'link_out'],
  ])('%s/%s -> %s', (t, o, r) => expect(doneRouteFor(t, o)).toBe(r))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @esite/shared test -- src/whatsapp/core.test.ts`
Expected: FAIL, `resolveTarget is not a function` (or the import fails).

- [ ] **Step 3: Append the implementation to core.ts**

```ts
// append to packages/shared/src/whatsapp/core.ts

export function isWithin(sinceIso: string | null | undefined, now: Date, ms: number): boolean {
  if (!sinceIso) return false
  const t = Date.parse(sinceIso)
  return Number.isFinite(t) && now.getTime() - t <= ms
}

export type Target =
  | { kind: 'item'; itemId: string; via: 'button' | 'context' | 'pending_done' | 'active' }
  | { kind: 'pick' }

export interface TargetInput {
  payloadItemId: string | null
  contextItemId: string | null
  pendingDoneItemId: string | null
  pendingDoneAt: string | null
  /** What the pending Mark done is waiting for: a close-out photo (snag) or an answer (RFI). */
  pendingDoneWants: 'photo' | 'answer' | null
  activeItemId: string | null
  activeItemAt: string | null
  isImage: boolean
  now: Date
}

/** Strictest rule first. Never guesses: with nothing current, the user picks. */
export function resolveTarget(i: TargetInput): Target {
  if (i.payloadItemId) return { kind: 'item', itemId: i.payloadItemId, via: 'button' }
  if (i.contextItemId) return { kind: 'item', itemId: i.contextItemId, via: 'context' }
  const wantsThis = i.pendingDoneWants === 'photo' ? i.isImage : i.pendingDoneWants === 'answer' ? !i.isImage : false
  if (wantsThis && i.pendingDoneItemId && isWithin(i.pendingDoneAt, i.now, PENDING_DONE_TTL_MS)) {
    return { kind: 'item', itemId: i.pendingDoneItemId, via: 'pending_done' }
  }
  if (i.activeItemId && isWithin(i.activeItemAt, i.now, ACTIVE_ITEM_TTL_MS)) {
    return { kind: 'item', itemId: i.activeItemId, via: 'active' }
  }
  return { kind: 'pick' }
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}

function sastClock(now: Date): Date {
  return new Date(now.getTime() + SAST_OFFSET_MINUTES * 60_000)
}

/** yyyy-mm-dd in Africa/Johannesburg (fixed UTC+2, no DST). */
export function sastDate(now: Date): string {
  return sastClock(now).toISOString().slice(0, 10)
}

/** Earliest instant >= now outside [quietStart, quietEnd) SAST. Handles overnight windows. */
export function nextSendTime(now: Date, quietStart: string, quietEnd: string): Date {
  const s = minutesOf(quietStart)
  const e = minutesOf(quietEnd)
  if (s === e) return now
  const c = sastClock(now)
  const m = c.getUTCHours() * 60 + c.getUTCMinutes()
  const quiet = s > e ? m >= s || m < e : m >= s && m < e
  if (!quiet) return now
  const midnight = Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate())
  const addDay = s > e && m >= s ? 1 : 0
  return new Date(midnight + addDay * 86_400_000 + e * 60_000 - SAST_OFFSET_MINUTES * 60_000)
}

export type DoneRoute = 'spine' | 'snag' | 'rfi' | 'link_out'

/** Where "Mark done" must act. Mirrors take status FROM their source (#193 map_source_status). */
export function doneRouteFor(itemType: string, origin: string): DoneRoute {
  if (origin !== 'mirror') return 'spine'
  if (itemType === 'snag') return 'snag'
  if (itemType === 'rfi') return 'rfi'
  return 'link_out'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @esite/shared test -- src/whatsapp/core.test.ts`
Expected: PASS (every describe block).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/whatsapp
git commit -m "feat(whatsapp): target resolution, SAST quiet hours, done routing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Core sync script + byte-identity contract

**Files:**
- Create: `packages/shared/scripts/sync-whatsapp-core.mjs`
- Modify: `packages/shared/package.json` (add a script)
- Create (generated): `apps/edge-functions/supabase/functions/_shared/whatsapp/core.ts`
- Create: `apps/web/src/lib/whatsapp/core-sync.contract.test.ts`

- [ ] **Step 1: Write the failing contract test**

```ts
// apps/web/src/lib/whatsapp/core-sync.contract.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../../../..')
const CANON = resolve(ROOT, 'packages/shared/src/whatsapp/core.ts')
const EDGE = resolve(ROOT, 'apps/edge-functions/supabase/functions/_shared/whatsapp/core.ts')
export const GENERATED_HEADER =
  '// GENERATED by packages/shared/scripts/sync-whatsapp-core.mjs — DO NOT EDIT.\n' +
  '// Edit packages/shared/src/whatsapp/core.ts and re-run the script.\n'

describe('whatsapp core sync', () => {
  it('the edge copy is the canonical file behind the generated header, byte for byte', () => {
    const canon = readFileSync(CANON, 'utf8')
    const edge = readFileSync(EDGE, 'utf8')
    expect(edge).toBe(GENERATED_HEADER + canon)
  })
  it('the canonical file has no imports (Deno and Node must load it identically)', () => {
    expect(readFileSync(CANON, 'utf8')).not.toMatch(/^\s*import\s/m)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- src/lib/whatsapp/core-sync.contract.test.ts`
Expected: FAIL, `ENOENT … _shared/whatsapp/core.ts`.

- [ ] **Step 3: Write the sync script**

```js
// packages/shared/scripts/sync-whatsapp-core.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const src = resolve(root, 'packages/shared/src/whatsapp/core.ts')
const dst = resolve(root, 'apps/edge-functions/supabase/functions/_shared/whatsapp/core.ts')
const HEADER =
  '// GENERATED by packages/shared/scripts/sync-whatsapp-core.mjs — DO NOT EDIT.\n' +
  '// Edit packages/shared/src/whatsapp/core.ts and re-run the script.\n'

mkdirSync(dirname(dst), { recursive: true })
writeFileSync(dst, HEADER + readFileSync(src, 'utf8'))
console.log(`synced ${src} -> ${dst}`)
```

Add to the `scripts` block of `packages/shared/package.json`:

```json
"sync:whatsapp": "node scripts/sync-whatsapp-core.mjs"
```

- [ ] **Step 4: Generate the copy and run the test**

Run: `pnpm --filter @esite/shared sync:whatsapp && pnpm --filter web test -- src/lib/whatsapp/core-sync.contract.test.ts`
Expected: `synced …`, then PASS.

- [ ] **Step 5: Mutation**

Add a blank line to the edge copy and re-run the test.
Expected: FAIL. Then re-run `sync:whatsapp` and confirm the test passes.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/scripts packages/shared/package.json apps/edge-functions/supabase/functions/_shared/whatsapp/core.ts apps/web/src/lib/whatsapp/core-sync.contract.test.ts
git commit -m "build(whatsapp): byte-copy shared core to the edge, contract-pinned

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Migration part A — schema, tables, grants, notes/attachments, verb, toggle

**Files:**
- Create: `apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql`
- Create: `scripts/db/assert-whatsapp-schema.sql`

- [ ] **Step 1: Write the failing assertions**

```sql
-- scripts/db/assert-whatsapp-schema.sql
-- Structure and grants of 00207. Run:
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-schema.sql
SELECT * FROM (VALUES
  ('schema whatsapp exists',            EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'whatsapp')),
  ('phone_links exists',                to_regclass('whatsapp.phone_links') IS NOT NULL),
  ('outbox exists',                     to_regclass('whatsapp.outbox') IS NOT NULL),
  ('inbound exists',                    to_regclass('whatsapp.inbound') IS NOT NULL),
  ('settings has exactly one row, sending OFF',
     (SELECT count(*) = 1 AND bool_and(NOT sending_enabled) FROM whatsapp.settings)),
  ('notes table exists',                to_regclass('projects.work_item_notes') IS NOT NULL),
  ('attachments table exists',          to_regclass('projects.work_item_attachments') IS NOT NULL),
  ('notify_whatsapp defaults false everywhere',
     (SELECT bool_and(NOT notify_whatsapp) FROM projects.project_settings)),
  ('verb CHECK admits acknowledged',
     (SELECT pg_get_constraintdef(c.oid) LIKE '%acknowledged%' FROM pg_constraint c
       WHERE c.conrelid = 'projects.work_item_events'::regclass AND c.conname = 'work_item_events_verb_check')),
  ('exactly one verb CHECK remains',
     (SELECT count(*) = 1 FROM pg_constraint c WHERE c.conrelid = 'projects.work_item_events'::regclass
       AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%verb%')),
  ('anon has no SELECT on phone_links', NOT has_table_privilege('anon', 'whatsapp.phone_links', 'SELECT')),
  ('authenticated cannot INSERT phone_links', NOT has_table_privilege('authenticated', 'whatsapp.phone_links', 'INSERT')),
  ('authenticated cannot read otp_hash',  NOT has_column_privilege('authenticated', 'whatsapp.phone_links', 'otp_hash', 'SELECT')),
  ('authenticated can read own phone column', has_column_privilege('authenticated', 'whatsapp.phone_links', 'phone_e164', 'SELECT')),
  ('authenticated cannot INSERT notes',   NOT has_table_privilege('authenticated', 'projects.work_item_notes', 'INSERT')),
  ('authenticated cannot UPDATE inbound', NOT has_table_privilege('authenticated', 'whatsapp.inbound', 'UPDATE')),
  ('RLS on every whatsapp table',
     (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'whatsapp' AND c.relkind = 'r')),
  ('attachment bucket is private',
     EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'work-item-attachments' AND public = false)),
  ('inbound raw is immutable', (
     SELECT prosrc LIKE '%raw%' FROM pg_proc WHERE proname = 'inbound_immutable' AND pronamespace = 'whatsapp'::regnamespace))
) AS t("check", ok);
```

- [ ] **Step 2: Run to verify it fails**

Create an empty migration file first (`touch apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql`), then run:

`scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-schema.sql`

Expected: the file aborts (`to_regclass … whatsapp.settings does not exist`) or several rows are false.

- [ ] **Step 3: Write part A of the migration**

```sql
-- 00207_whatsapp_reply_to_act.sql
--
-- WhatsApp reply-to-act (spec docs/superpowers/specs/2026-09-28-whatsapp-reply-to-act-design.md,
-- §9 amendments win). Part A: schema, tables, grants, notes/attachments, verb, toggle.
-- Part B (Task 6): the whatsapp_actor role and the wa_* functions.
-- Part C (Task 7): outbox enqueue, due sweep, claim/receive helpers, cron.
--
-- ⚠ This migration CREATES a schema. After applying, PATCH PostgREST db_schema to
-- include `whatsapp` (docs/whatsapp-runbook.md §2), or REST returns PGRST002.
--
-- @verify:begin
-- (Task 8 writes the full block; keep this marker pair at the top of the file.)
-- @verify:end

CREATE SCHEMA IF NOT EXISTS whatsapp;
REVOKE ALL ON SCHEMA whatsapp FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA whatsapp TO authenticated, service_role;

-- ── platform settings (single row) ─────────────────────────────────────────
CREATE TABLE whatsapp.settings (
  id                    boolean PRIMARY KEY DEFAULT true CHECK (id),
  sending_enabled       boolean NOT NULL DEFAULT false,
  alert_email           text,
  last_policy_error_at  timestamptz,
  last_policy_error     text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
INSERT INTO whatsapp.settings (id) VALUES (true);

CREATE TABLE whatsapp.templates (
  name        text PRIMARY KEY,
  language    text NOT NULL DEFAULT 'en',
  category    text NOT NULL CHECK (category IN ('AUTHENTICATION','UTILITY')),
  status      text NOT NULL DEFAULT 'pending',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO whatsapp.templates (name, category) VALUES
  ('esite_otp','AUTHENTICATION'), ('esite_optin','UTILITY'),
  ('esite_item_assigned','UTILITY'), ('esite_item_due_tomorrow','UTILITY'),
  ('esite_item_overdue','UTILITY'), ('esite_items_waiting','UTILITY');

-- ── phone links ────────────────────────────────────────────────────────────
CREATE TABLE whatsapp.phone_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  phone_e164            text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status                text NOT NULL CHECK (status IN
                          ('pending_otp','pending_optin','active','undeliverable','opted_out')),
  verified_at           timestamptz,
  consent_at            timestamptz,
  consent_text_version  text,
  invited_by            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invited_project_id    uuid REFERENCES projects.projects(id) ON DELETE SET NULL,
  otp_hash              text,
  otp_expires_at        timestamptz,
  otp_attempts          int NOT NULL DEFAULT 0,
  otp_window_start      timestamptz,
  otp_window_count      int NOT NULL DEFAULT 0,
  quiet_start           time NOT NULL DEFAULT '18:00',
  quiet_end             time NOT NULL DEFAULT '06:30',
  active_item_id        uuid REFERENCES projects.work_items(id) ON DELETE SET NULL,
  active_item_at        timestamptz,
  pending_done_item_id  uuid REFERENCES projects.work_items(id) ON DELETE SET NULL,
  pending_done_at       timestamptz,
  pending_done_wants    text CHECK (pending_done_wants IN ('photo','answer')),
  pending_inbound_id    uuid,
  last_confirm_item_id  uuid,
  last_confirm_at       timestamptz,
  undeliverable_reason  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'active' OR consent_at IS NOT NULL)
);
CREATE UNIQUE INDEX phone_links_live_phone_uidx ON whatsapp.phone_links (phone_e164)
  WHERE status IN ('pending_optin','active');
CREATE UNIQUE INDEX phone_links_live_user_uidx ON whatsapp.phone_links (user_id)
  WHERE status IN ('pending_otp','pending_optin','active');

-- ── outbox ─────────────────────────────────────────────────────────────────
CREATE TABLE whatsapp.outbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_item_id     uuid REFERENCES projects.work_items(id) ON DELETE CASCADE,
  link_id          uuid REFERENCES whatsapp.phone_links(id) ON DELETE CASCADE,
  trigger          text NOT NULL CHECK (trigger IN
                     ('assigned','due_tomorrow','overdue','otp','optin','fold')),
  idempotency_key  text NOT NULL UNIQUE,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN
                     ('queued','sending','retry','held_quiet','sent','delivered','read','failed','suppressed')),
  send_after       timestamptz NOT NULL DEFAULT now(),
  attempts         int NOT NULL DEFAULT 0,
  meta_message_id  text UNIQUE,
  error_code       int,
  error_text       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_due_idx ON whatsapp.outbox (send_after) WHERE status IN ('queued','retry','held_quiet');
CREATE INDEX outbox_item_idx ON whatsapp.outbox (work_item_id, created_at);
CREATE INDEX outbox_user_day_idx ON whatsapp.outbox (user_id, sent_at);

-- ── inbound (append-only evidence log) ─────────────────────────────────────
CREATE TABLE whatsapp.inbound (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_message_id     text NOT NULL UNIQUE,
  from_e164           text NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  raw                 jsonb NOT NULL,
  kind                text NOT NULL,
  context_message_id  text,
  resolved_user_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_item_id    uuid REFERENCES projects.work_items(id) ON DELETE SET NULL,
  outcome             text NOT NULL DEFAULT 'pending' CHECK (outcome IN
                        ('pending','applied','refused','unmatched','unknown_sender')),
  outcome_reason      text,
  attempts            int NOT NULL DEFAULT 0,
  claimed_at          timestamptz,
  processed_at        timestamptz
);
CREATE INDEX inbound_pending_idx ON whatsapp.inbound (received_at) WHERE outcome = 'pending';
CREATE INDEX inbound_item_idx ON whatsapp.inbound (resolved_item_id, received_at);

CREATE FUNCTION whatsapp.inbound_immutable() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.raw IS DISTINCT FROM OLD.raw OR NEW.meta_message_id IS DISTINCT FROM OLD.meta_message_id
     OR NEW.from_e164 IS DISTINCT FROM OLD.from_e164 OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'whatsapp.inbound is append-only: raw, meta_message_id, from_e164 and received_at never change';
  END IF;
  RETURN NEW;
END $fn$;
CREATE TRIGGER inbound_immutable_trg BEFORE UPDATE ON whatsapp.inbound
  FOR EACH ROW EXECUTE FUNCTION whatsapp.inbound_immutable();
REVOKE ALL ON FUNCTION whatsapp.inbound_immutable() FROM PUBLIC, anon;

CREATE TABLE whatsapp.unknown_senders (
  phone_e164       text PRIMARY KEY,
  last_replied_at  timestamptz NOT NULL
);

-- ── notes + attachments on work items ──────────────────────────────────────
CREATE TABLE projects.work_item_notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id     uuid NOT NULL REFERENCES projects.work_items(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL,
  organisation_id  uuid NOT NULL,
  author_id        uuid NOT NULL REFERENCES public.profiles(id),
  body             text NOT NULL CHECK (length(body) <= 4096),
  via              text NOT NULL DEFAULT 'web' CHECK (via IN ('web','whatsapp')),
  inbound_id       uuid REFERENCES whatsapp.inbound(id) ON DELETE SET NULL,
  redacted_at      timestamptz,
  redacted_by      uuid REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (redacted_at IS NOT NULL OR length(btrim(body)) > 0)
);
CREATE INDEX work_item_notes_item_idx ON projects.work_item_notes (work_item_id, created_at);

CREATE TABLE projects.work_item_attachments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id     uuid NOT NULL REFERENCES projects.work_items(id) ON DELETE CASCADE,
  project_id       uuid NOT NULL,
  organisation_id  uuid NOT NULL,
  uploaded_by      uuid NOT NULL REFERENCES public.profiles(id),
  bucket           text NOT NULL DEFAULT 'work-item-attachments'
                     CHECK (bucket IN ('work-item-attachments','snag-photos')),
  storage_path     text NOT NULL,
  mime_type        text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  role             text NOT NULL DEFAULT 'evidence' CHECK (role IN ('evidence','closeout')),
  via              text NOT NULL DEFAULT 'web' CHECK (via IN ('web','whatsapp')),
  inbound_id       uuid REFERENCES whatsapp.inbound(id) ON DELETE SET NULL,
  redacted_at      timestamptz,
  redacted_by      uuid REFERENCES public.profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- The path is bound to the item's own org/project: a client can never aim a row at another tenant's file.
  CHECK (storage_path LIKE organisation_id::text || '/' || project_id::text || '/%')
);
CREATE INDEX work_item_attachments_item_idx ON projects.work_item_attachments (work_item_id, created_at);

-- project_id / organisation_id are DERIVED from the item, never trusted from the caller.
CREATE FUNCTION projects.bind_work_item_child() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security TO 'off' AS $fn$
BEGIN
  SELECT wi.project_id, wi.organisation_id INTO NEW.project_id, NEW.organisation_id
    FROM projects.work_items wi WHERE wi.id = NEW.work_item_id;
  IF NEW.project_id IS NULL THEN RAISE EXCEPTION 'work item % not found', NEW.work_item_id; END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION projects.bind_work_item_child() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER work_item_notes_bind BEFORE INSERT ON projects.work_item_notes
  FOR EACH ROW EXECUTE FUNCTION projects.bind_work_item_child();
CREATE TRIGGER work_item_attachments_bind BEFORE INSERT ON projects.work_item_attachments
  FOR EACH ROW EXECUTE FUNCTION projects.bind_work_item_child();

ALTER TABLE projects.work_item_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.work_item_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_item_notes_select ON projects.work_item_notes FOR SELECT TO authenticated
  USING (projects.user_can_read_work_item(work_item_id));
CREATE POLICY work_item_attachments_select ON projects.work_item_attachments FOR SELECT TO authenticated
  USING (projects.user_can_read_work_item(work_item_id));
REVOKE ALL ON projects.work_item_notes, projects.work_item_attachments FROM anon, authenticated;
GRANT SELECT ON projects.work_item_notes, projects.work_item_attachments TO authenticated;
GRANT ALL ON projects.work_item_notes, projects.work_item_attachments TO service_role;

INSERT INTO storage.buckets (id, name, public) VALUES ('work-item-attachments','work-item-attachments', false)
  ON CONFLICT (id) DO NOTHING;
-- Path convention: <org>/<project>/<work_item_id>/<file>. Writes happen only through the service role.
CREATE POLICY "work item attachments readable by item readers" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'work-item-attachments'
         AND (storage.foldername(name))[3] ~ '^[0-9a-f-]{36}$'
         AND projects.user_can_read_work_item(((storage.foldername(name))[3])::uuid));

-- ── acknowledged verb ──────────────────────────────────────────────────────
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'projects.work_item_events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%verb%';
  IF c IS NULL THEN RAISE EXCEPTION 'work_item_events verb CHECK not found'; END IF;
  EXECUTE format('ALTER TABLE projects.work_item_events DROP CONSTRAINT %I', c);
END $$;
ALTER TABLE projects.work_item_events ADD CONSTRAINT work_item_events_verb_check CHECK (verb IN
  ('created','assigned','reassigned','gatekeeper_changed','status_changed','due_changed',
   'closed','voided','acknowledged'));

-- ── per-project kill switch ────────────────────────────────────────────────
ALTER TABLE projects.project_settings
  ADD COLUMN IF NOT EXISTS notify_whatsapp boolean NOT NULL DEFAULT false;

-- ── RLS + grants for the whatsapp schema ───────────────────────────────────
ALTER TABLE whatsapp.settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp.templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp.phone_links     ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp.outbox          ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp.inbound         ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp.unknown_senders ENABLE ROW LEVEL SECURITY;

CREATE POLICY phone_links_select_own ON whatsapp.phone_links FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY outbox_select ON whatsapp.outbox FOR SELECT TO authenticated
  USING (work_item_id IS NOT NULL AND projects.user_can_read_work_item(work_item_id));
CREATE POLICY inbound_select ON whatsapp.inbound FOR SELECT TO authenticated
  USING (resolved_item_id IS NOT NULL AND projects.user_can_read_work_item(resolved_item_id));

REVOKE ALL ON ALL TABLES IN SCHEMA whatsapp FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA whatsapp TO service_role;
GRANT SELECT (id, user_id, phone_e164, status, verified_at, consent_at, quiet_start, quiet_end,
              undeliverable_reason, created_at) ON whatsapp.phone_links TO authenticated;
GRANT SELECT (id, work_item_id, trigger, status, error_code, error_text, created_at, sent_at, updated_at)
  ON whatsapp.outbox TO authenticated;
GRANT SELECT (id, received_at, kind, resolved_item_id, outcome, outcome_reason)
  ON whatsapp.inbound TO authenticated;
```

- [ ] **Step 4: Run and verify it passes**

Run: `scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-schema.sql`
Expected: all rows `ok = true`.

- [ ] **Step 5: Mutation**

Change `phone_links`' column grant to include `otp_hash` and re-run.
Expected: `authenticated cannot read otp_hash` goes false. Revert.

- [ ] **Step 6: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-schema.sql
git commit -m "feat(whatsapp): 00207 part A — schema, links, outbox, inbound, notes, attachments

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Migration part B — `whatsapp_actor` and the `wa_*` functions

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql` (append)
- Create: `scripts/db/assert-whatsapp-actor.sql`

- [ ] **Step 1: Write the failing assertions**

```sql
-- scripts/db/assert-whatsapp-actor.sql
-- Acting as the user under REAL RLS. Run:
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-actor.sql
-- Fixtures: C = rbac-test contractor (KINGSWALK member only); PM = KINGSWALK's PM;
-- item A (KINGSWALK, C holds the ball); item B (MAMAILA, C has no access).

SELECT set_config('x.c', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);
SELECT set_config('x.kw', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.c')::uuid AND pm.is_active
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.pm', projects.resolve_project_pm(current_setting('x.kw')::uuid)::text, true);
SELECT set_config('x.mamaila', 'dbcfb404-0753-4042-85a1-020cbfacafca', true);
SELECT set_config('x.pm_m', projects.resolve_project_pm(current_setting('x.mamaila')::uuid)::text, true);

WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA probe A',
         current_setting('x.c')::uuid, current_setting('x.pm')::uuid, current_setting('x.pm')::uuid, 'open', current_date + 3
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid RETURNING id)
SELECT set_config('x.a', (SELECT id::text FROM ins), true);
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA probe B',
         current_setting('x.pm_m')::uuid, current_setting('x.pm_m')::uuid, current_setting('x.pm_m')::uuid, 'open', current_date + 3
    FROM projects.projects p WHERE p.id = current_setting('x.mamaila')::uuid RETURNING id)
SELECT set_config('x.b', (SELECT id::text FROM ins), true);
-- Item D on KINGSWALK: assignee == gatekeeper == PM (Mark done closes directly).
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA probe D',
         current_setting('x.pm')::uuid, current_setting('x.pm')::uuid, current_setting('x.pm')::uuid, 'triage', current_date + 3
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid RETURNING id)
SELECT set_config('x.d', (SELECT id::text FROM ins), true);

CREATE TEMP TABLE _r (k text PRIMARY KEY, v jsonb);
GRANT ALL ON _r TO service_role;
SET LOCAL ROLE service_role;   -- exactly how the edge function calls these
INSERT INTO _r VALUES
  ('ack_a_by_c',   whatsapp.wa_acknowledge(current_setting('x.c')::uuid, current_setting('x.a')::uuid)),
  ('done_b_by_c',  whatsapp.wa_mark_done(current_setting('x.c')::uuid,   current_setting('x.b')::uuid)),
  ('note_b_by_c',  whatsapp.wa_add_note(current_setting('x.c')::uuid,    current_setting('x.b')::uuid, 'sneak', NULL)),
  ('done_a_by_pm_early', whatsapp.wa_mark_done(current_setting('x.pm')::uuid, current_setting('x.a')::uuid)),
  ('done_a_by_c',  whatsapp.wa_mark_done(current_setting('x.c')::uuid,   current_setting('x.a')::uuid)),
  ('done_a_by_c2', whatsapp.wa_mark_done(current_setting('x.c')::uuid,   current_setting('x.a')::uuid)),
  ('note_a_by_c',  whatsapp.wa_add_note(current_setting('x.c')::uuid,    current_setting('x.a')::uuid, 'Cover refitted', NULL)),
  ('att_bad_path', whatsapp.wa_add_attachment(current_setting('x.c')::uuid, current_setting('x.a')::uuid,
                     'work-item-attachments', 'ffffffff-ffff-4fff-8fff-ffffffffffff/x/y.jpg', 'image/jpeg', 'evidence', NULL)),
  ('done_a_by_pm', whatsapp.wa_mark_done(current_setting('x.pm')::uuid,  current_setting('x.a')::uuid)),
  ('done_d_by_pm', whatsapp.wa_mark_done(current_setting('x.pm')::uuid,  current_setting('x.d')::uuid)),
  ('open_c',       whatsapp.wa_open_items(current_setting('x.c')::uuid));
RESET ROLE;

-- Redaction: the author may, within 15 minutes; nobody else may.
SELECT set_config('x.note', (SELECT v->>'id' FROM _r WHERE k = 'note_a_by_c'), true);
SET LOCAL ROLE service_role;
INSERT INTO _r VALUES
  ('redact_by_pm', whatsapp.wa_redact(current_setting('x.pm')::uuid, 'note', current_setting('x.note')::uuid)),
  ('redact_by_c',  whatsapp.wa_redact(current_setting('x.c')::uuid,  'note', current_setting('x.note')::uuid));
RESET ROLE;

-- Removal from the project stops WhatsApp actions at once (stricter than the web on purpose: spec §3.3).
UPDATE projects.project_members SET is_active = false
 WHERE user_id = current_setting('x.c')::uuid AND project_id = current_setting('x.kw')::uuid;
SET LOCAL ROLE service_role;
INSERT INTO _r VALUES
  ('note_after_removal', whatsapp.wa_add_note(current_setting('x.c')::uuid, current_setting('x.a')::uuid, 'after removal', NULL));
RESET ROLE;

SELECT * FROM (VALUES
  ('wa_mark_done is owned by whatsapp_actor',
     (SELECT pg_get_userbyid(proowner) = 'whatsapp_actor' FROM pg_proc WHERE oid = 'whatsapp.wa_mark_done(uuid,uuid)'::regprocedure)),
  ('whatsapp_actor cannot bypass RLS, is not super, cannot log in',
     (SELECT NOT rolbypassrls AND NOT rolsuper AND NOT rolcanlogin FROM pg_roles WHERE rolname = 'whatsapp_actor')),
  ('authenticated cannot execute wa_mark_done', NOT has_function_privilege('authenticated', 'whatsapp.wa_mark_done(uuid,uuid)', 'EXECUTE')),
  ('anon cannot execute wa_mark_done',          NOT has_function_privilege('anon', 'whatsapp.wa_mark_done(uuid,uuid)', 'EXECUTE')),
  ('authenticated cannot execute act_as',       NOT has_function_privilege('authenticated', 'whatsapp.act_as(uuid)', 'EXECUTE')),
  ('service_role can execute wa_mark_done',     has_function_privilege('service_role', 'whatsapp.wa_mark_done(uuid,uuid)', 'EXECUTE')),
  ('ack on own item ok',                        (SELECT v->>'code' FROM _r WHERE k = 'ack_a_by_c') = 'ok'),
  ('RLS hides a MAMAILA item from mark done',   (SELECT v->>'code' FROM _r WHERE k = 'done_b_by_c') = 'not_found'),
  ('RLS hides a MAMAILA item from notes',       (SELECT v->>'code' FROM _r WHERE k = 'note_b_by_c') = 'not_found'),
  ('PM cannot mark done while contractor holds it', (SELECT v->>'code' FROM _r WHERE k = 'done_a_by_pm_early') = 'not_holder'),
  ('holder mark done -> answered, NOT closed',  (SELECT v->>'code' = 'ok' AND v->>'status' = 'answered' FROM _r WHERE k = 'done_a_by_c')),
  ('second tap after the ball moved',           (SELECT v->>'code' FROM _r WHERE k = 'done_a_by_c2') = 'not_holder'),
  ('note ok',                                   (SELECT v->>'code' FROM _r WHERE k = 'note_a_by_c') = 'ok'),
  ('foreign storage path refused',              (SELECT v->>'code' FROM _r WHERE k = 'att_bad_path') = 'refused'),
  ('gatekeeper closes',                         (SELECT v->>'code' = 'ok' AND v->>'status' = 'closed' FROM _r WHERE k = 'done_a_by_pm')),
  ('assignee == gatekeeper closes from triage', (SELECT v->>'code' = 'ok' AND v->>'status' = 'closed' FROM _r WHERE k = 'done_d_by_pm')),
  ('open items list excludes closed and foreign items',
     NOT (SELECT v::text LIKE '%' || current_setting('x.a') || '%' OR v::text LIKE '%' || current_setting('x.b') || '%'
            FROM _r WHERE k = 'open_c')),
  ('events attribute each step to the acting user',
     (SELECT string_agg(verb || ':' || coalesce(actor_id::text, '-'), ',' ORDER BY seq)
        FROM projects.work_item_events WHERE work_item_id = current_setting('x.a')::uuid)
     LIKE '%acknowledged:' || current_setting('x.c') || '%status_changed:' || current_setting('x.c')
          || '%closed:' || current_setting('x.pm') || '%'),
  ('note is bound to the item''s project and marked whatsapp',
     (SELECT project_id::text = current_setting('x.kw') AND via = 'whatsapp'
        FROM projects.work_item_notes WHERE id = current_setting('x.note')::uuid)),
  ('non-author cannot redact',                  (SELECT v->>'code' FROM _r WHERE k = 'redact_by_pm') = 'refused'),
  ('author redacts within the window',          (SELECT v->>'code' FROM _r WHERE k = 'redact_by_c') = 'ok'),
  ('redaction keeps the row and empties the body',
     (SELECT redacted_at IS NOT NULL AND body = '' FROM projects.work_item_notes WHERE id = current_setting('x.note')::uuid)),
  ('a removed member is refused',               (SELECT v->>'code' FROM _r WHERE k = 'note_after_removal') IN ('no_access', 'refused'))
) AS t("check", ok);
```

- [ ] **Step 2: Run to verify it fails**

Run: `scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-actor.sql`
Expected: the file aborts with `function whatsapp.wa_acknowledge(uuid, uuid) does not exist`.

- [ ] **Step 3: Append part B to the migration**

```sql
-- ═══ Part B: acting as the user ═══════════════════════════════════════════
-- whatsapp_actor OWNS the wa_* functions. It is a member of `authenticated` and
-- has no BYPASSRLS, so inside a wa_* function the table's REAL policies judge
-- the write. act_as() sets the user's claims first, so auth.uid(), every
-- auth.uid()-based helper and the work-item transition guard see the user.
-- Nothing here re-states a rule the web path enforces.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'whatsapp_actor') THEN
    CREATE ROLE whatsapp_actor NOLOGIN INHERIT NOBYPASSRLS;
  END IF;
END $$;
GRANT authenticated TO whatsapp_actor;
GRANT whatsapp_actor TO postgres;
GRANT USAGE, CREATE ON SCHEMA whatsapp TO whatsapp_actor;
GRANT INSERT ON projects.work_item_notes, projects.work_item_attachments TO whatsapp_actor;
GRANT UPDATE (body, redacted_at, redacted_by) ON projects.work_item_notes TO whatsapp_actor;
GRANT UPDATE (redacted_at, redacted_by) ON projects.work_item_attachments TO whatsapp_actor;

CREATE POLICY work_item_notes_insert_wa ON projects.work_item_notes FOR INSERT TO whatsapp_actor
  WITH CHECK (author_id = auth.uid() AND via = 'whatsapp'
              AND projects.user_can_read_work_item(work_item_id)
              AND COALESCE(public.user_effective_project_role(project_id, auth.uid()), 'client_viewer') <> 'client_viewer');
CREATE POLICY work_item_attachments_insert_wa ON projects.work_item_attachments FOR INSERT TO whatsapp_actor
  WITH CHECK (uploaded_by = auth.uid() AND via = 'whatsapp'
              AND projects.user_can_read_work_item(work_item_id)
              AND COALESCE(public.user_effective_project_role(project_id, auth.uid()), 'client_viewer') <> 'client_viewer');
CREATE POLICY work_item_notes_redact_wa ON projects.work_item_notes FOR UPDATE TO whatsapp_actor
  USING (author_id = auth.uid() AND redacted_at IS NULL AND created_at > now() - interval '15 minutes')
  WITH CHECK (redacted_by = auth.uid() AND redacted_at IS NOT NULL);
CREATE POLICY work_item_attachments_redact_wa ON projects.work_item_attachments FOR UPDATE TO whatsapp_actor
  USING (uploaded_by = auth.uid() AND redacted_at IS NULL AND created_at > now() - interval '15 minutes')
  WITH CHECK (redacted_by = auth.uid() AND redacted_at IS NOT NULL);

CREATE FUNCTION whatsapp.act_as(p_user uuid) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'act_as: a user is required'; END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END $fn$;
REVOKE ALL ON FUNCTION whatsapp.act_as(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION whatsapp.act_as(uuid) FROM anon;
REVOKE ALL ON FUNCTION whatsapp.act_as(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION whatsapp.act_as(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION whatsapp.act_as(uuid) TO whatsapp_actor;

-- Events are trigger-written and `authenticated` has no INSERT, so the one verb
-- WhatsApp adds is written by this postgres-owned helper, gated on readability.
CREATE FUNCTION whatsapp.record_ack(p_item uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security TO 'off' AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_wi    projects.work_items;
  v_last  record;
BEGIN
  IF v_actor IS NULL OR NOT projects.user_can_read_work_item(p_item) THEN RETURN false; END IF;
  SELECT * INTO v_wi FROM projects.work_items WHERE id = p_item;
  SELECT e.verb, e.actor_id INTO v_last FROM projects.work_item_events e
   WHERE e.work_item_id = p_item ORDER BY e.created_at DESC, e.seq DESC LIMIT 1;
  IF FOUND AND v_last.verb = 'acknowledged' AND v_last.actor_id = v_actor THEN RETURN true; END IF;
  INSERT INTO projects.work_item_events (work_item_id, project_id, organisation_id, verb, actor_id, actor_role,
                                         from_status, to_status, from_ball_in_court_id, to_ball_in_court_id)
  VALUES (p_item, v_wi.project_id, v_wi.organisation_id, 'acknowledged', v_actor,
          public.user_effective_project_role(v_wi.project_id, v_actor),
          v_wi.status, v_wi.status, v_wi.ball_in_court_id, v_wi.ball_in_court_id);
  RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION whatsapp.record_ack(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION whatsapp.record_ack(uuid) FROM anon;
REVOKE ALL ON FUNCTION whatsapp.record_ack(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION whatsapp.record_ack(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION whatsapp.record_ack(uuid) TO whatsapp_actor;

CREATE FUNCTION whatsapp.wa_acknowledge(p_user uuid, p_item uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_wi projects.work_items; v_role text;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  SELECT * INTO v_wi FROM projects.work_items WHERE id = p_item;          -- RLS, as the user
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  v_role := public.user_effective_project_role(v_wi.project_id, p_user);
  IF v_role IS NULL OR v_role = 'client_viewer' THEN
    RETURN jsonb_build_object('code', 'no_access', 'ref', v_wi.ref);
  END IF;
  IF NOT whatsapp.record_ack(p_item) THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  RETURN jsonb_build_object('code', 'ok', 'ref', v_wi.ref, 'status', v_wi.status);
END $fn$;

CREATE FUNCTION whatsapp.wa_mark_done(p_user uuid, p_item uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_wi projects.work_items; v_role text; v_target text; n int;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  SELECT * INTO v_wi FROM projects.work_items WHERE id = p_item;          -- RLS, as the user
  IF NOT FOUND THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  v_role := public.user_effective_project_role(v_wi.project_id, p_user);
  IF v_role IS NULL OR v_role = 'client_viewer' THEN
    RETURN jsonb_build_object('code', 'no_access', 'ref', v_wi.ref);
  END IF;
  IF v_wi.status IN ('closed', 'void') THEN
    RETURN jsonb_build_object('code', 'already_closed', 'ref', v_wi.ref, 'status', v_wi.status);
  END IF;
  -- Mirrors take status FROM their source (#193 map_source_status). Phase 2
  -- (Task 21) replaces this arm with the snag and RFI adapters.
  IF v_wi.origin = 'mirror' THEN
    RETURN jsonb_build_object('code', 'use_module', 'ref', v_wi.ref, 'item_type', v_wi.item_type);
  END IF;
  IF v_wi.ball_in_court_id IS DISTINCT FROM p_user THEN
    RETURN jsonb_build_object('code', 'not_holder', 'ref', v_wi.ref,
      'holder_name', (SELECT full_name FROM public.profiles WHERE id = v_wi.ball_in_court_id));
  END IF;
  v_target := CASE WHEN v_wi.status = 'answered' OR v_wi.assignee_id = v_wi.gatekeeper_id
                   THEN 'closed' ELSE 'answered' END;
  BEGIN
    IF v_wi.status = 'triage' THEN
      UPDATE projects.work_items SET status = 'open' WHERE id = p_item AND status = 'triage';
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n = 0 THEN RETURN jsonb_build_object('code', 'nothing_changed', 'ref', v_wi.ref); END IF;
      v_wi.status := 'open';
    END IF;
    UPDATE projects.work_items SET status = v_target WHERE id = p_item AND status = v_wi.status;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    -- The guard's sentence ("Only the person who signs X off can close it…") is the message.
    RETURN jsonb_build_object('code', 'refused', 'ref', v_wi.ref, 'message', SQLERRM);
  END;
  IF n = 0 THEN RETURN jsonb_build_object('code', 'nothing_changed', 'ref', v_wi.ref); END IF;
  RETURN jsonb_build_object('code', 'ok', 'ref', v_wi.ref, 'status', v_target,
    'gatekeeper_name', (SELECT full_name FROM public.profiles WHERE id = v_wi.gatekeeper_id));
END $fn$;

CREATE FUNCTION whatsapp.wa_add_note(p_user uuid, p_item uuid, p_body text, p_inbound uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_ref text; v_id uuid;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  SELECT ref INTO v_ref FROM projects.work_items WHERE id = p_item;       -- RLS, as the user
  IF v_ref IS NULL THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  BEGIN
    INSERT INTO projects.work_item_notes (work_item_id, author_id, body, via, inbound_id)
    VALUES (p_item, p_user, left(p_body, 4096), 'whatsapp', p_inbound)
    RETURNING id INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('code', 'refused', 'ref', v_ref, 'message', SQLERRM);
  END;
  RETURN jsonb_build_object('code', 'ok', 'ref', v_ref, 'id', v_id);
END $fn$;

CREATE FUNCTION whatsapp.wa_add_attachment(p_user uuid, p_item uuid, p_bucket text, p_path text,
                                           p_mime text, p_role text, p_inbound uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_ref text; v_id uuid;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  SELECT ref INTO v_ref FROM projects.work_items WHERE id = p_item;       -- RLS, as the user
  IF v_ref IS NULL THEN RETURN jsonb_build_object('code', 'not_found'); END IF;
  BEGIN
    INSERT INTO projects.work_item_attachments (work_item_id, uploaded_by, bucket, storage_path, mime_type, role, via, inbound_id)
    VALUES (p_item, p_user, p_bucket, p_path, p_mime, p_role, 'whatsapp', p_inbound)
    RETURNING id INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('code', 'refused', 'ref', v_ref, 'message', SQLERRM);
  END;
  RETURN jsonb_build_object('code', 'ok', 'ref', v_ref, 'id', v_id);
END $fn$;

CREATE FUNCTION whatsapp.wa_redact(p_user uuid, p_kind text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE n int := 0; v_ref text;
BEGIN
  PERFORM whatsapp.act_as(p_user);
  BEGIN
    IF p_kind = 'note' THEN
      SELECT wi.ref INTO v_ref FROM projects.work_item_notes x JOIN projects.work_items wi ON wi.id = x.work_item_id WHERE x.id = p_id;
      UPDATE projects.work_item_notes SET body = '', redacted_at = now(), redacted_by = p_user
       WHERE id = p_id AND redacted_at IS NULL;
    ELSIF p_kind = 'attachment' THEN
      SELECT wi.ref INTO v_ref FROM projects.work_item_attachments x JOIN projects.work_items wi ON wi.id = x.work_item_id WHERE x.id = p_id;
      UPDATE projects.work_item_attachments SET redacted_at = now(), redacted_by = p_user
       WHERE id = p_id AND redacted_at IS NULL;
    ELSE
      RETURN jsonb_build_object('code', 'invalid');
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('code', 'refused', 'ref', v_ref, 'message', SQLERRM);
  END;
  RETURN jsonb_build_object('code', CASE WHEN n = 1 THEN 'ok' ELSE 'refused' END, 'ref', v_ref);
END $fn$;

CREATE FUNCTION whatsapp.wa_open_items(p_user uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  PERFORM whatsapp.act_as(p_user);
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.due_date, x.ref) FROM (
      SELECT wi.id, wi.ref, wi.title, wi.due_date, p.name AS project_name
        FROM projects.work_items wi JOIN projects.projects p ON p.id = wi.project_id
       WHERE wi.ball_in_court_id = p_user AND wi.status IN ('triage', 'open', 'answered')
         AND COALESCE(public.user_effective_project_role(wi.project_id, p_user), 'client_viewer') <> 'client_viewer'
       ORDER BY wi.due_date, wi.ref LIMIT 10) x), '[]'::jsonb);
END $fn$;

-- Ownership + grants, written out one statement each: packages/db's static
-- scanners read this file's TEXT and cannot see a REVOKE built with format().
ALTER FUNCTION whatsapp.wa_acknowledge(uuid,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_mark_done(uuid,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_add_note(uuid,uuid,text,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_add_attachment(uuid,uuid,text,text,text,text,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_redact(uuid,text,uuid) OWNER TO whatsapp_actor;
ALTER FUNCTION whatsapp.wa_open_items(uuid) OWNER TO whatsapp_actor;
REVOKE ALL ON FUNCTION whatsapp.wa_acknowledge(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_mark_done(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_add_note(uuid,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_add_attachment(uuid,uuid,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_redact(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION whatsapp.wa_open_items(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.wa_acknowledge(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_mark_done(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_add_note(uuid,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_add_attachment(uuid,uuid,text,text,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_redact(uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION whatsapp.wa_open_items(uuid) TO service_role;
```

- [ ] **Step 4: Run to verify it passes**

Run: `scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-actor.sql`
Expected: every row `ok = true`.

If `'events attribute…'` fails, read the actual `string_agg` output. The `created` event is written with actor `-` because the fixture inserts as postgres; adjust the LIKE only if the order of the verbs differs, never the actors. Also re-run `assert-whatsapp-schema.sql`; it must still be all green.

- [ ] **Step 5: Mutations (each must turn a named row red; revert after each)**

1. `ALTER FUNCTION whatsapp.wa_mark_done(uuid,uuid) OWNER TO postgres;`
   Expected: `RLS hides a MAMAILA item from mark done` goes false. The code becomes `no_access` because postgres bypasses RLS and finds the row. **This is the proof that RLS, not the role check, gates visibility.**
2. In `wa_mark_done`, replace the `v_target` CASE with `'closed'`.
   Expected: `holder mark done -> answered, NOT closed` goes false. The guard refuses and the code becomes `refused`.
3. Delete the `IF v_role IS NULL …` block from `wa_add_note`.
   Expected: `a removed member is refused` **still passes**, because the insert policy refuses too. Record that as defence in depth. Then also drop the role clause from `work_item_notes_insert_wa`; the row must now go false.

- [ ] **Step 6: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-actor.sql
git commit -m "feat(whatsapp): 00207 part B — whatsapp_actor + wa_* functions under real RLS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Migration part C — enqueue, due sweep, claim helpers, cron

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql` (append)
- Create: `scripts/db/assert-whatsapp-enqueue.sql`

- [ ] **Step 1: Write the failing assertions**

```sql
-- scripts/db/assert-whatsapp-enqueue.sql
-- Outbox enqueue on ball moves, the due sweep, and the claim/receive helpers. Run:
--   scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-enqueue.sql
SELECT set_config('x.c', '018f2d31-bbe8-4cc1-bbdd-63af0187081e', true);
SELECT set_config('x.kw', (SELECT pm.project_id::text FROM projects.project_members pm
                            WHERE pm.user_id = current_setting('x.c')::uuid AND pm.is_active
                            ORDER BY pm.created_at LIMIT 1), true);
SELECT set_config('x.pm', projects.resolve_project_pm(current_setting('x.kw')::uuid)::text, true);
SELECT set_config('x.today', ((now() AT TIME ZONE 'Africa/Johannesburg')::date)::text, true);

UPDATE projects.project_settings SET notify_whatsapp = true WHERE project_id = current_setting('x.kw')::uuid;
INSERT INTO whatsapp.phone_links (user_id, phone_e164, status, verified_at, consent_at, consent_text_version)
VALUES (current_setting('x.c')::uuid, '+27000000001', 'active', now(), now(), 'test');

-- 1. A PM assigns an item to C  -> one 'assigned' row for C.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.pm'), 'role', 'authenticated')::text, true);
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA enqueue 1',
         current_setting('x.c')::uuid, current_setting('x.pm')::uuid, current_setting('x.pm')::uuid, 'open', current_date + 5
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid RETURNING id)
SELECT set_config('x.i1', (SELECT id::text FROM ins), true);

-- 2. C creates an item assigned to themselves -> nothing (no self-notification).
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('x.c'), 'role', 'authenticated')::text, true);
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA enqueue 2',
         current_setting('x.c')::uuid, current_setting('x.pm')::uuid, current_setting('x.c')::uuid, 'open', current_date + 5
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid RETURNING id)
SELECT set_config('x.i2', (SELECT id::text FROM ins), true);

-- 3. A service-path (no actor) creation -> nothing (backfills must never page people).
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.sub', '', true);
WITH ins AS (
  INSERT INTO projects.work_items (organisation_id, project_id, item_type, origin, title,
                                   assignee_id, gatekeeper_id, created_by, status, due_date)
  SELECT p.organisation_id, p.id, 'task', 'manual', 'WA enqueue 3',
         current_setting('x.c')::uuid, current_setting('x.pm')::uuid, current_setting('x.pm')::uuid, 'open', current_date + 5
    FROM projects.projects p WHERE p.id = current_setting('x.kw')::uuid RETURNING id)
SELECT set_config('x.i3', (SELECT id::text FROM ins), true);

-- Due-date fixtures (service path, so the guard lets us backdate).
UPDATE projects.work_items SET due_date = current_setting('x.today')::date + 1 WHERE id = current_setting('x.i1')::uuid;
UPDATE projects.work_items SET due_date = current_setting('x.today')::date - 1 WHERE id = current_setting('x.i2')::uuid;
UPDATE projects.work_items SET due_date = current_setting('x.today')::date - 2 WHERE id = current_setting('x.i3')::uuid;

CREATE TEMP TABLE _r (k text PRIMARY KEY, v text);
INSERT INTO _r VALUES
  ('sweep1', whatsapp.sweep_due(current_setting('x.today')::date)::text),
  ('sweep2', whatsapp.sweep_due(current_setting('x.today')::date)::text),
  ('rc_c',   whatsapp.receive_check(current_setting('x.c')::uuid,  current_setting('x.i1')::uuid)::text),
  ('rc_pm',  whatsapp.receive_check(current_setting('x.pm')::uuid, current_setting('x.i1')::uuid)::text);
INSERT INTO _r VALUES ('claim1', (SELECT count(*) FROM whatsapp.claim_outbox(50))::text);
INSERT INTO _r VALUES ('claim2', (SELECT count(*) FROM whatsapp.claim_outbox(50))::text);
SELECT whatsapp.enqueue_fold(current_setting('x.c')::uuid, current_setting('x.today')::date);
SELECT whatsapp.enqueue_fold(current_setting('x.c')::uuid, current_setting('x.today')::date);

SELECT * FROM (VALUES
  ('PM assignment enqueues one assigned row for C',
     (SELECT count(*) = 1 FROM whatsapp.outbox WHERE work_item_id = current_setting('x.i1')::uuid AND trigger = 'assigned'
         AND user_id = current_setting('x.c')::uuid)),
  ('self-assignment enqueues nothing',
     NOT EXISTS (SELECT 1 FROM whatsapp.outbox WHERE work_item_id = current_setting('x.i2')::uuid AND trigger = 'assigned')),
  ('service-path creation enqueues nothing',
     NOT EXISTS (SELECT 1 FROM whatsapp.outbox WHERE work_item_id = current_setting('x.i3')::uuid AND trigger = 'assigned')),
  ('due tomorrow swept',
     EXISTS (SELECT 1 FROM whatsapp.outbox WHERE work_item_id = current_setting('x.i1')::uuid AND trigger = 'due_tomorrow')),
  ('1 day overdue swept',
     EXISTS (SELECT 1 FROM whatsapp.outbox WHERE work_item_id = current_setting('x.i2')::uuid AND trigger = 'overdue')),
  ('2 days overdue NOT swept (every 3 days)',
     NOT EXISTS (SELECT 1 FROM whatsapp.outbox WHERE work_item_id = current_setting('x.i3')::uuid AND trigger = 'overdue')),
  ('sweep is idempotent per day',        (SELECT v FROM _r WHERE k = 'sweep2') = '0'),
  ('receive_check ok for the holder',    (SELECT v::jsonb->>'ok' FROM _r WHERE k = 'rc_c') = 'true'),
  ('receive_check refuses a non-holder', (SELECT v::jsonb->>'reason' FROM _r WHERE k = 'rc_pm') = 'ball_moved'),
  ('claim takes queued rows once',       (SELECT v::int > 0 FROM _r WHERE k = 'claim1') AND (SELECT v FROM _r WHERE k = 'claim2') = '0'),
  ('fold row counts overflow in one row',
     (SELECT (payload->>'count')::int = 2 FROM whatsapp.outbox WHERE user_id = current_setting('x.c')::uuid AND trigger = 'fold')),
  ('cron job scheduled',                 EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-due-sweep' AND schedule = '30 4 * * *')),
  ('service_role cannot be bypassed: anon has no execute on sweep',
     NOT has_function_privilege('anon', 'whatsapp.sweep_due(date)', 'EXECUTE'))
) AS t("check", ok);
```

- [ ] **Step 2: Run to verify it fails**

Run the dry-run for this file.
Expected: it aborts with `function whatsapp.sweep_due(date) does not exist`.

- [ ] **Step 3: Append part C**

```sql
-- ═══ Part C: outbox enqueue, sweep, helpers, cron ═════════════════════════
CREATE FUNCTION whatsapp.enqueue_for_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security TO 'off' AS $fn$
DECLARE v_to uuid := NEW.to_ball_in_court_id;
BEGIN
  IF NEW.verb = 'acknowledged' OR v_to IS NULL THEN RETURN NULL; END IF;
  IF v_to IS NOT DISTINCT FROM NEW.from_ball_in_court_id THEN RETURN NULL; END IF;
  -- No actor = a service-path write (backfill, migration): never page anyone.
  -- Actor = recipient: nobody needs telling what they just did.
  IF NEW.actor_id IS NULL OR v_to = NEW.actor_id THEN RETURN NULL; END IF;
  IF NOT COALESCE((SELECT ps.notify_whatsapp FROM projects.project_settings ps
                    WHERE ps.project_id = NEW.project_id), false) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM whatsapp.phone_links l WHERE l.user_id = v_to AND l.status = 'active') THEN
    RETURN NULL;
  END IF;
  INSERT INTO whatsapp.outbox (user_id, work_item_id, trigger, idempotency_key)
  VALUES (v_to, NEW.work_item_id, 'assigned',
          format('%s:assigned:%s:%s', NEW.work_item_id, v_to, (now() AT TIME ZONE 'Africa/Johannesburg')::date))
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION whatsapp.enqueue_for_event() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER whatsapp_enqueue_trg AFTER INSERT ON projects.work_item_events
  FOR EACH ROW EXECUTE FUNCTION whatsapp.enqueue_for_event();

CREATE FUNCTION whatsapp.sweep_due(p_today date DEFAULT (now() AT TIME ZONE 'Africa/Johannesburg')::date)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET row_security TO 'off' AS $fn$
DECLARE n int;
BEGIN
  INSERT INTO whatsapp.outbox (user_id, work_item_id, trigger, idempotency_key, payload)
  SELECT wi.ball_in_court_id, wi.id, t.trig, format('%s:%s:%s', wi.id, t.trig, p_today),
         jsonb_build_object('days_overdue', p_today - wi.due_date)
    FROM projects.work_items wi
    JOIN projects.project_settings ps ON ps.project_id = wi.project_id AND ps.notify_whatsapp
    JOIN whatsapp.phone_links l ON l.user_id = wi.ball_in_court_id AND l.status = 'active'
    CROSS JOIN LATERAL (SELECT CASE
        WHEN wi.due_date = p_today + 1 THEN 'due_tomorrow'
        WHEN p_today - wi.due_date >= 1 AND (p_today - wi.due_date - 1) % 3 = 0 THEN 'overdue'
      END AS trig) t
   WHERE wi.status IN ('triage', 'open', 'answered') AND t.trig IS NOT NULL
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;
REVOKE ALL ON FUNCTION whatsapp.sweep_due(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.sweep_due(date) TO service_role;

-- Overflow past the daily cap folds into ONE message per user per day.
CREATE FUNCTION whatsapp.enqueue_fold(p_user uuid, p_day date) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $fn$
  INSERT INTO whatsapp.outbox (user_id, trigger, idempotency_key, payload)
  VALUES (p_user, 'fold', format('%s:fold:%s', p_user, p_day), jsonb_build_object('count', 1))
  ON CONFLICT (idempotency_key) DO UPDATE
     SET payload = jsonb_build_object('count', COALESCE((whatsapp.outbox.payload->>'count')::int, 0) + 1)
   WHERE whatsapp.outbox.status IN ('queued', 'held_quiet', 'retry');
$fn$;
REVOKE ALL ON FUNCTION whatsapp.enqueue_fold(uuid,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.enqueue_fold(uuid,date) TO service_role;

CREATE FUNCTION whatsapp.claim_outbox(p_limit int) RETURNS SETOF whatsapp.outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  -- A worker that died mid-send leaves 'sending' rows; give them back after 10 minutes.
  UPDATE whatsapp.outbox SET status = 'retry', updated_at = now()
   WHERE status = 'sending' AND updated_at < now() - interval '10 minutes';
  RETURN QUERY
  UPDATE whatsapp.outbox o SET status = 'sending', attempts = o.attempts + 1, updated_at = now()
   WHERE o.id IN (SELECT q.id FROM whatsapp.outbox q
                   WHERE q.status IN ('queued', 'retry', 'held_quiet') AND q.send_after <= now()
                   ORDER BY q.send_after, q.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
END $fn$;
REVOKE ALL ON FUNCTION whatsapp.claim_outbox(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.claim_outbox(int) TO service_role;

-- The webhook and the worker must never both process one message.
CREATE FUNCTION whatsapp.claim_inbound(p_limit int, p_min_age_seconds int) RETURNS SETOF whatsapp.inbound
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $fn$
  UPDATE whatsapp.inbound i SET claimed_at = now(), attempts = i.attempts + 1
   WHERE i.id IN (SELECT q.id FROM whatsapp.inbound q
                   WHERE q.outcome = 'pending' AND q.attempts < 5
                     AND q.received_at <= now() - make_interval(secs => p_min_age_seconds)
                     AND (q.claimed_at IS NULL OR q.claimed_at < now() - interval '2 minutes')
                   ORDER BY q.received_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING i.*;
$fn$;
REVOKE ALL ON FUNCTION whatsapp.claim_inbound(int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.claim_inbound(int,int) TO service_role;

-- Is this item message still worth sending to this person right now?
CREATE FUNCTION whatsapp.receive_check(p_user uuid, p_item uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET row_security TO 'off' AS $fn$
DECLARE v_wi projects.work_items; v_name text; v_on boolean; v_role text;
BEGIN
  SELECT * INTO v_wi FROM projects.work_items WHERE id = p_item;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'item_gone'); END IF;
  IF v_wi.status IN ('closed', 'void') THEN RETURN jsonb_build_object('ok', false, 'reason', 'item_closed'); END IF;
  SELECT p.name, COALESCE(ps.notify_whatsapp, false) INTO v_name, v_on
    FROM projects.projects p LEFT JOIN projects.project_settings ps ON ps.project_id = p.id
   WHERE p.id = v_wi.project_id;
  IF NOT v_on THEN RETURN jsonb_build_object('ok', false, 'reason', 'project_off'); END IF;
  v_role := public.user_effective_project_role(v_wi.project_id, p_user);
  IF v_role IS NULL OR v_role = 'client_viewer' THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_access'); END IF;
  IF v_wi.ball_in_court_id IS DISTINCT FROM p_user THEN RETURN jsonb_build_object('ok', false, 'reason', 'ball_moved'); END IF;
  RETURN jsonb_build_object('ok', true, 'item_id', v_wi.id, 'ref', v_wi.ref, 'title', v_wi.title,
    'project_name', v_name, 'due_date', v_wi.due_date,
    'days_overdue', GREATEST(0, (now() AT TIME ZONE 'Africa/Johannesburg')::date - v_wi.due_date));
END $fn$;
REVOKE ALL ON FUNCTION whatsapp.receive_check(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION whatsapp.receive_check(uuid,uuid) TO service_role;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-due-sweep') THEN
    PERFORM cron.unschedule('whatsapp-due-sweep');
  END IF;
END $$;
SELECT cron.schedule('whatsapp-due-sweep', '30 4 * * *', $cron$ SELECT whatsapp.sweep_due(); $cron$);
```

- [ ] **Step 4: Run all three assertion files**

```bash
for f in schema actor enqueue; do scripts/db/dry-run-migration.sh apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-$f.sql; done
```

Expected: every row `ok = true` in all three.

- [ ] **Step 5: Mutations**

1. Remove `OR v_to = NEW.actor_id` from `enqueue_for_event`.
   Expected: `self-assignment enqueues nothing` goes false.
2. Remove `NEW.actor_id IS NULL OR`.
   Expected: `service-path creation enqueues nothing` goes false.
3. Change `% 3 = 0` to `% 1 = 0`.
   Expected: `2 days overdue NOT swept` goes false.

Revert each one after checking.

- [ ] **Step 6: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql scripts/db/assert-whatsapp-enqueue.sql
git commit -m "feat(whatsapp): 00207 part C — enqueue on ball moves, due sweep, claim helpers, cron

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: The `@verify` block, and the packages/db suite

**Files:**
- Modify: `apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql` (the block at the top)

- [ ] **Step 1: Replace the placeholder block**

Replace these lines:

```
-- @verify:begin
-- (Task 8 writes the full block; keep this marker pair at the top of the file.)
-- @verify:end
```

with this block:

```sql
-- @verify:begin
-- table: whatsapp.settings
-- table: whatsapp.templates
-- table: whatsapp.phone_links
-- table: whatsapp.outbox
-- table: whatsapp.inbound
-- table: whatsapp.unknown_senders
-- table: projects.work_item_notes
-- table: projects.work_item_attachments
-- column: projects.project_settings.notify_whatsapp
-- column: whatsapp.inbound.claimed_at
-- function: whatsapp.act_as(uuid)
-- function: whatsapp.record_ack(uuid)
-- function: whatsapp.wa_acknowledge(uuid,uuid)
-- function: whatsapp.wa_mark_done(uuid,uuid)
-- function: whatsapp.wa_add_note(uuid,uuid,text,uuid)
-- function: whatsapp.wa_add_attachment(uuid,uuid,text,text,text,text,uuid)
-- function: whatsapp.wa_redact(uuid,text,uuid)
-- function: whatsapp.wa_open_items(uuid)
-- function: whatsapp.enqueue_for_event()
-- function: whatsapp.sweep_due(date)
-- function: whatsapp.enqueue_fold(uuid,date)
-- function: whatsapp.claim_outbox(int)
-- function: whatsapp.claim_inbound(int,int)
-- function: whatsapp.receive_check(uuid,uuid)
-- trigger: whatsapp_enqueue_trg ON projects.work_item_events
-- trigger: inbound_immutable_trg ON whatsapp.inbound
-- trigger: work_item_notes_bind ON projects.work_item_notes
-- trigger: work_item_attachments_bind ON projects.work_item_attachments
-- constraint: work_item_events_verb_check ON projects.work_item_events
-- policy: phone_links_select_own ON whatsapp.phone_links PERMISSIVE
-- policy: outbox_select ON whatsapp.outbox PERMISSIVE
-- policy: inbound_select ON whatsapp.inbound PERMISSIVE
-- policy: work_item_notes_select ON projects.work_item_notes PERMISSIVE
-- policy: work_item_notes_insert_wa ON projects.work_item_notes PERMISSIVE
-- policy: work_item_notes_redact_wa ON projects.work_item_notes PERMISSIVE
-- policy: work_item_attachments_select ON projects.work_item_attachments PERMISSIVE
-- policy: work_item_attachments_insert_wa ON projects.work_item_attachments PERMISSIVE
-- policy: work_item_attachments_redact_wa ON projects.work_item_attachments PERMISSIVE
-- cron: whatsapp-due-sweep
-- grant_absent: anon SELECT ON whatsapp.phone_links
-- grant_absent: authenticated INSERT ON whatsapp.phone_links
-- grant_absent: authenticated UPDATE ON whatsapp.inbound
-- grant_absent: authenticated INSERT ON projects.work_item_notes
-- grant_absent: authenticated INSERT ON projects.work_item_attachments
-- anon_execute_absent: whatsapp
-- sql: (SELECT pg_get_userbyid(p.proowner) = 'whatsapp_actor' FROM pg_proc p WHERE p.oid = 'whatsapp.wa_mark_done(uuid,uuid)'::regprocedure)
-- sql: (SELECT NOT r.rolbypassrls AND NOT r.rolsuper AND NOT r.rolcanlogin FROM pg_roles r WHERE r.rolname = 'whatsapp_actor')
-- sql: (SELECT pg_has_role('whatsapp_actor', 'authenticated', 'MEMBER'))
-- sql: (SELECT NOT has_function_privilege('authenticated', 'whatsapp.wa_mark_done(uuid,uuid)', 'EXECUTE'))
-- sql: (SELECT NOT has_function_privilege('authenticated', 'whatsapp.act_as(uuid)', 'EXECUTE'))
-- sql: (SELECT NOT has_column_privilege('authenticated', 'whatsapp.phone_links', 'otp_hash', 'SELECT'))
-- sql: (SELECT pg_get_constraintdef(c.oid) LIKE '%acknowledged%' FROM pg_constraint c WHERE c.conrelid = 'projects.work_item_events'::regclass AND c.conname = 'work_item_events_verb_check')
-- sql: (SELECT count(*) = 1 FROM pg_constraint c WHERE c.conrelid = 'projects.work_item_events'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%verb%')
-- sql: (SELECT EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'work-item-attachments' AND b.public = false))
-- sql: (SELECT count(*) = 1 FROM whatsapp.settings)
-- behaviour: wa_* functions act as the user under real RLS; proven by scripts/db/assert-whatsapp-actor.sql
--   including the re-own-to-postgres mutation (Task 6 step 5).
-- @verify:end
```

- [ ] **Step 2: Parse-check the block locally**

Run: `node --experimental-strip-types scripts/verify-migration-applied.ts --file 00207_whatsapp_reply_to_act.sql --dry-parse 2>&1 | tail -5`

If `--dry-parse` is not a supported flag, run `pnpm --filter @esite/shared test -- verify-header` instead, and check that the migration-corpus test in that suite parses 00207 with no `REFUSED` directive.
Expected: no parse errors. **Unknown directive words are refused**, so every word above is one from the grammar.

- [ ] **Step 3: Run the repo-wide migration guards**

Run: `pnpm --filter @esite/db test:ci`
Expected: PASS. If a guard fails, it names the file and line. The usual causes are:
- a function without `REVOKE … FROM PUBLIC`, or
- a `SECURITY DEFINER` without `SET search_path`.

Fix the migration, not the guard.

- [ ] **Step 4: Re-run all three dry-runs** (the block is comments, so they must be unchanged and green).

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/migrations/00207_whatsapp_reply_to_act.sql
git commit -m "feat(whatsapp): 00207 @verify block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: Edge — signature verification and webhook parsing

**Files:**
- Create: `apps/edge-functions/supabase/functions/_shared/whatsapp/signature.ts`
- Create: `apps/edge-functions/supabase/functions/_shared/whatsapp/parse.ts`
- Test: `apps/web/src/lib/whatsapp/signature.test.ts`
- Test: `apps/web/src/lib/whatsapp/parse.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/whatsapp/signature.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyMetaSignature } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/signature.ts'

const SECRET = 'app-secret-123'
const body = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[]}')
const sign = (b: Uint8Array, s = SECRET) => 'sha256=' + createHmac('sha256', s).update(b).digest('hex')

describe('verifyMetaSignature', () => {
  it('accepts a correct signature', async () => expect(await verifyMetaSignature(body, sign(body), SECRET)).toBe(true))
  it('accepts upper-case hex', async () => expect(await verifyMetaSignature(body, sign(body).toUpperCase().replace('SHA256=', 'sha256='), SECRET)).toBe(true))
  it('rejects a tampered body', async () => {
    const tampered = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[1]}')
    expect(await verifyMetaSignature(tampered, sign(body), SECRET)).toBe(false)
  })
  it('rejects the wrong secret', async () => expect(await verifyMetaSignature(body, sign(body, 'other'), SECRET)).toBe(false))
  it('rejects a missing header', async () => expect(await verifyMetaSignature(body, null, SECRET)).toBe(false))
  it('rejects a malformed header', async () => expect(await verifyMetaSignature(body, 'sha1=abc', SECRET)).toBe(false))
  it('rejects when the secret is unset (fail closed)', async () => expect(await verifyMetaSignature(body, sign(body, ''), '')).toBe(false))
})
```

```ts
// apps/web/src/lib/whatsapp/parse.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseWebhook } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/parse.ts'

const wrap = (value: unknown) => ({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value }] }] })

describe('parseWebhook', () => {
  it('flattens a template quick-reply button', () => {
    const { messages } = parseWebhook(wrap({ messages: [{ id: 'wamid.1', from: '27821234567', timestamp: '1', type: 'button',
      context: { id: 'wamid.out' }, button: { payload: 'ack:11111111-1111-4111-8111-111111111111', text: 'Acknowledge' } }] }))
    expect(messages[0]).toMatchObject({ id: 'wamid.1', from: '27821234567', type: 'button', contextId: 'wamid.out',
      payload: 'ack:11111111-1111-4111-8111-111111111111', text: null, imageId: null })
  })
  it('reads interactive button and list replies', () => {
    const { messages } = parseWebhook(wrap({ messages: [
      { id: 'a', from: '1', timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'wrong:note:x', title: 'Wrong item' } } },
      { id: 'b', from: '1', timestamp: '1', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'pick:y', title: 'SNAG-1' } } },
    ] }))
    expect(messages.map((m) => m.payload)).toEqual(['wrong:note:x', 'pick:y'])
  })
  it('reads text and image-with-caption', () => {
    const { messages } = parseWebhook(wrap({ messages: [
      { id: 't', from: '1', timestamp: '1', type: 'text', text: { body: 'Cover refitted' } },
      { id: 'i', from: '1', timestamp: '1', type: 'image', image: { id: 'MEDIA', mime_type: 'image/jpeg', caption: 'after' } },
    ] }))
    expect(messages[0]).toMatchObject({ type: 'text', text: 'Cover refitted' })
    expect(messages[1]).toMatchObject({ type: 'image', imageId: 'MEDIA', imageMime: 'image/jpeg', text: 'after' })
  })
  it('reads statuses with error codes', () => {
    const { statuses } = parseWebhook(wrap({ statuses: [
      { id: 'wamid.out', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] },
      { id: 'wamid.o2', status: 'read' },
    ] }))
    expect(statuses).toEqual([
      { id: 'wamid.out', status: 'failed', errorCode: 131026, errorTitle: 'Message undeliverable' },
      { id: 'wamid.o2', status: 'read', errorCode: null, errorTitle: null },
    ])
  })
  it('never throws on junk', () => {
    expect(parseWebhook(null)).toEqual({ messages: [], statuses: [] })
    expect(parseWebhook({ entry: 'x' })).toEqual({ messages: [], statuses: [] })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web test -- src/lib/whatsapp/signature.test.ts src/lib/whatsapp/parse.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/edge-functions/supabase/functions/_shared/whatsapp/signature.ts
// Meta signs every webhook POST with HMAC-SHA256 of the RAW body under the app
// secret: header `X-Hub-Signature-256: sha256=<hex>`. This is the ONLY thing
// that authenticates whatsapp-webhook (deployed --no-verify-jwt). Fail closed.

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function verifyMetaSignature(rawBody: Uint8Array, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !appSecret) return false
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim())
  if (!m) return false
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, rawBody))
  return constantTimeEqual(sig, hexToBytes(m[1].toLowerCase()))
}
```

```ts
// apps/edge-functions/supabase/functions/_shared/whatsapp/parse.ts
export interface InboundMessage {
  id: string
  from: string
  timestamp: string
  type: string
  contextId: string | null
  text: string | null
  payload: string | null
  imageId: string | null
  imageMime: string | null
}

export interface StatusUpdate {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  errorCode: number | null
  errorTitle: string | null
}

// deno-lint-ignore no-explicit-any
type Any = any

export function toInboundMessage(m: Any): InboundMessage | null {
  if (!m || typeof m.id !== 'string' || typeof m.from !== 'string') return null
  const payload =
    m.type === 'button' ? (m.button?.payload ?? null)
    : m.type === 'interactive' ? (m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? null)
    : null
  const text = m.type === 'text' ? (m.text?.body ?? null) : m.type === 'image' ? (m.image?.caption ?? null) : null
  return {
    id: m.id, from: m.from, timestamp: String(m.timestamp ?? ''), type: String(m.type ?? 'unknown'),
    contextId: m.context?.id ?? null, text, payload,
    imageId: m.type === 'image' ? (m.image?.id ?? null) : null,
    imageMime: m.type === 'image' ? (m.image?.mime_type ?? null) : null,
  }
}

export function parseWebhook(body: unknown): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const messages: InboundMessage[] = []
  const statuses: StatusUpdate[] = []
  const entries = Array.isArray((body as Any)?.entry) ? (body as Any).entry : []
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : []
    for (const change of changes) {
      const v = change?.value ?? {}
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        const parsed = toInboundMessage(m)
        if (parsed) messages.push(parsed)
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
        if (typeof s?.id !== 'string' || !['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue
        statuses.push({
          id: s.id, status: s.status,
          errorCode: typeof s.errors?.[0]?.code === 'number' ? s.errors[0].code : null,
          errorTitle: s.errors?.[0]?.title ?? null,
        })
      }
    }
  }
  return { messages, statuses }
}
```

- [ ] **Step 4: Run to verify they pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/functions/_shared/whatsapp/signature.ts apps/edge-functions/supabase/functions/_shared/whatsapp/parse.ts apps/web/src/lib/whatsapp/signature.test.ts apps/web/src/lib/whatsapp/parse.test.ts
git commit -m "feat(whatsapp): HMAC signature verification + webhook parsing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: Edge — Meta client and template builders

**Files:**
- Create: `apps/edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts`
- Create: `apps/edge-functions/supabase/functions/_shared/whatsapp/templates.ts`
- Test: `apps/web/src/lib/whatsapp/meta-client.test.ts`
- Test: `apps/web/src/lib/whatsapp/templates.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/whatsapp/meta-client.test.ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createMetaClient, classifyMetaError, MetaError } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts'

function fakeFetch(responses: Array<{ status: number; json?: unknown; bytes?: Uint8Array; type?: string }>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const r = responses.shift()!
    return new Response(r.bytes ?? JSON.stringify(r.json ?? {}), { status: r.status, headers: { 'content-type': r.type ?? 'application/json' } })
  })
  return { fn, calls }
}

describe('createMetaClient', () => {
  it('sends a template with body params and buttons, stripping the plus', async () => {
    const f = fakeFetch([{ status: 200, json: { messages: [{ id: 'wamid.OUT' }] } }])
    const c = createMetaClient({ token: 'T', phoneNumberId: 'P', fetchImpl: f.fn as unknown as typeof fetch })
    const id = await c.sendTemplate('+27821234567', 'esite_item_assigned', ['T-1', 'KINGSWALK', 'Fix it', 'Fri 3 Oct'],
      [{ type: 'quick_reply', index: 0, payload: 'ack:x' }, { type: 'url', index: 2, suffix: 'abc' }])
    expect(id).toBe('wamid.OUT')
    expect(f.calls[0].url).toBe('https://graph.facebook.com/v23.0/P/messages')
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer T')
    const sent = JSON.parse(String(f.calls[0].init.body))
    expect(sent.to).toBe('27821234567')
    expect(sent.template.name).toBe('esite_item_assigned')
    expect(sent.template.components[0]).toEqual({ type: 'body', parameters: [
      { type: 'text', text: 'T-1' }, { type: 'text', text: 'KINGSWALK' }, { type: 'text', text: 'Fix it' }, { type: 'text', text: 'Fri 3 Oct' }] })
    expect(sent.template.components[1]).toEqual({ type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'ack:x' }] })
    expect(sent.template.components[2]).toEqual({ type: 'button', sub_type: 'url', index: '2', parameters: [{ type: 'text', text: 'abc' }] })
  })

  it('sends reply buttons threaded to the inbound message, titles clipped to 20', async () => {
    const f = fakeFetch([{ status: 200, json: { messages: [{ id: 'm' }] } }])
    const c = createMetaClient({ token: 'T', phoneNumberId: 'P', fetchImpl: f.fn as unknown as typeof fetch })
    await c.sendButtons('+27821234567', 'Attached', [{ id: 'wrong:note:x', title: 'Wrong item — undo this now' }], 'wamid.IN')
    const sent = JSON.parse(String(f.calls[0].init.body))
    expect(sent.context).toEqual({ message_id: 'wamid.IN' })
    expect(sent.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20)
  })

  it('throws a classified MetaError', async () => {
    const f = fakeFetch([{ status: 400, json: { error: { code: 131026, message: 'undeliverable' } } }])
    const c = createMetaClient({ token: 'T', phoneNumberId: 'P', fetchImpl: f.fn as unknown as typeof fetch })
    await expect(c.sendText('+27821234567', 'hi')).rejects.toMatchObject({ code: 131026, klass: 'recipient' })
  })

  it('fetches media in two hops with the bearer token', async () => {
    const f = fakeFetch([
      { status: 200, json: { url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg', file_size: 3 } },
      { status: 200, bytes: new Uint8Array([1, 2, 3]), type: 'image/jpeg' },
    ])
    const c = createMetaClient({ token: 'T', phoneNumberId: 'P', fetchImpl: f.fn as unknown as typeof fetch })
    const media = await c.fetchMedia('MEDIA')
    expect(f.calls[0].url).toBe('https://graph.facebook.com/v23.0/MEDIA')
    expect((f.calls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer T')
    expect(Array.from(media.bytes)).toEqual([1, 2, 3])
    expect(media.mime).toBe('image/jpeg')
  })

  it('refuses media over 16 MB before downloading', async () => {
    const f = fakeFetch([{ status: 200, json: { url: 'u', mime_type: 'image/jpeg', file_size: 17 * 1024 * 1024 } }])
    const c = createMetaClient({ token: 'T', phoneNumberId: 'P', fetchImpl: f.fn as unknown as typeof fetch })
    await expect(c.fetchMedia('MEDIA')).rejects.toBeInstanceOf(MetaError)
    expect(f.calls).toHaveLength(1)
  })
})

describe('classifyMetaError', () => {
  it.each([
    [131026, 400, 'recipient'], [131047, 400, 'recipient'], [131051, 400, 'recipient'],
    [132001, 400, 'policy'], [132015, 400, 'policy'], [368, 400, 'policy'], [190, 401, 'policy'],
    [130429, 429, 'transient'], [131056, 400, 'transient'], [131000, 500, 'transient'], [0, 503, 'transient'],
  ])('%i/%i -> %s', (code, status, klass) => expect(classifyMetaError(code, status)).toBe(klass))
})
```

```ts
// apps/web/src/lib/whatsapp/templates.test.ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { itemCardSend, otpSend, optinSend, foldSend, humanDate, cleanParam } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/templates.ts'

const ID = '11111111-1111-4111-8111-111111111111'

describe('templates', () => {
  it('humanDate', () => expect(humanDate('2026-10-03')).toBe('Sat 3 Oct'))
  it('cleanParam strips newlines/tabs and long runs of spaces (Meta rejects them)', () =>
    expect(cleanParam('a\n\tb     c')).toBe('a b   c'))
  it('assigned card', () => {
    const s = itemCardSend('assigned', { itemId: ID, ref: 'T-4', projectName: 'KINGSWALK', title: 'Loose\nDB-3 cover', dueDate: '2026-10-03' })
    expect(s.name).toBe('esite_item_assigned')
    expect(s.body).toEqual(['T-4', 'KINGSWALK', 'Loose DB-3 cover', 'Sat 3 Oct'])
    expect(s.buttons).toEqual([
      { type: 'quick_reply', index: 0, payload: `ack:${ID}` },
      { type: 'quick_reply', index: 1, payload: `done:${ID}` },
      { type: 'url', index: 2, suffix: ID },
    ])
  })
  it('overdue card carries the day count', () => {
    const s = itemCardSend('overdue', { itemId: ID, ref: 'T-4', projectName: 'K', title: 't', dueDate: '2026-10-03', daysOverdue: 4 })
    expect(s.name).toBe('esite_item_overdue')
    expect(s.body[4]).toBe('4')
  })
  it('otp puts the code in the body AND the copy-code button', () =>
    expect(otpSend('042917')).toEqual({ name: 'esite_otp', body: ['042917'], buttons: [{ type: 'url', index: 0, suffix: '042917' }] }))
  it('optin carries both answers bound to the link', () =>
    expect(optinSend('Arno', 'KINGSWALK', ID).buttons).toEqual([
      { type: 'quick_reply', index: 0, payload: `optin:yes:${ID}` },
      { type: 'quick_reply', index: 1, payload: `optin:no:${ID}` },
    ]))
  it('fold', () => expect(foldSend(5)).toEqual({ name: 'esite_items_waiting', body: ['5'], buttons: [] }))
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web test -- src/lib/whatsapp/meta-client.test.ts src/lib/whatsapp/templates.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts
export const GRAPH_VERSION = 'v23.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`
const MAX_MEDIA_BYTES = 16 * 1024 * 1024

export type MetaErrorClass = 'transient' | 'recipient' | 'policy'

export class MetaError extends Error {
  constructor(public code: number, message: string, public klass: MetaErrorClass) {
    super(message)
    this.name = 'MetaError'
  }
}

const RECIPIENT = new Set([131026, 131047, 131051, 131052, 131053, 133010])
const POLICY = new Set([10, 190, 200, 368, 131031, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 132068, 132069])

/** recipient: stop sending to this number. policy: an admin must act. transient: retry. */
export function classifyMetaError(code: number, httpStatus: number): MetaErrorClass {
  if (RECIPIENT.has(code)) return 'recipient'
  if (POLICY.has(code)) return 'policy'
  if (httpStatus === 401 || httpStatus === 403) return 'policy'
  return 'transient'
}

export type TemplateButton =
  | { type: 'quick_reply'; index: number; payload: string }
  | { type: 'url'; index: number; suffix: string }

export interface MetaClient {
  sendTemplate(to: string, name: string, body: string[], buttons: TemplateButton[]): Promise<string>
  sendText(to: string, body: string, replyTo?: string): Promise<string>
  sendButtons(to: string, body: string, buttons: Array<{ id: string; title: string }>, replyTo?: string): Promise<string>
  sendList(to: string, body: string, buttonLabel: string, rows: Array<{ id: string; title: string; description?: string }>): Promise<string>
  fetchMedia(mediaId: string): Promise<{ bytes: Uint8Array; mime: string }>
}

export function createMetaClient(cfg: {
  token: string
  phoneNumberId: string
  fetchImpl?: typeof fetch
  language?: string
}): MetaClient {
  const f = cfg.fetchImpl ?? fetch
  const auth = { Authorization: `Bearer ${cfg.token}` }
  const digits = (to: string) => to.replace(/^\+/, '')

  async function post(message: Record<string, unknown>): Promise<string> {
    const res = await f(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...message }),
    })
    // deno-lint-ignore no-explicit-any
    const json: any = await res.json().catch(() => ({}))
    if (!res.ok || json?.error) {
      const code = Number(json?.error?.code ?? 0)
      throw new MetaError(code, String(json?.error?.message ?? `HTTP ${res.status}`), classifyMetaError(code, res.status))
    }
    const id = json?.messages?.[0]?.id
    if (typeof id !== 'string') throw new MetaError(0, 'Meta returned no message id', 'transient')
    return id
  }

  const ctx = (replyTo?: string) => (replyTo ? { context: { message_id: replyTo } } : {})

  return {
    sendTemplate(to, name, body, buttons) {
      return post({
        to: digits(to), type: 'template',
        template: {
          name, language: { code: cfg.language ?? 'en' },
          components: [
            ...(body.length ? [{ type: 'body', parameters: body.map((t) => ({ type: 'text', text: t })) }] : []),
            ...buttons.map((b) => b.type === 'quick_reply'
              ? { type: 'button', sub_type: 'quick_reply', index: String(b.index), parameters: [{ type: 'payload', payload: b.payload }] }
              : { type: 'button', sub_type: 'url', index: String(b.index), parameters: [{ type: 'text', text: b.suffix }] }),
          ],
        },
      })
    },
    sendText(to, body, replyTo) {
      return post({ to: digits(to), type: 'text', text: { body: body.slice(0, 4096), preview_url: false }, ...ctx(replyTo) })
    },
    sendButtons(to, body, buttons, replyTo) {
      return post({
        to: digits(to), type: 'interactive', ...ctx(replyTo),
        interactive: { type: 'button', body: { text: body.slice(0, 1024) },
          action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } })) } },
      })
    },
    sendList(to, body, buttonLabel, rows) {
      return post({
        to: digits(to), type: 'interactive',
        interactive: { type: 'list', body: { text: body.slice(0, 1024) },
          action: { button: buttonLabel.slice(0, 20), sections: [{ title: 'Open items',
            rows: rows.slice(0, 10).map((r) => ({ id: r.id.slice(0, 200), title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}) })) }] } },
      })
    },
    async fetchMedia(mediaId) {
      const meta = await f(`${GRAPH}/${mediaId}`, { headers: auth })
      // deno-lint-ignore no-explicit-any
      const info: any = await meta.json().catch(() => ({}))
      if (!meta.ok || typeof info?.url !== 'string') {
        const code = Number(info?.error?.code ?? 0)
        throw new MetaError(code, 'media lookup failed', classifyMetaError(code, meta.status))
      }
      if (Number(info.file_size ?? 0) > MAX_MEDIA_BYTES) throw new MetaError(0, 'media over 16 MB', 'recipient')
      const bin = await f(info.url, { headers: auth })
      if (!bin.ok) throw new MetaError(0, `media download HTTP ${bin.status}`, 'transient')
      return { bytes: new Uint8Array(await bin.arrayBuffer()), mime: String(info.mime_type ?? 'image/jpeg') }
    },
  }
}
```

```ts
// apps/edge-functions/supabase/functions/_shared/whatsapp/templates.ts
import { encodePayload } from './core.ts'
import type { TemplateButton } from './meta-client.ts'

export const TEMPLATES = {
  otp: 'esite_otp',
  optin: 'esite_optin',
  assigned: 'esite_item_assigned',
  due_tomorrow: 'esite_item_due_tomorrow',
  overdue: 'esite_item_overdue',
  fold: 'esite_items_waiting',
} as const

export interface ItemCard {
  itemId: string
  ref: string
  projectName: string
  title: string
  dueDate: string
  daysOverdue?: number
}

export interface TemplateSend {
  name: string
  body: string[]
  buttons: TemplateButton[]
}

/** Meta rejects template params containing newlines, tabs or more than 4 consecutive spaces. */
export function cleanParam(s: string): string {
  return String(s ?? '').replace(/[\n\t\r]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 900)
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function humanDate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export function itemCardSend(trigger: 'assigned' | 'due_tomorrow' | 'overdue', card: ItemCard): TemplateSend {
  const body = [cleanParam(card.ref), cleanParam(card.projectName), cleanParam(card.title), humanDate(card.dueDate)]
  if (trigger === 'overdue') body.push(String(card.daysOverdue ?? 1))
  return {
    name: TEMPLATES[trigger],
    body,
    buttons: [
      { type: 'quick_reply', index: 0, payload: encodePayload({ kind: 'ack', itemId: card.itemId }) },
      { type: 'quick_reply', index: 1, payload: encodePayload({ kind: 'done', itemId: card.itemId }) },
      { type: 'url', index: 2, suffix: card.itemId },
    ],
  }
}

export function otpSend(code: string): TemplateSend {
  return { name: TEMPLATES.otp, body: [code], buttons: [{ type: 'url', index: 0, suffix: code }] }
}

export function optinSend(inviterName: string, projectName: string, linkId: string): TemplateSend {
  return {
    name: TEMPLATES.optin,
    body: [cleanParam(inviterName), cleanParam(projectName)],
    buttons: [
      { type: 'quick_reply', index: 0, payload: encodePayload({ kind: 'optin', answer: 'yes', linkId }) },
      { type: 'quick_reply', index: 1, payload: encodePayload({ kind: 'optin', answer: 'no', linkId }) },
    ],
  }
}

export function foldSend(count: number): TemplateSend {
  return { name: TEMPLATES.fold, body: [String(count)], buttons: [] }
}
```

- [ ] **Step 4: Run to verify they pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts apps/edge-functions/supabase/functions/_shared/whatsapp/templates.ts apps/web/src/lib/whatsapp/meta-client.test.ts apps/web/src/lib/whatsapp/templates.test.ts
git commit -m "feat(whatsapp): Meta Graph client with error classes + template builders

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 11: Edge — the inbound processor

One inbound message becomes one outcome. The processor is pure orchestration over two injected ports, `ProcessorStore` and `MetaClient`, so every branch is unit-tested without a database.

**Files:**
- Create: `apps/edge-functions/supabase/functions/_shared/whatsapp/processor.ts`
- Test: `apps/web/src/lib/whatsapp/processor.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/whatsapp/processor.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processInbound, REPLIES, type ProcessorStore, type LinkRow, type ItemInfo, type InboundRow }
  from '../../../../edge-functions/supabase/functions/_shared/whatsapp/processor.ts'
import type { MetaClient } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts'

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LINK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const NOTE = '33333333-3333-4333-8333-333333333333'
const PHONE = '+27821234567'
const NOW = new Date('2026-10-01T10:00:00Z')

const items: Record<string, ItemInfo> = {
  [A]: { id: A, ref: 'T-1', title: 'Loose DB-3 cover', itemType: 'task', origin: 'manual', projectId: 'P', organisationId: 'O', snagId: null, status: 'open' },
  [B]: { id: B, ref: 'T-2', title: 'Label DB-4', itemType: 'task', origin: 'manual', projectId: 'P', organisationId: 'O', snagId: null, status: 'open' },
}

function link(over: Partial<LinkRow> = {}): LinkRow {
  return { id: LINK, user_id: USER, phone_e164: PHONE, status: 'active', active_item_id: null, active_item_at: null,
    pending_done_item_id: null, pending_done_at: null, pending_done_wants: null, pending_inbound_id: null,
    last_confirm_item_id: null, last_confirm_at: null, ...over }
}

function row(raw: Record<string, unknown>): InboundRow {
  return { id: 'in-1', meta_message_id: String(raw.id ?? 'wamid.IN'), from_e164: PHONE, raw: { id: 'wamid.IN', from: '27821234567', timestamp: '1', contextId: null, text: null, payload: null, imageId: null, imageMime: null, type: 'text', ...raw }, attempts: 1 }
}

let store: ProcessorStore & { calls: Array<[string, Record<string, unknown>]>; linkPatches: Array<Record<string, unknown>> }
let meta: MetaClient & { sent: Array<{ kind: string; to: string; body: string; extra?: unknown }> }
let rpc: Record<string, Record<string, unknown>>

beforeEach(() => {
  rpc = {}
  const calls: Array<[string, Record<string, unknown>]> = []
  const linkPatches: Array<Record<string, unknown>> = []
  let current: LinkRow | null = link()
  store = {
    calls, linkPatches,
    setLink(l: LinkRow | null) { current = l },
    linkByPhone: vi.fn(async () => current),
    updateLink: vi.fn(async (_id, patch) => { linkPatches.push(patch) }),
    itemForSentMessage: vi.fn(async (mid: string) => (mid === 'wamid.CARD-B' ? B : null)),
    itemInfo: vi.fn(async (id: string) => items[id] ?? null),
    call: vi.fn(async (fn: string, args: Record<string, unknown>) => { calls.push([fn, args]); return rpc[fn] ?? { code: 'ok', ref: 'T-1', id: NOTE } }),
    upload: vi.fn(async () => {}),
    unknownSenderRecentlyAnswered: vi.fn(async () => false),
    inboundById: vi.fn(async () => null),
    markInbound: vi.fn(async () => {}),
  } as never
  const sent: Array<{ kind: string; to: string; body: string; extra?: unknown }> = []
  meta = {
    sent,
    sendTemplate: vi.fn(),
    sendText: vi.fn(async (to: string, body: string) => { sent.push({ kind: 'text', to, body }); return 'o' }),
    sendButtons: vi.fn(async (to: string, body: string, buttons: unknown) => { sent.push({ kind: 'buttons', to, body, extra: buttons }); return 'o' }),
    sendList: vi.fn(async (to: string, body: string, _l: string, rows: unknown) => { sent.push({ kind: 'list', to, body, extra: rows }); return 'o' }),
    fetchMedia: vi.fn(async () => ({ bytes: new Uint8Array([1]), mime: 'image/jpeg' })),
  } as never
})

const deps = () => ({ store, meta, now: () => NOW, appUrl: 'https://www.e-site.live' })
const setLink = (l: LinkRow | null) => (store as unknown as { setLink(l: LinkRow | null): void }).setLink(l)

describe('senders and consent', () => {
  it('unknown number: one polite reply, no action', async () => {
    setLink(null)
    const r = await processInbound(row({ type: 'text', text: 'hello' }), deps())
    expect(r.outcome).toBe('unknown_sender')
    expect(meta.sent).toEqual([{ kind: 'text', to: PHONE, body: REPLIES.notLinked }])
    expect(store.calls).toEqual([])
  })
  it('unknown number already answered today: silence', async () => {
    setLink(null)
    ;(store.unknownSenderRecentlyAnswered as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true)
    await processInbound(row({ type: 'text', text: 'hello' }), deps())
    expect(meta.sent).toEqual([])
  })
  it('STOP opts out and confirms, from any link state', async () => {
    const r = await processInbound(row({ type: 'text', text: 'Stop' }), deps())
    expect(r).toMatchObject({ outcome: 'applied', reason: 'opted_out' })
    expect(store.linkPatches[0]).toMatchObject({ status: 'opted_out' })
    expect(meta.sent[0].body).toBe(REPLIES.optedOut)
  })
  it('an opted-out number gets no reply to ordinary messages', async () => {
    setLink(link({ status: 'opted_out' }))
    const r = await processInbound(row({ type: 'text', text: 'hi' }), deps())
    expect(r.reason).toBe('opted_out')
    expect(meta.sent).toEqual([])
  })
  it('START re-activates with fresh consent', async () => {
    setLink(link({ status: 'opted_out' }))
    await processInbound(row({ type: 'text', text: 'START' }), deps())
    expect(store.linkPatches[0]).toMatchObject({ status: 'active', consent_at: NOW.toISOString() })
  })
  it('pending opt-in: only the matching Yes activates', async () => {
    setLink(link({ status: 'pending_optin' }))
    rpc.wa_open_items = [{ id: A }, { id: B }] as never
    const r = await processInbound(row({ type: 'button', payload: `optin:yes:${LINK}` }), deps())
    expect(r.reason).toBe('opted_in')
    expect(store.linkPatches[0]).toMatchObject({ status: 'active', consent_at: NOW.toISOString(), verified_at: NOW.toISOString() })
    expect(meta.sent[0].body).toBe(REPLIES.optedIn(2))
  })
  it('pending opt-in: a Yes for ANOTHER link is refused', async () => {
    setLink(link({ status: 'pending_optin' }))
    const r = await processInbound(row({ type: 'button', payload: `optin:yes:${A}` }), deps())
    expect(r).toMatchObject({ outcome: 'refused', reason: 'pending_optin' })
    expect(store.linkPatches).toEqual([])
  })
  it('pending opt-in: No thanks opts out', async () => {
    setLink(link({ status: 'pending_optin' }))
    await processInbound(row({ type: 'button', payload: `optin:no:${LINK}` }), deps())
    expect(store.linkPatches[0]).toMatchObject({ status: 'opted_out' })
  })
})

describe('buttons', () => {
  it('Acknowledge calls wa_acknowledge as the linked user', async () => {
    rpc.wa_acknowledge = { code: 'ok', ref: 'T-1' }
    await processInbound(row({ type: 'button', payload: `ack:${A}` }), deps())
    expect(store.calls).toEqual([['wa_acknowledge', { p_user: USER, p_item: A }]])
    expect(meta.sent[0].body).toBe(REPLIES.acked('T-1'))
  })
  it('Mark done -> answered names the sign-off person', async () => {
    rpc.wa_mark_done = { code: 'ok', ref: 'T-1', status: 'answered', gatekeeper_name: 'Arno' }
    const r = await processInbound(row({ type: 'button', payload: `done:${A}` }), deps())
    expect(r.outcome).toBe('applied')
    expect(meta.sent[0].body).toBe(REPLIES.doneAnswered('T-1', 'Arno'))
  })
  it('Mark done refused by the guard relays the sentence', async () => {
    rpc.wa_mark_done = { code: 'refused', ref: 'T-1', message: 'Only the person who signs T-1 off can close it.' }
    const r = await processInbound(row({ type: 'button', payload: `done:${A}` }), deps())
    expect(r.outcome).toBe('refused')
    expect(meta.sent[0].body).toContain('Only the person who signs T-1 off')
  })
  it('Mark done needing a photo arms pending-done', async () => {
    rpc.wa_mark_done = { code: 'needs_photo', ref: 'SNAG-3' }
    await processInbound(row({ type: 'button', payload: `done:${A}` }), deps())
    expect(store.linkPatches[0]).toMatchObject({ pending_done_item_id: A, pending_done_wants: 'photo', pending_done_at: NOW.toISOString() })
    expect(meta.sent[0].body).toBe(REPLIES.needsPhoto('SNAG-3'))
  })
  it('Mark done on a module-owned mirror links out', async () => {
    rpc.wa_mark_done = { code: 'use_module', ref: 'INS-2' }
    await processInbound(row({ type: 'button', payload: `done:${A}` }), deps())
    expect(meta.sent[0].body).toBe(REPLIES.useModule('INS-2', `https://www.e-site.live/wa/${A}`))
  })
  it('Wrong item redacts, never moves', async () => {
    rpc.wa_redact = { code: 'ok', ref: 'T-1' }
    await processInbound(row({ type: 'interactive', payload: `wrong:note:${NOTE}` }), deps())
    expect(store.calls).toEqual([['wa_redact', { p_user: USER, p_kind: 'note', p_id: NOTE }]])
    expect(meta.sent[0].body).toBe(REPLIES.redacted('T-1'))
  })
})

describe('free content — never guess', () => {
  it('text with an active item becomes a note on it, with a Wrong-item button', async () => {
    setLink(link({ active_item_id: A, active_item_at: new Date(NOW.getTime() - 60_000).toISOString() }))
    rpc.wa_add_note = { code: 'ok', ref: 'T-1', id: NOTE }
    await processInbound(row({ type: 'text', text: 'Cover refitted' }), deps())
    expect(store.calls[0]).toEqual(['wa_add_note', { p_user: USER, p_item: A, p_body: 'Cover refitted', p_inbound: 'in-1' }])
    expect(meta.sent[0]).toMatchObject({ kind: 'buttons', body: REPLIES.noted('T-1'), extra: [{ id: `wrong:note:${NOTE}`, title: REPLIES.wrongItem }] })
  })
  it('a swipe-reply to item B\'s card goes to B even though A is active', async () => {
    setLink(link({ active_item_id: A, active_item_at: new Date(NOW.getTime() - 60_000).toISOString() }))
    await processInbound(row({ type: 'text', text: 'done', contextId: 'wamid.CARD-B' }), deps())
    expect(store.calls[0][1]).toMatchObject({ p_item: B })
  })
  it('no current item: asks which, stores the message, attaches NOTHING', async () => {
    rpc.wa_open_items = [{ id: A, ref: 'T-1', title: 'Loose DB-3 cover', project_name: 'K' }, { id: B, ref: 'T-2', title: 'Label', project_name: 'K' }] as never
    const r = await processInbound(row({ type: 'text', text: 'Cover refitted' }), deps())
    expect(r).toMatchObject({ outcome: 'unmatched', reason: 'picking' })
    expect(store.calls.map((c) => c[0])).toEqual(['wa_open_items'])
    expect(store.linkPatches[0]).toMatchObject({ pending_inbound_id: 'in-1' })
    expect(meta.sent[0].kind).toBe('list')
    expect((meta.sent[0].extra as Array<{ id: string }>).map((x) => x.id)).toEqual([`pick:${A}`, `pick:${B}`])
  })
  it('picking replays the held message onto the chosen item', async () => {
    setLink(link({ pending_inbound_id: 'in-0' }))
    ;(store.inboundById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row({ id: 'wamid.HELD', type: 'text', text: 'Cover refitted' }))
    rpc.wa_add_note = { code: 'ok', ref: 'T-2', id: NOTE }
    await processInbound(row({ type: 'interactive', payload: `pick:${B}` }), deps())
    expect(store.calls.find((c) => c[0] === 'wa_add_note')?.[1]).toMatchObject({ p_item: B, p_body: 'Cover refitted' })
    expect(store.markInbound).toHaveBeenCalledWith('in-1', expect.objectContaining({ outcome: 'applied', resolved_item_id: B }))
  })
  it('a photo is stored under the item\'s own org/project path, never a client path', async () => {
    setLink(link({ active_item_id: A, active_item_at: new Date(NOW.getTime() - 60_000).toISOString() }))
    rpc.wa_add_attachment = { code: 'ok', ref: 'T-1', id: NOTE }
    await processInbound(row({ id: 'wamid.PHOTO', type: 'image', imageId: 'MEDIA', imageMime: 'image/jpeg' }), deps())
    expect(store.upload).toHaveBeenCalledWith('work-item-attachments', `O/P/${A}/wa-wamid.PHOTO.jpg`, expect.any(Uint8Array), 'image/jpeg')
    expect(store.calls[0]).toEqual(['wa_add_attachment', { p_user: USER, p_item: A, p_bucket: 'work-item-attachments',
      p_path: `O/P/${A}/wa-wamid.PHOTO.jpg`, p_mime: 'image/jpeg', p_role: 'evidence', p_inbound: 'in-1' }])
  })
  it('a photo while Mark done waits for one is a CLOSEOUT and re-runs Mark done', async () => {
    setLink(link({ pending_done_item_id: A, pending_done_wants: 'photo', pending_done_at: new Date(NOW.getTime() - 60_000).toISOString() }))
    rpc.wa_add_attachment = { code: 'ok', ref: 'T-1', id: NOTE }
    rpc.wa_mark_done = { code: 'ok', ref: 'T-1', status: 'answered', gatekeeper_name: 'Arno' }
    await processInbound(row({ type: 'image', imageId: 'MEDIA', imageMime: 'image/jpeg' }), deps())
    expect(store.calls.map((c) => c[0])).toEqual(['wa_add_attachment', 'wa_mark_done'])
    expect(store.calls[0][1]).toMatchObject({ p_role: 'closeout' })
    expect(store.linkPatches.some((p) => p.pending_done_item_id === null)).toBe(true)
  })
  it('a second photo within 60 s to the same item is not re-confirmed', async () => {
    setLink(link({ active_item_id: A, active_item_at: new Date(NOW.getTime() - 60_000).toISOString(),
      last_confirm_item_id: A, last_confirm_at: new Date(NOW.getTime() - 20_000).toISOString() }))
    rpc.wa_add_attachment = { code: 'ok', ref: 'T-1', id: NOTE }
    await processInbound(row({ type: 'image', imageId: 'MEDIA', imageMime: 'image/jpeg' }), deps())
    expect(meta.sent).toEqual([])
  })
  it('voice notes and documents are declined politely', async () => {
    const r = await processInbound(row({ type: 'audio' }), deps())
    expect(r).toMatchObject({ outcome: 'refused', reason: 'unsupported_type' })
    expect(meta.sent[0].body).toBe(REPLIES.unsupported)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- src/lib/whatsapp/processor.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/edge-functions/supabase/functions/_shared/whatsapp/processor.ts
//
// One inbound WhatsApp message -> one outcome. Every domain write goes through
// a whatsapp.wa_* function, which acts AS the linked user under real RLS
// (migration 00207 part B). This file decides WHICH item and WHICH action;
// it never decides whether the user is ALLOWED — the database does.
import {
  BURST_WINDOW_MS, CONSENT_TEXT_VERSION, WRONG_ITEM_WINDOW_MS, classifyKeyword, decodePayload,
  encodePayload, isWithin, resolveTarget,
} from './core.ts'
import type { MetaClient } from './meta-client.ts'
import type { InboundMessage } from './parse.ts'

export interface LinkRow {
  id: string
  user_id: string
  phone_e164: string
  status: string
  active_item_id: string | null
  active_item_at: string | null
  pending_done_item_id: string | null
  pending_done_at: string | null
  pending_done_wants: 'photo' | 'answer' | null
  pending_inbound_id: string | null
  last_confirm_item_id: string | null
  last_confirm_at: string | null
}

export interface ItemInfo {
  id: string
  ref: string
  title: string
  itemType: string
  origin: string
  projectId: string
  organisationId: string
  snagId: string | null
  status: string
}

export interface InboundRow {
  id: string
  meta_message_id: string
  from_e164: string
  raw: unknown
  attempts: number
}

export type Outcome = 'applied' | 'refused' | 'unmatched' | 'unknown_sender'

export interface ProcessResult {
  outcome: Outcome
  reason: string | null
  userId: string | null
  itemId: string | null
}

// deno-lint-ignore no-explicit-any
type Rpc = any

export interface ProcessorStore {
  /** Prefers a live link (active / pending_optin), else the most recent for the number. */
  linkByPhone(e164: string): Promise<LinkRow | null>
  updateLink(id: string, patch: Record<string, unknown>): Promise<void>
  itemForSentMessage(metaMessageId: string): Promise<string | null>
  itemInfo(itemId: string): Promise<ItemInfo | null>
  call(fn: string, args: Record<string, unknown>): Promise<Rpc>
  upload(bucket: string, path: string, bytes: Uint8Array, mime: string): Promise<void>
  /** True if we already told this unknown number "not linked" in the last 24 h; otherwise records now and returns false. */
  unknownSenderRecentlyAnswered(e164: string, now: Date): Promise<boolean>
  inboundById(id: string): Promise<InboundRow | null>
  markInbound(id: string, patch: { outcome: Outcome; outcome_reason: string | null; resolved_user_id: string | null;
                                   resolved_item_id: string | null; processed_at: string }): Promise<void>
}

export interface ProcessorDeps {
  store: ProcessorStore
  meta: MetaClient
  now: () => Date
  appUrl: string
}

export const REPLIES = {
  notLinked: "This number isn't linked to E-Site. Ask your project manager to add you.",
  optinPrompt: 'Tap "Yes, I agree" on the invitation above to start receiving site items here.',
  optedIn: (n: number) => (n > 0
    ? `You're set up. You have ${n} open item${n === 1 ? '' : 's'} — they'll arrive here.`
    : "You're set up. New site items will arrive here."),
  optedOut: "You won't get E-Site messages on WhatsApp any more. Reply START to turn them back on.",
  restarted: 'E-Site messages are back on.',
  unsupported: 'E-Site can take photos and text messages here.',
  noOpen: 'You have no open items right now.',
  pickPrompt: 'Which item is this for?',
  pickButton: 'Choose item',
  acked: (ref: string) => `👍 Acknowledged ${ref}.`,
  doneAnswered: (ref: string, who: string | null) => `✅ ${ref} marked done — it's with ${who ?? 'the sign-off person'} to sign off.`,
  doneClosed: (ref: string) => `✅ ${ref} closed.`,
  alreadyClosed: (ref: string) => `${ref} is already closed.`,
  notHolder: (ref: string, who: string | null) => `${ref} is with ${who ?? 'someone else'} now — nothing for you to do on it.`,
  needsPhoto: (ref: string) => `Send the close-out photo for ${ref} to finish.`,
  needsAnswer: (ref: string) => `Reply with your answer to ${ref}.`,
  useModule: (ref: string, url: string) => `Finish ${ref} in E-Site: ${url}`,
  refused: (ref: string, msg: string) => `Couldn't update ${ref}: ${msg}`,
  noAccess: "You don't have access to that item any more.",
  notFound: "That item isn't available to you.",
  nothingChanged: (ref: string) => `Nothing changed on ${ref} — it may have moved on.`,
  noted: (ref: string) => `📝 Added to ${ref}.`,
  attached: (ref: string) => `📎 Attached to ${ref}.`,
  answered: (ref: string) => `✅ Answer recorded on ${ref}.`,
  redacted: (ref: string) => `Removed from ${ref}. Swipe right on the right item's card and send it again.`,
  redactLate: "That can't be removed here any more — ask the project manager.",
  wrongItem: 'Wrong item',
} as const

const result = (outcome: Outcome, reason: string | null, userId: string | null, itemId: string | null): ProcessResult =>
  ({ outcome, reason, userId, itemId })

function asMessage(raw: unknown): InboundMessage {
  return raw as InboundMessage
}

/** Replies for every non-ok wa_* code. Returns the outcome to record. */
async function replyForCode(deps: ProcessorDeps, to: string, r: Rpc, itemId: string, userId: string): Promise<ProcessResult> {
  const ref = r?.ref ?? 'that item'
  const send = (body: string) => deps.meta.sendText(to, body)
  switch (r?.code) {
    case 'already_closed': await send(REPLIES.alreadyClosed(ref)); break
    case 'not_holder': await send(REPLIES.notHolder(ref, r.holder_name ?? null)); break
    case 'no_access': await send(REPLIES.noAccess); break
    case 'not_found': await send(REPLIES.notFound); break
    case 'nothing_changed': await send(REPLIES.nothingChanged(ref)); break
    case 'use_module': await send(REPLIES.useModule(ref, `${deps.appUrl}/wa/${itemId}`)); break
    case 'refused': await send(REPLIES.refused(ref, String(r.message ?? 'not allowed'))); break
    default: await send(REPLIES.refused(ref, 'unexpected response'))
  }
  return result('refused', String(r?.code ?? 'unknown'), userId, itemId)
}

async function markDone(deps: ProcessorDeps, link: LinkRow, itemId: string): Promise<ProcessResult> {
  const { store, meta, now } = deps
  const to = link.phone_e164
  const r = await store.call('wa_mark_done', { p_user: link.user_id, p_item: itemId })
  if (r?.code === 'ok') {
    await store.updateLink(link.id, { pending_done_item_id: null, pending_done_at: null, pending_done_wants: null,
      active_item_id: itemId, active_item_at: now().toISOString() })
    await meta.sendText(to, r.status === 'closed' ? REPLIES.doneClosed(r.ref) : REPLIES.doneAnswered(r.ref, r.gatekeeper_name ?? null))
    return result('applied', `done_${r.status}`, link.user_id, itemId)
  }
  if (r?.code === 'needs_photo' || r?.code === 'needs_answer') {
    const wants = r.code === 'needs_photo' ? 'photo' : 'answer'
    await store.updateLink(link.id, { pending_done_item_id: itemId, pending_done_at: now().toISOString(),
      pending_done_wants: wants, active_item_id: itemId, active_item_at: now().toISOString() })
    await meta.sendText(to, wants === 'photo' ? REPLIES.needsPhoto(r.ref) : REPLIES.needsAnswer(r.ref))
    return result('applied', `awaiting_${wants}`, link.user_id, itemId)
  }
  return replyForCode(deps, to, r, itemId, link.user_id)
}

/** Attach a text or photo to a known item. `viaPendingDone` makes a photo a close-out / a text an answer. */
async function applyContent(deps: ProcessorDeps, link: LinkRow, inbound: InboundRow, msg: InboundMessage,
                            itemId: string, viaPendingDone: boolean): Promise<ProcessResult> {
  const { store, meta, now } = deps
  const to = link.phone_e164
  const item = await store.itemInfo(itemId)
  if (!item) {
    await meta.sendText(to, REPLIES.notFound)
    return result('refused', 'not_found', link.user_id, null)
  }

  if (msg.type === 'image' && msg.imageId) {
    const { bytes, mime } = await meta.fetchMedia(msg.imageId)
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
    // Snag mirrors keep their photos where the Snags module reads them (Phase 2, Task 22).
    const snagMirror = item.origin === 'mirror' && item.itemType === 'snag' && item.snagId
    const bucket = snagMirror ? 'snag-photos' : 'work-item-attachments'
    const folder = snagMirror ? item.snagId : item.id
    const path = `${item.organisationId}/${item.projectId}/${folder}/wa-${msg.id}.${ext}`
    await store.upload(bucket, path, bytes, mime)
    const r = await store.call('wa_add_attachment', { p_user: link.user_id, p_item: item.id, p_bucket: bucket,
      p_path: path, p_mime: mime, p_role: viaPendingDone ? 'closeout' : 'evidence', p_inbound: inbound.id })
    if (r?.code !== 'ok') return replyForCode(deps, to, r, item.id, link.user_id)
    if (msg.text) await store.call('wa_add_note', { p_user: link.user_id, p_item: item.id, p_body: msg.text, p_inbound: inbound.id })
    if (viaPendingDone) return markDone(deps, link, item.id)
    const burst = link.last_confirm_item_id === item.id && isWithin(link.last_confirm_at, now(), BURST_WINDOW_MS)
    if (!burst) {
      await meta.sendButtons(to, REPLIES.attached(r.ref),
        [{ id: encodePayload({ kind: 'wrong', target: 'attachment', id: r.id }), title: REPLIES.wrongItem }], msg.id)
    }
    await store.updateLink(link.id, { active_item_id: item.id, active_item_at: now().toISOString(),
      last_confirm_item_id: item.id, last_confirm_at: now().toISOString() })
    return result('applied', 'attachment', link.user_id, item.id)
  }

  if (msg.type === 'text' && msg.text) {
    if (viaPendingDone && link.pending_done_wants === 'answer') {
      const r = await store.call('wa_rfi_respond', { p_user: link.user_id, p_item: item.id, p_body: msg.text, p_inbound: inbound.id })
      if (r?.code !== 'ok') return replyForCode(deps, to, r, item.id, link.user_id)
      await store.updateLink(link.id, { pending_done_item_id: null, pending_done_at: null, pending_done_wants: null })
      await meta.sendText(to, REPLIES.answered(r.ref))
      return result('applied', 'answered', link.user_id, item.id)
    }
    const r = await store.call('wa_add_note', { p_user: link.user_id, p_item: item.id, p_body: msg.text, p_inbound: inbound.id })
    if (r?.code !== 'ok') return replyForCode(deps, to, r, item.id, link.user_id)
    await meta.sendButtons(to, REPLIES.noted(r.ref),
      [{ id: encodePayload({ kind: 'wrong', target: 'note', id: r.id }), title: REPLIES.wrongItem }], msg.id)
    await store.updateLink(link.id, { active_item_id: item.id, active_item_at: now().toISOString(),
      last_confirm_item_id: item.id, last_confirm_at: now().toISOString() })
    return result('applied', 'note', link.user_id, item.id)
  }

  await meta.sendText(to, REPLIES.unsupported)
  return result('refused', 'unsupported_type', link.user_id, item.id)
}

export async function processInbound(inbound: InboundRow, deps: ProcessorDeps): Promise<ProcessResult> {
  const { store, meta, now } = deps
  const msg = asMessage(inbound.raw)
  const from = inbound.from_e164
  const nowIso = now().toISOString()
  const keyword = msg.type === 'text' && msg.text ? classifyKeyword(msg.text) : null
  const link = await store.linkByPhone(from)

  if (keyword === 'stop') {
    if (link && link.status !== 'opted_out') await store.updateLink(link.id, { status: 'opted_out' })
    await meta.sendText(from, REPLIES.optedOut)
    return result('applied', 'opted_out', link?.user_id ?? null, null)
  }
  if (keyword === 'start' && link?.status === 'opted_out') {
    await store.updateLink(link.id, { status: 'active', consent_at: nowIso, consent_text_version: CONSENT_TEXT_VERSION })
    await meta.sendText(from, REPLIES.restarted)
    return result('applied', 'restarted', link.user_id, null)
  }
  if (link?.status === 'opted_out') return result('refused', 'opted_out', link.user_id, null)   // they said stop: silence
  if (!link || (link.status !== 'active' && link.status !== 'pending_optin')) {
    if (!(await store.unknownSenderRecentlyAnswered(from, now()))) await meta.sendText(from, REPLIES.notLinked)
    return result('unknown_sender', link ? `link_${link.status}` : 'no_link', null, null)
  }

  const payload = decodePayload(msg.payload)

  if (link.status === 'pending_optin') {
    if (payload?.kind === 'optin' && payload.linkId === link.id) {
      if (payload.answer === 'yes') {
        await store.updateLink(link.id, { status: 'active', consent_at: nowIso, verified_at: nowIso,
          consent_text_version: CONSENT_TEXT_VERSION })
        const open = await store.call('wa_open_items', { p_user: link.user_id })
        await meta.sendText(from, REPLIES.optedIn(Array.isArray(open) ? open.length : 0))
        return result('applied', 'opted_in', link.user_id, null)
      }
      await store.updateLink(link.id, { status: 'opted_out' })
      await meta.sendText(from, REPLIES.optedOut)
      return result('applied', 'declined', link.user_id, null)
    }
    await meta.sendText(from, REPLIES.optinPrompt)
    return result('refused', 'pending_optin', link.user_id, null)
  }

  // ── active link ──
  if (payload?.kind === 'optin') return result('refused', 'already_active', link.user_id, null)

  if (payload?.kind === 'ack') {
    const r = await store.call('wa_acknowledge', { p_user: link.user_id, p_item: payload.itemId })
    if (r?.code !== 'ok') return replyForCode(deps, from, r, payload.itemId, link.user_id)
    await store.updateLink(link.id, { active_item_id: payload.itemId, active_item_at: nowIso })
    await meta.sendText(from, REPLIES.acked(r.ref))
    return result('applied', 'acknowledged', link.user_id, payload.itemId)
  }

  if (payload?.kind === 'done') return markDone(deps, link, payload.itemId)

  if (payload?.kind === 'wrong') {
    const r = await store.call('wa_redact', { p_user: link.user_id, p_kind: payload.target, p_id: payload.id })
    await meta.sendText(from, r?.code === 'ok' ? REPLIES.redacted(r.ref) : REPLIES.redactLate)
    return result(r?.code === 'ok' ? 'applied' : 'refused', r?.code === 'ok' ? 'redacted' : 'redact_refused', link.user_id, null)
  }

  if (payload?.kind === 'pick') {
    await store.updateLink(link.id, { active_item_id: payload.itemId, active_item_at: nowIso, pending_inbound_id: null })
    const held = link.pending_inbound_id ? await store.inboundById(link.pending_inbound_id) : null
    if (!held) return result('applied', 'picked', link.user_id, payload.itemId)
    const heldResult = await applyContent(deps, link, held, asMessage(held.raw), payload.itemId, false)
    await store.markInbound(held.id, { outcome: heldResult.outcome, outcome_reason: `picked:${heldResult.reason}`,
      resolved_user_id: link.user_id, resolved_item_id: payload.itemId, processed_at: nowIso })
    return result('applied', 'picked', link.user_id, payload.itemId)
  }

  if (msg.type !== 'text' && msg.type !== 'image') {
    await meta.sendText(from, REPLIES.unsupported)
    return result('refused', 'unsupported_type', link.user_id, null)
  }

  const contextItemId = msg.contextId ? await store.itemForSentMessage(msg.contextId) : null
  const target = resolveTarget({
    payloadItemId: null, contextItemId,
    pendingDoneItemId: link.pending_done_item_id, pendingDoneAt: link.pending_done_at,
    pendingDoneWants: link.pending_done_wants,
    activeItemId: link.active_item_id, activeItemAt: link.active_item_at,
    isImage: msg.type === 'image', now: now(),
  })

  if (target.kind === 'pick') {
    const open = await store.call('wa_open_items', { p_user: link.user_id })
    const rows = Array.isArray(open) ? open : []
    if (rows.length === 0) {
      await meta.sendText(from, REPLIES.noOpen)
      return result('unmatched', 'no_open_items', link.user_id, null)
    }
    await store.updateLink(link.id, { pending_inbound_id: inbound.id })
    await meta.sendList(from, REPLIES.pickPrompt, REPLIES.pickButton,
      rows.map((x: { id: string; ref: string; title: string; project_name: string }) =>
        ({ id: encodePayload({ kind: 'pick', itemId: x.id }), title: x.ref, description: `${x.project_name} · ${x.title}` })))
    return result('unmatched', 'picking', link.user_id, null)
  }

  return applyContent(deps, link, inbound, msg, target.itemId, target.via === 'pending_done')
}

/** Claim and process pending inbound rows (webhook: fresh ones; worker: stragglers older than minAge). */
export async function processPending(
  deps: ProcessorDeps & { store: ProcessorStore & { claimInbound(limit: number, minAgeSeconds: number): Promise<InboundRow[]> } },
  limit = 20,
  minAgeSeconds = 0,
): Promise<number> {
  const rows = await deps.store.claimInbound(limit, minAgeSeconds)
  for (const inbound of rows) {
    try {
      const r = await processInbound(inbound, deps)
      await deps.store.markInbound(inbound.id, { outcome: r.outcome, outcome_reason: r.reason,
        resolved_user_id: r.userId, resolved_item_id: r.itemId, processed_at: deps.now().toISOString() })
    } catch (e) {
      // Left 'pending'; claim_inbound retries it (max 5 attempts) after 2 minutes.
      console.error('whatsapp: processing failed', inbound.id, e)
    }
  }
  return rows.length
}

export { WRONG_ITEM_WINDOW_MS }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web test -- src/lib/whatsapp/processor.test.ts`
Expected: PASS (all 23 tests).

- [ ] **Step 5: Mutation**

In `resolveTarget` (core.ts), make the `pick` branch return the active item even when it's stale. Then re-sync (`pnpm --filter @esite/shared sync:whatsapp`).
Expected: `no current item: asks which…` still passes, because the fixture has no active item. **Add** this test to prove the guard:

```ts
it('a STALE active item still forces a pick', async () => {
  setLink(link({ active_item_id: A, active_item_at: new Date(NOW.getTime() - 25 * 3600_000).toISOString() }))
  rpc.wa_open_items = [{ id: A, ref: 'T-1', title: 't', project_name: 'K' }] as never
  const r = await processInbound(row({ type: 'text', text: 'x' }), deps())
  expect(r.reason).toBe('picking')
})
```

With the mutation, this test must fail. Revert the mutation, re-sync, and confirm it passes.

- [ ] **Step 6: Commit**

```bash
git add apps/edge-functions/supabase/functions/_shared/whatsapp/processor.ts apps/web/src/lib/whatsapp/processor.test.ts
git commit -m "feat(whatsapp): inbound processor — consent, buttons, never-guess targeting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: Edge — the outbox worker

**Files:**
- Create: `apps/edge-functions/supabase/functions/_shared/whatsapp/worker.ts`
- Test: `apps/web/src/lib/whatsapp/worker.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/whatsapp/worker.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drainOutbox, type WorkerStore, type OutboxRow } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/worker.ts'
import { MetaError, type MetaClient } from '../../../../edge-functions/supabase/functions/_shared/whatsapp/meta-client.ts'

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const I = '11111111-1111-4111-8111-111111111111'
const L = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DAY = new Date('2026-10-01T08:00:00Z')      // 10:00 SAST
const NIGHT = new Date('2026-10-01T18:00:00Z')    // 20:00 SAST

const orow = (over: Partial<OutboxRow> = {}): OutboxRow =>
  ({ id: 'o1', user_id: U, work_item_id: I, link_id: null, trigger: 'assigned', payload: {}, attempts: 1, ...over })

let store: WorkerStore & { marks: Array<[string, Record<string, unknown>]> }
let meta: MetaClient
let rows: OutboxRow[]

beforeEach(() => {
  rows = [orow()]
  const marks: Array<[string, Record<string, unknown>]> = []
  store = {
    marks,
    sendingEnabled: vi.fn(async () => true),
    claim: vi.fn(async () => rows),
    activeLink: vi.fn(async () => ({ id: L, phone_e164: '+27821234567', status: 'active', quiet_start: '18:00:00', quiet_end: '06:30:00' })),
    linkById: vi.fn(async () => ({ id: L, phone_e164: '+27821234567', status: 'pending_optin' })),
    canReceive: vi.fn(async () => ({ ok: true, item_id: I, ref: 'T-1', title: 'Fix', project_name: 'K', due_date: '2026-10-03', days_overdue: 0 })),
    sentItemCountToday: vi.fn(async () => 0),
    enqueueFold: vi.fn(async () => {}),
    mark: vi.fn(async (id, patch) => { marks.push([id, patch]) }),
    setLinkActiveItem: vi.fn(async () => {}),
    markLinkUndeliverable: vi.fn(async () => {}),
    recordPolicyError: vi.fn(async () => {}),
  } as never
  meta = { sendTemplate: vi.fn(async () => 'wamid.OUT'), sendText: vi.fn(), sendButtons: vi.fn(), sendList: vi.fn(), fetchMedia: vi.fn() } as never
})

const run = (now = DAY) => drainOutbox({ store, meta, now: () => now })

describe('drainOutbox', () => {
  it('sends an assigned card and records the Meta id', async () => {
    const s = await run()
    expect(s.sent).toBe(1)
    expect(meta.sendTemplate).toHaveBeenCalledWith('+27821234567', 'esite_item_assigned', ['T-1', 'K', 'Fix', 'Sat 3 Oct'], expect.any(Array))
    expect(store.marks[0]).toEqual(['o1', expect.objectContaining({ status: 'sent', meta_message_id: 'wamid.OUT' })])
    expect(store.setLinkActiveItem).toHaveBeenCalledWith(L, I, DAY.toISOString())
  })
  it('platform switch off: suppresses, sends nothing', async () => {
    ;(store.sendingEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    await run()
    expect(meta.sendTemplate).not.toHaveBeenCalled()
    expect(store.marks[0][1]).toMatchObject({ status: 'suppressed', error_text: 'platform_disabled' })
  })
  it('quiet hours: holds until 06:30 SAST', async () => {
    const s = await run(NIGHT)
    expect(s.held).toBe(1)
    expect(meta.sendTemplate).not.toHaveBeenCalled()
    expect(store.marks[0][1]).toMatchObject({ status: 'held_quiet', send_after: '2026-10-02T04:30:00.000Z' })
  })
  it('lost access / ball moved: suppressed with the reason', async () => {
    ;(store.canReceive as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, reason: 'ball_moved' })
    await run()
    expect(store.marks[0][1]).toMatchObject({ status: 'suppressed', error_text: 'ball_moved' })
  })
  it('daily cap: suppresses and folds', async () => {
    ;(store.sentItemCountToday as ReturnType<typeof vi.fn>).mockResolvedValue(8)
    await run()
    expect(meta.sendTemplate).not.toHaveBeenCalled()
    expect(store.enqueueFold).toHaveBeenCalledWith(U, '2026-10-01')
    expect(store.marks[0][1]).toMatchObject({ status: 'suppressed', error_text: 'daily_cap' })
  })
  it('OTP goes out immediately even at night, and the code is scrubbed after', async () => {
    rows = [orow({ trigger: 'otp', work_item_id: null, link_id: L, payload: { code: '042917' } })]
    ;(store.linkById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: L, phone_e164: '+27821234567', status: 'pending_otp' })
    await run(NIGHT)
    expect(meta.sendTemplate).toHaveBeenCalledWith('+27821234567', 'esite_otp', ['042917'], expect.any(Array))
    expect(store.marks[0][1]).toMatchObject({ status: 'sent', payload: {} })
  })
  it('opt-in is only sent while the link is still pending', async () => {
    rows = [orow({ trigger: 'optin', work_item_id: null, link_id: L, payload: { inviter: 'Arno', project: 'K' } })]
    ;(store.linkById as ReturnType<typeof vi.fn>).mockResolvedValue({ id: L, phone_e164: '+27821234567', status: 'active' })
    await run()
    expect(meta.sendTemplate).not.toHaveBeenCalled()
    expect(store.marks[0][1]).toMatchObject({ status: 'suppressed', error_text: 'link_state' })
  })
  it('transient error: retry with backoff', async () => {
    ;(meta.sendTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(new MetaError(130429, 'rate', 'transient'))
    const s = await run()
    expect(s.retried).toBe(1)
    expect(store.marks[0][1]).toMatchObject({ status: 'retry', error_code: 130429, send_after: '2026-10-01T08:01:00.000Z' })
  })
  it('transient error on the 5th attempt: failed', async () => {
    rows = [orow({ attempts: 5 })]
    ;(meta.sendTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(new MetaError(131000, 'x', 'transient'))
    await run()
    expect(store.marks[0][1]).toMatchObject({ status: 'failed' })
  })
  it('recipient error: failed + link undeliverable', async () => {
    ;(meta.sendTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(new MetaError(131026, 'undeliverable', 'recipient'))
    await run()
    expect(store.markLinkUndeliverable).toHaveBeenCalledWith(L, '131026 undeliverable')
    expect(store.marks[0][1]).toMatchObject({ status: 'failed' })
  })
  it('policy error: failed + recorded for admins', async () => {
    ;(meta.sendTemplate as ReturnType<typeof vi.fn>).mockRejectedValue(new MetaError(132015, 'template paused', 'policy'))
    await run()
    expect(store.recordPolicyError).toHaveBeenCalledWith('132015 template paused')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- src/lib/whatsapp/worker.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/edge-functions/supabase/functions/_shared/whatsapp/worker.ts
import { DAILY_ITEM_CAP, nextSendTime, sastDate } from './core.ts'
import { MetaError, type MetaClient } from './meta-client.ts'
import { foldSend, itemCardSend, optinSend, otpSend, type TemplateSend } from './templates.ts'

export interface OutboxRow {
  id: string
  user_id: string
  work_item_id: string | null
  link_id: string | null
  trigger: 'assigned' | 'due_tomorrow' | 'overdue' | 'otp' | 'optin' | 'fold'
  // deno-lint-ignore no-explicit-any
  payload: any
  attempts: number
}

export interface ActiveLink { id: string; phone_e164: string; status: string; quiet_start: string; quiet_end: string }

export interface ReceiveCheck {
  ok: boolean
  reason?: string
  item_id?: string
  ref?: string
  title?: string
  project_name?: string
  due_date?: string
  days_overdue?: number
}

export interface WorkerStore {
  sendingEnabled(): Promise<boolean>
  claim(limit: number): Promise<OutboxRow[]>
  activeLink(userId: string): Promise<ActiveLink | null>
  linkById(id: string): Promise<{ id: string; phone_e164: string; status: string } | null>
  canReceive(userId: string, itemId: string): Promise<ReceiveCheck>
  sentItemCountToday(userId: string, sastDay: string): Promise<number>
  enqueueFold(userId: string, sastDay: string): Promise<void>
  mark(id: string, patch: Record<string, unknown>): Promise<void>
  setLinkActiveItem(linkId: string, itemId: string, atIso: string): Promise<void>
  markLinkUndeliverable(linkId: string, reason: string): Promise<void>
  recordPolicyError(text: string): Promise<void>
}

export interface DrainStats { sent: number; held: number; suppressed: number; failed: number; retried: number }

const MAX_ATTEMPTS = 5
type Kind = keyof DrainStats

export async function drainOutbox(deps: { store: WorkerStore; meta: MetaClient; now: () => Date }): Promise<DrainStats> {
  const stats: DrainStats = { sent: 0, held: 0, suppressed: 0, failed: 0, retried: 0 }
  const enabled = await deps.store.sendingEnabled()
  const rows = await deps.store.claim(50)
  for (const row of rows) {
    const kind: Kind = enabled
      ? await sendOne(row, deps)
      : (await deps.store.mark(row.id, { status: 'suppressed', error_text: 'platform_disabled' }), 'suppressed')
    stats[kind]++
  }
  return stats
}

async function sendOne(row: OutboxRow, deps: { store: WorkerStore; meta: MetaClient; now: () => Date }): Promise<Kind> {
  const { store, meta, now } = deps
  const suppress = async (reason: string): Promise<Kind> => {
    await store.mark(row.id, { status: 'suppressed', error_text: reason })
    return 'suppressed'
  }

  let to: string
  let linkId: string
  let send: TemplateSend
  let itemId: string | null = null

  if (row.trigger === 'otp' || row.trigger === 'optin') {
    const link = row.link_id ? await store.linkById(row.link_id) : null
    const wanted = row.trigger === 'otp' ? 'pending_otp' : 'pending_optin'
    if (!link || link.status !== wanted) return suppress('link_state')
    to = link.phone_e164
    linkId = link.id
    send = row.trigger === 'otp'
      ? otpSend(String(row.payload?.code ?? ''))
      : optinSend(String(row.payload?.inviter ?? 'Your project manager'), String(row.payload?.project ?? 'your project'), link.id)
  } else {
    const link = await store.activeLink(row.user_id)
    if (!link) return suppress('no_link')
    const at = nextSendTime(now(), link.quiet_start, link.quiet_end)
    if (at.getTime() > now().getTime()) {
      await store.mark(row.id, { status: 'held_quiet', send_after: at.toISOString() })
      return 'held'
    }
    to = link.phone_e164
    linkId = link.id
    if (row.trigger === 'fold') {
      send = foldSend(Number(row.payload?.count ?? 1))
    } else {
      if (!row.work_item_id) return suppress('no_item')
      const chk = await store.canReceive(row.user_id, row.work_item_id)
      if (!chk.ok) return suppress(chk.reason ?? 'not_receivable')
      const day = sastDate(now())
      if ((await store.sentItemCountToday(row.user_id, day)) >= DAILY_ITEM_CAP) {
        await store.enqueueFold(row.user_id, day)
        return suppress('daily_cap')
      }
      itemId = row.work_item_id
      send = itemCardSend(row.trigger, { itemId, ref: chk.ref!, projectName: chk.project_name!, title: chk.title!,
        dueDate: chk.due_date!, daysOverdue: row.payload?.days_overdue ?? chk.days_overdue })
    }
  }

  try {
    const mid = await meta.sendTemplate(to, send.name, send.body, send.buttons)
    await store.mark(row.id, { status: 'sent', meta_message_id: mid, sent_at: now().toISOString(),
      error_code: null, error_text: null, ...(row.trigger === 'otp' ? { payload: {} } : {}) })
    if (itemId) await store.setLinkActiveItem(linkId, itemId, now().toISOString())
    return 'sent'
  } catch (e) {
    const err = e instanceof MetaError ? e : new MetaError(0, String((e as Error)?.message ?? e), 'transient')
    const text = `${err.code} ${err.message}`
    if (err.klass === 'transient' && row.attempts < MAX_ATTEMPTS) {
      const after = new Date(now().getTime() + 60_000 * 2 ** (row.attempts - 1))
      await store.mark(row.id, { status: 'retry', send_after: after.toISOString(), error_code: err.code, error_text: text })
      return 'retried'
    }
    if (err.klass === 'recipient') await store.markLinkUndeliverable(linkId, text)
    if (err.klass === 'policy') await store.recordPolicyError(text)
    await store.mark(row.id, { status: 'failed', error_code: err.code, error_text: text })
    return 'failed'
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web test -- src/lib/whatsapp/worker.test.ts`
Expected: PASS. (`2026-10-03` is a Saturday, which is why the card reads `Sat 3 Oct`.)

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/functions/_shared/whatsapp/worker.ts apps/web/src/lib/whatsapp/worker.test.ts
git commit -m "feat(whatsapp): outbox worker — quiet hours, daily cap + fold, classified retries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13: Edge — Supabase store, the two functions, deploy.sh

**Files:**
- Create: `apps/edge-functions/supabase/functions/_shared/whatsapp/store.ts`
- Create: `apps/edge-functions/supabase/functions/whatsapp-webhook/index.ts`
- Create: `apps/edge-functions/supabase/functions/whatsapp-worker/index.ts`
- Modify: `apps/edge-functions/deploy.sh` (the `FUNCTIONS=(` table)
- Modify: `apps/edge-functions/supabase/functions/_shared/auth.ts` (`FUNCTIONS_REQUIRING_GATEWAY_JWT`)
- Test: `apps/web/src/lib/whatsapp/webhook-handler.test.ts`

- [ ] **Step 1: Write the failing handler tests**

```ts
// apps/web/src/lib/whatsapp/webhook-handler.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

const FN = '../../../../edge-functions/supabase/functions/whatsapp-webhook/index.ts'
const STORE = '../../../../edge-functions/supabase/functions/_shared/whatsapp/store.ts'
const PROC = '../../../../edge-functions/supabase/functions/_shared/whatsapp/processor.ts'
const env: Record<string, string> = { WHATSAPP_APP_SECRET: 'sec', WHATSAPP_VERIFY_TOKEN: 'vt', SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: 'p' }

let storeInbound: ReturnType<typeof vi.fn>
let applyStatuses: ReturnType<typeof vi.fn>
let processPending: ReturnType<typeof vi.fn>

async function load() {
  vi.resetModules()
  ;(globalThis as Record<string, unknown>).Deno = { env: { get: (k: string) => env[k] }, serve: () => {} }
  storeInbound = vi.fn(async () => {})
  applyStatuses = vi.fn(async () => {})
  processPending = vi.fn(async () => 0)
  vi.doMock('https://esm.sh/@supabase/supabase-js@2', () => ({ createClient: () => ({}) }))
  vi.doMock(STORE, () => ({ storeInbound, applyStatuses, createProcessorStore: () => ({}) }))
  vi.doMock(PROC, async (orig) => ({ ...(await orig<object>()), processPending }))
  return (await import(FN)).handler as (r: Request) => Promise<Response>
}

const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1', from: '27821234567', timestamp: '1', type: 'text', text: { body: 'hi' } }] } }] }] })
const sig = (b: string, s = 'sec') => 'sha256=' + createHmac('sha256', s).update(b).digest('hex')

describe('whatsapp-webhook handler', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('answers the verify handshake only with the right token', async () => {
    const h = await load()
    const ok = await h(new Request('https://f/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42'))
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('42')
    const bad = await h(new Request('https://f/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42'))
    expect(bad.status).toBe(403)
  })

  it('rejects an unsigned POST before touching the database', async () => {
    const h = await load()
    const r = await h(new Request('https://f', { method: 'POST', body }))
    expect(r.status).toBe(401)
    expect(storeInbound).not.toHaveBeenCalled()
  })

  it('rejects a POST signed with the wrong secret', async () => {
    const h = await load()
    const r = await h(new Request('https://f', { method: 'POST', body, headers: { 'x-hub-signature-256': sig(body, 'other') } }))
    expect(r.status).toBe(401)
    expect(storeInbound).not.toHaveBeenCalled()
  })

  it('stores, then processes, then 200s for a signed POST', async () => {
    const h = await load()
    const r = await h(new Request('https://f', { method: 'POST', body, headers: { 'x-hub-signature-256': sig(body) } }))
    expect(r.status).toBe(200)
    expect(storeInbound).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ id: 'wamid.1', text: 'hi' })])
    expect(processPending).toHaveBeenCalled()
  })

  it('fails closed when the app secret is not configured', async () => {
    env.WHATSAPP_APP_SECRET = ''
    const h = await load()
    const r = await h(new Request('https://f', { method: 'POST', body, headers: { 'x-hub-signature-256': sig(body, '') } }))
    expect(r.status).toBe(401)
    env.WHATSAPP_APP_SECRET = 'sec'
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- src/lib/whatsapp/webhook-handler.test.ts`
Expected: FAIL (the module is not found).

- [ ] **Step 3: Write the store (Supabase glue)**

```ts
// apps/edge-functions/supabase/functions/_shared/whatsapp/store.ts
// Supabase-backed ports for processor.ts and worker.ts. Thin by design: every
// decision lives in the pure modules or in SQL. Uses the service client.
import { fromMetaWaId } from './core.ts'
import type { InboundMessage, StatusUpdate } from './parse.ts'
import type { InboundRow, ItemInfo, LinkRow, ProcessorStore } from './processor.ts'
import type { OutboxRow, WorkerStore } from './worker.ts'
import { classifyMetaError } from './meta-client.ts'

// deno-lint-ignore no-explicit-any
type Sb = any
const wa = (sb: Sb) => sb.schema('whatsapp')
const LIVE = ['active', 'pending_optin']

function must<T>(r: { data: T; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`)
  return r.data
}

export async function storeInbound(sb: Sb, messages: InboundMessage[]): Promise<void> {
  if (messages.length === 0) return
  const rows = messages.map((m) => ({
    meta_message_id: m.id, from_e164: fromMetaWaId(m.from) ?? `+${m.from}`, raw: m, kind: m.type, context_message_id: m.contextId,
  }))
  must(await wa(sb).from('inbound').upsert(rows, { onConflict: 'meta_message_id', ignoreDuplicates: true }), 'store inbound')
}

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 }

export async function applyStatuses(sb: Sb, statuses: StatusUpdate[]): Promise<void> {
  for (const s of statuses) {
    const cur = must(await wa(sb).from('outbox').select('id, status, link_id, user_id').eq('meta_message_id', s.id).maybeSingle(), 'status lookup')
    if (!cur) continue
    if (s.status === 'failed') {
      must(await wa(sb).from('outbox').update({ status: 'failed', error_code: s.errorCode, error_text: s.errorTitle, updated_at: new Date().toISOString() }).eq('id', cur.id), 'status failed')
      if (s.errorCode !== null && classifyMetaError(s.errorCode, 200) === 'recipient') {
        must(await wa(sb).from('phone_links').update({ status: 'undeliverable', undeliverable_reason: `${s.errorCode} ${s.errorTitle ?? ''}`.trim() })
          .eq('user_id', cur.user_id).eq('status', 'active'), 'mark undeliverable')
      }
      continue
    }
    if ((RANK[s.status] ?? 0) > (RANK[cur.status] ?? 0)) {
      must(await wa(sb).from('outbox').update({ status: s.status, updated_at: new Date().toISOString() }).eq('id', cur.id), 'status advance')
    }
  }
}

export function createProcessorStore(sb: Sb): ProcessorStore & { claimInbound(limit: number, minAgeSeconds: number): Promise<InboundRow[]> } {
  return {
    async linkByPhone(e164) {
      const rows = must(await wa(sb).from('phone_links').select('*').eq('phone_e164', e164).order('created_at', { ascending: false }), 'link lookup') as LinkRow[]
      return rows.find((r) => LIVE.includes(r.status)) ?? rows[0] ?? null
    },
    async updateLink(id, patch) {
      must(await wa(sb).from('phone_links').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id), 'update link')
    },
    async itemForSentMessage(mid) {
      const r = must(await wa(sb).from('outbox').select('work_item_id').eq('meta_message_id', mid).maybeSingle(), 'context lookup')
      return r?.work_item_id ?? null
    },
    async itemInfo(id): Promise<ItemInfo | null> {
      const r = must(await sb.schema('projects').from('work_items')
        .select('id, ref, title, item_type, origin, project_id, organisation_id, snag_id, status').eq('id', id).maybeSingle(), 'item lookup')
      return r ? { id: r.id, ref: r.ref, title: r.title, itemType: r.item_type, origin: r.origin, projectId: r.project_id,
                   organisationId: r.organisation_id, snagId: r.snag_id, status: r.status } : null
    },
    async call(fn, args) {
      return must(await wa(sb).rpc(fn, args), fn)
    },
    async upload(bucket, path, bytes, mime) {
      const { error } = await sb.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false })
      if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`upload: ${error.message}`)
    },
    async unknownSenderRecentlyAnswered(e164, now) {
      const r = must(await wa(sb).from('unknown_senders').select('last_replied_at').eq('phone_e164', e164).maybeSingle(), 'unknown lookup')
      if (r && now.getTime() - Date.parse(r.last_replied_at) < 86_400_000) return true
      must(await wa(sb).from('unknown_senders').upsert({ phone_e164: e164, last_replied_at: now.toISOString() }, { onConflict: 'phone_e164' }), 'unknown record')
      return false
    },
    async inboundById(id) {
      return must(await wa(sb).from('inbound').select('id, meta_message_id, from_e164, raw, attempts').eq('id', id).maybeSingle(), 'inbound lookup')
    },
    async markInbound(id, patch) {
      must(await wa(sb).from('inbound').update(patch).eq('id', id), 'mark inbound')
    },
    async claimInbound(limit, minAgeSeconds) {
      return must(await wa(sb).rpc('claim_inbound', { p_limit: limit, p_min_age_seconds: minAgeSeconds }), 'claim inbound') ?? []
    },
  }
}

export function createWorkerStore(sb: Sb): WorkerStore {
  return {
    async sendingEnabled() {
      const r = must(await wa(sb).from('settings').select('sending_enabled').eq('id', true).maybeSingle(), 'settings')
      return Boolean(r?.sending_enabled)
    },
    async claim(limit) {
      return (must(await wa(sb).rpc('claim_outbox', { p_limit: limit }), 'claim outbox') ?? []) as OutboxRow[]
    },
    async activeLink(userId) {
      return must(await wa(sb).from('phone_links').select('id, phone_e164, status, quiet_start, quiet_end')
        .eq('user_id', userId).eq('status', 'active').maybeSingle(), 'active link')
    },
    async linkById(id) {
      return must(await wa(sb).from('phone_links').select('id, phone_e164, status').eq('id', id).maybeSingle(), 'link by id')
    },
    async canReceive(userId, itemId) {
      return must(await wa(sb).rpc('receive_check', { p_user: userId, p_item: itemId }), 'receive check')
    },
    async sentItemCountToday(userId, sastDay) {
      const dayStartUtc = new Date(Date.parse(sastDay + 'T00:00:00Z') - 2 * 3600_000).toISOString()
      const { count, error } = await wa(sb).from('outbox').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).in('trigger', ['assigned', 'due_tomorrow', 'overdue'])
        .in('status', ['sent', 'delivered', 'read']).gte('sent_at', dayStartUtc)
      if (error) throw new Error(`count: ${error.message}`)
      return count ?? 0
    },
    async enqueueFold(userId, sastDay) {
      must(await wa(sb).rpc('enqueue_fold', { p_user: userId, p_day: sastDay }), 'enqueue fold')
    },
    async mark(id, patch) {
      must(await wa(sb).from('outbox').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id), 'mark outbox')
    },
    async setLinkActiveItem(linkId, itemId, atIso) {
      must(await wa(sb).from('phone_links').update({ active_item_id: itemId, active_item_at: atIso }).eq('id', linkId), 'active item')
    },
    async markLinkUndeliverable(linkId, reason) {
      must(await wa(sb).from('phone_links').update({ status: 'undeliverable', undeliverable_reason: reason }).eq('id', linkId), 'undeliverable')
    },
    async recordPolicyError(text) {
      console.error('whatsapp policy error:', text)
      must(await wa(sb).from('settings').update({ last_policy_error_at: new Date().toISOString(), last_policy_error: text }).eq('id', true), 'policy error')
    },
  }
}
```

- [ ] **Step 4: Write the two functions**

```ts
// apps/edge-functions/supabase/functions/whatsapp-webhook/index.ts
//
// Meta WhatsApp Cloud API webhook. Deployed --no-verify-jwt because Meta sends
// no Supabase JWT. It authenticates Meta by PROVING the X-Hub-Signature-256
// HMAC over the raw body with WHATSAPP_APP_SECRET — it must never import
// requireServiceRole (edge-function-jwt.contract.test.ts enforces this).
// Order: verify -> store verbatim -> 200; processing runs after via waitUntil,
// so a processing crash can never lose a message (claim_inbound retries it).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyMetaSignature } from '../_shared/whatsapp/signature.ts'
import { parseWebhook } from '../_shared/whatsapp/parse.ts'
import { createMetaClient } from '../_shared/whatsapp/meta-client.ts'
import { applyStatuses, createProcessorStore, storeInbound } from '../_shared/whatsapp/store.ts'
import { processPending } from '../_shared/whatsapp/processor.ts'

const env = (k: string) => Deno.env.get(k) ?? ''

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'GET') {
    const u = new URL(req.url)
    const token = env('WHATSAPP_VERIFY_TOKEN')
    if (token && u.searchParams.get('hub.mode') === 'subscribe' && u.searchParams.get('hub.verify_token') === token) {
      return new Response(u.searchParams.get('hub.challenge') ?? '', { status: 200 })
    }
    return new Response('forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const raw = new Uint8Array(await req.arrayBuffer())
  if (!(await verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), env('WHATSAPP_APP_SECRET')))) {
    console.warn('whatsapp-webhook: rejected unsigned or mis-signed POST')
    return new Response('invalid signature', { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return new Response('bad json', { status: 400 })
  }

  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
  const { messages, statuses } = parseWebhook(body)
  await storeInbound(sb, messages)
  await applyStatuses(sb, statuses)

  const deps = {
    store: createProcessorStore(sb),
    meta: createMetaClient({ token: env('WHATSAPP_TOKEN'), phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID') }),
    now: () => new Date(),
    appUrl: env('APP_URL') || 'https://www.e-site.live',
  }
  const work = processPending(deps, 20, 0).catch((e) => console.error('whatsapp-webhook: processing failed', e))
  const rt = (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(work)
  else await work
  return new Response('ok', { status: 200 })
}

Deno.serve(handler)
```

```ts
// apps/edge-functions/supabase/functions/whatsapp-worker/index.ts
//
// Drains the WhatsApp outbox and retries stuck inbound rows. Called by pg_cron
// every minute (docs/whatsapp-runbook.md) and kicked by web actions for OTP /
// opt-in immediacy. Gateway JWT verification ON; requireServiceRole decodes the
// already-verified role claim.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireServiceRole } from '../_shared/auth.ts'
import { createMetaClient } from '../_shared/whatsapp/meta-client.ts'
import { createProcessorStore, createWorkerStore } from '../_shared/whatsapp/store.ts'
import { drainOutbox } from '../_shared/whatsapp/worker.ts'
import { processPending } from '../_shared/whatsapp/processor.ts'

const env = (k: string) => Deno.env.get(k) ?? ''

export const handler = async (req: Request): Promise<Response> => {
  const denied = requireServiceRole(req)
  if (denied) return denied
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
  const meta = createMetaClient({ token: env('WHATSAPP_TOKEN'), phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID') })
  const now = () => new Date()
  try {
    const drained = await drainOutbox({ store: createWorkerStore(sb), meta, now })
    const retried = await processPending({ store: createProcessorStore(sb), meta, now,
      appUrl: env('APP_URL') || 'https://www.e-site.live' }, 20, 30)
    return new Response(JSON.stringify({ drained, retried }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('whatsapp-worker error:', e)
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}

Deno.serve(handler)
```

- [ ] **Step 5: Register both in deploy.sh and auth.ts**

In `apps/edge-functions/deploy.sh`, inside `FUNCTIONS=(`:
- Add `"whatsapp-worker:"` under the `# ── Gateway verifies the JWT.` group.
- Add these lines under the `# ── No gateway verification, deliberately.` group:

```bash
    # whatsapp-webhook: Meta sends no JWT. Authenticates by PROVING the
    # X-Hub-Signature-256 HMAC (WHATSAPP_APP_SECRET). Never imports requireServiceRole.
    "whatsapp-webhook:--no-verify-jwt"
```

In `apps/edge-functions/supabase/functions/_shared/auth.ts`, add `'whatsapp-worker'` to the `FUNCTIONS_REQUIRING_GATEWAY_JWT` array, keeping its alphabetical order.

- [ ] **Step 6: Run the handler test and the JWT contract**

Run: `pnpm --filter web test -- src/lib/whatsapp/webhook-handler.test.ts src/lib/edge-function-jwt.contract.test.ts`
Expected: PASS.

If the contract fails with "lists EVERY function directory", a slug in deploy.sh is misspelled. If it fails with "decode-only-guarded function with --no-verify-jwt", the webhook imported `_shared/auth.ts`; remove that import.

- [ ] **Step 7: Type-check**

Run: `pnpm --filter web type-check`
Expected: 0 errors.

If TS5097 (`.ts` import extensions) appears for the new edge files, look at how `marketplace-payment-split.test.ts`'s imports type-check today (tsconfig `include`/`exclude` or `allowImportingTsExtensions`), and apply the same treatment. Do not add `// @ts-ignore`.

- [ ] **Step 8: Commit**

```bash
git add apps/edge-functions/supabase/functions/_shared/whatsapp/store.ts apps/edge-functions/supabase/functions/whatsapp-webhook apps/edge-functions/supabase/functions/whatsapp-worker apps/edge-functions/deploy.sh apps/edge-functions/supabase/functions/_shared/auth.ts apps/web/src/lib/whatsapp/webhook-handler.test.ts
git commit -m "feat(whatsapp): webhook (HMAC, --no-verify-jwt) + worker (service role) edge functions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Task 14: Web — personal number linking (OTP) actions

**Files:**
- Create: `apps/web/src/lib/whatsapp/otp.ts`
- Create: `apps/web/src/lib/whatsapp/kick-worker.ts`
- Create: `apps/web/src/lib/whatsapp/fake-supabase.ts` (test helper, no `.test.` in the name, so it can be imported)
- Create: `apps/web/src/actions/whatsapp-link.actions.ts`
- Test: `apps/web/src/actions/whatsapp-link.actions.test.ts`

- [ ] **Step 1: Write the helpers**

```ts
// apps/web/src/lib/whatsapp/otp.ts
import 'server-only'
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'

/** Six digits, uniformly random, zero-padded. */
export function newOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** Bound to the link so a hash cannot be replayed onto another row. The code itself is never stored. */
export function hashOtp(linkId: string, code: string): string {
  return createHash('sha256').update(`${linkId}:${code}`).digest('hex')
}

export function otpMatches(linkId: string, code: string, storedHash: string | null): boolean {
  if (!storedHash || !/^\d{6}$/.test(code)) return false
  const a = Buffer.from(hashOtp(linkId, code), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
```

```ts
// apps/web/src/lib/whatsapp/kick-worker.ts
import 'server-only'

/**
 * Nudge the whatsapp-worker edge function so an OTP or opt-in goes out now
 * rather than on the next per-minute cron tick. Never throws: the cron is the
 * backstop, so a failed kick only delays the message. Same shape as
 * lib/notifications.ts's call to send-notification.
 */
export async function kickWhatsAppWorker(reason: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    await fetch(`${url}/functions/v1/whatsapp-worker`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
  } catch (e) {
    console.error('kickWhatsAppWorker failed (cron will retry):', e)
  }
}
```

```ts
// apps/web/src/lib/whatsapp/fake-supabase.ts
// Test-only chainable fake. `responses['<table>:<op>']` is a queue of
// { data, error } results consumed in order; `calls` records every chain step.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function fakeSupabase(responses: Record<string, Array<{ data?: any; error?: any; count?: number }>> = {}) {
  const calls: Array<{ table: string; op: string; args: any[] }> = []
  const next = (key: string) => {
    const q = responses[key]
    return Promise.resolve(q && q.length ? { data: null, error: null, ...q.shift() } : { data: null, error: null })
  }
  function from(table: string) {
    let op = 'select'
    const b: any = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'gte', 'lte', 'is', 'not', 'or']) {
      b[m] = (...args: any[]) => { calls.push({ table, op: m, args }); return b }
    }
    for (const m of ['insert', 'update', 'upsert', 'delete']) {
      b[m] = (...args: any[]) => { op = m; calls.push({ table, op: m, args }); return b }
    }
    b.single = () => next(`${table}:${op}`)
    b.maybeSingle = () => next(`${table}:${op}`)
    b.then = (ok: any, bad: any) => next(`${table}:${op}`).then(ok, bad)
    return b
  }
  const rpc = (fn: string, args: any) => { calls.push({ table: 'rpc', op: fn, args: [args] }); return next(`rpc:${fn}`) }
  return { calls, from, rpc, schema: () => ({ from, rpc }) }
}
```

- [ ] **Step 2: Write the failing action tests**

```ts
// apps/web/src/actions/whatsapp-link.actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/whatsapp/fake-supabase'
import { hashOtp } from '@/lib/whatsapp/otp'

const { createClientMock, createServiceClientMock, kickMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(), createServiceClientMock: vi.fn(), kickMock: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, createServiceClient: createServiceClientMock }))
vi.mock('@/lib/whatsapp/kick-worker', () => ({ kickWhatsAppWorker: kickMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { requestWhatsAppCodeAction, confirmWhatsAppCodeAction, removeWhatsAppLinkAction } from './whatsapp-link.actions'

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const LINK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const signedIn = () => createClientMock.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } })

beforeEach(() => { vi.clearAllMocks(); signedIn() })

describe('requestWhatsAppCodeAction', () => {
  it('refuses an implausible number without touching the database', async () => {
    const svc = fakeSupabase(); createServiceClientMock.mockReturnValue(svc)
    expect(await requestWhatsAppCodeAction({ phone: '12' })).toEqual({ error: 'Enter a valid mobile number, e.g. 082 123 4567.' })
    expect(svc.calls).toEqual([])
  })
  it('refuses a number already live on ANOTHER account', async () => {
    const svc = fakeSupabase({ 'phone_links:select': [{ data: [{ id: 'x', user_id: 'someone-else', status: 'active' }] }] })
    createServiceClientMock.mockReturnValue(svc)
    const r = await requestWhatsAppCodeAction({ phone: '082 123 4567' })
    expect(r).toEqual({ error: 'That number is already linked to another E-Site account.' })
    expect(kickMock).not.toHaveBeenCalled()
  })
  it('stores a HASH (never the code), queues the OTP, kicks the worker', async () => {
    const svc = fakeSupabase({
      'phone_links:select': [{ data: [] }, { data: null }],
      'phone_links:insert': [{ data: { id: LINK } }],
      'outbox:insert': [{ data: null }],
    })
    createServiceClientMock.mockReturnValue(svc)
    const r = await requestWhatsAppCodeAction({ phone: '082 123 4567' })
    expect(r).toEqual({ ok: true, masked: '+27 82 *** 4567' })
    const ins = svc.calls.find((c) => c.table === 'phone_links' && c.op === 'insert')!.args[0]
    expect(ins).toMatchObject({ user_id: ME, phone_e164: '+27821234567', status: 'pending_otp' })
    expect(ins.otp_hash).toMatch(/^[0-9a-f]{64}$/)
    const upd = svc.calls.find((c) => c.table === 'phone_links' && c.op === 'update')!.args[0]
    const out = svc.calls.find((c) => c.table === 'outbox' && c.op === 'insert')!.args[0]
    expect(out).toMatchObject({ user_id: ME, link_id: LINK, trigger: 'otp' })
    expect(upd.otp_hash).toBe(hashOtp(LINK, out.payload.code))
    expect(kickMock).toHaveBeenCalledWith('otp')
  })
  it('caps code sends at 3 per hour', async () => {
    const svc = fakeSupabase({
      'phone_links:select': [{ data: [] }, { data: { id: LINK, status: 'pending_otp', otp_window_start: new Date().toISOString(), otp_window_count: 3 } }],
    })
    createServiceClientMock.mockReturnValue(svc)
    expect(await requestWhatsAppCodeAction({ phone: '0821234567' })).toEqual({ error: 'Too many codes — try again in an hour.' })
  })
})

describe('confirmWhatsAppCodeAction', () => {
  const pending = (over: Record<string, unknown> = {}) => ({ id: LINK, user_id: ME, status: 'pending_otp',
    otp_hash: hashOtp(LINK, '123456'), otp_expires_at: new Date(Date.now() + 60_000).toISOString(), otp_attempts: 0, ...over })

  it('a wrong code counts an attempt and fails', async () => {
    const svc = fakeSupabase({ 'phone_links:select': [{ data: pending() }] }); createServiceClientMock.mockReturnValue(svc)
    expect(await confirmWhatsAppCodeAction({ code: '000000' })).toEqual({ error: "That code isn't right." })
    expect(svc.calls.find((c) => c.op === 'update')!.args[0]).toEqual({ otp_attempts: 1 })
  })
  it('the right code after 5 failures is still refused', async () => {
    const svc = fakeSupabase({ 'phone_links:select': [{ data: pending({ otp_attempts: 5 }) }] }); createServiceClientMock.mockReturnValue(svc)
    expect(await confirmWhatsAppCodeAction({ code: '123456' })).toEqual({ error: 'Too many attempts — request a new code.' })
  })
  it('an expired code is refused', async () => {
    const svc = fakeSupabase({ 'phone_links:select': [{ data: pending({ otp_expires_at: new Date(Date.now() - 1).toISOString() }) }] })
    createServiceClientMock.mockReturnValue(svc)
    expect(await confirmWhatsAppCodeAction({ code: '123456' })).toEqual({ error: 'That code has expired — request a new one.' })
  })
  it('the right code activates with recorded consent and clears the hash', async () => {
    const svc = fakeSupabase({ 'phone_links:select': [{ data: pending() }], 'phone_links:update': [{ data: null }] })
    createServiceClientMock.mockReturnValue(svc)
    expect(await confirmWhatsAppCodeAction({ code: '123456' })).toEqual({ ok: true })
    const upd = svc.calls.find((c) => c.op === 'update')!.args[0]
    expect(upd).toMatchObject({ status: 'active', otp_hash: null, consent_text_version: '2026-09-28.1' })
    expect(upd.consent_at).toBeTruthy()
    expect(upd.verified_at).toBeTruthy()
  })
})

describe('removeWhatsAppLinkAction', () => {
  it('opts the caller\'s own live link out', async () => {
    const svc = fakeSupabase({ 'phone_links:update': [{ data: null }] }); createServiceClientMock.mockReturnValue(svc)
    expect(await removeWhatsAppLinkAction()).toEqual({ ok: true })
    expect(svc.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'update', args: [expect.objectContaining({ status: 'opted_out' })] }),
      expect.objectContaining({ op: 'eq', args: ['user_id', ME] }),
    ]))
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter web test -- src/actions/whatsapp-link.actions.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the actions**

```ts
// apps/web/src/actions/whatsapp-link.actions.ts
'use server'
/**
 * A signed-in user links their own WhatsApp number. Proof of ownership AND
 * POPIA consent are one step: we send a 6-digit code over WhatsApp, the user
 * types it back here. Only a hash of the code is stored (bound to the link id).
 * Writes use the service client after the caller is identified, because
 * `authenticated` has no write grant on whatsapp.* (migration 00207).
 */
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { CONSENT_TEXT_VERSION, OTP_MAX_ATTEMPTS, OTP_MAX_SENDS_PER_HOUR, OTP_TTL_MS, maskPhone, normalisePhone } from '@esite/shared'
import { hashOtp, newOtp, otpMatches } from '@/lib/whatsapp/otp'
import { kickWhatsAppWorker } from '@/lib/whatsapp/kick-worker'

type Result = { ok: true; masked?: string } | { error: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wa = (sb: any) => sb.schema('whatsapp')

async function me(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export async function requestWhatsAppCodeAction(input: { phone: string }): Promise<Result> {
  const userId = await me()
  if (!userId) return { error: 'Not authenticated' }
  const phone = normalisePhone(String(input?.phone ?? ''))
  if (!phone) return { error: 'Enter a valid mobile number, e.g. 082 123 4567.' }

  const svc = createServiceClient()
  const { data: taken } = await wa(svc).from('phone_links').select('id, user_id, status')
    .eq('phone_e164', phone).in('status', ['active', 'pending_optin'])
  if ((taken ?? []).some((r: { user_id: string }) => r.user_id !== userId)) {
    return { error: 'That number is already linked to another E-Site account.' }
  }

  const { data: mine } = await wa(svc).from('phone_links')
    .select('id, status, phone_e164, otp_window_start, otp_window_count')
    .eq('user_id', userId).in('status', ['pending_otp', 'pending_optin', 'active']).maybeSingle()

  const now = Date.now()
  const windowFresh = mine?.otp_window_start && now - Date.parse(mine.otp_window_start) < 3_600_000
  if (windowFresh && (mine.otp_window_count ?? 0) >= OTP_MAX_SENDS_PER_HOUR) {
    return { error: 'Too many codes — try again in an hour.' }
  }

  let linkId: string
  if (mine && mine.status === 'pending_otp') {
    linkId = mine.id
  } else {
    if (mine) {
      // Switching numbers: the old live link stops; the new one must prove itself.
      await wa(svc).from('phone_links').update({ status: 'opted_out', undeliverable_reason: 'replaced' }).eq('id', mine.id)
    }
    const { data: created, error } = await wa(svc).from('phone_links')
      .insert({ user_id: userId, phone_e164: phone, status: 'pending_otp', otp_hash: '0'.repeat(64) })
      .select('id').single()
    if (error || !created) return { error: 'Could not start linking — try again.' }
    linkId = created.id
  }

  const code = newOtp()
  await wa(svc).from('phone_links').update({
    phone_e164: phone,
    otp_hash: hashOtp(linkId, code),
    otp_expires_at: new Date(now + OTP_TTL_MS).toISOString(),
    otp_attempts: 0,
    otp_window_start: windowFresh ? mine.otp_window_start : new Date(now).toISOString(),
    otp_window_count: (windowFresh ? mine.otp_window_count : 0) + 1,
  }).eq('id', linkId)
  await wa(svc).from('outbox').insert({
    user_id: userId, link_id: linkId, trigger: 'otp', idempotency_key: `${linkId}:otp:${now}`, payload: { code },
  })
  await kickWhatsAppWorker('otp')
  return { ok: true, masked: maskPhone(phone) }
}

export async function confirmWhatsAppCodeAction(input: { code: string }): Promise<Result> {
  const userId = await me()
  if (!userId) return { error: 'Not authenticated' }
  const code = String(input?.code ?? '').trim()

  const svc = createServiceClient()
  const { data: link } = await wa(svc).from('phone_links')
    .select('id, user_id, status, otp_hash, otp_expires_at, otp_attempts')
    .eq('user_id', userId).eq('status', 'pending_otp').maybeSingle()
  if (!link) return { error: 'Request a code first.' }
  if ((link.otp_attempts ?? 0) >= OTP_MAX_ATTEMPTS) return { error: 'Too many attempts — request a new code.' }
  if (!link.otp_expires_at || Date.parse(link.otp_expires_at) < Date.now()) return { error: 'That code has expired — request a new one.' }
  if (!otpMatches(link.id, code, link.otp_hash)) {
    await wa(svc).from('phone_links').update({ otp_attempts: (link.otp_attempts ?? 0) + 1 }).eq('id', link.id)
    return { error: "That code isn't right." }
  }
  const at = new Date().toISOString()
  const { error } = await wa(svc).from('phone_links').update({
    status: 'active', verified_at: at, consent_at: at, consent_text_version: CONSENT_TEXT_VERSION,
    otp_hash: null, otp_expires_at: null, otp_attempts: 0,
  }).eq('id', link.id)
  if (error) return { error: 'That number was linked to another account a moment ago.' }
  revalidatePath('/settings/account')
  return { ok: true }
}

export async function removeWhatsAppLinkAction(): Promise<Result> {
  const userId = await me()
  if (!userId) return { error: 'Not authenticated' }
  const svc = createServiceClient()
  await wa(svc).from('phone_links').update({ status: 'opted_out', undeliverable_reason: 'removed_by_user' })
    .eq('user_id', userId).in('status', ['pending_otp', 'pending_optin', 'active'])
  revalidatePath('/settings/account')
  return { ok: true }
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

export async function setWhatsAppQuietHoursAction(input: { start: string; end: string }): Promise<Result> {
  const userId = await me()
  if (!userId) return { error: 'Not authenticated' }
  const parsed = z.object({ start: hhmm, end: hhmm }).safeParse(input)
  if (!parsed.success) return { error: 'Use 24-hour times like 18:00.' }
  const svc = createServiceClient()
  await wa(svc).from('phone_links').update({ quiet_start: parsed.data.start, quiet_end: parsed.data.end })
    .eq('user_id', userId).eq('status', 'active')
  revalidatePath('/settings/account')
  return { ok: true }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter web test -- src/actions/whatsapp-link.actions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/whatsapp/otp.ts apps/web/src/lib/whatsapp/kick-worker.ts apps/web/src/lib/whatsapp/fake-supabase.ts apps/web/src/actions/whatsapp-link.actions.ts apps/web/src/actions/whatsapp-link.actions.test.ts
git commit -m "feat(whatsapp): personal number linking — hashed OTP, consent, rate limits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 15: Web — the personal WhatsApp panel on /settings/account

**Files:**
- Create: `apps/web/src/app/(admin)/settings/account/WhatsAppLinkPanel.tsx`
- Modify: `apps/web/src/app/(admin)/settings/account/page.tsx`
- Test: `apps/web/src/app/(admin)/settings/account/WhatsAppLinkPanel.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
// apps/web/src/app/(admin)/settings/account/WhatsAppLinkPanel.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { requestMock, confirmMock } = vi.hoisted(() => ({ requestMock: vi.fn(), confirmMock: vi.fn() }))
vi.mock('@/actions/whatsapp-link.actions', () => ({
  requestWhatsAppCodeAction: requestMock, confirmWhatsAppCodeAction: confirmMock,
  removeWhatsAppLinkAction: vi.fn(), setWhatsAppQuietHoursAction: vi.fn(),
}))
import { WhatsAppLinkPanel } from './WhatsAppLinkPanel'

describe('WhatsAppLinkPanel', () => {
  it('unlinked: asks for a number, then for the code', async () => {
    requestMock.mockResolvedValue({ ok: true, masked: '+27 82 *** 4567' })
    confirmMock.mockResolvedValue({ ok: true })
    render(<WhatsAppLinkPanel link={null} />)
    fireEvent.change(screen.getByLabelText('Mobile number'), { target: { value: '0821234567' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await waitFor(() => expect(screen.getByLabelText('6-digit code')).toBeTruthy())
    expect(screen.getByText(/\+27 82 \*\*\* 4567/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(confirmMock).toHaveBeenCalledWith({ code: '123456' }))
  })
  it('shows the consent wording before the number is sent', () => {
    render(<WhatsAppLinkPanel link={null} />)
    expect(screen.getByText(/By linking, you agree/)).toBeTruthy()
  })
  it('linked: shows the masked number, quiet hours and Remove', () => {
    render(<WhatsAppLinkPanel link={{ status: 'active', phone_e164: '+27821234567', quiet_start: '18:00:00', quiet_end: '06:30:00', undeliverable_reason: null }} />)
    expect(screen.getByText('+27 82 *** 4567')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy()
    expect((screen.getByLabelText('Quiet from') as HTMLInputElement).value).toBe('18:00')
  })
  it('undeliverable: says why', () => {
    render(<WhatsAppLinkPanel link={{ status: 'undeliverable', phone_e164: '+27821234567', quiet_start: '18:00:00', quiet_end: '06:30:00', undeliverable_reason: '131026 Message undeliverable' }} />)
    expect(screen.getByText(/We couldn't deliver to this number/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- "src/app/(admin)/settings/account/WhatsAppLinkPanel.test.tsx"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
// apps/web/src/app/(admin)/settings/account/WhatsAppLinkPanel.tsx
'use client'
import { useState, useTransition } from 'react'
import { maskPhone } from '@esite/shared'
import {
  confirmWhatsAppCodeAction, removeWhatsAppLinkAction, requestWhatsAppCodeAction, setWhatsAppQuietHoursAction,
} from '@/actions/whatsapp-link.actions'

export interface LinkView {
  status: string
  phone_e164: string
  quiet_start: string
  quiet_end: string
  undeliverable_reason: string | null
}

const CONSENT =
  'By linking, you agree that E-Site may send you WhatsApp messages about site items assigned to you, ' +
  'and that your replies, photos and notes sent to E-Site on WhatsApp are recorded against those items. ' +
  'Reply STOP at any time to stop.'

const input: React.CSSProperties = { padding: '7px 10px', fontSize: 13, border: '1px solid var(--c-border)', borderRadius: 6, background: 'var(--c-panel)', color: 'var(--c-text)' }
const btn: React.CSSProperties = { padding: '7px 14px', fontSize: 13, borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-amber)', color: '#111', cursor: 'pointer' }

export function WhatsAppLinkPanel({ link }: { link: LinkView | null }) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [quiet, setQuiet] = useState({ start: link?.quiet_start.slice(0, 5) ?? '18:00', end: link?.quiet_end.slice(0, 5) ?? '06:30' })
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ ok?: true; masked?: string; error?: string }>, after?: (r: { masked?: string }) => void) =>
    start(async () => {
      const r = await fn()
      if ('error' in r && r.error) setMsg(r.error)
      else { setMsg(null); after?.(r) }
    })

  if (link && (link.status === 'active' || link.status === 'undeliverable')) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13 }}>Linked number: <strong>{maskPhone(link.phone_e164)}</strong></div>
        {link.status === 'undeliverable' && (
          <p style={{ fontSize: 12, color: 'var(--c-red)' }}>
            We couldn&apos;t deliver to this number ({link.undeliverable_reason}). Check WhatsApp is installed on it, then remove and link it again.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <label htmlFor="wa-qs">Quiet from</label>
          <input id="wa-qs" type="time" value={quiet.start} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} style={input} />
          <label htmlFor="wa-qe">until</label>
          <input id="wa-qe" type="time" value={quiet.end} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} style={input} />
          <button type="button" disabled={pending} style={btn} onClick={() => run(() => setWhatsAppQuietHoursAction(quiet))}>Save</button>
        </div>
        <div>
          <button type="button" disabled={pending} style={{ ...btn, background: 'transparent' }}
            onClick={() => run(() => removeWhatsAppLinkAction())}>Remove</button>
        </div>
        {msg && <p style={{ fontSize: 12, color: 'var(--c-red)' }}>{msg}</p>}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{CONSENT}</p>
      {!sentTo ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label htmlFor="wa-phone" style={{ fontSize: 12 }}>Mobile number</label>
          <input id="wa-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="082 123 4567" style={input} />
          <button type="button" disabled={pending || !phone} style={btn}
            onClick={() => run(() => requestWhatsAppCodeAction({ phone }), (r) => setSentTo(r.masked ?? phone))}>Send code</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12 }}>We sent a code on WhatsApp to {sentTo}.</span>
          <label htmlFor="wa-code" style={{ fontSize: 12 }}>6-digit code</label>
          <input id="wa-code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} style={{ ...input, width: 90 }} />
          <button type="button" disabled={pending || code.length !== 6} style={btn}
            onClick={() => run(() => confirmWhatsAppCodeAction({ code }), () => setMsg('Linked. Refresh to see your settings.'))}>Confirm</button>
        </div>
      )}
      {msg && <p style={{ fontSize: 12, color: msg.startsWith('Linked') ? 'var(--c-green)' : 'var(--c-red)' }}>{msg}</p>}
    </div>
  )
}
```

In `apps/web/src/app/(admin)/settings/account/page.tsx`:

1. Add the imports:

```tsx
import { createServiceClient } from '@/lib/supabase/server'
import { WhatsAppLinkPanel, type LinkView } from './WhatsAppLinkPanel'
```

2. After `if (!user || !user.email) redirect('/login')`, add:

```tsx
  const { data: waLink } = await (createServiceClient() as any).schema('whatsapp').from('phone_links')
    .select('status, phone_e164, quiet_start, quiet_end, undeliverable_reason')
    .eq('user_id', user.id).in('status', ['active', 'undeliverable', 'pending_otp'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
```

3. Insert this panel between the Email Address panel and the Delete Account panel:

```tsx
      <div className="data-panel" style={{ marginBottom: 16 }}>
        <div className="data-panel-header">
          <span className="data-panel-title">WhatsApp</span>
        </div>
        <div style={{ padding: '16px 18px' }}>
          <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 14 }}>
            Get site items assigned to you on WhatsApp, and acknowledge, finish or add photos by replying.
          </p>
          <WhatsAppLinkPanel link={(waLink as LinkView | null) ?? null} />
        </div>
      </div>
```

- [ ] **Step 4: Run to verify it passes**

Run the component test. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/settings/account"
git commit -m "feat(whatsapp): link your number on Settings → Account

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 16: Web — invite an external foreman by WhatsApp

**Files:**
- Create: `apps/web/src/actions/whatsapp-invite.actions.ts`
- Test: `apps/web/src/actions/whatsapp-invite.actions.test.ts`
- Create: `apps/web/src/app/(admin)/projects/[id]/settings/members/AddByWhatsAppModal.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/settings/members/ProjectMembersList.tsx` (button + modal, next to "+ Add many" at about line 189 and `<BulkAddMembersModal` at about line 391)

- [ ] **Step 1: Write the failing action tests**

```ts
// apps/web/src/actions/whatsapp-invite.actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/whatsapp/fake-supabase'

const { createClientMock, createServiceClientMock, kickMock, gateMock, logMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(), createServiceClientMock: vi.fn(), kickMock: vi.fn(), gateMock: vi.fn(), logMock: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, createServiceClient: createServiceClientMock }))
vi.mock('@/lib/whatsapp/kick-worker', () => ({ kickWhatsAppWorker: kickMock }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: gateMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@esite/shared', async (orig) => ({ ...(await orig<object>()), logAuthEvent: logMock }))

import { inviteWhatsAppExternalAction } from './whatsapp-invite.actions'

const PM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const NEW_USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const input = { projectId: PROJECT, fullName: 'Sipho Dlamini', phone: '082 123 4567' }

beforeEach(() => {
  vi.clearAllMocks()
  createClientMock.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: PM } } }) } })
  gateMock.mockResolvedValue({ ok: true, role: 'project_manager' })
})

function svcWith(responses: Record<string, Array<{ data?: unknown; error?: unknown }>>, createUser = vi.fn(async () => ({ data: { user: { id: NEW_USER } }, error: null }))) {
  const svc = fakeSupabase(responses) as ReturnType<typeof fakeSupabase> & { auth: unknown }
  svc.auth = { admin: { createUser, deleteUser: vi.fn(async () => ({})) } }
  createServiceClientMock.mockReturnValue(svc)
  return { svc, createUser }
}

describe('inviteWhatsAppExternalAction', () => {
  it('refuses a caller without a project write role — nothing created', async () => {
    gateMock.mockResolvedValue({ ok: false, error: 'Insufficient permissions' })
    const { createUser } = svcWith({})
    expect(await inviteWhatsAppExternalAction(input)).toEqual({ error: 'Insufficient permissions' })
    expect(createUser).not.toHaveBeenCalled()
  })
  it('an already-linked number offers the existing person instead of a duplicate account', async () => {
    const { createUser } = svcWith({ 'phone_links:select': [{ data: { user_id: NEW_USER, status: 'active' } }], 'profiles:select': [{ data: { full_name: 'Sipho D' } }] })
    expect(await inviteWhatsAppExternalAction(input)).toEqual({ existing: { userId: NEW_USER, name: 'Sipho D' } })
    expect(createUser).not.toHaveBeenCalled()
  })
  it('creates a passwordless placeholder-email account, contractor on THIS project only, pending opt-in', async () => {
    const { svc, createUser } = svcWith({
      'phone_links:select': [{ data: null }],
      'projects:select': [{ data: { id: PROJECT, name: 'KINGSWALK', organisation_id: 'ORG' } }],
      'profiles:select': [{ data: { full_name: 'Arno' } }],
      'phone_links:insert': [{ data: { id: 'LINK' } }],
    })
    const r = await inviteWhatsAppExternalAction(input)
    expect(r).toEqual({ ok: true, userId: NEW_USER })
    const cu = createUser.mock.calls[0][0]
    expect(cu.email).toMatch(/^wa-[0-9a-f-]{36}@wa\.e-site\.live$/)
    expect(cu).not.toHaveProperty('password')
    expect(cu.app_metadata).toMatchObject({ provisioned_via: 'whatsapp', invited_by: PM })
    const ins = (t: string) => svc.calls.filter((c) => c.table === t && c.op === 'insert').map((c) => c.args[0])
    expect(ins('user_organisations')[0]).toMatchObject({ user_id: NEW_USER, organisation_id: 'ORG', role: 'contractor', invited_by: PM })
    expect(ins('project_members')[0]).toMatchObject({ user_id: NEW_USER, project_id: PROJECT, role: 'contractor' })
    expect(ins('phone_links')[0]).toMatchObject({ user_id: NEW_USER, phone_e164: '+27821234567', status: 'pending_optin', invited_by: PM, invited_project_id: PROJECT })
    expect(ins('outbox')[0]).toMatchObject({ trigger: 'optin', link_id: 'LINK', payload: { inviter: 'Arno', project: 'KINGSWALK' } })
    expect(kickMock).toHaveBeenCalledWith('optin')
  })
  it('rolls the auth user back if the org membership fails', async () => {
    const { svc } = svcWith({
      'phone_links:select': [{ data: null }],
      'projects:select': [{ data: { id: PROJECT, name: 'K', organisation_id: 'ORG' } }],
      'profiles:select': [{ data: { full_name: 'Arno' } }],
      'user_organisations:insert': [{ error: { message: 'boom' } }],
    })
    expect(await inviteWhatsAppExternalAction(input)).toEqual({ error: 'Could not add them to the organisation: boom' })
    expect((svc.auth as { admin: { deleteUser: ReturnType<typeof vi.fn> } }).admin.deleteUser).toHaveBeenCalledWith(NEW_USER)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- src/actions/whatsapp-invite.actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/actions/whatsapp-invite.actions.ts
'use server'
/**
 * A PM adds a site foreman who has no E-Site login, by WhatsApp number.
 * They become a REAL passwordless account (so the work-item spine, RLS and the
 * audit trail treat them exactly like any contractor), scoped to THIS project,
 * with a placeholder email on a no-MX domain that is never mailed
 * (auth-email-hook refuses it). Nothing reaches them until THEY tap "Yes, I
 * agree" on WhatsApp — that tap proves the number and records POPIA consent.
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { ORG_WRITE_ROLES, logAuthEvent, normalisePhone, placeholderEmailFor } from '@esite/shared'
import { kickWhatsAppWorker } from '@/lib/whatsapp/kick-worker'

const schema = z.object({
  projectId: z.string().uuid(),
  fullName: z.string().trim().min(2, 'Enter their name').max(120),
  phone: z.string().min(6),
  company: z.string().trim().max(120).optional(),
})

type Result =
  | { ok: true; userId: string }
  | { existing: { userId: string; name: string | null } }
  | { error: string }

export async function inviteWhatsAppExternalAction(input: z.infer<typeof schema>): Promise<Result> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const { projectId, fullName, company } = parsed.data
  const phone = normalisePhone(parsed.data.phone)
  if (!phone) return { error: 'Enter a valid mobile number, e.g. 082 123 4567.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const gate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const { data: live } = await svc.schema('whatsapp').from('phone_links').select('user_id, status')
    .eq('phone_e164', phone).in('status', ['active', 'pending_optin']).maybeSingle()
  if (live) {
    const { data: p } = await svc.from('profiles').select('full_name').eq('id', live.user_id).maybeSingle()
    return { existing: { userId: live.user_id, name: p?.full_name ?? null } }
  }

  const { data: project } = await svc.schema('projects').from('projects').select('id, name, organisation_id').eq('id', projectId).maybeSingle()
  if (!project) return { error: 'Project not found' }
  const { data: inviter } = await svc.from('profiles').select('full_name').eq('id', user.id).maybeSingle()

  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email: placeholderEmailFor(randomUUID()),
    email_confirm: true,
    user_metadata: { full_name: fullName, ...(company ? { company } : {}) },
    app_metadata: { provisioned_via: 'whatsapp', invited_by: user.id, invited_project_id: projectId },
  })
  if (createErr || !created?.user) return { error: createErr?.message ?? 'Could not create the account.' }
  const newUserId: string = created.user.id

  const fail = async (msg: string): Promise<Result> => {
    await svc.auth.admin.deleteUser(newUserId).catch(() => {})
    return { error: msg }
  }

  await svc.from('profiles').update({ phone, full_name: fullName }).eq('id', newUserId)
  const { error: orgErr } = await svc.from('user_organisations').insert({
    user_id: newUserId, organisation_id: project.organisation_id, role: 'contractor', is_active: true,
    invited_by: user.id, accepted_at: new Date().toISOString(),
  })
  if (orgErr) return fail(`Could not add them to the organisation: ${orgErr.message}`)
  const { error: pmErr } = await svc.schema('projects').from('project_members').insert({
    project_id: projectId, user_id: newUserId, organisation_id: project.organisation_id, role: 'contractor',
  })
  if (pmErr) return fail(`Could not add them to the project: ${pmErr.message}`)
  const { data: link, error: linkErr } = await svc.schema('whatsapp').from('phone_links').insert({
    user_id: newUserId, phone_e164: phone, status: 'pending_optin', invited_by: user.id, invited_project_id: projectId,
  }).select('id').single()
  if (linkErr || !link) return fail(`Could not record the number: ${linkErr?.message ?? 'unknown'}`)

  await svc.schema('whatsapp').from('outbox').insert({
    user_id: newUserId, link_id: link.id, trigger: 'optin', idempotency_key: `${link.id}:optin:1`,
    payload: { inviter: inviter?.full_name ?? 'Your project manager', project: project.name },
  })
  await logAuthEvent(svc, { userId: newUserId, eventType: 'user_created',
    metadata: { created_by: user.id, organisation_id: project.organisation_id, role: 'contractor', via: 'whatsapp_invite', project_id: projectId } })
  await kickWhatsAppWorker('optin')
  revalidatePath(`/projects/${projectId}/settings/members`)
  return { ok: true, userId: newUserId }
}

export async function resendWhatsAppOptInAction(input: { projectId: string; userId: string }): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient()
  const gate = await requireEffectiveRole(supabase, input.projectId, ORG_WRITE_ROLES)
  if (!gate.ok) return { error: gate.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const { data: link } = await svc.schema('whatsapp').from('phone_links').select('id, invited_project_id')
    .eq('user_id', input.userId).eq('status', 'pending_optin').maybeSingle()
  if (!link || link.invited_project_id !== input.projectId) return { error: 'No pending WhatsApp invitation for this person on this project.' }
  const { data: project } = await svc.schema('projects').from('projects').select('name').eq('id', input.projectId).maybeSingle()
  await svc.schema('whatsapp').from('outbox').insert({
    user_id: input.userId, link_id: link.id, trigger: 'optin', idempotency_key: `${link.id}:optin:${Date.now()}`,
    payload: { inviter: 'Your project manager', project: project?.name ?? 'your project' },
  })
  await kickWhatsAppWorker('optin')
  return { ok: true }
}
```

Check `logAuthEvent`'s argument type in `packages/shared/src/services/auth-events.service.ts:32`. If `eventType: 'user_created'` or `metadata` is typed differently there, match that exact shape; the call in `project-members-bulk.actions.ts` is the working reference. Update the test's `logMock` expectations only if the shape differs.

- [ ] **Step 4: Write the modal**

```tsx
// apps/web/src/app/(admin)/projects/[id]/settings/members/AddByWhatsAppModal.tsx
'use client'
import { useState, useTransition } from 'react'
import { inviteWhatsAppExternalAction } from '@/actions/whatsapp-invite.actions'
import { addProjectMember } from '@/actions/project-members.actions'

interface Props { projectId: string; open: boolean; onClose: () => void }

export function AddByWhatsAppModal({ projectId, open, onClose }: Props) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [company, setCompany] = useState('')
  const [existing, setExisting] = useState<{ userId: string; name: string | null } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  if (!open) return null

  const submit = () => start(async () => {
    const r = await inviteWhatsAppExternalAction({ projectId, fullName, phone, company: company || undefined })
    if ('existing' in r) { setExisting(r.existing); return }
    if ('error' in r) { setMsg(r.error); return }
    setMsg('Invitation sent. They appear as "Awaiting WhatsApp opt-in" until they tap Yes.')
  })
  const addExisting = () => start(async () => {
    const r = await addProjectMember(projectId, existing!.userId, 'contractor')
    setMsg(r && 'error' in r && r.error ? String(r.error) : `${existing!.name ?? 'They'} were added to this project.`)
    setExisting(null)
  })

  return (
    <div role="dialog" aria-label="Add by WhatsApp" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div style={{ background: 'var(--c-panel)', border: '1px solid var(--c-border)', borderRadius: 8, padding: 20, width: 'min(440px, 92vw)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Add by WhatsApp</h2>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-dim)' }}>
          For site people without an E-Site login. They get a WhatsApp invitation and nothing else until they accept it.
        </p>
        <label style={{ fontSize: 12 }}>Name<input value={fullName} onChange={(e) => setFullName(e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
        <label style={{ fontSize: 12 }}>WhatsApp number<input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="082 123 4567" style={{ display: 'block', width: '100%' }} /></label>
        <label style={{ fontSize: 12 }}>Company (optional)<input value={company} onChange={(e) => setCompany(e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
        {existing && (
          <div style={{ fontSize: 12 }}>
            That number already belongs to <strong>{existing.name ?? 'an E-Site user'}</strong>.{' '}
            <button type="button" disabled={pending} onClick={addExisting}>Add them to this project</button>
          </div>
        )}
        {msg && <p style={{ margin: 0, fontSize: 12 }}>{msg}</p>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Close</button>
          <button type="button" disabled={pending || !fullName || !phone} onClick={submit}>Send invitation</button>
        </div>
      </div>
    </div>
  )
}
```

In `ProjectMembersList.tsx`, make three changes:
1. Add `import { AddByWhatsAppModal } from './AddByWhatsAppModal'`.
2. Add `const [showWhatsAppModal, setShowWhatsAppModal] = useState(false)` beside `showBulkModal`.
3. Add `<Button size="sm" variant="secondary" onClick={() => setShowWhatsAppModal(true)}>+ Add by WhatsApp</Button>` after the `+ Add from sub-org` button, and this beside `<BulkAddMembersModal … />`:

```tsx
      <AddByWhatsAppModal projectId={projectId} open={showWhatsAppModal} onClose={() => setShowWhatsAppModal(false)} />
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter web test -- src/actions/whatsapp-invite.actions.test.ts "src/app/(admin)/projects/[id]/settings/members"`
Expected: PASS, including the existing `ProjectMembersList.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/actions/whatsapp-invite.actions.ts apps/web/src/actions/whatsapp-invite.actions.test.ts "apps/web/src/app/(admin)/projects/[id]/settings/members"
git commit -m "feat(whatsapp): invite an external foreman by number — passwordless, project-scoped, opt-in first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 17: Web — the item page and the "Open in E-Site" redirect

**Files:**
- Create: `apps/web/src/app/wa/[itemId]/route.ts`
- Create: `apps/web/src/app/(admin)/projects/[id]/items/[ref]/page.tsx`
- Create: `apps/web/src/lib/whatsapp/item-page-data.ts`
- Test: `apps/web/src/lib/whatsapp/item-page-data.test.ts`
- Test: `apps/web/src/app/wa/[itemId]/route.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/app/wa/[itemId]/route.test.ts
import { describe, it, expect, vi } from 'vitest'
const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
import { GET } from './route'

const ITEM = '11111111-1111-4111-8111-111111111111'
const client = (user: unknown, row: unknown) => ({
  auth: { getUser: async () => ({ data: { user } }) },
  schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }) }),
})
const req = () => new Request(`https://www.e-site.live/wa/${ITEM}`)

describe('GET /wa/[itemId]', () => {
  it('signed out -> login with next', async () => {
    createClientMock.mockResolvedValue(client(null, null))
    const r = await GET(req(), { params: Promise.resolve({ itemId: ITEM }) })
    expect(r.headers.get('location')).toBe(`https://www.e-site.live/login?next=%2Fwa%2F${ITEM}`)
  })
  it('visible item -> its page', async () => {
    createClientMock.mockResolvedValue(client({ id: 'u' }, { project_id: 'P', ref: 'T-4' }))
    const r = await GET(req(), { params: Promise.resolve({ itemId: ITEM }) })
    expect(r.headers.get('location')).toBe('https://www.e-site.live/projects/P/items/T-4')
  })
  it('invisible item (RLS returned nothing) -> dashboard, no leak of existence', async () => {
    createClientMock.mockResolvedValue(client({ id: 'u' }, null))
    const r = await GET(req(), { params: Promise.resolve({ itemId: ITEM }) })
    expect(r.headers.get('location')).toBe('https://www.e-site.live/dashboard')
  })
  it('junk id -> dashboard without a query', async () => {
    createClientMock.mockResolvedValue(client({ id: 'u' }, null))
    const r = await GET(new Request('https://www.e-site.live/wa/x'), { params: Promise.resolve({ itemId: 'x' }) })
    expect(r.headers.get('location')).toBe('https://www.e-site.live/dashboard')
  })
})
```

```ts
// apps/web/src/lib/whatsapp/item-page-data.test.ts
import { describe, it, expect } from 'vitest'
import { noteText, logRows } from './item-page-data'

describe('item page view model', () => {
  it('a redacted note prints as withdrawn, never its old body', () => {
    expect(noteText({ body: '', redacted_at: '2026-10-01T10:00:00Z' })).toBe('[message withdrawn]')
    expect(noteText({ body: 'Cover refitted', redacted_at: null })).toBe('Cover refitted')
  })
  it('merges outbound and inbound into one time-ordered log', () => {
    const rows = logRows(
      [{ id: 'o', trigger: 'assigned', status: 'read', error_text: null, created_at: '2026-10-01T08:00:00Z', sent_at: '2026-10-01T08:00:05Z' }],
      [{ id: 'i', kind: 'image', outcome: 'applied', outcome_reason: 'attachment', received_at: '2026-10-01T09:00:00Z' }],
    )
    expect(rows.map((r) => r.id)).toEqual(['o', 'i'])
    expect(rows[0]).toMatchObject({ direction: 'out', label: 'assigned', status: 'read' })
    expect(rows[1]).toMatchObject({ direction: 'in', label: 'image', status: 'applied', detail: 'attachment' })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web test -- "src/app/wa" src/lib/whatsapp/item-page-data.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/app/wa/[itemId]/route.ts
// The "Open in E-Site" URL button on every WhatsApp card points here, because a
// Meta template's URL base is fixed at approval time: https://www.e-site.live/wa/{{1}}.
// The lookup runs through the user's RLS, so an item they cannot see is
// indistinguishable from one that does not exist.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params
  const origin = new URL(req.url).origin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(`/wa/${itemId}`)}`)
  if (!UUID.test(itemId)) return NextResponse.redirect(`${origin}/dashboard`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).schema('projects').from('work_items').select('project_id, ref').eq('id', itemId).maybeSingle()
  if (!data) return NextResponse.redirect(`${origin}/dashboard`)
  return NextResponse.redirect(`${origin}/projects/${data.project_id}/items/${encodeURIComponent(data.ref)}`)
}
```

```ts
// apps/web/src/lib/whatsapp/item-page-data.ts
export function noteText(n: { body: string; redacted_at: string | null }): string {
  return n.redacted_at ? '[message withdrawn]' : n.body
}

export interface LogRow { id: string; at: string; direction: 'out' | 'in'; label: string; status: string; detail: string | null }

export function logRows(
  outbox: Array<{ id: string; trigger: string; status: string; error_text: string | null; created_at: string; sent_at: string | null }>,
  inbound: Array<{ id: string; kind: string; outcome: string; outcome_reason: string | null; received_at: string }>,
): LogRow[] {
  return [
    ...outbox.map((o) => ({ id: o.id, at: o.sent_at ?? o.created_at, direction: 'out' as const, label: o.trigger, status: o.status, detail: o.error_text })),
    ...inbound.map((i) => ({ id: i.id, at: i.received_at, direction: 'in' as const, label: i.kind, status: i.outcome, detail: i.outcome_reason })),
  ].sort((a, b) => a.at.localeCompare(b.at))
}
```

```tsx
// apps/web/src/app/(admin)/projects/[id]/items/[ref]/page.tsx
// Minimal work-item page: the "Open in E-Site" target until the Inbox (Q1 items 5/6)
// supersedes it. Every read goes through the caller's RLS: an item they cannot
// read is a 404.
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { stateLabel, type WorkItemStatus } from '@esite/shared'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { noteText, logRows } from '@/lib/whatsapp/item-page-data'

interface Props { params: Promise<{ id: string; ref: string }> }

export default async function WorkItemPage({ params }: Props) {
  const { id: projectId, ref: rawRef } = await params
  const ref = decodeURIComponent(rawRef)
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: item } = await sb.schema('projects').from('work_items')
    .select('id, ref, title, item_type, status, due_date, assignee_id, gatekeeper_id, ball_in_court_id')
    .eq('project_id', projectId).eq('ref', ref).maybeSingle()
  if (!item) notFound()

  const [people, notes, atts, outbox, inbound] = await Promise.all([
    sb.from('profiles').select('id, full_name').in('id', [item.assignee_id, item.gatekeeper_id]),
    sb.schema('projects').from('work_item_notes').select('id, body, redacted_at, via, created_at, author_id').eq('work_item_id', item.id).order('created_at'),
    sb.schema('projects').from('work_item_attachments').select('id, bucket, storage_path, role, via, redacted_at, created_at').eq('work_item_id', item.id).order('created_at'),
    sb.schema('whatsapp').from('outbox').select('id, trigger, status, error_text, created_at, sent_at').eq('work_item_id', item.id),
    sb.schema('whatsapp').from('inbound').select('id, kind, outcome, outcome_reason, received_at').eq('resolved_item_id', item.id),
  ])
  const name = (uid: string) => (people.data ?? []).find((p: { id: string }) => p.id === uid)?.full_name ?? '—'
  const visibleAtts = (atts.data ?? []).filter((a: { redacted_at: string | null }) => !a.redacted_at)
  const signed = await Promise.all(visibleAtts.map(async (a: { bucket: string; storage_path: string; id: string; role: string }) => {
    const { data } = await supabase.storage.from(a.bucket).createSignedUrl(a.storage_path, 600)
    return { ...a, url: data?.signedUrl ?? null }
  }))
  const log = logRows(outbox.data ?? [], inbound.data ?? [])

  return (
    <div className="animate-fadeup" style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="page-header">
        <h1 className="page-title">{item.ref} · {item.title}</h1>
        <div style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
          {stateLabel(item.item_type, item.status as WorkItemStatus)} · due {item.due_date} · assignee {name(item.assignee_id)} · signs off {name(item.gatekeeper_id)}
        </div>
      </div>

      <Card>
        <CardHeader><h2 style={{ margin: 0, fontSize: 14 }}>Notes</h2></CardHeader>
        <CardBody>
          {(notes.data ?? []).length === 0 ? <p style={{ fontSize: 12 }}>No notes yet.</p> : (
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
              {(notes.data ?? []).map((n: { id: string; body: string; redacted_at: string | null; via: string; created_at: string }) => (
                <li key={n.id}>{noteText(n)} <span style={{ color: 'var(--c-text-dim)', fontSize: 11 }}>{n.via === 'whatsapp' ? 'via WhatsApp · ' : ''}{new Date(n.created_at).toLocaleString('en-ZA')}</span></li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h2 style={{ margin: 0, fontSize: 14 }}>Photos</h2></CardHeader>
        <CardBody>
          {signed.length === 0 ? <p style={{ fontSize: 12 }}>No photos yet.</p> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
              {signed.map((a) => a.url && (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={`${a.role} photo`} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'contain', background: '#000' }} />
                </a>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h2 style={{ margin: 0, fontSize: 14 }}>WhatsApp log</h2></CardHeader>
        <CardBody>
          {log.length === 0 ? <p style={{ fontSize: 12 }}>No WhatsApp messages for this item.</p> : (
            <table style={{ width: '100%', fontSize: 12 }}>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.at).toLocaleString('en-ZA')}</td>
                    <td>{r.direction === 'out' ? '→ sent' : '← received'}</td>
                    <td>{r.label}</td>
                    <td>{r.status}</td>
                    <td style={{ color: 'var(--c-text-dim)' }}>{r.detail ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
```

Photos use `objectFit: 'contain'` on purpose. The QC module lost 37–84% of every photo to `cover`.

- [ ] **Step 4: Run to verify they pass**

Run the same test command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/wa "apps/web/src/app/(admin)/projects/[id]/items" apps/web/src/lib/whatsapp/item-page-data.ts apps/web/src/lib/whatsapp/item-page-data.test.ts
git commit -m "feat(whatsapp): minimal item page + /wa/[itemId] redirect (RLS-scoped)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 18: Web — the `notify_whatsapp` project toggle, end to end

`notification-toggles.contract.test.ts` requires every `notify_*` toggle to have a consumer. The consumer here is the item page's banner (`cfg.whatsapp`).

**Files:**
- Modify: `packages/shared/src/schemas/project-settings.schema.ts` (schema at about line 76, defaults at about line 118)
- Modify: `packages/shared/src/services/_project-settings-mappers.ts` (row type at about line 38, row→model at about line 83, patch→row at about line 116)
- Modify: `packages/shared/src/services/project-settings.service.ts` (restore list at about line 309, `getNotificationConfig` at about lines 388 and 405)
- Modify: `apps/web/src/app/(admin)/projects/[id]/settings/integrations/IntegrationsPanel.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/settings/integrations/page.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/items/[ref]/page.tsx` (banner)

- [ ] **Step 1: Add the toggle to TOGGLES first, and watch the contract fail**

In `IntegrationsPanel.tsx`, add `'notifyWhatsapp'` to `ToggleField`, add an `initialNotifyWhatsapp: boolean` prop, and add this to the state and to `TOGGLES`:

```tsx
    {
      field: 'notifyWhatsapp',
      label: 'WhatsApp for work items',
      description:
        'Send assigned, due-tomorrow and overdue work items to people who have linked WhatsApp, and let them acknowledge, finish or add photos by replying. Off by default. Email notifications are unaffected.',
    },
```

Run: `pnpm --filter web test -- "src/app/(admin)/projects/[id]/settings/integrations/notification-toggles.contract.test.ts"`
Expected: FAIL. `notifyWhatsapp` has no mapper and no consumer, which is exactly the defect this contract exists to catch.

- [ ] **Step 2: Wire it through shared**

- In `project-settings.schema.ts`, add `notifyWhatsapp: z.boolean(),` after `notifyFormEmail`, and `notifyWhatsapp: false,` in `projectSettingsDefaults`. It must mirror the column DEFAULT of false.
- In `_project-settings-mappers.ts`:
  - add `notify_whatsapp: boolean` to the row type;
  - add `notifyWhatsapp: row.notify_whatsapp,` to row→model;
  - add `if (patch.notifyWhatsapp !== undefined) out.notify_whatsapp = patch.notifyWhatsapp` to patch→row.
- In `project-settings.service.ts`:
  - add `notifyWhatsapp: snap.notifyWhatsapp,` to the restore field list;
  - add `whatsapp: projectSettingsDefaults.notifyWhatsapp,` to the defaults branch of `getNotificationConfig`;
  - add `whatsapp: s.notifyWhatsapp,` to its live branch.

- [ ] **Step 3: Wire the page and the consumer**

In `integrations/page.tsx`, add `const notifyWhatsapp = settings?.notifyWhatsapp ?? false` next to `notifyFormEmail` (the fallback mirrors the column DEFAULT), and pass `initialNotifyWhatsapp={notifyWhatsapp}`.

In the item page, add these imports:

```tsx
import { projectSettingsService } from '@esite/shared'
```

and, after the item is loaded:

```tsx
  const cfg = await projectSettingsService.getNotificationConfig(supabase as never, projectId)
```

Then render this directly under the page header:

```tsx
      {!cfg.whatsapp && (
        <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
          WhatsApp is off for this project — nobody is messaged about this item. A project owner or admin can turn it on in Settings → Integrations.
        </p>
      )}
```

Check the exported name of the settings service in `packages/shared/src/services/index.ts`. Use exactly that name, which is the one `site-forms-distribute.actions.ts` calls `getNotificationConfig` on.

- [ ] **Step 4: Run the shared and web suites**

Run: `pnpm --filter @esite/shared test && pnpm --filter web test -- notification-toggles project-settings IntegrationsPanel`
Expected: PASS. The contract now finds a mapper, a toggle, a page fallback and a consumer.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/project-settings.schema.ts packages/shared/src/services "apps/web/src/app/(admin)/projects/[id]/settings/integrations" "apps/web/src/app/(admin)/projects/[id]/items"
git commit -m "feat(whatsapp): per-project notify_whatsapp toggle (default off) with a real consumer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 19: Web — Settings → WhatsApp (admin)

**Files:**
- Create: `apps/web/src/actions/whatsapp-admin.actions.ts`
- Test: `apps/web/src/actions/whatsapp-admin.actions.test.ts`
- Create: `apps/web/src/app/(admin)/settings/whatsapp/page.tsx`
- Create: `apps/web/src/app/(admin)/settings/whatsapp/WhatsAppAdminPanel.tsx`

- [ ] **Step 1: Write the failing action tests**

```ts
// apps/web/src/actions/whatsapp-admin.actions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/lib/whatsapp/fake-supabase'

const { getOrgContextMock, createServiceClientMock } = vi.hoisted(() => ({ getOrgContextMock: vi.fn(), createServiceClientMock: vi.fn() }))
vi.mock('@/lib/auth-org', () => ({ getOrgContext: getOrgContextMock }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: createServiceClientMock, createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { setWhatsAppSendingAction } from './whatsapp-admin.actions'

beforeEach(() => vi.clearAllMocks())

describe('setWhatsAppSendingAction', () => {
  it.each(['project_manager', 'contractor', 'client_viewer'])('refuses %s', async (role) => {
    getOrgContextMock.mockResolvedValue({ userId: 'u', organisationId: 'o', role })
    const svc = fakeSupabase(); createServiceClientMock.mockReturnValue(svc)
    expect(await setWhatsAppSendingAction({ enabled: true })).toEqual({ error: 'Only an owner or admin can change this.' })
    expect(svc.calls).toEqual([])
  })
  it('owner flips the platform switch', async () => {
    getOrgContextMock.mockResolvedValue({ userId: 'u', organisationId: 'o', role: 'owner' })
    const svc = fakeSupabase({ 'settings:update': [{ data: null }] }); createServiceClientMock.mockReturnValue(svc)
    expect(await setWhatsAppSendingAction({ enabled: true })).toEqual({ ok: true })
    expect(svc.calls.find((c) => c.op === 'update')!.args[0]).toMatchObject({ sending_enabled: true })
  })
})
```

- [ ] **Step 2: Run to verify it fails, then implement**

```ts
// apps/web/src/actions/whatsapp-admin.actions.ts
'use server'
/**
 * The platform-wide WhatsApp switch and alert address. whatsapp.settings is a
 * single platform row, so ONLY WM's org owner/admin should hold this. Every
 * org's owner/admin passes OWNER_ADMIN (the same trade-off recorded for
 * /metrics). Accepted for v1 because only WM operates the number; recorded in
 * docs/rbac-matrix.md.
 */
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { OWNER_ADMIN } from '@esite/shared'

async function isAdmin(): Promise<boolean> {
  const ctx = await getOrgContext().catch(() => null)
  return Boolean(ctx && (OWNER_ADMIN as readonly string[]).includes(ctx.role))
}

export async function setWhatsAppSendingAction(input: { enabled: boolean }): Promise<{ ok: true } | { error: string }> {
  if (!(await isAdmin())) return { error: 'Only an owner or admin can change this.' }
  const enabled = z.boolean().parse(input.enabled)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (createServiceClient() as any).schema('whatsapp').from('settings')
    .update({ sending_enabled: enabled, updated_at: new Date().toISOString() }).eq('id', true)
  revalidatePath('/settings/whatsapp')
  return { ok: true }
}

export async function setWhatsAppAlertEmailAction(input: { email: string }): Promise<{ ok: true } | { error: string }> {
  if (!(await isAdmin())) return { error: 'Only an owner or admin can change this.' }
  const parsed = z.string().email().safeParse(input.email)
  if (!parsed.success) return { error: 'Enter a valid email address.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (createServiceClient() as any).schema('whatsapp').from('settings').update({ alert_email: parsed.data }).eq('id', true)
  revalidatePath('/settings/whatsapp')
  return { ok: true }
}
```

- [ ] **Step 3: The page and panel**

```tsx
// apps/web/src/app/(admin)/settings/whatsapp/page.tsx
import { requireRolePage } from '@/lib/auth/require-role'
import { createServiceClient } from '@/lib/supabase/server'
import { OWNER_ADMIN, maskPhone } from '@esite/shared'
import { WhatsAppAdminPanel } from './WhatsAppAdminPanel'

export const metadata = { title: 'WhatsApp · Settings' }

export default async function WhatsAppSettingsPage() {
  const ctx = await requireRolePage(OWNER_ADMIN)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const { data: members } = await svc.from('user_organisations').select('user_id').eq('organisation_id', ctx.organisationId).eq('is_active', true)
  const ids: string[] = (members ?? []).map((m: { user_id: string }) => m.user_id)
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [settings, links, profiles, out7, in7, templates] = await Promise.all([
    svc.schema('whatsapp').from('settings').select('*').eq('id', true).maybeSingle(),
    svc.schema('whatsapp').from('phone_links').select('user_id, phone_e164, status, created_at, undeliverable_reason').in('user_id', ids),
    svc.from('profiles').select('id, full_name').in('id', ids),
    svc.schema('whatsapp').from('outbox').select('status, trigger').in('user_id', ids).gte('created_at', since),
    svc.schema('whatsapp').from('inbound').select('outcome, outcome_reason').in('resolved_user_id', ids).gte('received_at', since),
    svc.schema('whatsapp').from('templates').select('name, category, status'),
  ])
  const nameOf = (id: string) => (profiles.data ?? []).find((p: { id: string }) => p.id === id)?.full_name ?? id.slice(0, 8)
  const count = (rows: Array<Record<string, string>> | null, key: string) =>
    Object.entries((rows ?? []).reduce<Record<string, number>>((acc, r) => { acc[r[key]] = (acc[r[key]] ?? 0) + 1; return acc }, {}))
  const staleOptins = (links.data ?? []).filter((l: { status: string; created_at: string }) =>
    l.status === 'pending_optin' && Date.now() - Date.parse(l.created_at) > 48 * 3600_000)

  return (
    <div className="animate-fadeup" style={{ maxWidth: 820 }}>
      <div className="page-header"><h1 className="page-title">WhatsApp</h1></div>
      <WhatsAppAdminPanel
        sendingEnabled={Boolean(settings.data?.sending_enabled)}
        alertEmail={settings.data?.alert_email ?? ''}
        lastPolicyError={settings.data?.last_policy_error ? `${settings.data.last_policy_error_at}: ${settings.data.last_policy_error}` : null}
        links={(links.data ?? []).map((l: { user_id: string; phone_e164: string; status: string; undeliverable_reason: string | null }) =>
          ({ name: nameOf(l.user_id), phone: maskPhone(l.phone_e164), status: l.status, reason: l.undeliverable_reason }))}
        staleOptins={staleOptins.length}
        outbound7d={count(out7.data, 'status')}
        templateMessages7d={(out7.data ?? []).filter((r: { status: string }) => ['sent', 'delivered', 'read'].includes(r.status)).length}
        inbound7d={count(in7.data, 'outcome')}
        templates={templates.data ?? []}
      />
    </div>
  )
}
```

```tsx
// apps/web/src/app/(admin)/settings/whatsapp/WhatsAppAdminPanel.tsx
'use client'
import { useState, useTransition } from 'react'
import { setWhatsAppAlertEmailAction, setWhatsAppSendingAction } from '@/actions/whatsapp-admin.actions'

interface Props {
  sendingEnabled: boolean
  alertEmail: string
  lastPolicyError: string | null
  links: Array<{ name: string; phone: string; status: string; reason: string | null }>
  staleOptins: number
  outbound7d: Array<[string, number]>
  templateMessages7d: number
  inbound7d: Array<[string, number]>
  templates: Array<{ name: string; category: string; status: string }>
}

export function WhatsAppAdminPanel(p: Props) {
  const [enabled, setEnabled] = useState(p.sendingEnabled)
  const [email, setEmail] = useState(p.alertEmail)
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const section: React.CSSProperties = { border: '1px solid var(--c-border)', borderRadius: 8, padding: 16, marginBottom: 16 }

  return (
    <div>
      {p.lastPolicyError && <div style={{ ...section, borderColor: 'var(--c-red)', color: 'var(--c-red)', fontSize: 12 }}>Last Meta policy error — {p.lastPolicyError}</div>}
      <div style={section}>
        <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" checked={enabled} disabled={pending} onChange={(e) => {
            const v = e.target.checked; setEnabled(v)
            start(async () => { const r = await setWhatsAppSendingAction({ enabled: v }); if ('error' in r) { setEnabled(!v); setMsg(r.error) } })
          }} />
          Sending enabled (platform-wide). Off stops every outbound message within a minute.
        </label>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, fontSize: 12, alignItems: 'center' }}>
          <label htmlFor="wa-alert">Alert email</label>
          <input id="wa-alert" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="button" disabled={pending} onClick={() => start(async () => { const r = await setWhatsAppAlertEmailAction({ email }); setMsg('error' in r ? r.error : 'Saved.') })}>Save</button>
        </div>
        {msg && <p style={{ fontSize: 12 }}>{msg}</p>}
      </div>
      <div style={section}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Last 7 days</h2>
        <p style={{ fontSize: 12 }}>Template messages delivered (the billable count): <strong>{p.templateMessages7d}</strong></p>
        <p style={{ fontSize: 12 }}>Outbound by status: {p.outbound7d.map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'}</p>
        <p style={{ fontSize: 12 }}>Inbound by outcome: {p.inbound7d.map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'}</p>
        <p style={{ fontSize: 12 }}>Opt-ins waiting more than 48 h: <strong>{p.staleOptins}</strong></p>
      </div>
      <div style={section}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Linked numbers</h2>
        <table style={{ width: '100%', fontSize: 12 }}><tbody>
          {p.links.map((l, i) => <tr key={i}><td>{l.name}</td><td>{l.phone}</td><td>{l.status}</td><td>{l.reason ?? ''}</td></tr>)}
        </tbody></table>
      </div>
      <div style={section}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Templates</h2>
        <table style={{ width: '100%', fontSize: 12 }}><tbody>
          {p.templates.map((t) => <tr key={t.name}><td>{t.name}</td><td>{t.category}</td><td>{t.status}</td></tr>)}
        </tbody></table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web test -- src/actions/whatsapp-admin.actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/whatsapp-admin.actions.ts apps/web/src/actions/whatsapp-admin.actions.test.ts "apps/web/src/app/(admin)/settings/whatsapp"
git commit -m "feat(whatsapp): Settings → WhatsApp admin — platform switch, 7-day diagnostics

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 20: auth-email-hook refuses placeholder addresses; rbac-matrix; full suite

**Files:**
- Modify: `apps/edge-functions/supabase/functions/auth-email-hook/index.ts`
- Create: `apps/web/src/lib/whatsapp/placeholder-email.contract.test.ts`
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Write the failing contract test**

```ts
// apps/web/src/lib/whatsapp/placeholder-email.contract.test.ts
// @vitest-environment node
// A WhatsApp-invited external has a placeholder email on a no-MX domain. If
// GoTrue ever tries to mail it (recovery, email change), the platform mailer
// must refuse BEFORE calling Resend — a bounce storm is what nearly cost the
// sending domain in July.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const HOOK = resolve(__dirname, '../../../../edge-functions/supabase/functions/auth-email-hook/index.ts')

describe('auth-email-hook placeholder guard', () => {
  it('checks isPlaceholderEmail before the Resend fetch', () => {
    const src = readFileSync(HOOK, 'utf8')
    const guard = src.indexOf('isPlaceholderEmail(')
    const send = src.indexOf("fetch('https://api.resend.com/emails'")
    expect(guard).toBeGreaterThan(-1)
    expect(send).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(send)
  })
})
```

- [ ] **Step 2: Run to verify it fails, then implement**

In `auth-email-hook/index.ts`, add the import:

```ts
import { isPlaceholderEmail } from '../_shared/whatsapp/core.ts'
```

and, immediately after `const { to, subject, html } = renderAuthEmail(payload)`:

```ts
    // WhatsApp-invited externals carry a placeholder address on a no-MX
    // domain (spec §9.8). Never hand it to Resend: that is a guaranteed bounce.
    if (isPlaceholderEmail(Array.isArray(to) ? to[0] : to)) {
      console.warn('auth-email-hook: skipped placeholder address')
      return new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } })
    }
```

Run: `pnpm --filter web test -- src/lib/whatsapp/placeholder-email.contract.test.ts src/lib/email/auth-email-hook-render.test.ts`
Expected: PASS.

- [ ] **Step 3: rbac-matrix rows**

Add these to `docs/rbac-matrix.md`, following each section's existing table format and legend:

Under **page routes**:

```
| `/settings/account` (WhatsApp panel) | W | W | W | W | W | W | W |
| `/settings/whatsapp` | W | W | → | → | → | → | → |
| `/projects/[id]/items/[ref]` | R | R | R | R | R | R | R* |
| `/wa/[itemId]` (redirect) | R | R | R | R | R | R | R* |
```

with this footnote: `* a client_viewer sees an item only where RLS admits them (assignee/gatekeeper/watcher); otherwise 404 / → dashboard.`

Under **server actions**, add a new subsection `### WhatsApp (`whatsapp-link.actions.ts`, `whatsapp-invite.actions.ts`, `whatsapp-admin.actions.ts`)`:

```
| Action | owner | admin | project_manager | contractor | inspector | supplier | client_viewer |
|---|---|---|---|---|---|---|---|
| `requestWhatsAppCodeAction` / `confirmWhatsAppCodeAction` / `removeWhatsAppLinkAction` / `setWhatsAppQuietHoursAction` (own number only) | W | W | W | W | W | W | W |
| `inviteWhatsAppExternalAction` / `resendWhatsAppOptInAction` (per project, `requireEffectiveRole`) | W | W | W | — | — | — | — |
| `setWhatsAppSendingAction` / `setWhatsAppAlertEmailAction` | W | W | — | — | — | — | — |
```

Under **API routes / edge functions**, add rows for `whatsapp-webhook` (Meta only, HMAC, `--no-verify-jwt`) and `whatsapp-worker` (service role).

Under **Known gaps**, add:

```
- `whatsapp.settings` is one platform row, but `OWNER_ADMIN` admits every org's owner/admin (same as `/metrics`). Accepted while only WM operates the WhatsApp number.
- WhatsApp is STRICTER than the web on removal: a removed/deactivated member who is still an item's assignee can act on the web (the spine's assignee arm), but not via WhatsApp (wa_* require an effective project role).
```

- [ ] **Step 4: Run the full gate**

```bash
pnpm --filter @esite/shared test && pnpm --filter web test && pnpm --filter @esite/db test:ci && pnpm type-check && pnpm lint
```

Expected: all green. Record the counts in the PR body.

- [ ] **Step 5: Commit**

```bash
git add apps/edge-functions/supabase/functions/auth-email-hook/index.ts apps/web/src/lib/whatsapp/placeholder-email.contract.test.ts docs/rbac-matrix.md
git commit -m "feat(whatsapp): mailer refuses placeholder addresses; rbac-matrix rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**Phase 1 ends here. Open the PR (`feat/whatsapp-reply-to-act`), get review, merge, then run Task 24 with sending OFF.**

---

# PHASE 2 — after #193 (`…_work_item_source_mirrors_and_backfill.sql`) is applied to production

Check first: `SELECT count(*) FROM pg_proc WHERE proname = 'mirror_snag_work_item'` returns 1 in production. If it returns 0, stop.

## Task 21: Migration — snag and RFI Mark-done adapters

**Files:**
- Create: `apps/edge-functions/supabase/migrations/<NEXT>_whatsapp_mirror_adapters.sql` (number claimed at apply time)
- Create: `scripts/db/assert-whatsapp-mirror-adapters.sql`

- [ ] **Step 1: Write the failing assertions**

Build fixtures the way #193's own assertion files do: create a snag on KINGSWALK assigned to the contractor fixture, and an RFI assigned to them. **Read `scripts/db/assertions/` from #193 for the insert shape its mirror triggers expect.** Then assert, calling as `service_role`:

```sql
SELECT * FROM (VALUES
  ('snag: holder Mark done without a close-out photo asks for one',
     (SELECT v->>'code' FROM _r WHERE k = 'snag_done_nophoto') = 'needs_photo'),
  ('snag: after the holder''s close-out photo, Mark done resolves the SNAG (source), and the mirror follows to answered',
     (SELECT v->>'code' FROM _r WHERE k = 'snag_done_photo') = 'ok'
     AND (SELECT status FROM field.snags WHERE id = current_setting('x.snag')::uuid) = 'resolved'
     AND (SELECT status FROM projects.work_items WHERE snag_id = current_setting('x.snag')::uuid) = 'answered'),
  ('snag: the PM (gatekeeper) Mark done signs it off',
     (SELECT status FROM field.snags WHERE id = current_setting('x.snag')::uuid) = 'signed_off'
     AND (SELECT signed_off_by::text FROM field.snags WHERE id = current_setting('x.snag')::uuid) = current_setting('x.pm')),
  ('snag photo lands in field.snag_photos as closeout, uploaded_by the user',
     EXISTS (SELECT 1 FROM field.snag_photos WHERE snag_id = current_setting('x.snag')::uuid
              AND photo_type = 'closeout' AND uploaded_by = current_setting('x.c')::uuid)),
  ('rfi: holder Mark done asks for the answer',
     (SELECT v->>'code' FROM _r WHERE k = 'rfi_done') = 'needs_answer'),
  ('rfi: wa_rfi_respond writes a response as the user and moves the RFI to responded',
     (SELECT v->>'code' FROM _r WHERE k = 'rfi_respond') = 'ok'
     AND EXISTS (SELECT 1 FROM projects.rfi_responses WHERE rfi_id = current_setting('x.rfi')::uuid AND responded_by = current_setting('x.c')::uuid)
     AND (SELECT status FROM projects.rfis WHERE id = current_setting('x.rfi')::uuid) = 'responded'),
  ('inspection mirror still links out',
     (SELECT v->>'code' FROM _r WHERE k = 'insp_done') = 'use_module'),
  ('an outsider cannot resolve the snag (RLS on field.snags)',
     (SELECT v->>'code' FROM _r WHERE k = 'snag_outsider') IN ('not_found', 'no_access'))
) AS t("check", ok);
```

- [ ] **Step 2: Write the migration**

- `CREATE OR REPLACE FUNCTION whatsapp.wa_mark_done(uuid,uuid)` with the Task 6 body. Replace its `IF v_wi.origin = 'mirror' THEN RETURN … 'use_module'` arm with the following, placed after the holder check:

```sql
  IF v_wi.origin = 'mirror' AND v_wi.item_type = 'snag' THEN
    IF NOT EXISTS (SELECT 1 FROM field.snag_photos sp
                    WHERE sp.snag_id = v_wi.snag_id AND sp.photo_type = 'closeout'
                      AND (v_wi.status = 'answered' OR sp.uploaded_by = p_user)) THEN
      RETURN jsonb_build_object('code', 'needs_photo', 'ref', v_wi.ref);
    END IF;
    BEGIN
      IF v_wi.status = 'answered' THEN
        UPDATE field.snags SET status = 'signed_off', signed_off_by = p_user, signed_off_at = now()
         WHERE id = v_wi.snag_id AND status IN ('resolved', 'pending_sign_off');
      ELSE
        UPDATE field.snags SET status = 'resolved', resolved_at = now()
         WHERE id = v_wi.snag_id AND status IN ('open', 'in_progress');
      END IF;
      GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('code', 'refused', 'ref', v_wi.ref, 'message', SQLERRM);
    END;
    IF n = 0 THEN RETURN jsonb_build_object('code', 'nothing_changed', 'ref', v_wi.ref); END IF;
    RETURN jsonb_build_object('code', 'ok', 'ref', v_wi.ref,
      'status', CASE WHEN v_wi.status = 'answered' THEN 'closed' ELSE 'answered' END,
      'gatekeeper_name', (SELECT full_name FROM public.profiles WHERE id = v_wi.gatekeeper_id));
  END IF;
  IF v_wi.origin = 'mirror' AND v_wi.item_type = 'rfi' THEN
    IF v_wi.status = 'answered' THEN
      BEGIN
        UPDATE projects.rfis SET status = 'closed' WHERE id = v_wi.rfi_id AND status = 'responded';
        GET DIAGNOSTICS n = ROW_COUNT;
      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object('code', 'refused', 'ref', v_wi.ref, 'message', SQLERRM);
      END;
      IF n = 0 THEN RETURN jsonb_build_object('code', 'nothing_changed', 'ref', v_wi.ref); END IF;
      RETURN jsonb_build_object('code', 'ok', 'ref', v_wi.ref, 'status', 'closed');
    END IF;
    RETURN jsonb_build_object('code', 'needs_answer', 'ref', v_wi.ref);
  END IF;
  IF v_wi.origin = 'mirror' THEN
    RETURN jsonb_build_object('code', 'use_module', 'ref', v_wi.ref, 'item_type', v_wi.item_type);
  END IF;
```

- A new function, `whatsapp.wa_rfi_respond(p_user uuid, p_item uuid, p_body text, p_inbound uuid) RETURNS jsonb`:
  - It is owned by `whatsapp_actor` and executable by `service_role` only, like Task 6.
  - It calls `act_as(p_user)` and reads the item (via RLS).
  - It requires `item_type = 'rfi'` and `origin = 'mirror'`.
  - It inserts `projects.rfi_responses (rfi_id, body, responded_by) VALUES (v_wi.rfi_id, left(p_body, 8000), p_user)`.
  - It runs `UPDATE projects.rfis SET status = 'responded' WHERE id = v_wi.rfi_id AND status = 'open'`.
  - It returns `ok` with the ref, and `refused` with SQLERRM on any exception.
- `CREATE OR REPLACE whatsapp.wa_add_attachment(...)` with the same signature. After inserting the `work_item_attachments` row, when `p_bucket = 'snag-photos'` it also runs `INSERT INTO field.snag_photos (snag_id, file_path, photo_type, uploaded_by) SELECT wi.snag_id, p_path, p_role, p_user FROM projects.work_items wi WHERE wi.id = p_item`. That insert is subject to `field.snag_photos` RLS as the user.
- Re-state the owners and grants explicitly for all three functions, **one statement each**.
- A `@verify` block naming `whatsapp.wa_rfi_respond(uuid,uuid,text,uuid)`, its owner, and `NOT has_function_privilege('authenticated', …)`.

- [ ] **Step 3: Dry-run until green, then mutate**

The mutation: drop the `sp.uploaded_by = p_user` clause. The snag must then resolve on the gatekeeper's older photo, and row 2's premise must change. Confirm that a test catches it by adding a fixture where only the PM has a close-out photo, and asserting the holder still gets `needs_photo`.

- [ ] **Step 4: Run all four WhatsApp assertion files and `pnpm --filter @esite/db test:ci`. Commit.**

## Task 22: Processor — snag photos into the Snags module's bucket

The processor already chooses `snag-photos` and `${org}/${project}/${snagId}/…` for snag mirrors (Task 11), and already routes `needs_answer` and `wa_rfi_respond` (Task 11). This task only proves it.

- [ ] **Step 1: Add processor tests**

1. A snag-mirror item (`origin: 'mirror', itemType: 'snag', snagId: 'S'`) receiving a photo uploads to `snag-photos` at `O/P/S/wa-<id>.jpg`.
2. With `pending_done_wants: 'answer'`, a text calls `wa_rfi_respond` and not `wa_add_note`.
3. With `pending_done_wants: 'answer'`, a photo does NOT resolve to the pending item. It follows the active item, or else a pick.

- [ ] **Step 2: Run, pass, commit.**

## Task 23: Phase 2 live verification (sending still OFF)

- [ ] **Step 1:** Apply Task 21's migration via Task 24 §1.
- [ ] **Step 2:** Run all WhatsApp assertion files against production and confirm they are green.
- [ ] **Step 3:** Confirm `whatsapp.sweep_due()` over real mirrored items enqueues **zero** rows. `notify_whatsapp` is false everywhere, and this shows the default holds.

---

# Task 24: Deploy runbook (write it, then execute Phase 1 with sending OFF)

**Files:**
- Create: `docs/whatsapp-runbook.md`

- [ ] **Step 1: Write the runbook with exactly these sections**

1. **Claim the migration number, immediately before applying.**
   - Read `max(version)` from `supabase_migrations.schema_migrations`.
   - `git fetch && git ls-tree origin/main apps/edge-functions/supabase/migrations/ | tail`.
   - Run `gh pr list --state open --json files` and grep for migration filenames.
   - If anything holds `00207` or higher, `git mv` the file to the next free number. Then fix every `00207` string in this plan's assertion headers and the `@verify` block's comments.
2. **Apply the migration.**
   - Apply through the deploy workflow (merge to main), or with the same `db push`.
   - Then run `node --experimental-strip-types scripts/verify-migration-applied.ts --file <file>`.
   - Expected: every directive green.
   - **A green workflow is not evidence**: read `whatsapp.settings` back.
3. **PostgREST schema PATCH** (this migration creates a schema).
   - GET `/v1/projects/cbskbnvvgcybmfikxgky/postgrest`.
   - PATCH `db_schema` to the existing list plus `,whatsapp`.
   - GET again twice and confirm.
   - Probe: `GET /rest/v1/phone_links` with header `Accept-Profile: whatsapp` using the anon key must return **401 or 403**, not PGRST002. The same call as service role must return **200 []**.
4. **Edge secrets.** Run `supabase secrets set --project-ref cbskbnvvgcybmfikxgky` with:
   - `WHATSAPP_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_APP_SECRET`
   - `WHATSAPP_VERIFY_TOKEN` (generate with `openssl rand -hex 24`)
   - `APP_URL=https://www.e-site.live`

   Until Meta onboarding completes, set the Meta values to `pending`. The webhook then rejects everything (fail closed), and the worker suppresses nothing because sending is off.
5. **Deploy the functions.**
   - Run `cd apps/edge-functions && ./deploy.sh whatsapp-webhook whatsapp-worker`, or the equivalent per-slug lines.
   - Read back `verify_jwt` from the Management API. Expected: `whatsapp-webhook` false, `whatsapp-worker` true.
   - Pull the deployed bundle (`/functions/{slug}/body`) and confirm `verifyMetaSignature` and `requireServiceRole` are present. **Verify the deployed artefact, not the repo.**
6. **The worker cron.** Register it through the Management API SQL endpoint, not in the migration, because it carries the legacy service JWT inline like the eight existing jobs:

```sql
SELECT cron.schedule('whatsapp-worker', '* * * * *', $$
  SELECT net.http_post(
    url := 'https://cbskbnvvgcybmfikxgky.supabase.co/functions/v1/whatsapp-worker',
    headers := jsonb_build_object('Authorization', 'Bearer <LEGACY eyJ… SERVICE ROLE JWT>', 'Content-Type', 'application/json'),
    body := '{"reason":"cron"}'::jsonb) $$);
```

   Verify with `SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'whatsapp%'`, which must return 2 rows. After one minute, `cron.job_run_details` must show `succeeded` for `whatsapp-worker`, and the function logs must show `{"drained":{"sent":0,…}}`.
7. **Vercel.** Merging to main deploys `/settings/account`, `/settings/whatsapp`, `/wa/[itemId]` and the item page. Read the deployment state from the GitHub deployments API.
8. **Unauthenticated probes.**
   - `GET /wa/<uuid>` → 307 to `/login?next=…`.
   - `GET /settings/whatsapp` → 307 to login.
   - `POST` to the webhook with no signature → 401.
   - `GET` the webhook with a wrong `hub.verify_token` → 403.
9. **Templates to submit in WhatsApp Manager** (language `en`). The bodies must match the parameter order in `templates.ts`:

| Name | Category | Body | Buttons |
|---|---|---|---|
| `esite_otp` | AUTHENTICATION | (Meta's fixed OTP body) `{{1}} is your verification code.` | Copy code |
| `esite_optin` | UTILITY | `{{1}} has invited you to receive and respond to site items for {{2}} on WhatsApp via E-Site. Your replies, photos and notes will be recorded on those items. Reply STOP at any time.` | Quick reply "Yes, I agree"; Quick reply "No thanks" |
| `esite_item_assigned` | UTILITY | `*{{1}}* · {{2}}\n{{3}}\nDue {{4}}` | Quick reply "Acknowledge"; Quick reply "Mark done"; URL "Open in E-Site" `https://www.e-site.live/wa/{{1}}` |
| `esite_item_due_tomorrow` | UTILITY | `Due tomorrow — *{{1}}* · {{2}}\n{{3}}\nDue {{4}}` | same three |
| `esite_item_overdue` | UTILITY | `Overdue {{5}} days — *{{1}}* · {{2}}\n{{3}}\nWas due {{4}}` | same three |
| `esite_items_waiting` | UTILITY | `You have {{1}} more E-Site items waiting for you today.` | URL "Open E-Site" `https://www.e-site.live/dashboard` |

   After approval, set `whatsapp.templates.status = 'approved'` for each one.
10. **Webhook subscription.** In the Meta App dashboard, set the callback to `https://cbskbnvvgcybmfikxgky.supabase.co/functions/v1/whatsapp-webhook`, with the verify token from step 4, and subscribe to the `messages` field.
11. **Rollback.**
    - Turn off the `whatsapp.settings.sending_enabled` switch (Settings → WhatsApp). This stops all sending within one cron tick.
    - `SELECT cron.unschedule('whatsapp-worker')` stops processing entirely.
    - The schema can stay: it is inert while every `notify_whatsapp` is false.

- [ ] **Step 2: Execute §1–§8 for Phase 1 with sending OFF. Record each read-back in the PR.**

- [ ] **Step 3: Commit the runbook**

```bash
git add docs/whatsapp-runbook.md
git commit -m "docs(whatsapp): deploy runbook — number claim, schema PATCH, secrets, cron, templates, rollback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Task 25: Go-live (owner-gated; needs Meta onboarding and #193)

Needs: Meta verification done, the number registered, all six templates `approved`, real secrets set, and Phase 2 applied. **Nothing in this task runs without the owner's go-ahead in chat.**

- [ ] **Step 1: Stage 1 (WM staff only).**
  - A WM engineer links their own number on `/settings/account`, receives the OTP, and confirms.
  - The owner turns on sending (Settings → WhatsApp) and `notify_whatsapp` on ONE project.
  - The owner creates a task assigned to that engineer (via `createWorkItemTaskAction`, or a mirrored snag once #193 is live).
  - **Verify:**
    - an outbox row goes queued → sent → delivered → read;
    - the card arrives;
    - Acknowledge writes an `acknowledged` event whose `actor_id` is the engineer;
    - a photo reply creates a `work_item_attachments` row and appears on the item page;
    - Mark done moves the item to `answered` with the ball on the gatekeeper;
    - the item page's WhatsApp log shows every step.
- [ ] **Step 2: Negative checks, live.**
  - An unlinked phone messages the number and gets one "not linked" reply, then silence for 24 h.
  - STOP from the engineer, then a new assignment: the outbox row is `suppressed` with `no_link`.
  - START re-enables delivery.
- [ ] **Step 3: Stage 2 (one live project).** The owner picks the project (spec §10 item 1). The PM invites the contractor foremen with **Add by WhatsApp**. Watch opt-ins on Settings → WhatsApp.
- [ ] **Step 4: The success measure.** A snag assigned to a foreman is closed with a close-out photo sent over WhatsApp, and the item leaves the PM's waiting list. Record the item ref and the event trail.
- [ ] **Step 5: Update `CLAUDE.md` "Current state" and the vault `sessions.md`.**

---

## Self-review (done at plan time)

- **Spec coverage.** Every spec section maps to a task:
  - §2.1 schema → Task 5
  - §2.2 functions → Task 13 (amended to two, per §9.4)
  - §2.3 acting as the user → Tasks 1 and 6 (amended to the actor role, per §9.3)
  - §3.1 → Tasks 14–15
  - §3.2 → Task 16
  - §3.3 STOP/START and removal → Task 11 and Task 6's removal assertion
  - §3.4 → Task 11
  - §4.1 → Task 7
  - §4.2 → Tasks 10 and 17
  - §4.3 → Tasks 3 and 11
  - §4.4 → Tasks 6 and 21
  - §4.5 → Tasks 3, 7 and 12
  - §5 → Tasks 7, 11 and 12
  - §6 → Tasks 17 and 19
  - §7 → the assertion files, the processor and worker tests, and the handler tests
  - §8 → Tasks 24 and 25
- **Deliberately not built:** §5's per-recipient email fallback. WhatsApp is additive, so every existing `notify_*_email` sender still runs; policy errors surface on Settings → WhatsApp and in the alert address instead. This is recorded here so the reviewer does not count it as a gap.
- **Names used across tasks:**
  - the `wa_*` signatures in Tasks 6, 8, 11, 13 and 21;
  - the `ProcessorStore` and `WorkerStore` members in Tasks 11–13;
  - `pending_done_wants` in Tasks 3, 5 and 11;
  - `claimed_at` and `claim_inbound` in Tasks 5, 7 and 13;
  - `enqueue_fold(uuid,date)` in Tasks 7, 12 and 13.
- **Known risks the executor must not paper over:**
  - Task 1 may fail on `GRANT authenticated` (Step 5 says STOP).
  - The `created` event's `to_ball_in_court_id` population is assumed by Task 7. If `PM assignment enqueues…` fails, read the event row first; do not change the trigger's rules to fit.
  - TS5097 on `.ts` imports (Task 13, Step 7).


