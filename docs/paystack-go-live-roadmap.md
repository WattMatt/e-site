# Paystack Production Go-Live Roadmap

> **Audience:** Arno + Claude-in-Chrome session.
> **Companion docs:** [`.secrets/vercel.md`](../.secrets/vercel.md) (env-var inventory), [`paystack-pilot-settlement-timing.md`](paystack-pilot-settlement-timing.md) (marketplace splits — Phase 2).
> **Status as of 2026-05-12:** Test mode keys are live on Vercel, subscription checkout flow is wired end-to-end, callback route activates the subscription on first payment. Webhook URL not yet configured on Paystack dashboard. Live mode not provisioned.

---

## 0. Code-side blocker (NOT a Claude-Chrome task — flagged here so it doesn't get missed)

**The subscription flow is currently a one-off charge, not a recurring subscription.**

Look at [`apps/web/src/app/api/paystack/checkout/route.ts`](../apps/web/src/app/api/paystack/checkout/route.ts):
- Calls `POST https://api.paystack.co/transaction/initialize` with a fixed `amount` and `currency`.
- No `plan` / `plan_code` field is sent.
- No customer is created in Paystack's customer registry.

This means: the customer pays once → callback route sets `tier='starter'` (or whichever) → next month, **Paystack does NOT auto-charge them.** The subscription will silently lapse with no renewal attempt.

The `webhook` route already handles `subscription.disable`, `subscription.not_renew`, and `invoice.payment_failed` — so the system was designed for recurring billing, but the checkout side was wired as a one-off. Pre-go-live, **one** of two paths must land:

**Path A — keep one-off, make the app drive renewals (smaller code change):**
- Add `expires_at` column on `billing.subscriptions` (or use existing `current_period_end` if present).
- Cron job (pg_cron edge function) that flips status → `expired` when `expires_at < now()`.
- App banner / email at T-7 / T-3 / T-0 prompting the customer to manually re-pay.
- Predictable code, no Paystack subscription state to keep in sync. Cost: friction (customers must remember).

**Path B — wire actual recurring subscriptions via Paystack's Plans API (proper):**
- Create Plans on Paystack dashboard (Starter monthly, Starter annual, Professional monthly, Professional annual). Get back four `plan_code` values.
- Add `plan_code` to `PLANS` constant in `packages/shared`.
- Change the checkout body to include `plan: <plan_code>` (Paystack auto-creates a customer + subscription on first charge).
- Webhook already handles renewal events — should "just work."
- Cancellation flow: separate UI button calling `subscription.disable` API.

**Recommendation:** Path B for any real-customer scenario. Path A is fine for paying friends-and-family pilot or first 5 customers, but is a maintenance burden long-term.

If shipping Path B: **do this code change FIRST**, deploy to staging with test keys, smoke-test recurring with Paystack's test-mode plan auto-renewal, THEN go live. Don't go live with one-off charges and try to retro-fit Plans later — every existing one-off-charged customer becomes a special case.

The rest of this doc assumes Path B is the chosen path.

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

Paste this into Claude-in-Chrome:

> **Task: complete Paystack live-mode business verification for E-Site.**
>
> **Context:** Arno currently has a Paystack TEST-mode account active (test keys live on Vercel). We need to upgrade to LIVE mode. All required documents are gathered (see §1 of `docs/paystack-go-live-roadmap.md`). Operating entity, trading name, settlement bank account, and support contacts are decided.
>
> **Pre-conditions Arno will paste back:**
> - Operating entity legal name + registration number:
> - Trading name (max 22 chars):
> - Settlement bank: bank name + account holder + account number + branch code:
> - Support email + phone:
> - Refund policy URL (or policy text):
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
> 5. Plans → **Create Plan** (one per pricing tier × period combination):
>
>    | Plan name | Amount | Currency | Interval | Description |
>    |---|---|---|---|---|
>    | Starter Monthly | <amount in ZAR> | ZAR | Monthly | E-Site Starter — 5 projects, 10 users |
>    | Starter Annual | <amount in ZAR> | ZAR | Annually | E-Site Starter — billed yearly, 2 months free |
>    | Professional Monthly | <amount in ZAR> | ZAR | Monthly | E-Site Professional — unlimited projects, unlimited users |
>    | Professional Annual | <amount in ZAR> | ZAR | Annually | E-Site Professional — billed yearly, 2 months free |
>
>    *(Amounts come from `PLANS` in `packages/shared`. Arno: paste actual ZAR amounts before sending this to Claude Chrome.)*
> 6. After each plan is created, copy its **Plan Code** (starts with `PLN_`). Paste into a list:
>
>    | Plan | Plan Code |
>    |---|---|
>    | starter monthly | `PLN_…` |
>    | starter annual | `PLN_…` |
>    | professional monthly | `PLN_…` |
>    | professional annual | `PLN_…` |
>
>    These plan codes go into `packages/shared/.../plans.ts` in the code change for §0 Path B.
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

> **Task: rotate Paystack keys on Vercel from test to live, in production env only. Keep test keys on preview env so PR previews stay sandboxed.**
>
> **Context:** Live keys + plans + webhook configured on Paystack dashboard. Code change for §0 Path B is shipped and smoke-tested with test keys. Now we swap Vercel.
>
> **Steps:**
> 1. Open `https://vercel.com/arno-mattheus-projects/esite/settings/environment-variables`.
> 2. Find `PAYSTACK_SECRET_KEY`. Click the value → "Edit." For the **Production** env only, paste the `sk_live_…` value. Leave **Preview** untouched (test key stays).
> 3. Find `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY`. Same edit: Production → `pk_live_…`, Preview untouched.
> 4. While here: confirm `NEXT_PUBLIC_SITE_URL` is `https://app.e-site.live` for Production (after DNS cutover), and `https://esite-lilac.vercel.app` for Preview. If wrong, fix.
> 5. Trigger a Vercel **redeploy** of the latest production deployment so the new env vars apply. (Vercel does NOT auto-redeploy on env-var change.)
>    - Deployments tab → latest production deployment → ⋯ menu → **Redeploy**.
> 6. Confirm redeploy reaches READY (~50s).
>
> **Report back:**
> - Production env updated for both keys? Y/N
> - Preview env still on test keys? Y/N
> - Redeploy completed? Y/N + new dpl_… ID

---

## 5. Smoke test with a real (small) charge (~15 min, real money)

**Use a real card. R10 is the smallest sensible test.** Don't use a test card on live mode — Paystack will reject and may flag the account.

Steps Arno does himself (NOT a Claude Chrome task, requires real card + real bank statement):

1. Open `https://app.e-site.live/settings/billing` (production, real auth).
2. Pick the cheapest tier × period combo. Click **Subscribe**.
3. On Paystack hosted checkout, pay with real card.
4. Confirm redirect back to `/settings/billing?success=1`.
5. Query staging-vs-prod DB:
   ```sql
   SELECT org_id, tier, status, paystack_customer_code, paystack_subscription_code, current_period_end
     FROM billing.subscriptions
    WHERE org_id = '<your test org id>';
   ```
   Should show `tier='starter'` (or whichever), `status='active'`, plus a non-NULL `paystack_subscription_code` (this is what proves Path B is working — without it, you're still on one-off mode).
6. Check Paystack dashboard → Transactions → confirm the R10 charge present.
7. Refund the R10 from Paystack dashboard (Transactions → ⋯ → Refund) so the customer-side reconciliation is clean. Refund webhook will fire `charge.refund` — confirm it doesn't trip the `subscription.disable` path (it shouldn't, but worth checking).
8. **Wait for settlement.** Paystack settles SA cards on T+1 to T+2. Check the business bank account 24–48h later. Confirm the refund arrived back too (-R10 settlement).

If steps 4 / 5 / 6 / 8 all pass: **live mode is working.**

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
