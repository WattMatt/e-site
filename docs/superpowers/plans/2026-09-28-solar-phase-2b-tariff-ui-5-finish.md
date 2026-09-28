# Solar Phase 2b — Part 5 of 5: RBAC matrix, full verification, two reviewers, push, draft PR

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Read the index first. Parts 1–4 must be done.

All commands run from `~/.config/superpowers/worktrees/esite/solar-phase-2b`. `S=/private/tmp/claude-501/solar-2b`.

---

### Task 30: `docs/rbac-matrix.md` rows (same PR as the routes — CLAUDE.md rule)

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Solar route row**

In the Solar route table (section "## Solar"), directly after the `/projects/[id]/solar/site` row, add:
```markdown
| `/projects/[id]/solar/tariff` | W | W | → locked (tab hidden) | → locked (tab hidden) | → locked | → locked | → locked |
```
In the blockquote under that table, replace the sentence beginning "Tabs other than Overview and Site & Supply have **no route** in Phase 1" with:
```markdown
Tabs other than Overview, Site & Supply and Tariff (Phase 2b) have **no route** yet — the tab bar renders them disabled ("Coming in a later phase"). Tariff and Financials are hidden below Edit + financials and their pages call `requireSolarLevel(…, 'edit_financials')`; Operations is hidden for everyone until Phase 7 (D-12).
```

- [ ] **Step 2: Solar server action rows**

In "### Solar server actions", after the `saveSolarOrgSettingsAction` row, add:
```markdown
| `selectSolarTariffAction`, `setStudyLicenseeAction` (`solar-tariff.actions.ts`) | `requireSolarLevel(project, 'edit_financials')`; `expectedUpdatedAt` stale guard | `00213` `studies_tariff_guard` (a changed `licensee_id`/`tariff_id`/`tariff_override_id`/`export_rule`/`escalation` needs `solar_can_see_money`, `42501`; only a published/superseded tariff may be pinned; `licensee_id` rebound to the tariff's licensee; an override must belong to this study and tariff) + 00207 `studies_update_authz` |
| `saveSolarExportRuleAction` | `edit_financials`; stale guard checked BEFORE any write; the linked method is decided from the pinned tariff server-side | `studies_export_rule_shape` (manual needs a source note); `solar.study_export_rates` money policies (SELECT and every write on `solar_can_see_money`, parent bound by `money_row_bind`) |
| `saveSolarEscalationAction` | `edit_financials`; years validated against the org analysis period | `studies_tariff_guard`, `studies_escalation_shape` |
| `createSolarTariffOverrideAction`, `revertSolarTariffOverrideAction` | `edit_financials` | `solar.create_tariff_override` / `solar.revert_tariff_override` (SECURITY INVOKER, row-locked, `40001` on a stale timestamp); `tariff_overrides_*` money policies |
| `editSolarOverrideChargeAction` | `edit_financials`; row `updated_at` stale guard; unit compatible with the component and ingestion plausibility ranges | `tariff_override_charges_guard` (a changed rate needs a reason, stamps `edited_by`), `override_charge_edit_has_reason` |
| `recordSolarBillCheckAction`, `deleteSolarBillCheckAction` | `edit_financials`; costed server-side with the bill engine on the effective (override or published) tariff | `solar.bill_checks` money policies (no UPDATE policy or grant: a record, not a draft) |
| `reportTariffErrorAction` | `edit_financials`; non-blank note ≤ 2000 | `tariffs.error_report_insert` (`solar_can_see_money(project)` AND the tariff is readable); `error_report_bind` forces reporter = caller, status = open |
| `getSolarTariffSourceUrlAction` | `edit_financials`; the source row read through the caller's session (00209 reader policy) | 10-minute signed URL minted by the service client AFTER the gate (`tariff-sources` is private, no `storage.objects` policy) |
```
And under the audit note paragraph, append:
```markdown
> Phase 2b tariff actions write `solar.audit_events` with ids only (`tariffId`, `chargeId`, `billingMonth`, `method`) — never a rand amount, because View users read the activity feed. They emit **no** `product_events` rows (plan D2b-8: widening `product_events_event_check` again would collide with sibling Solar migrations).
```

- [ ] **Step 3: New section — platform tariff library**

Insert before "## Client portal":
```markdown
## Platform tariff library (`apps/web/src/app/(admin)/admin/tariffs/*`, D-03)

Not an org role at all: the gate is `public.is_platform_tariff_admin()` (00209), an explicit allow-list (`public.platform_tariff_admins`, written by the service role only). Everyone else — org owners included — gets **404** (the route is not advertised); the sidebar shows "Tariff library" only to allow-listed users. The layout, every page, every action and the API route each ask the database.

| Route | Platform tariff admin | Everyone else |
|---|---|---|
| `/admin/tariffs` (overview: years in review, open reports, queued PDF ingests, due-year alerts, **Check … years now**) | W | 404 |
| `/admin/tariffs/licensees` (registry + aliases) | W | 404 |
| `/admin/tariffs/sources` (upload, dry run / apply, queue PDF ingest) | W | 404 |
| `/admin/tariffs/years`, `/years/[yearId]` (review queue, checks, publish), `/years/[yearId]/diff`, `/years/[yearId]/sseg` | W (draft years); R (published / superseded) | 404 |
| `/admin/tariffs/calendars` (TOU calendars, holiday treatment) | W | 404 |
| `/admin/tariffs/reports` (reported tariff errors) | W | 404 |

| Action / route | Gate | DB layer that decides |
|---|---|---|
| `saveLicenseeAction`, `addLicenseeAliasAction`, `removeLicenseeAliasAction` (`tariff-library.actions.ts`) | `requirePlatformTariffAdmin` | 00209 admin write policies; `licensee_alias_normalised` |
| `createSourceUploadAction` → browser `uploadToSignedUrl` → `registerSourceDocumentAction` | admin; refuses a sha256 already in the library | server re-downloads and re-hashes; a mismatch deletes the object; `source_document` inserted through the admin session (00209 policy; `source_document_guard` pins sha/path) |
| `POST /api/admin/tariffs/ingest` | `requirePlatformTariffAdminAPI` (401/404); workbooks only (PDF → 400) | 2a's `runIngest` through the service-role store; years land `in_review`, never published; Eskom apply needs a stored Rules PDF (409) |
| `queueIngestJobAction` | admin | `tariffs.ingest_job_insert` (admin); `ingest_job_bind` forces status = queued, requester = caller; no UPDATE/DELETE grant — only the service-role worker (`scripts/tariffs/ingest-worker.ts`, `tariffs.claim_ingest_job()`) moves a job |
| `approveChargeAction`, `editChargeAction`, `rejectChargeAction`, `deleteTariffAction` (`tariff-review.actions.ts`) | admin | 00209 `year_child_guard` (draft years only), `charge_review_bind` (stamp = caller, now), `invalidate_year_validation` |
| `validateTariffYearAction` | admin | `tariffs.year_content_fingerprint` then `tariffs.record_year_validation` (service role only; refuses `40001` if the content moved) |
| `publishTariffYearAction` | admin | 00209 `tariff_year_guard` (charges on every tariff, inferred units reviewed, validated with 0 blocking, signed-in admin; supersedes the previous year) |
| `saveSsegRuleAction` | admin | 00209 `sseg_rule` admin policies + `year_child_guard` |
| `saveTouCalendarAction` (`tariff-calendar.actions.ts`) | admin | 00209 admin policies on `tou_calendar`, `tou_window`, `holiday_rule` |
| `runDueYearCheckAction` | admin | `tariffs.record_due_year_alerts` (service role only; the same function the 1 April / 1 July cron runs) |
| `resolveErrorReportAction`, `getTariffSourceUrlAdminAction` | admin | `error_report_update` (admin; only status + resolution note are grantable; `error_report_bind` stamps the resolver); signed URL via the service client after the gate |
```

- [ ] **Step 4: API routes table**

In "## API routes", add a row in the same column format as its neighbours (read the header first):
```markdown
| `POST /api/admin/tariffs/ingest` | platform tariff admin only (404 otherwise; not an org role) — see "Platform tariff library" |
```
If the API table has one column per E-Site role, put `—` in every role column and the note in the last column, exactly like the `/api/paystack/solar-subscribe` row does with its footnote.

- [ ] **Step 5: Commit**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): Solar Tariff tab and the platform tariff library

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 31: Full verification (evidence before any claim)

**Files:** none (outputs to `$S`)

- [ ] **Step 1: Three suites, type-check, lint, build**

```bash
cd ~/.config/superpowers/worktrees/esite/solar-phase-2b
pnpm --filter @esite/shared test > "$S/f-shared.txt" 2>&1; tail -4 "$S/f-shared.txt"
pnpm --filter web test > "$S/f-web.txt" 2>&1; tail -4 "$S/f-web.txt"
pnpm --filter @esite/db test:ci > "$S/f-db.txt" 2>&1; tail -4 "$S/f-db.txt"
pnpm --filter @esite/shared type-check > "$S/f-tc-shared.txt" 2>&1; tail -2 "$S/f-tc-shared.txt"
pnpm --filter web type-check > "$S/f-tc-web.txt" 2>&1; tail -2 "$S/f-tc-web.txt"
pnpm --filter @esite/shared lint > "$S/f-lint-shared.txt" 2>&1; tail -3 "$S/f-lint-shared.txt"
pnpm --filter web lint > "$S/f-lint-web.txt" 2>&1; tail -3 "$S/f-lint-web.txt"
pnpm --filter web build > "$S/f-build.txt" 2>&1; tail -15 "$S/f-build.txt"
```
Expected: every suite green with pass counts ≥ the Task 1 baseline plus this phase's new tests; `tsc` exit 0 twice; lint clean; `next build` exit 0 with `/admin/tariffs/*`, `/projects/[id]/solar/tariff` and `/api/admin/tariffs/ingest` in the route list. `@esite/db` matters here: it replays the migration corpus through the anon-EXECUTE model and would fail on a missing `REVOKE … FROM anon`.

Any red → fix the code (never the assertion unless it contradicts the plan), re-run the WHOLE step.

- [ ] **Step 2: The migration, once more, on the final file**

```bash
M=apps/edge-functions/supabase/migrations
cat "$S/chain-without-00213.sql" $M/00213_solar_tariff_selection.sql > "$S/chain.sql"
scripts/db/dry-run-migration.sh "$S/chain.sql" scripts/db/assert-solar-tariff-selection-roles.sql 2>&1 | tail -3
node --experimental-strip-types "$S/verify-chain.mts" "$PWD" "$S/chain.sql" \
  $M/00207_solar_foundation.sql $M/00208_solar_org_settings.sql $M/00209_tariffs_schema.sql $M/00210_solar_meter_data.sql $M/00213_solar_tariff_selection.sql
grep -n -i -E '^\s*(BEGIN|COMMIT)\s*;' $M/00213_solar_tariff_selection.sql || echo "no-txn-control-ok"
```
Expected: `0 failed` (61 checks); five `failed=0` lines; `no-txn-control-ok`. If the migration changed since Task 4, re-run the seven mutations too (Task 4 Step 2).

- [ ] **Step 3: Client-bundle and secret hygiene**

```bash
grep -rn "@esite/shared/tariffs/\(ingest\|parsers\)'" apps/web/src --include=*.tsx | grep -v "import type" | grep -v '\.test\.' || echo "no-client-import-ok"
grep -rn "createServiceClient" apps/web/src --include=*.tsx | grep -v '\.test\.' | grep -v "^apps/web/src/app/(admin)/admin/tariffs/reports/page.tsx" || echo "service-client-server-only-ok"
grep -rln "SUPABASE_SERVICE_ROLE_KEY" apps/web/src | grep -v '\.test\.'
```
Expected: `no-client-import-ok`; `service-client-server-only-ok` (the reports page is a server component and uses it after the gate for project names only); the last grep lists only server files (`lib/supabase/server.ts`, `app/api/admin/tariffs/ingest/route.ts`).

- [ ] **Step 4: Record the evidence**

```bash
{ for f in f-shared f-web f-db f-tc-shared f-tc-web f-lint-shared f-lint-web; do echo "== $f"; tail -4 "$S/$f.txt"; done; echo "== build"; tail -5 "$S/f-build.txt"; cat "$S/evidence-00213.md"; } > "$S/evidence-2b.md"
```

---

### Task 32: Two foreground reviewers

**Files:** fixes only, as the reviews require.

Run both **in the foreground** (`run_in_background: false`), one after the other, with the `superpowers:code-reviewer` agent. Give each the diff range and the exact brief below. Do not merge their findings into one pass: each has its own lens.

- [ ] **Step 1: Reviewer A — security, RLS, migration**

```
Review branch feat/solar-phase-2b (worktree ~/.config/superpowers/worktrees/esite/solar-phase-2b), range
origin/feat/solar-integration..HEAD. Lens: security and data integrity ONLY.
Read docs/solar/03-data-model-and-security.md §3.1 and §5 and the plan index
docs/superpowers/plans/2026-09-28-solar-phase-2b-tariff-ui.md (decisions D2b-*) first.
Check, with evidence (file:line), each of:
1. 00213: every new table FORCE RLS; exactly one SELECT policy per money table and it uses solar_can_see_money;
   no RESTRICTIVE policy covering SELECT anywhere in solar; no FOR ALL / RESTRICTIVE policy in tariffs;
   every SECURITY DEFINER function REVOKEs PUBLIC and anon; service-only functions REVOKE authenticated.
2. studies_tariff_guard: can an Edit (not financials) user change tariff_id / export_rule / escalation /
   licensee_id / tariff_override_id by ANY path (PATCH with other columns, INSERT of a new study)?
3. money_row_bind: can a client pick project_id/organisation_id/override_id of another project?
4. The override functions: SECURITY INVOKER — confirm RLS still applies inside them; stale guard correct.
5. tariffs.error_report / ingest_job: can a non-admin read others' rows, update, or forge reporter/requester/status?
6. record_year_validation: can a verdict be recorded on content the validators did not see?
7. Every server action and the API route re-checks its gate BEFORE any read of money or any service-client use;
   the service client never reaches a client component; signed URLs ≤ 10 minutes.
8. Audit rows never carry rand amounts.
9. The 00207/00209 @verify schema-wide directives still hold (the plan evaluated them; confirm the logic).
Report: Critical / Important / Minor, each with file:line and a concrete fix. No style comments.
```

- [ ] **Step 2: Fix every Critical and Important finding; re-run Task 31 Steps 1–2**

For each fix: a failing test first where the finding is testable (SQL: an assertion in `assert-solar-tariff-selection-roles.sql` run red on the unfixed migration, then green; TS: a unit test), then the fix, then the full Task 31 Steps 1–2. Record each finding and its disposition in `$S/review-a.md`.

- [ ] **Step 3: Reviewer B — spec coverage, UX rules, tests**

```
Review branch feat/solar-phase-2b, range origin/feat/solar-integration..HEAD. Lens: spec coverage and product rules.
Spec: docs/solar/01-functional-spec.md §0.4 (rules for every control), §5 (Tariff tab — every control row) and
§12 (platform tariff library — every row). Plan: docs/superpowers/plans/2026-09-28-solar-phase-2b-tariff-ui*.md.
1. Table: every §5 and §12 control row -> the file/component that implements it, or MISSING.
2. §0.4 on every new control: two-step inline confirm for destructive actions (never window.confirm);
   expectedUpdatedAt on every save; units on every number; buttons disabled + spinner while async;
   human sentences, never raw Postgres text; every list has an empty state with its one action.
3. Server -> client props are JSON only (no functions passed from a page.tsx to a 'use client' component).
4. Tests: for each new test file, name one assertion that could NOT fail (decorative) and say how to make it bite.
5. Any spec behaviour the plan deferred (index "Open questions") that the code silently half-implements.
Report: Critical / Important / Minor with file:line and a concrete fix.
```

- [ ] **Step 4: Fix every Critical and Important finding; re-run Task 31 in full**

Same discipline as Step 2; record in `$S/review-b.md`. Minor findings: fix if trivial, otherwise list them in the PR body under "Known gaps".

- [ ] **Step 5: Commit the fixes**

```bash
git add -A
git status --short   # must list only files this plan owns; nothing under another phase's paths
git commit -m "fix(solar-tariff): review findings (security + spec coverage)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 33: Push and open the DRAFT PR

**Files:**
- Create: `$S/pr-2b.md` (not committed)

- [ ] **Step 1: Re-check the migration number against all three places (G3)**

```bash
git fetch origin
git ls-tree --name-only origin/main apps/edge-functions/supabase/migrations/ | tail -3
gh pr list --state open --json number,headRefName --jq '.[].headRefName' | while read b; do
  git ls-tree --name-only "origin/$b" apps/edge-functions/supabase/migrations/ 2>/dev/null | grep -E '/0021[3-9]_' | sed "s|^|$b: |"; done
. scripts/db/mgmt-api.sh && mgmt_query "SELECT max(version) FROM supabase_migrations.schema_migrations;"
```
Expected: no other branch or PR carries `00213_*`, and the ledger head is below `00213`. If `00213` is taken, renumber (`git mv`), update every `00213` string in the migration header, the assertions header and `docs/rbac-matrix.md`, re-run Task 31 Step 2, and note it in the PR body. (This branch does **not** apply the migration: the owner applies after the integration merge.)

- [ ] **Step 2: Push over SSH**

```bash
git push -u git@github.com:WattMatt/e-site.git feat/solar-phase-2b
```

- [ ] **Step 3: Write the PR body**

Write `$S/pr-2b.md` with these sections (fill every bracket from `$S/evidence-2b.md`, `$S/review-a.md`, `$S/review-b.md`):
```markdown
## Solar Phase 2b — platform tariff library UI + project Tariff tab

Spec: docs/solar/01-functional-spec.md §5, §12; docs/solar/03-data-model-and-security.md §3; D-03, D-03b, D-07, D-10, D-29.
Plan: docs/superpowers/plans/2026-09-28-solar-phase-2b-tariff-ui*.md (decisions D2b-1 … D2b-11).

### What ships
- `/admin/tariffs` (platform tariff admins only, 404 otherwise): licensee registry + aliases; verified source upload
  (browser sha256 → signed upload → server re-hash); ingest (workbooks inline via the 2a core, dry run → apply; RfD PDFs
  queued for `scripts/tariffs/ingest-worker.ts`); review queue with each charge beside its PDF page crop / workbook cell;
  automatic checks; YoY diff; fingerprinted Validate; Publish (00209 rules); SSEG rule editor; TOU calendars + holiday
  treatment; reported-error queue; due-year alerts (+ "check now").
- `/projects/[id]/solar/tariff` (Edit + financials): financial year, eligible-tariff picker, charges with View source,
  TOU diagram (assumed_eskom banner), export/SSEG rule incl. manual municipal rate with mandatory source note, project
  override with per-row reason + unit (D-10), escalation path (D-07), bill check (±5 %), report a tariff error.
- Migration `00213_solar_tariff_selection.sql` (NOT applied): studies tariff columns behind a money-level guard; money
  tables on solar_can_see_money; tariffs.error_report / ingest_job / due_year_alert; validation fingerprint; job claim;
  due-year monitor.

### Evidence
- Dry run against production, rolled back: RED without 00213 ([paste]); GREEN [61/61]; mutations M1–M7 each red ([paste]).
- `@verify` blocks of 00207/00208/00209/00210/00213 evaluated under the post-00213 state: all `failed=0`.
- Suites: shared [n], web [n], db [n]; type-check ×2 clean; lint ×2 clean; `next build` exit 0.
- Reviewers: A (security) [findings → dispositions]; B (spec) [findings → dispositions].

### Owner steps after merge (in order)
1. Re-check the ledger / origin/main / open-PR migration numbers; apply 00213 through the deploy workflow; run
   `scripts/verify-migration-applied.ts` (it re-checks every block ≥ 00185).
2. Schedule the due-year monitor (Management API, as the other pg_cron jobs):
   `SELECT cron.schedule('tariffs-due-year-eskom', '0 5 1 4 *', $c$SELECT tariffs.record_due_year_alerts('eskom')$c$);`
   `SELECT cron.schedule('tariffs-due-year-municipal', '0 5 1 7 *', $c$SELECT tariffs.record_due_year_alerts('municipal')$c$);`
3. Add the first platform tariff admin (service role): `INSERT INTO public.platform_tariff_admins (user_id) VALUES ('<uuid>');`
4. On the staff Mac: `brew install poppler`, then run `ingest-worker.ts` (see its header) while PDF ingests are queued.
5. Signed-in walk (not verifiable by the agent): as a tariff admin — upload a workbook, dry run, apply, review, check,
   publish; as an Edit + financials user — pick the tariff, open View source, save an export rule, create/edit/revert an
   override, record a bill check, report an error; as an Edit user — confirm the Tariff tab is absent and a direct
   `/solar/tariff` visit lands on /solar/locked.

### Known gaps
- [Minor review findings not fixed, with reasons]
- No product_events verbs (D2b-8); bill check is enter-only (no bill upload); the report's "Project-specific rates"
  line belongs to the Reports phase (flag: `studies.tariff_override_id IS NOT NULL`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Open the draft PR**

```bash
gh pr create --draft --base feat/solar-integration --head feat/solar-phase-2b \
  --title "Solar Phase 2b: platform tariff library UI + project Tariff tab (00213)" --body-file "$S/pr-2b.md"
gh pr view --json number,url,isDraft,baseRefName --jq '{number,url,isDraft,baseRefName}'
```
Expected: `isDraft: true`, `baseRefName: feat/solar-integration`. Report the URL.
