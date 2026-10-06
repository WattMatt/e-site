# Tariff source verification — every published value proven against its source

**Date:** 2026-10-06 · **Project 1 of 4** toward a world-class tariff library (owner, 2026-10-06)
**Owner rules this design serves (2026-10-06):**
- R1. Every number shown must align 100 % with the NERSA-approved source documents. No assumptions, no made-up or unverified values.
- R2. Strict replica: only values printed in the source appear. No sums, ratios, percentages, estimates or example bills.
- R3. A charge whose source prints no unit shows "Unit not stated in the source".
- R4. Eskom's time-of-use periods apply to municipal TOU tariffs, cited to Eskom's schedule.
- R5. **Until a published value has been verified against its source — or if it fails — it is hidden. A tariff with any value not verified is withdrawn from view until fixed.**

Projects 2 (data correction), 3 (strict-replica pages) and 4 (coverage) follow; this project is their foundation.

## 1. Why a new check is needed

| Fact (live, 2026-10-06) | Consequence |
|---|---|
| 3,493 published charges: 2,899 from workbooks (cell cited), 594 from NERSA decision PDFs (page + text line cited). Every one carries `file_sha256`. | Every value can be traced to an exact place in an exact file. |
| `source_locator.raw_text` is written by the parser as `"<label> = <value>"`, e.g. `Energy Charge (c/kWh) = 342.57 (recommended)`. | Comparing a value with `raw_text` proves only that the parser agrees with itself. **The check must re-read the original file.** |
| 25 published tariffs across 13 licensees have names that are document text (`CONCLUSION………… 27`). #255 found ten 2026/27 RfD years misread and added the correction path (`00241`). | A reader that shares the parser's code would repeat its mistakes. **The verifier shares no parsing code with ingest.** |
| Hand-checked so far: 20 of 3,493 values (`docs/tariffs/explorer-verification-2026-10.md`). | Accuracy is sampled, not proven. |

## 2. Where the correct values come from

| Supplier | Authoritative source | Held as |
|---|---|---|
| Eskom | Schedule of standard prices for the year (PDF) and Eskom's xlsm tables of the same figures; NERSA's decision on Eskom's increase | `tariffs.source_document`, file in `tariff-sources` named by sha256 |
| Municipalities and metros | NERSA Reasons for Decision (RfD), one PDF per licensee per year; the approved column is the legal tariff | same |
| 2025/26 municipal years | NERSA approved-tariff workbooks per province | same |
| Corrections | A NERSA corrigendum or revised decision, or written clarification from the licensee | a new `source_document` with a later date; the year is corrected through `00241` (`replaces_year_id`) |

A value is never typed from memory. A corrected value counts only when the verifier reads it from the cited file.

## 3. What is verified

| Subject | Check | Passes when |
|---|---|---|
| Charge from a workbook | open the file by sha256; read the cited sheet + cell with the workbook's computed value | the cell is a number equal to `amount_excl_vat` at the cell's displayed decimals, or text whose number token equals it (e.g. `R302.84/kVA`); where the locator carries `raw_incl`, the source's VAT-inclusive cell equals it too |
| Charge from a PDF | an **independent** reader (pdf.js text items with x/y positions) reads the cited page | the label text is on the page; the value, written the way the source writes it (decimal comma or point, printed decimals), is on the same row as the label; and that token's x-position falls under the column header the decision approves ("Recommended", "Approved …", "2026/27 Recommended Tariff") |
| Tariff identity | same readers | the tariff's name (and code, for Eskom) appears in the cited sheet or on the cited page, not only in a contents list |
| Unit | same readers | the printed unit token matches the stored unit, or no unit is printed and the charge is `unit_inferred` (shown per R3) |
| Eskom TOU windows | the stored schedule PDF, p56 Figure 2, re-rendered by the verifier (`pdftoppm`, 300 dpi) | sampling each hour's segment colour on the wheel gives the stored period for every hour of every season × day type; any hour whose colour is not clearly one period's → `unresolved` (two-person confirmation against the page image) |
| Eskom holiday rows | the stored schedule PDF, p12 | each date, name and "Saturday/Sunday" treatment is printed in the table |

A check that cannot settle a value (image-only page, two candidate columns) records **`unresolved`**, never a pass.

## 4. Data model (one migration, number claimed at apply time)

`tariffs.source_verification`

| Column | Meaning |
|---|---|
| `id` | uuid |
| `subject_kind` | `charge` · `tariff` · `tou_window` · `holiday_treatment` |
| `subject_id` | the row checked (charge id, tariff id, window id; holiday rows by `calendar_id|family|date` key) |
| `source_document_id`, `source_sha256` | the exact file read |
| `outcome` | `match` · `mismatch` · `not_found` · `unresolved` |
| `evidence` | JSON: what was read (cell value and format; or page, row text, token, x-range, column header found) |
| `subject_fingerprint` | hash of the checked row's value fields at check time; a later edit makes the result stale |
| `checker_version` | verifier release |
| `checked_at` | stamped by the database |
| `confirmed_by`, `second_confirmed_by` | only for `unresolved` → manual confirmation on image pages: two different people |

- Write: service role only (the verifier). Read: same as the subject (00228 helper).
- `tariffs.subject_verified(kind, id)`: true only when the latest row is `match` (or two-person confirmed) **and** its fingerprint equals the subject's current values.
- **Publish gate:** the year guard refuses `in_review → published` unless every charge, tariff and (for Eskom) calendar row in the year is verified.
- **Read gate (R5):** the explorer's reads go through a view `tariffs.verified_charge` / `verified_tariff`; a tariff is listed only when it and all its charges are verified. Solar keeps reading the base tables (out of scope; recorded as an owner decision to take).

## 5. The verifier

- `packages/shared/src/tariffs/verify/` — pure readers, **no import from `tariffs/parsers`** (a contract test enforces it): `workbook-cell.ts`, `pdf-positions.ts`, `number-format.ts` (source-form rendering of a value), `column-header.ts`.
- `scripts/tariffs/verify.ts` — downloads each source file by sha256 (re-hashes it), runs the readers, writes `source_verification` rows through the service key. Modes: `--year <id>`, `--all-published`, `--stale`.
- Runs: once over all published years; automatically after every ingest; weekly (scheduled workflow); on demand from `/admin/tariffs/years/[id]`.
- Admin surfaces: the year page lists every non-`match` with the evidence beside our value; `/admin/tariffs/cycle` counts verified / mismatched / unresolved per regime.

## 6. Rollout

1. Ship the table, readers and script; run `--all-published` and read the result **before** any read gate turns on.
2. Fix what fails through project 2 (correction drafts via `00241`).
3. Turn on the read gate (R5) and the publish gate. From then on nothing unverified is shown or published.

Turning the read gate on before step 1 completes would blank the explorer; the order is part of the design.

## 7. Testing — checks that can fail

- Every reader is tested on **real excerpts** (stored workbook cells, real PDF pages) and on deliberately broken ones: value off by 0.01; value taken from the Approved instead of the Recommended column; decimal comma vs point; a tariff name that occurs only in the contents list (the `CONCLUSION………… 27` case); an image-only page → `unresolved`.
- Mutation proof before merge: corrupt one stored value in a rolled-back transaction and watch exactly that charge turn `mismatch`; swap two columns in a fixture and watch the column check fail.
- The independence contract test fails if `verify/` imports parser code.
- SQL assertions (impersonated roles): a client cannot write `source_verification`; the publish gate refuses a year with one unverified charge; the read views hide a tariff with one failing charge.

## 8. Out of scope here

Project 2 (fixing what fails, the 25 mis-named tariffs), project 3 (page redesign; it will read the verified views and show "Matches source · <date>"), project 4 (coverage), Solar's use of unverified values (owner decision), advertising wording (owner/legal).
