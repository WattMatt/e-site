## Primitive 5 — the report engine

WM's product is not the app. It is the document that leaves the app with the practice's name on it. E-Site can already render nine of those documents, and every one of them was built again from scratch. This primitive collapses them into one contract, adds the periodic and register packs the practice currently writes in Word and Excel, and makes issuing them a scheduled job rather than an act of will.

*(All citations are to `origin/main` @ `70ac208`, migrations applied to `00184`.)*

**Appendix A(d) is the register of report kinds and their read policies.** This section does not re-list them: it states the contract behind them, the content of each document, and the mechanism that files and distributes them. Where a kind is named below, its quarter and its read policy are A(d)'s. New tables are inventoried in A(f), routes in A(g), notification types in A(c), and the AI vendor position in A(i).

### 5.1 What exists, and what the duplication costs

| Kind | Gatherer | Renderer | Engine | Branding | Filed by | Bucket |
|---|---|---|---|---|---|---|
| `inspection` | `inspection-report-data.ts` | `render-inspection.ts:11` | react-pdf | yes | `file-inspection-report.ts:76-133` | `reports` |
| `snag` | `snag-visit-report-data.ts` | `snag-visit-report.tsx` | react-pdf | yes | `snag-visit.actions.ts:475-543` | `reports` |
| `qc` | `qc-report-data.ts` | `qc-report.tsx` | react-pdf | yes | `qc.actions.ts:787-831` | **`qc-reports`** |
| `tenant_schedule` | `tenant-schedule-report-data.ts` | `render-tenant-schedule.ts:9` | react-pdf | yes | `api/projects/[id]/tenant-schedule/reports/route.ts:53-93` | `reports` |
| `equipment_materials` | `equipment-materials-report-data.ts` | `equipment-materials-report.tsx` via `render-equipment-materials.ts:9` | react-pdf | yes | `api/projects/[id]/equipment-materials/reports/route.ts:80-133` | `reports` |
| `valuation` | `valuation-report-data.ts` | `render-valuation.ts:11` | react-pdf | **no branding arg** | `valuation.actions.ts:583-635` | `reports` |
| `site_form` | `site-form-report-data.ts` | `render-site-form.ts:13` | react-pdf | **no branding arg** | `file-site-form-report.ts:78-133` | `reports` |
| GCR generator report | `generator-report-data.ts` | `render-generator.ts:14` | react-pdf | yes | **forked table** `gcr.report_revisions` (`00127`) | `reports` |
| Cable revision pack | `export-payload.ts` | `export-pdf.ts` (1 318 lines) | pdf-lib | own cover | **not saved at all** — streamed as an attachment | — |

Seven of those nine are live filers into `projects.reports`. The other two are the exceptions the port has to absorb: GCR forked its own revision table in `00127`, and the cable pack files nothing at all.

9 609 non-test lines sit under `lib/reports/` (15 383 with tests), plus the pdf-lib exporters under `lib/cable-schedule/`. The shared layer is good and under-used: `resolveBranding` (`branding.ts:48`), the tokens in `theme.ts`, `Cover` (`components.tsx:147`) and `RunningHeader`/`RunningFooter`/`Section`/`Table`/`PhotoGrid`/`SignatureBlock` (`interior.tsx:344-607`). Two renderers bypass it — `render-valuation.ts:11-13` and `render-site-form.ts:13` take no `ResolvedBranding` argument at all — so a payment certificate and a SANS 10142-1 site form carry neither the practice's accent nor the client logo every other document carries.

The filing step is copied seven times and it is **not** identical in shape. Three differences matter and two of them are deliberate:

| Difference | Where | Why it matters |
|---|---|---|
| **Version race** | every filer reads `max(version) WHERE status='issued'`, uploads, inserts, *then* supersedes | Two concurrent issues both read *n* and both write *n+1*. The code admits it and names the missing partial unique index as the durable fix (`snag-visit.actions.ts:527`) |
| **Issue guard** | QC alone supersedes only *after* a separate `qc_reports.status` flip commits — "a race-aborted issue never supersedes the live prior version" (`qc.actions.ts:816-818`), rolling back both blob and row on a lost race (`:799-814`) | A harness that flattens the seven loses this guard silently |
| **Keying** | `inspection`, `snag`, `qc`, `valuation`, `site_form` version on `(source_table, source_id)`; `tenant_schedule` and `equipment_materials` version on `(project_id, kind)` (`route.ts:53-55`, `route.ts:80-85`) | One index must cover both schemes or a second index appears |
| **Bucket** | `bucketForKind()` routes `qc` to `qc-reports`, everything else to `reports` (`project-reports.actions.ts:90-93`); the bucket and its eight storage policies were created in `00172:517-551` | A harness that hard-codes `reports/` relocates every QC PDF and orphans the existing ones |

Authorisation is not uniform either. The tenant-schedule route deliberately has no role gate (`route.ts:20-25`: "Authorization is VIEW-level by design"), while `equipment_materials` gates `ORG_WRITE_ROLES` through `requireEffectiveRole` inside its gatherer (`equipment-materials-report-data.ts:72-73`) and `deleteProjectReportAction` gates `ORG_WRITE_ROLES` through org-scoped `requireRole` (`project-reports.actions.ts:210`). Reads are gated per kind by `readRolesForKind` in the app (`project-reports.actions.ts:121-125`, `:180-184`) and by a RESTRICTIVE `reports_kind_read_gate` policy in the database (`00183:111-115`) — the two hand-maintained lists that A(d) replaces. `projects.reports.kind` carries no CHECK constraint — verified against production and recorded at `file-site-form-report.ts:13-14` — so the only thing stopping an unregistered kind is `report-kind-access.contract.test.ts`.

### 5.2 The contract

**Decision: one `ReportSpec` registry; the PDF engine is an implementation detail behind it.** Rewriting the 1 318-line pdf-lib cable pack in react-pdf buys nothing this year, so the contract binds the other stages and leaves `render()` free.

```ts
type SafeText = string & { readonly __winAnsi: unique symbol }
type RecipientTable = 'instruction_recipients' | 'transmittal_recipients'

interface ReportSpec<TParams, TData> {
  kind: ReportKind                 // registry key; also the projects.reports.kind value. The set is Appendix A(d)
  engine: 'react-pdf' | 'pdf-lib'  // decides which sanitiser the draw layer uses
  bucket: string                   // default 'reports'; 'qc-reports' for kind 'qc'
  title(data: TData): string
  gather(ctx: ReportCtx, p: TParams): Promise<TData>   // service client, testable
  render(data: TData, b: ResolvedBranding): Promise<Buffer>
  source?: (p: TParams) => { table: string; id: string } // per-entity kinds only
  period?: 'day' | 'week' | 'month'                      // periodic kinds only
  issueGuard?: (ctx: ReportCtx, p: TParams) => Promise<{ ok: true } | { error: string }>
  access: {
    generate: OrgRole[]
    read: OrgRole[] | { roles: OrgRole[]; recipient_lookup: RecipientTable }
    distribute: OrgRole[]
  }
  costBearing: boolean            // drives redaction + narrative input filtering
}
```

`access.read` admits two forms because §06 requires one that a role array cannot express: an instruction or a transmittal must be readable by the person it was issued to, who is frequently a contractor holding none of the roles that may *generate* it. The object form is a **disjunction, never a narrowing** — the read passes when the caller holds one of `roles` **or** appears as a recipient row for that report's `source_id` in the named table. Both halves are enforced twice, in the app resolver and in the RESTRICTIVE database policy, because a server action and an `app/api` route are directly invocable and page-level gating is not a gate. Only `instruction` and `transmittal` use the object form (A(d)); `period` retains `'day'` in its union, but no kind sets it this year — the daily report is cut (§5.3).

Seven obligations, enforced once:

**1. Gather.** Visibility gate on the cookie client, then service-client reads — the pattern `qc-report-data.ts` and `equipment-materials-report-data.ts:72-73` already document. Images resolve to `data:` URIs inside the gatherer; a signed URL never reaches a renderer.

**2. Branding.** `resolveBranding` is called by the harness, not the spec, so no renderer can opt out. `valuation` and `site_form` gain the branded cover and running chrome with no change to their bodies.

**3. Pagination.** The rule `qc-report.tsx:513-525` learned the hard way becomes the house rule and a lint check: `wrap={false}` only on blocks with a bounded height (a header row, one photo cell), with `minPresenceAhead` reserving room so a title is never orphaned; anything carrying operator-typed text must be breakable. pdf-lib specs keep their hand-rolled height accumulator.

**4. Text safety — branded at the render tree, never at the payload.**

*Decision: the sanitisation boundary is the single point where a string becomes drawable, not the `gather()` output.* A harness that walked the whole payload after `gather()` would break two things the shipped fix depends on. First, `toWinAnsiSafeOptional` exists precisely to preserve the nullish/empty distinction — "the document distinguishes 'no value' (rendered as a muted em dash) from an empty string, so a sanitiser that folded `null` into `''` would quietly restyle rows" (`winansi-text.ts:76-88`). Second, the sanitiser *rewrites values*, not merely punctuation: `'✓' → 'Yes'`, `'✗' → 'No'`, `'⚠' → '!'`, `'≠' → '!='`, `'μ' → 'µ'` (`winansi-text.ts:44-59`). Walking the payload would rewrite inspection answer tokens, site-form enum values such as `made_safe_de_energised`, entity ids used as React keys, and the very strings §5.6 hands the narrative model as inputs.

The mechanism is two first-party primitives plus a lint rule — TypeScript cannot make a third-party `<Text>` (typed `ReactNode`) or pdf-lib's `drawText` reject anything, so the guarantee is a build failure, not a type error:

| Layer | Primitive | Calls | Enforcement |
|---|---|---|---|
| react-pdf | `<T>` in `lib/reports/safe-text.tsx` — accepts `children: string` | `toWinAnsiSafe` (`winansi-text.ts:70`) | eslint `no-restricted-imports`: importing `Text` from `@react-pdf/renderer` is an error outside `safe-text.tsx` |
| react-pdf, nullable | `<TOptional>` — accepts `string \| null \| undefined`, renders the muted em dash when nullish | `toWinAnsiSafeOptional` (`winansi-text.ts:84`) | same rule; makes the null/empty decision once instead of at the 36 call sites `site-form-report.tsx` carries today |
| pdf-lib | `drawTextSafe` + `widthOf`, extracted from `export-pdf.ts:29-38` into `lib/pdf/draw-safe.ts` | `winAnsiSafe(text, { collapseWhitespace: true })` | eslint `no-restricted-syntax` on `.drawText(` outside `draw-safe.ts` |

Both helpers return `SafeText`, and `SafeText` is the parameter type on those two signatures only. The rule has live work to do: `export-tag-list-pdf.ts:27,41,48`, `export-avery-labels.ts:21,35` and `export-watermark.ts:55` all call `page.drawText` directly today, three of them on raw literals. This closes the class that printed `≤ 0,2 Ω` as `d 0,2 ©` on a legal compliance document with no error anywhere (`winansi-text.ts:10-20`), and it removes the per-call-site discipline that failed twice.

**5. File — one object name, one transaction.**

*Decision: name the object by report id, not by version.* Today every filer embeds the allocated version in the path (`${orgId}/${projectId}/snag-visit-${visitId}-v${newVersion}.pdf`, `snag-visit.actions.ts:485`) with `upsert: false`, and `projects.reports.storage_path` is `NOT NULL` (`00117:52`). That forces the version to be known before the upload, which is exactly what the read-then-write race allocates wrongly. Naming the object `{org}/{project}/{kind}/{report_id}.pdf` from a client-generated uuid makes the path derivable before any allocation, so `projects.file_report()` can supersede, insert and return the version in one transaction. The download filename keeps carrying the version, because `downloadFileName()` already derives it from `(kind, version)` at signing time (`project-reports.actions.ts:86-88`), not from the object name.

Order of operations, fixed:

1. Caller mints `report_id` (uuid v4) and, when `issueGuard` is set, runs it — QC's status flip is the only current user.
2. Upload the buffer to `spec.bucket` at `{org}/{project}/{kind}/{report_id}.pdf`, `upsert: false`.
3. Call `projects.file_report(report_id, project_id, kind, source_table, source_id, period_key, title, storage_path, bucket, mime_type, size_bytes, note, summary, branding_snapshot)` — one SECURITY DEFINER function that supersedes every prior `issued` row for the key, inserts the new row with `version = max+1`, and returns the allocated version. Behind:

```sql
CREATE UNIQUE INDEX reports_one_issued ON projects.reports (
  project_id, kind,
  coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(period_key, '')
) WHERE status = 'issued';
```

That single index covers **both** keying schemes — per-entity kinds vary `source_id`, project-level kinds leave it null and vary `period_key` — so no second index is needed. Pre-migration check: `SELECT project_id, kind, coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(period_key, ''), count(*) FROM projects.reports WHERE status = 'issued' GROUP BY 1,2,3,4 HAVING count(*) > 1` must return zero rows before the index builds. The self-healing supersede statements suggest none exist, but a green `Deploy DB Migrations` is not evidence of anything; count them.

4. On a unique violation the losing caller deletes **its own** uploaded object — the path is report-id-scoped, so it can never delete the winner's — and returns a retryable conflict.

`REVOKE ALL ON FUNCTION projects.file_report(...) FROM PUBLIC, anon` before the `GRANT TO authenticated, service_role`, verified with `has_function_privilege('anon', oid, 'EXECUTE')` and never by reading `proacl` — a NULL `proacl` looks empty but *is* the PUBLIC grant. Authorisation inside uses `auth.uid()`; `current_user` under SECURITY DEFINER is the function owner.

**6. Gate — the registry becomes the single source, replacing two hand-maintained lists.**

`report-kind-access.ts:38-58` already carries the mechanism this section needs and it already ships: `REPORT_KIND_READ_ROLES` (gated kinds) plus `OPEN_READ_REPORT_KINDS` (explicitly open kinds), with `report-kind-access.contract.test.ts` walking every `.tsx?` file under `src/` for `from('reports')` writers and failing the build on a kind that appears in neither list (`:51-68`, verified by adding a fake `leaky_new_report` writer). *Decision: do not build a second mechanism.* `access.read` on the registry becomes the source and its values are **Appendix A(d)'s**, kind for kind; `readRolesForKind()` and `hasDeclaredReadPolicy()` read from it; the two exported arrays are deleted; the contract test is repointed at the registry, keeps its scanner-guard assertion (`:71-78`), and gains A(d)'s set-equality assertion in both directions. `public.report_kind_is_sensitive()` (`00183:59-66`) stays in lockstep by a second test that asserts the SQL list equals the set of registry kinds whose `access.read` is narrower than project access — the object form counts as narrower, because its `roles` half is.

**7. Resolver — one resolver, failing closed.** All three `access` arrays are evaluated by `requireEffectiveRole` / `user_effective_project_role`, never by org-scoped `requireRole`. The two are not interchangeable: `requireRole` misses per-project promotions, and mixing them is how the tenant-schedule ungated generate arrived. The `recipient_lookup` branch is evaluated in the same resolver — one lookup against `projects.instruction_recipients` or `projects.transmittal_recipients` on the report's `source_id` — so a recipient's read never depends on a second code path. An unrecognised role string denies, exactly as `export-role.ts:64-66` already does, and an RPC error returns a generic reason rather than the PostgREST body (`:48-56`).

### 5.3 Periodic reports

**Decision: a periodic report is a record of the period, not a summary of activity — it is issued even when the period was empty, and says so.** A weekly pack that silently does not exist is why a two-day median diary lag is invisible today; a weekly pack reading "no diary entry logged by Siyaya Power on four of six site days" is a management artefact.

> **Cut past twelve months — retained here as the design of record.** The **daily site report** (1.5 weeks) is cut. It is not cut for want of value: it is cut because a Q1 deliverable already carries its one irreplaceable signal. The 07:00 recap's section 4 (§05) names every contractor with no diary entry, **every day, from Q1** — nine months before this engine would have rendered the same fact as a PDF at 18:00. Shipping both would mean two produce-daily paths for one signal, and the PDF is the one that arrives later and is read less. Everything else the daily pack carried — weather, labour, verbatim narrative, delays, photos, deliveries — survives inside the weekly pack, aggregated by day. If it is ever reinstated, the design below is complete and the spec slot (`period: 'day'`) is already in the contract.

| Report | Cadence | Sections, in order | Source |
|---|---|---|---|
| ~~Daily site report~~ ("super daily") — **cut, see banner** | 18:00 site time, per project, per calendar day | Weather; labour on site by contractor; each contractor's own diary narrative verbatim, attributed and time-stamped; delays; safety and quality notes; photos captured that day with captions; work items opened / closed / overdue today; deliveries received; **contractors with no entry, named** | `site_diary_entries` (+ `entry_type`, `00017`), `site_diary_attachments`, work items, `structure.node_orders` |
| **Weekly project report** (`weekly_project`) | Monday 07:00, previous Mon–Sun | Narrative (§5.6); ball-in-court table by party; RFIs raised / answered / overdue with age; snags opened / closed by round; QC entries by conformance; inspections and CoCs issued; cable-schedule revisions issued; procurement delta (required → ordered → received); site-form records; **days with no diary entry, by contractor**; next week's due items; open decisions | `projects.rfis`, `rfi_responses`, `field.snags`, `qc_entries`, `inspections.inspections`, `cable_schedule.revisions`, `node_orders`, `field.site_forms`, `site_diary_entries` |
| **Monthly client report** (`monthly_client`) | 1st of month, 07:00 | Cover + one-page executive narrative; tenant-schedule status by shop; procurement and long-lead exposure; compliance register (CoCs issued vs DBs energised); commercial (BoQ, valuations, variation orders) **only when the recipient is cost-cleared**; risks and instructions issued; photo plate | tenant schedule, `node_orders`, `boq_items`, `valuations`, compliance |

Both surviving kinds are registry kinds with `period` set, and `period_key` (`2026-W42`, `2026-10`) makes re-running the cron idempotent by unique index rather than by hope.

Two content decisions, both forced by what exists:

- **Weather is captured at the point of entry from Q2, not by this engine.** `projects.site_diary_entries.weather` is a nullable `TEXT` typed by hand (`00002_projects_schema.sql:151`) and filled on 38 of 53 production entries. The diary check-in with auto-weather moved into Q2, bringing Open-Meteo Commercial with it (A(i): first needed Q2, €29 ≈ R580/month, coordinates only, no personal information), so by the time the weekly pack ships in Q3 the field is populated at source. Where it is absent — every period before Q2, and any entry made offline — the report **prints "weather not recorded"** rather than omitting the line, on exactly the same footing as naming contractors with no entry. Silence about a missing field is how a two-day lag stayed invisible.
- **No programme section in Q3.** The monthly client report ships without progress-against-programme, because nothing in the 118 tables holds a baseline or a milestone — Primitive 6 lands in Q4. The schedule signal for Q3 comes from tenant-schedule status by shop and long-lead procurement exposure, both of which are real rows today. A programme-variance section is added to the same report as a **Q4 addendum**, with the report kind unchanged, so no supersede chain breaks and no client sees a renamed document. The commercial block reads `valuations` only: variations and commercial remeasure are cut past twelve months, so `variation_orders` is not a source this year.

### 5.4 Register packs

Each is a filtered projection of one register, rendered through the shared `Table` (`interior.tsx:501`) with a filter banner on the cover stating exactly what was included. Every one is a projection of tables that already exist; none needs a new register.

| Pack | Kind (A(d)) | Grouping | Filter axes | Notes |
|---|---|---|---|---|
| RFI register | `rfi_register`, Q3 | by status, then age | party, date range, open-only | Ball-in-court and days-open are columns, never blank |
| Snag list by round | `snag_round`, Q3 | by visit, then location | contractor, severity, open-only | Before/after photo grid already built |
| QC report | `qc`, live | existing | — | Registry port only; keeps the `qc-reports` bucket |
| **Project export** | `project_export`, Q4 | by kind, then date | date range, kind | **The whole project as one download**: every `status='issued'` report plus the RFI, snag, QC, instruction, procurement and tenant registers as CSV, in one ZIP with a manifest. Gated `ORG_WRITE_ROLES` (A(d)). It is what §11.7's Archived tier sells — a project that has left support must still be openable without an account tier that renders it |

> **Cut past twelve months — retained here as the design of record.** Four item-for-item packs are cut: the **instruction register** (by JBCC clause then date, filtered by party and served/outstanding, feeding `jbcc_time_bar_schedule`); the **delivery / GRN register** (by board then order, filtered by supplier and received/outstanding, over `node_orders` + `ProcLine.notes`); the **CoC / form pack** (by DB then date — a ZIP of individually signed records plus an index sheet, the "not a CoC" disclaimer per page); and the **transmittal register** pack (by issue date, filtered by recipient and document type). Each is a projection of a register the programme does build, so each is a fortnight's work whenever it is wanted, and none of them is the reason a contractor opens the app. The `transmittal` **document** itself is not cut — it ships in Q3 as a registry kind against §06's issue flow; only the register-wide pack over it is deferred.

`project_export` breaks the same two assumptions in the saved-report path the cut ZIP pack would have, and both are fixed in the harness in Q4: the pack sets `mime_type = 'application/zip'` (the column defaults to `application/pdf`, `00117:53`), and `downloadFileName()` derives its extension from `mime_type` instead of hard-coding `.pdf` (`project-reports.actions.ts:86-88`).

### 5.5 Scheduled distribution

`projects.report_schedules` is listed in A(f) under Q3; the column set is this section's:

```sql
CREATE TABLE projects.report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  cadence text NOT NULL,          -- daily | weekly | monthly | on_issue
  send_at time NOT NULL, timezone text NOT NULL DEFAULT 'Africa/Johannesburg',
  audience jsonb NOT NULL,        -- roles[], user_ids[], external contacts[]
  projection text NOT NULL DEFAULT 'full',  -- full | own_items
  is_active boolean NOT NULL DEFAULT true, last_run_at timestamptz);
```

**Recipients** resolve through the existing roster RPC — `resolveProjectRecipients` → `project_notification_recipients` (`recipients.ts:20-43`), service-role by design because "the actor often can't read cross-org/sub-org profiles under RLS, which would collapse the audience" (`:6-9`) — plus a per-schedule external-contact list so a landlord's asset manager who will never log in still receives the monthly report.

**Per-recipient filtering is the feature, not a setting.** With `projection='own_items'` the harness runs `gather()` once, then renders one PDF per party from the same payload, each containing only that party's open items — Fieldwire's one-PDF-per-subcontractor behaviour, which is why subcontractors there read the report at all. A twelve-contractor project produces twelve short documents instead of one 40-page pack nobody opens. Cost data is redacted **in the projection**, not in the template, so it cannot be forgotten in a renderer.

**Decision: link always, never attach.** `send-email` cannot attach anything — its payload type is `{ to, subject, html }` (`send-email/index.ts:21-25`) and its type set is `rfi-created | snag-assigned | invite | coc-status` (`:6-10`). Adding attachments would mean a new payload field, a new `EmailType`, and base64 of a multi-megabyte PDF through the edge function request body, whose limit is the binding constraint rather than any round number. It is also incompatible with the read receipts and revocation this same paragraph requires: an attachment cannot be revoked and cannot be counted. Delivery reuses the Resend batch path unchanged (100 per chunk, continuing past a failing chunk so a partial outage cannot silently drop most of a roster — `send-email/index.ts:44-72`), and the email body carries a guest link. The only `send-email` change is a `report-issued` type, so the branded template lives beside the others.

In-app, an issue emits `report_issued` (A(c): Q3, Held, distribution list) and a failed scheduled run emits `report_schedule_failed` (A(c): Q3, Immediate, org owner + the schedule's creator). Both are **`INSERT`s into `public.notification_types`**, not a re-declaration of `notifications_type_check`, which Q1 replaced with the table and its FK; a schedule that stops producing run rows is caught independently by `job_missed`.

**Account-less access is `public.guest_links` with `scope='report'` — one mechanism, not two.**

*Decision: `projects.report_access_tokens` is not created.* §11.4 owns `public.guest_links`, §14 Q3.5 ships it in the same quarter as this engine (A(f), Q3, `public`), and A(d) records the decision. A second token table for reports would be a second redemption path, a second audit shape and a second rate limiter to get wrong. What this section declares instead is the behaviour of the `report` scope, and the six rules below are the properties of that scope, enforced in the `/r/[token]` route (A(g): Q3, ungrouped, unauthenticated, issued-only, rate-limited, `CONFORMANCE.md` in the same PR).

**The link is scoped to one report, not one kind.** A kind-scoped token would be the already-documented defect class widened rather than closed: report routes under `app/api/*` sit outside `(admin)/layout.tsx` and read with the service client, so neither the portal bounce nor RLS applies — the site-forms audit's defect 7, which left a client viewer able to fetch a voided record's PDF indefinitely. One leaked or forwarded link must therefore grant exactly one document.

| Property | Rule |
|---|---|
| Storage | Only `sha256(token)` is stored, unique-indexed; the 32-byte random plaintext exists only in the emailed URL and in the recipient's mailbox |
| Resolution | The route accepts **the token and nothing else** — no `kind`, `project_id` or `report_id` parameter — and resolves the report solely from the `guest_links` row |
| Status | Refuses any report whose `status` is not `issued`, so revoking or superseding a document immediately closes every link to it |
| Lifetime | **30 days by default, with the hard ceiling `CHECK (expires_at <= created_at + interval '90 days')`** (§11.4) — nobody can mint a link that outlives the quarter it was issued in. `revoked_at` closes it sooner, a single UPDATE from the report's own panel; `max_uses` bounds onward forwarding |
| Audit | Every open writes an audit row with `actor_id = NULL` (`entity_type='report'`, `action='token_open'`, `new_values` carrying the recipient email and IP). `public.audit_log.action` is `TEXT NOT NULL` with no CHECK (`00001_initial_schema.sql:130`), so no migration is needed to add the action |
| Rate limit | 20 requests per token per hour and 200 per IP per hour through the existing `lib/rate-limit.ts`, returning 429 **without disclosing whether the token exists** |

**Runner:** one `report-scheduler` edge function (A(g)) on a 15-minute `pg_cron` tick, claiming due rows with `claim_due_report_schedules()` and `FOR UPDATE SKIP LOCKED`, then invoking the Node report route — **forwarding the caller's Authorization header**, because the edge runtime injects `SUPABASE_SERVICE_ROLE_KEY` as a non-JWT `sb_secret_…` and function-to-function JWT gates fail otherwise (the 2026-07-23 cron 403s, fixed in PR #153).

*Decision on how the job is created: through the Supabase Management API with an inline key in `net.http_post`, matching live cron jobs 1–8, after the function is CLI-deployed — not as SQL in a migration.* The commented-out `SELECT cron.schedule(...)` block at `00029_health_scores.sql:59-70` is "left as a comment here because scheduling is environment-specific" (`:72-74`) and has never executed; the identical block in `00148` is precisely why `cloud-sync-poll` was never scheduled and all eleven of its runs were manual until 2026-07-23. Deploy order is migration → CLI-deploy the function (edge functions do not auto-deploy on merge; `deploy-edge-functions.yml` is `workflow_dispatch:` only, A(g)) → create the cron job → **read `cron.job` back and confirm the first tick landed with `trigger='cron'`**. A migration containing a schedule as a comment schedules nothing and still deploys green.

### 5.6 The narrative step

There is no AI anywhere in this repo today. The narrative is the first and, this year, the only place it belongs in a document that leaves the practice — because the numbers are already structured, so the model writes prose *around* figures it never computes.

**Inputs (exactly this, nothing else):** the report payload's already-computed counts and deltas; entity titles, statuses, assignees, due dates and ages; diary `progress_notes` / `delays` / `safety_notes` verbatim for the period; the previous issued narrative for this kind and project; and the organisation's house-style profile. **Never:** raw table dumps, other projects, cost figures when the audience is not cost-cleared, or photographs.

**The house-style profile is not a column on `public.organisations`.** *Decision: it is `ai.org_profile` (§10.7) — `tone_json`, `standard_wording` and the sign-off block — read, not duplicated.* A `report_narrative_profile jsonb` column would be a second home for the same fact and, worse, could not serve §10.2, which needs the chase agent's thresholds out of the same profile row; A(f) records the column as **not created**. The `ai` schema arrives in Q3 with the three obligations A(f) attaches to it — the Management-API `db_schema` PATCH, the complete GRANT block, and the `config.toml` edit — and the narrative lands in Q4, so the dependency runs the right way round and no report waits on a schema. Editing the profile is `/settings` under `OWNER_ADMIN` via `requireRolePage`. The previous issued narrative is the only other style signal; nothing else is learned. Anthropic is the vendor, under A(i)'s §21 operator agreement and §72 undertaking, at ~R4 per active project per month for the weekly narrative and ~R2 for the monthly.

| Guardrail | Mechanism |
|---|---|
| No invented figures | Every number in the PDF is rendered by the template from the payload; the model's output is prose only. A post-check tokenises the draft's numerals and compares each against a whitelist built from the payload's numeric fields **plus their rendered variants** — thousands-separated (`3 406 513.93`), ZAR-prefixed, percentage, ISO date and long-form date — so `12` inside `2026-10-12` matches the date it came from and a bare float still matches its formatted form. On failure: regenerate once, then drop the narrative and issue the numbers |
| Words are not a loophole | "two contractors", "a third of the boards" and similar quantifiers are prohibited by prompt and asserted by a fixture test; the model may name parties and describe direction, never magnitude in words |
| Every claim traceable | Each narrative paragraph carries the entity ids it was composed from, stored in `projects.reports.narrative_json` |
| Never issued unreviewed | The report is created `status='draft'`; only a human holding the kind's `access.generate` role flips it to `issued` |
| Deadline without hostage | If nobody reviews by the scheduled send time, the report **issues on time with the narrative section omitted** and a line saying the commentary was not reviewed. The numbers are the obligation; the prose is not |
| Silence stays silence | An empty period must be reported as empty; the model is instructed and tested against smoothing ("steady progress continued") |
| Measured | Edit distance between draft and issued narrative is logged per report. If editors rewrite more than they keep, the feature is wrong and we will see it |

### 5.7 Migration path

Kinds, quarters and read policies are Appendix A(d). This table states only what changes in the code and how each change is held down.

| Kind | Change | Regression control |
|---|---|---|
| `inspection`, `snag`, `tenant_schedule` | Filer replaced by `fileReport()`; gatherer and renderer untouched | Fixture test asserts an **identical buffer and the full `(bucket, storage_path)` pair** before and after the port. Buffer-only comparison would pass while the object silently moved |
| `qc` | Same port, plus `bucket: 'qc-reports'` on the spec and `issueGuard` carrying the status-flip guard from `qc.actions.ts:816-818` | Explicit row: **QC keeps its bucket and its eight `00172:539-551` storage policies. No object is moved.** A test asserts the resolved bucket is `qc-reports` and that a race-aborted issue leaves the prior version `issued` |
| `equipment_materials` | Registry port only. `access.read` per A(d), carried over verbatim from `report-kind-access.ts:41`; `access.generate = ORG_WRITE_ROLES` from `equipment-materials-report-data.ts:72-73` | Test asserts a `client_viewer` with project access still receives 403 on **both** list and download after the port, and that `report_kind_is_sensitive()` still names the kind |
| `valuation`, `site_form` | Gain the branded cover and running chrome; read policies per A(d), preserved from `report-kind-access.ts:45` | Visible change; both are low-volume in production (1 valuation, 1 site form), so this is the safest possible moment |
| `instruction` — **added in Q2, before the harness exists** | §06 ships the instruction PDF and its filer in Q2 against the seven-step shape above, so its Q3 port is the same mechanical change as the seven and is carried inside that line. Its read is the **first object-form entry**: roles plus `recipient_lookup: 'instruction_recipients'` (A(d)) | Test asserts a recipient holding **none** of the roles still reads their own instruction after the port, and that a non-recipient with the same role set does not — asserted twice, once through the app resolver and once as a direct PostgREST read against the RESTRICTIVE policy |
| `transmittal` — **added in Q3** | §06's transmittal issue flow (Q3) declares against the registry from its first commit rather than being ported; §07 supplies the spec slot and the second `recipient_lookup` (`transmittal_recipients`, A(d)) | Same two-sided recipient test. The register-wide transmittal *pack* is cut (§5.4) |
| `tenant_delivery` — **added in Q4** | §08's tenant delivery tracker declares against the registry. Its landlord surface is served by `requirePortalAccess` → service client → allow-listed columns, **not** by RLS (A(d)), so the registry entry governs the in-app read only | Test asserts the portal projection exposes only the allow-listed columns and that the in-app read follows A(d) |
| `generator` (GCR, `gcr.report_revisions`, `00127`) | **Q4.** Backfilled into `projects.reports` as kind `generator` with `note` / `summary` (present since `00183:43-45`); the forked table retained read-only for one quarter, then dropped | GCR is a toggled module, OFF by default in v2 (A(e)). The drop is destructive, so it takes the A(f) pre-migration snapshot into `backup_<version>_report_revisions` in the same transaction, retained 90 days, restore statement in the migration header |
| `cable_schedule` | **Q4.** Registered as a kind; the streamed download stays, and issuing a revision now also *files* a version | Purely additive; the role-based redaction already in `export-role.ts:39-68` becomes the spec's `access` block |
| Read gate | `REPORT_KIND_READ_ROLES` + `OPEN_READ_REPORT_KINDS` deleted; `readRolesForKind()` reads `access.read` from the registry | The contract test keeps its scanner-guard (`:71-78`), still fails the build on an unregistered kind, and adds set equality against A(d) in both directions |
| Tenant-schedule generate | The ungated route (`route.ts:20-25`) comes under the registry with `access.generate` stated explicitly rather than left as a comment | `docs/rbac-matrix.md` row added in the same PR |

**Two migrations, both Q3.** Numbers are claimed immediately before merge — never reserved when the branch is cut — re-checked against both `origin/main` and `max(version)` in `schema_migrations`, announced to peer sessions, and each verified by reading the affected table back, because `db push` keys on the version prefix and prints "up to date" over a number it has already seen.

| # | Contents |
|---|---|
| A | `projects.reports`: `period_key`, `period_start`, `period_end`, `narrative_json`, `bucket`, `audience` columns; the `reports_one_issued` partial unique index (after the duplicate count returns zero); `projects.file_report()` and `claim_due_report_schedules()`, each with `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon` before the `GRANT` to `authenticated, service_role`; `NOTIFY pgrst` |
| B | `projects.report_schedules` + RLS + its `REVOKE SELECT … FROM anon` (`00025_grant_schema_permissions.sql:26` makes every new table anon-readable at birth), verified with `has_table_privilege` |

Neither migration creates `projects.report_access_tokens` or `public.organisations.report_narrative_profile`; A(f) lists both as not created. `public.guest_links` is §11.4's table in the same quarter and is not created here. `public.audit_log` needs no migration — `action` is unconstrained `TEXT` (`00001_initial_schema.sql:130`). `docs/rbac-matrix.md` is updated in the same PR as the scheduler route and the guest-link route; `CONFORMANCE.md` in the same PR as the guest-link route, which is an auth surface. Every port is verified by walking the flow from the empty state a real user starts in — an admin landing on a project with no saved reports — not from a deep link into seeded data.

### 5.8 Cost

| Subsection | Work | Weeks | Quarter |
|---|---|---|---|
| §5.2 | Harness, `ReportSpec` registry, `<T>`/`<TOptional>`/`draw-safe.ts` + eslint rules, migration A | 3.0 | Q3 |
| §5.7 | Port the **seven live filers**; delete the two access lists; repoint the contract test at the registry and at A(d) | 2.0 | Q3 |
| §5.3 | Weekly project report | 2.0 | Q3 |
| §5.4 | RFI register, snag list by round, QC registry port | 1.0 | Q3 |
| §5.5 | `report_schedules` + migration B, cron runner and `report-scheduler`, per-recipient projection, in-app delivery, **and the guest-link report scope** — the `/r/[token]` route, the `report-issued` email type, the redemption audit row and the rate limit | 3.5 | Q3 |
| §5.5 / portal | Portal consolidation to timeline · reports · approvals (A(g)) — counted **once, here**, because its reports tab is a report-engine surface | 2.0 | Q3 |
| | **Q3 subtotal** | **13.5** | |
| §5.3 | Monthly client report | 2.0 | Q4 |
| §5.6 | Narrative drafting against `ai.org_profile`, numeral post-check, edit-distance telemetry | 2.0 | Q4 |
| §5.7 | GCR backfill + `cable_schedule` registration (+ the `gcr.report_revisions` snapshot and drop) | 0.5 | Q4 |
| §5.4 | `project_export` (+ `mime_type` extension handling) | 0.25 | Q4 |
| | **Q4 subtotal** | **4.75** | |
| | **Section total** | **18.25** | 13.5 Q3 / 4.75 Q4 |

Three things this table does *not* price, deliberately. The `docs/rbac-matrix.md` and `CONFORMANCE.md` rows and the empty-state production verification are obligations of the harness and distribution lines, not a line of their own — a doc row that can be dropped to save a fortnight is a doc row that will be. The `instruction` filer's Q2 build is §06's. The `transmittal` issue flow (Q3, 1.0), the drawing-and-document register surface that arrives in Q3 from Q2 (1.5) and the QC/RFI back-fill with its renderer repoint (**Q4**, 1.0 — moved out of Q3 by §14's re-plan, carrying the `projects.qc_comments` drop with it) are §06's ledger, not this one, even though the back-fill lands on this registry.

**Against the quarter.** Q3 commits 19.75 engineer-weeks against 20.2 available — this section is 13.5 of it, and the balance is the chase agent (1.5), voice plus the `ai` schema (2.0), the transmittal issue flow (1.0), the drawing-and-document register surface arriving from Q2 (1.5) and monitoring (0.25). Q4 commits 19.5 against 20.2; this section is 4.75 of it. §14's published Q3 cut order is **the transmittal issue flow, then the item-for-item packs**, decided in the first week of June rather than the last — the QC/RFI back-fill is no longer in the quarter to be cut from it. The harness, the seven-filer port and scheduled distribution are never in the cut order, because everything downstream is a projection of them; the register surface is deliberately not in it either, because it has already slipped one quarter and a deliverable that slips twice dies without anyone deciding to kill it. Both cut lines are off the quarter's 10.5-week chain, so each reduces the total and neither shortens the path — if the path itself slips, the remedy is a second pair of hands inside the distribution line, not a scope reduction.

**What was cut from this section and why**, so it is not re-proposed:

- **Daily site report (1.5, Q3)** — redundant with a Q1 deliverable. The 07:00 recap names contractors with no diary entry every day from Q1 (§5.3's banner).
- **Instruction register, delivery/GRN register, CoC/form ZIP pack, transmittal register pack (2.0 Q4 + 2.5 Q4)** — projections of registers the programme builds anyway, so each is cheap whenever it is wanted, and none is why anyone opens the app (§5.4's banner). The 2.5 formerly carried against "the transmittal register" was mostly the register itself; that register is now §06's Q3 issue flow at 1.0, and the report over it is what is cut.
- **`projects.report_access_tokens` (formerly 1.0, Q4)** — reduced to the route and the email type only, and both moved into the Q3 distribution line, because `public.guest_links` ships in Q3 and one redemption mechanism is the point.

Q4's report work is the two documents that need a full quarter of ledger behind them: the monthly client report wants Primitive 6's programme section, which lands in the same quarter, and the narrative is worth nothing until there is a weekly pack worth commenting on.

### 5.9 Why this replaces Word and Excel at WM

WM's reporting today is a person opening last month's document, pasting new numbers out of the app and a spreadsheet, rewriting the commentary, exporting a PDF and attaching it to an email — which is why nine saved reports exist across fourteen projects and the monthly client report lives outside the system entirely. Three properties end that habit, and none of them is "our editor is nicer than Word":

1. **The report is a by-product of the ledger.** Every figure in the weekly and monthly packs already exists as a row; the alternative to generating it is typing it. Once the tenant schedule, cable schedule and order ledger are the source, the spreadsheet is a copy that can only be wrong.
2. **The pack is per-recipient and it sends itself.** A schedule that emails twelve contractors their own open items at 07:00 on Monday is work nobody at WM can do by hand, so it is not a substitute for the Word document — it is something the Word document never was.
3. **The commentary survives.** The one thing Word gave WM was voice. The narrative step keeps it — drafted from the period's delta in the practice's own house style, edited by an engineer, issued under the practice's name, and never issued unreviewed.

The metric that proves it: **reports scheduled per project**. It is instrumented from Q1 and reads zero for every project until the engine ships in Q3 — that zero is the baseline, not a gap in instrumentation. The Q3 proving outcome is that **every weekly pack** for every live project issued on time, from a schedule, without anyone deciding to send it. A project with zero schedules after that is a project still being reported in Word.
