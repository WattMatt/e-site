## Appendix A — canonical registries

This appendix is the single source of truth for every vocabulary the programme extends. **No other section re-lists these values.** Where a section previously enumerated types, kinds, tokens, tables, routes or vendors, it now cites the table here by letter. The contract tests in §12 §(h) assert set equality against these tables in both directions; a value that appears in code and not here, or here and not in code, fails the build.

**That promise is kept rather than narrowed, and this is the map that makes it checkable.** §12 §(h) carries **eight** tests after this pass — the six it already listed plus test 7 (module tokens) and test 8 (the new-object inventory), added precisely so that no block below is cited as enforced when it is not:

| Block | Enforced by |
|---|---|
| A(b) work-item types | §12 §(h) test 1 — set equality against `projects.work_item_types` and the TypeScript type union |
| A(c) notification types and tiers | §12 §(h) test 2 — set equality against the `public.notification_types` seed |
| A(d) report kinds and read policy | §12 §(h) test 3 — set equality against the `ReportSpec` registry, plus the `report_kind_is_sensitive()` lockstep assertion |
| A(e) module tokens | §12 §(h) **test 7** — set equality in both directions between this table, the `@esite/shared` export, `project_settings_modules_known`'s `<@` array and the write-entry-table policy set. §04 §(f) and §06 §4.9 depend on this test existing |
| A(f) new tables, views and functions | §12 §(h) **test 8** — every object created by a programme migration appears here for its quarter, and every entry here is created; asserted off the `-- @verify:` blocks §12 §(c) already mandates. §06 §4.3's "inventing a table here would fail the build" depends on this test existing |
| A(g) routes | §12 §(h) test 4 — route coverage against `docs/rbac-matrix.md` |
| A(h) working-day calendar | The `listHolidays()` contract test named in the block itself, not a §(h) test — it asserts a materialisation against its computus source, which is a different assertion in kind |
| A(a), A(a2) | The DDL is the artefact; the migration's own `-- @verify:` block is the check |
| A(i) vendors | Commercial and legal, owned by a named person with a date; not a build-time assertion and not claimed as one |

Ruling ids in brackets refer to the arbitration ledger.

---

### A(a) — `projects.work_items`, the authoritative DDL [R2]

§03 governs the spine. This block is §03 §1.2's column set verbatim, with two amendments carried from the ledger: `work_items_source_required` admits `approval` alongside `task` [R7], and the Q2/Q3 source columns are shown in place so the table is read once rather than assembled from four sections. §12 §(a) Q1 cites this block and does not restate it.

```sql
CREATE TABLE projects.work_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES public.organisations(id),
  project_id       uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  item_type        text NOT NULL REFERENCES projects.work_item_types(key),
  origin           text NOT NULL DEFAULT 'mirror'
                   CHECK (origin IN ('mirror','split','manual')),
  ref              text NOT NULL,                -- 'RFI-12', per project, per type
  title            text NOT NULL,
  priority         text NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('low','medium','high','critical')),
  status           text NOT NULL DEFAULT 'triage'
                   CHECK (status IN ('triage','open','answered','closed','void')),
  source_status    text,                         -- display-only mirror of the module's vocabulary
  void_reason      text,
  assignee_id      uuid NOT NULL REFERENCES public.profiles(id),
  gatekeeper_id    uuid NOT NULL REFERENCES public.profiles(id),
  ball_in_court_id uuid GENERATED ALWAYS AS (
                     CASE status
                       WHEN 'triage'   THEN assignee_id
                       WHEN 'open'     THEN assignee_id
                       WHEN 'answered' THEN gatekeeper_id
                       ELSE NULL END) STORED,
  due_date         date NOT NULL,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz, closed_by uuid REFERENCES public.profiles(id),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES public.profiles(id),

  -- Q1 sources
  rfi_id        uuid REFERENCES projects.rfis(id)               ON DELETE SET NULL,
  snag_id       uuid REFERENCES field.snags(id)                 ON DELETE SET NULL,
  qc_entry_id   uuid REFERENCES projects.qc_entries(id)         ON DELETE SET NULL,
  diary_id      uuid REFERENCES projects.site_diary_entries(id) ON DELETE SET NULL,
  site_form_id  uuid REFERENCES field.site_forms(id)            ON DELETE SET NULL,
  node_order_id uuid REFERENCES structure.node_orders(id)       ON DELETE SET NULL,
  inspection_id uuid REFERENCES inspections.inspections(id)     ON DELETE SET NULL,
  -- Q2 source (added by the instructions migration, both CHECKs re-declared wholesale)
  instruction_recipient_id uuid REFERENCES projects.instruction_recipients(id) ON DELETE SET NULL,

  CONSTRAINT work_items_one_source CHECK (
    (rfi_id IS NOT NULL)::int + (snag_id IS NOT NULL)::int + (qc_entry_id IS NOT NULL)::int
  + (diary_id IS NOT NULL)::int + (site_form_id IS NOT NULL)::int
  + (node_order_id IS NOT NULL)::int + (inspection_id IS NOT NULL)::int
  + (instruction_recipient_id IS NOT NULL)::int <= 1),

  CONSTRAINT work_items_source_required CHECK (
    item_type IN ('task','approval') OR status = 'void'
    OR (rfi_id IS NOT NULL)::int + (snag_id IS NOT NULL)::int + (qc_entry_id IS NOT NULL)::int
     + (diary_id IS NOT NULL)::int + (site_form_id IS NOT NULL)::int
     + (node_order_id IS NOT NULL)::int + (inspection_id IS NOT NULL)::int
     + (instruction_recipient_id IS NOT NULL)::int = 1),

  CONSTRAINT work_items_bic_present CHECK (
    status IN ('closed','void') OR ball_in_court_id IS NOT NULL),
  CONSTRAINT work_items_ref_unique UNIQUE (project_id, ref)
);
```

**Three properties are load-bearing and every dependent section is written against them.**

1. **`assignee_id` is `NOT NULL`.** An item that belongs to nobody cannot exist. §04's four date buckets, §04's refusal of a "No date" group, §12's `inbox_for_user` and §15's metrics 4 and 7 all depend on it.
2. **`due_date` is `NOT NULL`,** computed in working days by the `BEFORE INSERT` trigger against A(h)'s calendar, with a calendar-day fallback for paths that pass no date.
3. **`ball_in_court_id` is a `STORED` generated column**, null only for `closed` and `void`. It is legal Postgres: the expression is a `CASE` over three columns **of the same row** and calls nothing. §12's objection ("a `GENERATED` column cannot call a resolver") and §02's objection ("subqueries are rejected outright") are both correct about a *different* design — one that derives the holder from child tables — and neither applies here. §08's `projects.resolve_ball_in_court()` is a **separate function with a separate job**: it supplies a non-null holder for the ten non-work-item `dated_items` kinds and passes `work_items.ball_in_court_id` straight through for `work_item_due`.

**Indexes** (§03 §1.7, re-expressed as the single index set; §12's nullable-`due_at` keyset ordering collapses to a two-part cursor because `due_date` is `NOT NULL`):

| Index | Purpose |
|---|---|
| `(assignee_id, status, due_date) WHERE status <> 'closed'` | My Work |
| `(ball_in_court_id, due_date) WHERE status IN ('triage','open','answered')` | Inbox, overdue sweep, chase-sweep selection |
| `(project_id, item_type, status)` | Project home module table |
| `(organisation_id)` | Org scans |
| One partial `UNIQUE` per source column `WHERE <col> IS NOT NULL AND origin = 'mirror'` | Idempotent projection; a `split` or `manual` row sharing a source is legal and untouched by pushback |

Keyset pagination is `ORDER BY due_date ASC, id ASC` with a two-part cursor. There is no NULLS ordering because there are no nulls.

**Write path.** Direct client `INSERT` is refused for every mirrored type — the source row is the only entry point. `task` and `approval` are the only client-insertable types, gated by `projects.user_can_write_work_item(project_id, item_type)` in the app **and** by a RESTRICTIVE policy. `work_item_events` is INSERT-only to `authenticated` with no UPDATE or DELETE policy, written by a `SECURITY DEFINER` append trigger; the transition guard trigger is `SECURITY INVOKER`.

---

### A(a2) — `field.inbound_messages`, the authoritative column set and verdict vocabulary

**This object was specified twice, in §05 §(f) and §11.3, with incompatible column names, two disposition designs and two rejection vocabularies — inside a document that twice asserts there is one table under one name. It is settled here so that both sections cite one block.** It is lettered **A(a2)** rather than inserted as a new letter so that every existing citation of A(b)–A(i) elsewhere in the document keeps its letter.

**The column set is §05 §(f)'s**, on three grounds the reviewer argues and this appendix accepts: §05 owns the parser and the 90-day raw-MIME retention rule; its disposition columns are **typed FKs**, which is the anti-polymorphic decision §03 §1.2 and §04 take by name and §11.3's `(disposition_entity_type, disposition_entity_id)` pair silently reverses; and its names are the ones the parser and the tray are written against. **Four columns are carried over from §11.3 because §05 lacked them and each does a job**: `message_id` and `in_reply_to` (threading a reply to the outbound message that provoked it, and de-duplicating a message delivered twice), `resolved_role` (the role the handler decided against — §11.3's service-client rule requires the decision to be *recorded*, not just made) and `bytes` (ceiling accounting beside `attachment_count`).

```sql
field.inbound_messages (
  id, received_at, created_at,

  -- the envelope as received, before any interpretation
  message_id, in_reply_to,
  from_address,            -- the From: header, which is trivially forged
  envelope_sender,         -- SMTP MAIL FROM
  to_address, subject,

  -- scope
  project_id, organisation_id,

  -- what the HMAC resolved to, and the authority the handler decided against
  token_kind, token_item_id, token_user_id,
  resolved_author_id, resolved_role,

  -- content
  body_text, body_html_sanitised,
  raw_mime_path text,            -- storage object, retained 90 days
  raw_mime_expires_at date,

  -- the security checks, as received
  dkim_result, spf_result,

  -- the single verdict
  result text NOT NULL CHECK (result IN (
    'accepted','unverified','quarantined',
    'bounced_dkim','bounced_access','bounced_size',
    'rate_limited','rejected_auto')),
  reason text,

  -- accounting and disposition (typed FKs; no polymorphic pair)
  attachment_count, bytes,
  work_item_id, thread_message_id)
```

**One verdict column, one name, one value set.** The column is **`result`**, with `reason` beside it — not §05's `verification_state` / `reject_reason` — because §15 §(b)'s inbound-outcome metric and §11.3's "`inbound_email_events(result, reason)` is this same object under a second name" both key on those two names, and because `verification_state` conflated the *outcome* with the *identity check*, which now has its own recorded inputs. §05's `verification_state = 'unverified'` tray predicate becomes `result = 'unverified'`; nothing else about the tray changes.

**Which failure classes bounce, and which land unverified — stated once, because §05 and §06 §4.1 disagreed about it.**

| `result` | Posted? | Bounced? | When |
|---|---|---|---|
| `accepted` | yes | — | DKIM passes and aligns with `From:`, envelope sender matches `public.profiles.email` for the token's user, and that user still passes `user_has_project_access` at the moment of receipt |
| `unverified` | **yes** — attached to the item and routed to the Unverified-inbound tray with the PM's one-click "this is me" binding | **no** | DKIM valid, identity mismatch only. Site foremen reply from phone aliases, forwarded mailboxes and shared site addresses; bouncing them destroys mail from exactly the thirteen contractor accounts this programme exists to reach |
| `quarantined` | no | **no** | The HMAC does not verify, or resolves to nothing. A bounce would confirm to a forger that the address exists |
| `bounced_dkim` | no | **yes** | DKIM fails, or passes but does not align with the `From:` domain |
| `bounced_access` | no | **yes** | The token is revoked or expired, the item is closed, or the resolved user no longer passes `user_has_project_access` |
| `bounced_size` | no | **yes**, naming the limit | Over 25 MB, or more than 10 attachments |
| `rate_limited` | deferred | only on expiry | Over 20 posts per user per hour or 60 per project per hour. **Queued, never dropped** (§05 §(f)); the row's `result` is rewritten to its terminal verdict when the queue drains, and bounces only if it is still queued after 24 h |
| `rejected_auto` | no | **no** | `Auto-Submitted: auto-*`, `X-Autoreply`, `Precedence: bulk`, or an empty stripped body. Bouncing an auto-responder is how a mail loop starts |

**§06 §4.1's "a message failing verification is bounced and never posted" is amended by this block** to: a DKIM failure or an access failure is bounced and never posted; an identity mismatch is posted with `result = 'unverified'` and is visibly marked as such on the thread.

**Placement and policy.** `field` schema, Q2 (A(f)) — already exposed, so **no PostgREST `db_schema` PATCH is involved** and the `PGRST002` failure mode is not in play. Raw MIME is filed to storage and retained 90 days, then swept by the same nightly job that expires signed URLs; body text and the verdict columns are retained with the item, because they are the record of what a person said. RLS is project-scoped, read is `ORG_WRITE_ROLES`, there is **no client write path at all**, and the migration ends with `REVOKE SELECT … FROM anon` verified by `has_table_privilege`. The table backs exactly three surfaces and is sized for all three: the **Unverified-inbound tray** (`result = 'unverified'`), the **abuse metric** (rejects per project per week, the only way to notice an address being harvested), and the **support queue**, because "my reply never arrived" is otherwise unanswerable and 90 days of raw MIME are what settle it.

---

### A(b) — work-item types, and the quarter each is registered [R7]

One row per type in `projects.work_item_types (key, label, source_table, source_column, default_days, calendar, gatekeeper_rule, write_roles text[], sort_order, is_active)`. A type is registered in the migration of the quarter that first creates rows of it.

| Key | Quarter | Source | Default due | Calendar | Default assignee when unnamed | Gatekeeper |
|---|---|---|---|---|---|---|
| `rfi` | Q1 | `projects.rfis` | +7 wd | office | project `triage_owner_id` | project PM |
| `snag` | Q1 | `field.snags` | +5 wd | site | `triage_owner_id` | project PM |
| `qc_defect` | Q1 | `projects.qc_entries` (failed entries on issued/closed reports only) | +5 wd | site | `triage_owner_id` | project PM |
| `inspection` | Q1 | `inspections.inspections` | +3 wd | site | existing `assigned_to_id`, else `triage_owner_id` | `verifier_id`, else PM |
| `diary_action` | Q1 | `projects.site_diary_entries` (entries carrying `delays`/`delay_notes` only) | +2 wd | site | `triage_owner_id` | project PM |
| `form_action` | Q1 | `field.site_forms` | +3 wd | site | `triage_owner_id` | project PM |
| `order_followup` | Q1 | `structure.node_orders` — **explicit chase only, one control on the order line; no bulk backfill and no automatic path** | +10 wd | office | `triage_owner_id` | project PM |
| `task` | Q1 | none (sourceless) | +5 wd | office | creator | creator |
| `instruction` | Q2 | `projects.instruction_recipients` (one item per `to` recipient) | `respond_by` | office | the recipient | the issuer |
| `approval` | Q3 | none (sourceless; `projects.approvals.request_id` points back at it) | +5 wd | office | the named approver | the requesting PM |
| `valuation` | Q4 | `projects.valuations` | valuation date +5 wd | office | the certifier | the certifier |

**Six of the seven Q1 sources get a projection trigger. `structure.node_orders` does not** — `order_followup` is created only by the explicit chase control on an order line, and the Q1 migration ledger in A(f) is written that way.

**Explicitly not registered, with the reason recorded so it is not re-litigated:**

- `qc_report` (§12 §(d)) — §03 governs: mirroring every issued entry manufactures ~40 inbox items from one 40-line report. Only failed entries on issued reports become `qc_defect`.
- `site_form` (§12 §(d)) — the same object as `form_action`; the key is `form_action`.
- `variation_order`, `handover_item` (§12 §(d)) — zero rows in production and neither ships in the twelve months after the Q4 re-plan. Not provisioned "before first use"; provisioned when there is a use.
- `meeting_action` — meeting minutes is cut past twelve months [R19], and `work_items.meeting_item_id` is removed from the Q2 migration with it.
- `triage` (§05 §(g)) — `triage` is a **status**, never a type. Email-to-item creates a `task` [R30].

---

### A(c) — notification types and their delivery tier [R23]

Q1 replaces `notifications_type_check` with `public.notification_types(type PK, tier, default_audience, always_fires bool, module, is_active)` plus an FK from `notifications.type`, added `NOT VALID` and validated after seeding. **The seed is the enumerated constraint set UNION the live `SELECT DISTINCT type`** — verified 18 values at `apps/edge-functions/supabase/migrations/00179_site_forms.sql:596-621`; §03 §1.10's "17" is corrected to 18. After Q1, adding a type is an `INSERT`, never a re-declaration; §06 §4.3, §08 §(d), §09 §(c), §10.2 and §12 §(e) are amended accordingly.

Tiers: **Immediate** (bell now, push now unless quiet hours, email after a 60 s grace if unseen) · **Held** (5-minute coalescing window, sent at close if unseen) · **Recap** (writes `projects.activity`, never `public.notifications`; appears only in the 07:00 line).

| Type | Registered | Tier | Audience | Always fires |
|---|---|---|---|---|
| `rfi_created` | live | Recap | activity feed (Immediate to the assignee when assigned at creation) | no |
| `snag_created` | live | Recap | activity feed (Immediate to the assignee when assigned at creation) | no |
| `diary_created` | live | Recap | activity feed | no |
| `qc_issued` | live | Held | distribution list | no |
| `qc_comment` | live | Held | thread participants | no |
| `snag_visit_completed` | live | Held | distribution list | no |
| `site_form_distributed` | live | Immediate | named recipients | no |
| `snag_status_changed` | live | Held | assignee + raiser, both channels | no |
| `rfi_response` | live | Held | participants | no |
| `rfi_closed` | live | Held | participants + assigner | no |
| `inspection_assigned` | live | Immediate | assignee | no |
| `inspection_awaiting_verification` | live | Held | verifier | no |
| `inspection_abandoned` | live | Held | assignee + verifier | no |
| `inspection_certified` | live | Held | contributors + PMs | no |
| `inspection_re_inspect_required` | live | Immediate | current holder | no |
| `rfi_assigned` | live | — | **retired**: seeded `is_active = false`, never emitted | no |
| `grn_recorded` | live | — | **retired**: seeded `is_active = false`, never emitted | no |
| `inspection_revoked` | live | — | **retired**: seeded `is_active = false`, never emitted | no |
| `work_item_assigned` | Q1 | Immediate | new assignee | **yes** |
| `work_item_reassigned` | Q1 | Immediate | new assignee + outgoing holder | **yes** |
| `ball_in_court_changed` | Q1 | Immediate | new holder | **yes** |
| `work_item_overdue` | Q1 | Recap | current holder only | **yes** |
| `work_item_closed` | Q1 | Held | the assigner | no |
| `triage_item_received` | Q1 | Recap | project triage owner | no |
| `job_missed` | Q1 | Immediate | org owner — a scheduled job with no run row inside its threshold [R50] | **yes** |
| `mention` | Q2 | Immediate | the mentioned user | **yes** |
| `thread_reply` | Q2 | Held | thread participants | no |
| `instruction_issued` | Q2 | Immediate | `to` recipients (Held for `cc`) | no |
| `instruction_ack_due` | Q2 | Held | the issuer | no |
| `diary_checkin_due` | Q2 | Held | contractor / PM on active projects, at the user's chosen time | no |
| `diary_countersign_due` | Q2 | Held | the principal agent | no |
| `chase_nudge` | Q3 | Immediate | one per person per day, ranked | **yes** |
| `report_issued` | Q3 | Held | distribution list | no |
| `report_schedule_failed` | Q3 | Immediate | org owner + the schedule's creator | **yes** |
| `approval_requested` | Q3 | Immediate | the named approver | **yes** |
| `approval_decided` | Q3 | Held | the requester | no |
| `transmittal_received` | Q3 | Immediate | transmittal recipients | no |
| `order_late` | Q4 | Held | ball-in-court, one **digest per project per day** when the red/amber set changes | no |
| `milestone_due` | Q4 | Held | milestone owner | no |

**`work_item_overdue` has exactly one producer.** In Q1–Q2 it appears only as recap section 2, holder-addressed. From Q3 it is produced **solely by the chase sweep** on §10.2's ladder — 72 h minimum interval, rungs at days 1 / 4 / 8 / 15 — and §05 §(e)'s independent daily cadence and +7-day rung are deleted [R28].

---

### A(d) — report kinds and their read policy [R12]

`projects.reports.kind` carries no CHECK. From the Q3 registry port, `access.read` on the `ReportSpec` registry is the single source; `REPORT_KIND_READ_ROLES` and `OPEN_READ_REPORT_KINDS` are deleted and `report-kind-access.contract.test.ts` is repointed at the registry, keeping its scanner guard. §07's `access.read` type is widened to admit the recipient-scoped variant §06 requires:

```ts
access: {
  generate: OrgRole[]
  read: OrgRole[] | { roles: OrgRole[]; recipient_lookup: RecipientTable }
  distribute: OrgRole[]
}
type RecipientTable = 'instruction_recipients' | 'transmittal_recipients'
```

`public.report_kind_is_sensitive()` stays in lockstep by a second test asserting the SQL list equals the set of kinds whose `read` is narrower than project access.

| Kind | Ships | Read policy |
|---|---|---|
| `inspection` | live | project access (open) |
| `snag` | live | project access (open) |
| `qc` | live | project access (open) — keeps the `qc-reports` bucket and its eight `00172:539-551` policies; no object moves |
| `tenant_schedule` | live | project access (open) |
| `equipment_materials` | live | `ORG_WRITE_ROLES` |
| `valuation` | live | `COST_VIEW_ROLES` |
| `site_form` | live | project access (open) |
| `generator` | Q4 (backfilled from `gcr.report_revisions`) | `COST_VIEW_ROLES` — it is a cost-recovery apportionment |
| `cable_schedule` | Q4 | project access (open), cost columns redacted in the projection by `export-role.ts` |
| `instruction` | Q2 | `ORG_WRITE_ROLES` + `recipient_lookup: 'instruction_recipients'` |
| `rfi_register` | Q3 | project access (open) |
| `snag_round` | Q3 | project access (open) |
| `weekly_project` | Q3 | project access (open) |
| `transmittal` | Q3 | `ORG_WRITE_ROLES` + `recipient_lookup: 'transmittal_recipients'` |
| `monthly_client` | Q4 | project access (open); commercial sections omitted **in the projection** unless the recipient holds `COST_VIEW_ROLES` |
| `tenant_delivery` | Q4 | project access (open); the landlord surface is served by `requirePortalAccess` → service client → allow-listed columns, not by RLS |
| `project_export` | Q4 | `ORG_WRITE_ROLES` |

Cut past twelve months and therefore **not** registered: `daily_site` [superseded by the 07:00 recap's section 4], `meeting_minutes`, the instruction/GRN/CoC-ZIP packs.

**Account-less access is one mechanism, not two** [R11]: `public.guest_links` with `scope='report'`. `projects.report_access_tokens` (§07 §5.5) is not created; §07's six redemption rules become the properties of that scope — token-only resolution, `status='issued'` only, 30-day default with the `CHECK (expires_at <= created_at + interval '90 days')` ceiling, `revoked_at`, `max_uses`, an audit row per redemption with `actor_id = NULL`, and 20 requests per token per hour / 200 per IP per hour without disclosing whether the token exists.

---

### A(e) — module toggle tokens and default state [R25]

Storage is `projects.project_settings.enabled_modules text[] NOT NULL` with the `<@` CHECK; the **column default carries the default-ON set**. §12's `projects.project_modules` table is deleted — indexability is a GIN index on the array, and attributability is already supplied by the `00102_project_settings_history` audit trigger.

| Token | Default | Write-entry table gated by the RESTRICTIVE policy |
|---|---|---|
| `quality_control` | **ON** | `projects.qc_reports` |
| `inspections` | **ON** | `inspections.inspections` |
| `cables` | **ON** | `cable_schedule.revisions` |
| `tenant_schedule` | **ON** | `structure.nodes` |
| `equipment_materials` | **ON** | `structure.node_orders` |
| `handover` | OFF | `projects.handover_checklist` |
| `forms` | OFF | `field.site_forms` |
| `jbcc` | OFF | `projects.jbcc_notices` |
| `medium_voltage` | OFF | `cable_schedule.mv_study_settings`, `cable_schedule.fault_sources` |
| `generator_cost_recovery` | OFF | `gcr.zones` |

**Always on, not toggleable:** Overview, Site Diary, Snags, RFIs, Floor Plans, **Documents**, Settings. Documents is a route that exists (`(admin)/projects/[id]/documents/page.tsx`, verified) and is absent from `projectNav` (`Sidebar.tsx:73-88`, verified — sixteen entries, none of them Documents); it is added to the nav and **is** the Q2 drawing-and-document register surface, not a page beside it [R46].

**Marketplace is not a token.** It is org-level (orders key on `contractor_org_id`) and both nav entries — the `GLOBAL_NAV` row at `Sidebar.tsx:68` (verified) and the in-project Workspace link (`Sidebar.tsx:20,178-187`, verified) — are deleted; `(admin)/marketplace` redirects to `/inbox` while `NEXT_PUBLIC_PHASE_2_MARKETPLACE` is off. Tables, the seven `(marketplace)` pages and the two April orders are untouched. §11.7's "exactly the six" is corrected to **five per-project toggles plus Marketplace removed from navigation**.

**Global surfaces not previously inventoried** [R46], all always-on and unchanged by the programme: `/inspections/templates` (a `GLOBAL_NAV` entry, `Sidebar.tsx:67`; the versioned inspection-template family with its `enforce_template_immutability` trigger — a **different engine** from the site-form templates), `/settings/integrations` (the cloud-storage mapping every drawing and document deliverable depends on), `/settings/health` (org churn scores; §14 Q4.8's project health is a different computation and does not replace it). `/projects/[id]/materials` and `/projects/[id]/equipment-schedule` are legacy redirect shims (both verified present) and are **deleted in Q1 item 8**, with their `docs/rbac-matrix.md` rows removed in the same PR.

**Composition with paid entitlements is AND, never OR:** `access = enabled_modules contains the token AND the entitlement gate passes`. The RESTRICTIVE policy tests only the toggle; `has_feature` / `user_has_mv_access` remain a separate, unchanged gate.

---

### A(f) — new tables by quarter, with schema placement [R3, R29, R45]

**No new schema for the six primitives.** Everything project-scoped goes in `projects` (already exposed at `config.toml:9`, verified); the notification and metrics engine extends `public`. **One exception, and it carries three obligations:** §10's `ai` schema in Q3 needs (1) the Management-API `PATCH /v1/projects/{ref}/postgrest` on `db_schema`, (2) a **complete GRANT block** — schema `USAGE` to `anon`, `authenticated`, `service_role` plus all table and sequence privileges, the omission of which produced `PGRST002` across the entire REST API in `00069_inspections_grants.sql:2-13` — and (3) an edit adding `ai` to `apps/edge-functions/supabase/config.toml:9`, which today lists eleven schemas and not `ai` (verified), so local dev and any fresh database would otherwise diverge from production.

**Migration numbers are claimed at merge, never here** [R3]. Migrations are identified by quarter and ordinal. Every new table in `projects` ends its migration with `REVOKE SELECT ... FROM anon` — `00025_grant_schema_permissions.sql:26` sets `ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES TO anon` (verified), so every new table is born anon-readable at the grant layer — verified afterwards with `has_table_privilege`, never by reading `relacl`.

| Quarter | New tables / views / functions | Schema |
|---|---|---|
| **Q1** | `work_items`, `work_item_types`, `work_item_events`, `work_item_watchers`, `activity`, `public_holidays`, `calendar_years`, `working_days_between()`, `project_had_activity()` | `projects` |
| | `inbox_state`, `notification_types`, `notification_preferences`, `notification_project_mutes`, `user_presence`, `user_sessions`, `touch_presence()`, `user_is_org_admin()`, `notification_dispatch_runs`, `recap_runs`, `notification_dead_letters`, `product_events`, `platform_metrics_weekly`, `metric_cohorts`, `metric_accounts` (view), `metric_account_excluded()`, `emit_product_event()`, `compute_platform_metrics_weekly()` | `public` |
| | *Column adds:* `project_settings` (`work_item_defaults`, `triage_owner_id`, `enabled_modules`, `suppress_all_outbound`, `client_comments_enabled`, shutdown window); `notifications` (§05's **thirteen** columns — `project_id`, `actor_id`, `tier`, `dedupe_key`, `coalesced_count`, `hold_until`, `hold_extensions`, `delivered_at`, `seen_at`, `cleared_at`, `email_state`, `push_state`, `read_at_estimated`; counted off §05's `ALTER TABLE` block, and the thirteenth is the one a stale twelve drops — metric 5's standing `read_at_estimated = false` filter has no column without it); `auth_events.session_id` | |
| | *Drops:* `notifications.is_read` (after the client change deploys); `notifications_own` policy; `notifications_type_check` (replaced by the FK) | |
| **Q2** | `threads`, `thread_messages`, `message_mentions`, `thread_participants`, `thread_subject_types`, `instructions`, `instruction_recipients`, `instruction_events` | `projects` |
| | `document_versions` | `tenants` |
| | `inbound_messages` — column set and verdict vocabulary in **A(a2)**, not in §05 or §11.3 | `field` |
| | `web_push_subscriptions` | `public` |
| | *Column adds:* `floor_plan_versions` + `document_versions` (`revision_label`, `revision_label_source`); `site_diary_entries` (`submitted_at`, `submitted_by`, `countersigned_at`, `countersigned_by`, `countersign_method`, `plant_on_site`); `jbcc_letters` (`acknowledged_at`, `acknowledged_by`); `work_items.instruction_recipient_id` with both CHECKs re-declared; `projects.projects` (`latitude`, `longitude`) | |
| | *Drops:* `projects.drawings` (zero rows) and the `'drawing'` value in `attachments.entity_type` | |
| **Q3** | `report_schedules`, `report_runs`, `approvals`, `transmittals`, `transmittal_items`, `transmittal_recipients`, `claim_due_report_schedules()`, `file_report()` | `projects` |
| | `guest_links` | `public` |
| | `runs`, `drafts`, `nudges`, `org_profile` — **plus the config PATCH, the full GRANT block and the `config.toml` edit** | `ai` (new) |
| | *Column adds:* `reports` (`period_key`, `period_start`, `period_end`, `narrative_json`, `bucket`, `audience`) + the `reports_one_issued` partial unique index, built only after the duplicate count returns zero; `notification_preferences.chase_opt_out` | |
| | *Drops:* **none.** The `projects.qc_comments` drop travelled to Q4 with its deliverable: §14's re-plan moves the QC-comment and RFI-response back-fill and the renderer repoint out of Q3, and the drop cannot precede the repoint that empties the table's last reader | |
| **Q4** | `calendar_entries`, `milestones`, `dated_items` (view, `security_invoker = true, security_barrier = true`), `resolve_ball_in_court()`, `project_health_snapshots` | `projects` |
| | *Column adds:* `tenant_details.bo_confirmed_on`; `tenant_document_revisions.approved_on` / `approved_by`; `tenants.documents.kind` CHECK re-declared with `occupation_cert`; `scope_item_types.lead_time_days` / `install_days` **with the `db` 60/5 and `lighting` 30/3 seeds in the same statement**; `project_settings.equipment_lead_time_days` / `equipment_install_days`; `profiles.ics_token_hash`; the place columns on `field.snags`, `field.snag_photos`, `projects.qc_entry_photos`, `field.form_photos` with the `NOT VALID` place CHECK; `billing.subscriptions.grandfathered_rate_zar` / `grandfathered_until` and the tier CHECK widened to the four bands | |
| | *Drops:* `projects.qc_comments`, after the renderer repoint of `qc-report-data.ts:210,221` and `qc.service.ts:290` lands in the same quarter (§14's Q4 ordinal 9, arrived from Q3 with the back-fill); `field.inspection_milestones` after asserting `count(*) = 0` in the same transaction; `gcr.report_revisions` at the end of its read-only quarter | |

**Not created, by ruling:** `report_access_tokens` [R11]; `project_modules` [R25]; `notification_prefs`, `notification_deliveries`, `digest_batches` [R9]; `calendar_events`, `programme_tasks`, `programme_links` [R16]; `public.sa_public_holidays` [R24]; `public.organisations.report_narrative_profile` [R20]; `structure.tenant_details.lease_signed_on` / `occupation_certificate_on` [R14]; `node_orders.lead_time_days` / `install_days` [R15]; `public.org_invites.role` — the table was dropped by `00079_admin_managed_users.sql:39` (verified) [R10].

**Every destructive migration in that list takes a pre-migration snapshot** into a timestamped `backup_<version>_<object>` table in the same transaction, retained 90 days, with the restore statement named in the migration header [R52].

#### The Q1 migration ledger — **eleven migrations**, in this order, owned here

**Four sections previously gave four different homes and orderings for the same Q1 objects, and §05's security migration was booked in no quarter's ledger at all.** This block settles all of it: §12 §(c), §13's migration table and exit criterion, and §15's cost paragraph **cite this ledger and do not re-order it**. Numbers are still claimed at merge against `max(version)` **and** `origin/main`, never here; each migration carries a `-- @verify:` header checked by `scripts/verify-migration-applied.ts` after the push.

**Three substantive corrections are made in the ordering, not just the bookkeeping.** (1) `user_presence`, `user_sessions`, `touch_presence()`, `public_holidays` and `calendar_years` are created **once**, in the metrics migration, which lands first of the substantive set — they were previously created in §13's notification group, claimed by §15, disclaimed by §05 and listed *last* by §12, which would have put the calendar after the due-date trigger that raises without it. (2) Only `auth_events.session_id` and the backfill-completion event stay late, which is all the "last, so it can record the backfill's own completion event" argument ever required. (3) §05's `project_notification_recipients` hardening is **migration 0** — it is a live cross-org data leak and ships first, alone.

| # | Contents | Why here |
|---|---|---|
| **0** | `project_notification_recipients` hardened: a `user_has_project_access(p_project_id)` guard inside the function, a service-role-only variant for the dispatcher, `REVOKE EXECUTE FROM PUBLIC` **and** `FROM anon`, verified with `has_function_privilege('anon', oid, 'EXECUTE')` (§05 migration 1) | Ships first and alone. It fixes a live leak and depends on nothing in this programme |
| **1** | Metrics, presence and calendar foundation (§15's Q1 metrics migration): `product_events`, `platform_metrics_weekly`, `metric_cohorts`, the `metric_accounts` view, `user_presence`, `user_sessions`, `touch_presence()`, `user_is_org_admin()`, `projects.public_holidays` seeded from `listHolidays(year)`, `projects.calendar_years`, `working_days_between()`, and the nightly rollup job | The baseline every later target is measured against, **and** A(h)'s calendar, which must precede the spine because `due_date` is `NOT NULL` and its trigger raises `no_data_found` on an unseeded year |
| **2** | `notification_types` seeded per A(c) (constraint set UNION live DISTINCT, retired values `is_active = false`) + the `notifications.type` FK `NOT VALID` then validated + the **thirteen** new `notifications` columns (§05's block, `read_at_estimated` included) + RLS replacement + the four `SECURITY DEFINER` RPCs + the coalesce index + §05 §(i)'s single merged cutover (§05 migration 2) | Must precede any trigger that emits `work_item_assigned`: the bell path swallows failures, so a rejected type would write no row **and no error**. This is the platform's last wholesale re-declaration of `notifications_type_check` |
| **3** | `DROP COLUMN notifications.is_read` + rebuilt partial index (§05 migration 3) | After the client change is deployed, never with it |
| **4** | `notification_preferences` + `notification_project_mutes` (§05 migration 4) | Reads the presence objects from migration 1 and creates none of them |
| **5** | `notification_dispatch_runs` + `recap_runs` + `notification_dead_letters` (§05 migration 5) | The run-row evidence item 13's checker reads, and the dead-letter table without which no volume metric is trustworthy |
| **6** | `project_settings`: `enabled_modules` + the `<@` CHECK + the GIN index + seeding from live data; `work_item_defaults`; `triage_owner_id` (nullable) + the `ensure_project_settings_row()` rewrite + backfill of all 14 projects; `suppress_all_outbound`, `client_comments_enabled`, the shutdown window | Must precede the spine, or `assignee_id NOT NULL` fails mid-backfill on the projects with no assignee anywhere; and the toggle seeding must run before the OFF defaults hide live data |
| **7** | `work_items` + `work_item_types` + `work_item_events` + `work_item_watchers` + the A(a) index set + helpers + RESTRICTIVE policies with `user_can_write_work_item` and `project_module_enabled` + grants + `anon` revokes | The spine |
| **8** | `projects.activity` (DDL in §06 §4.3) + reclassification of the 750 `diary_created` rows onto it + `public.inbox_state` with its own-row policy | The recap's Recap-tier destination and the Inbox's state half; both reference the spine, so they follow it |
| **9** | Projection triggers on the **six automatic** Q1 sources of A(b) — `rfis`, `snags`, `qc_entries`, `inspections`, `site_diary_entries`, `site_forms` — with assignment write-back; then the entity backfill under `SET LOCAL esite.suppress_notifications = 'on'`; then `auth_events.session_id`; then the backfill-completion `product_events` row | `structure.node_orders` gets **no trigger**: `order_followup` is explicit-chase-only (A(b)). Triggers precede the backfill so retries are idempotent through the partial UNIQUE per source column, and the completion event is written last because that is what it records |
| **10** | Role-vocabulary narrowing: `user_organisations_role_check` re-declared with exactly the seven `ORG_ROLES` values, after remapping and counting the four `00022` orphans to zero | Independent of the spine; sequenced last so a remap error cannot block the release |

---

### A(g) — routes introduced, with their route group [R18, R46]

`docs/rbac-matrix.md` moves in the same PR as every row below; `CONFORMANCE.md` moves with every row marked ‡ (an auth surface or a new bearer credential).

| Route | Group | Quarter | Gate |
|---|---|---|---|
| `/inbox` | **`(work)`** — new group beside `(admin)` and `(portal)`, authentication-only, its own minimal shell | Q1 | authenticated; role decides list contents, never whether the page renders |
| `/my-work` | `(work)` | Q1 | authenticated |
| `/capture` | `(work)` | Q1 | authenticated |
| `/metrics` | `(admin)` | Q1 | `requireRolePage(OWNER_ADMIN)` + RESTRICTIVE policy calling `public.user_is_org_admin()` |
| `/projects/[id]/settings/modules` | `(admin)` | Q1 | view `ALL`, edit `ORG_WRITE_ROLES` |
| `POST /api/cron/dispatch` ‡ | `api` | Q1 | constant-time `x-cron-secret`; service-only |
| `POST /api/cron/daily-recap` ‡ | `api` | Q1 | constant-time `x-cron-secret`; service-only |
| `/projects/[id]/instructions` | `(admin)` | Q2 | `ORG_WRITE_ROLES` |
| `/i/[token]` (instruction acknowledgement) ‡ | ungrouped, unauthenticated | Q2 | single-use HMAC, explicit confirm click; a bare GET acknowledges nothing |
| `/portal/[projectId]` consolidated to timeline · reports · approvals | `(portal)` | Q3 | `requirePortalAccess` re-cut onto `user_effective_project_role(project_id)` |
| `/r/[token]` (guest-link report) ‡ | ungrouped, unauthenticated | Q3 | `guest_links` `scope='report'`; issued-only; rate-limited |
| `POST /api/capture/transcribe` ‡ | `api` | Q3 | `requireRoleAPI`; same-origin audio, discarded on return |
| `/projects/[id]/calendar`, `/calendar` | `(admin)` | Q4 | base-table RLS through `dated_items` |
| `/portal/[projectId]/delivery` | `(portal)` | Q4 | `requirePortalAccess` → service client → allow-listed columns |
| `GET /api/calendar/ics` ‡ | `api` | Q4 | SHA-256 token hash on `profiles.ics_token_hash`; re-authorised through `user_effective_project_role` **on every request**, never from a snapshot |
| `/site/board/[nodeId]` | `(scan)` | Q4 | page-level auth with the existing `?next=` round-trip; sibling of `(scan)/site/tag/[text]` (verified the only existing scan route) |

**Deleted or repointed:** `/dashboard` is retained permanently as a server redirect to `/inbox` — the path appears 49 times outside tests, including `(auth)/auth/callback/route.ts:24`, the default `next` for every invite and recovery link and the exact surface of the PR #138 incident; the *landing page* changes, the *path* does not. `/projects/[id]/materials` and `/projects/[id]/equipment-schedule` are deleted. `/team` is never created — §04's deletion stands, and no `team` or `metrics` directory exists under `apps/web/src/app` today (verified).

**Edge functions** (they do **not** auto-deploy on merge; `deploy-edge-functions.yml` is `workflow_dispatch:` only and names four functions, one of which — `generate-report` — has no directory, so a dispatch run fails at that step today [R39]): `inbound-email` (Q2, `--no-verify-jwt`, the Cloudflare Worker's signature is the authenticator), `send-web-push` (Q2, **with** JWT verification), `chase-sweep` (Q3), `report-scheduler` (Q3). The 07:00 recap and the dispatcher are **Next route handlers, not edge functions** [R13], because no edge function in this repo has ever imported `@esite/shared` and `renderBrandedEmail` is the reason.

`/observe/[token]` and `PUBLIC_PATHS` are **not** amended: the public observation board is cut past twelve months.

---

### A(h) — the working-day calendar, defined once [R24]

**One statutory source, materialised once, read by everything.**

| Object | Definition |
|---|---|
| `projects.public_holidays(d date PRIMARY KEY, name text)` | Seeded **from the existing computus function** `listHolidays(year)` (`packages/shared/src/lib/jbcc/sa-public-holidays.ts:43`, verified: fixed dates, Good Friday and Family Day by computus, and the Sunday-observed-Monday rule). A contract test asserts the table equals `listHolidays()` for every seeded year, so it is a materialisation of the single source, not a second one. §13's `public.sa_public_holidays` is deleted. |
| `projects.calendar_years(year int PRIMARY KEY, seeded_at timestamptz)` | An unseeded year is detectable. `working_days_between` raises `no_data_found` on an unseeded year — **there is no fallback to calendar days**, because a silent one-day drift changes whether an item escalates. Refreshed each October for the following year; one of the two recurring operational tasks in the programme. |
| `projects.working_days_between(p_from timestamptz, p_to timestamptz, p_project uuid, p_calendar text)` | `STABLE`, never `IMMUTABLE` — it reads a table, and marking it immutable would let the planner fold a result across a calendar refresh. Both bounds evaluated `AT TIME ZONE 'Africa/Johannesburg'`. |
| `packages/shared/src/lib/calendar/working-days.ts` | The TypeScript mirror, taking a `ProjectCalendar` argument. A contract test asserts the SQL and TS paths agree over a fixture year. |

All three database objects are created in **Q1 migration 1**, the metrics migration (A(f)'s Q1 ledger), because the spine's `BEFORE INSERT` trigger raises without them.

**Two calendars, resolved from one existing row. No new column.** `projects.project_settings.working_days int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]` already exists (`00101_project_settings.sql:20`, verified) alongside `extra_holidays date[]`, `builders_holiday boolean` and `holiday_calendar text`, and today drives no computation — that is the real gap, not the absence of a calendar. §15's proposed `works_saturdays boolean` is **deleted**: it would be a second source of truth for a fact `working_days` already carries.

- **`office`** = `working_days` as stored (Mon–Fri by default), minus `public_holidays` and `extra_holidays`.
- **`site`** = `office` plus Saturday where Saturday is absent from `working_days`. SA sites work Saturdays, which is also why the recap fires `0 5 * * 1-6`; a due-date calendar that disagreed with the notification calendar would be a bug waiting to be filed.
- Which calendar a type uses is the `calendar` column in A(b), not a per-call decision.
- A due date landing inside the December builders' shutdown is pushed to the first site working day of the new year; the shutdown window is a per-project setting.

**The statutory / operational split is absolute** [§08 governs]. The JBCC time-bar engine keeps a **fixed statutory South African calendar** — Mon–Fri minus SA public holidays — and **never reads `project_settings`**, because JBCC defines "working day" in the contract, not in a project preference, and `deadline_date` is stored. A test asserts a JBCC deadline is byte-identical after `working_days` is edited. **§03 §1.5's instruction that "JBCC is switched onto the extended helper in the same PR" is deleted** — it is exactly what that test forbids. `lib/jbcc/working-days.ts` becomes a shim passing the statutory calendar explicitly. `crossesBuildersHoliday` becomes a caveat badge on any deadline whose window crosses 15 Dec – 15 Jan.

**Rules that read this calendar:**

| Reader | Calendar |
|---|---|
| Work-item due dates (the `BEFORE INSERT` trigger and every create form) | per-type, A(b) |
| §15 metric 4, median working days to respond on RFIs | office |
| §13's backfill due-date floor (`go_live + 5 working days`) | office |
| §10.2's chase ladder — nothing on Saturday, Sunday or an SA public holiday | site |
| §06's instruction `respond_by` = `issued_at::date + response_days` | office |
| §08's `install_days` in the required-by derivation (`lead_time_days` is **calendar** days — a supplier does not observe your working week) | site |
| §08's three-week lookahead window | site |
| JBCC `computeDeadline` | **statutory only — never project settings** |

---

### A(i) — external vendors, cost and POPIA status [R8]

§13's line "**No new vendor is onboarded in either quarter**" is false and is replaced by a reference to this table. Every foreign processor of personal information is an **operator** under POPIA §21 and requires a written operator agreement; because processing happens outside the Republic, §72 additionally requires the recipient be bound to protection substantially similar to POPIA's conditions. WM signs a client-facing data annexe naming every processor **per client**, because the landlord is the responsible party one level up.

| Vendor | Purpose | First needed | Monthly cost | Personal information | POPIA status |
|---|---|---|---|---|---|
| **Supabase** | Platform: Postgres, auth, storage, edge functions | live | existing | all of it | Existing processor; annexe entry required |
| **Vercel** | Web hosting | live | existing | in transit | Existing processor; annexe entry required |
| **Resend** | Outbound transactional mail, the 07:00 recap, report links | live | < R400 | recipient names and addresses | Existing processor; confirm the DPA in Q1 item 0 |
| **Paystack** | Billing | live | per transaction | billing contact | Existing processor |
| **Cloudflare Email Routing** | Inbound MX → Worker → `inbound-email` [R6] | Q2 | **R0** | transit only; nothing stored at rest | Transit-only; confirm in Q1 week 1 |
| **Open-Meteo Commercial** | Weather actuals for the diary check-in | **Q2** (moved with item 11) | **€29 ≈ R580** | **none** — coordinates only, never a person | No operator agreement required; the "no personal information" position is recorded in writing |
| **Anthropic** | Chase sentence, voice field mapping, weekly and monthly narrative | **Q3** | **~R11 per active project (committed set); ~R55 across the five live projects** | diary prose, entity titles, named contractor staff | **§21 operator agreement + §72 equivalent-protection undertaking required before the first call.** Zero data retention and no training use written into the annexe, not only the API configuration |
| **Speech-to-text — vendor not yet named** | Voice-to-form transcription | **Q3** | ~R0.11/min, < R50 | site speech, which names people | **Same terms as Anthropic.** Two hard selection criteria: a zero-retention tier, and an **SA or EU processing region**. Named by 30 November 2026 — §15 open question 9 |
| **Sentry / PostHog** | Error tracking and exploration only | live | existing | user ids | Existing; **no headline metric may depend on either** |

**Committed AI cost** (chase R3 + weekly narrative R4 + monthly narrative R2 + voice R2 = **~R11 per active project per month**; ~R55 across the five live projects, ~R155 across fourteen — the same figure the A(i) row above and §10.11 and §15 §(g) carry). **Not committed:** cited answers (~R15) and photo tags (~R6) — both cut past twelve months, so §10.11's R32/project and R450/portfolio headlines are restated on the committed set [R42, R43].

**Owner and date, which no section previously carried:** the operator agreements and the client data annexe are **Arno's, signed before 1 April 2027** — before the first client data reaches a foreign operator, which is now voice extraction in Q3. They are legal and commercial work, priced in §15(g)'s cost table as a legal-review fee, and deliberately **not** charged to the engineer-week ledger.
