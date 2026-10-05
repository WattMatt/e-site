# Rate library — implementation plan (E6)

Spec: `docs/superpowers/specs/2026-10-05-rate-library-design.md`. One PR (`feat/rate-library`). TDD per task. Every guard is shown red before green.

1. **Migration** `00224_rate_library.sql` (renumber above the head at merge time). Tables, the trigger that makes observations immutable, the gate function, per-verb policies, grants, CPI seed, and an `@verify` block. `scripts/db/assert-rate-library-roles.sql` impersonates real roles: owner sees rows, contractor and client_viewer see none, nobody can UPDATE or DELETE an observation. Dry-run it red against a no-op first, then green with the migration.
2. **Shared** `packages/shared/src/rate-library/`:
   - `normalise.ts` and `rules.ts` hold the matcher. `match.ts` returns signature, confidence and method.
   - `stats.ts` computes n, min, median, P75, max and latest with linear-interpolated percentiles.
   - `escalate.ts` holds the CPI factor.
   - `group.ts` builds group keys and collapses repeated rates.
   - `budget-csv.ts` writes the export.
   - The labelled-sample fixture comes with a precision test.
3. **Web data layer** `apps/web/src/lib/rate-library/` covers queries, the access log and the Sunbird row parser. `apps/web/src/actions/rate-library-catalogue.actions.ts` holds the review actions: confirm, assign, create, exclude, AI suggest. Every action is role-gated and asserts rows affected.
4. **Web UI** gets `/rates`, `/rates/[itemId]`, `/rates/review` and `/rates/sources`. A sidebar entry appears for `COST_VIEW_ROLES` only. `docs/rbac-matrix.md` gains rows in the same PR.
5. **Export** at `GET /api/rates/export?stat=median|p75`, gated and logged.
6. **Price from library** adds a panel on `/projects/[id]/settings/rates`: preview, then apply to `boq_items` with the user's client so RLS decides.
7. **Backfill script** with its reconciliation report. Run it on production after merge, then measure precision on the populated library.
8. **Verify** web, `@esite/shared` and `@esite/db` tests, type-check, lint and `next build`. Then an independent review, merge, deploy, and a production smoke test.
