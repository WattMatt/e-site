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

# Enable pg_trgm first (required by migration 00023)
psql "$SUPABASE_DB_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# Run all pending migrations (00017–00023) in one command
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

**Verify migrations applied:**
```sql
-- Should return 23 rows
SELECT count(*) FROM supabase_migrations.schema_migrations;
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
