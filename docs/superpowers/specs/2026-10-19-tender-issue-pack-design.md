# Tender issue pack — specs, drawings, P&G and conditions reach the bidder (2026-10-19)

**Owner ask:** "We need to send out our first tender BOQ and link with applicable specification
files and P&G documentation … where are our gaps, list these and close them."

**Gap analysis (verified against code and the live DB, 2026-10-19):** WM cannot issue a single
document with a tender. The `tender-files` bucket holds only the imported BOQ workbook and WM's
estimate (`tender.actions.ts` allows exactly `source|estimate|list`, all `.xlsx`); there is no
documents table, no portal card, no download, and the design spec (ADR-012, slices A–D) never
scoped it. `projects.tenders` carries no particulars (no reference, description, site inspection,
queries deadline, validity, contact). Addenda are text-only. Publishing an addendum silently
returns every submitted bid to draft with **no email** to the bidder. WM cannot open bidders'
uploaded documents after the seal lifts (names only), cannot extend the closing time and cannot
cancel (the DB allows both; no action exists). No submission receipt, no question-received email.

## What this feature adds

### 1. `projects.tender_documents` (migration `00252`)
- One row per issued file: `tender_id`, optional `clarification_id` (an addendum's attachment),
  `category` (`specification | drawing | pg | conditions | returnable | addendum | other`),
  `label`, `file_name`, `file_path` (in `tender-files`, under the tender's prefix), `file_size`
  (≤ 50 MB), `content_type`, `sort_order`, `uploaded_by` (stamped), `created_at`.
- **State rules (guard trigger `tender_documents_guard`):**
  - a pack document (`clarification_id IS NULL`) may be added, edited (label/category/sort only)
    or removed **only while the tender is a draft** — bidders price exactly what was issued;
  - after issue, a new or revised document can only ride an **addendum**: `clarification_id` must
    point at an **unpublished** addendum of the same tender; once that addendum publishes, its
    documents are as final as its text (the existing machinery already returns submitted bids to
    draft and refuses re-submission until the bidder acknowledges);
  - file columns are immutable; a document never moves between tenders or clarifications;
  - deleting the tender cascades (same parent-gone rule as `tender_children_locked`).
- **Who sees what:** WM reads/writes via `user_can_manage_tender` policies. Bidders never touch
  the table; they read through `tender_portal_documents(p_tender_id)` (SECURITY DEFINER, gated by
  `tender_participant_can_read`), which lists pack documents plus published-addendum documents.
  Downloads are signed URLs minted by a server action after the portal function confirms
  visibility; each bidder download is recorded via `tender_log_document_download` into
  `tender_document_downloads` (`document_id × participant_id`, count + first/last timestamps) —
  WM gets per-bidder proof of what each tenderer received. `site_scope` on both tables.

### 2. Tender particulars (columns on `projects.tenders`)
`reference` (WM's tender number), `description` (scope of work), `site_inspection` (wording incl.
date/venue/compulsory), `queries_close_at` (displayed deadline; questions after it are still
accepted — answering is WM's discretion), `validity_days` (1–365), `contact_name`,
`contact_email`. Editable while draft (`updateTenderDetailsAction`); **frozen at issue** by
extending `tenders_status_guard` (changes after issue are communicated by addendum). Shown on the
portal header, the invite page and in the invitation email; `tender_portal_summary` is dropped
and recreated with the new columns.

### 3. Run-the-tender controls
- **Extend closing** (`extendClosingAction`): the DB already allows it (issued, only later, and
  never after close with a submitted bid); now there is a button. Extending emails the bidders.
- **Cancel** (`cancelTenderAction`): any pre-adjudicated state → `cancelled`, two-press confirm,
  emails the bidders.
- **WM downloads of bidder documents once the seal lifts** (`getBidderDocumentUrlAction`): the
  session client reads the `tender_submission_documents` row (RLS admits WM only via
  `user_can_open_tender` + `tender_seal_lifted` + submitted) and only then service-signs the URL.
  Wired into the adjudication checklist.

### 4. Emails (all deep-link to the portal; the transport cannot and should not carry files)
| Email | To | When |
|---|---|---|
| Addendum published | every participant + un-accepted invitees (deduped) | on publish — without it a returned-to-draft bid silently misses the close |
| Answer published | same audience | on publishing a Q&A answer |
| Question received | the tender's `contact_email` (fallback: creator) | when a bidder asks |
| Submission receipt | the bidder | on submit (ref, time, total excl. VAT) |
| Closing extended / tender cancelled | every participant + invitees | on the action |

All tender mail stays behind `TENDER_INVITES_ENABLED` (one kill switch). The invitation email
gains the tender reference and a "the tender documents are on the portal" line with the count.

### 5. UI
- **Admin:** `DocumentsPanel` (upload via server-minted signed upload URL — no 4.5 MB cap; list,
  label/category, remove; read-only once issued with "add via addendum" hint), `DetailsPanel`
  (particulars, draft-only), addendum composer gains attachments (draft addendum → attach →
  publish), `IssuePanel` warns when a tender has no documents, `SubmissionsPanel` shows
  "documents downloaded n/m" per bidder, adjudication page links each bidder document.
  (All panels self-read — `router.refresh()` never commits on this page, see 2026-10-09.)
- **Portal:** a **Tender documents** card (grouped by category, sizes, download), particulars in
  the header, addendum entries show their attachments.

## Not in scope
Attachment files on emails (links only); evaluation-criteria/award-letter fields; a public
tender-notice page. The conditions-of-tender wording itself is owner content — the `conditions`
category and `description` field carry whatever WM supplies.

## Verification
- Dry-run against the prod schema + `emit-verify-sweep` (policy-adding migration);
- `scripts/db/assert-tender-documents.sql` (impersonation: WM manages, a foreign project admin is
  refused, a bidder cannot read the table directly, the portal fn hides unpublished-addendum
  docs, a rival participant cannot log downloads, draft-only pack rule, published docs frozen,
  particulars frozen after issue) — red first, then green;
- all three suites (web, shared, db); the full local E2E walk on the e5 stack (Mailpit for every
  new email); production verification with throwaway accounts and zero residue.
