# Snag module — full-chain gap analysis

**Date:** 2026-08-06
**Scope:** snag capture → photos → site visits → report generation → PDF template → preview → stored report → roster notification on visit completion.
**Status:** Investigation complete (protocol phases 1–4). Solution proposed (phase 5) — **awaiting user confirmation before any code.**

---

## Headline

The assumption going in was "we assumed all this is in place with missing functionality". The reality is the opposite of what that implies in both directions:

- **Far more is built than assumed.** The DB schema, the branded PDF template *with inline before/after photo grids*, the inline preview, the versioned report storage with supersede, and the roster-email plumbing are all written, tested and deployed.
- **None of it has ever worked end-to-end in production.** Live data proves the module has never produced a single snag photo, a single sign-off, or a single report.

The gap is not "features missing at the edges". It is **two broken links in the middle of the chain that make the entire close-out half of the snag lifecycle unreachable**, plus one genuinely absent feature (visit completion + its email).

---

## Evidence — live production database

Queried `cbskbnvvgcybmfikxgky` via the Management API on 2026-08-06 (read-only):

| Query | Result |
|---|---|
| `field.snag_photos` rows, by `photo_type` | **`[]` — zero rows, ever** |
| `field.snags` by status | open 3, pending_sign_off 1, in_progress 1, resolved 1 — **zero `signed_off`, zero `closed`** |
| `projects.reports WHERE kind='snag'` | **`[]` — no snag report has ever been generated** |
| `field.snag_visits` | 1 row (1 real visit), 6 snags |
| `field.snag_photos` CHECK constraint (live) | `photo_type = ANY (ARRAY['evidence','closeout','markup'])` |
| `field.snag_visits` columns (live) | id, organisation_id, project_id, visit_no, is_backlog, visit_date, conducted_by, attendees, title, notes, created_at, updated_at — **no completion column** |
| Migrations applied | 00120, 00146, 00147, 00173, 00176 all present |

The scaffolding is deployed. The feature has never functioned.

---

## Full-system map — layer by layer

| # | Layer | Verdict |
|---|---|---|
| 1 | `field.snags` table (00004) | ✅ Complete — status, priority, assignment, sign-off columns |
| 2 | `field.snag_photos` table (00004) | ✅ Complete — `photo_type` evidence/closeout/markup, `sort_order`, `caption`, `visit_id` (added 00120) |
| 3 | `snag-photos` storage bucket (00012) | ✅ Exists, private, 10 MB cap, jpeg/png/webp/heic, org-prefix RLS |
| 4 | `field.snag_visits` + carry-forward stamps (00120) | ✅ Complete — RLS, visit numbering trigger, backlog backfill |
| 5 | `projects.reports` (00117) | ✅ Complete — `kind` is unconstrained `TEXT`, so `kind='snag'` inserts cleanly |
| 6 | Photo capture — **web** | ❌ **BROKEN** (see RC-2, RC-3) |
| 7 | Photo capture — **mobile** | ❌ **BROKEN** (see RC-1) |
| 8 | Snag sign-off / close-on-visit | ❌ **UNREACHABLE** (see RC-2) |
| 9 | Report data gather (`snag-visit-report-data.ts`) | ✅ Complete — fetches photos as `data:` URIs, buckets new/still-open/closed, before/after split |
| 10 | PDF template (`snag-visit-report.tsx`) | ✅ Complete — branded cover, 2-col photo grids, "Before"/"After ✓" labels, 488 lines + render tests |
| 11 | Preview before download | ✅ Complete — inline `Content-Disposition`, popup-safe `previewViaSignedUrl` |
| 12 | Report storage for future download | ✅ Complete — versioned upload, `projects.reports` row, supersede, `SavedReportsPanel` |
| 13 | Roster resolution (00146) | ✅ Complete — `project_notification_recipients()`, live, matches access predicate |
| 14 | Per-project email toggle (00147) | ✅ Complete — `notify_snag_email` |
| 15 | Snag-created / status-changed email | ⚠️ Works, but per-snag only — noisy, no images, no report link |
| 16 | **Visit-completed email** | ❌ **DOES NOT EXIST** (see RC-4) |

---

## Root causes

### RC-1 — Mobile writes an invalid `photo_type`, so every mobile snag photo insert fails

`apps/mobile/app/snags/create.tsx:94` inserts `photo_type: 'defect'`.
The live CHECK constraint (`00004_field_schema.sql:45-46`, verified against prod) permits only `'evidence' | 'closeout' | 'markup'`.

`'defect'` has never been a legal value. Every mobile snag-photo insert violates the constraint and throws. Worse, the storage upload happens *first* (`create.tsx:90`), so each attempt **leaves an orphaned object in the `snag-photos` bucket with no DB row**, then surfaces as a generic `Alert('Error')`.

*Evidence:* `field.snag_photos` is empty in production despite 6 snags existing.

### RC-2 — No code path anywhere writes a `closeout` photo, yet sign-off requires one

Across the entire monorepo, `photo_type` is written in exactly two places:
- `apps/web/src/app/(admin)/projects/[id]/snags/new/page.tsx:101` → `'evidence'`
- `apps/mobile/app/snags/create.tsx:94` → `'defect'` (invalid, per RC-1)

**Nothing ever writes `'closeout'`.**

But both sign-off paths hard-require one:
- `snag.actions.ts:76` — `signOffSnagAction` returns *"A closeout photo is required before signing off"*
- `snag-visit.actions.ts:293` — `closeSnagOnVisitAction` returns *"A closeout photo is required before closing a snag on a visit"*

**Snags therefore cannot be signed off or closed in production. Ever.** This is a hard deadlock, not a friction point.

Downstream consequences, all confirmed by the empty prod tables:
- The report's `closedThisVisit` bucket can never populate.
- The "After ✓" photo grid in the PDF is dead code in practice.
- The whole point of a snag & defect report — *proof the defect was fixed* — cannot be produced.

*Evidence:* zero `signed_off` / `closed` snags in prod; one snag sitting in `pending_sign_off` — someone tried and was blocked.

### RC-3 — Web can only attach photos at snag creation; there is no add-later uploader

`SnagPhotoGrid.tsx` is display + lightbox only — no file input, no upload handler.
`/snags/[id]/page.tsx` only calls `createSignedUrl` to render existing photos.

So on web a photo can be attached **only** in the few seconds during initial creation. Once the snag exists, no photo can ever be added to it.

This also makes a comment in the code actively misleading — `VisitDetail.tsx:424` states:

> *"Photos are added AFTER creation on the snag detail page… upload flow lives on /snags/[id]."*

That upload flow does not exist. Snags raised from a site visit (`addSnagToVisitAction`) therefore have **no photo path at all** — not at creation, not after.

### RC-4 — There is no concept of a site visit being "completed"

`field.snag_visits` has no `status`, `completed_at`, or `completed_by` column (verified live). There is no complete-visit action, no UI control, and consequently no completion event to hang a notification on.

What exists instead is **per-snag** email: one email per snag raised (`notifySnagCreated`) and one per status change (`dispatchSnagStatusEmail`). A 40-snag inspection walk sends 40 separate emails and never sends the one message that actually matters — *"the site visit is done, here is what we found, here is the report."*

The email templates themselves (`renderSnagCreatedEmail` / `renderSnagStatusEmail`, both in `packages/shared/src/email/rfi-email.ts`) are plain text-and-a-button: no images, no counts, no report link.

---

## Architecture-or-symptom check (protocol phase 4)

**Is this a bug within the current design, or is the design wrong?**

**Mixed — and the distinction matters for the fix.**

- **RC-1 is a plain bug.** One wrong string literal. Fix the literal.
- **RC-2 and RC-3 are a design gap, not bugs.** The schema correctly models a two-phase evidence lifecycle (`evidence` → `closeout`) and the report template correctly renders it as Before/After. The *UI was only ever built for phase one.* A guard was written against a capability that was never built. Patching the guard away (dropping the closeout requirement) would be the wrong fix — it would discard the module's core value. The right fix is to **build the missing half of the lifecycle**.
- **RC-4 is a design gap of the "one control doing the wrong thing" class.** The current design notifies at *snag* granularity because that was the only event that existed. But the real-world unit of work — the thing a project team cares about, and the thing the report is scoped to — is the **site visit**. The notification granularity is wrong, not merely missing. Adding a visit-completion event fixes the granularity; it is additive and does not require removing the per-snag emails (though they should arguably be quieted while a visit is in progress).

**Conclusion:** do not patch symptoms. Build the missing lifecycle half (closeout capture) and the missing lifecycle event (visit completion), then hang the notification off the event.

---

## Proposed solution

Five phases. Phases 1–2 are strictly corrective and unblock everything downstream; phase 3 is the new feature; phases 4–5 are delivery.

### Phase 1 — Unblock photo capture (corrective)

1. **Fix RC-1:** `'defect'` → `'evidence'` in `apps/mobile/app/snags/create.tsx:94`. Reorder so the DB insert precedes/accompanies the upload, or clean up the storage object on insert failure, so a rejected insert stops orphaning bucket objects.
2. **Sweep orphans:** list `snag-photos` bucket objects with no matching `snag_photos` row; delete (with a dry-run first, mirroring `recompute-cable-derates.ts`).
3. **Fix RC-3 — web add-later uploader:** a `SnagPhotoUploader` client component on `/snags/[id]`, reusing the existing `compressImage` helper (already built for inspections, canvas resize 2048 px / JPEG q0.85 — avoids the ~4.5 MB serverless body cap). Explicit **"Evidence" vs "Close-out"** photo-type selector.
4. **Fix RC-2 — closeout capture on both platforms:** the same uploader, surfaced at the sign-off / close-on-visit point so the required evidence is captured *in the flow that requires it*, not somewhere else. Mobile: add photo capture to `snags/[id]/index.tsx` (currently read-only) using the existing `ImagePicker` + `storageService` pattern from `create.tsx`.
5. Stamp `visit_id` on photos captured in a visit context (column already exists, 00120).

**No migration required for phase 1.** Every column and bucket already exists.

### Phase 2 — Visit completion state (new migration)

New migration `00178_snag_visit_completion.sql`:

```
ALTER TABLE field.snag_visits
  ADD COLUMN IF NOT EXISTS completed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by   UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS report_id      UUID;   -- FK → projects.reports(id), the issued pack
```

Additive, idempotent, reversible, `field` already PostgREST-exposed → trailing `NOTIFY pgrst` only, no config PATCH (same note as 00120).

`completeSnagVisitAction`:
1. Gate on `ORG_WRITE_ROLES` + cross-project guard (same guards as the existing export action).
2. Render + store the report by calling the **existing** `exportSnagVisitReportAction` — no new PDF code.
3. Stamp `completed_at` / `completed_by` / `report_id`.
4. Fire the visit-completed notification (phase 3).

Re-completion is permitted for owner/admin and supersedes the prior report version — the supersede logic already exists and is proven.

### Phase 3 — Visit-completed email (the requested feature)

New `renderSnagVisitCompletedEmail` in `packages/shared/src/email/`.

**This mirrors a pattern already shipped and tested** — `renderDiaryCreatedEmail` (`rfi-email.ts:166-201`) already embeds inline image thumbnails via signed URLs with an overflow summary (`"+ N more attachment(s)"`) and is covered by tests asserting the `<img>` count and HTML-escaping. Snag visits reuse that shape.

Content:
- **Header:** project name, visit number + date, conducted by, attendees.
- **Summary counts:** new snags raised / still open / closed this visit / total outstanding — computed by the existing `computeVisitBuckets` service.
- **Top defects list:** title, priority, location for the first N (~5), then *"+ N more — see the report"*.
- **Inline thumbnails:** ~4–6 signed-URL images, before/after pairs preferred. *Signed URLs, not `data:` URIs — Gmail strips `data:` in `<img>`.*
- **Report link:** button to the visit page.
- **HTML-escaped throughout**, matching the existing XSS tests on the sibling templates.

Delivery reuses the existing path end-to-end: `notifyEntityEvent` → roster from `project_notification_recipients()` → gated by `notify_snag_email` → `send-email` edge fn → Resend batch. **No edge-function redeploy needed** (the function is a `{to, subject, html}` passthrough).

One clean-up worth doing here: `notify.ts` and `snag-email.ts` both post `type: 'rfi-created'` to the edge function regardless of module. It works (passthrough) but is mislabelled and will mislead the next reader.

In-app bell: add `snag_visit_completed` to `notifications_type_check` in the same migration (the constraint is re-declared wholesale each time — see 00173/00176 — so the full enum must be re-listed, not appended).

### Phase 4 — Tests

TDD, per repo convention:
- Unit: email renderer (counts, thumbnail cap, overflow line, escaping), completion action (guards, supersede, idempotency).
- Integration: full chain on a throwaway project — raise → photo → closeout → close → complete → report row → email payload.
- Regression: a test asserting `photo_type` literals in app code are members of the DB CHECK set — this class of bug should never ship twice.

### Phase 5 — Deploy

Migration (Management API) → merge → Vercel → prod verification against a real project.

---

## Verification plan (stated upfront, per protocol phase 7)

On production, using the `rbac-test` fixture and a throwaway probe-admin (deleted after, zero residue — the established pattern):

1. Raise a snag on a visit from **web** → attach evidence photo → confirm `field.snag_photos` row exists with `photo_type='evidence'` and a real storage object.
2. Repeat from **mobile** → confirm the row inserts (RC-1 closed).
3. Upload a **closeout** photo → sign off the snag → confirm `status='signed_off'` (RC-2 closed — this has never once succeeded in prod).
4. Complete the visit → confirm `completed_at` set, `projects.reports` row created with `kind='snag'`, PDF ≥1 page, storage object present.
5. Open the preview route → confirm inline PDF renders **with photos visible** in both Before and After grids.
6. Confirm the roster email arrives at a real inbox with correct counts, visible thumbnails, and a working report link.
7. Confirm `notify_snag_email=false` suppresses the email but not the bell.
8. Confirm `client_viewer` cannot upload, close, or complete.

Any failure returns to phase 1 of the protocol — no patching the patch.

---

## Decisions taken (confirmed by the user, 2026-08-06)

1. **Report delivery** — deep link to the visit page. Login required, so access stays governed by RLS.
2. **Per-snag email during an open visit** — suppressed; rolled into the completion email. The bell still fires. Standalone snags, and snags added to an already-completed visit, email immediately.
3. **Close-out photo** — stays mandatory for sign-off.
4. **Delivery** — all five phases in one PR.

---

## Outcome — shipped 2026-08-06 (PR [#158](https://github.com/WattMatt/e-site/pull/158), merged `04af21b`, migration `00178` applied, deployed + prod-verified)

All 7 CI checks green. shared 1275 / web 1244 / three type-checks / lint clean.

**Prod verification** ran end-to-end inside a **throwaway project** (`ZZ-SNAG-VERIFY`) with `notify_snag_email = false`, because `project_notification_recipients()` resolved **12 real wmeng.co.za people** for any WM-Consulting project — a live completion email would have gone to the whole company. Verified:

| Check | Result |
|---|---|
| `photo_type='evidence'` + `'closeout'` rows insert | ✅ constraint accepted both — the first snag photos ever written to this DB |
| Close-out guard would pass → snag `signed_off` | ✅ the first sign-off ever, previously impossible |
| Snag detail page (deployed) | ✅ Evidence/Close-out selector + file input render |
| Visit page (deployed) | ✅ "Complete visit" control present |
| Report PDF via preview route | ✅ 200, 2 pages, **embedded image objects present** |
| `completeSnagVisitAction` invoked over real HTTP | ✅ `completed_at`/`completed_by`/`report_id` all stamped |
| Report versioning | ✅ v2 issued, v1 `superseded` with `superseded_by` set; `report_id` → current issued row |
| Bell `snag_visit_completed` | ✅ inserted — proves the 00178 enum re-declaration accepted the new type |
| Email gate | ✅ suppressed by `notify_snag_email=false` |
| Completed-state UI | ✅ banner rendered, Complete hidden, Reopen offered |
| Teardown | ✅ zero residue: 0 test projects / probe users / probe profiles / snag reports / visit bells / auth_events; real data unchanged (6 snags, 1 visit, 13 projects) |

**Gotchas found during verification (worth remembering):**

- **Next server-action IDs must be read from `createServerReference("<id>", …, "<exportName>")`** in the production client chunk. A looser "40-hex near the name" regex mis-mapped `exportSnagVisitReportAction` and `completeSnagVisitAction` to the same id, so the first invocation silently ran *export* — the report appeared but nothing was stamped, which briefly looked like a product bug. It wasn't.
- **The `Prefer: resolution=merge-duplicates` gotcha bit again.** A supabase-js `.upsert()` on `projects.project_settings` reported no error yet left `notify_snag_email = true`. Always re-read the row after an upsert — especially when the value gates outbound email.

**Not done deliberately:** no live completion email was sent to the real roster. The template is unit-tested (10 tests) and was rendered from the real renderer for review. Sending a live one is a one-line toggle on a project once you want it.

**Follow-ups worth considering:**
- `field.snag_photos` INSERT RLS keys on **org membership**, not project access — a cross-org user promoted via `project_members` can view but not upload snag photos. Inherited from `field.snags`; unchanged here.
- The web `snags/new` page still uploads photos without client-side compression (the new uploader does compress).
- KINGSWALK's 6 real snags still have zero photos — the module now works, but historical snags have no evidence to show.
