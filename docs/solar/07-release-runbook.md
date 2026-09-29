# E-Site Solar add-on — release runbook (phases 1–7)

**Branch:** `feat/solar-release` (release assembly of #216 phases 1–5b, #217 phase 6, #219 phase 7,
with #215 and #218 merged in). **Owner-only steps.** An agent session built and dry-ran this; it
applied nothing to production.

Every step is in order. Do not skip ahead: several steps fail closed, silently, when an earlier one
is missing.

---

## 0. Before anything: re-claim the migration numbers

Claiming a number is not holding it: the ledger head moves when someone APPLIES. Immediately before
applying, check **three** places:

1. the ledger — `select max(version) from supabase_migrations.schema_migrations` (was `00206` on 2026-09-29);
2. `origin/main`'s `apps/edge-functions/supabase/migrations/`;
3. the migration filenames in every open PR (`gh pr list --state open --json number,files`).

If anything has taken a number at or above `00207`, renumber this chain above it (keep the relative
order; update every reference, including other migrations' `@verify` blocks and the assertion files'
headers), then re-run the dry run in §8. #191 (`00201`) and #193 (`00202`) are stranded below the
head; they are not this chain's concern unless their owners renumber them into `00207+`.

## 1. Merge order

1. **#218 first** (`fix/reports-storage-hardening`, migration `00207_reports_storage_hardening`). It is
   a security hotfix and the Solar chain is numbered after it. This branch already contains it, so
   merging #218 first only lands the same commits earlier.
2. Then this release branch. It supersedes #216, #217 and #219 (and the phase PRs #203–#214 they
   contain): close those as superseded once it lands.

## 2. PostgREST `db_schema` PATCH — BEFORE the migrations merge

`00208` creates schema `solar`, `00210` creates schema `tariffs`. A schema-creating migration needs
the exposed-schema list PATCHed, or REST answers `PGRST002` indefinitely (no auto-recovery).

```
GET   /v1/projects/cbskbnvvgcybmfikxgky/postgrest          # read the current db_schema list
PATCH /v1/projects/cbskbnvvgcybmfikxgky/postgrest          # send the FULL list + solar, tariffs
```

Send the full list, not just the two new names. Re-GET and confirm both are present.

## 3. Migrations — final numbers and apply order

| # | File | From |
|---|---|---|
| 00207 | `00207_reports_storage_hardening.sql` | #218 (security hotfix) — **first** |
| 00208 | `00208_solar_foundation.sql` | Phase 1 — foundation (subscription, access, studies) |
| 00209 | `00209_solar_org_settings.sql` | Phase 1 — org settings, notification types, product events |
| 00210 | `00210_tariffs_schema.sql` | Phase 2a |
| 00211 | `00211_solar_meter_data.sql` | Phase 3a |
| 00212 | `00212_solar_layouts.sql` | Phase 5 |
| 00213 | `00213_solar_schedule.sql` | Phase 5b |
| 00214 | `00214_solar_tariff_selection.sql` | Phase 2b |
| 00215 | `00215_solar_schematics.sql` | Phase 3b |
| 00216 | `00216_solar_cases.sql` | Phase 4b |
| 00217 | `00217_solar_proposals.sql` | Phase 6 |
| 00218 | `00218_solar_operations.sql` | Phase 7 |
| 00219 | `00219_solar_integration_fixes.sql` | cross-phase fixes (1–5b) |
| 00220 | `00220_solar_pricing_guards.sql` | pricing guards (I-2) + `layouts.module_id` FK |
| 00221 | `00221_solar_meter_channel_orphans.sql` | release fix (project delete vs orphaned meter channels) |

Apply through the deploy workflow (`supabase db push`, which keys on the version PREFIX). Then:

- read the ledger back — the head must be `00221` and each of the 15 versions present;
- `node --experimental-strip-types scripts/verify-migration-applied.ts --since 00207` must be green.
  **A green workflow is not evidence a migration ran.**
- The post-push verifier re-checks every migration `≥ 00185` on every deploy. On 2026-09-29 all 1,387
  checkable `@verify` directives across `00185..00221` were evaluated inside a rolled-back transaction
  after the whole chain, and all held (§8).

Before pushing any change to these files: `pnpm --filter @esite/db test:ci` (the repo-wide migration
guards), not only the web and shared suites.

## 4. Vercel environment variables (every environment unless noted)

| Variable | Why | Without it |
|---|---|---|
| `SOLAR_PRICING_HASH_KEY` | Keys the study-pricing hash inside the case hash (`pricing-hash.ts`). A random secret, **the same value in production and preview**. | Falls back to the service-role key; environments with different keys flip cases between Stale/Pricing changed and current. |
| `PAYSTACK_PLAN_SOLAR_ANNUAL` | The Paystack annual plan code for the Solar subscription (Phase 1B). | Subscribe cannot start a checkout. |
| `MAPBOX_ACCESS_TOKEN` | Server-only token for satellite roof capture (Layout, decision D-08). | `503 "Satellite capture is not configured"`. |
| `ANTHROPIC_API_KEY` | Server-only; the proposal narrative draft (Phase 6). | The narrative button stays disabled and says why. |
| `SOLAR_NARRATIVE_MODEL` | Optional model id for the narrative (default `claude-opus-5-5`). | The default is used. |

## 5. Edge functions (they do NOT auto-deploy on merge)

- **`cloud-sync-project`** — redeploy **after `00212` (layouts) and `00215` (schematics) are applied**.
  Its `isAnnotated()` now checks schematics, cards, lines, roof sources and layout objects. Deployed
  before those tables exist, the lookups error and fail CLOSED: every drawing reads as annotated,
  which silently disables Dropbox auto-adopt platform-wide.
- Deploy with `apps/edge-functions/deploy.sh cloud-sync-project`, then read `verify_jwt` and the
  version back from the Management API (and, ideally, pull the deployed bundle and grep for the new
  table names — the deployed artefact, not the repo).
- No other edge function changed in this release.

## 6. Cron jobs (pg_cron, via the Management API — not in any migration)

```sql
SELECT cron.schedule('tariffs-due-year-eskom',     '0 5 1 4 *', $c$SELECT tariffs.record_due_year_alerts('eskom')$c$);
SELECT cron.schedule('tariffs-due-year-municipal', '0 5 1 7 *', $c$SELECT tariffs.record_due_year_alerts('municipal')$c$);
```

05:00 UTC = 07:00 SAST on 1 April (Eskom year) and 1 July (municipal year). Verify with
`SELECT jobname, schedule FROM cron.job`. Schedule only after `00214` is applied.

## 7. Platform tariff library bootstrap

1. **First `public.platform_tariff_admins` row** — insert the owner's auth user id with the service
   role. Until it exists `/admin/tariffs` is a 404 for everyone (by design: the route is not advertised).
2. **Licensee registry seed** — `pnpm exec tsx scripts/tariffs/seed-licensee-registry.ts` (dry run,
   read the plan), then again with `--apply`. Run it BEFORE any ingestion so every source resolves its
   licensee by alias. It also stores the Net-Billing Rules PDF reference.
3. **Ingest** the 2026/27 workbooks with `scripts/tariffs/ingest.ts` — dry run first, then `--apply`.
   Years land `in_review`, never published. PDF sources go through the admin queue and
   `scripts/tariffs/ingest-worker.ts` on a machine with `pdftotext`.
4. **Review and publish** in `/admin/tariffs` (needs a validation verdict with 0 blocking issues and a
   signed-in platform admin).

## 8. What was verified from the agent session (2026-09-29)

- The full chain `00207 → 00221` was applied and rolled back on production
  (`scripts/db/dry-run-migration.sh`, `BEGIN … ROLLBACK`, zero residue), once per assertion file:
  every Solar assertion file, `assert-tariffs-schema-roles.sql`, #218's
  `assert-reports-storage-hardening.sql` and the new `assert-solar-meter-channel-orphans.sql` — all green.
- Every checkable `@verify` directive of `00185..00221` evaluated after the chain: all green; the same
  harness run without `00221` goes red on `00221`'s directive (so it can fail).
- Suites: web, `@esite/shared`, `@esite/db`; `tsc` (web + shared); web lint; `next build`.
  Counts are in the release PR body.

## 9. Signed-in walks still owed (an agent cannot sign in)

Walk every one **from the empty state a real user starts in, not from a deep link into seeded data**,
on a subscribed org, with the project's email toggles OFF (including the Solar proposal toggle).

- **Phase 1 (subscribe, access, site):** Solar subscribe (Paystack test mode); grant access; a
  contractor sees no Tariff/Financials tabs; Site & Supply save.
- **Phase 2 (tariffs):** platform admin — seed, ingest, review, publish; project — pin a tariff,
  override a rate, manual export rule; a View user sees no source note; the bill check and a case's
  Financials use the override and the manual rate.
- **Phase 3 (load, schematics):** import meter CSVs, assign tenants, build the site profile, check a
  parent/child pair sums correctly; place meters, draw supply lines, export a schematic sheet.
  Delete a project whose meter had two imports with the same column name — it must now succeed (00221).
- **Phase 4 (cases, financials):** New case "From layout", run, Refresh from layout; Import BOM, price,
  run financials. Then change only a tariff rate: the case must read **Pricing changed** with a
  **Re-run financials** button (not a full re-run); press it and the case reads Done. Change an energy
  input: the case reads **Stale** with **Re-run selected case**.
- **Phase 5 (layout, schedule):** roof source, calibrate, arrays, strings, export the sheet; deleting a
  layout a case uses shows "Used by a case"; schedule template, import, baseline.
- **Phase 6 (reports, proposals):** technical + feasibility reports; draft, preview and issue a
  proposal; accept it in a private window with a typed name and signature; check the bell and the
  acceptance record (IP, UA, PDF hash); withdraw, revise, confirm v2 cannot be issued once v1 was
  accepted; the narrative button with the key set; `/solar` as owner and as a View-only user.
- **Phase 7 (operations):** on a project with an accepted proposal — Record installation, set the
  commissioning date mid-month, import a real inverter/portal CSV twice (the second import must not
  change the month's kWh), check the performance row (energy before the commissioning date must not
  count — the commissioning-month clip), confirm a downtime candidate, generate a monthly report (needs
  a pinned tariff), generate it again (v2; v1 still downloadable and unchanged), link a handover document.

## 10. Known gaps carried

- `packages/db/src/types.ts` is not regenerated for `solar` / `tariffs` (actions cast `.schema(...)`).
- Konva canvases (layout, schematics) have no component tests; touch/tablet untested.
- The case CPI still drives opex; the Tariff tab rows use the org CPI.
