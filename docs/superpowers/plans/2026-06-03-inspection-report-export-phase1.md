# Inspection Report Export (#3) — Phase 1 Implementation Plan

> **For agentic workers:** Execute with **superpowers:subagent-driven-development**. Steps use `- [ ]` tracking. This plan is design-level (file structure + interfaces + the locked composition + test expectations); implementer subagents write the react-pdf/TS code by following the cited existing patterns. Spec: [`../specs/2026-06-03-inspection-report-export-design.md`](../specs/2026-06-03-inspection-report-export-design.md). Foundation it builds on: [`./2026-06-03-report-export-branding-visible-slice.md`](./2026-06-03-report-export-branding-visible-slice.md) (merged PR #38).

**Goal:** The **"Inspection & Test Report" kind** rendered through the existing react-pdf engine — interior primitives + a pure data-gatherer + an `InspectionReportDocument` — reaching **content parity** with the current `pdf-lib` certificate (the `render-inspection-pdf` Deno edge function), validated on **real rendered PDFs**. A thin Node-runtime route returns the Buffer for side-by-side review. **Not** persisted, **not** certified.

**Architecture:** Reuse the merged engine in `apps/web/src/lib/reports/` verbatim — `theme.ts` (accent + spacing tokens), `branding.ts` (`resolveBranding`, pure), `components.tsx` (`Cover` / `Watermark` / `PreviewBody`), `render.ts` (`renderToBuffer`). Phase 1 *adds* the interior primitives the spec §4 names (`RunningHeader`, `RunningFooter`, `Section`, `ResultRow`/`Table`, `PhotoGrid`, `SignatureBlock`, `AnnexureList`), one app-layer **pure** data-gatherer, the document, and the route. The engine stays pure/deterministic: all logos + photos are fetched to `data:` URIs in the app layer before they reach react-pdf (the repo lesson — react-pdf `<Image>` fetches URLs server-side with no timeout and fails silently).

**Tech stack:** `@react-pdf/renderer` server-side (`renderToBuffer`, already installed); a Next.js **Node-runtime** route handler (`export const runtime = 'nodejs'`) mirroring `app/api/projects/[id]/branding-preview/route.ts`; `requireEffectiveRole` from `@/lib/auth/require-role`; `createClient` + `createServiceClient` from `@/lib/supabase/server`; vitest (`apps/web/vitest.config.ts`) with the `vi.hoisted(() => ({...}))` mock pattern and the `// @vitest-environment node` pragma for any file that calls `renderToBuffer`.

---

## Critical data-model facts (implementers: internalise before coding)

These were verified against migration `00066_inspections_module.sql` and the live web read paths. They drive the data-gatherer and the §6 field-type mapping.

1. **`inspections.photos` stores BOTH photos and file-uploads.** The table has columns `id, inspection_id, section_id, field_id, storage_path, caption, gps_lat, gps_lng, taken_at, width_px, height_px, uploaded_by, created_at` — **no bucket column, no MIME column**. True camera photos live in the `inspection-photos` bucket; `file`-field uploads live in the `inspection-attachments` bucket (written by `app/api/inspections/upload-file/route.ts`, which inserts a `photos` row with `caption = filename`). **The only way to tell a photo row from a file row is to look up its `(section_id, field_id)` in the template and read that field's `type`** (`photo` → image, `file` → annexure). The current cert renderer does NOT make this distinction — it signs every `photos` row from `inspection-photos` and embeds it as an image (`payload-loader.ts` + `render.ts`). Phase 1 routes by field type per §6, signing the correct bucket per row.
   - `inspection-photos` rows: prefer `original_path` then `storage_path` for signing — but note the live page read (`page.tsx`) selects only `section_id, field_id`. The gatherer must select the full row set it needs. `original_path` exists on the table only from migration `00071`; older rows may have it null, so fall back to `storage_path` (mirror `payload-loader.ts` lines 104–112).
2. **`public.profiles` RLS only returns the viewer's own row to the cookie client (00009).** Any name we display for *another* user (inspector, verifier, contributor, photo-capturer) MUST be resolved via `createServiceClient()` **after** an access gate. This is the recurring repo lesson — see `inspections.actions.ts` `listProjectMembersAction` (lines 205–215) and `page.tsx` (lines 82–88) for the exact pattern.
3. **`inspections.signatures` is keyed by `role`, not `(section_id, field_id)`.** Columns used by the cert: `id, role, signatory_name, signatory_title, registration_number, storage_path, signed_at` (bucket `inspection-signatures`). The template's `signature`-type fields are NOT joined to signature rows; the Signatures section renders the signature *rows*, not per-field. (Confirmed by `page.tsx` lines 47–51 and `payload-loader.ts` lines 135–150.)
4. **`response_history`** rows carry `responded_by` (uuid), `section_id`, `field_id`, `responded_at` — the Audit appendix source (`payload-loader.ts` lines 90–96, `render.ts` `drawAppendixB`).
5. **The issuer org for an inspection is `inspections.inspections.organisation_id`.** There is **no contractor sub-org resolution wired for inspections today** (grep confirms none). ④ contractor is therefore **null in Phase 1** — the parties strip simply drops that slot, exactly as the branding-preview route already does (`route.ts` line 116). Flagged in §"Spec gaps" — do not invent a contractor lookup.
6. **Template shape:** `Template` / `Section` / `Field` / `Response` types live in `@esite/shared` (`packages/shared/src/inspections/types.ts`); the runtime schema is `template-schema.ts`. `schema_json` is the parsed `Template`. Sections have `fields[]` and optional `subsections[]` (each with its own `fields[]`). `repeating_group` fields store entries as sibling responses with synthetic `field_id` = `` `${group}[${i}].${sub}` `` (single level only). The cert's `collectGroupEntryIndices` (render.ts lines 513–527) is the canonical index-discovery helper — port its regex.

---

## Existing patterns to follow (implementers: read these first)

- **The engine you are extending:** `apps/web/src/lib/reports/{theme.ts, branding.ts, components.tsx, branding-preview.tsx, render.ts}` + tests `branding.test.ts`, `render.test.ts`. `components.tsx` already exports `Document`, `Page`, and `pageStyles` (re-exported `s`). Reuse `spacing` from `theme.ts` and add new tokens there rather than inventing local constants.
- **The parity target (read end-to-end):** `apps/edge-functions/supabase/functions/render-inspection-pdf/render.ts` (cover rows, ToC, per-section field rendering, 3-up photos with EXIF caption band, summary + failed-field list, signatures, Appendix A placeholder, Appendix B audit) and `index.ts` (composition order) and `payload-loader.ts` (exactly which rows + signed URLs the cert reads). **Content parity is judged against this.**
- **App-layer data fetch + service-client name resolution:** `apps/web/src/actions/inspections.actions.ts` (`listProjectMembersAction` lines 163–236, `listInspectionsAction` lines 357–433) and the fill page `apps/web/src/app/(admin)/projects/[id]/inspections/[inspectionId]/page.tsx`.
- **Node-runtime render route + logo→`data:` URI:** `apps/web/src/app/api/projects/[id]/branding-preview/route.ts` (the `logoToDataUri` helper lines 21–38; the `requireEffectiveRole` gate; `Content-Type: application/pdf` + `inline` response). Copy this structure.
- **Role gating:** `requireEffectiveRole(supabase, projectId, roles)` from `@/lib/auth/require-role`; role-group constants from `@esite/shared` (`ORG_WRITE_ROLES`, `COST_VIEW_ROLES`, both `['owner','admin','project_manager']`). The inspection fill page is gated by **RLS** (any role that can read the inspection row), so the report's view gate is the full project-roles set (mirror `branding-preview/route.ts` `ALL_PROJECT_ROLES`).
- **Web tests:** `apps/web/vitest.config.ts`; the `vi.hoisted(() => ({...}))` mock pattern (`apps/web/src/actions/inspections.actions.test.ts` lines 1–50, incl. the `qb()` chainable-awaitable stub); the `// @vitest-environment node` pragma + `data:` URI image trick (`render.test.ts` lines 1–13).

---

## File structure (each file → one responsibility)

All new files live under `apps/web/src/lib/reports/` except the route.

| File | Responsibility |
|---|---|
| `theme.ts` *(edit)* | Add interior-layout spacing/size tokens (header/footer heights, row metrics, pill, photo-grid, table) to the existing `spacing` object. No behaviour change. |
| `interior.tsx` *(new)* | The shared interior primitives as pure react-pdf components: `RunningHeader`, `RunningFooter`, `Section`, `ResultRow`, `Table`, `ResultPill`, `PhotoGrid`, `SignatureBlock`, `AnnexureList`. Accent-driven from the passed `accent` prop. Reusable by #5 snag later. |
| `interior.test.tsx` *(new)* | React-pdf **element-tree** snapshot tests for each primitive (no `renderToBuffer`; assert the React tree via `react-test-renderer` or a shallow structural check — see Task 2 note). jsdom env. |
| `inspection-report-data.ts` *(new)* | The `InspectionReportData` interface + `gatherInspectionReportData(inspectionId)` — the **pure-once-fetched** app-layer gatherer. RBAC gate, service-client name resolution, photo/file routing by template field type, logos + images downloaded to `data:` URIs, annexure + handover link lists. Returns a plain serializable object (no react-pdf, no Supabase types leaking). |
| `inspection-report-data.test.ts` *(new)* | Unit tests over a **mocked** supabase client (`vi.hoisted` + `qb()` stub): each field type → correct row shape; photo vs file routing; names via service client; missing logos/photos degrade gracefully; RBAC rejection. jsdom env. |
| `inspection-report.tsx` *(new)* | `InspectionReportDocument({ data, branding })` — composes `Cover` (reused) → `Summary` → per-section `Section`+rows+`PhotoGrid` → `Annexures` → `Signatures` → `Audit`, with `RunningHeader`/`RunningFooter` `fixed`. The `Summary` sub-component lives here (report-specific, not a shared primitive). |
| `render-inspection.ts` *(new)* | `renderInspectionReport(data, branding): Promise<Buffer>` — `renderToBuffer(<InspectionReportDocument .../>)`. Mirrors `render.ts`. |
| `render-inspection.test.ts` *(new)* | `// @vitest-environment node`. First-bytes `%PDF-`; renders with photos/file-annexures/signatures/audit present AND absent (no throw); exercises every §6 field type via a fixture template+data. |
| `app/api/projects/[id]/inspections/[inspectionId]/report-preview/route.ts` *(new)* | Node-runtime GET. Gate → `gatherInspectionReportData` → `resolveBranding` → `renderInspectionReport` → inline PDF. The Phase-1 parity-review surface. |

**No registry file is created in Phase 1.** Spec §5.3 defers the `exportReportAction('inspection', id)` registry to Phase 2; Phase 1 wires the kind through the thin route only. (Flagged — do not build a registry abstraction now; YAGNI per the foundation.)

---

## The `InspectionReportData` interface (define once; later tasks reference it)

Put this at the top of `inspection-report-data.ts`. It is plain/serializable — no react-pdf, no Supabase. It is the seam the document renders from and the gatherer's unit tests assert against.

```ts
/** A single rendered field row inside a section (already mapped from a Response). */
export interface ReportFieldRow {
  fieldId: string
  label: string
  /** Drives which interior primitive renders this row (the §6 map). */
  kind:
    | 'result'        // pass_fail → label + PASS/FAIL/N/A pill (+ optional failReason)
    | 'value'         // number/text/date/dropdown/computed → label + value
    | 'paragraph'     // textarea → label + wrapped block
    | 'list'          // multi_select → label + comma-joined values
    | 'subheading'    // header → a Section sub-heading
  /** For kind='result'. */
  pass?: 'pass' | 'fail' | 'na' | null
  failReason?: string | null
  sansRef?: string | null
  /** For value/paragraph/list — already formatted to a display string. */
  value?: string
}

/** A repeating_group rendered as N labelled entries, each a list of inner rows. */
export interface ReportGroup {
  fieldId: string
  label: string
  entries: Array<{ index: number; rows: ReportFieldRow[] }>
}

/** Photos for one (section,field) photo-field, already fetched to data: URIs. */
export interface ReportPhoto {
  /** data:image/...;base64,... — null if download failed (render shows a placeholder). */
  dataUri: string | null
  /** "12 Jun 2026 · -29.85, 31.02 · by Alice" — pre-joined caption band, may be ''. */
  caption: string
}
export interface ReportPhotoField {
  sectionId: string
  fieldId: string
  label: string
  photos: ReportPhoto[]
  /** Count beyond the rendered cap, for an "(+N omitted)" note. */
  omittedCount: number
}

export interface ReportSection {
  sectionId: string
  title: string
  rows: ReportFieldRow[]          // non-group, non-photo fields in template order
  groups: ReportGroup[]           // repeating_group fields
  photoFields: ReportPhotoField[] // photo fields in this section
}

/** One annexure (file-upload OR linked handover doc) — referenced, not embedded. */
export interface ReportAnnexure {
  name: string
  /** 'inspection-attachments' file or 'handover' doc. */
  source: 'attachment' | 'handover'
  /** Signed URL (short-lived) the PDF prints as a reference link. */
  href: string | null
  /** For image attachments only: a thumbnail data: URI. Null otherwise. */
  thumbnailDataUri?: string | null
  meta?: string | null            // e.g. "PDF · 142 KB" or a handover category
}

export interface ReportSignature {
  role: string
  name: string
  title: string | null
  registrationNumber: string | null
  signedAt: string | null         // ISO; the document formats it
  /** data:image/png;base64,... — null if download failed. */
  imageDataUri: string | null
}

export interface ReportAuditEntry {
  at: string | null               // ISO
  sectionId: string | null
  fieldId: string | null
  by: string                      // resolved name, or short uuid fallback
}

export interface ReportSummary {
  documentNumber: string          // coc_number ?? '— pending —'
  projectName: string
  projectCode: string | null
  targetLabel: string
  templateName: string
  templateVersion: string | null
  inspectors: string              // joined names
  verifier: string | null
  startedAt: string | null        // ISO
  certifiedAt: string | null      // ISO
  overallResult: string | null    // 'pass' | 'fail' | 'conditional_pass' | null
  sansReference: string | null
  /** Tally across all pass_fail responses (incl. group entries). */
  tally: { pass: number; fail: number; na: number }
  /** Failed-field labels for the summary list (mirrors the cert's failed list). */
  failed: Array<{ label: string; sansRef?: string | null }>
}

/** The full serializable payload the document renders from. */
export interface InspectionReportData {
  inspectionId: string
  summary: ReportSummary
  sections: ReportSection[]
  annexures: ReportAnnexure[]
  signatures: ReportSignature[]
  audit: ReportAuditEntry[]
  /** Inputs to resolveBranding (kept separate so the route owns precedence). */
  brandingInput: {
    orgName: string
    orgLogoDataUri: string | null
    orgAccent: string | null
    projectAccent: string | null
    clientLogoDataUri: string | null
    projectMarkDataUri: string | null
    /** "<Project> — <target/subject> · <date>" subtitle source. */
    projectSubtitle: string
  }
}
```

The route maps `brandingInput` → the engine's `BrandingInput` (title `"Inspection & Test Report"`, kicker `"ELECTRICAL INSPECTION"`, `contractor: null`) and calls `resolveBranding`.

---

## Task 1: Interior layout tokens (theme.ts)

**File:** edit `apps/web/src/lib/reports/theme.ts`.

- [ ] **Step 1:** add interior tokens to the existing `spacing` object (do not remove cover tokens). Add: `runningHeaderHeight: 28`, `runningFooterHeight: 24`, `headerLogoMaxHeight: 14`, `headerFontSize: 8`, `sectionHeadingFontSize: 13`, `sectionRuleHeight: 2`, `rowLabelFontSize: 9`, `rowValueFontSize: 10`, `rowGap: 6`, `pillFontSize: 8`, `pillPaddingH: 6`, `pillPaddingV: 2`, `failReasonFontSize: 8`, `photoGridCols: 3`, `photoCellGap: 6`, `photoCaptionFontSize: 6`, `tableHeaderFontSize: 8`, `tableCellFontSize: 9`, `annexureRowFontSize: 9`, `signatureImageMaxHeight: 60`, `auditRowFontSize: 7`. (Implementer may tune values to match the cert's visual density; the cert uses 3-up photos at 160×120, section headings ~14pt, audit rows ~8pt — these are the parity reference.)
- [ ] **Step 2:** add a tiny pure helper `passPillColors(pass, accent)` returning `{ bg, fg }` for `'pass' | 'fail' | 'na' | null` (green / red / grey / faint). Keep it in `theme.ts` so it's snapshot-stable and unit-trivial.
- [ ] **Step 3:** `pnpm --filter web type-check` clean. Commit: `git add apps/web/src/lib/reports/theme.ts && git commit -m "feat(reports): interior layout tokens + pass-pill colours"`.

## Task 2: Interior primitives (TDD)

**Files:** create `apps/web/src/lib/reports/interior.tsx`, `apps/web/src/lib/reports/interior.test.tsx`.

> **Snapshot strategy:** react-pdf primitives are plain React function components returning `<View>/<Text>/<Image>` from `@react-pdf/renderer`. Test them as **element trees**, not rendered PDFs — call the component as a function or render with `react-test-renderer`'s `create(...).toJSON()` and snapshot. This needs the **jsdom** env (the default for `apps/web/vitest.config.ts`) and **no** `renderToBuffer`, so no node pragma. (Only `render-inspection.test.ts` calls `renderToBuffer`.) If `react-test-renderer` is not already a dep, assert structurally instead (e.g. invoke the component and walk `props.children`) — do not add a dep just for snapshots.

- [ ] **Step 1 (tests first):** in `interior.test.tsx`, write a failing test per primitive asserting the load-bearing structure:
  - `RunningHeader({ issuerLogoDataUri, title, accent })` — renders a `fixed` view; shows the issuer logo `<Image>` when the data URI is present, else the issuer text; contains a `render`-prop `<Text>` for `pageNumber / totalPages` (mirror `Cover`'s footer page-number pattern, components.tsx line 192).
  - `RunningFooter({ contractorLogoDataUri, stamp, accent })` — `fixed`; stamp text present; drops the contractor logo when null.
  - `Section({ title, accent, children })` — heading text + a 2px accent rule (`backgroundColor: accent`); marks itself `wrap` so it page-breaks (react-pdf default) and renders children.
  - `ResultPill({ pass, accent })` — text is `PASS`/`FAIL`/`N/A`/`—` for `'pass'|'fail'|'na'|null`; background from `passPillColors`.
  - `ResultRow({ row, accent })` — for `kind='result'` shows label + `ResultPill` + (when `failReason`) a sub-line; for `value/paragraph/list` shows label + value; for `subheading` shows a bold sub-heading. (Drive off the `ReportFieldRow.kind` union.)
  - `Table({ columns, rows })` — header row + body rows (generic; used by the Audit appendix). Assert header cell count == `columns.length`.
  - `PhotoGrid({ field, accent })` — N-up grid (cols from `spacing.photoGridCols`); each cell is an `<Image>` when `dataUri` present else a `[image unavailable]` text placeholder; renders the caption band; renders the `(+N omitted)` note when `field.omittedCount > 0`.
  - `SignatureBlock({ signature })` — name (bold) + title + `Reg #` + role + date; signature `<Image>` when `imageDataUri` present, else nothing (no throw).
  - `AnnexureList({ annexures })` — one row per annexure: a type glyph/label + name + meta + (when `href`) a `<Link>` ; image annexures render the `thumbnailDataUri`. Empty list renders a muted "No annexures." line.
- [ ] **Step 2:** run `pnpm --filter web test interior` → confirm it fails (module missing).
- [ ] **Step 3:** implement `interior.tsx`. No `'use client'`. Import `View, Text, Image, Link, StyleSheet` from `@react-pdf/renderer`; `spacing`, `passPillColors` from `./theme`; the `Report*` types from `./inspection-report-data` (type-only import — created in Task 3; if executing strictly in order, define a minimal local prop interface and switch to the shared types in Task 4's wiring step). Use `StyleSheet.create`. Accent is always a prop (never read globally) so primitives stay pure.
- [ ] **Step 4:** run `pnpm --filter web test interior` → green. **Step 5:** commit: `git commit -am "feat(reports): interior primitives — header/footer/section/row/pill/photogrid/signature/annexure"`.

## Task 3: Data-gatherer (TDD)

**Files:** create `apps/web/src/lib/reports/inspection-report-data.ts` (incl. the `InspectionReportData` interface block above), `apps/web/src/lib/reports/inspection-report-data.test.ts`.

> **Purity boundary:** the function does I/O (Supabase reads, storage downloads) but returns a plain object. Tests mock the supabase clients entirely (the `qb()` stub) so no network. The *mapping* logic (response → row, photo vs file routing, tally, failed-list, group-entry expansion) is the part under test.

- [ ] **Step 1 (tests first):** write `inspection-report-data.test.ts` using the `vi.hoisted(() => ({ createClientMock, createServiceClientMock, requireEffectiveRoleMock }))` pattern (copy the mock + `qb()` chainable stub from `inspections.actions.test.ts` lines 1–50). Cover:
  - **RBAC:** `requireEffectiveRole` returning `{ ok: false }` → `gatherInspectionReportData` throws/returns an error (assert it does not proceed to fetch). Returning `{ ok: true }` → proceeds.
  - **Field-type mapping (§6), one assertion per type** over a fixture template + fixture responses:
    - `pass_fail` true/false/na → `ReportFieldRow{ kind:'result', pass:'pass'|'fail'|'na' }`; `fail_reason` populates `failReason`.
    - `number` (with `unit` + `pass_when`) → `kind:'value'`, value string includes unit + threshold/pass-state (mirror cert render.ts lines 310–317).
    - `text`, `date`, `dropdown`, `computed` → `kind:'value'` with the text value.
    - `textarea` → `kind:'paragraph'`.
    - `multi_select` → `kind:'list'`, comma-joined.
    - `header` → `kind:'subheading'`.
    - `photo` → appears under the section's `photoFields`, **not** `rows`.
    - `file` → appears under top-level `annexures` with `source:'attachment'`, **not** `rows`.
    - `signature` → appears under `signatures` (sourced from signature rows by role, **not** the template field), **not** `rows`.
    - `repeating_group` → a `ReportGroup` with one entry per discovered synthetic index; inner rows mapped by the same rules.
  - **Photo vs file routing:** two `photos` rows with the same inspection but different `(section_id,field_id)` — one mapping to a `photo` field, one to a `file` field — are routed to `photoFields` vs `annexures` respectively, and signed against `inspection-photos` vs `inspection-attachments` (assert the bucket name passed to `storage.from(...)`).
  - **Names via service client:** inspector/verifier/audit `by` names come from the **service** client's `profiles` query, not the cookie client (assert the service mock supplied them and the cookie `profiles` query was not the source — same shape as `inspections.actions.test.ts` `listProjectMembersAction` test).
  - **Graceful degradation:** a storage `download` returning an error → the photo's `dataUri`/signature's `imageDataUri` is `null` and the function still returns (no throw). A null `org.logo_url` → `orgLogoDataUri: null`.
  - **Tally + failed list:** mixed pass/fail/na responses → `summary.tally` counts correct; `summary.failed` lists the fail labels (incl. group-entry labels) mirroring the cert's failed-field logic (render.ts lines 554–600).
- [ ] **Step 2:** run `pnpm --filter web test inspection-report-data` → fails.
- [ ] **Step 3:** implement `gatherInspectionReportData(inspectionId: string): Promise<InspectionReportData>`:
  1. `const supabase = await createClient()`. Read the inspection row (`id, project_id, organisation_id, template_id, target_label, status, overall_result, coc_number, started_at, certified_at, assigned_to_id, verifier_id`) via `.schema('inspections')`. `notFound`/throw if missing.
  2. **Gate:** `requireEffectiveRole(supabase, inspection.project_id, ALL_PROJECT_ROLES)` (the full set, mirroring the RLS-gated fill page). Reject → throw `new Error(gate.error)`.
  3. `const service = createServiceClient()`. Fetch via `service` (RLS already cleared by the gate, and `profiles`/storage need service): template (`name, version, deliverable_type, sans_reference, schema_json`), project (`name, code, organisation_id, client_logo_url, project_logo_url, report_accent_color, status`), org (`name, logo_url, report_accent_color`), all `responses`, all `response_history` (ordered), all `photos` (full column set incl. `original_path` if present — select `*` like `payload-loader.ts`), all `signatures`.
  4. **Build the section model:** walk `schema_json.sections` (and each `section.subsections[].fields` — the cert flattens these via `allFields`; mirror it). For each field, apply the §6 map to produce `rows` / `groups` / `photoFields`. Port `collectGroupEntryIndices` (render.ts 513–527) for `repeating_group`. Number/threshold formatting + pass-state mirror render.ts 308–322.
  5. **Photo vs file routing:** build a `Map<"sectionId|fieldId", FieldType>` from the template. For each `photos` row, look up its field type. `photo` → group into `photoFields` (sign `inspection-photos`, prefer `original_path` then `storage_path`, download to a `data:` URI via a `downloadToDataUri(service, bucket, path)` helper modelled on `branding-preview/route.ts` `logoToDataUri`). `file` → push to `annexures` with `source:'attachment'`, sign `inspection-attachments`, and if the file is an image MIME thumbnail it (else `thumbnailDataUri: null`). Cap photos per field (e.g. 24, as the cert does) and set `omittedCount`.
  6. **Captions:** build a `capturedByLookup` (service `profiles` by `uploaded_by`/`captured_by_profile_id`) and join the caption band string ("date · gps · by name") exactly like render.ts 396–424.
  7. **Signatures:** map signature rows → `ReportSignature[]`, downloading each `storage_path` from `inspection-signatures` to a `data:` URI.
  8. **Handover links:** best-effort — query `tenants.handover_folders` + `tenants.documents` for the project (mirror the edge fn's `autoFileIntoHandover` read shape, index.ts 146–159) and append the related docs as `annexures` with `source:'handover'`, `href` = a signed URL, `thumbnailDataUri: null`. **List only — never write.** If the project has no handover folders, skip silently. (Phase 1 = list; auto-filing is Phase 3.)
  9. **Names:** resolve inspector(s) (distinct `response_history.responded_by` ∪ `assigned_to_id`), verifier (`verifier_id`), and audit `by` via the **service** `profiles` query; short-uuid fallback (`uid.slice(0,8)`) when a name is missing (mirror page.tsx `nameFrom`).
  10. **Summary:** assemble `ReportSummary` (document number, identity rows, overall result, tally, failed list).
  11. **brandingInput:** org/project accents + the three logo `data:` URIs (downloaded via the same helper, from `report-logos`); `projectSubtitle` = the inspection `target_label` (the report's subject).
  - **Cost note (spec §7):** inspection reports carry no cost fields. If a future template surfaces a rate/value field, gate it via `COST_VIEW_ROLES` before including the value. Phase 1: no cost handling needed — do not add speculative gating.
- [ ] **Step 4:** run `pnpm --filter web test inspection-report-data` → green. **Step 5:** commit: `git commit -am "feat(reports): gatherInspectionReportData — pure serializable report payload"`.

## Task 4: Inspection report document (TDD)

**Files:** create `apps/web/src/lib/reports/inspection-report.tsx`, `apps/web/src/lib/reports/render-inspection.ts`, `apps/web/src/lib/reports/render-inspection.test.ts`. If Task 2 used local prop interfaces, switch `interior.tsx` to import the shared `Report*` types now (and re-run `pnpm --filter web test interior`).

- [ ] **Step 1 (test first):** `render-inspection.test.ts` with `// @vitest-environment node` (the `renderToBuffer` lesson). Build a **fixture `InspectionReportData`** exercising every §6 field type + at least: one section with rows, one `repeating_group`, one `photoField` (1×1 PNG `data:` URI like `render.test.ts`), one `file` annexure, one `handover` annexure, two signatures, three audit rows. Assert:
  - `renderInspectionReport(data, branding)` returns a Buffer whose first 5 bytes are `%PDF-`.
  - Renders with photos/annexures/signatures/audit all **present** (no throw).
  - Renders with them all **empty** (`sections:[]`, `annexures:[]`, `signatures:[]`, `audit:[]`) (no throw).
  - Renders when a photo `dataUri` is `null` and a signature `imageDataUri` is `null` (placeholder path, no throw).
  - `branding` here is a `ResolvedBranding` built inline (reuse `resolveBranding` from `./branding` with a fixture `BrandingInput`).
- [ ] **Step 2:** run `pnpm --filter web test render-inspection` → fails.
- [ ] **Step 3:** implement:
  - `inspection-report.tsx` — `InspectionReportDocument({ data, branding }: { data: InspectionReportData; branding: ResolvedBranding })`. Structure (mirror the cert's composition order, index.ts + render.ts, but on the new primitives):
    ```
    <Document title="Inspection & Test Report" producer="e-site.live">
      <Page size="A4" style={pageStyles.page}>
        <RunningHeader issuerLogoDataUri={branding.issuer.logoSrc ?? null} title={branding.title} accent={branding.accent} />
        <RunningFooter contractorLogoDataUri={null} stamp={branding.footerStamp} accent={branding.accent} />
        <Cover resolved={branding} />          {/* reused verbatim; its own fixed footer coexists — see note */}
        <Summary summary={data.summary} accent={branding.accent} />
        {data.sections.map(section => (
          <Section key={section.sectionId} title={section.title} accent={branding.accent}>
            {section.rows.map(...ResultRow)}
            {section.groups.map(...group heading + per-entry ResultRows)}
            {section.photoFields.map(...PhotoGrid)}
          </Section>
        ))}
        <Section title="Annexures" accent=...><AnnexureList annexures={data.annexures} /></Section>
        <Section title="Signatures" accent=...>{data.signatures.map(...SignatureBlock)}</Section>
        <Section title="Audit history" accent=...><Table columns={['When','Field','By']} rows={auditRows} /></Section>
      </Page>
    </Document>
    ```
    - **Footer collision note:** `Cover` already renders its own `fixed` page-numbered footer (components.tsx 190–193). To avoid double footers, EITHER (a) render `RunningFooter` and rely on `Cover` only for the cover's title block — acceptable for Phase 1 parity since both show a stamp + page number — OR (b) keep `Cover`'s footer as the single footer and drop `RunningFooter`, using only `RunningHeader`. **Pick (b) for the simplest parity** unless the visual review wants the contractor mark in the footer (it's null in Phase 1 anyway). Flag the choice in the commit message. Do not edit `Cover`.
    - `Summary` (defined in this file) — an identity metabox (document number, project, code, target, template+version, inspectors, verifier, started, certified, overall result, SANS) rendered as `ResultRow kind='value'` rows, plus an overall-result banner and the pass/fail/na tally, plus the failed-field list (muted "No failed fields." when empty). This mirrors the cert's cover rows (render.ts 185–204) + summary page (529–620), consolidated.
    - Use a single `<Page>` and let react-pdf auto-paginate (`Section` is `wrap`); the cert manually paginates, but auto-flow is the engine's idiom (foundation lesson). The `fixed` header/footer repeat on every flowed page.
  - `render-inspection.ts` — `export async function renderInspectionReport(data, branding): Promise<Buffer> { const el = React.createElement(InspectionReportDocument, { data, branding }) as React.ReactElement<DocumentProps>; return renderToBuffer(el) }` (copy the cast from `render.ts`).
- [ ] **Step 4:** run `pnpm --filter web test render-inspection` → green; full `pnpm --filter web test` green; `pnpm --filter web type-check` clean. **Step 5:** commit: `git commit -am "feat(reports): InspectionReportDocument + renderInspectionReport (parity composition)"`.

## Task 5: Node-runtime preview route

**File:** create `apps/web/src/app/api/projects/[id]/inspections/[inspectionId]/report-preview/route.ts`.

- [ ] **Step 1:** implement the GET handler (copy structure from `app/api/projects/[id]/branding-preview/route.ts`):
  - `export const runtime = 'nodejs'`; `export const dynamic = 'force-dynamic'`.
  - Params: `{ id: string; inspectionId: string }`.
  - Auth: `createClient()` + `auth.getUser()` → 401 if none. (The deeper RBAC gate is enforced inside `gatherInspectionReportData` via `requireEffectiveRole`; the route may also early-gate but must not duplicate the role logic.)
  - `const data = await gatherInspectionReportData(inspectionId)` (wrap in try/catch → 403 on the gate error message, 404 on "not found", 500 otherwise).
  - Map `data.brandingInput` → `BrandingInput` (`title: 'Inspection & Test Report'`, `kicker: 'ELECTRICAL INSPECTION'`, `contractor: null`, `date` = today `YYYY-MM-DD`, `project.subtitle = data.brandingInput.projectSubtitle`, logos from the `*DataUri` fields). `const branding = resolveBranding(input)`.
  - `const pdf = await renderInspectionReport(data, branding)`.
  - Return `new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="inspection-report.pdf"', 'Cache-Control': 'no-store' } })`.
- [ ] **Step 2:** `pnpm --filter web type-check` clean. Commit: `git commit -am "feat(reports): inspection report-preview route (Node runtime, parity surface)"`.

## Task 6: Parity validation (the exit criterion — real PDFs)

> Spec §8: Phase 1 is "done" when **content** matches the live `pdf-lib` cert for the same inspection (branding + layout differ by design), judged on **real rendered output** — never a mockup.

- [ ] **Step 1:** pick a real inspection id with rich content (photos, a `file` upload, ≥2 signatures, several pass/fail + a fail-reason, ideally a `repeating_group`). Prefer a **certified** KINGSWALK inspection so a current cert PDF exists to diff against. (Query the live DB read-only for an id if needed; do not mutate.)
- [ ] **Step 2:** start the dev server (use the `run`/preview tooling). Hit `/api/projects/{projectId}/inspections/{inspectionId}/report-preview` and save the PDF. Separately fetch the **current cert** for the same inspection (invoke `render-inspection-pdf` with `{ inspection_id, draft: true }`, or open the stored cert) and save it.
- [ ] **Step 3:** diff the two **on content**, section by section, against this checklist (each is parity-critical):
  - Cover/identity: document number, project + code, target, template + version, inspectors, verifier, started, certified, overall result, SANS reference.
  - Every template section present, in template order; every field's label + value/result; `fail_reason` sub-lines; number unit + threshold/pass-state.
  - `repeating_group` entries (count + per-entry inner rows).
  - Photos: each `photo`-field's images appear (count, caption band: date · gps · by-name); `(+N omitted)` when capped.
  - Annexures: every `file`-upload listed as a reference link (+ image thumbnail); related Handover docs listed.
  - Summary: overall-result banner + pass/fail/na tally + failed-field list.
  - Signatures: each signatory name, title, registration number, role, date, signature image.
  - Audit: response-history entries (when · field · by-name).
  - Send both PDFs to the user via the file-send tool for the side-by-side review. Capture a screenshot of each.
- [ ] **Step 4:** record any content gaps; for each, return to the gatherer/document task, fix, re-run the affected `pnpm --filter web test ...`, and re-verify. **Do not patch the PDF output by hand.** Parity is the gate; layout/branding divergence is expected and fine.

## Task 7: Finalise

- [ ] **Step 1:** final `pnpm --filter web type-check` + `pnpm --filter web test` both green (capture the output — evidence before claiming done, per verification-before-completion).
- [ ] **Step 2:** confirm **no** behaviour change to the live cert path: the `render-inspection-pdf` edge function, `inspections-certify.actions.ts`, and the certify flow are **untouched**. The new route is additive and unreferenced by the certify path.
- [ ] **Step 3:** push the branch over the gh-token HTTPS remote and (optionally) open/update a PR — **only on the user's go-ahead.** Note in the PR body that this is Phase 1 (parity surface only; not persisted, not certified; Phases 2–3 add `projects.reports` persistence and the regulated cutover).

---

## Verification (the milestone)

Dev server → `GET /api/projects/{id}/inspections/{inspectionId}/report-preview` returns a branded "Inspection & Test Report" PDF that **matches the current cert's content** for the same inspection (cover/identity, all sections + fields + photos, summary/result/tally, annexures-as-links, signatures + registration, audit trail), validated by a real side-by-side PDF diff. `pnpm --filter web test` + `type-check` green. The live cert path is unchanged.

---

## Out of scope (Phase 1 — do not build)

- `projects.reports` persistence, `reports.service`, the reports list (**Phase 2**).
- `exportReportAction('inspection', id)` + a kind registry (**Phase 2**) — Phase 1 wires the kind through the thin route only.
- CoC numbering, registered-person / PR-Eng qualification gate, draft mode, revoke / share / supersede, Handover **auto-filing** (write), retiring `render-inspection-pdf` (**Phase 3**).
- Full-document embedding / PDF-merge of annexures (annexures are **referenced + image-thumbnailed** only).
- #5 snag report (own spec; reuses these primitives).

## Spec gaps / ambiguities surfaced (resolve if they matter to you)

1. **④ contractor logo has no source for inspections.** No sub-org/contractor is associated with an inspection in the schema today (confirmed by grep). Phase 1 sets `contractor: null` (slot drops). If the report should show a contractor mark, we need a decision on *where* it comes from (project sub-org? a new inspection column?) — that's a Phase-2/3 concern but flagged now.
2. **`inspections.photos` conflates photos and file-uploads with no MIME/bucket column.** The gatherer routes by template field type (the only available signal). Risk: a `file` upload whose `(section,field)` doesn't resolve to a template field (e.g. template later edited) can't be classified — Phase 1 treats unclassifiable rows as **annexures** (safer than embedding an arbitrary blob as an image). Confirm that fallback is acceptable.
3. **`FileField.tsx` reads from a non-existent `inspections.attachments` table** (it should read `inspections.photos`, which is where `upload-file/route.ts` writes). This is a **pre-existing latent bug** unrelated to this plan — flagged, not fixed here. It means file-field uploads currently never render back in the fill UI either; the report gatherer reads `photos` correctly regardless.
4. **Footer ownership** (`Cover`'s built-in footer vs `RunningFooter`) — plan picks the simplest non-duplicating option (b) and flags it; a visual reviewer may prefer the contractor-mark footer once ④ has a source.
5. **Which inspection to validate against** — parity is only meaningful on an inspection that already has a `pdf-lib` cert. If no suitable certified inspection exists in the data, we either certify a test one (out of this plan's scope) or validate against a `draft:true` render of the edge function for an uncertified inspection (acceptable — same renderer, just watermarked).
