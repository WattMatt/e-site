# E-Site Launch Checklist

**Last updated:** 2026-04-19  
**Audience:** Arno (founder) — non-developer steps only. Each section links to the exact place to go and tells you what to hand to Claude Code once you have it.

---

## Critical Path (do these in order)

```
1. Supabase staging project  ──┐
2. Resend domain              ──┤── needed before staging deploy
3. Paystack SA test account   ──┘

4. Vercel env vars + deploy   ← needs 1-3 complete
5. EAS project + mobile build ← can run in parallel with 4

6. Sentry DSNs                ──┐
7. PostHog API keys            ──┤── needed before production launch
8. DNS records                ──┘

9. Mobile design assets       ← needed before app store submission
10. Legal copy (lawyer)       ──┐
11. POPIA IO registration     ──┤── needed before production launch
12. CIPC / company details    ──┘

13. Apple Developer account   ──┐
14. Google Play account        ──┤── needed before app store submission
15. DPAs with sub-processors  ──┘
```

Staging can go live with items 1–5 complete. Production requires everything.

---

## 1. Supabase Staging Project

### What it is
The backend database, auth, and storage layer for the staging environment. Production already runs on a separate project. You need a second Supabase project called "esite-staging" with its own credentials.

### How to set it up
1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard) and sign in.
2. Click **New project**. Set:
   - **Name:** `esite-staging`
   - **Database password:** generate and save securely in 1Password (do not write it here)
   - **Region:** `South Africa (Cape Town)` — closest to your users, required for POPIA residency
   - **Pricing plan:** Free tier is fine for staging
3. Wait ~2 minutes for provisioning.
4. Go to **Settings → API**. Copy:
   - **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public** key
   - **service_role** key (keep secret — store in 1Password, never in this file)
5. Go to **Settings → Database** → scroll to **Connection string** → click the **URI** tab. Copy the direct connection string (port 5432, not the pooler).

### What to do with it
Hand Claude Code:
```
SUPABASE_STAGING_URL=https://abcdefgh.supabase.co
SUPABASE_STAGING_ANON_KEY=eyJhbG...
SUPABASE_STAGING_SERVICE_ROLE_KEY=eyJhbG...
SUPABASE_STAGING_DB_URL=postgresql://postgres:...@db.abcdefgh.supabase.co:5432/postgres
```
Claude Code will run migrations 00001–00028, deploy edge functions, and schedule pg_cron jobs.

### Verification
After Claude Code runs the migration script:
```sql
-- Run in Supabase SQL editor → staging project
SELECT count(*) FROM supabase_migrations.schema_migrations;
-- Expected: 28
```

### Dependencies
Must be done before items 4 and 5.

---

## 2. Resend — Email Domain Verification

### What it is
E-Site sends lifecycle emails (onboarding, re-engagement, payment recovery) from `noreply@e-site.co.za`. Resend requires you to prove you own that domain before emails go out. Without this, all lifecycle emails are blocked.

### How to set it up
1. Go to [https://resend.com](https://resend.com) and sign in (or create an account with `arno@watsonmattheus.com`).
2. Click **Domains → Add Domain**.
3. Enter `e-site.co.za` and click **Add**.
4. Resend will show you 3–4 DNS records to add. They look like:
   ```
   Type: TXT   Name: resend._domainkey.e-site.co.za   Value: p=... (copy exact value from Resend dashboard)
   Type: MX    Name: send.e-site.co.za                Value: feedback-smtp.eu-west-1.amazonses.com
   Type: TXT   Name: send.e-site.co.za                Value: v=spf1 include:amazonses.com ~all
   ```
5. Log in to your DNS provider (wherever `e-site.co.za` is registered — likely Domains.co.za, Afrihost, or similar). Add each record exactly as shown.
6. Click **Verify** in Resend. DNS propagation can take 10–60 minutes. Resend will email you when verified.
7. Once verified, go to **API Keys → Create API Key**. Set:
   - **Name:** `esite-production`
   - **Permission:** Sending access
   - **Domain:** `e-site.co.za`
8. Copy the API key (store in 1Password — do not write it here).

### What to do with it
Set these in Vercel (item 4) and as Supabase Edge Function secrets:

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | `re_xxxx` (the key from step 8) |
| `RESEND_FROM` | `E-Site <noreply@e-site.co.za>` |

For Edge Functions:
```bash
npx supabase secrets set RESEND_API_KEY=re_xxxx RESEND_FROM="E-Site <noreply@e-site.co.za>" --project-ref <staging-ref>
```

### Verification
```bash
# Test send via Resend API
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer re_xxxx" \
  -H "Content-Type: application/json" \
  -d '{"from":"noreply@e-site.co.za","to":"arno@watsonmattheus.com","subject":"Test","html":"<p>Test</p>"}'
# Expected: {"id":"..."}
```

### Dependencies
None — can be done at any time. Must complete before staging email sequences work.

---

## 3. Paystack SA Test Account

### What it is
E-Site uses Paystack for subscriptions and supplier payouts. You need a South African Paystack account (not a Nigerian one — split payments / ZAR support requires the SA entity). Without this, no billing flows work.

### How to set it up

#### 3a. Create account
1. Go to [https://paystack.com/za](https://paystack.com/za).
2. Click **Create a free account**. Use `arno@watsonmattheus.com`.
3. Select **South Africa** as country. Company type: **Private Company**.
4. Fill in business details:
   - Business name: `Watson Mattheus (Pty) Ltd` (or your registered trading name)
   - Business category: `Software as a Service`
5. Complete email verification.
6. You now have a test mode account. **Do not activate live mode yet** — test mode is sufficient for staging.

#### 3b. Get API keys (test mode)
1. Go to **Settings → API Keys & Webhooks**.
2. Under **Test Keys**, copy:
   - **Test Public Key** (starts with `pk_test_`)
   - **Test Secret Key** (starts with `sk_test_`)

#### 3c. Set webhook URL (needed for staging)
1. On the same Settings → API Keys & Webhooks page, scroll to **Webhooks**.
2. Add webhook URL: `https://staging.e-site.co.za/api/paystack/webhook`
3. Generate a random webhook secret (use [https://generate-secret.vercel.app/32](https://generate-secret.vercel.app/32)) and paste it into the **Signature** field.
4. Copy the webhook secret (store in 1Password).

#### 3d. Live activation (production only — do later)
Before production launch, go to **Settings → Business Settings** and complete KYC:
- Upload company registration (CIPC certificate)
- Upload bank account details (South African business bank account)
- ID of director (FICA)

Approval typically takes 2–5 business days.

### What to do with it
Set in Vercel (item 4) and Supabase Edge Function secrets:

| Variable | Value | Where |
|---|---|---|
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | `pk_test_xxxx` | Vercel (public) |
| `PAYSTACK_SECRET_KEY` | `sk_test_xxxx` | Vercel (server-only) + Supabase secrets |
| `PAYSTACK_WEBHOOK_SECRET` | the secret you generated | Vercel (server-only) + Supabase secrets |

```bash
npx supabase secrets set \
  PAYSTACK_SECRET_KEY=sk_test_xxxx \
  PAYSTACK_WEBHOOK_SECRET=your_32_char_secret \
  --project-ref <staging-ref>
```

### Verification
Run the pilot test script after Claude Code deploys staging:
```bash
cd esite
npx tsx scripts/paystack/pilot-test.ts
# Expected: all 5 split variants + EFT + subscriptions pass
```

Also visit `https://staging.e-site.co.za/settings/billing` — the billing page should load and "Upgrade" should redirect to a Paystack checkout page.

### Dependencies
Must complete 3c before Claude Code runs staging smoke tests.

---

## 4. Vercel — Web App Deployment

### What it is
The E-Site web app (`apps/web`) deploys to Vercel. You need to create the project, link it to the repo, and set all environment variables.

### How to set it up

#### 4a. Create Vercel project
1. Go to [https://vercel.com/new](https://vercel.com/new).
2. Import the Git repository containing the `esite/` monorepo.
3. Set **Framework preset** to `Next.js`.
4. Set **Root directory** to `esite/apps/web`.
5. Click **Deploy** (it will fail — that's OK, we'll set env vars next).

#### 4b. Set environment variables
Go to **Project → Settings → Environment Variables** and add every row below. Set scope to **All Environments** unless noted.

| Variable | Where to get it | Scope |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → staging project → Settings → API | Preview only for staging; Production for prod |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same location — "anon public" key | All |
| `SUPABASE_SERVICE_ROLE_KEY` | Same — "service_role" key | All (server-only) |
| `NEXT_PUBLIC_SITE_URL` | `https://staging.e-site.co.za` for staging; `https://app.e-site.co.za` for prod | Per-environment |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | Paystack → Settings → API Keys (item 3) | All |
| `PAYSTACK_SECRET_KEY` | Same — secret key | All (server-only) |
| `PAYSTACK_WEBHOOK_SECRET` | The secret you set in Paystack (item 3c) | All (server-only) |
| `NEXT_PUBLIC_POWERSYNC_URL` | Your PowerSync dashboard instance URL | All |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog (item 7) | All |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://eu.posthog.com` | All |
| `SENTRY_DSN` | Sentry (item 6) | All (server-only) |
| `NEXT_PUBLIC_SENTRY_DSN` | Same DSN | All (public) |
| `SENTRY_AUTH_TOKEN` | Sentry → Settings → Auth Tokens → Create | All (server-only) |
| `RESEND_API_KEY` | Resend (item 2) | All (server-only) |

#### 4c. Set staging subdomain
In **Project → Settings → Domains**, add `staging.e-site.co.za`. Vercel will show you DNS records to add (usually a CNAME). Add them at your DNS provider.

#### 4d. Redeploy
Trigger a new deployment from the Vercel dashboard after setting all variables.

### Verification
```bash
curl https://staging.e-site.co.za/api/health
# Expected: {"healthy":true,"components":{"database":{"status":"ok"},...}}
```
All components must show `"ok"` or `"degraded"` (not `"error"`).

### Dependencies
Requires items 1, 2, and 3 to be complete first.

---

## 5. EAS — Mobile Build Setup

### What it is
Expo Application Services (EAS) builds the iOS and Android apps in the cloud. You need an Expo account, a project linked to it, and credentials stored in EAS so the CI build can sign the app.

### How to set it up

#### 5a. Create Expo account
1. Go to [https://expo.dev](https://expo.dev) and sign up (or sign in) with `arno@watsonmattheus.com`.
2. Create an **organisation** called `esite-co` (must match `owner: 'esite-co'` in `app.config.ts`).

#### 5b. Create EAS project
1. In the Expo dashboard, click **Create a project**.
2. Name it `e-site`. The project ID will look like `810e7e5b-3e28-46d0-8a98-eb8eb75a1cf1`.
3. Copy this project ID.

#### 5c. Link locally
```bash
cd esite/apps/mobile
npx eas init --id <project-id-from-step-2>
# This writes the project ID into app.config.ts automatically
```
If you prefer to set it manually, add to `.env`:
```
EXPO_PUBLIC_EAS_PROJECT_ID=<project-id>
EAS_PROJECT_ID=<project-id>
```

#### 5d. iOS credentials (for production)
You need an **Apple Developer account** (item 13). Once you have it:
```bash
cd esite/apps/mobile
npx eas credentials
# Select iOS → Production → Generate new certificate
# EAS stores the certificate automatically
```

#### 5e. Android credentials
```bash
npx eas credentials
# Select Android → Production → Generate new keystore
# EAS stores the keystore automatically
```

#### 5f. First build (staging / internal testing)
```bash
cd esite/apps/mobile
# iOS simulator build (no Apple account needed)
npx eas build --platform ios --profile development

# Android APK for internal testers
npx eas build --platform android --profile preview
```

### What to do with it
Update `eas.json` with the real values once you have them:
```json
"ios": {
  "appleId": "developer@e-site.co.za",
  "ascAppId": "<App Store Connect App ID>",
  "appleTeamId": "<10-char team ID from developer.apple.com/account>"
}
```

Set EAS secrets for the mobile build environment:
```bash
npx eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value https://...
npx eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value eyJhbG...
npx eas secret:create --scope project --name EXPO_PUBLIC_POWERSYNC_URL --value https://...
npx eas secret:create --scope project --name EXPO_PUBLIC_EAS_PROJECT_ID --value <project-id>
npx eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value https://...
```

### Verification
After the first build completes:
- iOS: Download the `.ipa` from the EAS dashboard and install via TestFlight or direct link
- Android: Download the `.apk` and install on a test device
- Log in with staging credentials and confirm the dashboard loads

### Dependencies
Requires item 1 (Supabase staging) for the app to connect. iOS production build requires item 13 (Apple Developer account).

---

## 6. Sentry — Error Tracking DSNs

### What it is
Sentry captures runtime errors and crashes. You need a DSN for the web app and a separate one for the mobile app. This is not strictly required for staging but is required before production.

### How to set it up
1. Go to [https://sentry.io](https://sentry.io) and sign up / sign in.
2. Create an **organisation** called `esite`.
3. Create two projects:
   - **esite-web** → Platform: `Next.js`
   - **esite-mobile** → Platform: `React Native`
4. For each project, go to **Settings → Client Keys (DSN)**. Copy the DSN (looks like `https://abc123@o123456.ingest.sentry.io/7890`).
5. Create an **Auth Token** for source map uploads: go to **Settings → Auth Tokens → Create New Token**. Give it `project:write` and `org:read` scopes.

### What to do with it

**Web** — set in Vercel (item 4):
```
SENTRY_DSN              = https://abc123@o123456.ingest.sentry.io/7890
NEXT_PUBLIC_SENTRY_DSN  = https://abc123@o123456.ingest.sentry.io/7890
SENTRY_AUTH_TOKEN       = sntrys_xxxx
```

**Mobile** — set as EAS secrets:
```bash
npx eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value https://...
```

Also install the mobile packages (once you have the DSN):
```bash
cd esite
pnpm add @sentry/react-native expo-application expo-device expo-localization --filter mobile
```

### Verification
**Web:** Visit any page on staging and check Sentry dashboard for a session. Or trigger a test error by visiting `https://staging.e-site.co.za/api/health` and checking the Sentry → Issues list.

**Mobile:** In the dev build, shake the device and a Sentry event should appear within 30 seconds in the Sentry dashboard.

### Dependencies
None. Can be done at any time before production launch.

---

## 7. PostHog — Product Analytics

### What it is
PostHog records user events (`signup_completed`, `snag_created`, etc.) for product analytics and funnel analysis. Use the EU-hosted version for POPIA data residency.

### How to set it up
1. Go to [https://eu.posthog.com](https://eu.posthog.com) and create an account.
2. Create a project called `esite-production`.
3. Go to **Project Settings**. Copy:
   - **Project API Key** (starts with `phc_`)
   - **Host**: `https://eu.posthog.com`

### What to do with it

**Web** — set in Vercel (item 4):
```
NEXT_PUBLIC_POSTHOG_KEY   = phc_xxxx
NEXT_PUBLIC_POSTHOG_HOST  = https://eu.posthog.com
```

**Mobile** — set as EAS secrets:
```bash
npx eas secret:create --scope project --name EXPO_PUBLIC_POSTHOG_KEY --value phc_xxxx
```

Install mobile packages:
```bash
cd esite
pnpm add posthog-react-native --filter mobile
```

### Verification
After deploying to staging, go to PostHog → **Live Events**. Sign in on the staging web app — within 10 seconds you should see a `$pageview` event.

### Dependencies
None. Can be done at any time before production launch.

---

## 8. DNS Records

### What it is
Several DNS records are needed for the app to work correctly: the web app domain, email sending, and iOS Universal Links (for magic-link deep linking on iPhone).

### Records to add

All records go at your DNS provider for `e-site.co.za`. If you don't know your DNS provider, check your domain registrar (likely Domains.co.za, Afrihost, or Hetzner SA).

#### Web app
| Type | Name | Value | Purpose |
|---|---|---|---|
| `CNAME` | `app` | `cname.vercel-dns.com` | Production web app |
| `CNAME` | `staging` | `cname.vercel-dns.com` | Staging web app |

> Vercel gives you the exact value when you add the domain in **Project → Settings → Domains**.

#### Email (Resend)
Resend gives you the exact records to add (item 2). Typically:
| Type | Name | Value |
|---|---|---|
| `TXT` | `resend._domainkey` | `p=MIGf...` (from Resend) |
| `MX` | `send` | `feedback-smtp.eu-west-1.amazonses.com` |
| `TXT` | `send` | `v=spf1 include:amazonses.com ~all` |

#### iOS Universal Links (for magic-link auth on iPhone)
Apple requires an HTTPS endpoint at `https://e-site.co.za/.well-known/apple-app-site-association` that returns a JSON file. This is served by the Next.js app. Make sure the `app` A/CNAME record above is live before testing.

The file is already generated by the `app.config.ts` `associatedDomains: ['applinks:e-site.co.za']` setting — Expo handles this automatically during the App Store submission process.

### Verification
```bash
# Check web app DNS
dig CNAME app.e-site.co.za

# Check email DNS
dig TXT resend._domainkey.e-site.co.za

# After app is live — check Apple site association
curl https://e-site.co.za/.well-known/apple-app-site-association
```

### Dependencies
Web DNS (item 8a) must be in place before Vercel deployment can serve traffic on your domain. Email DNS (item 8b) must be in place before item 2 verification passes.

---

## 9. Mobile App Design Assets

### What it is
The App Store and Play Store reject apps with placeholder or blank icons. Current `assets/` in the mobile repo contains 1×1 placeholder PNGs. You need real assets from your designer.

### Exact files required

All files go into `esite/apps/mobile/assets/`:

| File | Dimensions | Notes |
|---|---|---|
| `icon.png` | **1024 × 1024 px** | iOS App Store icon. No transparency, no rounded corners (Apple applies its own mask). Solid background. |
| `splash.png` | **1284 × 2778 px** | Splash screen. The image is centered; use `#0D0B09` background (already set in config). |
| `adaptive-icon.png` | **1024 × 1024 px** | Android adaptive icon foreground. Transparent background, keep logo within the safe zone (centre 66%). |
| `notification-icon.png` | **96 × 96 px** | Android notification icon. Must be white-on-transparent (Android ignores colour). |

Export all as PNG. No JPEGs.

### What to do with it
Replace the placeholders:
```bash
cp ~/Downloads/icon.png esite/apps/mobile/assets/icon.png
cp ~/Downloads/splash.png esite/apps/mobile/assets/splash.png
cp ~/Downloads/adaptive-icon.png esite/apps/mobile/assets/adaptive-icon.png
cp ~/Downloads/notification-icon.png esite/apps/mobile/assets/notification-icon.png
```

Then tell Claude Code to rebuild the preview build: `eas build --profile preview`.

### Verification
Run the build and check the app icon appears correctly on the simulator home screen.

### Dependencies
Required before App Store (item 13) or Play Store (item 14) submission. Not required for staging.

---

## 10. Legal Copy — Lawyer Review

### What it is
The `/privacy`, `/terms`, `/acceptable-use`, and `/cookies` pages contain placeholder text. These are legally binding documents. They must be reviewed and written by a South African attorney before the app goes live to paying customers. This is a regulatory requirement under POPIA (§18 notification) and ECTA (§43 disclosure).

### How to get it done
1. Engage a South African IT/privacy attorney. Recommended options:
   - [Michalsons](https://www.michalsons.com) — SA POPIA specialists
   - [DOMMISSE Attorneys](https://www.dommisse.co.za)
   - Budget: estimate **R15 000–R40 000** for a startup pack (privacy policy + terms + AUP + DPAs)
2. Brief them with:
   - The app description (construction site management SaaS for SA electrical contractors)
   - Data processed: names, emails, photos, GPS metadata (snag locations), financial records (invoices)
   - Sub-processors: Supabase (database/auth), PowerSync (offline sync), Resend (email), Sentry (error logging), Expo (push notifications), Paystack (payments)
   - Jurisdiction: South Africa, governed by POPIA and ECTA
3. Receive the reviewed documents as Word/PDF files.

### What to do with it
The page files are at:
- `esite/apps/web/src/app/(legal)/privacy/page.tsx`
- `esite/apps/web/src/app/(legal)/terms/page.tsx`
- `esite/apps/web/src/app/(legal)/acceptable-use/page.tsx`
- `esite/apps/web/src/app/(legal)/cookies/page.tsx`

Hand the reviewed copy to Claude Code along with the instruction to replace the placeholder text in each file.

Also update `LegalFooter.tsx` with:
- Real CIPC registration number (item 12)
- Full physical address
- VAT number (once registered)

### Dependencies
Must be complete before production launch. The lawyer will also produce the DPAs needed for item 15.

---

## 11. POPIA Information Officer Registration

### What it is
Under the Protection of Personal Information Act (POPIA), any company processing personal information in South Africa must register its Information Officer with the Information Regulator. This is a free process and a legal requirement. The Information Officer for E-Site is Arno Mattheus.

### How to register
1. Go to the Information Regulator's online portal: [https://www.justice.gov.za/inforeg/registration.html](https://www.justice.gov.za/inforeg/registration.html)
   
   If that link is down, the main site is: [https://inforegulator.org.za](https://inforegulator.org.za)

2. Download and complete **Form 1: Registration of Information Officers**.

3. You will need:
   - Company registration number (CIPC — item 12)
   - Registered address
   - Information Officer's name and contact details (Arno Mattheus, `arno@watsonmattheus.com`)
   - Description of personal information processed: names, emails, contact details, photos, financial records

4. Submit via email to `inforeg@justice.gov.za` or through the online portal if available.

5. You will receive a confirmation reference number. Keep this — it goes in the Privacy Policy.

### What to do with it
Once registered:
- Update the Privacy Policy (item 10) with the registration reference number
- The `infoOfficer` and `infoOfficerEmail` fields in `LegalFooter.tsx` are already filled in with your name and email — no code change needed

### Dependencies
Requires item 12 (CIPC registration number) first. Should be done before or in parallel with item 10 (legal copy).

---

## 12. CIPC — Company Registration Details

### What it is
`LegalFooter.tsx` currently shows `'2026/XXXXXX/07'` as the registration number. ECTA §43 requires displaying the correct company registration number on all business communications. You need to pull this from your CIPC certificate.

### How to get it
1. Go to [https://www.cipc.co.za](https://www.cipc.co.za) → **Self-service** → **Customer Transactions** → **Company Enquiry**.
2. Search for `Watson Mattheus` or your registered company name.
3. Download the company status document — the registration number is on the first page (format `YYYY/NNNNNN/07`).

Alternatively, find it on any CIPC correspondence email or your original registration certificate.

### What to do with it
Give Claude Code these values:
```
REGISTERED_NAME    = Watson Mattheus (Pty) Ltd   (or actual name on certificate)
REGISTRATION_NO    = 2026/123456/07               (your actual number)
PHYSICAL_ADDRESS   = [full street address]
```

Claude Code will update `LegalFooter.tsx` and the legal page footers.

### Dependencies
Needed before items 10, 11, and the production launch.

---

## 13. Apple Developer Account

### What it is
Required to distribute the iOS app on the App Store. Annual fee: USD $99/year.

### How to set it up
1. Go to [https://developer.apple.com/programs/enroll/](https://developer.apple.com/programs/enroll/).
2. Sign in with your Apple ID (create one at `developer@e-site.co.za` if needed).
3. Enrol as an **Organisation** (not individual — requires your CIPC registration and D-U-N-S number).
4. **Get a D-U-N-S number** (free, required for org enrolment):
   - Go to [https://www.dnb.com/duns-number/get-a-duns.html](https://www.dnb.com/duns-number/get-a-duns.html)
   - Takes 5–7 business days
5. Complete enrolment. Apple reviews take 2–7 business days.
6. Once approved, go to [https://appstoreconnect.apple.com](https://appstoreconnect.apple.com):
   - Create a new **App** record. Name: `E-Site`. Bundle ID: `com.esite.app`
   - Copy the **Apple ID** shown on the app page (a numeric ID like `1234567890`)
7. Go to [https://developer.apple.com/account](https://developer.apple.com/account):
   - Copy your **Team ID** (10-character alphanumeric, top-right of the page)

### What to do with it
Update `esite/apps/mobile/eas.json`:
```json
"ios": {
  "appleId": "developer@e-site.co.za",
  "ascAppId": "1234567890",
  "appleTeamId": "ABCDE12345"
}
```
Then run:
```bash
cd esite/apps/mobile
npx eas credentials  # generates signing certificate and provisioning profile
```

### Dependencies
Required before iOS App Store submission. Not required for internal TestFlight testing during staging.

---

## 14. Google Play Developer Account

### What it is
Required to distribute the Android app on the Google Play Store. One-time fee: USD $25.

### How to set it up
1. Go to [https://play.google.com/console/signup](https://play.google.com/console/signup).
2. Sign in with a Google account (`developer@e-site.co.za`).
3. Pay the one-time $25 registration fee.
4. Complete the developer profile:
   - Developer name: `Watson Mattheus (Pty) Ltd`
   - Contact email: `arno@watsonmattheus.com`
5. Create a new **app** in the console. Package name: `com.esite.app`.

#### Create Google Play API service account (for automated submissions via EAS)
1. In the Play Console, go to **Setup → API access**.
2. Click **Link to a Google Cloud project** (create a new one if needed).
3. In Google Cloud Console, go to **IAM → Service Accounts → Create Service Account**.
   - Name: `eas-submit`
   - Role: `Service Account User`
4. Create a JSON key for the service account. Download it.
5. Back in Play Console, grant the service account **Release Manager** permissions.

### What to do with it
```bash
cp ~/Downloads/google-service-account.json esite/apps/mobile/google-service-account.json
# Note: this file is gitignored — never commit it
```
The `eas.json` already points to `./google-service-account.json`.

### Dependencies
Required before Play Store submission. Not required for APK-based internal testing during staging.

---

## 15. Data Processing Agreements (DPAs)

### What it is
POPIA requires that you have a written agreement with every third-party company that processes personal data on your behalf ("operator" agreements). Without these, you are not legally compliant.

### Sub-processors requiring DPAs

| Company | What they process | DPA location |
|---|---|---|
| **Supabase** | All user data, emails, photos | [https://supabase.com/legal/dpa](https://supabase.com/legal/dpa) — sign via dashboard |
| **PowerSync** | Sync metadata (org IDs, record IDs) | Contact [support@powersync.co](mailto:support@powersync.co) |
| **Resend** | Email addresses, names | [https://resend.com/legal/dpa](https://resend.com/legal/dpa) — download and sign |
| **Sentry** | Error logs, user IDs, stack traces | [https://sentry.io/legal/dpa](https://sentry.io/legal/dpa) — sign via self-serve form |
| **Expo / EAS** | Push notification tokens | [https://expo.dev/privacy](https://expo.dev/privacy) — contact legal@expo.dev if DPA needed |
| **Paystack** | Name, email, banking details | Covered under Paystack merchant agreement; request addendum if needed |
| **PostHog (EU)** | Usage events, user IDs | [https://posthog.com/dpa](https://posthog.com/dpa) — self-serve download and sign |

### What to do with it
For each: download the DPA, sign it (DocuSign or wet signature), and keep a PDF in a secure folder (1Password Documents or company Dropbox). You do not need to upload these to the codebase.

### Dependencies
Should be in place before production launch. Your lawyer (item 10) can review these DPAs.

---

## Staging Readiness Summary

Before handing off to Claude Code to run the staging deploy, confirm:

- [ ] Supabase staging project created — URL, anon key, service role key, DB URL copied
- [ ] `e-site.co.za` DNS records added for `staging.` subdomain (Vercel CNAME)
- [ ] Resend API key obtained and domain verification initiated (DNS records added)
- [ ] Paystack SA test account created — public key, secret key, webhook secret copied
- [ ] PowerSync instance URL confirmed (your existing PowerSync project)
- [ ] Vercel project created and all env vars set

Once all 6 items are confirmed, tell Claude Code: **"Staging is ready — run the deploy."**

---

## Production Readiness Summary (after staging QA)

- [ ] Staging QA passed (all 8 flows in `esite/DEMO.md`)
- [ ] Paystack live mode KYC submitted and approved
- [ ] Resend domain verified (`green` in Resend dashboard)
- [ ] Sentry DSNs set in Vercel and EAS
- [ ] PostHog API keys set in Vercel and EAS
- [ ] Mobile packages installed: `pnpm add @sentry/react-native posthog-react-native expo-application expo-device expo-localization --filter mobile`
- [ ] CIPC registration number confirmed
- [ ] Legal copy reviewed by lawyer and pages updated
- [ ] POPIA Information Officer registered with Information Regulator
- [ ] DPAs signed with all 7 sub-processors
- [ ] Mobile design assets replaced (`icon.png`, `splash.png`, `adaptive-icon.png`, `notification-icon.png`)
- [ ] Apple Developer account approved and `eas.json` updated with `ascAppId` + `appleTeamId`
- [ ] Google Play developer account created and `google-service-account.json` in place
- [ ] EAS credentials generated for iOS and Android
- [ ] Production EAS build submitted and approved by Apple (can take 24–48 hours)
- [ ] DNS `app.` subdomain pointed to Vercel production deployment
- [ ] Vercel production env vars updated to live Paystack keys and production Supabase URL

---

## Quick Reference — All Environment Variables

### Vercel (set in dashboard)

| Variable | Description | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | **Yes** |
| `NEXT_PUBLIC_SITE_URL` | Full URL of the web app | No |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | Paystack public key | No |
| `PAYSTACK_SECRET_KEY` | Paystack secret key | **Yes** |
| `PAYSTACK_WEBHOOK_SECRET` | Paystack webhook verification | **Yes** |
| `NEXT_PUBLIC_POWERSYNC_URL` | PowerSync instance URL | No |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project API key | No |
| `NEXT_PUBLIC_POSTHOG_HOST` | `https://eu.posthog.com` | No |
| `SENTRY_DSN` | Sentry DSN (server) | **Yes** |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN (client) | No |
| `SENTRY_AUTH_TOKEN` | Sentry source map upload token | **Yes** |
| `RESEND_API_KEY` | Resend API key | **Yes** |

### Supabase Edge Function Secrets

```bash
npx supabase secrets set \
  RESEND_API_KEY=re_... \
  RESEND_FROM="E-Site <noreply@e-site.co.za>" \
  SITE_URL=https://app.e-site.co.za \
  PAYSTACK_SECRET_KEY=sk_... \
  PAYSTACK_WEBHOOK_SECRET=... \
  --project-ref <your-project-ref>
```

### EAS Secrets (mobile build)

```bash
npx eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_URL --value https://...
npx eas secret:create --scope project --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value eyJhbG...
npx eas secret:create --scope project --name EXPO_PUBLIC_POWERSYNC_URL --value https://...
npx eas secret:create --scope project --name EXPO_PUBLIC_EAS_PROJECT_ID --value <uuid>
npx eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value https://...
npx eas secret:create --scope project --name EXPO_PUBLIC_POSTHOG_KEY --value phc_...
```
