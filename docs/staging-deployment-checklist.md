# T-059 Staging Deployment Checklist

This checklist covers everything required to stand up the E-Site v2 platform on
the staging environment before the production launch (T-060).

**Branch:** `feat/powersync`  
**Commit:** `3390ad5` (or latest on the branch)

---

## 0. Prerequisites

Before starting, have the following ready:

| Credential | Where to find it |
|---|---|
| Staging Supabase project URL + service role key | Supabase dashboard → staging project → Settings → API |
| Staging Supabase direct DB connection string (psql) | Supabase dashboard → Settings → Database → Connection string (URI) |
| Vercel project ID + team ID | Vercel dashboard |
| `PAYSTACK_SECRET_KEY` (test mode) | Paystack dashboard → Settings → API Keys & Webhooks |
| `PAYSTACK_WEBHOOK_SECRET` | Generate a random 32-char hex string |
| PostHog project API key | PostHog project settings |
| Sentry DSN (web) | Sentry → project → Settings → Client Keys |
| EAS account with project linked | `eas whoami` |
| Apple developer / Google Play credentials | For EAS internal distribution |

---

## 1. Supabase — Apply Migrations

```bash
# From repo root
export SUPABASE_DB_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres"

# Enable pg_trgm first (required by migration 00023; idempotent if
# already enabled by the 00001 initial schema).
psql "$SUPABASE_DB_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# Run all pending migrations (00017–00028) in one command
bash scripts/db/run-migrations.sh
```

**What each migration adds:**

| Migration | What it adds |
|---|---|
| 00017 | `entry_type` enum + columns on `projects.site_diary_entries` |
| 00018 | `review_notes` column on `compliance.coc_uploads` |
| 00019 | `data` JSONB column on `public.notifications`, RLS, indexes |
| 00020 | `metadata` JSONB + `pending_eft` status on `billing.invoices` |
| 00021 | `marketplace.supplier_ratings` table |
| 00022 | `organisations.type`, `vat_number`, POPIA fields; expanded role CHECK; `marketplace.paystack_subaccounts` table |
| 00023 | Performance indexes (GIN, partial, composite) across all schemas |
| 00024 | Fix infinite recursion in `user_organisations` RLS policy via `get_user_org_ids_bypass()` |
| 00025 | RLS plumbing: GRANT USAGE + table privileges on all custom schemas to `anon`/`authenticated`/`service_role` |
| 00026 | RLS plumbing: drop recursive `user_organisations` SELECT policies, replace with `user_id = auth.uid()` |
| 00027 | RLS plumbing: harden `get_user_org_ids()` with SECURITY DEFINER; add INSERT/UPDATE policies on `project_members`, `rfis`, `site_diary_entries`, `snag_photos`, `drawings` |
| 00028 | RLS plumbing: `NOTIFY pgrst, 'reload schema'` to force PostgREST cross-schema FK re-introspection |
| 00029 | `public.organisation_health_scores` table + RLS + indexes (feeds `/admin/health` dashboard) |
| 00030 | `public.email_sequence_events` table + UNIQUE idempotency + `profiles.marketing_emails_opted_out` column |
| 00031 | Payment-recovery columns on `billing.subscriptions`; `payment_paused` status on `projects.projects` |
| 00032 | RLS write-block on `field.snags`, `projects.site_diary_entries`, `compliance.coc_uploads` when project is `payment_paused` |
| 00033 | RFI attachments: `rfi-attachments` storage bucket + `public.rfi_annotations` JSONB scene-graph + UPDATE/DELETE RLS on `public.attachments` |
| 00034 | Client_viewer project-scoped RLS: `public.user_is_client_viewer()` helper + rewritten SELECT policies on 11 tables (scopes client_viewers to assigned projects via `project_members`); RESTRICTIVE policies block client_viewer entirely from `compliance.*` and `marketplace.*` |

**Verify migrations applied:**
```sql
-- Should return 34 rows (00001–00034)
SELECT count(*) FROM supabase_migrations.schema_migrations;
```

**After migration 00029**, schedule the health-score cron (see the commented-out pg_cron block at the bottom of `00029_health_scores.sql`). Skip until `calculate-health-scores` Edge Function is deployed.

**After migration 00030**, schedule the four onboarding cron jobs + the daily reengagement check (see the commented-out block in `00030_email_sequences.sql`). Skip until the Edge Functions are deployed.

**Edge Function deploy** (all functions — use the bulk deploy in section 3):
```bash
# Required secrets (run once per environment)
supabase secrets set RESEND_API_KEY=re_... --project-ref <ref>
supabase secrets set RESEND_FROM="E-Site <noreply@e-site.co.za>" --project-ref <ref>
supabase secrets set SITE_URL="https://app.e-site.co.za" --project-ref <ref>

# All internal functions (including lifecycle email + payment recovery + health scoring)
for fn in onboarding-email-d0 onboarding-email-d1 onboarding-email-d3 \
          onboarding-email-d7 onboarding-email-d14 reengagement-check \
          conversion-prompt payment-recovery-check calculate-health-scores \
          compliance-complete eft-invoice send-notification send-email; do
  supabase functions deploy $fn --project-ref <ref>
done

# Re-deploy the enhanced paystack-webhook (now handles charge.failed + recovery reset).
supabase functions deploy paystack-webhook --project-ref <ref>
```

**After migration 00031**, schedule the payment-recovery cron (see the commented-out pg_cron block at the bottom of `00031_payment_recovery.sql`). Skip until the Edge Function is deployed.

---

## 1a. Supabase — Expose Non-Public Schemas (PostgREST)

**Required or ALL cross-schema FK joins will fail with PGRST200.**

The hosted Supabase project only exposes `public` by default. The app queries seven
additional schemas (`field`, `projects`, `compliance`, `tenants`, `suppliers`, `billing`,
`marketplace`). PostgREST must know about all of them to resolve cross-schema FK hints
like `profiles!raised_by`.

**Steps (Supabase dashboard):**

1. Go to **Settings → API** in the Supabase dashboard for the staging project
2. Find the **"Exposed schemas"** list
3. Add every schema below (comma-separated, in addition to `public`):
   ```
   projects, compliance, field, tenants, suppliers, billing, marketplace
   ```
4. Click **Save**
5. PostgREST will automatically reload its schema cache

**Verify in SQL editor:**
```sql
-- Should list all 8 schemas
SELECT nspname FROM pg_namespace
WHERE nspname IN ('public','projects','compliance','field','tenants','suppliers','billing','marketplace')
ORDER BY nspname;

-- Force schema cache reload if needed
NOTIFY pgrst, 'reload schema';
```

**Without this step**, every page that queries `field.snags`, `projects.rfis`, `compliance.coc_uploads`, etc. will crash with:
```
PGRST200: Could not find a relationship between 'snags' and 'profiles'
```

---

## 2. Supabase — Storage Buckets

Confirm the following buckets exist (create if missing):

```sql
-- Run in Supabase SQL editor or via psql
SELECT name, public FROM storage.buckets ORDER BY name;
```

Expected buckets:
- `coc-documents` — private
- `snag-photos` — private  
- `site-attachments` — private
- `avatars` — public

---

## 3. Supabase — Edge Functions

Deploy all edge functions:

```bash
cd apps/edge-functions

# Login if needed
npx supabase login

# Link to staging project
npx supabase link --project-ref <staging-project-ref>

# Deploy all functions
npx supabase functions deploy
```

Functions that must be deployed:
- `send-notification` — push notifications via Expo
- `generate-report` — PDF compliance portfolio export
- `powersync-auth` — JWT hook for PowerSync

---

## 4. Supabase — Environment Variables (Secrets)

Set secrets on the staging project:

```bash
# Via Supabase CLI
npx supabase secrets set \
  PAYSTACK_SECRET_KEY=sk_test_xxxx \
  EXPO_ACCESS_TOKEN=xxxx \
  RESEND_API_KEY=xxxx
```

---

## 5. Vercel — Deploy Web App

### 5a. Set environment variables

In Vercel dashboard → staging project → Settings → Environment Variables, set:

```
NEXT_PUBLIC_SUPABASE_URL         = https://<staging-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY    = eyJhbG...
SUPABASE_SERVICE_ROLE_KEY        = eyJhbG...  (server-only, not NEXT_PUBLIC_)
PAYSTACK_SECRET_KEY              = sk_test_xxxx
NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY  = pk_test_xxxx
NEXT_PUBLIC_SITE_URL             = https://staging.e-site.co.za
NEXT_PUBLIC_POSTHOG_KEY          = phc_xxxx
NEXT_PUBLIC_POSTHOG_HOST         = https://eu.posthog.com
SENTRY_DSN                       = https://xxxx@sentry.io/xxxx
SENTRY_AUTH_TOKEN                = xxxx   (for source maps upload)
NEXT_PUBLIC_SENTRY_DSN           = https://xxxx@sentry.io/xxxx
POWERSYNC_URL                    = https://<powersync-instance>.powersync.co
```

### 5b. Deploy

```bash
# From repo root, deploy web app to Vercel staging
npx vercel --cwd apps/web --env preview

# Or trigger via Vercel Git integration by pushing to a staging branch
git push origin feat/powersync:staging
```

### 5c. Verify deployment

- Visit `https://staging.e-site.co.za/api/health`
- Expect: `{ "healthy": true, ... }`
- All components should show `"ok"` status

---

## 6. EAS — Mobile Build (Internal Distribution)

```bash
cd apps/mobile

# Set staging API URL in app config
# Edit app.config.ts to point to staging Supabase

# Build for internal testing
eas build --platform ios --profile preview
eas build --platform android --profile preview

# Share via EAS Update or internal distribution link
eas update --branch staging --message "T-059 staging build"
```

**Required EXPO_PUBLIC env vars** (already set in `eas.json` → `build.preview.env` / `build.production.env`; verify they are not stripped by EAS):

| Var | Preview (staging) | Production |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | staging Supabase URL | prod Supabase URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | staging anon key | prod anon key |
| `EXPO_PUBLIC_POWERSYNC_URL` | staging PowerSync | prod PowerSync |
| `EXPO_PUBLIC_WEB_URL` | `https://esite-lilac.vercel.app` | `https://e-site.co.za` |

`EXPO_PUBLIC_WEB_URL` is required — it's where the mobile app sends authenticated notification dispatches. Without it the app falls back to the staging URL even in production builds.

**iOS**: Testers install via TestFlight or direct IPA link  
**Android**: Testers install via `.apk` from EAS dashboard

---

## 7. Paystack — Register Webhook

1. Log in to Paystack dashboard (test mode)
2. Go to Settings → API Keys & Webhooks
3. Set webhook URL: `https://staging.e-site.co.za/api/paystack/webhook`
4. Note the webhook secret; set it as `PAYSTACK_WEBHOOK_SECRET` in Vercel

---

## 8. Smoke Tests

Run these manually after deployment. Each links to the expected behaviour.

### Authentication
- [ ] Register new contractor account → redirected to `/onboarding`
- [ ] Complete onboarding (org name, POPIA consent) → reaches `/dashboard`
- [ ] Invite team member → email received, accept link works → user added to org
- [ ] Password reset flow works end-to-end

### Compliance
- [ ] Create a new site → subsections generated
- [ ] Upload a COC PDF → status shows "submitted"
- [ ] Admin reviews COC (approve/reject) → status updates
- [ ] Compliance portfolio page loads `/compliance/portfolio`
- [ ] QR code for subsection renders correctly

### Field / Snags
- [ ] Log a new snag with photo → appears in snag list
- [ ] Upload closeout photo → sign-off button enabled
- [ ] Sign off snag → status changes to `signed_off`
- [ ] Snag without closeout photo → sign-off blocked with error message

### Projects
- [ ] Create project → appears in `/projects` list
- [ ] Project detail page loads with KPI cards
- [ ] Site diary entry with `entry_type` = "safety" saves correctly

### Marketplace
- [ ] Supplier list loads at `/marketplace`
- [ ] Search by name filters results
- [ ] Category filter works
- [ ] Place an order → order appears in `/marketplace/orders`

### Billing
- [ ] Billing page loads with current tier
- [ ] Paystack checkout redirect works (test mode)
- [ ] Webhook fires after test payment → subscription updated in DB

### Mobile (Expo app)
- [ ] Login works with staging credentials
- [ ] Dashboard loads with KPI tiles
- [ ] Offline: create snag with no network → syncs when connection restored
- [ ] Push notification received after snag status update
- [ ] Notification dispatch proxy reachable: change a snag's status on mobile → row appears in `public.notifications` with `type='snag_status_changed'` for the recipient. (Mobile calls `${EXPO_PUBLIC_WEB_URL}/api/notifications/dispatch`, not the Edge Function directly.)
- [ ] **Auth boundary probe** (one-time): with a real bearer token, `curl -X POST $WEB_URL/api/notifications/dispatch -H "Authorization: Bearer <jwt>" -d '{"userIds":["<uid-from-different-org>"], ...}'` → expect HTTP 403. This verifies the cross-org check actually fires.

### Health & Observability
- [ ] `/api/health` returns `{ healthy: true }` with all components ok
- [ ] PostHog: `signup_completed` event visible in PostHog dashboard
- [ ] Sentry: test an intentional error → appears in Sentry

---

## 9. Performance Baseline

Before going to production, record these baselines:

```bash
# Lighthouse on key pages
npx lighthouse https://staging.e-site.co.za/dashboard --output=json > docs/lighthouse-staging.json
npx lighthouse https://staging.e-site.co.za/compliance --output=json >> docs/lighthouse-staging.json
```

Target: LCP < 2.5s, FID < 100ms, CLS < 0.1 on staging.

---

## 10. Sign-off

| Area | Checked by | Date |
|---|---|---|
| Migrations applied & verified | | |
| Web app healthy (`/api/health`) | | |
| Mobile build installed on test devices | | |
| All smoke tests passed | | |
| PostHog events flowing | | |
| Sentry errors routing correctly | | |
| Paystack webhook firing in test mode | | |
| Performance baseline recorded | | |

Once all rows are signed off, the staging environment is production-ready.
Proceed to T-060 Production Launch.
