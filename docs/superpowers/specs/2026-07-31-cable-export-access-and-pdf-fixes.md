# Cable-schedule exports — role access + PDF render fixes

**Date:** 2026-07-31
**Status:** Approved (user confirmed scope + role policy in-session)
**Origin:** User report: admins can't download the cable-schedule PDF; contractors can't download any export at all.

## Findings (prod-evidenced 2026-07-31)

1. **PDF revision pack has never rendered.** pdf-lib standard Helvetica encodes WinAnsi (CP1252) only. The schedule column header `Ω/km` (`export-pdf.ts:289`) throws `WinAnsi cannot encode "Ω"` on every render — present since the original exports commit `4140aa5` (2026-05-13). No test calls `renderRevisionPdf`. Routes affected: `export/pdf`, `export/zip`, `export/multi-zip` (both ZIPs embed the PDF) → HTTP 500 for every revision.
2. **Second crash, same class:** `→` (U+2192) in tag-card detail (`export-pdf.ts:714`) and Avery labels (`:1131`) — crashes any revision with tags; breaks `export/tag-labels/pdf` independently. Reproduced on live KINGSWALK data (74 tags). Any future non-CP1252 char in user data (project names, notes, tags) would crash the same way.
3. **Breaker column blank in ALL export formats.** Export payload reads only `structure.nodes.breaker_rating_a` (NULL on all 132 KINGSWALK / 91 ITONKA nodes) and never falls back to the populated `incomer_breaker_a` (96 / 72 nodes set). The 2026-06-24 spec §A1 required `breaker_rating_a ?? incomer_breaker_a`; only the first half was implemented. Excel + CSV consume the same field.
4. **Contractors (and inspectors/suppliers) are blocked from every export.** `getExportPolicy` knows only owner/admin/PM (full) and client_viewer (redacted, project-scoped); every other role → 403 `Unknown role: <role>`. The revision page renders the ExportMenu unconditionally, so site roles see 9 download buttons that all fail. The module's own §15.2 role model defines a Site Operator seat that was never mapped.
5. **Layout defects** (verified by rendering live data): From/Tag columns ellipsize on nearly every row while ~180pt of landscape width sits unused; tag-card text overlaps QR codes and bleeds across cards; VD %/Cum % print `0.00` when lengths are unmeasured (unknowable, not zero); cost-page `Line ZAR` header clipped at page edge; cost rows with zero usage print as noise; mixed decimal conventions (line cells `427629.60` vs totals `3 406 513,93`); sizes with usage but no cost line silently contribute R0.
6. **Separate follow-up (calc layer, out of scope here):** cumulative VD % is 0.00 for generator-fed runs whose own VD > 0 — `computeCumulativeVdMap` walks only from utility sources, not generator nodes. Shared with the on-screen grid.

## Decisions (user-confirmed)

- **Contractor, inspector, supplier:** may export **all formats**, **cost-redacted**, project-scoped (must resolve an effective role on the project).
- **PDF document structure stays** (cover → landscape schedule → cost summary → tag cards); defects fixed.

## Design

### Role policy (export-role.ts)
Rebuild `getExportPolicy` on the canonical `public.user_effective_project_role` RPC (same primitive as `requireEffectiveRole`, migration 00107):
- effective role `null` → 403 "No access to this project" (covers unassigned org members of any role — preserves the existing client_viewer project-scoping and extends it to site roles).
- any resolved role → `canExport: true`; `redactCost = !COST_VIEW_ROLES.includes(role)` (existing shared constant — no new role group needed).
- Per-project promotion to PM (project_members.role) grants full export automatically via the RPC.
- `organisationId` param dropped; callers (`assert-export-policy.ts`, multi-zip route) updated.

### Unicode-safe PDF text
`winAnsiSafe(text)` helper: keep CP1252-encodable chars; explicit replacements (`Ω`→`Ohm`, `→`→`->`, `←`/`↔`, `−`→`-`, `≤`/`≥`, `Δ`→`delta`); else NFKD-transliterate and strip combining marks; else `?`. Applied at every `drawText`/`widthOfTextAtSize` site in `export-pdf.ts` (all four renderers). A full-render regression test with hostile fixture data (Greek/CJK/emoji in project name, tags, notes) guards every page type.

### Data population
- Nodes select adds `incomer_breaker_a`, `incomer_pole_config`; run building uses `breaker_rating_a ?? incomer_breaker_a` (same for pole config) via a small exported helper (unit-testable). Fixes PDF + Excel + CSV at once.
- VD % / Cum % render blank when the run has no measurable length (value is unknowable, not 0).

### Layout
- Schedule grid: widen Cable Tag 95→130, From 60→95, To 60→85 (total 754 ≤ 777.89 usable).
- Tag cards: clip tag text to the card width minus QR + padding (mirrors Avery renderer).
- Cost page: columns repositioned to fit inside the margins (Line ZAR no longer clipped); uniform money format `1 234 567.89` (space grouping, dot decimal) for line cells AND totals; skip zero-usage rate-library rows; rows with usage but no cost line show `—` rates + footnote "no rates captured — excluded from totals"; if rows overflow the page, print "+N more groups not shown".
- Cover page: explicit "Cost data excluded for your role" line when `costRedacted` (parity with Excel/ZIP/CSV redaction notes from the 2026-06-24 pass).

### UX
- ExportMenu gains a note when the caller's exports are cost-redacted ("Cost data is excluded for your role"); revision page passes `redactCost = !canSeeCost` (already computed).

### Docs
- `docs/rbac-matrix.md`: all 7 export routes gain R¹ for contractor/inspector/supplier; footnote rewritten for the new policy.

## Testing

- TDD. New: full-render regression test (renderRevisionPdf + tag-list + Avery with hostile fixture), `winAnsiSafe` unit tests, rewritten `export-role.test.ts` (each role × outcome via mocked RPC), breaker-fallback helper test.
- Existing web + shared suites, type-check, lint.
- Local live-data verification: re-render KINGSWALK + ITONKA PDFs via a service-role script (same harness used to evidence the bugs) and visually inspect before PR.
- Post-deploy: contractor path live-verified with the `rbac-test` prod fixture (expect 200 + no cost content); admin path via throwaway probe-admin.

## Deploy cost

App-layer only — no migration, no edge functions. Single PR → Vercel auto-deploy on merge. Verification possible entirely pre-merge (unit + local render) plus post-deploy role probes.
