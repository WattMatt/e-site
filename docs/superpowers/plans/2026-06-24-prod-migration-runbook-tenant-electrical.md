# Prod runbook — Tenant incomer Breaker/Load/Amps

**Feature:** persisted `incomer_*` electrical fields on `structure.nodes`, shown on the Tenant Schedule.
**Applies to:** the database behind your deployed app (where **kingswalk** lives). These steps are **not** run against local.
**Owner:** you (production-touching). Each step is copy-paste; fill in the `<…>` values.

> Everything here is **additive + nullable** — safe, and reversible (see Rollback).

---

## Step 0 — Find the kingswalk project id (Supabase SQL editor, prod)

```sql
select id, name from projects.projects where name ilike '%kingswalk%';
```
Note the `id` → call it `<KINGSWALK_ID>`.

---

## Step 1 — Apply migration `00144` to prod

**Preferred (automatic):** merging PR #96 runs the migrations CI workflow, which applies
`00144_tenant_incomer_electrical.sql` to prod. If that's your process, just merge and skip to Step 2.

**Manual alternative** (only if you apply migrations by hand), from the repo with the prod project linked:
```bash
cd apps/edge-functions
supabase link --project-ref <PROD_PROJECT_REF>   # if not already linked
supabase db push                                  # applies pending migrations incl. 00144
```

**Verify the columns exist (prod SQL editor):**
```sql
select column_name from information_schema.columns
where table_schema='structure' and table_name='nodes' and column_name like 'incomer_%'
order by 1;   -- expect 8 rows
```

---

## Step 2 — Backfill existing tenants

The on-screen columns read the persisted `incomer_*` fields. New cable edits recompute automatically;
**existing** data needs a one-time backfill.

Get the prod credentials from the Vercel project env (or Supabase dashboard → Project Settings → API):
- `NEXT_PUBLIC_SUPABASE_URL` = your prod project URL (e.g. `https://<ref>.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` = the **service_role** key (secret — do not commit/log)

Run **kingswalk first** (safe, scoped), from the repo root on the `feat/settings-tabs-improvements` branch (or `main` after merge):
```bash
NEXT_PUBLIC_SUPABASE_URL='https://<ref>.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<PROD_SERVICE_ROLE_KEY>' \
PROJECT_ID='<KINGSWALK_ID>' \
  pnpm --filter @esite/shared exec node --import tsx ../../scripts/db/backfill-tenant-electrical.ts
```
Expected output: `<KINGSWALK_ID>: <n> tenant node(s) recomputed`.

Then **all projects** (omit `PROJECT_ID`):
```bash
NEXT_PUBLIC_SUPABASE_URL='https://<ref>.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<PROD_SERVICE_ROLE_KEY>' \
  pnpm --filter @esite/shared exec node --import tsx ../../scripts/db/backfill-tenant-electrical.ts
```

> The script is idempotent — safe to re-run. It only reads cable_schedule + writes `structure.nodes.incomer_*`.

---

## Step 3 — Verify on kingswalk (prod SQL editor)

```sql
select shop_number, code,
       incomer_load_a, incomer_breaker_a, incomer_pole_config,
       incomer_capacity_a, incomer_under_protected, incomer_multiple_feeds
from structure.nodes
where project_id='<KINGSWALK_ID>' and kind='tenant_db'
order by incomer_load_a desc nulls last
limit 20;
```
Spot-check a known shop (e.g. shop 67 / DB-67): `incomer_load_a` = its supply design load,
`incomer_breaker_a` = next standard size above it, `incomer_pole_config` = TP for 3/3+E/4-core.
Tenants with no cable feed correctly show `NULL` (render as `—`).

Then open the Tenant Schedule in the app → the **Breaker / Load / Amps** columns appear after **DB Code**.

---

## Notes & rollback

- **Ordering:** apply the migration before the backfill. The app tolerates missing columns (reads via `select('*')`), so a code deploy ahead of the migration won't crash — columns just read empty until both land.
- **Coverage:** going forward, recompute fires on cable/supply create, update, delete, repoint, and on revision create/issue/discard. A bulk re-sync is just a re-run of Step 2.
- **Rollback (if ever needed):** the columns are additive/nullable.
  ```sql
  alter table structure.nodes
    drop column if exists incomer_breaker_a,
    drop column if exists incomer_pole_config,
    drop column if exists incomer_load_a,
    drop column if exists incomer_capacity_a,
    drop column if exists incomer_under_protected,
    drop column if exists incomer_multiple_feeds,
    drop column if exists incomer_source_revision_id,
    drop column if exists incomer_computed_at;
  notify pgrst, 'reload schema';
  ```
