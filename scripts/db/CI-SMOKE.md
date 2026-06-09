# Wiring the DB smoke tests into CI

**Why:** the hard-delete's safety relies on exact FK `ON DELETE` behaviour, and the
equipment-order trigger (00121) on an `AFTER INSERT`. Both are proven by
`scripts/db/smoke-test-tenant-hard-delete.sh` (catalog read) and
`scripts/db/smoke-test-equipment-order-trigger.sh` (transactional rollback) — but
those are **manual** today. Pre-mortem risk #6: a future migration silently changes
an `ON DELETE` and nobody re-runs them. This wires them to run automatically
whenever a migration lands.

**Where:** the `deploy-migrations.yml` workflow — it already triggers on
`migrations/**` pushes to `main` and already has the `SUPABASE_ACCESS_TOKEN` /
`SUPABASE_PROJECT_REF` secrets. Running the smoke tests right after the migration
applies verifies the new schema still satisfies the invariants.

## ✅ Done (shipped)
`scripts/db/mgmt-api.sh` now resolves the Management API PAT from the
`SUPABASE_ACCESS_TOKEN` env var when set (CI has no macOS keychain), falling back
to the keychain locally. Verified: the FK smoke passes via the env-var path with
the keychain unreachable, and the local keychain path is unchanged.

## ⏳ Remaining (one manual step — needs the `workflow` push scope)
Add this step to `.github/workflows/deploy-migrations.yml`, **immediately after the
`Run migrations` step** (it runs at the repo root — no `working-directory` — so it
can see `scripts/db/`; `jq`/`curl` are preinstalled on `ubuntu-latest`):

```yaml
      - name: Verify schema invariants (FK behaviour + equipment trigger)
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_PROJECT_REF: ${{ secrets.SUPABASE_PROJECT_REF }}
        run: |
          bash scripts/db/smoke-test-tenant-hard-delete.sh
          bash scripts/db/smoke-test-equipment-order-trigger.sh
```

A failed smoke (an FK behaviour changed, or the trigger missing) fails the deploy
run — exactly the early warning we want.

### How to land it (pick one)
- `gh auth refresh -h github.com -s workflow`, then edit the file + push; **or**
- edit `deploy-migrations.yml` directly in the GitHub web editor (no extra scope
  needed there).

A direct OAuth `git push` touching `.github/workflows/**` is rejected without the
`workflow` scope — that's the only reason this step isn't already in place.
