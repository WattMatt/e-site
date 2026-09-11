/**
 * Edge Function: paystack-webhook — RETIRED 2026-09-11.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A STUB
 * ─────────────────────────────────────────────────────────────────────────────
 * Paystack accepts exactly ONE webhook URL per mode. Two divergent handlers
 * were deployed at once — this function and
 * `apps/web/src/app/api/paystack/webhook/route.ts` — and both failed closed on
 * the same PAYSTACK_SECRET_KEY, so either URL looked healthy when probed. The
 * go-live runbook registers the Next route; `docs/security-audit.md` used to
 * name THIS function as "the implementation". The wrong URL was genuinely
 * pasteable in either direction, and each direction silently dropped a
 * different half of the product:
 *
 *   • Next route configured (the runbook's instruction): `invoice.update` was
 *     unhandled, and the block at the old index.ts:298-304 was the ONLY code
 *     anywhere that cleared `projects.status = 'payment_paused'`. The daily
 *     payment-recovery cron sets that status and six live RLS policies enforce
 *     it, so a customer whose card failed for 14 days had every project
 *     write-locked, paid, and stayed locked forever. Renewal charges carrying
 *     no metadata were also dropped, so no renewal ever produced an invoice
 *     row and MV subscribers lost access on their anniversary.
 *
 *   • This function configured: every R1,999 JBCC unlock, R250 Inspections
 *     unlock, GCR seat and MV subscription was charged and granted nothing —
 *     handleChargeSuccess logged "skipping (subscription)" and returned.
 *
 * The Next route is now the single ingress. `invoice.update` (including the
 * payment_paused → active restore and the failure-counter reset),
 * `invoice.create`, the metadata-less renewal fallthrough, refunds and
 * disputes all live there. This function answers 410 so a mis-pasted URL fails
 * LOUDLY — Paystack surfaces non-2xx as failed deliveries and disables the
 * endpoint — instead of returning 200 and granting nothing.
 *
 * ⚠ DEPLOY ORDER MATTERS. Do not deploy this stub before the Next route
 *   carrying the invoice.update port is live: doing so removes the only path
 *   that can restore a paying customer's projects. Verify the route first.
 *
 * ⚠ NOT PORTED, AND STILL OWED. This function's `handleChargeSuccess` also
 *   handled the marketplace `metadata.order_id` branch (order → paid +
 *   commission_records row) and `transfer.*`. Neither exists in the Next
 *   route. `transfer.*` is dead code — nothing in the monorepo initiates a
 *   Paystack transfer, `initiateTransfer` has zero callers, settlement is by
 *   split_code, and the runbook does not subscribe those events. The
 *   marketplace order branch is NOT dead: MARKETPLACE PAYMENTS MUST NOT GO
 *   LIVE until that branch is ported into the Next route. Prod currently holds
 *   2 orders and 0 commission_records, i.e. it has never run.
 *
 * The original implementation is in git history at
 * `git show HEAD~1:apps/edge-functions/supabase/functions/paystack-webhook/index.ts`.
 */

const GONE_BODY = {
  error: 'gone',
  message:
    'This endpoint is retired. The single Paystack webhook URL is ' +
    'https://www.e-site.live/api/paystack/webhook — update it in the Paystack ' +
    'dashboard under Settings → API Keys & Webhooks.',
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'x-paystack-signature, content-type',
      },
    })
  }

  console.error(
    `paystack-webhook (retired stub) received ${req.method} — the Paystack dashboard ` +
    `still points at this function. Repoint it at https://www.e-site.live/api/paystack/webhook.`,
  )

  return new Response(JSON.stringify(GONE_BODY), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  })
})
