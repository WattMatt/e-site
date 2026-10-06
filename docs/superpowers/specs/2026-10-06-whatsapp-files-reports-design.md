# WhatsApp drawings, documents and reports — design (sub-projects 3 + 4)

**Date:** 2026-10-06 · **Status:** approved in conversation (owner: "Yes, as proposed").
**Builds on:** `2026-09-29-whatsapp-project-channel-design.md` (the channel, current project, menu) and site-scoped access (`00238`).

## Behaviour

The project menu gains two rows, both for the **current project**.

1. **Drawings & documents**
   - Lists the 10 newest active floor plans and project documents together, newest first.
   - The next free text within 10 minutes is a name search, e.g. "E-101" or "DB-3". Search is case-insensitive, and `%`/`_` are literal. A search can be refined by typing again.
   - Picking a row sends the file as a WhatsApp document, which also disarms the search.
   - "menu" during a search still opens the menu.
2. **Reports & schedules**
   - **Cable schedule (PDF)** comes first, when the project has a revision visible to the person.
   - Then the latest *issued* saved report of each kind the person may read.
   - The cable schedule is the latest ISSUED revision, else the newest draft. It is built on demand with the web export's policy: owner/admin/PM get costs, site roles get them redacted, and no effective role gets refused.

Out of scope here (same render path, later): on-demand legend cards and snag visit reports.

## Access

- **Lookups:** `whatsapp.wa_project_files`, `wa_file`, `wa_project_reports` and `wa_report` are owned by `whatsapp_actor` and call `whatsapp.act_as(p_user)`. So `site_scope`, the table policies and the report-kind read gate (`00183`) decide. A row the person can't see is `not_found`.
- **Files:** fetched from storage (`drawings`, `project-documents`, `reports`) with the service key **only after** that lookup said ok. Over 95 MB is refused; WhatsApp's limit is 100 MB.
- **Cable schedule:** built by `POST /api/internal/whatsapp/reports`, HMAC-signed with `WHATSAPP_INTERNAL_SECRET` like the forms route. The person is gated by `getExportPolicy(svc, userId, projectId)`, i.e. `user_effective_project_role` for the named user, which is NULL off-site since `00238`.

## Data

One migration (number at apply time):
- `whatsapp.phone_links.pending_search_at`;
- the four functions (revoked from PUBLIC/anon/authenticated, granted to service_role).

## Proof

- `scripts/db/assert-whatsapp-files.sql`, run against production in a rolled-back transaction: red against a no-op, then 16/16.
  - A single-site contractor lists own-site files and none on a foreign site.
  - A foreign drawing is `not_found` for them, ok for an admin.
  - Search matches only names, and `%` is literal.
  - Report kinds are a subset of the admin's, never `equipment_materials`/`valuation`.
  - Nothing is visible on a foreign site.
  - Authenticated users have no EXECUTE.
  - **Mutation:** removing `act_as` from `wa_file` turns the admin control red, because the function keeps the previous caller's identity.
- Unit tests:
  - `apps/web/src/lib/whatsapp/files.test.ts` covers the flows;
  - `lib/whatsapp-reports/cable-schedule.test.ts` covers gate-first, redaction and revision choice;
  - the internal route test covers signature, ids, base64 and the 500 retry.
