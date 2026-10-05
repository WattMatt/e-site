# WhatsApp inspection forms: plan

Spec: `docs/superpowers/specs/2026-10-05-whatsapp-inspection-flows-design.md`.

TDD on every task. Each guard is shown red, by mutation or no-op, before it goes green. Suites to run: `@esite/shared`, `web`, `@esite/db test:ci`, type-check, lint, `next build`.

## PR 1: pure form modules and the database (deploys dark)

1. **Shared builder.** Add `packages/shared/src/whatsapp-forms/` with:
   - `flowCapability`;
   - `buildInspectionFlow`, which produces Flow JSON with one screen per section and carries values forward through each screen's `data`;
   - `mapFlowReply`;
   - `photoItems` and `parseItemRef`;
   - `jpegPngDimensions`.

   The fixture is the real D2 template read from production.
2. **Migration** (number claimed at merge time, above the head):
   - the tables, columns, bucket and `wa_*` functions listed in the spec;
   - grants that revoke PUBLIC and anon;
   - an `@verify` block.
3. **SQL assertions** in `scripts/db/assert-whatsapp-inspections.sql`:
   - refusals: flag off, inactive project member, client viewer, foreign or expired session, certified inspection, path outside the inspection;
   - positive path: save, photo, submit stamps `submitted_via`.

   Dry-run red with no migration, then green.

## PR 2: the chat path

4. **Parser and storage.**
   - `parse.ts` reads `nfm_reply` and `document`.
   - `store.ts` writes Meta's JSON to `meta_raw`.
   - Images are copied to `whatsapp-media/<msgid>` when the message is processed.
5. **Meta client.** Add `sendFlow`, `uploadMedia` and `sendDocument`. The list section title becomes a parameter.
6. **Processor and channel.**
   - An **Inspections** menu row, behind the flag.
   - The inspection picker opens a session and sends the Flow, or a signed link when the template cannot be a Flow.
   - An `nfm_reply` branch.
   - Photo routing by caption, reply or the held-photo prompt.
   - A `SUBMIT` keyword.
   - The edge `core.ts` is synced.
7. **Internal route** at `/api/internal/whatsapp/forms`:
   - HMAC on `WHATSAPP_INTERNAL_SECRET` with a 5-minute skew;
   - operations `flow_reply`, `photo` and `submit`;
   - the PDF is rendered through a refactored `gatherInspectionReportData(id, { client, userId })`.
8. **Worker.**
   - `form_confirm` sends text plus a document within the window, and skips if the window is gone.
   - `form_submitted` sends the template.
   - Both respect the flag, `notify_whatsapp`, quiet hours and the platform switch.

## PR 3: links, settings and docs

9. **Signed link.** `/wa/go/[token]` shows an interstitial, then a POST consumes the token and mints a session through `generateLink` and `verifyOtp`. Redirects go only to allow-listed paths.
10. **Web submit hook.** After `submitInspectionAction` succeeds, if a WhatsApp session is open for that inspection, enqueue the confirm and summary messages.
11. **Settings.** Add the **Forms over WhatsApp** toggle for org owners and admins.
12. **Docs and scripts.**
    - Rows in `docs/rbac-matrix.md`.
    - Runbook section: publishing the Flow, approving the template, setting secrets.
    - `scripts/whatsapp/publish-inspection-flow.ts`, with dry-run as the default.

## Ship

- Merge in order. The deploy workflow applies the migration and the verifier checks it.
- Deploy `whatsapp-webhook` and `whatsapp-worker` through `deploy.sh`.
- Set `WHATSAPP_INTERNAL_SECRET` in Supabase and in Vercel production and preview.
- Confirm the production deployment is the merge commit.
- Smoke test in production:
  - with the flag off, the menu has no Inspections row;
  - an unsigned internal route returns 401;
  - an unauthenticated `/wa/go/x` shows the interstitial and does not consume the token.
