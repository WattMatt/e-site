# Inspection Report Export (#3) — Design

**Date:** 2026-06-03
**Status:** Design (brainstorm output). Builds on the merged foundation ([standardized-report-export-branding-design](2026-06-03-standardized-report-export-branding-design.md), PR #38).
**Backlog item:** #3. First real consumer of the report engine.

---

## 1. Problem & goal

The inspection deliverable today is a `pdf-lib` PDF rendered in the `render-inspection-pdf` **Deno edge function** — unbranded, on a second rendering stack, stored in `inspections.certificates`. The goal is **one branded inspection deliverable on the PR #38 engine**: the "Inspection & Test Report" kind, rendered by `@react-pdf/renderer`, using the locked cover + the shared interior primitives, eventually replacing the pdf-lib cert.

Because the cert is a **regulated artifact** (CoC numbers, registered-person / PR-Eng qualification gates, revoke/supersede), the replacement is **phased — rendering parity first, the regulated cutover last.**

## 2. Phasing (decomposition — confirmed with user)

| Phase | What | This spec |
|---|---|---|
| **1** | The **inspection report kind**: interior primitives + data-gatherer + `Document`, rendering **parity** with the current cert, validated side-by-side. Not yet the live deliverable. | **← detailed here** |
| 2 | **Reports foundation** (deferred PR-C + PR-E): `reports.service` (upload/insert/supersede/signed-URL/list) on `projects.reports`, generic `exportReportAction`, minimal reports list. Inspection reports persist in the unified model. | outlined |
| 3 | **Regulated cutover**: move CoC / qualification gates / draft / revoke/share/supersede + Handover auto-filing onto the new kind, **behind a flag**, validate vs the live cert, then retire the edge function. | outlined |

## 3. The locked visual (do not redesign)

The composition is **already agreed and recorded** — `.superpowers/brainstorm/43367-1780465849/content/07-composition.html` (cover option **B**, now the engine's `Cover`) and implemented in `apps/web/src/lib/reports/components.tsx`.

- **Cover** — reused **verbatim** from the engine. Only the inputs change: `title = "Inspection & Test Report"`, `kicker = "ELECTRICAL INSPECTION"`, `projectLine = "<Project> — <Phase/subject> · <date>"`, parties strip = ② client · ③ project · ④ contractor (omitted if absent). Accent = project → org → `#E69500`.
- **Interior anatomy** (from the same recorded mockup) — running header (① + report title + `p. n / N`) → `Section` heading → result **rows** (label + PASS/FAIL pill, or value) → `PhotoGrid` (4-up) → `SignatureBlock` → footer (④ contractor + generated date + `v`). Plus an **Annexures** section and an **Audit** appendix.

## 4. Engine work — interior primitives to build

The visible slice (PR #38) built only `Cover`, `Watermark`, `PreviewBody`. Phase 1 adds the remaining shared primitives the spec named (`apps/web/src/lib/reports/`), reusable by #5 snag later:

- `RunningHeader` — small issuer mark + report title + `pageNumber / totalPages` (react-pdf `fixed`).
- `RunningFooter` — ④ contractor mark + generated/version stamp (`fixed`).
- `Section` — heading (accent rule) + children; page-break-aware.
- `ResultRow` / `Table` — label + value or a `PASS | FAIL | N/A` pill (+ fail-reason line).
- `PhotoGrid` — N-up image grid from `data:` URIs (the app layer fetches bytes).
- `SignatureBlock` — signature image + name + registration no. + title, side-by-side roles.
- `AnnexureList` — document rows (type glyph + name + meta + a link); image annexures thumbnailed.

All are pure react-pdf components, snapshot-testable, accent-driven from `theme.ts`.

## 5. Report kind (per §10 extension contract)

A kind = **(1) data-gatherer + (2) `Document` from primitives + (3) registration.** Engine/branding inherited.

### 5.1 Data-gatherer (app layer, Node)
`gatherInspectionReportData(inspectionId)`:
- RBAC: `requireEffectiveRole` to the inspection's view roles (mirrors the inspection page gate).
- Fetch (service client after the gate): the inspection row (`status`, `overall_result`, `assigned_to_id`, `verifier_id`), its template `schema_json`, all `responses`, `photos`, `signatures`, and `response_history`.
- Resolve **names** via the service client (the recurring `public.profiles`-RLS lesson — inspector/verifier names).
- Resolve **branding**: project (client/project logos, accent) + org (issuer) + the inspection's **contractor sub-org** (④, resolved per-report) → download each logo as a `data:` URI (engine stays pure).
- Resolve **annexure docs**: each `file`-field response → signed link + (for images) a thumbnail `data:` URI; related Handover docs → link list.
- Returns a plain, serializable `InspectionReportData` (no react-pdf, no Supabase) → unit-testable.

### 5.2 Document
`InspectionReportDocument({ data, branding })` composes: `Cover` → **Summary** (identification metabox + overall result + pass/fail tally) → per **template section**: `Section` + rows (mapped by field type, §6) + `PhotoGrid` → **Annexures** (`AnnexureList`: file-uploads + linked Handover docs, one combined section) → **Signatures** (`SignatureBlock`) → **Audit appendix** (`response_history` table). `RunningHeader`/`RunningFooter` fixed on every page.

### 5.3 Registration
Add to the kind registry so a future `exportReportAction('inspection', inspectionId)` (Phase 2) resolves it. Phase 1 renders via a thin route/action returning the Buffer for parity review (not persisted).

## 6. Field-type → primitive mapping (the core of Phase 1)

| Template field type | Rendered as |
|---|---|
| `pass_fail` | result row + `PASS`/`FAIL`/`N/A` pill; `fail_reason` as a sub-line |
| `number`, `text`, `date`, `dropdown` | result row: label + value |
| `textarea` | label + wrapped paragraph |
| `multi_select` | label + comma-joined values |
| `computed` | result row (read-only computed value) |
| `photo` | `PhotoGrid` keyed to the field's `(section_id, field_id)` photos |
| `file` | **Annexures** entry (not inline) — link + image thumbnail |
| `signature` | `SignatureBlock` (rendered in the Signatures section, not inline) |
| `header` | a `Section` sub-heading |
| `repeating_group` | repeat the inner field rows per group instance |

Overall: `overall_result` drives the Summary banner; a tally counts pass/fail/N-A across `pass_fail` responses.

## 7. New decisions (genuinely not in the foundation)

- **Annexures strategy:** file-upload documents and linked Handover docs are **referenced (link) + image-thumbnailed**, combined in one "Annexures" section. **Full-document embedding / PDF-merge is out of scope** (heavier; a later option) — flagged so v1 doesn't silently imply embedding.
- **Handover linkage:** the report **lists** related Handover documents (and, post-Phase-3, the report itself auto-files into Handover as the cert does today). Phase 1 lists; it does not write to Handover.
- **Cost blocks:** none expected in an inspection report; if any rate/value field appears, gate via `canViewCost` per the foundation (`COST_VIEW_ROLES`).

## 8. Parity validation (Phase 1 exit criterion)

Render the new report and the current `pdf-lib` cert for the **same inspection** and diff content: cover/identity, every section's fields + photos, summary/result, signatures (+ registration), audit trail. Phase 1 is "done" when content matches (branding + layout differ by design) — reviewed by **real engine output**, never a mockup.

## 9. Architecture / runtime

- **Node only.** Rendering moves out of the Deno edge function into the Next.js app (`renderToBuffer`, `runtime = 'nodejs'`), exactly like `branding-preview`. Logos/photos fetched as `data:` URIs in the app layer (the engine stays pure/deterministic — the repo lesson).
- **React 19** already aligned (the engine renders on Vercel since PR #38's fix).
- Phase 1 ships a render entry point (route or action) returning the Buffer for parity review. Persistence (`projects.reports`) and the certify flow are **Phases 2–3**.

## 10. Testing

- `gatherInspectionReportData` — pure mapping over a mocked client: each field type produces the right row shape; names resolved via service client; missing logos degrade gracefully.
- Primitives — react-pdf element-tree snapshots.
- `renderInspectionReport(data, branding)` — first bytes `%PDF-`; renders with photos/file-annexures/signatures present and absent (no throw); `// @vitest-environment node` (the `renderToBuffer` lesson).
- Field-type coverage table (§6) exercised explicitly.

## 11. Out of scope (this spec / Phase 1)

- Persistence into `projects.reports` and the reports list (**Phase 2**).
- CoC numbering, registered-person / PR-Eng **qualification gate**, draft mode, revoke / share / supersede, Handover **auto-filing**, retiring the `render-inspection-pdf` edge function (**Phase 3**).
- Full-document embedding / PDF-merge of annexures.
- #5 snag report (its own spec; reuses these primitives).

## 12. Risks

- **Regulated content drift** — mitigated by the §8 side-by-side parity gate before any cutover (Phase 3).
- **Large inspections** (many photos) → PDF size / render time; react-pdf auto-pagination handles flow, but cap/scale image bytes in the app layer.
- **Two deliverables during transition** (cert + new report) — acceptable in Phases 1–2; resolved at the Phase 3 flagged cutover.
