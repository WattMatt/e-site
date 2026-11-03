# Tenant schedule read from the project's Dropbox folder (Claude extraction)

**Date:** 2026-10-21  
**Owner decision (2026-10-21):** E-Site extracts from the Dropbox folder itself and becomes the single truth; this is the first module. The findings that led here are in `SPEC DOCS/claude-integration/2026-10-21-dropbox-cross-pollination-findings.md` (outside git).  
**Status:** design, nothing built. Builder-checked before hand-over.  
**Superseded in part (2026-10-27):** the owner reframed the work as a dedicated E-Site MCP server (`2026-10-27-esite-mcp-server-design.md`). Sections 3 steps 1–3, §4 (the in-app extraction and the Anthropic call), §6's Anthropic helper and the "Read from Dropbox" UI are dropped: the Claude session reads the PDF and sends rows. §4's post-processing rules (`toImportResult`, canonical shop-number key, sub-rows, low-confidence rows), §5 (`tenant_schedule_reads`), §7 (safeguards) and §8's deterministic tests stand and are the contract of the `esite_tenant_schedule_preview_import` / `commit_import` tools.

---

## 1. What exists today (evidence)

### The source, as it really arrives

The tenant co-ordinator issues the schedule as a **PDF** into `<project folder>/40. TENANT SCHEDULE/`, roughly every two weeks. Three layouts were read on 2026-10-21:

| Project | Issuer | Layout | Rows | Per-shop fields seen |
|---|---|---|---|---|
| (643) KINGSWALK, Feb 2026 | Orion ("Ti Schedule") | one wide table, rotated headers | 99 | area per lease (TRF), area per leasing plan, shop number, name, TRF received date + O/P flags, spec applicable, spec revision, BO duration days, BBD revision, scope of works issued, drawings received flags, B/O notification days and date, hand-over date, trading date, comments |
| (643) KINGSWALK, Oct 2026 | Orion ("Ti Schedule") | dashboard page + two tables (leasing, design & construction) | 99 | as above plus spec type (TCD white/grey box vs tenant specific), council submission responsibility and status, HVAC responsibility, generator status (own / centre / inverter / N/A), signage status, free-text comments |
| (591) SAXBY, Sep 2026 | Bimbild ("Occupant Status Schedule") | summary pages, outstanding-request lists, then one block per shop | 31 | occupant number, name, co-ordinator, opening date, area, BO period, BO notification days, released-on, plans received, TRS issued, BO given, numbered requests with dates and request count, comments |

Shop numbers appear as `1`, `1A`, `20/21`, `58/59`, `SHOP 02B`; names as `VACANT`, `Vacant (ATM)`, `SHOPRITE (Refigeration)` (a sub-row of shop 18, not a shop). Areas use a decimal comma in the Orion files. Rotated header text extracts as broken strings (`Sh\no\np N\nu\nm\nb\ne\nr`), so nothing may key on header text.

**Conclusion:** the layout differs by co-ordinator and drifts between issues from the same co-ordinator. A column parser would be rewritten per format forever. A model reading the whole document against a fixed target schema is the only approach that survives the next issue.

### E-Site's tenant-schedule import (reused unchanged)

- Parser: `packages/shared/src/structure/tenant-import-parser.ts` → `TenantImportResult { rows: TenantImportRow[]; errors; warnings }` where `TenantImportRow { source_row; shop_number; shop_name; shop_area_m2; shop_category }`. Reads `.xlsx` only.
- Diff: `packages/shared/src/structure/import-preview.ts` `diffTenantSchedule(rows, parseErrors, allNodes, warnings)` → `{ new_entries, updated_entries, conflict_entries, decommissioned_entries, parse_errors, warnings, parsed_row_count }`. Compares `shop_name` and `shop_area_m2` only; a shop with an error carrying its `shop_number` is never decommissioned (PR #135).
- Routes: `apps/web/src/app/api/tenant-schedule/parse` and `/commit`, both multipart (`file`, `projectId`), both gated `requireEffectiveRole(ORG_WRITE_ROLES)`. Commit re-parses on the server and never trusts a client diff. Writes go to `structure.nodes` (create / patch / `status = 'decommissioned'`) and heal `structure.tenant_details`. No product event is emitted.
- UI: `tenant-schedule/_components/ImportFlow.tsx`, stages `idle → parsing → preview → committing → done | error`; preview lists decommissions (red), conflicts (amber), parse errors, new rows, updated rows with `field: from → to`.
- BO date: `projects.projects.opening_date − tenant_details.bo_period_days`, or `bo_date_override` (`bo.service.ts`). Presets 90 / 60 / 45 / 30.

### Claude in the app today (origin/main)

Two call sites, same pattern: `ANTHROPIC_API_KEY` from the server environment, `new Anthropic({ apiKey })` per call, model from an env var defaulting to `claude-opus-5-5`, `stop_reason === 'refusal'` checked, no server-side fallback, every failure returned as one named sentence (`rate-catalogue.actions.ts`, `lib/solar/proposals/narrative.ts`). The page passes an availability object to the client so the button is disabled with a reason when the key is absent. There is no shared helper yet.

### Dropbox on the server

The org's token is decrypted and refreshed in `services/cloud-storage-folder.server.ts` (`listCloudFolder`); `services/handover.server.ts` `loadProjectCloudContext(projectId, supabase)` returns `{ accessToken, providerImpl }` for a project. The provider exposes `downloadFile({ fileId, accessToken }) → { body, contentType, contentLength?, filename }`. **No web helper downloads a file for a project yet.** Projects store `cloud_storage_folder_id` (key on this) and `cloud_storage_folder_path` (display).

### PDF text on the server

`apps/web/src/lib/status-plans/extract-page-text.ts` already extracts a page's text layer with `pdfjs-dist` server-side (used by the line-diagram block detection). `pdfjs-dist` is not in `serverExternalPackages` and works there today.

### Production state (2026-10-21)

462 tenant boards; 7 of 16 projects have a Dropbox folder mapped; `bo_period_days` is typed by hand per tenant; the KINGSWALK schedule in E-Site predates at least eight co-ordinator issues.

---

## 2. Design decision

**Add a second way into the existing import flow.** Beside "Upload .xlsx" the Tenant schedule import offers **"Read from Dropbox"**. E-Site lists the schedule files in the project's `40. TENANT SCHEDULE` folder, downloads the chosen one server-side, has Claude extract every shop into the importer's row shape plus a few per-tenant facts, stores that extraction as a **read** with provenance, and then runs the **same** diff → preview → commit the Excel path uses. The person approves the diff; nothing is written before that.

What is deliberately **not** changed: the diff function, the node write path, the role gate, the BO formula. What is deliberately **not** built: automatic runs on sync, a chat assistant, reading the per-shop folders, any write that the preview did not show.

Goals: a current tenant schedule in E-Site within one click of the co-ordinator's issue, for every co-ordinator's layout, with the source and read time visible on each tenant.  
Non-goals: parsing the dashboard pages, outstanding-request lists, council or signage status (slice 2 lists the facts that get columns).  
Anti-goals: a silent decommission; a value with no source; an extraction that cannot be re-checked because the file moved.

---

## 3. Flow

1. **Entry.** Tenant schedule → Import → two buttons: *Upload .xlsx* (today) and *Read from Dropbox*. The second is disabled with a sentence when the project has no `cloud_storage_folder_id` ("Map this project's Dropbox folder first") or the server has no key ("Reading from Dropbox is not configured on this server").
2. **Pick the file.** `listTenantScheduleSourcesAction(projectId)` lists the project folder's children, finds the one whose name matches `/^\d+\.\s*TENANT SCHEDULE$/i`, and returns its `.pdf` / `.xlsx` files newest first with name, modified date and size. If no such folder exists, the existing `CloudFolderPicker` opens on the project folder. The newest file is preselected.
3. **Read.** `POST /api/tenant-schedule/parse` with `{ projectId, source: { kind: 'dropbox', fileId } }` (the multipart `file` form stays for xlsx). The route:
   - gates exactly as today (`ORG_WRITE_ROLES`, project visible under RLS);
   - downloads the file with the new `downloadProjectCloudFile(projectId, fileId, supabase)` (§6), refusing anything over 20 MB or not PDF / xlsx;
   - xlsx → the existing parser; PDF → `readTenantSchedulePdf` (§4);
   - stores the extraction as a `tenant_schedule_reads` row (§5) and returns `ImportPreview & { read: ReadSummary }` where `ReadSummary = { readId, fileName, fileModifiedAt, issuedOn, format, rowsExtracted, lowConfidence: string[], openingDate: string | null }`.
4. **Preview.** The existing preview, plus: a source line ("2026.10.14 Ti Schedule … read 21 Oct 2026 10:12"); each updated row may now also show `bo_period_days: 60 → 45`; rows Claude marked low confidence are amber and listed; a **decommission guard** (§7); and, when the file's document-level opening or trading date differs from `projects.opening_date`, an **un-ticked** proposal "Set the project opening date to 29 Apr 2027 (currently 15 Apr 2027)". It is un-ticked because that one date moves every computed BO date on the project (KINGSWALK: 108 tenants, 0 overrides).
5. **Commit.** The Dropbox path posts `{ projectId, readId, applyOpeningDate }`; **the xlsx path keeps today's multipart commit and its re-parse on the server, unchanged.** The route discriminates on the body. For `readId` it loads the stored extraction (never the client's diff), re-runs `toImportResult` and the diff against current nodes, and writes through the **same functions** the xlsx path uses (extracted into `lib/tenant-schedule/commit-writes.ts` so both paths share them; the existing commit-route tests are the parity oracle and must pass unchanged after the lift). Additionally it patches `tenant_details.bo_period_days` where the read gave one and it changed, stamps `tenant_details.schedule_read_id` on every node the commit touched, sets `projects.opening_date` if ticked, and marks the read `committed_at / committed_by`. Response is the existing `CommitResult` plus `boPeriodUpdated`.
6. **After.** Each tenant row shows a small chip "schedule 14 Oct 2026" (from `schedule_read_id`), and the import panel shows "Last read: … by …". The read row keeps the extraction JSON, so anyone can see what Claude said versus what was committed.

---

## 4. Extraction (`apps/web/src/lib/tenant-schedule/read-pdf.ts`)

**Input:** the PDF bytes. **Output:** `TenantScheduleRead` (below), already normalised into `TenantImportResult` for the diff.

**Request.** One call to `client.messages.stream(...)` with the PDF as a base64 `document` block, a frozen system prompt (cached with `cache_control`), `model: tenantScheduleReadModel()` (env `TENANT_SCHEDULE_READ_MODEL`, default `claude-opus-5-5`), `output_config: { effort: 'high', format: zodOutputFormat(ExtractionSchema) }`, `max_tokens: 32000`, then `finalMessage()`. Streaming is used because a 100-shop schedule returns about 15–20 k output tokens, which is too long for a non-streaming call; the JSON is validated with the same Zod schema after the stream ends (`parsed_output` is only populated by `messages.parse`, so the builder validates explicitly). ⚠ The builder confirms that `@anthropic-ai/sdk ^0.129` accepts `output_config.format` on `stream()`; if not, fall back to `parse()` and page-range chunking (two calls for files over six pages).

**Why the PDF and not the text layer.** The text layer loses the table geometry (rotated headers, wrapped comments spanning three lines). The model reads the rendered page. The text layer (`extract-page-text.ts`) is still used for two cheap pre-checks: the page count and whether the words "shop", "tenant" or "occupant" appear at all (if not, refuse before spending a call).

**Schema** (Zod, `packages/shared/src/structure/tenant-schedule-read.ts`):

```ts
ExtractionSchema = {
  issued_on: string | null,           // ISO date printed on the document
  issuer: 'orion' | 'bimbild' | 'other',
  project_opening_date: string | null,// "trading date" / "current opening date", ISO
  shops: Array<{
    shop_number: string,              // as printed, e.g. "1A", "20/21", "02B"
    shop_name: string | null,         // as printed; "VACANT" stays "VACANT"
    is_vacant: boolean,
    area_leasing_plan_m2: number | null,
    area_trf_m2: number | null,
    bo_period_days: number | null,    // "BO duration" / "BO period"
    bo_notification_days: number | null,
    offer_status: 'received' | 'outstanding' | 'change' | 'released' | null,
    trf_received_on: string | null,   // ISO
    spec_type: 'tcd_white_box' | 'tcd_grey_box' | 'tenant_specific' | 'other' | null,
    spec_reference: string | null,
    hvac_responsibility: 'landlord' | 'tenant' | null,
    generator_status: 'own' | 'centre' | 'inverter' | 'none' | null,
    is_sub_row: boolean,              // e.g. "(Refrigeration)" lines under an anchor
    confidence: 'high' | 'low',
    note: string | null               // why low, or what was ambiguous
  }>
}
```

**System prompt rules (the whole list, so the builder does not invent them):**
- **One element per shop for the whole document.** When the document holds more than one table (the Orion October layout lists every shop in a leasing table and again in a design-and-construction table), merge the shop's fields across the tables; a field takes its value from whichever table carries it. A shop number that appears twice in the output is a defect, not a representation of two tables.
- A line that qualifies an anchor (refrigeration, mezzanine, outside seating) is `is_sub_row: true` with the anchor's shop number, never a shop of its own.
- `project_opening_date` comes **only** from a document-level field: a header or dashboard value named "trading date", "opening date" or "current opening date". It is `null` when the only dates are per shop. Never derive it from the shop rows.
- Copy the shop number exactly as printed, without the word SHOP. Never merge or split shop numbers.
- Areas: prefer the leasing-plan area for `area_leasing_plan_m2`; the TRF / lease / occupant area for `area_trf_m2`. A decimal comma is a decimal point. A thousands space is dropped.
- Dates become ISO; a two-digit year is 20xx.
- Unknown is `null`; never a guess, never a default. If a column is absent from the document, every value in it is `null`.
- `confidence: 'low'` when a value had to be inferred from a wrapped or broken cell, when two rows share a shop number, or when the shop number itself was unclear.
- Do not summarise, do not skip vacant shops, do not stop early: the count must equal the number of distinct shops in the document.

**Post-processing in code (deterministic, tested). `toImportResult(read, existingTenantNodes)` takes the project's current tenant nodes, because production stores shop numbers three different ways:** KINGSWALK zero-padded (`01`, `01A`), ITONKA / DE POORT / WATERMEYER with the word (`Shop 1`, `Shop 14a`), SAXBY lowercase suffixes (`10a`, `11b`); the PDFs print `1A`, `20/21`, `SHOP 02B`. The diff matches `shop_number` by exact string and the commit never rewrites it, so matching happens here, before the diff, and the diff stays untouched:
- **Canonical key**, applied to both sides: uppercase; drop a leading `SHOP`; remove spaces; `&` → `/`; strip leading zeros from each numeric run (`02B` → `2B`, `01` → `1`); keep `/` between merged shops.
- An extracted shop whose key matches exactly one existing node takes **that node's stored `shop_number`** in the emitted row, so the diff finds it and the stored form is preserved. A key that matches two nodes → `TenantImportError { shop_number }` (ambiguous; neither node is touched or decommissioned).
- A **new** shop (no key match) is stored in the **project's existing convention**, detected from the dominant pattern of the current tenant nodes (padded width, `Shop ` prefix, suffix case); with no tenants yet, the printed form is stored. `deriveDbCode` then runs on that stored form, as it does for xlsx rows.
- drop `is_sub_row` rows into `warnings` ("sub-row of shop 18 ignored");
- `shop_area_m2 = area_leasing_plan_m2 ?? area_trf_m2` (my call, see §9);
- duplicates → `TenantImportError { shop_number }` (so neither copy decommissions anything), as the xlsx parser does;
- a `low` row stays a row (it is diffed and shown) but is **excluded from decommissioning anything** by pushing its shop number into the same errored-shop set the diff already honours;
- `shop_category` is left `null` (the xlsx commit never writes it either).

**Cost and time.** A ten-page schedule is about 20 k input tokens with the document plus 15–20 k output: roughly R8–R10 per read at list price, about 60–120 s. The route exports `maxDuration = 300`.

**Refusals and errors.** `stop_reason === 'refusal'` → "Claude declined to read this file; upload the schedule as .xlsx instead" (no fallback, matching the two existing call sites). Any `APIError` → "The read failed; try again or upload .xlsx". A schema failure or fewer than half the active tenants found → the read is stored with `status = 'failed'` and the preview is not shown; the sentence names the count.

---

## 5. Data model (one migration; number claimed at apply time, head `00249` today)

```sql
CREATE TABLE structure.tenant_schedule_reads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
  organisation_id  uuid NOT NULL,                 -- bound by trigger from the project
  source_kind      text NOT NULL CHECK (source_kind IN ('dropbox','upload')),
  source_file_id   text,                          -- provider file id
  source_path      text,                          -- display path at read time
  source_rev       text,                          -- provider revision
  source_modified_at timestamptz,
  file_name        text NOT NULL,
  file_sha256      text NOT NULL,
  format           text NOT NULL CHECK (format IN ('pdf','xlsx')),
  issuer           text,
  issued_on        date,
  model            text,                          -- null for xlsx
  prompt_version   int,                           -- null for xlsx
  extraction       jsonb NOT NULL,                -- the validated ExtractionSchema (or the xlsx rows)
  rows_extracted   int NOT NULL,
  low_confidence   int NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed','committed','failed')),
  read_by          uuid NOT NULL,
  read_at          timestamptz NOT NULL DEFAULT now(),
  committed_by     uuid,
  committed_at     timestamptz,
  summary          jsonb                          -- CommitResult counts
);
ALTER TABLE structure.tenant_details ADD COLUMN schedule_read_id uuid REFERENCES structure.tenant_schedule_reads(id) ON DELETE SET NULL;
```

- RLS: SELECT for every project role that can read the tenant schedule (same predicate as `tenant_details`); INSERT/UPDATE by the service role only (the routes write with the service key, as the commit does today). **This is a site table: add it to `packages/db/src/site-scope/manifest.ts` and regenerate**, or `assert-site-scope-coverage.sql` goes red.
- `organisation_id` is filled by a BEFORE INSERT trigger from the project, never trusted from the caller (the 00051 lesson).
- `@verify` block: table, both CHECKs, the FK on `tenant_details`, the manifest policy, the trigger.
- The xlsx path also writes a read row (`source_kind = 'upload'`, `extraction` = its parsed rows, `file_sha256` of the upload), **at commit time only**, so provenance is uniform. That is the only behavioural change to the xlsx path; it is additive and happens after the existing writes succeed.

**Cache and idempotence.** A read is keyed by `(project_id, file_sha256, model, prompt_version)`. Re-running the preview on an unchanged file within 24 h returns the stored extraction without a model call. Commit takes `readId`, so preview and commit are guaranteed to use the same extraction. A read older than 24 h, or made under an older prompt version, cannot be committed: the route answers "Read it again".

---

## 6. Server pieces

| Piece | Where | Notes |
|---|---|---|
| `downloadProjectCloudFile(projectId, fileId, supabase)` | `apps/web/src/services/cloud-storage-file.server.ts` | A thin wrapper over the existing `downloadCloudFile({ connectionId, fileId, maxBytes })` in `services/cloud-storage-folder.server.ts` (on `origin/main`), keyed on the project's `cloud_storage_connection_id`; it also checks the file sits under the project's `cloud_storage_folder_id`, caps at 20 MB, and returns `{ bytes, fileName, contentType, rev, modifiedAt }`. (`loadProjectCloudContext` in `handover.server.ts` is handover-scoped and returns null without a handover folder, so it is not the base.) |
| `listTenantScheduleSourcesAction` | `apps/web/src/actions/tenant-schedule-source.actions.ts` | Gate `requireEffectiveRole(ORG_WRITE_ROLES)` (the existing `listCloudFolderAction` only validates a uuid; this one must not inherit that). |
| Anthropic helper | `apps/web/src/lib/ai/anthropic.ts` | First shared module: `anthropicAvailable()`, `anthropicClient()`, `aiStatus()` for pages, the named sentences. The two existing call sites are **not** migrated in this change (own PR later). |
| `readTenantSchedulePdf(bytes)` | `apps/web/src/lib/tenant-schedule/read-pdf.ts` | §4. Prompt text lives in `read-pdf.prompt.ts` with `PROMPT_VERSION`. |
| `toImportResult(read)` | `packages/shared/src/structure/tenant-schedule-read.ts` | Pure; the normalisation rules of §4; unit-tested without the API. |
| `commit-writes.ts` | `apps/web/src/lib/tenant-schedule/` | The create / patch / heal / decommission functions lifted out of `commit/route.ts`, plus `patchBoPeriod` and `stampReadId`. The xlsx route calls the same functions; its behaviour is pinned by the existing route tests before the lift. |
| Parse and commit routes | existing paths | `source` discriminator added; maxDuration 300 on parse. |

Environment: `ANTHROPIC_API_KEY` (already in Vercel for the other two features), optional `TENANT_SCHEDULE_READ_MODEL`. Added to `.env.example`.

---

## 7. Safeguards

- **No write without the preview.** The Dropbox path has no "apply" shortcut.
- **Decommission guard.** If the diff would decommission more than 10 % of the project's active tenants, or more than 5 tenants, the confirm button needs an explicit tick "Yes, mark N tenants decommissioned" (the same two-step confirm pattern as the scope-items modal). A misread file cannot empty a schedule in one click.
- **Low-confidence rows never decommission.** §4.
- **Sub-rows never create shops.** §4.
- **The read is bound to one file revision.** Commit refuses when the Dropbox `rev` has changed since the read.
- **Role gate is the existing one** on both routes and on the source-listing action.
- **Secrets.** The file goes from Dropbox to the server to Anthropic; it never touches the browser. Nothing from the extraction is logged except counts; Sentry gets the error class only.
- **Public repo.** Test fixtures are synthetic schedules with invented shops and names; no real co-ordinator file is committed.

---

## 8. Testing

Deterministic (no API):
- `toImportResult`: comma decimals, `20/21`, vacant rows, sub-rows dropped with warnings, duplicates → error with `shop_number`, low rows excluded from decommission set; **canonical-key matching against each production convention** (`01`/`01A`, `Shop 1`/`Shop 14a`, `10a`) so that a KINGSWALK read of 99 printed shops yields ~99 matches and not 99 new + 99 decommissioned; ambiguous key → error; a new shop stored in the project's convention; the merge of a shop across two tables yields one element.
- Diff integration: a stored extraction + a node list → the same `ImportPreview` shape the xlsx path produces; the decommission guard thresholds at 10 % and at 5.
- Commit parity: the lifted write functions, called by the xlsx route, produce request-for-request the same PostgREST calls as before (the existing route tests are the oracle; they run unchanged before and after the lift).
- Read cache: same sha + model + prompt version → no second call (the client is a fake); changed `PROMPT_VERSION` → a new call.
- Route gates: a contractor gets 403 on parse with `source.kind = 'dropbox'`; a file over 20 MB → 413; a non-PDF → 415; a stale `rev` on commit → 409.
- Availability: no key → the page passes `{ available: false, reason }` and the button renders disabled.
- `product_events`: `tenant_schedule_read` emitted on commit (CHECK widened in the same migration).

Env-gated (runs only with `ANTHROPIC_API_KEY`, like the RfD digest tests):
- Three synthetic PDFs built in the test from text with `pdf-lib`, one per layout family (wide table with rotated headers, two-table dashboard, block-per-shop). Assert row count, every shop number, and that `null` is returned for a column the fixture omits. These pin the prompt; a prompt change must keep them green.

Not testable without a person: the signed-in walk on production against a real issue. Owner: open KINGSWALK → Tenant schedule → Read from Dropbox → newest file → check the diff against the co-ordinator's PDF → commit.

---

## 9. Calls I made (overridable)

1. **`shop_area_m2` takes the leasing-plan area**, with the TRF area kept in the extraction and shown in the preview when they differ. Reason: `shop_area_m2` is compared against measured plan areas with a 2 % flag, which is a leasing-plan comparison.
2. **`bo_period_days` is written, `bo_date_override` is not.** The co-ordinator's BO date follows from their own opening date; E-Site's follows from `projects.opening_date`. Writing the period keeps one formula.
3. **The project opening date is an un-ticked proposal, never an automatic write,** and it is read only from a document-level field, never inferred from shop rows.
3a. **Shop numbers are matched on a canonical key of both sides and each project keeps its stored convention**; new shops follow that convention. Normalising all projects to one convention is a separate decision for the owner, not taken here.
3b. **The xlsx commit is untouched** (multipart, re-parse on commit); only the Dropbox path commits by `readId`.
4. **The model is `claude-opus-5-5` at effort `high`**; a cheaper model is a measured change, not a default.
5. **Vacant rows keep `shop_name = 'VACANT'`** exactly as the xlsx import stores them today.
6. **The xlsx path gains a read row** for uniform provenance, and nothing else changes for it.
7. **Slice 2 facts** (offer status, TRF date, TRF area, spec type and reference, HVAC responsibility, generator status, council submission responsibility, trading date) get columns on `structure.tenant_details` with the read id as their source, in a follow-on migration after this lands. The extraction already carries them, so no second read is needed.

---

## 10. Delivery slices (each its own PR, merged in order)

1. **Server:** migration + manifest + `@verify`; `downloadProjectCloudFile`; `lib/ai/anthropic.ts`; `read-pdf.ts` + prompt; `toImportResult`; the write-function lift with parity tests; parse/commit `source` discriminator; read cache; product event.
2. **UI:** the second button, source picker, preview additions, decommission guard, chips and "last read" line.
3. **Follow-on (not in this design's gate):** slice-2 columns; migrate the two existing Claude call sites onto the shared helper; the equipment-orders reader (the contractor's DB drawing schedule).

Deploy order: migration → manifest check green → functions (none change) → Vercel. Ledger and `origin/main` and open-PR filenames re-checked at apply time.

---

## 11. Out of scope

Automatic reads on the 15-minute sync; reading per-shop folders; the dashboard and outstanding-request pages of the PDFs; any write to scope items or layout status (those are trigger-derived from documents today); a chat surface.
