# Site Diary — Consolidated Remediation Plan

Date: 2026-06-25
Scope: full Site Diary feature — create → multi-image upload → persistence/RLS → circulation (bell + email) → display → weekly/org views → export.
Decision locked: diary-entry **emails carry the full entry + inline photo thumbnails via long-lived signed URLs** (Option A).

Status: Phases 0, 1 and 2 IMPLEMENTED on branch `feat/diary-remediation-p0-p1` (not committed).
Verified by unit tests + type-check (web/shared/mobile all clean). Remaining: real-env smoke
test (auth'd web flow, on-device mobile, actual email render) once deployed.

Progress log:
- [x] Phase 0 — C1 web double-submit guard (useRef lock + submitting state); C3 broken weekly Export PDF removed.
- [x] Phase 1 — notify moved to post-attachment shared path. Web: notifyDiaryEntryAction (after upload).
      Mobile: new POST /api/diary/notify route (JWT-auth + org gate) called from the diary screen, reusing
      the same notifyDiaryEntryCreated path → mobile entries now notify the roster (was silent).
- [x] Phase 2 — rich email: renderDiaryCreatedEmail now renders the full entry (type, weather, workers,
      all notes) + inline image thumbnails via 7-day signed URLs + deep link to the specific entry
      (anchor added on the project diary page).
- [ ] Phases 3–8 — multi-image hardening, pagination, email-batch resilience, validation/authz/KPI,
      realtime/observability, weekly PDF report, expanded tests.

---

## Root causes (most findings ladder up to these)

1. **Notification is bolted onto "entry created" at the web client boundary, not the shared write path.**
   - Web fires notify *inside* the create action (`diary.actions.ts:54`), *before* the browser uploads attachments (`AddDiaryEntryForm.tsx:79`). → emails can never contain images, and the link is sent before the entry is "complete".
   - Mobile calls `diaryService.create` directly and never notifies. → mobile entries are silent.
2. **"Create once" lives only in client component state — no disabled control, no server idempotency.** → double-submit and multi-image partial-failure both produce duplicate entries + duplicate notifications.
3. **No pagination / unbounded reads** on every list path. → slow now, breaks at scale.

Fixing #1 is the linchpin: it simultaneously makes mobile notify the roster AND unlocks full-entry-with-images email.

---

## Consolidated findings (verified)

### CRITICAL
- **C1 Web double-submit → duplicate entries + duplicate notifications.** `disabled={isPending}` only covers the trailing `router.refresh()`, not create+upload. `AddDiaryEntryForm.tsx:48-102,323`.
- **C2 Mobile entries notify nobody (bell or email).** No notify call; no `notify-entity` fn exists on `main`. `apps/mobile/app/diary/[projectId].tsx:44-88`.
- **C3 Weekly "Export PDF" button is broken in prod.** `generate-report` has no `diary-weekly` handler → `Invalid report type`. `weekly/page.tsx:75` + `generate-report/index.ts:41,66,85`.
- **C4 Mobile multi-image partial failure → duplicate entries + duplicate/partial images.** No `entryId` reuse across retries; `onError` doesn't reset state. `apps/mobile/app/diary/[projectId].tsx:44-66`.

### MAJOR
- **M1 Emails are link+excerpt only** — no full entry, no images; link goes to the diary *list*, not the entry. Blocked by root cause #1 + transport has no attachments + renderer only receives `summary`. `rfi-email.ts:154-165`, `diary-email.ts`.
- **M2 No pagination anywhere** — unbounded entries + attachments + signed-URL minting. `diary.service.ts:55-103`, org/weekly/project pages.
- **M3 Email batch aborts remaining recipients on first chunk error.** `send-email/index.ts:47-58`.
- **M4 Mobile bypasses `createDiarySchema` + uses client-supplied orgId.** `apps/mobile/app/diary/[projectId].tsx:26,46`.
- **M5 Attachment delete: coarse authz + Safari-broken confirm.** Any org member can delete anyone's attachment (RLS checks org only); `window.confirm()` is suppressed in Safari. `DiaryAttachmentStrip.tsx:48`, `00091:65-72`.
- **M6 `avgWorkersPerDay` divides by `totalEntries`, not `daysWithEntries`** (no unique day constraint). `diary.service.ts:134`.
- **M7 Mobile HEIC mislabel** — compressed JPEG kept with `.HEIC` name + `image/heic` mime → broken thumbnails on web. `DiaryAttachmentPicker.tsx:55-64`.
- **M8 Diary list is not realtime** (bell is) → users are notified but the list is stale until manual refresh. `NotificationCentre.tsx:27-36` vs no diary channel.
- **M9 No DB CHECK on `workers_on_site`** + mobile can write unvalidated. `00002:152`.

### MINOR
- m1 Duplicate React keys (`name-size`) + no dedup of selected files. `AddDiaryEntryForm.tsx:306`, `DiaryAttachmentPicker.tsx:101`.
- m2 Web retry restarts `sort_order` at 0 → ordering corruption. `diary-attachments.ts:34,46`.
- m3 Signed-URL 1h expiry → stale thumbnails on long-open pages.
- m4 Missing DELETE RLS policy on `site_diary_entries` (latent; web delete uses service client).
- m5 Bell-send failures silently swallowed. `notifications.ts:52`.
- m6 Blank/invalid email strings reach Resend. `notify.ts:34`.
- m7 No per-user notification opt-out (project-wide only; default ON). `project-settings.schema.ts:109`.
- m8 Mobile missing 100 MB client guard. `apps/mobile/src/lib/diary-attachments.ts`.
- m9 UTC date defaults + `new Date(entry_date)` cross-browser display. both clients.
- m10 `caption` column never written or shown (dead field). `00091:18`.
- m11 Edit/update is UI-less; UPDATE policy + `updated_at` trigger latent — if edit is added, needs optimistic concurrency (no version guard).
- m12 Web create doesn't track analytics (asymmetric with mobile). `diary.actions.ts`.
- m13 `created_by`/`uploaded_by` FKs have no `ON DELETE` → profile delete is RESTRICTED. `00002:155`, `00091:20`.
- m14 Org-page filter inputs not validated (entryType cast). `diary/page.tsx`.
- m15 CSV formula-injection guard needed if/when a CSV export is added (`esc()` lacks it).
- m16 Test gaps: multi-image upload, notification receipt, mobile create+notify, weekly aggregation, export.

---

## Ordered execution plan (each phase independently shippable)

### Phase 0 — Immediate stop-the-bleeding (small, low risk)
- C1: add explicit `submitting` state; guard `submit()` re-entry; use it for `disabled`. (+ optional server idempotency key on create.)
- C3: hide/disable the weekly "Export PDF" button until Phase 7 implements it (prevents the visible error). Verify: clicking no longer errors.

### Phase 1 — Linchpin: notify on the shared, post-attachment path
- Add a single `notifyDiaryEntry(entryId)` server action/edge function that gathers the **full** entry + its committed attachments and fans out bell + email.
- Web: remove notify from create; call it at end of `submit()` after uploads succeed.
- Mobile: call it in `createMutation.onSuccess` after uploads succeed.
- Make it idempotent (guard against double-notify on retry).
- Verify: web + mobile both produce exactly one bell+email after the photos exist; author excluded from bell.

### Phase 2 — Rich email (depends on Phase 1) — Option A
- Notifier queries full entry (type, weather, workers, all notes) + attachments.
- `renderDiaryCreatedEmail`: render full entry + image strip (up to N thumbnails) via **7-day** signed URLs; deep link to the specific entry (add per-entry route/anchor). Keep `escapeHtml` on all fields.
- Verify: email shows full fields + thumbnails; opens the exact entry.

### Phase 3 — Multi-image hardening (both clients)
- Stable per-file id + dedup of selected files; fix React keys.
- Mobile: reuse created `entryId` across retries; reset/resume on error (mirror web).
- Web: continue `sort_order` across retries.
- Mobile HEIC: after compress, force name→`.jpg` + mime→`image/jpeg`.
- Mobile: add 100 MB guard + count cap.
- Verify: select 5 images incl. duplicates + an iPhone HEIC; fail mid-batch; retry → one entry, correct order, all render on web.

### Phase 4 — Scale & delivery robustness
- Pagination (`limit` + cursor) on `list`/`listByOrg` + pages; lazy-load/caches signed URLs.
- `send-email`: per-chunk try/catch, return `{sent, failed}`, retry failures.
- Verify: 300-recipient project, induced chunk error → others still delivered; 2k-entry org page paginates.

### Phase 5 — Validation, authz & integrity
- Mobile: validate with `createDiarySchema`; resolve org server-side (via the shared path).
- `workers_on_site` CHECK constraint.
- Attachment delete via server action with author/PM gate; replace `window.confirm` with two-step.
- Add DELETE RLS policy on entries (defense-in-depth).
- M6: divide by `daysWithEntries` + fix label; validate org-page filters.

### Phase 6 — UX & observability
- Realtime diary-list subscription (match bell pattern).
- Log bell/email failures; tighten email filter.
- Date display: parse `entry_date` as UTC.
- Decide caption: implement input+display or drop column.
- Web analytics parity.
- (Optional/bigger) per-user notification preferences.

### Phase 7 — Weekly export (the broken button, full fix)
- Implement `diary-weekly` in `generate-report` (mirror snag-list/compliance HTML): KPI cards + entries by day + safety/delay sections.
- Re-enable the button. Add formula-injection guard if a CSV variant is added.

### Phase 8 — Tests
- e2e: multi-image upload (web+mobile), notification receipt, mobile create+notify, delete cascade.
- unit: `getWeeklySummary` aggregation (incl. M6), email render with attachments.

---

## Notes
- Each phase has an explicit verify step; failure returns to investigation, not patch-the-patch.
- Diagnostics (failure logging for notify/email) ship in Phase 1, not retrofitted.
- Deploy cost: DB changes (M9, m4, FK) are migrations to the single prod Supabase; edge-fn changes (send-email, generate-report, notify) need function deploys; web/mobile are app deploys.
