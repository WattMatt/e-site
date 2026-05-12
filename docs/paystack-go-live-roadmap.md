# Paystack Production Go-Live Roadmap

> **Audience:** Arno + Claude-in-Chrome session.
> **Companion docs:** [`.secrets/vercel.md`](../.secrets/vercel.md) (env-var inventory), [`paystack-pilot-settlement-timing.md`](paystack-pilot-settlement-timing.md) (marketplace splits — Phase 2).
> **Status as of 2026-05-12:** Test mode keys are live on Vercel, subscription checkout flow is wired end-to-end, callback route activates the subscription on first payment. Webhook URL not yet configured on Paystack dashboard. Live mode not provisioned.

---

## How to use this doc

This roadmap is split into two layers:

1. **Pre-fill blocks** (the boxed `> **PRE-FILL BEFORE PASTING**` sections) — Arno fills in the real-world values that Claude-in-Chrome cannot discover (CIPC numbers, bank details, support contacts, etc.). **If any field in a pre-fill block is blank, STOP — paste the script with blanks and Claude Chrome cannot complete it.**
2. **Pasteable scripts** (the boxed `> **Task:**` sections) — these are the actual prompts to paste into a Claude-in-Chrome session. Each script is self-contained: it tells Claude exactly which dashboard to open, which buttons to click, what data to enter, what to verify, and what to report back. Plan amounts, plan-code lookup paths, file locations, env-var names, and SQL helpers are already filled from the codebase — no need to look those up.

**Workflow:** Read §0. Resolve §0's code blocker (this is NOT a Claude-Chrome task — it's an engineering decision + commit + deploy). Then for each subsequent section: fill the PRE-FILL block → paste the Task block into Claude-in-Chrome → review the report-back → move to the next section.

**Sections 1, 5, 7 are Arno-only** (gathering documents, real-card smoke test, accountant work). **Sections 2, 3, 4, 6 are Claude-in-Chrome.**

---

## 0. Code-side state — Path B SHIPPED (env-var-gated)

**Status as of commit `<this commit>`:** the recurring-subscription wiring is in place but **gated by env vars**, so it ships safely without breaking pre-go-live testing. The behaviour is:

| `PAYSTACK_PLAN_<TIER>_<PERIOD>` env var | Checkout sends | Result |
|---|---|---|
| **unset** (today, every env)     | `amount` only     | One-off charge (legacy behaviour, no recurring). Tier gets set. Customer is NOT charged again next month. |
| **set** (after Paystack plans created) | `plan: PLN_…`    | Paystack auto-creates a customer + recurring subscription. First charge happens immediately. Recurring fires on the plan's interval. Webhook fills in `paystack_subscription_code` ~5–30s after first charge. |

**Files touched:**
- [`packages/shared/src/services/billing.service.ts`](../packages/shared/src/services/billing.service.ts) — `PLANS` gained `monthlyPlanCodeEnv` + `annualPlanCodeEnv`. New helper `resolvePaystackPlanCode(tier, period)` reads from `process.env`, returns `undefined` when unset.
- [`apps/web/src/app/api/paystack/checkout/route.ts`](../apps/web/src/app/api/paystack/checkout/route.ts) — branches on `resolvePaystackPlanCode`. When set, sends `plan` + omits `amount`. When unset, sends `amount` (legacy).
- [`apps/web/src/app/api/paystack/callback/route.ts`](../apps/web/src/app/api/paystack/callback/route.ts) — captures `plan_code` from metadata, persists to `paystack_plan_code`. Documents the race: `paystack_subscription_code` is intentionally omitted (webhook fills it).
- [`apps/web/src/app/api/paystack/webhook/route.ts`](../apps/web/src/app/api/paystack/webhook/route.ts) — new `subscription.create` handler matches by (customer_code + plan_code) and fills in `subscription_code` + `next_billing_date`. Existing `subscription.disable` / `not_renew` / `payment_failed` handlers unchanged.

**Env vars to set on Vercel** (Production env only — leave Preview unset to keep PR previews on one-off mode):

| Env var name | Value (pasted from §3 step 6) |
|---|---|
| `PAYSTACK_PLAN_STARTER_MONTHLY`      | `PLN_…` (live mode) |
| `PAYSTACK_PLAN_STARTER_ANNUAL`       | `PLN_…` (live mode) |
| `PAYSTACK_PLAN_PROFESSIONAL_MONTHLY` | `PLN_…` (live mode) |
| `PAYSTACK_PLAN_PROFESSIONAL_ANNUAL`  | `PLN_…` (live mode) |

(For test-mode smoke testing of recurring before going live: also create plans on Paystack TEST dashboard, copy the test `PLN_…` codes, and set the same env-var names against the **Preview** env. Production stays unset until live keys + live plans are ready.)

**Schema:** `billing.subscriptions` table already has `paystack_plan_code` + `paystack_subscription_code` + `paystack_customer_code` + `next_billing_date` columns from migration `00007_billing_schema.sql`. No migration needed.

**Cancellation:** the `subscription.disable` webhook handler already flips status → `cancelled`. A user-facing "Cancel my subscription" button in the app is NOT yet wired — Arno currently has to cancel via Paystack dashboard (Customers → ⋯ → Disable subscription). Adding the button is a separate ~30min task: server action calls `POST https://api.paystack.co/subscription/disable` with the row's `paystack_subscription_code` + `email_token` (which Paystack returns on subscription.create — needs persisting). Defer until first real customer asks.

**The rest of this doc assumes Path B is shipped (it is) and that Arno is now ready to provision live mode.**

---

## 1. Pre-flight checklist (Arno gathers, before touching Paystack)

**Documents (have these PDFs ready on the device you'll use for KYC):**
- [ ] CIPC company registration certificate (CoR 14.3 / CoR 15.1A — whichever you have)
- [ ] Memorandum of Incorporation (or equivalent for sole prop / partnership)
- [ ] FICA: certified ID copy of every director / sole prop (certified within last 3 months)
- [ ] FICA: proof of business address < 3 months old (utility bill / bank statement / lease)
- [ ] FICA: proof of residential address < 3 months old for each director
- [ ] SARS income-tax registration (IT77 or company tax number)
- [ ] VAT certificate IF VAT-registered (VAT103, see §7)
- [ ] Bank confirmation letter for the settlement bank account (issued by the bank, not just a statement)

**Decisions (write these down — Paystack will ask):**
- [ ] **Operating entity:** Watson Mattheus Pty Ltd? E-Site Pty Ltd (new)? Sole prop? Affects which CIPC docs you upload and which bank account settlements land in.
- [ ] **Trading name:** what shows on the customer's bank statement narrative ("E-SITE", "ESITE PTY LTD", "WATSON MATTHEUS"). Max 22 chars typically.
- [ ] **Settlement bank account:** ONE business account. Not a personal account. Not a savings account. Must be in the operating entity's name.
- [ ] **Support email:** the address that will receive Paystack dispute / chargeback notifications. Must be monitored. `support@e-site.live` recommended once mailbox routing is set up (see CLAUDE.md "Brand-domain DNS cutover").
- [ ] **Support phone:** real phone, must answer during business hours. Paystack puts this on the customer-facing dispute portal.
- [ ] **Refund policy:** decide before going live. Paystack expects you to have one published. Even one line ("Pro-rata refund within 14 days of subscription start, no refund after that") is fine.
- [ ] **Transaction fee absorption:** does E-Site eat the ~2.9% Paystack fee, or pass it to the customer? (SA Paystack pricing: 2.9% + R1.00 for cards, capped at R30. International cards: 3.5%.) If passing on, the checkout amount needs a `bearer: 'subaccount'` flag — see Paystack docs. Recommended for SaaS: absorb the fee, simpler customer experience.
- [ ] **Email FROM domain for Paystack-sent receipts:** they send invoice receipts from `noreply@paystack.com` by default. If you want them branded to E-Site, that's a separate Paystack-side config (Settings → Branding).

---

## 2. Paystack live-mode KYC (Claude-in-Chrome, ~30 min + Paystack review window of 1–3 business days)

> **PRE-FILL BEFORE PASTING — Claude-in-Chrome cannot discover any of these.**
> **Replace every `<...>` placeholder with the real value, then paste the whole Task block below.**
>
> ```
> # === Operating entity (matches CIPC) ===
> ENTITY_LEGAL_NAME=<e.g. "Watson Mattheus (Pty) Ltd">
> ENTITY_TYPE=<one of: Limited Liability | Sole Proprietor | Partnership | NPO>
> ENTITY_REGISTRATION_NUMBER=<e.g. "2018/123456/07">
> ENTITY_REGISTERED_ADDRESS=<full street + suburb + city + postal code>
> ENTITY_INCORPORATION_DATE=<YYYY-MM-DD from CoR 14.3>
>
> # === Trading details ===
> TRADING_NAME=<max 22 chars, this is what shows on customer bank statements, e.g. "E-SITE">
> BUSINESS_WEBSITE=<https://e-site.live OR https://esite-lilac.vercel.app>
> BUSINESS_DESCRIPTION=<one or two sentences, default: "Construction site management SaaS for South African electrical contractors — snag tracking, COC compliance, RFIs, and site diaries.">
> INDUSTRY_CATEGORY=<closest Paystack option, suggest "SaaS" or "Software / Technology">
>
> # === Director / shareholder (one block per director — duplicate as needed) ===
> DIRECTOR_1_FULL_NAME=<as on ID>
> DIRECTOR_1_ID_NUMBER=<13-digit SA ID number>
> DIRECTOR_1_DOB=<YYYY-MM-DD>
> DIRECTOR_1_RESIDENTIAL_ADDRESS=<full street + suburb + city + postal>
> DIRECTOR_1_SHAREHOLDING_PCT=<integer 0–100>
>
> # === Settlement bank (must be in operating entity name, business account, not personal) ===
> BANK_NAME=<e.g. FNB | Standard Bank | ABSA | Nedbank | Capitec | TymeBank | Discovery Bank>
> BANK_ACCOUNT_HOLDER=<must match ENTITY_LEGAL_NAME>
> BANK_ACCOUNT_NUMBER=<digits only, no spaces>
> BANK_BRANCH_CODE=<6-digit universal branch code OR specific branch code>
> BANK_ACCOUNT_TYPE=<Cheque / Current / Business>
>
> # === SARS / tax ===
> SARS_INCOME_TAX_NUMBER=<10-digit company tax number>
> VAT_REGISTERED=<YES | NO>
> VAT_NUMBER=<10-digit, only if VAT_REGISTERED=YES>
>
> # === Support contacts (Paystack will route disputes here) ===
> SUPPORT_EMAIL=<e.g. support@e-site.live — must be monitored daily>
> SUPPORT_PHONE=<+27 nn nnn nnnn — must answer business hours>
>
> # === Documents ready to upload (PDFs, on the device used for KYC) ===
> DOC_CIPC_CERTIFICATE=<file path or "ready">
> DOC_MOI=<file path or "ready">  # Memorandum of Incorporation
> DOC_DIRECTOR_ID_COPIES=<file paths or "ready" — one per director, certified <3 months>
> DOC_PROOF_OF_BUSINESS_ADDRESS=<file path or "ready" — utility bill / lease / bank statement <3 months>
> DOC_PROOF_OF_DIRECTOR_ADDRESS=<file paths or "ready" — one per director, <3 months>
> DOC_BANK_CONFIRMATION_LETTER=<file path or "ready" — issued by bank, NOT a statement>
> DOC_VAT_CERT=<file path OR "n/a if VAT_REGISTERED=NO">
> ```
>
> **Validation:** if any field above still contains a `<...>` placeholder, do not paste yet. Common gaps: bank confirmation letter (people often submit a statement instead — Paystack rejects), proof-of-address >3 months old (Paystack rejects), residential address not matching ID (Paystack rejects).

Paste this into Claude-in-Chrome (after the PRE-FILL block above is fully resolved):

> **Task: complete Paystack live-mode business verification for E-Site.**
>
> **Context:** Arno has a Paystack TEST-mode account active. Pre-fill values for the operating entity, trading name, directors, bank, tax, support contacts, and documents are at the top of this prompt. All documents are gathered. Sole goal of this session: submit the live-mode KYC form so Paystack starts its 1–3 day review.
>
> **Pre-flight sanity checks (do these BEFORE filling anything):**
> a. Confirm logged in to `dashboard.paystack.com` — top-right shows the email Arno expects.
> b. Confirm we're upgrading the existing test account, NOT creating a new account. If a "create new account" CTA is the only path forward, STOP and tell Arno — he may have multiple Paystack identities and we need to know which one to upgrade.
> c. Confirm top-right toggle currently shows "Test mode" (orange badge).
>
> **Steps:**
> 1. Open `https://dashboard.paystack.com` and confirm logged in. Top-right toggle currently on "Test mode."
> 2. Click the top-right toggle to switch to **Live mode**. Paystack will show a banner "Complete your business profile to go live."
> 3. Click the banner / **Complete profile** CTA. (Alternative path: Settings → Compliance.)
> 4. **Business Information form** — fill from pre-conditions above:
>    - Business type (Limited Liability / Sole Proprietor / Partnership / NPO)
>    - Legal business name (matches CIPC)
>    - Trading name
>    - Registration number (CK / 2018/123456/07 format for Pty Ltd)
>    - Industry / category (SaaS / Software / Technology — pick closest)
>    - Country: South Africa
>    - Currency: ZAR
>    - Business address (registered address from CIPC)
>    - Business website: `https://e-site.live` (or staging URL until DNS cutover, but Paystack prefers a live website)
>    - Business description (1–2 sentences, e.g. "Construction site management SaaS for South African electrical contractors — snag tracking, COC compliance, RFIs, and site diaries.")
> 5. **Director / shareholder information** — for each director:
>    - Full name (matches ID)
>    - ID number
>    - Date of birth
>    - Residential address
>    - % shareholding
> 6. **Document uploads** — upload PDFs from §1 checklist. Paystack labels them "Certificate of Incorporation," "Memorandum," "Director ID," "Proof of Address." Match docs to labels.
> 7. **Bank account** — settlement details:
>    - Bank name (dropdown — pick the bank, not the branch)
>    - Account number
>    - Branch code (some banks pre-fill on dropdown selection)
>    - Account holder name (must match operating entity)
>    - Upload bank confirmation letter
>    - Paystack will run an **account-verification micro-deposit** OR trigger an instant Avon Lookup — wait for the green tick before proceeding.
> 8. **Tax details** — SARS income-tax number. VAT number if registered. If you're below VAT threshold, mark "Not VAT registered."
> 9. **Compliance / FICA** — upload director ID + proof of address PDFs.
> 10. **Submit for review.** Paystack shows "Under review — typically 1–3 business days."
> 11. **Report back to Arno:** screenshot of the "Under review" confirmation, plus any field Paystack rejected or asked for clarification on.
>
> **DO NOT do these (separate steps later):**
> - Don't generate live API keys yet (they appear after verification)
> - Don't create plans / webhook URL on the live side yet (do after verification, in §3)
> - Don't switch Vercel env vars to live keys yet (in §4)

**Post-submission (Arno watches inbox):**
- Paystack emails approval or "more info needed" within 1–3 business days. If denied, fix the flagged field and re-submit. Common rejections: bank account not in business name, FICA docs >3 months old, residential address mismatch with ID document.

---

## 3. Live-mode setup AFTER KYC approval (Claude-in-Chrome, ~15 min)

Paste this into Claude-in-Chrome **only after Paystack confirms verification by email.**

> **Task: provision live Paystack — keys, plans, webhook — but do NOT swap Vercel env vars yet.**
>
> **Context:** Paystack live-mode KYC is approved. Now we set up the live-mode plumbing while leaving the Vercel env vars on test keys, so we can review everything before flipping the switch.
>
> **Steps:**
>
> **A. Generate live API keys**
> 1. Open `https://dashboard.paystack.com`. Confirm top-right toggle on **Live mode** (no longer "Test mode").
> 2. Settings → API Keys & Webhooks.
> 3. Live secret key starts with `sk_live_`. Live public key starts with `pk_live_`. Copy both into a temporary secure note (1Password / Vault). Don't paste into chat.
> 4. **Roll** the secret key once after copy (Paystack lets you roll keys; this invalidates any leaked copy). Then re-copy the new value. Keeps the audit trail clean.
>
> **B. Create the four subscription plans**
>
> Amounts below are taken from [`packages/shared/src/services/billing.service.ts`](../packages/shared/src/services/billing.service.ts) `PLANS` constant (source of truth — if these don't match what Arno sees in his pricing page, flag it before continuing). Paystack expects amounts in **kobo** (cents × 100). The Paystack form usually shows a ZAR field that converts internally — if it asks for kobo directly, use the kobo column.
>
> 5. Plans → **Create Plan** (one per pricing tier × period combination):
>
>    | Plan name             | Amount (ZAR) | Amount (kobo) | Currency | Interval  | Description |
>    |-----------------------|--------------|---------------|----------|-----------|-------------|
>    | Starter Monthly       | R499.00      | 49900         | ZAR      | Monthly   | E-Site Starter — 5 projects, 10 users, COC tracking, floor plans, priority email support |
>    | Starter Annual        | R4,990.00    | 499000        | ZAR      | Annually  | E-Site Starter — billed yearly, 2 months free vs monthly |
>    | Professional Monthly  | R1,499.00    | 149900        | ZAR      | Monthly   | E-Site Professional — unlimited projects, 30 users, marketplace access, API access, phone support |
>    | Professional Annual   | R14,990.00   | 1499000       | ZAR      | Annually  | E-Site Professional — billed yearly, 2 months free vs monthly |
>
>    *(Skip the Free and Enterprise tiers — Free has no Paystack flow, Enterprise short-circuits to a `mailto:sales@e-site.live` link in the checkout route.)*
> 6. After each plan is created, copy its **Plan Code** (starts with `PLN_`). Paste into the table below — these are the values that need to land in [`packages/shared/src/services/billing.service.ts`](../packages/shared/src/services/billing.service.ts) under each tier's `paystackPlanCode` field as part of the §0 Path B code change.
>
>    ```
>    starter_monthly_plan_code=PLN_<paste>
>    starter_annual_plan_code=PLN_<paste>
>    professional_monthly_plan_code=PLN_<paste>
>    professional_annual_plan_code=PLN_<paste>
>    ```
>
>    *(Format kept as KEY=VALUE so Arno can grep the chat transcript for `_plan_code=PLN_` and copy all four lines into the next engineering session.)*
>
> **C. Configure live webhook**
> 7. Settings → API Keys & Webhooks → **Webhooks** section → Add webhook URL.
> 8. URL: `https://app.e-site.live/api/paystack/webhook` *(if DNS cutover done)*, **OR** `https://esite-lilac.vercel.app/api/paystack/webhook` *(if cutover not done yet — change later)*.
> 9. Subscribe to events: tick **all** of these (Paystack signs every event with the secret key, no per-event secret):
>    - `charge.success`
>    - `charge.failed`
>    - `subscription.create`
>    - `subscription.disable`
>    - `subscription.not_renew`
>    - `invoice.create`
>    - `invoice.update`
>    - `invoice.payment_failed`
>    - `customeridentification.success` (only if you decide to verify customers, optional)
> 10. Save. Hit **Test webhook** → pick `charge.success` → send. Confirm 200 from `/api/paystack/webhook`.
>
> **D. Branding (optional but recommended)**
> 11. Settings → Branding → upload E-Site logo (PNG, ideally 512×512 transparent). Set brand colour `#E8923A` (the amber). This shows on Paystack-hosted checkout pages and email receipts.
> 12. Settings → Notifications → Receipts → set the FROM name to "E-Site" (the email address stays Paystack's).
>
> **Report back:**
> - Live keys generated + rolled? Y/N
> - 4 plan codes (paste the table)
> - Webhook URL configured + test webhook returned 200? Y/N
> - Branding uploaded? Y/N

---

## 4. Swap Vercel env vars from test → live (Claude-in-Chrome, ~10 min)

**Only do this AFTER §3 is complete AND the §0 Path B code change is merged + deployed AND smoke-tested in test mode.**

> **PRE-FILL BEFORE PASTING — Claude-in-Chrome will paste these into Vercel.**
>
> ```
> # The live secret key copied from Paystack dashboard in §3 step 3.
> # Format check: must start with "sk_live_" — if it starts with "sk_test_" you're still on test mode and §3 wasn't completed.
> SK_LIVE=<sk_live_...>
>
> # The live public key copied from Paystack dashboard in §3 step 3.
> # Format check: must start with "pk_live_".
> PK_LIVE=<pk_live_...>
>
> # The production site URL. Default below assumes DNS cutover is done.
> # If brand domain not yet cutover, use https://esite-lilac.vercel.app and update later.
> PRODUCTION_SITE_URL=<https://app.e-site.live>
> ```

Paste this into Claude-in-Chrome (after the PRE-FILL block above is filled):

> **Task: rotate Paystack keys on Vercel from test → live, Production env only. Keep test keys on Preview so PR previews stay sandboxed.**
>
> **Context:** Live keys + plans + webhook configured on Paystack dashboard. §0 Path B code change is shipped and smoke-tested with test keys. Pre-fill values above contain the live keys to paste.
>
> **Validation before starting:**
> a. Confirm `SK_LIVE` starts with `sk_live_`. If it starts with `sk_test_`, STOP — §3 wasn't completed correctly.
> b. Confirm `PK_LIVE` starts with `pk_live_`. Same check.
>
> **Steps:**
> 1. Open `https://vercel.com/arno-mattheus-projects/esite/settings/environment-variables`.
> 2. Find `PAYSTACK_SECRET_KEY`. Click the row → "Edit." Three environment checkboxes will appear (Production / Preview / Development). For the **Production** row only, paste the `SK_LIVE` value. Leave **Preview** and **Development** rows untouched (they keep the test key).
>    - **Vercel UX gotcha:** if the value field shows the test key as the current value across all envs, you need to "split" the var — click "Add another value" or similar to create a per-env override. Confirm afterward that `vercel env ls` (read-only) shows the var with two distinct entries: one for Production, one for Preview/Development.
> 3. Find `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`. Same edit: Production → `PK_LIVE`, Preview/Development untouched.
> 4. Find `NEXT_PUBLIC_SITE_URL`. Confirm Production value matches `PRODUCTION_SITE_URL`. If wrong, fix it. Preview value should stay `https://esite-lilac.vercel.app`.
> 5. Trigger a Vercel **redeploy** of the latest production deployment (env-var changes do NOT auto-redeploy).
>    - Deployments tab → filter by Production → latest → ⋯ menu → **Redeploy** → tick "Use existing Build Cache" → Redeploy.
> 6. Wait until status shows READY (~50s typical). Note the new `dpl_…` ID from the URL bar.
>
> **Post-rotation verification (do this in this same Chrome session):**
> 7. Open `https://app.e-site.live/api/health` (or whichever the production domain is). The route reads `PAYSTACK_SECRET_KEY` and reports `status:'degraded'` if missing — a 200 response with no Paystack-degraded message confirms the key is loaded post-redeploy.
> 8. As a non-destructive end-to-end check, log in to a real org and click **Subscribe** on `/settings/billing` for the cheapest tier. The Paystack hosted checkout page that opens has a small "Powered by Paystack" footer — if it says "Test mode" anywhere on that page, the rotation didn't take effect (still serving test keys). DO NOT actually pay — just confirm the badge is absent → close the tab.
>
> **Report back:**
> - `PAYSTACK_SECRET_KEY` Production updated? Y/N + screenshot of env-vars page (with values blurred)
> - `PAYSTACK_PUBLIC_KEY` Production updated? Y/N
> - Preview/Development still on `sk_test_…`? Y/N
> - `NEXT_PUBLIC_SITE_URL` Production correct? Y/N + value
> - Redeploy READY? Y/N + new `dpl_…` ID
> - `/api/health` returns 200 with no Paystack-degraded message? Y/N
> - Hosted checkout page in §4.8 absent the "Test mode" badge? Y/N

---

## 5. Smoke test with a real (small) charge (~15 min + 24–48h settlement wait, real money)

**Use a real card. R10 is the smallest sensible test.** Don't use a test card on live mode — Paystack will reject and may flag the account.

Steps Arno does himself (NOT a Claude-Chrome task — requires real card, real bank statement, and decisions only Arno can make about which org to use as the smoke-test target):

**0. Identify which org to use as the smoke-test target.** Open Supabase Studio for the production project → SQL Editor → run:
   ```sql
   -- Lists every org Arno is in, with current tier + project count.
   -- Pick the org with the smallest project count (ideally just 1) so the
   -- post-test paywall-clear behaviour is observable.
   SELECT
     o.id              AS org_id,
     o.name            AS org_name,
     s.tier            AS current_tier,
     s.status          AS subscription_status,
     COUNT(p.id)       AS project_count
   FROM tenants.organisations o
   LEFT JOIN billing.subscriptions s ON s.organisation_id = o.id
   LEFT JOIN projects.projects p ON p.organisation_id = o.id
   WHERE o.id IN (
     SELECT organisation_id FROM tenants.user_organisations
     WHERE user_id = auth.uid() AND is_active = true
   )
   GROUP BY o.id, o.name, s.tier, s.status
   ORDER BY project_count;
   ```
   Note the `org_id` UUID of the chosen test org. Save it as `SMOKE_ORG_ID` for steps 5 + 7 below.

1. Open `https://app.e-site.live/settings/billing` (production, real auth, while logged in as a member of `SMOKE_ORG_ID`).
2. Pick **Starter Monthly** (R499 — the cheapest non-free tier; R10 isn't an option because pricing is plan-fixed). Click **Subscribe**.
3. On Paystack hosted checkout, pay with real card.
4. Confirm redirect back to `/settings/billing?success=1`.
5. Verify in DB — paste this into Supabase Studio SQL Editor (replace `<SMOKE_ORG_ID>` with the UUID from step 0):
   ```sql
   SELECT
     organisation_id,
     tier,
     status,
     paystack_customer_code,
     paystack_subscription_code,
     current_period_start,
     current_period_end,
     created_at,
     updated_at
   FROM billing.subscriptions
   WHERE organisation_id = '<SMOKE_ORG_ID>';
   ```
   Expected:
   - `tier='starter'`
   - `status='active'`
   - `paystack_customer_code` non-NULL (starts with `CUS_`)
   - `paystack_subscription_code` non-NULL (starts with `SUB_`) — **this is the critical Path B proof**: a NULL here means the checkout still ran in one-off mode, the §0 code change didn't actually land, and recurring billing won't work next month.
   - `current_period_end` ≈ `current_period_start + 1 month`
6. Verify in Paystack dashboard → Transactions → the R499 charge is present, status "Success", and clicking it shows Customer + Subscription IDs matching step 5.
7. **Refund the R499** from Paystack dashboard (Transactions → ⋯ → Refund full amount). This is "good citizen" behaviour for a smoke test. The refund webhook will fire `charge.refund` and `charge.success` should already have flipped the subscription to `active`. Confirm the refund does NOT trip `subscription.disable` — re-run the SQL in step 5 after the refund webhook lands (~30s later); `status` should still be `active`. (If status flips to `cancelled`, the webhook handler is over-eager and needs a fix before more customers go live.)
8. **Cancel the test subscription** so it doesn't try to renew next month and re-charge the refunded card. From the app: `/settings/billing` → "Cancel subscription" (if UI exists). Otherwise from Paystack dashboard → Customers → the test customer → Subscriptions → ⋯ → Disable.
9. **Wait for settlement** (24–48h, T+1 to T+2 SA bank schedule). Check the operating-entity bank account: should see `+R499` settlement and shortly after `-R499` refund. Net zero. Confirms the bank link is correct.

**Pass criteria:** all of: step 4 redirects with `?success=1`, step 5 SQL shows non-NULL `paystack_subscription_code`, step 6 transaction visible in Paystack, step 7 refund doesn't trip cancel, step 9 net-zero settlement on bank.

**If any step fails, fail the cutover** — don't open up to real customers until the failed step is debugged. Easiest to debug: the failure mode where step 5 shows NULL `paystack_subscription_code` → §0 Path B code didn't actually ship → roll back keys (see Rollback plan below) and fix the code first.

---

## 6. Post-go-live operational setup (~30 min, mostly Claude-in-Chrome on Paystack dashboard)

Paste this into Claude-in-Chrome after step 5 passes:

> **Task: configure Paystack post-go-live operational settings.**
>
> 1. Settings → Notifications → confirm dispute / chargeback notifications routed to support email (from §1).
> 2. Settings → Notifications → enable Slack / email notifications for `transfer.failed` events (rare but important — means a settlement bounced).
> 3. Settings → Settlement → set settlement schedule. SA default is T+2 daily. Verify this is what we want; for cashflow-tight startups, request T+1 (Paystack may grant after 30d clean track record).
> 4. Settings → Refund Policy → paste the policy text from §1.
> 5. Settings → Customers → enable "Auto-create customer on first charge" (default on, but verify).
> 6. Compliance → confirm CIPC + FICA docs all show "Verified" green ticks.
> 7. Reporting → set up monthly settlement report email to Arno + bookkeeper.
>
> **Report back:**
> - All settings confirmed / changed? Y/N per item.

---

## 7. Tax / regulatory side-quests (Arno + accountant, NOT a Claude-Chrome task)

Flagged here so they don't get missed. None block go-live, but they create silent compliance risk if ignored:

- **SARS VAT registration.** Compulsory once turnover exceeds R1m / 12 months. Voluntary above R50k. If you cross the threshold mid-year, register **within 21 days** or face penalties + back-VAT. Once registered, every invoice (including Paystack-issued ones) must show the VAT number.
- **Tax invoice format.** SARS requires specific fields: supplier name + VAT number + address, customer name + VAT number (if customer is VAT-registered), unique invoice number, date, description, ZAR amount excl VAT, VAT amount, total incl VAT. Paystack-generated receipts may not meet this — you may need to issue your own invoice through the app for any customer that needs it for their VAT reclaim.
- **POPIA payment-data handling.** Card numbers go through Paystack hosted checkout — they never touch E-Site's servers, so PCI scope is "outsourced." But customer email + name + amount + IP + device fingerprint DO get stored. Document this in the privacy policy. POPIA compliance officer must be registered with the Information Regulator (already on the open-items list).
- **Companies Act annual return.** If E-Site Pty Ltd is the operating entity, annual returns + AFS are due to CIPC every year on incorporation anniversary. Bookkeeper / company secretary handles.
- **PAYE / UIF / SDL** if you have employees. Not Paystack-related but a common forgotten piece.

---

## Quick-reference: file locations

| Need to change | File |
|---|---|
| Plan amounts / plan codes | `packages/shared/src/services/billing/plans.ts` (or wherever `PLANS` lives) |
| Checkout body shape (one-off → plan) | `apps/web/src/app/api/paystack/checkout/route.ts` |
| Callback subscription-write logic | `apps/web/src/app/api/paystack/callback/route.ts` |
| Webhook event handlers | `apps/web/src/app/api/paystack/webhook/route.ts` |
| Webhook signature secret (auto, no env var) | uses `PAYSTACK_SECRET_KEY` directly |
| Test card numbers (test mode only) | https://paystack.com/docs/payments/test-payments/ |
| Vercel env var inventory | [`.secrets/vercel.md`](../.secrets/vercel.md) |

---

## Rollback plan (if go-live goes sideways)

If post-§4 you discover a bug in production:

1. **Stop the bleed:** on Vercel, edit `PAYSTACK_SECRET_KEY` (Production) → paste back the old `sk_test_…`. Redeploy. Live customers can no longer initiate new charges (they'll get 503 or test-mode rejection).
2. **Refund any in-flight charges** from Paystack dashboard.
3. **Don't roll back Plans** — leaving them on Paystack's side costs nothing and avoids re-creating with new plan codes later.
4. **Keep webhook URL as-is** — it'll just stop receiving events while keys are in test mode.
5. Fix the bug in code, redeploy with test keys, re-smoke-test, then re-promote to live.

The critical asymmetry: **rotating keys is reversible in seconds; refunding 100 charged customers is not.** Always smoke-test §5 with a single R10 charge before announcing the go-live to any customer base.
