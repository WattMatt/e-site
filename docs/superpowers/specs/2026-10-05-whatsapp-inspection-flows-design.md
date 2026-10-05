# WhatsApp inspection forms: design

**Date:** 2026-10-05 · **Investigation:** `2026-10-05-whatsapp-inspection-flows-investigation.md` (decisions D1–D9 live there).

## User journey

1. A linked member sends `MENU` and picks **Inspections**. The row shows only when the org flag is on and the member has a writable inspection.
2. The bot lists their open inspections in the current project, at most 10. Picking one opens a `form_session`.
3. **Flow-capable template:** the bot sends the Flow, which runs one screen per section. On completion the answers are written, and the bot replies with what is still missing and a numbered list of items that take photos.
4. **Not Flow-capable** (repeating groups, conditions, file fields): the bot sends a signed link to the web capture page instead.
5. A photo sent with the caption `10`, or sent as a reply to the item list, attaches to item 10. An uncaptioned photo is held and the bot asks which item.
6. `SUBMIT`:
   - If a signature is still owed, the bot sends a signed link to the web page, where the member signs and presses Submit.
   - Otherwise the server checks completeness and submits.
7. After any submit of a WhatsApp-origin inspection, by either path, the sender gets a confirmation with the PDF. Linked site members get the `esite_form_submitted` summary. The verifier gets the existing in-app notification.

## Components

| Unit | Where | Job |
|---|---|---|
| `inspection-flow` builder | `packages/shared/src/whatsapp/` | Template JSON becomes Flow JSON (v7.x), plus a `flowCapability(template)` verdict with reasons. Pure. |
| Reply mapper | same | `response_json` becomes response rows (`value_bool/number/text`, `pass_state`, `fail_reason`), using the engine's own field types. Pure. Unknown keys are refused. |
| Photo items | same | Stable numbering of answerable fields, and caption parsing (`10`, `item 10`, `#10`). Pure. |
| Migration `00224`+ | DB | Adds the following: `whatsapp.org_settings`; `whatsapp.form_sessions` (token hash, user, inspection, template row, status, expiry); `whatsapp.flows` (template row to Meta flow id); `whatsapp.form_links`; `inbound.meta_raw`; `via` and `submitted_via`; outbox triggers `form_confirm` and `form_submitted`; staging bucket `whatsapp-media`; `wa_*` act-as functions `wa_my_inspections`, `wa_inspection_save`, `wa_inspection_add_photo` and `wa_inspection_submit`, each also gated on `user_has_project_access` and the org flag. |
| Edge processor | `_shared/whatsapp/` | Parses `nfm_reply`, keeps Meta's JSON, copies media to staging at receipt, adds the menu row and picker, sends the Flow, routes photos, and forwards form steps to Next. |
| Internal route | `apps/web/src/app/api/internal/whatsapp/forms/route.ts` | HMAC-verified. Operations: `flow_reply`, `photo`, `submit`. Runs the engine and renders the PDF in Node, and returns the replies for edge to send. |
| Signed link | `/wa/go/[token]` | The GET shows a Continue button. The POST consumes the token and mints a session through `generateLink` plus `verifyOtp`, then redirects to an allow-listed path. |
| Worker | `_shared/whatsapp/worker.ts` | Sends `form_confirm` as an in-window text plus a document, and `form_submitted` as a template. |
| Settings | `/settings/whatsapp` | Org owners and admins toggle **Forms over WhatsApp**. |

## Error handling and guards

- Every write runs as the user under real RLS. It is refused when any of these hold: the flag is off, the user has no project access, the user is a client viewer, the inspection status is not writable, or the session is expired, foreign or already applied.
- A Flow reply from a different number than the session's is refused and logged.
- Duplicate deliveries are no-ops. The inbound id is unique, and each session applies once per reply.
- `as_left`-style "never default" fields: Flow inputs carry no `init-value`.
- Photos: jpeg or png only, at most 5 MB, stored under a server-built path.

## Testing

- Unit tests for the builder, the mapper, item numbering and HMAC, each mutation-proven.
- Processor and worker tests through the existing fakes.
- SQL assertions, red then green on a dry run against live:
  - refusal paths: flag off, inactive member, client viewer, foreign session, certified inspection;
  - positive path: answers, photo, submit.
- End to end: the D2 template's Flow JSON is built and structurally validated. A recorded `nfm_reply` is replayed through processor, route and DB in a rolled-back production transaction.
- A real-number run is owner-gated and is listed as not verified.
