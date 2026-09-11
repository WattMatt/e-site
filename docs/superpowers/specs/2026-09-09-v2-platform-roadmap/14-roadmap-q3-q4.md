## Roadmap — Q3 and Q4

Q1 and Q2 build the habit. Q3 and Q4 convert it into the two things WM sells: documents that leave the practice under its name, and control over dates and money. The order is deliberate — a report engine built before the ledger is populated produces empty PDFs, and a programme built before items are owned produces dates nobody answers for.

*(Citations are to the working tree `feat/site-forms-prefill` @ `939dc3b`, migrations to `00182`, except where marked `origin/main` @ `70ac208`, migrations to `00184`, which carries the `equipment_materials` filer, `report-kind-access.ts` and the site-forms v1.1 template. §07 reads `origin/main`; where the two sections cite the same file they cite the same tree.)*

### Capacity, the delivery calendar and what is cut in advance

Same team and same convention as Q1/Q2: **1.6 engineer-equivalents**, sizes expressed as engineer-weeks of the whole capacity, **S ≤ 0.5, M = 1–2, L = 2.5–3.5**. The South African calendar sets the windows.

| Quarter | Delivery window | Calendar weeks | Working days lost to public holidays | Capacity at 1.6 FTE |
|---|---|---|---|---|
| Q3 | 1 Apr – 30 Jun 2027 | 13.0 | Freedom Day Tue 27 Apr; Youth Day Wed 16 Jun (Workers' Day falls on Sat 1 May and is not substituted) | **20.2** |
| Q4 | 1 Jul – 30 Sep 2027 | 13.1 | National Women's Day Mon 9 Aug; Heritage Day Fri 24 Sep | **20.2** |

Easter 2027 (Good Friday 26 March, Family Day 29 March) falls inside Q2's window, not Q3's.

**These two quarters did not fit, and the re-plan is what made them fit.** Before arbitration the real commitment across the year was roughly 17.5 + 22.0 + 31.25 + 23.75 = 94.5 engineer-weeks against **74.2** available — the figure once Heritage Day 2026 and Q2's three public holidays are deducted on this section's own method, which §13 now applies to its half too — a twenty-week overrun **concentrated in Q3**, where this section carried 31.25 weeks of work in a 20.2-week quarter. The honest reading is that the earlier "20.0 of 20.2" was arithmetic over a deliverable list that had already lost lines to other sections' ledgers.

**§13's Q2 re-plan lands a deliverable in this quarter, and it is absorbed here rather than argued about.** The drawing-and-document register surface — `/projects/[id]/documents` rebuilt in place with revision labels, the version delete guards and the transmitted-versus-latest column, 1.5 in §06's ledger — arrives in Q3 beside the transmittal issue flow it feeds, because keeping it in Q2 made that quarter's chain 11.0 strictly serial engineer-weeks in a ten-week window. It lands as **Q3.12** and takes Q3 to 20.75 against 20.2.

**Q3 sheds exactly one line to fit, and it is moved rather than cut.** The first line of Q3's own published cut order — the QC/RFI back-fill and renderer repoint, 1.0 — **moves to Q4** instead of dying. The reason is arithmetic that belongs to another section: §15 divides the twelve-month internal engineering cost of R2 306 000 by the year's **70.25** committed engineer-weeks to publish **R32 826** per delivered engineer-week, and that divisor is only stable if every movement stays inside the year. A cut would move it; a move does not. The cost of the move is stated where it is paid — Q3.2's registry port opens `qc-report-data.ts` in Q3 and the repoint opens it again in Q4, which is precisely the saving the Q3 placement bought. **The `projects.qc_comments` drop travels with the deliverable:** it is a **Q4** migration, and Appendix A(f) books it under Q4 with the back-fill, printing "Drops: none" for Q3 — the one registry cell this move displaced, reconciled rather than left to be discovered.

After the re-plan the committed figures are **Q3 19.75 against 20.2, slack 0.45** and **Q4 19.5 against 20.2, slack 0.7** — 98% and 97% loading, against the re-planned **Q1 17.0/18.8** and **Q2 14.0/15.0**. **Across the year: 70.25 committed against 74.2 available.** The slack on the totals is thin; the float on the chain, published below, is what the quarters actually run on, and the cut order is what protects both.

**The cut order is stated before the quarter starts, as Q1's was, and is decided in the first week of the quarter's last month rather than its last week.**

- **Q3: the transmittal issue flow, then the item-for-item packs.** The harness, the seven-filer port and scheduled distribution are never in the cut order, because everything downstream is a projection of them. **The register surface is deliberately not in the cut order either** — it has already slipped one quarter, and a deliverable that slips twice dies without anyone deciding to kill it.
- **Q4: commercial activation, then the portfolio view, then the GCR and cable registrations.** The calendar, the tenant tracker and the lead-times are the quarter's protected core (§08 concurs and names the same three as not-cuttable). **None of the three cuts is on Q4's chain**, so each reduces the total and none shortens the path — the distinction §13 draws for Q1 and the reason its cut order is published as two lists.

**One thing sits outside both commitments by decision, not by oversight.** **Drawing-sheet circuit extraction (§10.8) is not committed in either quarter.** It is a WM-only pilot funded from the AI line, with §10.8's shape unchanged: an explicit "Extract circuits from this sheet" action on a *synced drawing*, PM-only, tiled page renders plus the board's `node_orders` and cable-schedule context as input, proposals staged in `ai.drafts` behind an accept/edit grid, and no rollout beyond WM until a held-out set of **≥ 40 real SA drawing sheets** scores per-field. §10.9's release gate governs it — > 0.95 on breaker rating and circuit number — not a confirmation-edit rate invented here. Extending site-form prefill to **per-circuit** breaker rating, poles and curve is sequenced strictly *after* it and is therefore also uncommitted: `structure.node_circuits` (`00169_db_legend.sql:25`) holds 12 rows database-wide with every descriptive column null, so the prefill extension has nothing to read until extraction populates it.

**Cited structured question-answering is no longer conditional — it is cut** (see the deferred table). Q4 has 0.7 weeks of float on the total and the deliverable is 2.5; a line that cannot be earned is not a schedule item.

**Migrations are identified by quarter and ordinal, never by number.** Appendix A(f) governs: numbers are claimed at merge against `max(version)` **and** `origin/main` immediately before applying — not when the branch is cut — announced to concurrent sessions, and verified by reading the affected table, view reloption or grant back afterwards. A green *Deploy DB Migrations* is not evidence a migration ran: `db push` keys on the version prefix, so a number already in `schema_migrations` makes it print "up to date", exit 0 and skip the file silently. One nominated migration owner per quarter.

**The whole plan is conditional on one thing, and it is a gate rather than a question: the contract engineer's funding, confirmed by 5 September 2026.** Neither quarter below is deliverable at 0.6 FTE.

**The monitoring line (0.25 per quarter, both quarters)** keeps §15's eight headline metrics instrumented as the surfaces underneath them change, and keeps the scheduled-job watchdog honest — a scheduled job with no run row inside its threshold raises `job_missed` to the org owner (Appendix A(c)), which is the only mechanism that catches a cron tick that silently stopped. It is carried as a line rather than absorbed, because instrumentation that can be dropped to save a fortnight is instrumentation that will be.

### The chain in each quarter, and the float on it

**§13 publishes a longest-chain figure and a float-on-the-path figure for Q1 and Q2, having found that a lane can be arithmetically full and calendar-infeasible at the same time; it states in one line that this section owes the same two figures for Q3 and Q4. They are published here.** A quarter costed only as a total is a quarter whose longest chain has never been measured. Both quarters split the 1.6 FTE identically and carry the same two-day holiday deduction, so the lanes are the same in each: **12.6 engineer-weeks in the single walker's lane (the contract engineer at 1.0 FTE) and 7.6 in Arno's (0.6 FTE)**, the two summing to the published 20.2. Q4's window is a tenth of a calendar week longer than Q3's, and that tenth is left unallocated in the walker's lane rather than committed, so both quarters are planned against the same two lane figures. Nothing in either lane is handed to a second person mid-item, which is §13's rule and the reason a chain is measured against one lane rather than against the quarter.

**Q3 — longest strictly serial chain: Q3.1 → Q3.2 → Q3.5 → Q3.7 = 10.5 engineer-weeks against 12.6 in that lane, so 2.1 of float on the path.** Float on the total is 0.45. The two are independent: the lane's float cannot be spent on the path, or the reverse.

**Q3.5's dependency line is corrected from "Q3.1–Q3.4" to "Q3.1–Q3.2", and the chain analysis is what found it.** The scheduler claims due rows and invokes the report route **by kind**; a kind registers against the harness, not against the scheduler. Q3.3's weekly pack and Q3.4's registers must therefore exist before the first pack *issues*, not before the scheduler is built. Under the strict reading the quarter foots on capacity and **fails on the calendar by roughly 0.2 weeks**: Q3.5 could not start until Arno's Q3.3 landed in week 6.33, which pushed Q3.7 and Q3.10 past the window. That is the same defect §13 found in Q2, in a quarter whose total looked comfortable.

**Q3 schedule, in delivery weeks from 1 April 2027.** Start is the later of the lane being free and the dependency finishing; Arno converts at 1 engineer-week = 1.67 calendar weeks.

| Item | Lane | Size | Ready (dependency finishes) | Start | Finish |
|---|---|---|---|---|---|
| Q3.1 Report engine harness | contract engineer | 3.0 | — | wk 0.00 | wk 3.00 |
| Q3.2 Filer port | contract engineer | 2.0 | Q3.1 @ wk 3.00 | wk 3.00 | wk 5.00 |
| Q3.5 Distribution and guest links | contract engineer | 3.5 | Q3.2 @ wk 5.00 | wk 5.00 | wk 8.50 |
| Q3.4 Item-for-item registers | contract engineer | 1.0 | Q3.1 @ wk 3.00 | wk 8.50 | wk 9.50 |
| Q3.7 Portal consolidation | contract engineer | 2.0 | Q3.5 @ wk 8.50 | wk 9.50 | **wk 11.50** |
| Q3.10 Transmittal issue flow | contract engineer | 1.0 | **Q3.12 @ wk 5.00 (other lane)** | wk 11.50 | **wk 12.50** — 0.1 of lane float |
| Q3.6 Chase agent and the `ai` schema | Arno | 1.5 | Q1 notification engine | wk 0.00 | wk 2.50 |
| Q3.12 Drawing and document register surface | Arno | 1.5 | Q2 `tenants.document_versions` | wk 2.50 | wk 5.00 |
| Q3.3 Weekly project report | Arno | 2.0 | **Q3.1 @ wk 3.00 (other lane)** | wk 5.00 | wk 8.33 |
| Q3.9 Voice-to-form | Arno | 2.0 | **`ai` schema @ wk 2.50 (other lane)** | wk 8.33 | wk 11.67 |
| Monitoring | Arno | 0.25 | — | wk 11.67 | **wk 12.08** — 0.35 of lane float |

Three items are gated on the other lane and each has an earliest start above: Q3.3 at week 3.00, Q3.9 at week 2.50, and Q3.10 at week 5.00 — the last is the binding one, because `transmittal_items` references the version tables `ON DELETE RESTRICT` and the guards must already exist. Q3.12 is scheduled second in Arno's lane for exactly that reason, six and a half weeks before Q3.10 needs it. The contract engineer's lane runs 12.5 engineer-weeks with zero idle; adding the quarter's two public holidays (0.4) puts it at 12.9 of the 13.0-week window. **The two off-path items in that lane are Q3.10 and Q3.4 — precisely the two lines of Q3's cut order**, so a slip on the path is absorbed by dropping work that is not on it.

**Q4 — longest strictly serial chain: Q4.1 → Q4.2 → Q4.5 → Q4.6 = 10.0 engineer-weeks against 12.6, so 2.6 of float on the path.** Float on the total is 0.7. Q4 is the least chain-bound quarter of the four, which is why its three cut-order lines are all off-path.

**Q4 schedule, in delivery weeks from 1 July 2027.**

| Item | Lane | Size | Ready (dependency finishes) | Start | Finish |
|---|---|---|---|---|---|
| Q4.1 Calendar, milestones, lookahead, ICS | contract engineer | 3.5 | Q1 work items, Q3.6 | wk 0.00 | wk 3.50 |
| Q4.2 Tenant tracker and landlord view | contract engineer | 2.5 | Q4.1 @ wk 3.50 | wk 3.50 | wk 6.00 |
| Q4.5 Monthly client report | contract engineer | 2.0 | Q4.2 @ wk 6.00 | wk 6.00 | wk 8.00 |
| Q4.6 Narrative drafting and review | contract engineer | 2.0 | Q4.5 @ wk 8.00 | wk 8.00 | **wk 10.00** |
| Q4.7 Commercial activation | contract engineer | 1.5 | Q4.1 @ wk 3.50 | wk 10.00 | wk 11.50 |
| QR board labels | contract engineer | 0.5 | — | wk 11.50 | wk 12.00 |
| Project export | contract engineer | 0.25 | Q3.1 | wk 12.00 | **wk 12.25** — 0.35 of lane float |
| Q4.10 Published pricing cutover | Arno | 1.0 | — | wk 0.00 | wk 1.67 |
| QC/RFI back-fill and renderer repoint | Arno | 1.0 | Q3.2, previous quarter | wk 1.67 | wk 3.33 |
| Q4.8 Portfolio view and response-time metrics | Arno | 1.5 | **Q4.1 @ wk 3.50 (other lane)** | wk 3.50 | wk 6.00 |
| Q4.3 Lead-times and the late-order digest | Arno | 2.0 | **Q4.2 @ wk 6.00 (other lane)** | wk 6.00 | wk 9.33 |
| Auto-location on capture | Arno | 1.0 | — | wk 9.33 | wk 11.00 |
| GCR backfill and cable-pack registration | Arno | 0.5 | Q3.1 | wk 11.00 | wk 11.83 |
| Monitoring | Arno | 0.25 | — | wk 11.83 | **wk 12.25** — 0.35 of lane float |

Two items are gated on the other lane: Q4.8 cannot start before week 3.50 and Q4.3 not before week 6.00. Arno's lane carries one enforced idle gap of 0.17 weeks at week 3.33, and it is why the pricing cutover and the back-fill — the two items in the quarter that depend on nothing inside it — are scheduled first.

---

### Q3 · Apr–Jun 2027 — "Reports write themselves"

**Theme.** No engineer at WM opens Word to report on a project. Every recurring document is generated from the ledger, reviewed by a human, and sent on a schedule to a list that includes people who will never log in.

**Proving outcome.** In June 2027 **every weekly pack** on the five live projects issues on its scheduled date without anyone pressing a button, and the client portal is where the landlord reads it. Falsifiable: **reports scheduled per project ≥ 3 on every active project, and zero project reports authored in Word during June**.

**The quarter's ledger — 19.75 against 20.2, chain 10.5 with 2.1 of float on the path.**

| # | Deliverable | Size |
|---|---|---|
| Q3.1 | Report engine harness | 3.0 |
| Q3.2 | Port the seven live filers onto the registry | 2.0 |
| Q3.3 | Weekly project report | 2.0 |
| Q3.4 | RFI register and snag list by round | 1.0 |
| Q3.5 | Scheduled distribution and guest links | 3.5 |
| Q3.6 | The chase agent and its escalation ladder | 1.5 |
| Q3.7 | Client portal consolidated into three surfaces | 2.0 |
| Q3.9 | Voice-to-form and the `ai` schema | 2.0 |
| Q3.10 | Transmittal issue flow | 1.0 |
| Q3.12 | Drawing and document register surface (arriving from Q2) | 1.5 |
| — | Monitoring | 0.25 |

**Q3.8 is cut and its number is retired rather than reused**, so a cross-reference from another section resolves to a cut line instead of silently landing on a different deliverable. **Q3.11's number is retired the same way**: the QC/RFI back-fill and renderer repoint is not cut, it moves to Q4 and is carried in that quarter's ledger, for the reason given in the capacity block above.

#### Q3.1 — Report engine harness · L 3.0
§07 §5.2 in full: the `ReportSpec` registry, `projects.file_report()` behind the `reports_one_issued` partial unique index, and the text-safety boundary — `<T>` / `<TOptional>` in `lib/reports/safe-text.tsx`, `drawTextSafe` / `widthOf` extracted into `lib/pdf/draw-safe.ts`, and the two eslint rules that make a raw `Text` import or a bare `.drawText(` a build failure. **Regression control is a decoded content-stream comparison plus page count and geometry with creation metadata pinned, not a byte-identical buffer** — `@react-pdf/renderer` writes a `/CreationDate` into the document info dictionary (`apps/web/node_modules/@react-pdf/renderer/lib/react-pdf.js`) and PDF trailers carry generated ids, so a buffer assertion fails on every run for reasons unrelated to the port. **Explicit line item: promote `extractPdfTextPerStream` to a shared test utility.** It exists once, inside `apps/web/src/lib/reports/site-form-report.test.tsx:79`, and it decoded latin1 where PDF standard fonts write WinAnsi until recently — precisely the fixture that cannot express the property under test.
*Audience: WM engineers. Depends on: nothing.*

#### Q3.2 — Port the seven live filers onto the registry · M 2.0
`inspection`, `snag`, `qc`, `tenant_schedule`, `equipment_materials`, `valuation`, `site_form` come onto the `ReportSpec` registry; `REPORT_KIND_READ_ROLES` and `OPEN_READ_REPORT_KINDS` are deleted, `report-kind-access.contract.test.ts` is repointed at the registry keeping its scanner guard, and `access.read` takes Appendix A(d)'s values kind for kind. **The two kinds that are not filers today — the GCR generator report and the cable revision pack — are registered in Q4, not here** (0.5, moved out with the re-plan); A(d) records both, with their quarters and read policies, and the list is not restated in this section.

The tenant-schedule route's generate, ungated by comment today (`api/projects/[id]/tenant-schedule/reports/route.ts:20-25`, "Authorization is VIEW-level by design"), comes under the registry with `access.generate` stated rather than argued in a comment. QC keeps the `qc-reports` bucket and its eight storage policies; no object moves.

`valuation` and `site_form` gain the branded cover and running chrome their renderers cannot receive today. **Production holds one valuation record and one site form and zero saved reports of either kind** — of the nine saved reports, seven are `tenant_schedule`, one `qc`, one `equipment_materials` — so branding them changes no document any client has ever seen. That makes this the safest possible moment, not a risk to manage.
*Audience: WM engineers. Depends on: Q3.1.*

#### Q3.3 — Weekly project report · M 2.0
One registry kind with `period` set, idempotent by the `period_key` unique index rather than by scheduler discipline: **Monday 07:00 SAST, `0 5 * * 1`, covering the previous Mon–Sun.**

**The daily site report is cut, and the reason is redundancy rather than budget.** The 07:00 recap that ships in Q1 already carries, in its section 4, the named list of contractors with no diary entry — every day, six days a week, to the people who act on it. A second daily document restating the same fact in PDF is a second thing to schedule, a second thing to fail, and a second thing for a contractor to ignore. `daily_site` is therefore **not** registered as a report kind (A(d) records the exclusion with the same reason).

The weekly pack is a record of the period, issued even when the period was empty and saying so: contractors with no diary entry are **named**, and a missing weather value prints "weather not recorded" rather than vanishing. The monthly client report is Q4.5, per §07 §5.8 — it wants the programme section Primitive 6 delivers in Q4.
*Audience: all three. Depends on: Q3.1, Q1 work items, Q2 threads.*

#### Q3.4 — RFI register and snag list by round · M 1.0
Two filtered `Table` projections with the filter stated on the cover. This is what replaces the Excel snag list and the emailed RFI tracker. **There is no separate QC register pack**: `qc` is a live filer ported in Q3.2 and its issued report *is* the register, so a third projection over the same rows would be a second answer to one question. The instruction, GRN, CoC/form ZIP and transmittal packs are cut past twelve months — each is cheap whenever it is wanted and none is why anyone opens the app.
*Audience: WM engineers, contractors. Depends on: Q3.1.*

#### Q3.5 — Scheduled distribution and guest links · L 3.5
`projects.report_schedules` and `projects.report_runs` plus a `report-scheduler` edge function on a 15-minute `pg_cron` tick that claims due rows and **then invokes the Node report route, forwarding the caller's Authorization header** — the edge runtime injects `SUPABASE_SERVICE_ROLE_KEY` as a non-JWT `sb_secret_…`, so a function-to-function JWT gate fails without it. `FOR UPDATE SKIP LOCKED` is not expressible through PostgREST, so the claim is a SECURITY DEFINER function, `projects.claim_due_report_schedules()`, with `REVOKE ALL FROM PUBLIC` plus an explicit `anon` revoke and no `auth.uid()` in its body because it is service-invoked. `projection='own_items'` renders one short PDF per party from a single `gather()`; redaction happens in the projection so no template can forget it.

**Decision: one account-less access mechanism, not two.** External recipients open a report through `public.guest_links` with `scope='report'` (§11.4) — SHA-256 token hash, 30-day default and 90-day hard maximum, `max_uses`, `revoked_at`, every redemption written to `public.audit_log` with `actor_id = NULL`, and `anon` granted nothing. `projects.report_access_tokens` (§07 §5.5) is **not created**; that table is deleted from §07 and its Q4 cost line reduced to **0.5**, the route and the email type folding into this deliverable. §07's six redemption rules become the properties of the `report` scope, carried verbatim in Appendix A(d) — the route accepts the token and nothing else, refuses any report whose `status` is not `issued`, and rate-limits 20 per token and 200 per IP per hour without disclosing whether the token exists. Two token tables would mean two revocation paths and two audit surfaces, and the weaker one becomes the hole. The route is an `app/api/*` handler outside `(admin)/layout.tsx` reading with the service client — the PR #160 finding-7 shape that left a client viewer able to fetch a voided record indefinitely — so it re-checks scope, expiry, revocation, use count and issued status **on every request**, never at issue time. `docs/rbac-matrix.md` and `CONFORMANCE.md` change in the same PR.
*Audience: contractors and clients — the first thing E-Site sends that a non-user receives. Depends on: Q3.1–Q3.2 (corrected from Q3.1–Q3.4 by the chain analysis above — the scheduler dispatches by kind and a kind registers against the harness), Q2 recipient roster. Edge functions do not auto-deploy on merge; CLI-deploy the scheduler, create the cron job through the Management API, then read `cron.job` back and confirm the first tick landed with `trigger='cron'`.*

#### Q3.6 — The chase agent and its escalation ladder · M 1.5
A nightly sweep over the work-item spine, not a new data model, on §10.2's ladder — the pre-due line in the 07:00 recap is Primitive 3's always-fires rule and is **not** a chase rung.

| Rung | Trigger | Recipient | Action |
|---|---|---|---|
| 1 | due + 1 day | assignee | one notification per **person**, ranked, one model-written sentence per item |
| 2 | due + 4 days | + gatekeeper | as above, naming the item's age |
| 3 | due + 8 days | + project manager | as above |
| 4 | due + 15 days | the weekly report's exceptions table | nudging **stops**; the item is a management exception, not a reminder |

Hard limits are columns and unique indexes, not memory: at most one chase notification per person per day across all projects, at most one nudge per item per 72 h, nothing on Saturdays, Sundays or SA public holidays (the `site` calendar, Appendix A(h)), and a project with more than 40 overdue items sends its PM one triage item instead of nudging 40 people. Every nudge writes `public.audit_log`. SQL decides who is chased; the model writes only the sentence, and the nudge still sends with template text when the model is unavailable. **From Q3 the chase sweep is the sole producer of `work_item_overdue`** (A(c)).

**New notification types are rows in `public.notification_types`, not a re-declared CHECK constraint** — Q1 deliverable 4 replaced `notifications_type_check` with data — and tier and digest eligibility are columns on that row. Six types land here: `chase_nudge`, `report_issued`, `report_schedule_failed`, `approval_requested`, `approval_decided` and `transmittal_received`. **Q4 registers `order_late` and `milestone_due` the same way — two `INSERT`s, no CHECK re-declaration** — which is the whole point of having retired the constraint: it had been rewritten six times (`00066:653`, `00072:29`, `00173:28`, `00176`, `00178:58`, `00179:595`) and could never be appended to.

**This quarter creates the `ai` schema (§10.1) — `ai.runs`, `ai.drafts`, `ai.nudges` and `ai.org_profile` — and it carries three deploy obligations, not one.** (1) The Management-API `PATCH /v1/projects/{ref}/postgrest` on `db_schema`, without which REST returns `PGRST002` indefinitely with no auto-recovery; (2) a **complete GRANT block** — schema `USAGE` to `anon`, `authenticated` and `service_role` plus all table and sequence privileges — whose omission is exactly what took down the entire REST API in `00069_inspections_grants.sql:2-13`; and (3) an edit adding `ai` to `apps/edge-functions/supabase/config.toml:9`, which today lists eleven schemas and not `ai` (verified), so local dev and any fresh database would otherwise diverge from production. **Voice-to-form (Q3.9) now lands in the same quarter**, which is the point of moving it: the schema and its first two consumers ship together, and voice is instrumented into `ai.runs` from its first call rather than retrofitted a quarter later.
*Audience: all three. Depends on: Q1 work items, Q1 notification engine.*

#### Q3.7 — Client portal consolidated into three surfaces · M 2.0
The portal today is **eleven project-scoped pages plus the project list**, not five: `(portal)/portal/[projectId]/{page,cables,diary,equipment-materials,floor-plans,generator-recovery,handover,inspections,quality-control,snags,tenant-schedule}/page.tsx` and `(portal)/portal/page.tsx`, behind a mirror-gate that bounces any non-`client_viewer` (`apps/web/src/app/(portal)/layout.tsx:21-22`). The overview is a five-row definition list — status, client, address, start, planned completion (`[projectId]/page.tsx:13-19`). Four client viewers have not signed in since 8 July 2026, which is the correct response to that page. This is a **consolidation**, and every page has a stated destination.

| Today | Disposition |
|---|---|
| `page.tsx` (overview), `diary`, `floor-plans` | Become the **timeline**: milestones, beneficial-occupation dates, issued drawings, issued reports, photo plate |
| `cables`, `equipment-materials`, `inspections`, `quality-control`, `snags` | Fold into the **reports shelf** — issued versions only, gated by `user_can_read_report_kind()` (`00183`, origin/main); the live registers stop being separate client pages |
| `tenant-schedule` | Survives; becomes the landlord view in Q4.2 |
| `generator-recovery`, `handover` | Disappear with their module toggles, OFF by default per the declutter decision (A(e)) |

The third surface is **approvals** — the first **decision** a client viewer records; thread messages landed in Q2, so this is not the first write, it is the first commitment. §11.1's Watcher tier row states the capability exactly: `client_viewer` gets "read + comment + approve on the surfaces §11.5 lists; nothing else". One decision object (approve / approve with comment / reject with reason) on **documents and drawings, milestone and beneficial-occupation acceptance, and issued reports**. **Variations are deliberately not in that set.** §11.5 lists variation orders among the things a watcher is never shown, for a commercial reason; `COST_VIEW_ROLES` excludes `client_viewer` (`packages/shared/src/types/index.ts:61`) and `variation.actions.ts:1-18` gates every read on it, so a watcher cannot see a variation's value and approving one blind is commercially meaningless. Gated in the app **and** by a RESTRICTIVE INSERT policy allowing exactly the named approver on an open request, because the portal layout gates nothing a directly-invocable server action must pass. The portal gate itself is re-cut onto `user_effective_project_role(project_id)` per §11.5.
*Audience: clients/developers. Depends on: Q3.1–Q3.5, Q1 work items. `docs/rbac-matrix.md` and `CONFORMANCE.md` change in the same PR.*

#### Q3.9 — Voice-to-form and the `ai` schema · M 2.0
Moved out of Q2 by the re-plan, and the move is what resolves the instrumentation conflict: voice now ships **with** the schema that records it, instead of a quarter before it. §09 owns the hold-to-talk control, the same-origin `POST /api/capture/transcribe` route (Appendix A(g), Q3, `requireRoleAPI`, audio discarded on return) and the `microphone=self` header change; §10.5 owns the extraction. Hold-to-talk fills structured fields on diary, snag and QC entries against the project's own vocabulary — board tags from `structure.nodes`, tenant names from `tenant_details`, cable tags from `cable_schedule.cable_tags`, passed as a lexicon so "DB three point one" resolves to `MAIN BOARD 3.1`. There is a confirmation surface and never an auto-submit. Afrikaans and Zulu are tested before they are promised.

Speech-to-text is **not** Claude: a third-party STT at ~R0.11/minute produces the transcript and `claude-haiku-4-5` maps it onto fields. **The STT vendor is not yet named and is named by 30 November 2026** on two hard criteria — a zero-retention tier and an SA or EU processing region (Appendix A(i); §15 open question 9). `ai.runs.outcome`, `edit_distance` and `resolved_at` are written by the same server action that accepts or edits the extraction, so the feature cannot be instrumented later.

**Voice in Q3 is the first client data to reach a foreign operator**, which is what sets the 1 April 2027 deadline on the POPIA §21 operator agreements and the §72 equivalent-protection undertaking — Arno's, priced in §15(g) as a legal-review fee and deliberately not charged to the engineer-week ledger.
*Audience: contractor site staff. Depends on: Q3.6's `ai` schema (same quarter, sequenced ahead), Q2 capture routes.*

#### Q3.10 — Transmittal issue flow · M 1.0
Moved out of Q2. `projects.transmittals` / `transmittal_items` / `transmittal_recipients` (Appendix A(f), Q3), sharing the instruction numbering allocator, the freeze-on-issue trigger, the never-delete guard and the acknowledgement columns and token of §06 §4.4–§4.5, plus the issue UI. `transmittal_items` references a `floor_plan_version_id` or `document_version_id` **`ON DELETE RESTRICT`** against the version delete guards, which now arrive in this quarter with Q3.12 and **must land at a lower migration ordinal than `transmittal_items`** — a guard added after the references exist is a guard that was absent exactly when it mattered. The schedule above puts Q3.12 six and a half calendar weeks ahead of this line for that reason. `transmittal` registers directly in A(d)'s widened `{ roles, recipient_lookup }` shape, `recipient_lookup: 'transmittal_recipients'`.

**Q2 is not weakened by the move.** The March dispute is still answerable from E-Site alone — who was instructed, when, against which drawing revision, acknowledged by whom — because the instruction register ships in Q2 and references a `floor_plan_version_id` directly, and every drawing *and* document is versioned and revision-labelled in that quarter. What slips with this line is the batch transmittal receipt, and with Q3.12 the register surface that presents "transmitted versus latest". **§06 §4.7's claim that the versioning work is "scheduled a full quarter ahead of the transmittal work" survives for the versioning prerequisite and not for the register surface**, which is now beside the transmittal flow rather than a quarter ahead of it; that sentence is amended in §06 to say so.
*Audience: WM engineers, contractors, clients. Depends on: Q2's `tenants.document_versions` — a hard prerequisite, not a companion line — and Q3.12's version delete guards, at a lower migration ordinal.*

#### Q3.12 — Drawing and document register surface · M 1.5
**Arrived from Q2 in §13's re-plan, and it is the only line in either quarter that did not originate here.** `/projects/[id]/documents` is rebuilt in place as the register: revision labels on screen, the **version delete guards**, and the transmitted-versus-latest column per recipient per drawing. Q1 item 8 already added the route to the navigation, so the path is discoverable two quarters before it becomes the register and no user meets a new menu entry here (Appendix A(e)).

**Only the surface moved; the objects did not.** `tenants.document_versions`, the cloud-sync document-branch rewrite, the `revision_label` / `revision_label_source` column adds and the `projects.drawings` drop all ship in Q2 as §06's 1.0 prerequisite, gated on the sync engine rather than on Q2's instruction chain — so **Appendix A(f)'s Q2 object inventory is unchanged by this move** and Q3 inherits a populated version store rather than an empty one. What lands in Q3's migration ledger is the delete guards alone, at an ordinal below `transmittal_items`.

The four synced projects are re-walked and counted against Dropbox before the register is published, because the document-branch rewrite touches a sync engine that has already been wrong twice — the MAX_FILES walk cap and the never-scheduled poll.
*Audience: WM engineers, contractors, clients. Depends on: Q2's `tenants.document_versions`. Feeds: Q3.10.*

#### Q3 migrations

Ordinals, not numbers. Appendix A(f) governs the claim-at-merge rule.

| Ordinal | Contents |
|---|---|
| 1 | Engine A: `projects.reports` `period_key` / `period_start` / `period_end` / `narrative_json` / `bucket` / `audience`; the `reports_one_issued` partial unique index, built only after the duplicate-count query returns zero rows; `projects.file_report()` with `REVOKE ALL … FROM PUBLIC` **and** an explicit `anon` revoke before its `GRANT`; `NOTIFY pgrst` |
| 2 | Engine B: `projects.report_schedules`, `projects.report_runs`; `public.guest_links` + token-hash unique index + RLS; `projects.claim_due_report_schedules()` |
| 3 | `projects.approvals` + RESTRICTIVE INSERT policy; portal read policies |
| 4 | `ai` schema — **plus the PostgREST `db_schema` config PATCH, the complete GRANT block and the `config.toml:9` edit** — `ai.runs`, `ai.drafts`, `ai.org_profile`, `ai.nudges` with `UNIQUE (person_id, sent_on)`; chase-rung state on the work-item spine; `notification_preferences.chase_opt_out`; the six Q3 rows in `public.notification_types` |
| 5 | **Version delete guards on `tenants.document_versions` and `floor_plan_versions`** (arriving with Q3.12; the `revision_label` column adds and the `projects.drawings` drop stay in Q2, per A(f)). **This ordinal must be lower than 6** — the guards exist before anything references the versions they protect |
| 6 | `projects.transmittals` / `transmittal_items` / `transmittal_recipients`; freeze-on-issue trigger; acknowledgement columns and token; `ON DELETE RESTRICT` references onto the Q2 version tables, against the ordinal-5 guards |

The QC-comment and RFI-response back-fill, and the drop of `projects.qc_comments` that follows it, are **no longer Q3 migrations** — they travel with the deliverable into Q4 and appear as ordinal 9 there.

Every new table in `projects` ends its migration with `REVOKE SELECT … FROM anon` — `00025_grant_schema_permissions.sql:26` makes every new table anon-readable at the grant layer — verified with `has_table_privilege`, never by reading `relacl`. Every new function in an exposed schema carries `REVOKE ALL FROM PUBLIC` **and** an explicit `anon` revoke, verified with `has_function_privilege('anon', oid, 'EXECUTE')` and never by reading `proacl`; none uses `current_user` in an authorisation decision.

#### Q3 exit criteria

*Targets are §15 §(a)'s; this table restates them and does not set them.*

| Metric | Target | Baseline |
|---|---|---|
| Reports scheduled per project | ≥ 3 on every active project | instrumented at 0 in Q1 |
| Project reports authored in Word, June 2027 | 0 | all of them |
| Item-for-item packs issued | ≥ 1 per active project during June | 0 |
| Client viewers signing in monthly | ≥ 3 of 4 | 0 since 8 July 2026 |
| Client approvals recorded | ≥ 10 | 0 ever |
| Median working days to respond on RFIs (§15 metric 4) | **≤ 4 working days** (office calendar, A(h)), unanswered items counted at their current age | unmeasurable — `assigned_to` NULL on all 15; ≥10 of 15 have no `rfi_responses` row |
| Chase nudges answered before rung 2 | > 50% (§10.9) | no chase exists |
| Guest-link report opens by non-users | ≥ 20, with **zero** opens resolving to a non-issued report | no account-less surface exists |

#### Q3 risks

*The quarter is 19.75 against 20.2, with 0.45 weeks of slack on the total and 2.1 on the chain* — the cut order is the transmittal issue flow, then the item-for-item packs, decided in the first week of June rather than the last; both are off-path, so each reduces the total and neither shortens the 10.5-week chain, and if the path itself slips the remedy is a second pair of hands inside Q3.5, not a scope reduction. *Scheduled mail fires twice or lands as spam* — idempotency is the `period_key` unique index, not scheduler discipline, and month one distributes to WM addresses only. *A guest link is forwarded* — one link grants exactly one issued document, revocation is a single UPDATE effective on the next request, and every redemption is an audit row. *Client approvals create contractual expectation* — the approval records what, by whom, when, and against which issued report version, and the PDF states it is not a JBCC certificate. *The `ai` schema is created without its three obligations* — a missing GRANT block or `config.toml` line does not fail loudly; it returns `PGRST002` across the whole REST API, and it is verified by calling REST against `ai` after the PATCH, not by reading the migration. *Voice sends site speech to a foreign operator before the paperwork exists* — the operator agreements have an owner and a date, 1 April 2027, ahead of the first call. *Migration numbering races* — one nominated owner for the quarter, number claimed at merge, effect verified by reading the affected table back.

---

### Q4 · Jul–Sep 2027 — "Planning and control"

**Theme.** Dates and money. Every commitment one party owes another is visible, owned and chased; the tenant delivery race is legible to the landlord; and the practice charges a published flat price for it.

**Proving outcome.** A landlord opens one screen and sees which shops will miss beneficial occupation and why. Falsifiable: **every active project has a populated milestone set and a tenant tracker, and the portfolio view is WM's Monday-morning screen instead of a monday.com board**.

**The quarter's ledger — 19.5 against 20.2, chain 10.0 with 2.6 of float on the path.**

| # | Deliverable | Size |
|---|---|---|
| Q4.1 | Calendar, milestones, three-week lookahead and the ICS feed | 3.5 |
| Q4.2 | Tenant delivery tracker and the landlord view | 2.5 |
| Q4.3 | Procurement lead-times and the late-order digest | 2.0 |
| Q4.5 | Monthly client report | 2.0 |
| Q4.6 | Narrative drafting and human review | 2.0 |
| Q4.7 | Commercial activation — **valuations only** | 1.5 |
| Q4.8 | Portfolio view, merged with the response-time metrics | 1.5 |
| Q4.10 | Published pricing cutover | 1.0 |
| — | Auto-location on capture (from Q2) | 1.0 |
| — | QR board labels (from Q2) | 0.5 |
| — | GCR backfill and cable-pack registration (from Q3) | 0.5 |
| — | QC/RFI back-fill and renderer repoint (from Q3) | 1.0 |
| — | Project export | 0.25 |
| — | Monitoring | 0.25 |

**Q4.4, Q4.9 and Q4.11 are cut and their numbers are retired**, for the reasons recorded in the deferred table.

#### Q4.1 — Programme calendar, milestones, lookahead and the ICS feed · L 3.5
Primitive 6's `projects.dated_items` view, `calendar_entries`, `milestones`, the three-week lookahead **and the ICS feed at 0.5 of it** — §08 specified the feed in full and no quarter previously carried it, so it is inside this line rather than floating. `GET /api/calendar/ics` is re-authorised through `user_effective_project_role` **on every request**, never from a snapshot, against a SHA-256 token hash on `profiles.ics_token_hash`; it is a new bearer credential, so `CONFORMANCE.md` moves with it. Explicitly not a CPM engine: no logic links, no levelling, no baseline, no earned value. RIB Candy owns SA contractor programming at roughly R1 500 per licence per month and is not displaceable by a consulting engineer's app; E-Site's claim is narrower — every date one person owes another is owned and chased. `projects.resolve_ball_in_court()` supplies a non-null holder for the ten non-work-item `dated_items` kinds and passes `work_items.ball_in_court_id` straight through for `work_item_due` (A(a)).
*Audience: WM PMs, then contractors. Depends on: Q1 work items, Q3.6.*

#### Q4.2 — Tenant delivery tracker and the landlord view · L 2.5
**Beneficial occupation already exists and is not rebuilt.** `00093_tenant_bo_dates.sql` adds `projects.projects.opening_date`, `structure.tenant_details.bo_period_days` (CHECK > 0; presets 90/60/45/30) and `bo_date_override`, and `packages/shared/src/structure/bo.service.ts` already computes the effective BO date (`computeBoDate` — override wins, else `opening_date − bo_period_days`, else null), the material-order required-by date (`computeOrderRequiredBy`) and a red/amber/green status against today with a 14-day amber window. Nothing derived is stored, by design. Q4.2 reads all of it, including the two null cases the UI must state rather than hide: `bo_period_days` unset, and `opening_date` unset.

**Decision: the delivery stage is derived, never a second status column.** `structure.tenant_details.scope_status` (`00080_tenant_schedule.sql:65-66`, CHECK `awaited|received`) and `tenant_scope_items` stay the write target for the scope stages and are untouched. The eight-stage model — lease → drawings approved → scope agreed → order placed → installation → CoC → beneficial occupation → occupation certificate — is a computation over evidence that already exists, and **three new columns are the whole schema cost**, per §08:

- **No `lease_signed_on` and no `occupation_certificate_on` column is added.** Nothing in E-Site captures a lease, so `lease_signed_on` would be null in all 411 tenant rows — the exact failure of `db_location` / `db_fed_from` / `db_earth_leakage_ma` (`00169_db_legend.sql:140-145`), null in all 411 rows, which is why PR #161 abandoned them as a prefill source. Lease recorded is derived from the tenant-schedule import (a `tenant_db` node with `shop_number`/`shop_name`, `00074:32-37,48-49`).
- **`structure.tenant_details.bo_confirmed_on`**, written by a **Confirm BO** action on the tenant row — the person who benefits from the field is the person who fills it.
- **`structure.tenant_document_revisions.approved_on` / `approved_by`**, written by closing the drawing-approval work item and never typed free-hand: approval is an assigned commitment with a due date, and the timestamp is its side effect.
- **Occupation certificate is derived from a `structure.tenant_documents` row of a new `kind='occupation_cert'`**, its date being that revision's `issued_at` (`00118:24`) rather than a separate column. The `kind` CHECK (`00118_tenant_documents.sql:7`, today `('layout','scope')`) is re-declared wholesale with all three values; `recompute_tenant_doc_status` needs no change because its `IF/ELSIF` has no `ELSE` and no-ops on an unknown kind (`00118:41-49`).

A column with no gate is a column that stays null, and a duplicated status column on the liveliest table in the product — 265 new rows in the last thirty days — is exactly the drift the report engine is ending. `scope_not_required` (`00150:14`) and `nodes.coc_required` (`00074:43`) mark stages not-applicable rather than incomplete, so a landlord-fitted shop does not read as late forever.

The landlord view is one board of shops by stage with days-to-BO and the blocking item named, at `/portal/[projectId]/delivery`. **It is served by `requirePortalAccess` → service client → an allow-listed column projection, not by RLS**: `00166_client_viewer_node_order_read_block.sql` dropped `node_orders_select_client_viewer` after a confirmed live leak, so a `client_viewer` JWT reads zero rows from `structure.node_orders` and the Installation stage cannot be derived through RLS for a landlord at all. That is the established portal pattern (`apps/web/src/lib/portal/data.ts:39-53, 274-330`), and the projection exposes `node_orders.status` only — never `notes`, documents or shop drawings. SA landlords run this in spreadsheets and hire PM firms; no product links tenant → shop DB → CoC → occupation certificate.
*Audience: clients/developers (primary), WM PMs. Depends on: Q4.1, Q3.7.*

#### Q4.3 — Procurement lead-times and the late-order digest · M 2.0
`structure.node_orders` (`00083_node_orders.sql:50`) carries `required → ordered → received → by_tenant` (`:74-75`) with `ordered_at` / `received_at` (`:78-79`) and free-text `notes` (`:82`). What is missing is **lead time as an input**: today's required-by *is* the BO date, so an order placed the week before BO reads green until it is red. Required-by is re-derived as **BO − install days − lead time**, and a late-order rung joins the chase ladder.

**Decision: tenant lead times are a property of the scope item; equipment lead times are a property of the project — neither is a column on `node_orders`.** `structure.scope_item_types` gains `lead_time_days` and `install_days`, **and the migration seeds the two built-in types in the same statement** — `db` → 60/5, `lighting` → 30/3, updating the rows seeded per organisation at `00080:121-129` — so the fix takes effect on apply rather than shipping as a no-op waiting for someone to populate it. Equipment orders can never be reached that way: `node_orders.scope_item_type_id` is NULL for every equipment order by design (`00083:68-69`, enforced by the partial unique index at `00083:111-113`), so they take `projects.project_settings.equipment_lead_time_days` and `equipment_install_days`. `lead_time_days` is measured in **calendar** days — a supplier does not observe your working week — while `install_days` reads the `site` calendar (A(h)).

**The late-order alert is a daily per-project digest, not a per-order notification.** Production holds 964 notifications, 57 ever read, 750 of them `diary_created`: per-row notification is a measured failure mode in this product. One digest per project per day, sent only when the red-or-newly-amber set changes, addressed to the ball-in-court, listing tenant, scope item, BO date and days late — one commitment ("order 4 late items for KFC, DEBONAIRS, CONVERSE"), not four bells. `order_late` and `milestone_due` are **two `INSERT`s into `public.notification_types`** with A(c)'s tiers and audiences; the CHECK is not re-declared, because Q1 retired it.

**The procurement catalogue link is cut.** `marketplace.catalogue_items` (`00005_suppliers_schema.sql:69-86`) already holds `sku`, `unit_price`, `lead_time_days` and `marketplace_visible`, and it remains the right table for that work whenever it is funded — but no SA wholesaler publishes a price file, the fallback was always org-maintained catalogues, and it is not what makes an order line late.

**The Marketplace storefront is parked, not retired, per §11.7.** `marketplace.commission_records`, the Paystack subaccount tables and the seven `(marketplace)` pages are untouched, so the two April demo orders stay auditable; Marketplace is not a per-project toggle but an org-level surface removed from navigation (A(e)). **The commission constant does not change.** The 6% figure lives in six places — `marketplace-payment/index.ts:29`, `paystack-webhook/index.ts:61` (verified: `Number(metadata.commission_rate ?? 0.06)`), `packages/db/src/services/payment.service.ts:16`, the DDL default at `00016_commission_paystack.sql:20`, the hardcoded `percentageCharge: 94` at `api/paystack/subaccount/route.ts:53`, and `packages/shared/src/__tests__/commission/commission.test.ts:25` — and **all six stay at 6%.** Changing them would move no money (there is no subaccount, no split code and no commission record in production) and a Paystack split's share is fixed at creation, so a future rate change means recreating splits anyway. **The one-line fix is on the other side: the 5% public claim is removed from `apps/web/src/app/(public)/pricing/page.tsx` at `:7` (the metadata description), `:159` (the intro paragraph) and `:413-494` (section C, "Marketplace commission")** — verified present at all three — for a module that now ships off by default.

⚠ **The stated consequence for the Paystack KYC pack, which live-mode cutover is blocked on.** The pack declares a **5%** platform fee to Paystack (`SPEC DOCS/paystack/01-kyc-response-pack.md:102,104`; `00-master-spec.md:44-45`, confirmed 2026-05-25). With the public claim deleted and every code constant left at 6%, that declaration matches nothing in the product. **The pack is re-stated at 6% before submission** — it is the one place the figure still has to be declared to a third party, and it must match the constant rather than deleted marketing copy. It is not otherwise re-scoped; the parked-marketplace description it carries stands. **§11.7 owns the live-mode cutover around it** — the parked storefront, the untouched subaccount tables and the sequencing of live keys, plan codes, webhook URL and the real-card smoke test — and its earlier instruction to submit the pack "as it stands" is amended to this position, so the two sections give one instruction on the one artefact that leaves the practice.
*Audience: WM PMs and contractors; suppliers as recipients, not users. Depends on: Q4.1, Q4.2.*

#### Q4.5 — Monthly client report · M 2.0
1st of month, **07:00 SAST (`0 5 1 * *`)**. Cover and executive summary; tenant-schedule status by shop; procurement and long-lead exposure; compliance register (CoCs issued versus DBs energised); commercial sections **only when the recipient is cost-cleared**, reading `valuations` only — variations are cut, so `variation_orders` is not a source this year; risks and instructions issued; photo plate. It gains the programme-variance section as a **Q4 addendum with the report kind unchanged**, so no supersede chain breaks and no client sees a renamed document.
*Audience: clients/developers. Depends on: Q3.1, Q3.5, Q4.1, Q4.2.*

#### Q4.6 — Narrative drafting and human review · M 2.0
**This is the first place a model writes prose that leaves the practice under WM's name.** It is not the first model call of the year — voice-to-form and the chase sentence both ship in Q3 — and the distinction is the point: prose signed by WM is the output that needs a review loop, and none of the others do.

The model composes around figures rendered by the template and never computes one. A numeral post-check tokenises the draft and matches every digit string against a whitelist built from the payload's numeric fields **and their rendered variants** — thousands-separated, ZAR-prefixed, percentage, ISO and long-form dates — regenerating once, then dropping the narrative and issuing the numbers. Every narrative string passes `winAnsiSafe` (`apps/web/src/lib/pdf/winansi.ts`) with `collapseWhitespace: false` before reaching a `<Text>`, and the model is instructed to spell "ohm" and "less than or equal to" in words, because `@react-pdf/renderer` draws the wrong glyph and never throws.

**House style is `ai.org_profile` (§10.7) — `tone_json`, `standard_wording` and the sign-off block — read, not duplicated.** A `report_narrative_profile jsonb` column on `public.organisations` is **not created** (A(f)): it would be a second home for the same fact and could not serve §10.2, which needs the chase agent's thresholds out of the same profile row. The profile ships in Q3 with the `ai` schema, one quarter before the narrative needs it, so the chase agent has already been reading its thresholds and WM has had a quarter of ordinary use to get its own wording right. Editing it is `/settings` under `OWNER_ADMIN` via `requireRolePage`.

Two rules ship as tests, not documentation: **an empty period is reported as empty** (the model is tested against smoothing — "steady progress continued" is banned by name), and **an unreviewed narrative is omitted at send time rather than delaying the numbers**, with a line saying the commentary was not reviewed. The numbers are the obligation; the prose is not.

**Measurement:** Levenshtein distance between draft and issued narrative, computed over the **narrative block only**, logged per report in `ai.runs.edit_distance`. **Pass is a median below 30%; the kill condition is above 50% sustained over four weeks**, at which point the feature drops to numbers-only at no schedule cost.
*Audience: all three. Depends on: Q3.3, Q3.6's `ai` schema, Q4.5.*

#### Q4.7 — Commercial activation: valuations only · M 1.5
`projects.valuations` (`00132`) is built, trigger-numbered and RLS'd — and holds one row. This is unactivated work, not new work. Q4 gives it a reason to be opened: **a valuation becomes a work item with a due date and the certifier in ball-in-court** (A(b) registers `valuation` in Q4, due at valuation date + 5 working days on the office calendar), and it renders through the Q3.1 registry with cost redaction by audience — `access.read` is `COST_VIEW_ROLES` (A(d)).

**Variations and commercial remeasure are cut.** `projects.variation_orders` / `variation_lines` (`00135`) and `projects.boq_items` (`00122`) hold zero variation orders and stay unactivated; A(b) accordingly does not register a `variation_order` work-item type, and `variation_orders` is not a report source this year. The correction that made the original scope look cheaper than it was stands and is worth keeping on the record: **there is no existing remeasure link to fix.** The only remeasure path in the codebase is `requestRemeasureAction` (`apps/web/src/actions/cable-discrepancy.actions.ts:107-140`), which nulls `confirmed_length_m` / `_by` / `_at` / `_method` and flips `length_status` back to `MEASURED`/`UNMEASURED` so the site team re-walks the route — a *physical measurement* request on a DRAFT revision, gated by cable-schedule roles, with no connection to BOQ quantities (`projects.boq_items.origin` is CHECK'd to `contract|variation` only, `00135_project_variations.sql:94-96`). Feeding a cable-length correction into a commercial remeasure needs a third `origin` value and a derivation nobody has specified.
*Audience: WM PMs and cost-cleared clients. Depends on: Q3.1, Q4.1 — activation, gates and reports only; no new commercial maths.*

#### Q4.8 — Portfolio view and the response-time metrics · M 1.5
The admin dashboard already runs ten parallel org-wide queries (`apps/web/src/app/(admin)/dashboard/page.tsx:33`) and an SLA strip for aging snags, stale RFIs and stale inspection drafts (`:206`; `packages/shared/src/services/sla.service.ts:22`). Q4 turns it into a portfolio: one row per project with ball-in-court counts by party, overdue by organisation, milestone slippage and a health score.

**The per-person and per-organisation response-time metrics are merged into this line rather than carried separately** — they are the same query shape over the same spine, and splitting them would have priced one join twice. Overdue rate per person, and median working days from `answered` to `closed` — the gatekeeper leg, invisible today because `projects.rfis` carries `closed_at` / `closed_by` but nothing between (§15). Both read `projects.work_item_events` on the office calendar (A(h)).

**Decision: project health is a new computation, not a reuse of `calculate-health-scores`**, which scores *organisations* for churn on login recency and compliance activity (`apps/edge-functions/supabase/functions/calculate-health-scores/index.ts:25-30`, running daily at 02:00 SAST, `:17`) — a SaaS retention metric, not a project one. `/settings/health` keeps that org churn score unchanged and is not replaced (A(e)).
*Audience: WM directors and PMs. Depends on: Q1 work items, Q4.1.*

#### Q4.10 — Published pricing cutover · M 1.0
This is the **cutover** of §11.7's model, not a new pricing decision. The published prices are §11.7's four bands, verbatim:

| Package | Tier string | Active projects | Monthly (ZAR, incl. 15% VAT) | Annual |
|---|---|---|---|---|
| **Free** | `free` | 1 | **R 0** | — |
| **Practice Solo** | `practice_solo` | up to 3 | **R 2 450** | R 24 500 |
| **Practice** | `practice` | up to 12 | **R 6 900** | R 69 000 |
| **Practice Unlimited** | `practice_unlimited` | unlimited | **R 12 900** | R 129 000 |
| **Archived project** | — | n/a | R 0 | Read, export, guest links, reports |
| **Every external participant** | — | n/a | R 0 | Contractors, watchers, guests, email-only |

Annual is ten months paid for twelve. Every package includes every core module and unlimited participants of every kind. **There is no per-project package**: `billing.subscriptions` is `UNIQUE (organisation_id)` (`00007_billing_schema.sql:29`) with one fixed `amount_kobo` (`:23`) and Paystack Plans carry no quantity dimension, so a monthly figure varying with project count cannot be billed by the existing subscription flow at all. Banding buys the same "price the network" property for one migration; **bands are evaluated only at renewal, never mid-cycle.** An active project is one with a row in §11.7's named allow-list of user-authored tables in the last 30 days, stamped nightly onto `projects.projects.last_active_at` — the invoice cites one column and one figure, which is the only version of this rule that survives a customer disputing it.

The cutover is technical work, not a page edit:

1. `checkProjectQuota` (`apps/web/src/actions/project.actions.ts:44-76`) re-pointed from `status <> 'cancelled'` to **active** projects, and `limits.users` **deleted** from `PLANS` rather than implemented — it is declared and read nowhere in the monorepo, and implementing it would contradict the model.
2. A migration widening the `00007:14` tier CHECK to `('free','practice_solo','practice','practice_unlimited')` after re-labelling the two live rows, and `grandfathered_rate_zar` / `grandfathered_until` on `billing.subscriptions`. The WM platform-owner row is re-labelled `practice_unlimited`, has all three `paystack_*` columns NULLed and `amount_kobo` zeroed — **not cosmetic**: `00133`'s header asserts those columns stay NULL, a real checkout populated `paystack_customer_code` afterwards, and the `charge.failed` handler matches on exactly that column (`paystack-webhook/index.ts:337-340`) before starting dunning. Any customer row moves to its band **at its current effective monthly rate, held twelve months**, shown as a line on the billing page rather than a silent re-price.
3. The four unlock pages — `(admin)/inspections/unlock`, `projects/[id]/jbcc/unlock`, `projects/[id]/generator-cost-recovery/unlock`, `projects/[id]/medium-voltage/[revisionId]/mv-unlock` — redirect to project settings; `FEATURE_PRICES` (`packages/shared/src/services/billing.service.ts:67-88`) stops being purchasable while `billing.org_feature_unlocks` and `billing.org_feature_seats` rows are honoured in perpetuity. MV's disclaimer gate survives the paywall's death and stops being bypassable: `user_has_mv_access` tests only `disclaimer_accepted_at`, because acceptance is a liability control, not a payment check.
4. `/pricing` republished with the four bands, replacing **Free / Starter R499 / Professional R1 499 / Enterprise** (`(public)/pricing/page.tsx:41`, `:58` — verified; the page labels the third tier "Pro" and prices it R 1 499, and `professional` is its `billing.subscriptions` tier string). The 5% commission copy at `:7`, `:159` and `:413-494` goes with it, per Q4.3. **No commission constant changes.**

*Audience: the buyer. Depends on: nothing in Q3 or Q4; blocks nothing.*

#### Q4 · lines carried in from Q2 and Q3

**Auto-location on capture · M 1.0** (§09(e), moved from Q2). `gps_lat` / `gps_lng` already exist on inspection and site-form photos (`00066`, `00179`) and already render into the PDF caption band (`apps/web/src/lib/reports/inspection-report-data.ts:314-316`), yet nothing under `apps/web/src` has ever called `navigator.geolocation`. Place columns go onto `field.snags`, `field.snag_photos`, `projects.qc_entry_photos` and `field.form_photos` behind a **`NOT VALID` place CHECK** — the Postgres idiom that exempts existing rows while enforcing every insert and update from the moment it lands, and it is never validated. `place_label TEXT` is the fallback disjunct written at capture time, and it is load-bearing rather than decorative: `ON DELETE SET NULL` fires an UPDATE that must satisfy the table's CHECKs, so without a text fallback, deleting a board whose only recorded place was that node would raise a check violation and **block the delete** — and `hardDeleteTenantAction` (`apps/web/src/actions/tenant-delete.actions.ts:1-12`) hard-deletes tenant boards today. Resolution runs best-first, because GPS is nearly useless where the work is: QR scan (0 taps) → sticky node used in the last 20 minutes (1 tap) → plan pin (2) → node picker on `code` and `shop_name` (2–3) → GPS, captured silently in parallel and stored alongside whichever won. `projects.site_diary_entries` is deliberately outside the CHECK — a diary entry is a day on a project, not a point in a building — and takes `gps_lat` / `gps_lng` / `gps_accuracy_m` as optional corroboration only.

**QR board labels · S 0.5** (§09(f), moved from Q2). The Avery L7173 sheet renderer (`apps/web/src/lib/cable-schedule/export-avery-labels.ts:14-50`) is generalised to a per-project sheet of `structure.nodes`, each label carrying the board `code`, tenant name and a QR to `/site/board/[nodeId]` in the `(scan)` group — a sibling of the existing tag resolver, reusing its auth-preserving `?next=` round-trip (`(scan)/site/tag/[text]/page.tsx:51`). The page opens with the board's identity then three gloved-thumb targets — **New snag here · Add photo here · Open board** — above its open snags, forms, inspections (`NodeInspectionsPanel` already mounts on the tag page, `:260`) and legend card. Anything captured from here is `place_source='qr'`. `export-pdf.ts:1216` is fixed and `qr.service.ts` deleted. **The label encodes the node id, so no token column and no migration attach to this line.**

**GCR backfill and cable-pack registration · S 0.5** (§07 §5.7, moved from Q3). `gcr.report_revisions` (`00127`) is backfilled into `projects.reports` as kind `generator` with `note` / `summary` (present since `00183:43-45`), the forked table retained read-only for one quarter and then dropped — a destructive step, so it takes the A(f) pre-migration snapshot into `backup_<version>_report_revisions` in the same transaction, retained 90 days, restore statement in the migration header. The cable revision pack registers as kind `cable_schedule`, keeping its pdf-lib renderer and its streamed download while now also filing a version; the role-based redaction already in `export-role.ts:39-68` becomes the spec's `access` block. Read policies are A(d)'s: `generator` → `COST_VIEW_ROLES` (it is a cost-recovery apportionment), `cable_schedule` → project access with cost columns redacted in the projection.

**QC/RFI back-fill and renderer repoint · M 1.0** (moved from Q3 by the re-plan above — the one line Q3 shed to absorb the register surface, and moved rather than cut so the year's committed total, and therefore §15's cost-per-engineer-week divisor, does not change). `projects.qc_comments` (`00172:161`) is back-filled into `threads`/`thread_messages` with `subject_type='qc_entry'`; new comments write **only** to `thread_messages`; the table is retained read-only until `qc-report-data.ts:210,221` and `qc.service.ts:290` are repointed, then dropped with the Appendix A(f) pre-migration snapshot. `projects.rfi_responses` is **retained as the system of record** — Primitive 1 flips ball-in-court to `answered` on a row landing there, and repointing that trigger at a free-text table would make any comment answer an RFI — so this line back-fills only the 5 existing production responses into the thread view. **The cost of the move is stated rather than hidden:** Q3.2's registry port already opens `qc-report-data.ts` in Q3, so the file is now opened twice across two quarters instead of once, which is exactly the saving the Q3 placement bought. It is the cheapest line in either quarter to move, because nothing depends on it and the QC comments simply stay where they are until this lands. Appendix A(f) books the `qc_comments` drop under **Q4** with this deliverable, and prints "Drops: none" for Q3.

**Project export · S 0.25** (§07 §5.4). Kind `project_export`, gated `ORG_WRITE_ROLES`: every `status='issued'` report plus the RFI, snag, QC, instruction, procurement and tenant registers as CSV, in one ZIP with a manifest. It is what §11.7's Archived band sells — a project that has left support must still be openable. It breaks the same two assumptions in the saved-report path that the cut CoC/form ZIP pack would have, and both are fixed here: the pack sets `mime_type = 'application/zip'` (the column defaults to `application/pdf`, `00117:53`), and `downloadFileName()` derives its extension from `mime_type` instead of hard-coding `.pdf` (`project-reports.actions.ts:86-88`).

**Monitoring · S 0.25.** As Q3.

#### Q4 migrations

Ordinals, not numbers, and **ordinals 1–4 are §08's ordering unchanged**. That ordering is load-bearing: ordinal 4 must be last because the view references every column ordinals 2 and 3 add plus the Q1 work-items spine, and `resolve_ball_in_court` must exist before the view that declares a column over it.

| Ordinal | Contents |
|---|---|
| 1 | `projects.calendar_entries` + `projects.milestones` + RLS + the four-milestone backfill per existing project; `profiles.ics_token_hash`; **drop `field.inspection_milestones`** after asserting `count(*) = 0` in the same transaction, migrating any rows found into `projects.milestones` first, with the A(f) pre-migration snapshot |
| 2 | `structure.tenant_details.bo_confirmed_on`; `structure.tenant_document_revisions.approved_on` / `approved_by`; `structure.tenant_documents.kind` CHECK re-declared wholesale with `occupation_cert`; write policies for all three |
| 3 | `structure.scope_item_types.lead_time_days` / `install_days` **with the `db` 60/5 and `lighting` 30/3 seeds in the same statement**; `projects.project_settings.equipment_lead_time_days` / `equipment_install_days` |
| 4 | `projects.resolve_ball_in_court()`; `projects.dated_items` (last) with `security_invoker = true, security_barrier = true`; the `REVOKE`s and grants; the two `public.notification_types` inserts (`order_late`, `milestone_due`) |
| 5 | `projects.project_health_snapshots` |
| 6 | Place columns on `field.snags`, `field.snag_photos`, `projects.qc_entry_photos`, `field.form_photos` with the **`NOT VALID`** place CHECK; `gps_lat` / `gps_lng` / `gps_accuracy_m` on `projects.site_diary_entries` |
| 7 | `billing.subscriptions`: `grandfathered_rate_zar`, `grandfathered_until`; the `00007:14` tier CHECK widened to the four bands after the two live rows are re-labelled. **No commission default is touched** |
| 8 | **Drop `gcr.report_revisions`** at the end of its read-only quarter, with the A(f) pre-migration snapshot in the same transaction |
| 9 | QC-comment and RFI-response back-fill into `threads` / `thread_messages`; **drop `projects.qc_comments`** after the renderer repoint, with the A(f) pre-migration snapshot in the same transaction. **Arrived from Q3 with its deliverable and depends on nothing in ordinals 1–8**, so it may be claimed and applied first; it is numbered last only because it is the line that moved |

The `dated_items` view is `security_invoker` deliberately: a Postgres view is security-*definer* by default and would run as its owner, bypassing every base-table policy, and `00025_grant_schema_permissions.sql:20,26` grants `anon` SELECT on new `projects` tables automatically — the same shape as the anon-grant incidents that forced `00168`'s revokes.

#### Q4 exit criteria

*Targets are §15 §(a)'s; this table restates them and does not set them.*

| Metric | Target | Baseline |
|---|---|---|
| Active projects with a populated milestone set | 100% | no milestone model |
| Retail projects with a tenant tracker in use | 100% | spreadsheets |
| Open order lines carrying a required-by date derived from lead time | ≥ 80% | required-by = BO date, no lead time anywhere |
| Valuations certified through E-Site | ≥ 1 per active project per month, and **zero valuations assembled in Excel in September** | 1 valuation ever |
| Diary entries and snags created in September carrying a voice-captured field or GPS | ≥ 40% of diary entries, ≥ 25% of snags | 0 — moved here from Q2 with voice (Q3.9) and auto-location |
| Weekly active users (§15 metric 1) | **≥ 65% of the frozen September-2026 cohort** (N ≤ 35, `public.metric_accounts`) | 3 / N, N ≤ 35 — published as 3 of 36 accounts only for continuity with the production evidence |
| Contractor accounts active weekly (§15 metric 2b, all contractor accounts) | ≥ 60% | 0 of 13 in 30 days |
| Diary entries logged same day (§15 metric 3) | **≥ 85%** | 2-day median lag |
| Inbox engagement (§15 metric 5, the union over both halves of the Inbox) | **≥ 70% overall and ≥ 85% on the Immediate tier** | unmeasurable before the release; `is_read` on 57 of 964 is the pathology, not the baseline |
| Activation (§15 metric 7): **any** work item moved to `closed` in the first session, session boundary from `public.user_sessions` with no 30-minute gap | ≥ 60% of new users | no activation event exists |
| Narrative edit distance, draft → issued (Levenshtein, narrative block only) | median < 30%; kill above 50% sustained four weeks | no narrative |
| **Four bands live, unlock pages redirecting, the commission constant unchanged at 6% and no 5% claim on any public page** | Yes | 4 tiers advertised (Free / Starter R499 / Professional R1 499 / Enterprise), 3 unlocks sold, code at 6% and `/pricing` claiming 5% |

#### Q4 risks

*The quarter is 19.5 against 20.2, with 0.7 weeks of float on the total and 2.6 on the chain* — the cut order is commercial activation, then the portfolio view, then the GCR and cable registrations, decided in the first week of September; none of the three is on the chain Q4.1 → Q4.2 → Q4.5 → Q4.6, so each buys back total and none buys back path. *Milestones are entered once and rot* — the chase ladder treats a milestone as an item with an owner, and one without an owner cannot be created. *The derived delivery stage disagrees with what a PM believes* — every stage names the evidence row it was derived from, and a stage with no evidence renders as "not evidenced" rather than as a default. *The landlord tracker leaks an order note* — the projection is an explicit column allow-list behind `requirePortalAccess`, not RLS, because `00166` proved RLS cannot serve this read at all; the test asserts the projection's column set. *The pricing cutover loses revenue before it gains it* — unlock revenue is immaterial against a R110 000 per month engineering cost, but the count is not in the September measurement: **read the row counts of `billing.org_feature_unlocks` and `billing.org_feature_seats` the same way the rest of the evidence was measured, before the cutover**, and honour every existing row in perpetuity regardless of what the count says. *The KYC pack is submitted still claiming 5%* — it is re-stated at 6% before submission, per Q4.3 and §11.7 as amended to match it, and the six code sites are the reference, not the deleted page copy. *Ordinal 4 is applied before ordinals 2 and 3* — the view references their columns and will fail to create, which is the intended failure; the guard is one nominated owner and reading each object back after apply.

---

### What deliberately slips past twelve months

Every line below is a decision with a reason, not a backlog. **Each cut item is retained in its designing section behind a banner**, so the following programme inherits the design rather than re-deriving it.

| Deferred | Why |
|---|---|
| **Native app-store publication** | The Expo app is 2.0.0, never published, with zero push tokens in production. A PWA with web push, camera capture and installability reaches the same phones with one codebase and no review queue. Revisit when weekly contractor actives exceed 60% and offline capture is the binding constraint. |
| **Meeting minutes** (§06 §4.6) | The one primitive with no production precursor at all; `meeting_minutes` is not a registered report kind and `work_items.meeting_item_id` comes out of the Q2 migration with it. Q2's theme is one conversation per project, and threads plus the instruction register carry it without a minute-taking surface. |
| **The offline write queue and the three `/api/capture/v1/*` routes** (§09(a)) | 1.5 weeks across Q1 and Q2 for a queue nobody can exercise until contractors open the app daily — which is what Q1 and Q2 are for. §09 itself ranks it first in the capture cut order. |
| **`<PhotoMarkup>` and the first `markup` writer** (§09(g)) | 1.5 weeks, second in §09's own cut order, and a photo with an arrow on it is not why a snag gets closed. |
| **The public safety-observation board** (§09(f)) | 1.0 week and a new unauthenticated write surface — `/observe/[token]`, `PUBLIC_PATHS`, a triage queue and a `CONFORMANCE.md` row — third in §09's cut order. `PUBLIC_PATHS` is not amended and `/observe/[token]` is not created (A(g)). |
| **Photo pre-classification** (§10.6) | Cut with the AI re-plan; no photograph leaves the platform inside the twelve months as a result, which simplifies the POPIA position rather than complicating it. |
| **Site-forms v1.2 and device-bound signing** (the former Q3.8) | §14's own first cut, and its own reasoning is why: the expensive part is not the code, it is getting every registered person onto an account and using it at the board — thirteen contractor accounts with zero sign-ins in thirty days. The programme is only now achieving that. v1.1's 121 required answers stand; `field.form_signatures` keeps its free-text `signatory_name` for another year. |
| **The daily site report** | Redundant with a Q1 deliverable: the 07:00 recap's section 4 already names contractors with no diary entry, every day, six days a week. `daily_site` is not a registered kind (A(d)). |
| **Email-to-item** | Cut outright in the Q2 re-plan. `inbound-email` and `field.inbound_messages` still ship in Q2 for reply-by-email; creating a `task` from an arbitrary inbound message is what is deferred. |
| **Cited structured answers** (§10.4, the former Q4.11) | Cut, not conditional. 2.5 weeks against 0.7 of float on the total cannot be earned by being ahead, and a conditional line in a published plan is a line nobody staffs. §10.4's spec — six read-only parameter-typed `ai.q_*` functions running as the asking user, citation chips, zero-citation answers not rendered, a 100-question eval set — is unchanged for whoever builds it. |
| **The post-handover asset register** (the former Q4.9) | §14's own first cut for Q4, and the only line in the twelve months that earns after practical completion — which is exactly why a quarter's delay costs nothing this year. Per-DB test history and `structure.node_test_schedule` go with it; the board QR page still ships (Q4), so a printed label already opens the board's legend, orders, snags, forms and open work items. |
| **The remaining item-for-item packs: instruction, GRN, CoC/form ZIP and transmittal** (the former Q4.4) | Projections of registers the programme builds anyway, so each is cheap whenever it is wanted, and none is why anyone opens the app. The ZIP pack's two real fixes — `mime_type = 'application/zip'` and an extension derived from `mime_type` — ship inside `project_export` regardless. |
| **Variations and commercial remeasure** (half of the former Q4.7) | Zero variation orders in production; A(b) does not register a `variation_order` work-item type and `variation_orders` is not a report source this year. Q4.7 activates valuations only. |
| **Cable-length-fed commercial remeasure** | `requestRemeasureAction` (`cable-discrepancy.actions.ts:107`) is a physical re-measurement request with no BOQ link, and `boq_items.origin` admits only `contract` and `variation`. Deriving a commercial remeasure from `cables.confirmed_length_m` needs a third origin value and a derivation nobody has specified. Named, not smuggled into Q4.7. |
| **The procurement catalogue link** | `marketplace.catalogue_items` remains the right table, but no SA wholesaler publishes a price file, the fallback was always org-maintained catalogues, and a missing catalogue is not what makes an order line late. Lead times are, and those ship in Q4.3. |
| **Search** | Excluded by decision rather than deferred. The Inbox, the registers and the calendar are the retrieval surfaces; a search box is what a product builds when it cannot say where anything lives. |
| **Drawing-sheet circuit extraction, and the per-circuit prefill that depends on it** | Specified in §10.8 and deliberately **uncommitted** in both quarters — the one line here that is not a cut. A wrong breaker rating on a legend card is a safety artefact, so it is a WM-only pilot until ≥ 40 real SA drawing sheets score above 0.95 per field on breaker rating and circuit number. Per-circuit prefill from `structure.node_circuits` is worthless until extraction populates it — 12 rows database-wide, every descriptive column null. |
| **Computer vision and 360 progress capture** | Buildots and OpenSpace need a BIM model, a maintained schedule and disciplined 360 walks; OpenSpace pays architects to verify its own output. No SA retail fit-out has those inputs, and fourteen projects cannot validate anything. If a client asks, integrate OpenSpace or DroneDeploy; do not build. |
| **Candy-class programme and cost engine** | Critical path, logic links, levelling, baselines and earned value are a full quarter that loses to RIB Candy on its own ground. WM is the electrical consultant: it owns commitments against the programme, not the programme. |
| **Full field-service dispatch** | Dispatch boards, technician certifications, timesheets, van stock, price books and payment-on-site are ServiceTitan's product at $245–500 per technician per month. WM does not dispatch technicians; its contractors are companies, not crews on its payroll. |
| **Predictive schedule risk from history** | Needs hundreds of completed projects; E-Site has fourteen, five of them real. The honest version is the chase ladder — not "this will slip" but "this is late and here is who owes it". |
| **Document RAG over drawings and specs** | Deferred behind structured answers, not rejected. Structured answers are more accurate, cheaper and citable by construction; document Q&A earns its place once the Q2 drawing register has a year of transmittals in it. |
| **Marketplace as a storefront** | Removed from navigation, tables and the seven supplier pages untouched so the two April orders stay auditable, and **every commission constant left at 6%**. Its catalogue link is cut with Q4.3; its checkout is not revived. |
