# Paystack Pilot — Settlement Timing Log

Track every transaction run during the T-020 pilot here. The goal is to answer **"how long until funds land in the supplier's bank account?"** before go-live, because that answer drives the copy on the supplier onboarding screen and the expectations we set in the marketplace FAQ.

Fill in each row below after completing a run of `scripts/paystack/pilot-test.ts` against a live Paystack SA test account.

---

## Pilot environment

| Field | Value |
|---|---|
| Paystack account | _(business name, test mode)_ |
| Secret key prefix | `sk_test_...` _(last 4 chars only)_ |
| Pilot date range | _(YYYY-MM-DD → YYYY-MM-DD)_ |
| Subaccount banks used | _(FNB / ABSA / Standard Bank / Nedbank / …)_ |
| Run by | _(name)_ |

---

## 1. Split-payment settlement times (card → subaccount)

Each row corresponds to a transaction from `TEST_CASES` in `pilot-test.ts`.

| # | Split kind | Amount (ZAR) | Card completed at | Paystack dashboard "settled" at | Bank credited at | Elapsed (hours) | Notes |
|---|---|---|---|---|---|---|---|
| 1 | percentage (94/6) | R500.00 |  |  |  |  |  |
| 2 | flat_fee (R500) | R1200.00 |  |  |  |  |  |
| 3 | combination (flat + %) | R350.00 |  |  |  |  |  |
| 4 | multi_subaccount | R2500.00 |  |  |  |  |  |
| 5 | bearer=account | R750.00 |  |  |  |  |  |

**What counts as each column:**

- **Card completed at** — wall-clock time the Paystack test card payment succeeded (stamp from the redirect screen).
- **Paystack dashboard "settled" at** — the timestamp shown in Paystack dashboard → Transactions → _(reference)_ → Settlement Details.
- **Bank credited at** — statement date/time from the supplier subaccount bank, OR for SA test accounts, the simulated-settlement timestamp Paystack returns in the test dashboard.
- **Elapsed** — difference between "card completed at" and "bank credited at", rounded to the nearest hour.

Paystack's documented settlement is **T+2 business days** for SA test accounts. Record whether reality matched and which banks (if any) were faster / slower — this is the evidence base for the supplier-onboarding copy.

---

## 2. EFT (Instant EFT) settlement times

From step 5 in the pilot script (`channels: ['bank_transfer']`).

| # | Amount (ZAR) | EFT initiated at | Paystack confirmed at | Bank credited at | Elapsed (hours) | Notes |
|---|---|---|---|---|---|---|
| 1 | R1000.00 |  |  |  |  |  |

---

## 3. Transfer (payout) latency

When the platform initiates a `transfer` to a supplier (manual payout from E-Site's platform account), how long does it take to land?

| # | Amount (ZAR) | Transfer initiated at | transfer.success webhook at | Bank credited at | Elapsed (hours) | Notes |
|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |

---

## 4. Subscription billing cadence

From step 6. Capture the first two billing cycles.

| Cycle | Date expected | Date charged | Success? | Webhook events observed | Notes |
|---|---|---|---|---|---|
| Initial charge |  |  |  |  |  |
| First renewal |  |  |  |  |  |

---

## 5. Failure modes observed

List every failure — expected (triggered by bad test input) or unexpected. This is the raw data for the "what happens if a payout fails" runbook the ops team needs.

| Scenario | Expected or unexpected | What broke | Recovery path | Time to recover |
|---|---|---|---|---|
|  |  |  |  |  |

Example scenarios to deliberately trigger before signing off:

- Invalid supplier bank account (wrong account number) → `transfer.failed`
- Subaccount with `is_verified=false` → should reject on split init
- Duplicate `reference` on transaction/initialize → should return existing
- Webhook received with bad HMAC signature → should return 401 (see `paystack-webhook/index.ts:328`)

---

## 6. Conclusions

Populate this section only after all runs complete. These statements end up in the supplier onboarding UI copy and the marketplace FAQ.

- **Typical card → supplier bank time:** _(e.g. "~48 hours, all major SA banks")_
- **Worst case observed:** _(bank, hours, cause)_
- **EFT → supplier bank time:** _()_
- **Subscription retry behaviour on failed charge:** _()_
- **Go / no-go recommendation for production:** _(GO / ADJUST / STOP — see development-workflow.md §9.6)_

---

## 7. Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Engineer running pilot |  |  |  |
| Product (Arno) |  |  | GO / ADJUST / STOP |
