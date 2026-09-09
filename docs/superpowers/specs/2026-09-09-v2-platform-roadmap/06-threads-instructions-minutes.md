## Primitive 4 — threads, mentions, contract instructions and minutes

### What conversation exists today

E-Site has four unrelated comment-shaped things and no conversation layer.

| Surface | Where | Shape | What it cannot do |
|---|---|---|---|
| QC comments | `apps/edge-functions/supabase/migrations/00172_qc_reports.sql:161` | `report_id` + `entry_id` + nullable `photo_id`, `body`, `created_by` | No mentions, no attachments, no threading, no read state; frozen with the report |
| RFI responses | `00002_projects_schema.sql:107` | `rfi_id`, `body`, `responded_by` — five columns | Not a thread (no reply-to), no mentions, no edit trail; attachments live elsewhere |
| Form response history | `00179_site_forms.sql:170` | Append-only audit of answer *values* | An audit trail, not a discussion |
| Attachments | `00008_attachments_notifications.sql:9` | Polymorphic `entity_type` / `entity_id`, eight documented values (`:12-14`) | RLS is **organisation-scoped only** (`00009_rls_policies.sql:126-128` SELECT, `:130-132` INSERT) — it cannot express the visibility of the entity it hangs off |

Nothing anywhere in the monorepo implements an `@mention`. The notification bell (`apps/web/src/components/ui/NotificationCentre.tsx:39-46`) is an unfiltered `select('*')` over `public.notifications` with an unscoped Mark-all-read (`:49-57`) — a firehose with an escape hatch, not an inbox, which is why 964 notifications produced 57 reads. Contract correspondence exists once, inside the JBCC module (`00099_jbcc_module.sql:103`, hardened by `00170_jbcc_iso9001_hardening.sql`), which the approved frame turns **off by default** (Appendix A(e), token `jbcc`).

### 4.1 The thread model

**Decision: one polymorphic thread, in the `projects` schema.** A new schema would force a PostgREST `db_schema` PATCH; `projects` is already exposed (`config.toml:9`), so a `NOTIFY pgrst, 'reload schema'` suffices. Schema placement and the quarter each table lands in are Appendix A(f)'s; the column sets below are this section's and are not restated there.

```sql
projects.threads          (id, project_id, organisation_id, subject_type, subject_id,
                           work_item_id, title, is_locked, created_by, created_at,
                           UNIQUE (subject_type, subject_id))
projects.thread_messages  (id, thread_id, project_id, body, author_id,
                           origin CHECK ('web','pwa','email','system'),
                           inbound_message_id UNIQUE, reply_to_id,
                           rfi_response_id, is_formal_response bool NOT NULL DEFAULT false,
                           edited_at, redacted_at, redacted_by, created_at)
projects.message_mentions (id, message_id, mentioned_user_id, mentioned_role)
projects.thread_participants (thread_id, user_id, reason, subscribed, muted_at, last_read_at)
```

These column names are authoritative and supersede the abbreviated forms carried in the data-model annex (`via`, `projects.mentions`). Four `origin` values are required, not three: a `system` message is how a status change, an issued instruction and an adopted drawing revision appear inline in the conversation without being attributable to a person. `mentioned_role` is required because `@contractor` must be storable as what was typed *and* as the people it resolved to. `inbound_message_id` is `UNIQUE` so a redelivered inbound email is idempotent rather than duplicated. `work_item_id` is nullable and points at the Primitive-1 mirror of the same subject where one exists, so the Inbox can join thread activity to an item without re-resolving the polymorphic key.

`subject_type` is drawn from a registry table `projects.thread_subject_types(key PK, label, module, icon)`. **The registry drives the UI; it is not the authority.** Visibility is enforced by one SECURITY DEFINER resolver, `projects.user_can_read_subject(subject_type text, subject_id uuid) RETURNS boolean`, a static `CASE` over the eight subject types (rfi, snag, diary entry, qc entry, inspection, site form, board, instruction) — one file to audit, no dynamic dispatch. Two rules make it fail closed:

- The `CASE` ends `ELSE false`, so an unregistered `subject_type` is unreadable, never NULL. This is the shape `projects.jbcc_status_can_transition` already uses (`00170:167`).
- The function returns `COALESCE(<result>, false)`, so a NULL from any inner lookup collapses to false — the hazard that made `user_effective_project_role(...) IN (...)` return NULL rather than FALSE, and which `00181_client_viewer_project_aware_rls.sql:83-98` closed with the same construct.

A contract test enumerates `thread_subject_types` and the `CASE` arms and fails the build if a registry row has no arm, mirroring the report-kind registry test. The resolver never references `current_user`, which under `SECURITY DEFINER` resolves to the owner and is exactly how the site-forms transition trigger shipped inert. `REVOKE ALL … FROM PUBLIC` **and** an explicit revoke from `anon`, verified with `has_function_privilege('anon', oid, 'EXECUTE')`.

**RLS.** `SELECT` on threads and messages requires `projects.user_can_read_subject(...)`, so a client viewer inherits the draft/issued rules each module already enforces (a QC draft stays invisible, per `00172`).

**Decision: a client viewer may post a message on any thread they can read.** The earlier position — commenting requires promotion to a project role — is rejected. The write set is not enumerated here: it is **§11.1's Watcher tier row** (`client_viewer` — read, comment and approve on the surfaces §11.5 lists, nothing else), and this section adds nothing to it. The reason the tier reads that way is worth keeping, because it is the argument that settled it: `projects.project_members.role` admits only `project_manager | contractor | inspector | supplier | client_viewer` (`00002_projects_schema.sql:45-46`), so "promote the landlord" means calling a shopping-centre owner a contractor and handing them write access across every module in order to let them type a sentence. Client viewers are the deadest cohort in production (4 accounts, last sign-in 8 July 2026); a read-only conversation layer gives a landlord no reason to return, which is the problem the programme exists to solve. `INSERT` on `thread_messages` therefore requires `public.user_effective_project_role(project_id)` (`00107_user_effective_project_role.sql:30`) to be non-null, and nothing more.

**The acknowledgement question, reconciled explicitly.** A client viewer **may acknowledge an instruction addressed to them** — the confirm click writes their own `projects.instruction_recipients` row and nothing else. A client viewer may **never** acknowledge on another party's behalf, and may not author an instruction, a minute or a transmittal. Those are separate tables with their own RESTRICTIVE write gates (§4.4–§4.7); acknowledgement is scoped by row, not by role, and the token in §4.5 is minted per `instruction_recipients` row precisely so that the row *is* the gate. Posting a comment is not issuing a document, and receipting a document addressed to you is not issuing one either; conflating the three is what silenced the audience.

Where a project genuinely wants the client quiet, that is a setting, not a schema ban: `projects.project_settings.client_comments_enabled boolean NOT NULL DEFAULT true` (Appendix A(f), Q1 column adds), read by the INSERT policy. A RESTRICTIVE policy enforces both the role predicate and the setting at the DB, because the server actions are directly invocable outside the `(admin)` layout.

**Mentions.** `@` opens the project roster resolved from `project_notification_recipients()` — the same live resolver every module already uses (`apps/web/src/lib/recipients.ts:20`) — plus three role tokens (`@contractor`, `@pm`, `@client`) that are **expanded to concrete user rows at write time**, so the audience is frozen at the moment of writing and a later membership change cannot retroactively alter who was addressed. Mention rows are the only thing in this primitive that creates a personal notification.

**Attachments.** Reuse `public.attachments` with `entity_type='thread_message'`. The existing SELECT policy (`00009_rls_policies.sql:126-128`) is replaced by a **branch, not a substitution**:

```sql
USING (
  CASE WHEN entity_type = 'thread_message'
       THEN projects.user_can_read_subject_via_message(entity_id)
       ELSE organisation_id = ANY(public.get_user_org_ids())
  END)
```

Migrating the other seven documented `entity_type` values off org-scope is explicitly **out of scope for this primitive**. Replacing the policy wholesale would resolve `rfi`, `procurement_item`, `coc_upload`, `handover`, `site_diary_entry`, `snag` and `rfi_response` attachments through a resolver that does not know those types, turning them invisible in one migration with nothing that would obviously catch it. Verification after applying: read back one attachment row of **each** existing `entity_type` as the `rbac-test` contractor, from the empty state of the owning page rather than a deep link. Storage paths are constructed server-side from `{org}/{project}/{message_id}/`, never accepted from the client — the cross-org exfiltration defect found in site forms.

**Inbound email.** An accepted inbound reply posts a `thread_message` with `origin='email'` and `inbound_message_id` set, pointing at `field.inbound_messages` — whose column set, verdict column and value set are **Appendix A(a2)'s**, not this section's and not §05's. The address scheme, DKIM and envelope-sender verification, rate limiting and bounce behaviour are the notification and digest engine's contract, and no budget for them is carried here.

**This section's earlier "a message failing verification is bounced and never posted" was too broad, and A(a2) amends it.** The withdrawn sentence is recorded rather than quietly replaced, because it was the sentence §05's own behaviour rule contradicted. The rule is now stated by failure class:

- A **DKIM failure** (`result = 'bounced_dkim'`) or an **access failure** — token revoked or expired, item closed, or the resolved user no longer passing `user_has_project_access` (`result = 'bounced_access'`) — is bounced and never posted. An unauthenticated relayed message, or one from someone whose access has ended, would poison the evidential value of everything around it.
- An **identity mismatch alone** — DKIM valid and aligned, but the envelope sender is not the token holder's `public.profiles.email` — **is posted**, with `result = 'unverified'`, and the message renders on the thread visibly marked as an unverified sender until a PM binds it with the one-click "this is me" in the Unverified-inbound tray, whose predicate is that same `result = 'unverified'`. Bouncing that class would silence foremen replying from phone aliases, forwarded mailboxes and shared site addresses — exactly the thirteen contractor accounts this programme exists to reach — while posting it *unmarked* would let an unproven sender read as a verified one in a dispute. The mark is on the message, not only in the tray, for that reason.
- `quarantined`, `rate_limited` while still queued, and `rejected_auto` create **no `thread_message` row at all**, so a thread never carries prose that cannot be attributed to a resolved sender.

**Reactions: no.** A thumbs-up on "can we energise DB-3?" is unreadable in a dispute — it means yes, seen, or noted, depending on who you ask. Threads get one typed affordance instead: **Acknowledge**, which writes an actor and a timestamp and renders as "Acknowledged by A Mattheus, 14:07, 9 Sep 2026". Same mechanism as instruction receipt (§4.5), so there is one concept of "I have seen this", and it is evidential.

**Editing.** A message is editable by its author for 15 minutes, after which `edited_at` freezes and further changes are refused. Deletion is redaction: the row survives, the body is replaced, `redacted_by`/`redacted_at` are stamped, and the PDF prints "[message withdrawn]". A conversation that can be quietly rewritten is worth nothing as evidence, which is the whole reason WhatsApp fails WM.

### 4.2 What happens to the four existing comment surfaces

Live data, so nothing is left to an implementer's guess.

| Today | Disposition | Quarter | Why |
|---|---|---|---|
| `projects.qc_comments` (`00172:161`) | Back-filled into `threads`/`thread_messages` with `subject_type='qc_entry'`; new comments write **only** to `thread_messages`. The table is retained read-only until `qc-report-data.ts:210,221` and `qc.service.ts:290` are repointed, then dropped (Appendix A(f), Q4 drops). | **Q4** | 11 QC rows created in the last 30 days — a dual-write window is cheaper than a same-day renderer rewrite, but a permanent fork is not. It was planned for Q3 rather than Q2 so the renderer would be repointed once, in the same quarter as §07's Q3.2 registry port; **§14 moved it to Q4** to absorb the register surface, and moved it rather than cutting it so the year's committed total — §15's cost-per-engineer-week divisor — does not change. The cost is stated rather than hidden: `qc-report-data.ts` is now opened twice, in Q3 for the port and in Q4 for the repoint, which is exactly the saving the Q3 placement had bought. Nothing depends on the line, so the QC comments simply stay where they are until it lands. |
| `projects.rfi_responses` (`00002:107`) | **Retained as the system of record.** Primitive 1 flips ball-in-court to `answered` on a row landing here; repointing that trigger at a free-text table would make any comment answer an RFI. A formal response writes both rows in one action: the `rfi_responses` row, and a `thread_message` with `is_formal_response = true` and `rfi_response_id` set. | Dual-write **Q2** (the columns ship with `thread_messages`); the back-fill of the 5 existing production responses is the **Q4** line, travelling with the QC back-fill | Preserves `responded_by` semantics and Primitive 1's trigger while putting the conversation where people will read it. |
| `field.form_response_history` (`00179:170`) | **Untouched.** | — | It is an audit of answer values against a signed record, not a discussion, and must not acquire mutable prose. |
| `public.attachments` | Branch-scoped as in §4.1; other entity types unchanged. | Q2 | See above. |

### 4.3 Inbox versus project feed

Two surfaces, one rule: **the Inbox contains only what is aimed at you and must be able to reach zero; the feed is everything that happened and is never unread-counted.**

| Event | Personal Inbox | Project feed |
|---|---|---|
| You are @mentioned | Yes | Yes |
| Message on a thread you are subscribed to | Yes | Yes |
| Message on a thread you are not subscribed to | No | Yes |
| Instruction addressed to you (To:) | Yes | Yes |
| Instruction you are CC'd on | No | Yes |
| Transmittal you received | Yes | Yes |
| Meeting minutes circulated (§4.6 — **cut past twelve months**; the row records the design, nothing ships) | No (the action items would) | Yes |
| Diary entry created | **No** | Yes |
| Report generated, sync run, revision imported | No | Yes |

The diary row is the load-bearing change: 750 of 964 production notifications are `diary_created` fan-outs to the whole roster, and almost none were read. Diary creation becomes feed-only plus the 07:00 recap. Subscription is automatic on author, assignee, mention, and first reply — never on project membership. Client viewers appear in this table exactly as any other participant: an instruction addressed to a landlord reaches their Inbox, and they can reply to it on the thread.

**The feed row goes to `projects.activity`.** It is a project-scoped table written by trigger, and it is specified here in full because §05 defers its definition to this section (it names the same object `activity_events`; the canonical name is `projects.activity`, per Appendix A(f)).

```sql
CREATE TABLE projects.activity (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id),
  actor_id        uuid REFERENCES public.profiles(id),   -- NULL for system-generated events
  verb            text NOT NULL,
  subject_type    text NOT NULL,
  subject_id      uuid,
  thread_id       uuid,                                  -- FK to projects.threads added in Q2
  work_item_id    uuid REFERENCES projects.work_items(id) ON DELETE CASCADE,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX activity_project_created_idx
  ON projects.activity (project_id, created_at DESC);

ALTER TABLE projects.activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_select ON projects.activity
  FOR SELECT TO authenticated
  USING (public.user_has_project_access(project_id));

REVOKE SELECT ON projects.activity FROM anon;
```

The `anon` revoke is **mandatory, not defensive**: `00025_grant_schema_permissions.sql:26` runs `ALTER DEFAULT PRIVILEGES … GRANT SELECT ON TABLES TO anon` over the `projects` schema (verified), so every new table there is born anon-readable at the grant layer whatever its policies say. Verify afterwards with `has_table_privilege('anon', 'projects.activity', 'SELECT')` — never by reading `relacl`, where a NULL is not an empty ACL.

`thread_id` ships as a bare nullable `uuid` in Q1 and gains its `REFERENCES projects.threads(id) ON DELETE CASCADE` in the Q2 threads migration, because `projects.threads` does not exist until Q2. The SELECT policy is **permissive**: the feed is deliberately project-wide, and narrowing it per subject would make the "everything that happened" surface disagree with itself row by row.

**`projects.activity` exists from Q1, not Q2.** Q1 needs it for two things that ship before threads do: the Recap tier — Appendix A(c) defines Recap as *writes `projects.activity`, never `public.notifications`* — and the diary reclassification, which is the single change that removes 750 of 964 notifications. In Q2 it gains the thread and work-item triggers, and its `thread_id` FK.

**Retention: 24 months of detail, then a monthly rollup.** A nightly sweep replaces detail rows older than 24 months, in one transaction, with one `projects.activity` row per `(project_id, month, verb)` carrying `actor_id = NULL`, `subject_id = NULL` and the counts in `payload`, so the feed keeps a truthful "142 diary entries, March 2027" line indefinitely without unbounded growth. The rollup deliberately lands **in the same table** rather than a second one: Appendix A(f) carries no `activity_monthly`, and **§12 §(h) test 8 — the new-object inventory test** — parses every `-- table:`, `-- view:` and `-- function:` line out of the programme's `-- @verify:` blocks, groups them by quarter and diffs against A(f) in both directions, so inventing a table here fails the build naming the migration that created it. That test did not exist when this line was first written and does now; the claim is enforceable rather than rhetorical, and `activity_monthly` is test 8's worked example.

The second row is written **only when the event is aimed at someone**: a `public.notifications` row carrying `thread_id`, `message_id` and a `reason` (`mention | subscriber | recipient | acknowledgement_due`). The new types this primitive emits — `mention`, `thread_reply`, `instruction_issued`, `instruction_ack_due`, `transmittal_received` — **are rows inserted into `public.notification_types` with their tier; Q1 retired the CHECK**, so there is no `notifications_type_check` to re-declare and the `00178_snag_visit_completion.sql:54-58` warning no longer applies to this primitive. Their tier, audience and always-fires flags are Appendix A(c)'s and are not restated here. (§06's draft key `thread_mention` is A(c)'s `mention` — one key, not two.) Delivery timing, batching and presence suppression are the notification and digest engine's contract, not this primitive's.

### 4.4 Contract instructions as typed correspondence

JBCC Advisory Note 17 (Ed 6.2, cl. 17.5) is unambiguous: a contract instruction must be in writing, "properly identified and dated with the receipt thereof signed by the contractor", and an entry in the site instruction book or in site meeting minutes is **not good practice**. That single sentence sets the design: an instruction is a numbered, dated, receipted, immutable document, and no conversational artefact may acquire those properties by accident.

**Decision: `projects.instructions` is its own table, not an extension of `jbcc_letters`.** JBCC is a per-project toggle that is off by default (Appendix A(e)); a site instruction on a tenant fit-out with no JBCC contract must still be issuable. The JBCC module keeps its notice-procedure catalogue and time-bar engine and, where enabled, issues *through* this register so numbering is single-sourced. The JBCC time-bar engine keeps its own fixed statutory calendar and never reads `project_settings` — Appendix A(h) governs, and nothing in this section changes it.

```sql
projects.instructions (id, project_id, organisation_id,
  doc_type CHECK ('contract_instruction','site_instruction','early_warning',
                  'non_conformance','technical_query'),
  reference text NOT NULL,          -- allocated at insert, immutable, never reused
  revision int NOT NULL DEFAULT 1, supersedes_id, superseded_by_id,
  subject, body, cost_effect, time_effect,
  response_days int NOT NULL DEFAULT 7 CHECK (response_days > 0),
  respond_by date,                  -- stamped at issue, office calendar (Appendix A(h))
  status CHECK ('draft','issued','acknowledged','superseded','withdrawn'),
  issued_by, issued_at, report_id,  -- projects.reports, kind='instruction'
  source_message_id, created_by, created_at)
projects.instruction_recipients (id, instruction_id, user_id, contact_id,
  name_snapshot, email_snapshot, disposition CHECK ('to','cc'),
  sent_at, opened_at, acknowledged_at, acknowledged_by,
  ack_method CHECK ('in_app','email_link','signature'), ack_ip inet)
```

`respond_by = issued_at::date + response_days` counted in **office** working days, resolved through `projects.working_days_between` on Appendix A(h)'s single materialised calendar. There is no calendar-day fallback: A(h)'s function raises on an unseeded year rather than drifting silently, and a one-day drift on an instruction is the difference between a contractor being in time and being out of it.

Default response periods by type, applied at creation and editable while draft:

| `doc_type` | `response_days` | Rationale |
|---|---|---|
| `early_warning` | 2 | Its value is entirely in speed; a late early warning is not one. |
| `site_instruction` | 3 | Issued to people already on site. |
| `non_conformance` | 5 | Needs an inspection or a method statement before a reply is meaningful. |
| `technical_query` | 5 | Matches the design-office turnaround WM already works to. |
| `contract_instruction` | 7 | Matches `project_settings.default_rfi_due_days` (`00101_project_settings.sql:30`), so one project has one clock. |

Numbering reuses the proven allocator shape — `projects.jbcc_allocate_letter_reference` (`00170:94`) and `field.allocate_form_no` (`00179:124`): a `SECURITY DEFINER` function over a per-(project, type, year) sequence table with `ON CONFLICT … DO UPDATE … RETURNING`, revoked from PUBLIC **and** explicitly from `anon`, granted to `service_role` only, verified with `has_function_privilege`. The reference is `CI-<project code>-2026-0007`, allocated at insert so a draft already owns its number.

**A row in `projects.instructions` is never deleted.** An abandoned draft is withdrawn (`status='withdrawn'`), and a `BEFORE DELETE` trigger modelled on `projects.jbcc_letters_guard_delete` (`00170:210-224`) refuses deletion of any row, including via project cascade. Withdrawn numbers stay in the register and print as `CI-KGW-2026-0007 — withdrawn`. This is the correct reading of "no gaps": the series is *auditable* — every number ever allocated is accounted for on the register — rather than gap-free in the arithmetic sense, which allocation-at-insert cannot deliver and which no adjudicator asks for.

Once `status='issued'`, a `BEFORE UPDATE` trigger freezes `subject`, `body`, `doc_type`, `reference`, `respond_by`, the recipient set and the attached drawing revisions — the `jbcc_letters_guard_update` pattern (`00170:172`). Corrections are a new revision with `supersedes_id` set; both remain in the register. Every transition appends to an append-only `instruction_events` table (`00170:230` pattern).

**Instructions carry ball-in-court through the spine, not on their own.** Issue creates **one Primitive-1 work item per `to` recipient** of registered type `instruction` — Appendix A(b) governs the type row: source `projects.instruction_recipients`, due `respond_by`, office calendar, assignee the recipient, gatekeeper the issuer. Acknowledgement closes it. Ball-in-court is therefore the work item's generated column and is never null while the item is open — an instruction with no work item would repeat exactly the failure this section diagnoses, the 15 production RFIs with `assigned_to` NULL on every one of them.

Following Primitive 1's typed-FK design rather than a polymorphic key, the link lives on the spine. **Q2 adds exactly one column to `projects.work_items`: `instruction_recipient_id uuid REFERENCES projects.instruction_recipients(id) ON DELETE SET NULL`, with `work_items_one_source` and `work_items_source_required` both re-declared wholesale** — the authoritative DDL is Appendix A(a) and is not restated here. `ON DELETE SET NULL` is A(a)'s, not this section's earlier `CASCADE`: an instruction recipient row cannot be deleted anyway (the never-delete guard above), and a spine row that vanishes silently is worse than one that survives as an orphan the `work_items_source_required` check can see. `work_items.meeting_item_id` is **not** added — meeting minutes is cut past twelve months (§4.6), and A(b) records `meeting_action` as explicitly not registered for the same reason. `instructions` does not carry a `work_item_id` of its own; one direction only, so the two cannot disagree.

Escalation is defined on the same object: **no `acknowledged_at` on any `to` recipient by `respond_by`** produces an Inbox item for the issuer with `reason='instruction_ack_due'`, once, and the work item is already overdue in the recipient's My Work.

Issue produces a branded PDF through the report engine, saved into `projects.reports` with `kind='instruction'`, and emails it to the To: and CC: lists. Every payload string goes through `winAnsiSafe` (`apps/web/src/lib/cable-schedule/winansi.ts:49`, whose canonical home is `lib/pdf/`) — an instruction is precisely the document where `≤ 0,2 Ω` silently printing as `d 0,2 ©` would read as a typo and survive proofreading.

**The minute-book firewall.** A thread message can never *become* an instruction. Converting is an explicit action that creates a new `instructions` row, allocates a new reference, and stores `source_message_id`; the source message is annotated read-only with "Issued as CI-KGW-2026-0007" and keeps no number of its own. Thread PDFs carry a footer stating they are a record of discussion and do not constitute a contract instruction — the same discipline as the non-CoC disclaimer that site forms render `fixed` on every page (`apps/web/src/lib/reports/site-form-report.tsx:441-442`) and assert per page in tests (`site-form-report.test.tsx:172`). The firewall is stated in the same terms for minutes in §4.6 and applies the moment minutes are ever built.

The `/projects/[id]/instructions` route and the unauthenticated `/i/[token]` acknowledgement route are Appendix A(g)'s rows, with their gates; `docs/rbac-matrix.md` moves in the same PR as both, and `CONFORMANCE.md` in the same PR as `/i/[token]`.

### 4.5 Receipt: the acknowledgement token

Acknowledgement is the legal receipt AN17 cl. 17.5 requires, and it is an auth surface reachable without a session — outside every page gate, the class of hole that put report routes under `app/api/*` beyond RLS. It is specified in full.

| Property | Rule |
|---|---|
| Scope | One token per `instruction_recipients` row. Never per instruction, never per user. This is also what makes §4.1's client-viewer acknowledgement safe: the token *is* the row, so a landlord can only ever sign for themselves. |
| Storage | Only the HMAC hash is stored, never the token — the pattern adopted for inbound reply addresses. |
| Lifetime | Single use. Expires at `respond_by + 30 days`, or immediately when the instruction is superseded or withdrawn. |
| Interaction | The landing page shows the instruction reference, subject, and **the recipient's own name**, and requires one explicit confirm click. A bare GET acknowledges nothing, so a link-scanner in a mail gateway cannot sign for a contractor. |
| Recorded | `acknowledged_at`, `acknowledged_by`, `ack_method='email_link'`, `ack_ip`. |
| Evidential weight | `signature` > `in_app` > `email_link`. A forwarded email means the click may not be the addressee, and the register must not pretend otherwise. |

This is a **distinct mechanism from the report guest link**: Appendix A(d)'s `public.guest_links` with `scope='report'` is the one account-less way to read a *report*, and `/i/[token]` is not that — it writes a receipt against one recipient row and grants no read of anything else. Two mechanisms exist because they do two different jobs; there is still exactly one way to hand a report to somebody without an account.

The PDF and the register both **print the method**, so a dispute can see which was used rather than inferring one. `CONFORMANCE.md` is updated in the same PR, because this adds an unauthenticated route.

### 4.6 Site meeting minutes — designed, not scheduled

> ⚠ **Cut past twelve months.** Meeting minutes ships in no quarter of this programme. The design below is retained because it is complete, because the numbering rule took real research to get right, and because the next planning round should start from it rather than redo it — but nothing here is budgeted, `work_items.meeting_item_id` is **not** added to the spine (§4.4), `meeting_action` is **not** registered as a work-item type (Appendix A(b)), and `meeting_minutes` is **not** a report kind (Appendix A(d)). Any implementer reading this section in the twelve-month window should stop at §4.7.

```sql
projects.meetings         (id, project_id, meeting_no, title, held_at, location,
                           chaired_by, status CHECK ('draft','circulated','confirmed'),
                           confirmed_at, confirmed_at_meeting_id, report_id)
projects.meeting_attendees(meeting_id, user_id, contact_id, name_snapshot,
                           company_snapshot,
                           attendance CHECK ('present','apology','absent','distribution'))
projects.meeting_items    (id, meeting_id, heading_no int, item_no text, heading, body,
                           carried_from_item_id, status CHECK ('open','closed'), closed_at)
```

Attendance is snapshotted by name and company because half of a site meeting is people with no E-Site account, drawn from `projects.contacts` (`00002_projects_schema.sql:167`).

Item numbers follow SA convention. A carried item keeps its number for life: `3.2` persists across every meeting until closed, so a new meeting is seeded by copying all open items from the previous one with `carried_from_item_id` set and their numbers preserved, printing "3.2 (carried from meeting 7)". Closed items drop out and never renumber. **A new item under heading 3 takes `<heading_no>.<next>`, where `next` is one greater than the highest number ever issued under that heading on this project — closed and withdrawn items included** — held in the same per-project sequence table as instruction references. Numbers are never reused, so with 3.2 and 3.5 carried and 3.3, 3.4 closed, the next new item is 3.6.

**Every action item would be a work item.** An item with an assignee and a due date would create a Primitive-1 work item on save; `assignee_id` the named person, `gatekeeper_id` the chair. That is the single mechanism by which a site meeting stops being a document nobody reads — and it is also the reason the deferral is cheap rather than free: until minutes exist, an action agreed in a meeting is captured by typing it as a `task` work item, which Q1 already ships.

Minutes go `draft → circulated → confirmed`. Confirmation is a status set at the next meeting, never an edit: a circulated minute is frozen the same way an instruction is, and corrections are recorded as an item in the following meeting. The distribution list is the attendee list including `attendance='distribution'`. The minute-book firewall of §4.4 applies unchanged: a minute item can never *become* an instruction, and a minutes PDF would carry the same "record of discussion" footer.

### 4.7 Drawing and document register, and transmittals

The register is a **read model over what Dropbox sync already produces**, not a second copy. Today: `tenants.floor_plans` carries `has_newer_version`, `latest_revision_id`, `latest_synced_at` (`00148_floor_plan_versions_cloud_sync.sql:29-32`); `tenants.floor_plan_versions` holds one immutable row per imported revision with `UNIQUE (floor_plan_id, source_revision_id)` (`00148:41,53`); `tenants.documents` carries the same provenance columns for non-drawings (`00041_cloud_storage_documents.sql:30`); `tenants.cloud_sync_runs` records every walk (`00148:99`). Dropbox stays the source of truth for bytes and folder structure. The register adds only what a folder cannot hold: a revision label and an issue record.

**The register surface is `/projects/[id]/documents`.** That route already exists (`(admin)/projects/[id]/documents/page.tsx` with its `DocumentList.tsx`, verified) and is absent from `projectNav`; Appendix A(e) adds it to the nav as an always-on, non-toggleable surface. It **becomes** the drawing-and-document register — the existing list is rebuilt in place, gaining versions, revision labels and the transmitted-versus-latest column — rather than a second register page persisting beside it. A product that ships two document pages has shipped none.

**The register *surface* is rebuilt in Q3, beside the transmittal issue flow it feeds; the *data* it presents is complete at the end of Q2.** That split is §13's re-plan and this section adopts it: keeping the surface in Q2 put it third on a strictly serial chain — threads 4.0 → instructions 3.5 → register 3.5 — an 11.0-week chain in a ten-week window for the single walker §13's no-hand-over rule requires, which no capacity total showed. The route is added to the nav in **Q1** (§13 item 8, Appendix A(e)), so it is discoverable two quarters before it becomes the register, and the Q2 list keeps working on the versioned rows in the meantime.

**Drawings are versioned; documents are not, and a transmittal cannot be built on that asymmetry.** The sync's document branch writes to a stable, id-keyed storage path and overwrites in place — `const storagePath = \`${proj.organisation_id}/${proj.id}/${item.id}${ext}\`` (`apps/edge-functions/supabase/functions/cloud-sync-project/index.ts:479`), `.upload(storagePath, blob, { upsert: true })` (`:482`), then an `UPDATE` of the same `tenants.documents` row (`:486-497`) — a design the migration header states outright: "Documents (no annotations) update in place" (`00148:11`). A `transmittal_item` pointing at a `document_id` would therefore point at whatever Dropbox last pushed: issue a specification in March and the transmittal PDF prints the June text, under a March date and a signed receipt. Only drawings are rev-keyed and immutable (`:526-532`, `00148:41-53`).

**Decision: version documents, do not snapshot-copy them — and do it in Q2, before anything transmittal-shaped is built.** `tenants.document_versions` mirrors `floor_plan_versions` exactly — `(id, organisation_id, project_id, document_id, source_revision_id, file_path, file_size_bytes, source_modified_at, synced_at, UNIQUE (document_id, source_revision_id))` — with a rev-keyed path `{org}/{project}/{file_id}/{rev}{ext}` in the `project-documents` bucket, and the sync's document branch changes from overwrite-in-place to insert-version-then-repoint the `documents` row. A snapshot copy owned by the transmittal was the alternative and is rejected: it duplicates bytes, breaks the provenance chain back to the Dropbox rev, and gives the register two answers to "what is the current spec". Versioning also fixes a defect the transmittal merely exposes — today a document's history is destroyed by every sync, so no one can see what changed. **It is a hard prerequisite, not a companion line:** the issue flow in Q3 has nothing stable to point at until it lands, so *this line* — and only this line — is scheduled a full quarter ahead of the transmittal work and may not slip past it. **The earlier form of that sentence covered the register surface too, and no longer does:** the surface moves to Q3 (above), and the "full quarter ahead" claim now attaches to `document_versions`, the sync rewrite and the revision-label columns, which are gated on the sync engine rather than on the instruction chain and are therefore walked off-path inside Q2. Q3 then inherits a populated version store rather than an empty one.

Also **Q2**, in the same migration pair as the versioning:

1. `revision_label` plus `revision_label_source CHECK ('filename','manual','none')` on both version tables (Appendix A(f), Q2 column adds — unchanged by the re-plan). Dropbox revs are opaque hashes; the label is parsed from the filename token (`… Rev C`, `… P3`) and otherwise left blank with the sync rev shown. **A revision label is never invented** — a wrong "Rev C" on a transmittal is worse than none.
2. `projects.drawings` and the `'drawing'` value in `public.attachments.entity_type` are dropped here (see below), also Q2 and also unchanged: A(f)'s Q2 object inventory needs no amendment from the re-plan, because what moved is a route rebuild, not an object.

**Q3 adds the register surface, the version delete guards and the issue flow, in that order within the quarter.** The guards are a `BEFORE DELETE` on `floor_plan_versions` and `document_versions` refusing deletion of any row referenced by a transmittal item: `floor_plan_versions` carries an org-member DELETE policy (`00148:87-92`), so "immutable" today means immutable against the sync, not against a direct PostgREST call. They travelled to Q3 with the surface they belong to, and the ordering rule that protected them in Q2 survives intact — **the guards must land at a lower Q3 migration ordinal than `transmittal_items`**, because a guard added after the references exist is a guard that was absent exactly when it mattered. The issue flow itself is `projects.transmittals` / `transmittal_items` / `transmittal_recipients` (Appendix A(f), Q3), sharing the numbering allocator, the freeze-on-issue trigger, the never-delete guard and the acknowledgement columns and token of §4.4–§4.5, plus the issue UI. `transmittal_items` references a `floor_plan_version_id` or `document_version_id` **`ON DELETE RESTRICT`** against those guards.

`projects.drawings` (`00002_projects_schema.sql:56-70`) holds zero rows in production and duplicates title, revision, file path and a `draft|current|superseded|archived` status. It is **dropped in Q2, in the same migration pair as the document versioning** (Appendix A(f), Q2 drops — the drop stays in Q2 even though the register surface moves to Q3, because the dead table is what a rebuilt register would otherwise have to be reconciled against), and the `'drawing'` value in `public.attachments.entity_type` (`00008:12-14`) is retired with it. `tenants.floor_plans` plus `floor_plan_versions` is the sole drawing identity; two candidate registers is how a register dies.

"Transmitted versus latest" is then a computed read model, shipping in **Q3** with the register surface: per recipient and drawing, the newest transmitted version against `floor_plans.latest_revision_id`, yielding `current | superseded | never issued`. It is a query in the register, **not a new database object** — which is why A(f) carries no view for it and §12 §(h) test 8 has nothing to match. That column, on the documents register and on every party's project home, is the answer to "which drawing did you build to" — the question that currently costs WM a WhatsApp archaeology exercise per claim.

**The move costs Q2 nothing evidential.** An instruction that references a drawing references the transmitted version, not the folder, and does so through a `floor_plan_version_id` held on the instruction itself; every drawing *and document* is versioned and revision-labelled by the end of Q2. So the March dispute is answerable from E-Site alone at the end of Q2 — who was instructed, on what date, against which revision, acknowledged by whom — and what waits a quarter is the *presentation* of that data on the register and the batch transmittal receipt beside it, which is precisely why the surface was the half that moved.

### 4.8 Saved-report read roles

`projects.reports.kind` is plain `TEXT` with no CHECK (`00117_report_export_branding.sql:48`), so nothing at the database stops a new kind being inserted. Appendix A(d) is the canonical kind-and-read-policy table and is not restated here; the two kinds this section adds are `instruction` (Q2) and `transmittal` (Q3), and both are declared. `meeting_minutes` is **not** registered — §4.6 is cut past twelve months.

**Both are recipient-scoped, and that branch is new.** The existing gate is role-set-valued, so `public.user_can_read_report_kind()` gains a recipient-lookup branch keyed on `reports.source_table`/`source_id`, and the TypeScript registry gains a `recipient_lookup` variant beside its role sets. The alternative — widening these two kinds to a plain role set — would show a landlord an instruction issued to a different tenant's contractor, which is the role-blind read PR #162 closed, reopened on the most sensitive documents in the product.

The branch is built once and moves house once:

- **Q2: it declares in the existing `REPORT_KIND_READ_ROLES`.** That is the mechanism that ships today, with `report-kind-access.contract.test.ts` failing the build on a kind declared in neither list. `instruction` declares `ORG_WRITE_ROLES` plus any user named in `instruction_recipients`. Building a registry to hold one new kind ahead of §07's harness would be a second mechanism, and §07's decision is explicit that there is not one.
- **Q3.2: it is ported to the `ReportSpec` registry's `access.read`**, with the rest of the nine kinds, when `REPORT_KIND_READ_ROLES` and `OPEN_READ_REPORT_KINDS` are deleted and the contract test is repointed at the registry. The port is where the type is **widened to admit `{ roles, recipient_lookup }`** — Appendix A(d) carries the widened signature and `RecipientTable` union verbatim. `transmittal` is registered directly in the widened shape, since its issue flow lands in the same quarter.

The DB-side branch and the app-side branch are written together in Q2 and ported together in Q3.2, because a page-level gate is not a gate: the report list and download actions are directly invocable, so both a RESTRICTIVE policy and the app check must agree at every point in that sequence.

### 4.9 Module toggles and out of scope

**Threads are always on** — they are the primitive, and every module inherits them.

**Instructions and the document register are also always on, and are not new toggle tokens.** Appendix A(e) is the canonical token list; it carries ten tokens and none of them is `instructions` or `transmittals`. **§12 §(h) test 7 asserts that set in both directions across four places at once** — A(e), the token array exported from `@esite/shared` that `requireModule()` and the settings UI both read, the `project_settings_modules_known` `<@` array CHECK parsed out of its migration, and the set of write-entry tables carrying the RESTRICTIVE module gate — failing the build naming the file and line. This section's wording is checked against the test's: **ten tokens today, four places, both directions**, so declaring two more here would fail CI rather than merely contradict the appendix. The test was added in this pass precisely because this ruling and §04 §(f)'s leaned on an enforcement that did not yet exist. This section's earlier proposal — toggles defaulting ON where `projects.project_settings.contract_type <> 'none'` (`00101_project_settings.sql:34-36`) — is therefore withdrawn, and withdrawing it is the right answer on the merits as well as the registry: §4.4's own argument is that a site instruction on a tenant fit-out with no JBCC contract must still be issuable, and a toggle keyed on `contract_type` would have contradicted it. Visibility is by role instead — `/projects/[id]/instructions` is `ORG_WRITE_ROLES` per Appendix A(g), and the register lives on the always-on Documents route — so a project with no correspondence simply shows an empty register to the three people who could have written in it, and shows nothing at all to anyone else. That is not clutter; a nav entry nobody outside the core team can see is not a tab a contractor has to learn.

E-Site is not a chat application. No direct messages, no channels, no presence or typing indicators, no voice or video, no emoji reactions, no WhatsApp bridge, and **no search surface ships in the twelve months** — search is excluded by decision, not deferred to a later quarter, and no section of this programme should be read as scheduling it. Teams keeps the office conversation: staffing, fees, internal debate, anything not about a specific project record. The boundary is a single test, and it is worth stating to users in those words: **if it would be quoted in a dispute, it belongs on a thread in E-Site; if it would not, it belongs in Teams.** Everything written in E-Site is discoverable, and a general chat surface invites content that should never be.

### Cost and sequencing

| Deliverable | Migrations | Effort | Quarter |
|---|---|---|---|
| Threads, mentions, participants, subject-type registry + resolver, branch-scoped attachments RLS, feed/Inbox routing, formal-response dual-write | 2 | 4.0 | Q2 |
| Instructions register: allocator, freeze + never-delete triggers, work-item spawn, PDF, acknowledgement token | 2 | 3.5 | Q2 |
| Recipient-scoped branch in `user_can_read_report_kind()` + `REPORT_KIND_READ_ROLES` variant + contract test | 1 | 0.5 | Q2 |
| `tenants.document_versions` + the cloud-sync document branch rewritten to version-then-repoint, `revision_label` / `revision_label_source` on both version tables, `projects.drawings` and the `'drawing'` attachment value dropped — **hard prerequisite of all transmittal work** | 2 | 1.0 | Q2 |
| **Q2 total** | **7** | **9.0** | |
| Drawing and document register surface on `/projects/[id]/documents`: revision labels on screen, version delete guards, transmitted-versus-latest column | 1 | 1.5 | Q3 |
| Transmittal issue flow: `transmittals` / `transmittal_items` / `transmittal_recipients`, acknowledgement token, issue UI | 1 | 1.0 | Q3 |
| **Q3 total** | **2** | **2.5** | |
| QC-comment and RFI-response back-fill, dual-write, renderer repoint — **moved from Q3 by §14's re-plan**, carrying the `projects.qc_comments` drop with it | 1 | 1.0 | Q4 |
| **Q4 total** | **1** | **1.0** | |
| Meeting minutes with carry-forward, per-heading numbering and work-item spawning (§4.6) | — | — | **cut past twelve months** |

**Section total: 12.5 engineer-weeks, unchanged; the split across quarters moved.** Q2 falls from 10.5 to 9.0 as the register surface changes quarter, Q3 carries 2.5, and the 1.0 back-fill line sits in Q4 — 9.0 + 2.5 + 1.0 = 12.5. Nothing was cut and nothing was re-sized; two lines changed quarter. Threads are carried at the honest 4.0, not the 3.0 an earlier plan assumed; the difference is the subject-type resolver, the attachments branch and its seven-entity-type verification, none of which are optional. `projects.activity` carries no line here — it ships in Q1 with the recap and the diary reclassification, and is priced there.

**This ledger is the one §13 books, and it is booked once.** §13 Q2 item 6 takes the 1.0 on the versioning line above and no longer adds a "+1.0" for `tenants.document_versions` on top of an item that already contained it — that double count is removed, and it is the reason Q2's raw commitment looked higher than the sum of its designing sections. §13 Q2 item 15 is the 0.5 recipient-scoped `user_can_read_report_kind()` line, which previously appeared in this ledger and in no quarter's; it is now booked on its own line rather than folded into item 5, because it is a DB function plus a TypeScript registry variant plus a contract test, none of which is instruction-register work. Summing this section into Q2 therefore contributes exactly **9.0**.

Reply-by-email is budgeted once, by the notification and digest engine, and carries no line here.

**One of this section's two Q3 lines stands at the front of §14's published Q3 cut order** — the transmittal issue flow, decided in the first week of June rather than the last. If it goes, Q2's deliverables are unaffected: the versioning and the instruction chain stand on their own, and the batch transmittal receipt is what waits. **The register surface is not offered into that cut order**, because it is the only surface on which Q2's versions, revision labels and transmitted-versus-latest answer are ever seen, cutting it would leave a quarter of versioning work with no reader, and — §14's own reason — it has already slipped one quarter, and a deliverable that slips twice dies without anyone deciding to kill it. The Q4 back-fill line is in no cut order at all: it left Q3 precisely so that it would not have to be cut.

**The arithmetic that landed on §14, and the decision §14 took, stated once so it is not lost between sections:** absorbing this 1.5 took Q3 to **20.75 against 20.2**, and §14 — which owns the Q3 ledger — resolved it by **moving the first line of its own published Q3 cut order, the QC/RFI back-fill and renderer repoint (1.0), into Q4 rather than cutting it**. The line is not lost, the year's committed total of 70.25 against 74.2 available is unchanged, and §15's cost-per-engineer-week divisor is therefore stable. **Q3 lands at 19.75 committed against 20.2 available, 0.45 of float on the total and 2.1 gross / 0.1 free on the path; Q4 at 19.5 against 20.2, 0.7 on the total and 2.6 gross / 0.35 free on the path.** Float on the path is §13's definition, quoted not redefined — lane capacity minus chain length, realisable only by executing that quarter's cut order on the off-path items in the same lane, which is why both a gross and a free figure are published. This section's ledger above books that line in Q4 accordingly, and Appendix A(f) carries the `projects.qc_comments` drop under Q4 with it.

Each migration number is re-checked against `max(version)` **and** `origin/main` immediately before applying, announced to concurrent sessions, and verified by reading the affected table back — `supabase db push` keys on the version prefix, so a number already in `schema_migrations` makes it print "up to date", exit 0 and skip the file, and a green deploy workflow is not evidence a migration ran. Every new table in `projects` ends its migration with `REVOKE SELECT … FROM anon`, verified with `has_table_privilege`. `docs/rbac-matrix.md` is updated in the same PR as each new route; `CONFORMANCE.md` in the same PR as the acknowledgement link. The document-versioning migration is the one to verify hardest: it changes an edge function and a table together, the sync is the only writer, and edge functions do not auto-deploy on merge — so a partially applied pair silently keeps overwriting bytes while the register claims they are pinned, for a whole quarter, until the transmittal work discovers it.
