# Tender BOQ portal — design (E5)

**Date:** 2026-10-05 · **Prompt:** Dev Prompts 2026-10-05 / E5 · **Plan file:** vault `Projects/E-Site/sessions/E5-2026-10-05-plan.html`

## Intent
Run WM's tender process in E-Site. WM imports its tender BOQ workbook, invites contractors, contractors price a BOQ that cannot be submitted non-compliant, and WM adjudicates after closing. Four slices, one PR each: **A** model + import, **B** invite + onboard, **C** price + comply + submit (sealed until closing), **D** adjudicate.

## Slice A — model + import (this PR)

**Tables (schema `projects`, no new schema, so no PostgREST `db_schema` change):**
- `tenders`: project, organisation (bound to the project's org by trigger), package, title, revision label, closing time, status `draft|issued|closed|adjudicated|cancelled`, source workbook path, the workbook's stated totals, and the stored reconciliation report.
- `tender_boq_items`: one row per meaningful sheet row, in sheet order. Holds sheet name, row number, kind `heading|item|note|total`, bill code, item code, heading path, and the locked description, unit and quantity. Item rows carry `rate_cell_type` (`priced|fixed|rate_only|not_priced`), the fixed amount for `fixed` rows, the stated total for `total` rows, and the column letters of the rate and amount cells.
- `tender_estimate_lines`: WM's internal estimate per item (rate, amount), imported from the PRE-PRICED INTERNAL workbook.
- `tender_requirements`: documents and declarations a tenderer must supply (label, kind, mandatory). Slice C enforces them.

**Access:** every tender table is readable and writable by owner, admin and project manager of the project only (`user_effective_project_role`), split per verb. Slice B adds tenderer read paths; nothing in slice A is readable by a contractor, inspector, supplier or client viewer. Workbooks live in a private `tender-files` bucket written only by the server; the browser uploads through a server-minted signed upload URL (no 4.5 MB body cap).

**Import (`apps/web/src/lib/tender/`, pure, no I/O):**
1. `parseTenderWorkbook(buffer)`: per sheet, find the header row (a cell reading DESCRIPTION), map ITEM, DESCRIPTION, UNIT, QTY, RATE, AMOUNT/TOTAL (and SUPPLY/INSTALL), then classify each row. A row whose code has child codes below it is a heading unless it carries an amount. Total rows are recognised by TOTAL/CARRIED FORWARD text. Summary sheets (name contains SUMMARY) yield the stated bill totals, subtotal, VAT and grand total.
2. Rate-cell type guess: PS/PC/provisional/contingency → `fixed`; quantity RATE ONLY → `rate_only`; otherwise `priced`. WM can override per item while the tender is a draft.
3. `reconcileTender(parsed)`: for each sheet, sum item amounts and compare with the sheet's stated total; compare each summary line with its sheet; compare the grand total. **Pass means equal to the cent** after rounding the raw sums once. Lines where qty × rate differs from the amount by more than half a cent are listed separately.
4. `diffTenderBoqs(a, b)`: matches items by sheet + item code (falls back to description), and reports added, removed, and changed description/unit/qty rows. Used for tender vs PRE-PRICED INTERNAL (must be structurally identical) and for revision-to-revision diffs (R8 → R9).

**UI:** project sidebar gains **Tenders** (owner/admin/PM). List → New tender (package, title, revision, closing time, upload workbook, optional internal estimate) → review page with reconciliation report, structural diff, and the item grid with a cell-type selector.

## Slice B — invite + onboard (migration `00230`)

- **Tables:** `tender_invitations` (company, contact, lower-cased email, phone, status prepared|sent|accepted|declined|revoked, SHA-256 of the link token, expiry) and `tender_participants` (one per accepted invitation: the auth user and the company profile: CIPC number, VAT, CIDB grade, B-BBEE level, contact, phone).
- **Status machine** lives in `00226` (`tenders_status_guard`); slice B adds `issueTenderAction` (draft → issued with a future closing time; the database refuses it without an imported BOQ and an amount on every fixed sum).
- **Tenderer reads:** no row policy on any `00226` table. `projects.tender_portal_summary / _items / _requirements / _my_tenders` are SECURITY DEFINER functions returning only the columns a bidder may see, for a tender they accepted, once it is issued. A row policy on `projects.tenders` would expose every column, including the reconciliation jsonb with WM's estimate totals.
- **Accepting:** the link carries 32 random bytes; only the hash is stored and looked up. The link never creates a session: opening it only offers to email a sign-in link to the invited address. Signed in as that address, the bidder accepts through `projects.tender_accept` (one transaction: lock, re-check address, status, expiry and that the tender is open; refuse anyone who manages the tender; insert the participant; close the invitation). An invitation's address and company cannot change after creation.
- **Email-proved sessions:** production runs with `mailer_autoconfirm` on, so a password account for any address is confirmed without mailbox proof. Every bidder action (accept, portal reads, own participant row, and slice C's submissions) requires a session established by an emailed link or code (`amr` otp/magiclink/recovery/invite) via `projects.session_proves_email()`.
- **Middleware:** `/tender/invite/` and `/tender/login` are public; the rest of `/tender` needs a session, sends signed-out visitors to `/tender/login`, and is exempt from the no-organisation → `/onboarding` redirect.
- **Tender list:** `parseTenderList` reads `SUB-CONTRACTORS TENDER LIST.xlsx` (trade sheets with continuation-row contacts, the per-project TENDER LIST sheet), extracting and validating addresses and reporting unusable rows. The upload is deleted after reading.
- **Owner-only:** `sendTenderInvitationsAction` refuses unless `TENDER_INVITES_ENABLED=true` (shipped unset). Prepared links can be copied once for an internal test; nothing is emailed.

## Slices C–D (outline; each gets its own spec section before code)
- **C:** `tender_submissions` + `tender_submission_lines`; web grid and Excel round-trip that refuses a workbook whose locked cells changed; server recomputes arithmetic; compliance engine blocks submit; clarifications/addenda with acknowledgement. **Sealed bid:** submission prices are unreadable by any WM role until `closing_at` passes, enforced in RLS and proven by assertions that fail without it.
- **D:** after closing, comparison grid per item and section against the internal estimate, outlier flags, arithmetic-error report, document checklist per bidder, export in WM's adjudication workbook shape.

## Testing
Fixtures are generated in-test with ExcelJS and reproduce two real layouts: the MVL "Summary + Bill No N" workbook (read from the mailbox, 2026-09-29) and WM's lettered-code layout. Every guard is shown failing first. SQL assertions run through `scripts/db/dry-run-migration.sh` against production in rolled-back transactions.

## Known limitation at time of writing
The Sunbird R1–R9, PRE-PRICED INTERNAL and CHECK REGISTER files are Dropbox online-only placeholders and could not be read. The R9 reconciliation is one command once the folder is made available offline.
