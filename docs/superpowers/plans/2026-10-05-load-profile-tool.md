# Load profile tool — implementation plan (E8)

Spec: `docs/superpowers/specs/2026-10-05-load-profile-tool-design.md`. TDD per task; every guard proven red first.

| # | Task | Output | Test |
|---|---|---|---|
| 1 | Shared pure module `packages/shared/src/load-profile/` exported as `@esite/shared/load-profile` | `channel.ts` (stored arrays ↔ `Reading[]`), `quality.ts` (gap runs, spike/negative/duplicate counts from parser quality codes + report), `measured.ts` (reading → 8760 via `fillGaps` + `alignToReferenceYear`; uncovered hours filled from the meter's OWN day-type average, counted), `synthetic.ts` (tenant area × density × archetype; ADMD block), `combine.ts`, `analyse.ts` (KPIs, overlays, heat map, LDC, monthly kWh, measured MD with timestamp, NMD suggestion), `cost.ts` (TOU split + `costHourly`) | Hand-checked synthetic year (numbers derived in the test comments) + real-file golden figures cross-checked by an independent Python script |
| 2 | Migration `projects.load_profiles`, `projects.load_profile_sources`, bucket `load-profile-files` | per-verb RLS, org bound by trigger, `@verify` block | `scripts/db/assert-load-profile-rls.sql` red (no-op) → green, impersonating real roles |
| 3 | Server lib `apps/web/src/lib/load-profile/` | repo, parse/commit pipeline over `@esite/shared/meter-data`, tenant-schedule reader, published-tariff reader (service client, `state = 'published'`) | unit tests with fake client |
| 4 | Routes `api/projects/[id]/load-profile/{files,parse,commit,export}` + server actions | gate = `requireEffectiveRole` read/write sets; `docs/rbac-matrix.md` rows | route gate tests |
| 5 | Tab `projects/[id]/load-profile` + sidebar entry | sources panel, upload + review, synthesis forms, outputs, tariff + cost | component tests for review + outputs |
| 6 | Exports xlsx (exceljs) + PDF (react-pdf, WinAnsi-safe) | Summary, Monthly, TOU/cost, Sources/quality, 8760 hourly | workbook cell assertions; PDF text decoded per stream |
| 7 | Format fixtures | one fixture per catalogued format with ≥2 real files | `load-profile.formats.test.ts` |

Ship: type-check, lint, web + shared + db suites, `next build`; migration renumbered above the head at merge; deploy workflow applies + verifies; production smoke = unauthenticated redirect + rbac-test contractor read + a probe import on a throwaway project, torn down.
