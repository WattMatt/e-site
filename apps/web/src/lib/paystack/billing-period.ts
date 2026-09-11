/**
 * `billing.subscriptions.next_billing_date` is the paid-period end date, and
 * nothing ever wrote it in one-off mode — the only mode exercised in
 * production, and the default until the PAYSTACK_PLAN_* env vars are set.
 *
 * The cost of that: `downgradeExpiredCancellations` (the payment-recovery
 * cron) filters `.lt('next_billing_date', today)`, and `NULL < today` is NULL,
 * so a cancelled customer's row was never selected and nothing else in the
 * codebase resets `tier`. A customer paid R499 or R1,499 once and kept the
 * entitlement forever, cancelled or not. Confirmed on production: both
 * billing.subscriptions rows carry NULL, including the one with three paid
 * invoices.
 *
 * Stamp it wherever the tier is set — the callback and the webhook's
 * charge.success branch — and refresh it on renewal from the authoritative
 * `subscription.next_payment_date` in the invoice.update payload.
 */

/**
 * Charge date + one billing period, as a `YYYY-MM-DD` date string
 * (`next_billing_date` is a DATE column, not a timestamptz).
 *
 * Day-of-month is clamped, so 31 January + 1 month is 28/29 February rather
 * than 3 March — the naive `setUTCMonth(m + 1)` overflows.
 */
export function addBillingPeriod(fromIso: string | undefined | null, period: string): string {
  const parsed = fromIso ? new Date(fromIso) : new Date()
  const from = Number.isNaN(parsed.getTime()) ? new Date() : parsed

  const year = from.getUTCFullYear()
  const month = from.getUTCMonth()
  const day = from.getUTCDate()

  const target =
    period === 'annual'
      ? new Date(Date.UTC(year + 1, month, 1))
      : new Date(Date.UTC(year, month + 1, 1))

  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(day, lastDayOfTargetMonth))

  return target.toISOString().slice(0, 10)
}
