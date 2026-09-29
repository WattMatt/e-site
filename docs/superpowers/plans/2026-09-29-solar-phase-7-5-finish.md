# Solar Phase 7 — Part 5: RBAC matrix, verification, review, push, draft PR

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-29-solar-phase-7-0-index.md` first.

---

### Task 32: `docs/rbac-matrix.md` — every new route and action

**Files:**
- Modify: `docs/rbac-matrix.md`

- [ ] **Step 1: Find the Solar section the earlier phases added.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
grep -n -i "solar" docs/rbac-matrix.md | head -40
```

- [ ] **Step 2: Append these rows to the Solar table** (keep the table's existing column order: Route / action · Gate · Notes — if the table has different columns, map each row's three facts onto them):

```markdown
| `/projects/[id]/solar/operations` (page) | Solar View (`requireSolarLevel 'view'`) | Technical reads for View; Edit sees write controls; the monthly report panel renders only at Edit + financials. Reads through the caller's session (00217 RLS). |
| `createInstallationAction` | Solar Edit | Only from the study's ACCEPTED proposal (00217 bind trigger re-checks). Seeds a P50 guarantee and the handover checklist. Service client only to read the accepted proposal's run after the gate. |
| `saveInstallationAction` | Solar Edit | Commissioning date, as-built, notes; stale-guarded. The baseline is immutable (trigger). |
| `linkMeterAction` / `unlinkMeterAction` / `setMeterShareAction` | Solar Edit | Generation = meter kind `solar`; consumption = `council`/`bulk` (00217 refuses anything else). |
| `saveGuaranteeAction` | Solar Edit | Basis fields mirror the 00217 CHECKs. |
| `saveIrradiationAction` / `deleteIrradiationAction` | Solar Edit | Monthly POA/GHI with a mandatory source note. |
| `addDowntimeAction` / `updateDowntimeAction` / `deleteDowntimeAction` | Solar Edit | No overlap, never before commissioning; every direct edit/delete copied to `solar.downtime_history` (append-only, no grant). |
| `linkHandoverDocumentAction` / `setHandoverNotApplicableAction` / `syncHandoverItemsAction` | Solar Edit | A document must be a `tenants.documents` row of the same project (trigger). |
| `saveHandoverTemplateAction` | Org owner/admin (`requireRole OWNER_ADMIN`) | `/settings/solar`; 00217 RESTRICTIVE policies use `library_orgs('admin')`. |
| `generateSolarMonthlyReportAction` | Solar Edit + financials | Writes `projects.reports` (kind `solar_monthly`) and `solar.monthly_reports` with the SERVICE role after the gate; `monthly_reports` has no user write policy and no UPDATE/DELETE grant. Disabled with the reason when no tariff is pinned. |
| `saveMonthlyReportNoteAction` | Solar Edit + financials | `solar.monthly_report_notes` read and write on `solar_can_see_money`. |
| Saved report kind `solar_monthly` (list / signed URL) | Solar Edit + financials | `SOLAR_READ_REPORT_KINDS` + `user_can_read_report_kind()` (00217). Never deletable (`deleteProjectReportAction` refuses). |
| `public.solar_ops_monthly_kwh` / `public.solar_ops_series` (RPC) | `authenticated`, SECURITY INVOKER | RLS on meters/channels/readings decides; anon has no EXECUTE. |
```

- [ ] **Step 3: Commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
git add docs/rbac-matrix.md
git commit -m "docs(rbac): Solar Operations routes, actions and the solar_monthly report kind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 33: Full verification (nothing is claimed that was not run)

**Files:** none.

- [ ] **Step 1: Three suites, type-check, lint, web build.** Each must be green; record the counts against Task 0 Step 6.

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test 2>&1 | tail -4
pnpm --filter web test 2>&1 | tail -4
pnpm --filter @esite/db test:ci 2>&1 | tail -4
pnpm --filter web type-check 2>&1 | tail -4
pnpm --filter @esite/shared type-check 2>&1 | tail -4
pnpm --filter web lint 2>&1 | tail -6
pnpm --filter web build 2>&1 | tail -15
```
Expected: all pass; `next build` exits 0 and lists `/projects/[id]/solar/operations`. A failure goes back to the task that owns the file — never loosen a test.

- [ ] **Step 2: The database proof, once more on the final migration text.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
S=/private/tmp/claude-501/solar-7; M=apps/edge-functions/supabase/migrations
cat $S/base.sql $M/00217_solar_operations.sql > $S/green.sql
scripts/db/dry-run-migration.sh $S/green.sql scripts/db/assert-solar-operations-roles.sql 2>&1 | grep -c 'true'
scripts/db/dry-run-migration.sh $S/green.sql scripts/db/assert-solar-operations-roles.sql 2>&1 | grep -iE 'false|error' || echo "00217 assertions all true"
scripts/db/dry-run-migration.sh $S/green.sql $(ls scripts/db/assert-solar-*-roles.sql | grep -v operations) 2>&1 | grep -iE 'false|error' || echo "earlier Solar assertions still green"
pnpm --filter web test -- src/lib/migration-verify-block.contract.test.ts 2>&1 | tail -3
```
Expected: `67`; `00217 assertions all true`; `earlier Solar assertions still green`; the verify-block contract passes. If `00217` changed after Task 3, re-run the eight mutations from Task 3 and update the ledger.

- [ ] **Step 3: The browser never runs the engine; no WM strings; no em dash in `sql:`.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter web test -- src/lib/solar/no-browser-engine.contract.test.ts src/lib/solar/reports/branding.test.ts src/lib/reports/report-kind-access 2>&1 | tail -4
grep -n '^-- sql:' apps/edge-functions/supabase/migrations/00217_solar_operations.sql | grep '—' || echo "no em dash in sql payloads"
```

- [ ] **Step 4: Spec §10 walk-through against the code (write the answers into the PR body).** For each row of spec §10 name the file that implements it: installation + as-built (InstallationCard, createInstallationAction, 00217 installations), guarantee (GuaranteeCard, guarantee.ts), import (GenerationImport → Phase 3a routes; dedupe in `solar_ops_*`), performance table (PerformanceTable, performance.ts), downtime + candidates (DowntimeLog, downtime-detect.ts), Generate (MonthlyReportPanel, monthly-report.ts), editor (notes), handover (HandoverChecklist, HandoverTemplateForm). And for each WM defect of as-is 06 D.8/E.8 named in the index, the test that pins it: G3 re-import doubling → `reimport_does_not_double` (SQL) + mutation 1; G4 months from the UI → `month_from_interval_start` + mutation 2; G5 council double-count → `council_as_generation_REFUSED` + mutation 4; G14 fixed window → `downtime-detect.test.ts` solstice cases; G13 flat tariff → `lost-revenue.test.ts`; D.7 guarantee retyped → `guarantee.test.ts`; M2 no snapshot → `service_writes_two_versions`; M1 freezing on edit → `saveMonthlyReportNoteAction` test ("never touches a stored report") + `report_v2_leaves_v1_unchanged` + mutation 3; M4 YTD repeating the month → `performance.test.ts` yearToDate; M4 placeholder equipment → `render-monthly.render.test.ts` + `equipmentComplete`; M3/G12 1,000-row cap → `series_not_capped_at_1000`.

No commit for Task 33.

---

### Task 34: Two reviewers (foreground), fix confirmed findings

**Files:** whatever the confirmed findings touch.

- [ ] **Step 1: Dispatch both reviewers in ONE message, foreground** (`run_in_background: false`), `subagent_type: superpowers:code-reviewer`, each with the diff `git diff origin/feat/solar-phase-6...HEAD` as its scope:

Reviewer A — security and data:
> Review branch feat/solar-phase-7 in /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7 against origin/feat/solar-phase-6 (read-only; do not commit). Focus: migration 00217_solar_operations.sql and every server action. Check: FORCE RLS on every new table; exactly one PERMISSIVE policy per table covers SELECT and it is `solar_can_view` (money tables `solar_can_see_money`); no RESTRICTIVE `FOR ALL`; per-verb RESTRICTIVE write policies; `monthly_reports` and `downtime_history` have no user write path and no UPDATE/DELETE grant (service_role included for monthly_reports); every SECURITY DEFINER function has `SET search_path = ''` and is revoked from PUBLIC and anon in the text; the two INVOKER functions cannot leak across orgs (RLS on meters/channels/readings); triggers cannot be bypassed by forging organisation_id/project_id; every action gates its Solar level before any read or write and uses the service client only after the gate; the generation import cannot link a meter from another org; nothing returns raw database text. Also check the `@verify` block parses (no prose, no em dash in `sql:`) and that no earlier migration's `@verify` block names an object 00217 drops or replaces. Report each finding with file:line, severity, and a concrete failing scenario; say "no findings" per area when clean.

Reviewer B — spec and correctness:
> Review branch feat/solar-phase-7 in /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7 against origin/feat/solar-phase-6 (read-only; do not commit) against docs/solar/01-functional-spec.md §10 and §2.3, docs/solar/03-data-model-and-security.md §3, and docs/solar/as-is/06-proposals-schedule-docs-generation-reports.md Parts D and E. Check every §10 control exists and behaves as specified; that month bucketing uses the SAST interval START everywhere (SQL and TS agree); that a re-import of overlapping data cannot double any figure on the page or in the report; that lost kWh uses the shaped expectation and lost revenue the pinned tariff via the bill engine; that YTD is a real sum; that the report prints no placeholder and no Rand when no tariff is pinned (Generate is disabled); that notes never change a stored snapshot; that a View user sees no money and no write control; that the PDF passes every string through pdfText. Look for off-by-one errors in proration, leap February, month boundaries and the 8760 hour index. Report each finding with file:line, severity and a concrete input that shows it; say "no findings" per area when clean.

- [ ] **Step 2: For each finding: reproduce it with a failing test (or assertion row) first, fix, re-run.** Reject a finding only with evidence (quote the code that already handles it). Re-run Task 33 Steps 1–3 after the last fix.

- [ ] **Step 3: Commit the fixes** (one commit per finding family), each with the trailer:
```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

---

### Task 35: Push and open the DRAFT PR

**Files:**
- Create (scratch, not committed): `/private/tmp/claude-501/solar-7/pr-body.md`

- [ ] **Step 1: Re-check the migration number in all three places** (it is claimed at APPLY time, which this PR does not do — this is the branch check).

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
git fetch origin
for r in $(git branch -r | grep -v HEAD); do git ls-tree -r --name-only $r -- apps/edge-functions/supabase/migrations | grep -F '00217_' | sed "s|^|$r: |"; done
gh pr list --state open --json number,files --jq '.[] | select(any(.files[]; .path | test("migrations/00217"))) | .number'
```
Expected: no output other than this branch. Any other holder → STOP and ask for a number.

- [ ] **Step 2: Push over SSH.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
git push -u git@github.com:WattMatt/e-site.git feat/solar-phase-7
```

- [ ] **Step 3: Write the PR body** with the Write tool to `/private/tmp/claude-501/solar-7/pr-body.md`, filling the bracketed `[n]` counts from Tasks 0, 3 and 33 and the Phase 6 PR number, and pasting the two lists the body names:

```markdown
## Solar Phase 7 — Operations tab (post-installation)

Spec: `docs/solar/01-functional-spec.md` §10 and §2.3 (Operations readiness); `docs/solar/03-data-model-and-security.md` §3; as-is `06` Parts D/E (WM defects not repeated). Plan: `docs/superpowers/plans/2026-09-29-solar-phase-7-*.md`. Stacked on #<phase-6 PR> (`feat/solar-phase-6`).

### What
- **Installation** from the ACCEPTED proposal: its run frozen into the row as the modelled baseline (monthly P50, 12×24 diurnal profile, TMY GHI, design PR); as-built equipment editable; commissioning date.
- **Guarantee basis** (P50 / % of modelled / manual 12-month schedule), derived per month — never retyped; commissioning month prorated; degradation from operating year 2; leap February scaled.
- **Import generation data** through the existing meter pipeline (meter kind `solar`); months from the data's own timestamps (SAST interval start); one reading per meter per interval, so re-importing REPLACES.
- **Monthly performance table**: expected, excluded downtime, guarantee, actual, variance, PR and irradiation-corrected expected (monthly POA/GHI entry with a source note), downtime hours, data coverage.
- **Downtime log** + SPA-detected candidates (sun > 5°, output ≤ 0.5 % of AC kW, ≥ 2 consecutive intervals; gaps are never downtime) to confirm; append-only history of every edit/delete.
- **Monthly report** (`projects.reports` kind `solar_monthly` + `solar.monthly_reports` snapshot + PDF with SHA-256s): per-source expected vs actual, real YTD, downtime with lost kWh and lost revenue at the pinned tariff's TOU rates via the bill engine, equipment from the installation record, realised consumption from the council/bulk meter, commentary kept separate. v(n+1) supersedes v(n)'s report row and never edits v(n). Disabled with the tariff reason when no tariff is pinned.
- **Handover checklist** from the org template ("Solar PV Handover", editable in /settings/solar), each item linked to one E-Site Documents file or N/A; completion %.
- Operations tab visible, readiness rule live (§2.3).

### Migration `00217_solar_operations.sql` — NOT applied (draft)
Ten `solar.*` tables, two SECURITY INVOKER aggregation functions, `solar_monthly` in `user_can_read_report_kind()` (redefined in full with every Solar kind), five product events. `@verify` block included. **The number is claimed at apply time**: re-check the ledger, `origin/main` and open-PR filenames immediately before applying.

Behavioural assertions: `scripts/db/assert-solar-operations-roles.sql` — RED without 00217, GREEN [67]/67 with it; every earlier Solar assertion file still green on top.

Mutation ledger (each assertion shown able to fail):
1. dedupe removed → `reimport_does_not_double`, `series_one_value_per_interval` red
2. month by interval END → `month_from_interval_start` red
3. monthly report versions made editable → `service_update_v1_REFUSED`, `owner_update_v1_REFUSED`, `report_v2_leaves_v1_unchanged` red
4. generation kind check removed → `council_as_generation_REFUSED`, `tenant_as_generation_REFUSED` red
5. commentary read on `solar_can_view` → `editor_reads_no_notes` red
6. snapshots read on `solar_can_view` → `no_money_reads_no_monthly_reports_editor/view` red
7. `solar_monthly` dropped from the kind gate → `money_user_reads_monthly_kind`, `money_user_lists_monthly_report` red
8. overlap check removed → `downtime_overlap_REFUSED` red

### Verified
- `@esite/shared` [n] (was [n]), `web` [n] (was [n]), `@esite/db` [n]; type-check, lint, `next build` exit 0.
- Contracts: no-browser-engine (now also forbids `@esite/shared/solar-operations` runtime in client files), report-kind access (writer + final SQL gate), product events, WM-string guard, WinAnsi render test (mutation-proven by removing one `pdfText`).

### NOT verified
- **The signed-in walk.** Someone with Solar Edit + financials must: open Operations on a project with an accepted proposal → Record installation → set the commissioning date → import a real inverter/portal CSV twice (the second time the month's kWh must not change) → check the performance row → confirm a candidate → generate a monthly report (needs a pinned tariff, Phase 2b) → generate it again (v2; v1 still downloadable and unchanged) → link a handover document.
- Touch/tablet; `packages/db/src/types.ts` not regenerated (actions cast `.schema('solar')`).

### Decisions taken (owner may overrule)
(Paste the numbered list under "Decisions this plan takes" in `2026-09-29-solar-phase-7-0-index.md`, unchanged.)

### Open questions
(Paste the numbered list under "Open questions" in `2026-09-29-solar-phase-7-0-index.md`, unchanged.)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 4: Open the draft PR onto the Phase 6 branch.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
gh pr create --draft --base feat/solar-phase-6 --head feat/solar-phase-7 \
  --title "feat(solar): Phase 7 — Operations tab (installation, guarantee, generation, downtime, monthly report, handover)" \
  --body-file /private/tmp/claude-501/solar-7/pr-body.md
gh pr view --json url,isDraft,baseRefName --jq '"\(.url) draft=\(.isDraft) base=\(.baseRefName)"'
```
Expected: the PR URL, `draft=true base=feat/solar-phase-6`.

- [ ] **Step 5: Session log.** If `/Volumes/Extreme SSD/Obsidian Vault/Projects/E-Site/sessions.md` exists, append a dated entry (what shipped, the PR URL, the mutation ledger, what is NOT verified). If the vault is not mounted, say so in the final report instead.
