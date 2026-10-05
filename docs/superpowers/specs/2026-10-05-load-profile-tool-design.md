# Load profile tool — design (E8)

**Date:** 2026-10-05 · **Branch:** `feat/load-profile` · **Owner default D1:** project-level tab, all plans (not Solar-gated).

## Problem
Load analysis lives only inside the Solar add-on (`solar/(gated)/load`). Its storage (`solar.meter_*`, bucket `solar-meter-raw`) and the `tariffs` schema are readable only by orgs with a Solar subscription (`solar.library_orgs`, `caller_has_any_solar_org()`), so a non-gated tab cannot reuse them through the caller's session. Production holds zero meter rows, so nothing has to migrate.

## What is reused, unchanged
- Parsers: `@esite/shared/meter-data` (`parseMeterFile`, `parseMeterWorkbook`; formats A/B/C/generic; SAST, begin/end convention, kWh→kW, cumulative→delta, gaps as quality 1, conflicting duplicates as quality 5).
- Load maths: `@esite/shared/solar-load` (`meterReferenceSeries` → 8760, `fillGaps`, `alignToReferenceYear`, archetypes + `synthesiseTenant`, `siteProfileCharts`, `monthlyMaxDemand`, `dailyHeatmap`).
- Tariff engine: root `@esite/shared` (`costHourly`, `aggregateHourly`, `touPeriodAt`), and the web loaders `loadYearTariffs` / `loadStudyCalendar`, which take any client.
- Charts: `components/charts/*` (in-house SVG/canvas).

## New
1. **Migration** `00230` at writing (number claimed at merge): `projects.load_profiles` (one per project for now: name, reference year, power factor, common-area %, selected tariff) and `projects.load_profile_sources` (kind `meter` | `tenant_schedule` | `admd`; for meters the parsed channel as `ts_end[0] + interval_min + values real[]` with NULL for missing, plus the import report; for synthetic kinds a `params` jsonb). Private bucket `load-profile-files`, path `{project_id}/{sha256}.{ext}`. RLS split per verb: read = project access and not client viewer; write = owner/admin/project manager via `user_effective_project_role`. `organisation_id` bound from the project by trigger.
2. **Shared pure module** `@esite/shared/load-profile`: `combineSources` (measured sources → 8760 via `meterReferenceSeries` with no synthetic fill; synthetic sources added), `analyseProfile` (KPIs, overlays by day type and season, heat map, LDC, monthly kWh, measured MD with timestamp at native interval, NMD suggestion), `touSplit`, `importQuality` (gaps, duplicates, outliers per channel). Deterministic, no I/O.
3. **Routes** under `app/api/projects/[id]/load-profile/`: `files` (register uploaded object), `parse` (server re-parse → review), `commit` (server re-parse with confirmed options, write selected channels). `export?format=xlsx|pdf`.
4. **Tab** `projects/[id]/load-profile`: sources list + upload + tenant-schedule synthesis + ADMD block; outputs; tariff picker (published years only) with TOU split and annual cost.
5. **Tariffs:** read through the caller's session; the library's RLS is the gate (ADR-007 / PR #239 opens the published library to every signed-in org). Queries are also narrowed to `tariff_year.state = 'published'`. *(Superseded 2026-10-05: the first cut used the service client; ADR-007 rejected that shape — the database is the gate.)*

## Rules
- NMD suggestion = highest monthly MD (kVA; measured kVA, else kW ÷ PF) × 1.10, rounded up to 5 kVA. The rule is printed beside the figure.
- An hourly profile peak is never shown as MD; MD comes from interval data only. Synthetic-only profiles show "design peak (hourly)".
- kWh↔kW conversion is shown on the review screen per channel (source unit → stored unit, interval).
- Measured gaps are NOT filled with synthesis silently: the gap-fill counts are shown, and unfilled hours stay out of the totals with a coverage figure.

## Out of scope (parked)
Solar consuming the profile as a new load basis (needs an engine basis, S5); xls (BIFF) files; multiple profiles per project.

## Costing detail
`costHourly(tariff, { importKwh: profile8760, exportKwh: zeros }, { calendar, year: referenceYear, holidays, powerFactor, demandForMonth })`. `demandForMonth` supplies the measured monthly MD in kVA (interval data, mapped to the reference month) and the NMD the user confirms (default: the suggestion). Peak-window demand stays hourly-derived and is labelled as an approximation. The same engine, calendar loader and holiday set as the Solar tariff tab, so a profile costed here and in Solar against the same tariff gives the same bill.
