# WM CP → E-Site v2 Data Migration Runbook

Companion to [`scripts/migration/migrate-wm-cp.ts`](../scripts/migration/migrate-wm-cp.ts) (T-058). Everything below must be agreed and prepared **before** running a live migration. Read top to bottom.

---

## 0. Source projects

| Project ref | Role | What lives here |
|---|---|---|
| `oltzgidkjxwsukvkomof` | Compliance | `profiles`, `sites`, `subsections`, `coc_uploads` |
| `rsdisaisxdglmdmzmkyw` | Nexus | `projects`, `snags` |

Profiles are pulled from the **compliance** source (assumed canonical). If nexus has users the compliance DB doesn't, add a second `migrateProfiles(nexus, ...)` pass before the live run.

---

## 1. What the script does

1. Create the founder organisation (`Watson Mattheus`, slug `watson-mattheus`, tier `professional`).
2. `migrateProfiles` — invite every legacy user to the new Supabase project via `auth.admin.inviteUserByEmail`. Each user receives a set-password email. Legacy IDs are mapped to new auth-user IDs in `profileMap`.
3. `migrateMemberships` — insert a `user_organisations` row for every migrated user. Role is resolved from the legacy `role` column via `ROLE_MAP`; unknown values default to `project_manager`. **Without this step users authenticate but RLS returns empty results.**
4. `migrateComplianceSites` / `migrateSubsections` / `migrateCocUploads`.
5. `migrateProjects` / `migrateSnags`.
6. Verify: row counts per table, plus a 20-row spot check per table dumped to stdout.

Everything is idempotent: upserts use `onConflict` clauses keyed on the legacy UUID, so re-running does not duplicate rows.

---

## 2. Required environment

```bash
export LEGACY_COMPLIANCE_URL="https://oltzgidkjxwsukvkomof.supabase.co"
export LEGACY_COMPLIANCE_KEY="<service_role_key>"     # from legacy dashboard
export LEGACY_NEXUS_URL="https://rsdisaisxdglmdmzmkyw.supabase.co"
export LEGACY_NEXUS_KEY="<service_role_key>"          # from legacy dashboard
export SUPABASE_URL="https://<new-ref>.supabase.co"   # new project
export SUPABASE_SERVICE_ROLE_KEY="<new_service_key>"  # new project
export FOUNDER_ORG_NAME="Watson Mattheus"             # optional override
```

Run order:

```bash
# 1. Dry run — prints inserts without writing. Use this every time before a live run.
DRY_RUN=true npx ts-node scripts/migration/migrate-wm-cp.ts

# 2. Live run.
npx ts-node scripts/migration/migrate-wm-cp.ts
```

---

## 3. Prerequisites

- [ ] New e-site Supabase project exists and all 24 migrations have been applied (see `docs/staging-deployment-checklist.md` § 1).
- [ ] RLS policies are live on every table the migration writes to (otherwise service-role writes are fine but subsequent reads by migrated users will fail).
- [ ] Storage buckets `coc-documents`, `snag-photos`, `site-attachments`, `avatars` exist on the new project.
- [ ] Auth emails are wired (SMTP configured in Supabase → Settings → Auth). Otherwise invite emails silently fail and users never receive the set-password link.
- [ ] Legacy service-role keys rotated **after** the migration to prevent the script running accidentally a second time against a stale env.

---

## 4. Known gaps — decide before running live

Each row is something the current script does not handle. Decide the disposition before kicking off the live run.

| Gap | Why it matters | Options |
|---|---|---|
| Password hashes | Legacy passwords are not migrated (Supabase auth admin does not expose them). | Accept — script sends invite emails. Users set a new password on first login. |
| Storage file bytes | `coc_uploads.file_path` is preserved but the actual file bytes in the legacy bucket are not copied. | (a) Pre-copy files via `supabase storage cp` before the migration, (b) mark all rows as `status='pending'` after migration and re-upload, (c) accept data-only migration and re-upload manually. |
| Snag attachments | Legacy snag photos not pulled. | Add a `migrateSnagAttachments` step pulling from legacy `snag_photos` / storage. Write it after confirming the legacy schema. |
| Role mapping | `ROLE_MAP` covers the roles observed during spec work; new legacy roles default to `project_manager`. | Inspect the distinct values in legacy `profiles.role` and extend `ROLE_MAP` before running. |
| Organisation membership sharing | Every legacy user joins the single founder org. If WM CP had multiple client orgs, this collapses them. | Confirm WM CP is single-tenant. If not, add per-org splitting logic. |
| Cross-org marketplace data | Not applicable — WM CP does not have marketplace data. No action needed. | — |

Until each row above is acknowledged (or implemented), the migration is **not production-ready**.

---

## 5. Verification after live run

1. `stats.errors === 0` in the script output — no warnings emitted.
2. Row counts from `verifyRowCounts` match counts you captured from the legacy projects before the run.
3. Spot-check sample dumped by `spotCheckSamples` matches human-readable legacy records (20 per table).
4. Log into the new project as one migrated user (password-reset → set new password). Confirm:
   - Projects list renders with their legacy projects.
   - At least one subsection in the compliance tree is visible.
   - No "no organisation" error (membership insert worked).
5. Run `pnpm test:ci` — the RLS integration tests should pass against the migrated data.
6. `psql` spot-check:
   ```sql
   -- No orphaned rows (subsection without site, snag without project, etc.)
   SELECT count(*) FROM compliance.subsections s
   LEFT JOIN compliance.sites t ON t.id = s.site_id
   WHERE t.id IS NULL;

   SELECT count(*) FROM field.snags s
   LEFT JOIN projects.projects p ON p.id = s.project_id
   WHERE p.id IS NULL;
   ```

---

## 6. Rollback

The script is append-only — every write uses `upsert` keyed on the legacy UUID. To roll back:

```sql
-- Run against the new project. Deletes in FK-safe order.
DELETE FROM field.snags                WHERE organisation_id = '<founder_org_id>';
DELETE FROM projects.projects          WHERE organisation_id = '<founder_org_id>';
DELETE FROM compliance.coc_uploads     WHERE organisation_id = '<founder_org_id>';
DELETE FROM compliance.subsections     WHERE organisation_id = '<founder_org_id>';
DELETE FROM compliance.sites           WHERE organisation_id = '<founder_org_id>';
DELETE FROM public.user_organisations  WHERE organisation_id = '<founder_org_id>';
DELETE FROM public.organisations       WHERE id              = '<founder_org_id>';
-- Note: auth.users rows are NOT deleted — delete manually in Supabase
-- dashboard under Authentication → Users if a full reset is needed.
```

Then re-run the script once fixes are in place.

---

## 7. Sign-off

| Step | Owner | Date | Status |
|---|---|---|---|
| Legacy credentials pulled |  |  |  |
| Gaps reviewed + dispositions agreed |  |  |  |
| Dry run clean (zero errors) |  |  |  |
| Live run complete |  |  |  |
| Verification complete |  |  |  |
| T-058 signed off (Arno) |  |  |  |
