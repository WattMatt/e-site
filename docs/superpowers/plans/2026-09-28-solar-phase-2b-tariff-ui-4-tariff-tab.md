# Solar Phase 2b — Part 4 of 5: Project Tariff tab (`/projects/[id]/solar/tariff`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Read the index first. Parts 1–3 must be done.

All commands run from `~/.config/superpowers/worktrees/esite/solar-phase-2b`.

**Level.** The whole tab is **Edit + financials** (spec §5 title "COST_VIEW_ROLES only"; §0.1 legend: cost-view = Edit + financials). The page calls `requireSolarLevel(id, 'edit_financials')` (lower levels are redirected to `/solar/locked` — the tab is already hidden for them by `visibleSolarTabs`), and **every action re-checks it**. The spec's per-row "write" labels are therefore effectively Edit + financials on this tab; the database agrees (00213 `studies_tariff_guard` + the money tables' RESTRICTIVE gates).

**Page → client props are JSON only** (the 2026-09-22 rule): the page passes data; client components build closures over server actions themselves.

**Audit, not product events** (index D2b-8): each save writes a `solar.audit_events` row whose `object_ref` carries ids only — never a rand amount (View users read the activity feed).

---

### Task 24: Server helpers — row mappers, calendar loader, effective tariff, errors

**Files:**
- Create: `apps/web/src/lib/solar/tariff/rows.ts`
- Create: `apps/web/src/lib/solar/tariff/calendar-loader.ts`
- Create: `apps/web/src/lib/solar/tariff/effective-tariff.ts`
- Create: `apps/web/src/lib/solar/tariff/errors.ts`
- Test: `apps/web/src/lib/solar/tariff/rows.test.ts`
- Test: `apps/web/src/lib/solar/tariff/effective-tariff.test.ts`
- Test: `apps/web/src/lib/solar/tariff/errors.test.ts`

- [ ] **Step 1: Write the failing tests**

`rows.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { tariffListItemFromRow, yearOptionFromRow, pinnedChargeFromRow, billCheckFromRow, isTouTariff, exportRateFromRow } from './rows'

describe('tariff tab row mappers', () => {
  it('tariff list item: numbers from PostgREST strings', () => {
    expect(tariffListItemFromRow({ id: 't', code: 'MF', name: 'Miniflex', category: 'commercial', metering: 'conventional', structure: 'tou',
      voltage_band: '500v_22kv', phase: null, min_kva: '25.00', max_kva: null, min_amps: null, max_amps: null, is_legacy: false, export_tariff_id: 'x' }))
      .toEqual({ id: 't', code: 'MF', name: 'Miniflex', category: 'commercial', metering: 'conventional', structure: 'tou', voltageBand: '500v_22kv',
        phase: null, minKva: 25, maxKva: null, minAmps: null, maxAmps: null, isLegacy: false, exportTariffId: 'x' })
  })
  it('year option', () => {
    expect(yearOptionFromRow({ id: 'y', financial_year: '2025/26', state: 'published', effective_from: '2025-07-01', effective_to: '2026-06-30', approved_increase_pct: '12.720' }))
      .toEqual({ id: 'y', financialYear: '2025/26', state: 'published', effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30', approvedIncreasePct: 12.72 })
  })
  it('pinned charge carries its source title and locator', () => {
    const c = pinnedChargeFromRow({ id: 'c', component: 'energy', season: 'high', tou: 'peak', day_type: 'all', block_min_kwh: null, block_max_kwh: null,
      unit: 'c_per_kWh', amount_excl_vat: '412.340000', vat_basis: 'stated_excl', source_document_id: 'd', source_locator: { page: 4 } }, new Map([['d', 'Eskom 2026/27']]))
    expect(c).toMatchObject({ id: 'c', amount: 412.34, sourceTitle: 'Eskom 2026/27', locator: { page: 4 } })
  })
  it('bill check row', () => {
    expect(billCheckFromRow({ id: 'b', billing_month: '2026-03-01', actual_total_excl_vat: '3000.00', modelled_total_excl_vat: '2900.00', difference_pct: '-3.333', created_at: 'T' }))
      .toEqual({ id: 'b', month: '2026-03', actual: 3000, modelled: 2900, differencePct: -3.333, createdAt: 'T' })
  })
  it('export rate row', () => {
    expect(exportRateFromRow({ id: 'r', season: 'all', tou: 'all', unit: 'c_per_kWh', amount_excl_vat: '95.500000', source_note: 'n' }))
      .toEqual({ id: 'r', season: 'all', tou: 'all', unit: 'c_per_kWh', amountExclVat: 95.5 })
  })
  it('TOU when the structure says so or any charge is period-specific', () => {
    expect(isTouTariff('tou', [])).toBe(true)
    expect(isTouTariff('flat', [{ tou: 'all' }])).toBe(false)
    expect(isTouTariff('flat', [{ tou: 'peak' }])).toBe(true)
  })
})
```

`effective-tariff.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { loadEffectiveTariff } from './effective-tariff'
import { fakeSupabase } from '@/test/fake-supabase'

const TARIFF = { id: 't1', tariff_year_id: 'y1', name: 'Commercial', structure: 'flat', category: 'commercial', metering: 'conventional',
  code: null, family: null, voltage_band: null, phase: null, transmission_zone: null, local_authority: false, min_amps: null, max_amps: null,
  min_kva: null, max_kva: null, is_legacy: false, notes: null, source_locator: {}, export_tariff_id: null }
const CHARGE = { id: 'c1', tariff_id: 't1', component: 'energy', season: 'all', tou: 'all', day_type: 'all', block_min_kwh: null, block_max_kwh: null,
  block_basis: null, unit: 'c_per_kWh', demand_basis: null, amount_excl_vat: '250', vat_rate: '0.15', vat_basis: 'stated_excl', unit_inferred: false,
  inference_reason: null, source_locator: {}, extraction_method: 'parser', reviewed_at: null }

describe('loadEffectiveTariff', () => {
  it('the published tariff when there is no override', async () => {
    const { client } = fakeSupabase({ tables: {
      'solar.studies': [{ id: 's1', project_id: 'p1', tariff_id: 't1', tariff_override_id: null, nmd_kva: '500', licensee_id: 'l1' }],
      'tariffs.tariff': [TARIFF], 'tariffs.charge': [CHARGE],
    } })
    const r = await loadEffectiveTariff(client as never, 'p1', '2026-03-01')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.tariff.charges[0].amountExclVat).toBe(250)
    expect(r.overrideId).toBeNull()
    expect(r.nmdKva).toBe(500)
    expect(r.highSeasonMonths).toBeNull()
  })
  it('the override rows when the study carries one', async () => {
    const { client } = fakeSupabase({ tables: {
      'solar.studies': [{ id: 's1', project_id: 'p1', tariff_id: 't1', tariff_override_id: 'o1', nmd_kva: null, licensee_id: 'l1' }],
      'tariffs.tariff': [TARIFF], 'tariffs.charge': [CHARGE],
      'solar.tariff_override_charges': [{ ...CHARGE, id: 'oc1', override_id: 'o1', base_charge_id: 'c1', amount_excl_vat: '199', reason: 'lease', edited_at: 'T', edited_by: 'u', updated_at: 'T' }],
    } })
    const r = await loadEffectiveTariff(client as never, 'p1', '2026-03-01')
    if ('error' in r) throw new Error(r.error)
    expect(r.tariff.charges[0].amountExclVat).toBe(199)
    expect(r.overrideId).toBe('o1')
  })
  it('names what is missing', async () => {
    expect(await loadEffectiveTariff(fakeSupabase({}).client as never, 'p1', '2026-03-01')).toEqual({ error: 'Save Site & Supply first.' })
    const { client } = fakeSupabase({ tables: { 'solar.studies': [{ id: 's1', project_id: 'p1', tariff_id: null }] } })
    expect(await loadEffectiveTariff(client as never, 'p1', '2026-03-01')).toEqual({ error: 'Choose a tariff first.' })
  })
})
```

`errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { humanSolarTariffError } from './errors'

describe('humanSolarTariffError', () => {
  it('maps the 00213 sentences', () => {
    expect(humanSolarTariffError({ code: '23514', message: 'solar.studies: only a published tariff can be pinned' })).toBe('That tariff is not published in the library.')
    expect(humanSolarTariffError({ code: '23514', message: 'solar.studies: the project override belongs to another study or tariff; revert it first' }))
      .toBe('Revert the project override before choosing another tariff.')
    expect(humanSolarTariffError({ code: '42501', message: 'solar.studies: the tariff, export rule and escalation need Edit + financials' }))
      .toBe('Choosing the tariff needs Edit + financials access.')
    expect(humanSolarTariffError({ code: '40001', message: 'stale' })).toBe('Someone else changed this — reload to see their version.')
    expect(humanSolarTariffError({ code: '23514', message: 'solar.tariff_override_charges: a changed rate needs a reason' })).toBe('Say why this rate differs from the published one.')
  })
})
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm --filter web exec vitest run src/lib/solar/tariff`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `rows.ts`**

```ts
/** PostgREST rows -> the JSON the Tariff tab renders (numbers arrive as strings). */
import type {
  ChargeComponent, SourceLocator, TariffCategory, TariffListItem, TariffMetering, TariffStructure, TariffUnit, TariffYearOption,
  TouCalendarRow, TouWindow, ExportRateRow,
} from '@esite/shared'

type Row = Record<string, unknown>
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export interface PinnedCharge {
  id: string
  component: ChargeComponent
  season: string
  tou: string
  dayType: string
  blockMin: number | null
  blockMax: number | null
  unit: TariffUnit
  amount: number
  vatBasis: string
  sourceDocumentId: string | null
  sourceTitle: string | null
  locator: SourceLocator
}

export interface BillCheckRow {
  id: string
  month: string
  actual: number
  modelled: number
  differencePct: number
  createdAt: string
}

export function tariffListItemFromRow(r: Row): TariffListItem {
  return {
    id: String(r.id), code: (r.code ?? null) as string | null, name: String(r.name), category: r.category as TariffCategory,
    metering: r.metering as TariffMetering, structure: r.structure as TariffStructure, voltageBand: (r.voltage_band ?? null) as string | null,
    phase: (r.phase ?? null) as 'single' | 'three' | null, minKva: num(r.min_kva), maxKva: num(r.max_kva),
    minAmps: num(r.min_amps), maxAmps: num(r.max_amps), isLegacy: Boolean(r.is_legacy), exportTariffId: (r.export_tariff_id ?? null) as string | null,
  }
}

export function yearOptionFromRow(r: Row): TariffYearOption {
  return {
    id: String(r.id), financialYear: String(r.financial_year), state: r.state as 'published' | 'superseded',
    effectiveFrom: String(r.effective_from), effectiveTo: String(r.effective_to), approvedIncreasePct: num(r.approved_increase_pct),
  }
}

export function pinnedChargeFromRow(r: Row, titles: ReadonlyMap<string, string>): PinnedCharge {
  const doc = (r.source_document_id ?? null) as string | null
  return {
    id: String(r.id), component: r.component as ChargeComponent, season: String(r.season), tou: String(r.tou), dayType: String(r.day_type),
    blockMin: num(r.block_min_kwh), blockMax: num(r.block_max_kwh), unit: r.unit as TariffUnit, amount: Number(r.amount_excl_vat),
    vatBasis: String(r.vat_basis), sourceDocumentId: doc, sourceTitle: doc ? titles.get(doc) ?? null : null,
    locator: (r.source_locator ?? {}) as SourceLocator,
  }
}

export function exportRateFromRow(r: Row): ExportRateRow & { id: string } {
  return {
    id: String(r.id), season: r.season as ExportRateRow['season'], tou: r.tou as ExportRateRow['tou'],
    unit: r.unit as ExportRateRow['unit'], amountExclVat: Number(r.amount_excl_vat),
  }
}

export function billCheckFromRow(r: Row): BillCheckRow {
  return {
    id: String(r.id), month: String(r.billing_month).slice(0, 7), actual: Number(r.actual_total_excl_vat),
    modelled: Number(r.modelled_total_excl_vat), differencePct: Number(r.difference_pct), createdAt: String(r.created_at),
  }
}

export function calendarRowFromDb(r: Row, holiday: 'saturday' | 'sunday' | null): TouCalendarRow {
  return {
    id: String(r.id), licenseeId: String(r.licensee_id), validFrom: String(r.valid_from), validTo: (r.valid_to ?? null) as string | null,
    highSeasonMonths: ((r.high_season_months ?? []) as number[]).map(Number), source: r.source as TouCalendarRow['source'], holidayTreatedAs: holiday,
  }
}

export function windowFromDb(r: Row): TouWindow {
  return {
    season: r.season as TouWindow['season'], dayType: r.day_type as TouWindow['dayType'],
    startMinute: Number(r.start_minute), endMinute: Number(r.end_minute), period: r.period as TouWindow['period'],
  }
}

export function isTouTariff(structure: string, charges: ReadonlyArray<{ tou: string }>): boolean {
  return structure === 'tou' || structure === 'tou_ibt' || charges.some((c) => c.tou !== 'all')
}
```

- [ ] **Step 4: Implement `calendar-loader.ts`**

```ts
import 'server-only'
/**
 * The TOU calendar a study uses: its licensee's calendar valid on the date,
 * else Eskom's hours flagged assumed_eskom (spec §5 "TOU hours notice").
 * Read through the caller's session (00209: readable by subscribed orgs).
 */
import { calendarFromRows, pickCalendar, resolveStudyCalendar, type TouCalendar } from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'
import { calendarRowFromDb, windowFromDb } from './rows'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

async function licenseeCalendar(supabase: AnyClient, licenseeId: string, onIso: string): Promise<TouCalendar | null> {
  const t = supabase.schema('tariffs')
  const { data } = await t.from('tou_calendar').select('id, licensee_id, valid_from, valid_to, high_season_months, source').eq('licensee_id', licenseeId)
  const row = pickCalendar(((data ?? []) as Row[]).map((r) => calendarRowFromDb(r, null)), onIso)
  if (!row) return null
  const [{ data: ws }, { data: hr }] = await Promise.all([
    t.from('tou_window').select('season, day_type, start_minute, end_minute, period').eq('calendar_id', row.id),
    t.from('holiday_rule').select('treated_as').eq('calendar_id', row.id).maybeSingle(),
  ])
  const holiday = ((hr as { treated_as?: 'saturday' | 'sunday' } | null)?.treated_as) ?? null
  return calendarFromRows({ ...row, holidayTreatedAs: holiday }, ((ws ?? []) as Row[]).map(windowFromDb))
}

export async function loadStudyCalendar(supabase: AnyClient, licenseeId: string | null, onIso: string) {
  const own = licenseeId ? await licenseeCalendar(supabase, licenseeId, onIso) : null
  let eskom: TouCalendar | null = null
  if (!own) {
    const { data } = await supabase.schema('tariffs').from('licensee').select('id').eq('kind', 'eskom').limit(1)
    const eskomId = ((data ?? []) as Row[])[0]?.id as string | undefined
    if (eskomId && eskomId !== licenseeId) eskom = await licenseeCalendar(supabase, eskomId, onIso)
  }
  return resolveStudyCalendar(own, eskom)
}
```

- [ ] **Step 5: Implement `effective-tariff.ts`**

```ts
import 'server-only'
/**
 * The tariff the engine costs for this study: the project override's rows
 * when there is one (D-10), else the pinned published tariff. Read through
 * the caller's session: the override is a money table (00213).
 */
import { overrideChargeFromDb, overrideToTariff, type Tariff } from '@esite/shared'
import { tariffFromRows } from '@esite/shared/tariffs/ingest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadStudyCalendar } from './calendar-loader'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export interface EffectiveTariff {
  studyId: string
  tariff: Tariff
  tariffId: string
  overrideId: string | null
  nmdKva: number | null
  highSeasonMonths: number[] | null
}

export async function loadEffectiveTariff(supabase: AnyClient, projectId: string, todayIso: string): Promise<EffectiveTariff | { error: string }> {
  const { data: s } = await supabase.schema('solar').from('studies')
    .select('id, tariff_id, tariff_override_id, nmd_kva, licensee_id').eq('project_id', projectId).maybeSingle()
  const study = s as Row | null
  if (!study) return { error: 'Save Site & Supply first.' }
  if (!study.tariff_id) return { error: 'Choose a tariff first.' }
  const t = supabase.schema('tariffs')
  const [{ data: tr }, { data: cs }] = await Promise.all([
    t.from('tariff').select('*').eq('id', String(study.tariff_id)).maybeSingle(),
    t.from('charge').select('*').eq('tariff_id', String(study.tariff_id)),
  ])
  if (!tr) return { error: 'The pinned tariff is no longer readable. Reload the page.' }
  let tariff = tariffFromRows(tr as Row, (cs ?? []) as Row[])
  const overrideId = (study.tariff_override_id ?? null) as string | null
  if (overrideId) {
    const { data: rows } = await supabase.schema('solar').from('tariff_override_charges').select('*').eq('override_id', overrideId)
    tariff = overrideToTariff(tariff, ((rows ?? []) as Row[]).map(overrideChargeFromDb))
  }
  const cal = await loadStudyCalendar(supabase, (study.licensee_id ?? null) as string | null, todayIso)
  return {
    studyId: String(study.id), tariff, tariffId: String(study.tariff_id), overrideId,
    nmdKva: study.nmd_kva === null || study.nmd_kva === undefined ? null : Number(study.nmd_kva),
    highSeasonMonths: cal.calendar?.highSeasonMonths ?? null,
  }
}
```

- [ ] **Step 6: Implement `errors.ts`**

```ts
/** 00213 errors on the Tariff tab -> sentences; falls back to 1c's humanSolarError. */
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'

export function humanSolarTariffError(err: { code?: string; message?: string } | null | undefined): string {
  const m = err?.message ?? ''
  if (m.includes('only a published tariff')) return 'That tariff is not published in the library.'
  if (m.includes('revert it first')) return 'Revert the project override before choosing another tariff.'
  if (m.includes('need Edit + financials')) return 'Choosing the tariff needs Edit + financials access.'
  if (m.includes('a changed rate needs a reason')) return 'Say why this rate differs from the published one.'
  if (m.includes('already has an override')) return 'This study already has a project override.'
  if (m.includes('pin a published tariff first')) return 'Choose a published tariff first.'
  if (err?.code === '40001') return STALE_MESSAGE
  return humanSolarError(err)
}
```

- [ ] **Step 7: Run them — expect PASS**

Run: `pnpm --filter web exec vitest run src/lib/solar/tariff`
Expected: PASS (6 + 3 + 1 tests). (`loadStudyCalendar` returns `{ calendar: null }` in the effective-tariff tests because the fake has no calendar rows — which is why `highSeasonMonths` is `null`.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/solar/tariff
git commit -m "feat(solar-tariff): tariff tab row mappers, calendar loader, effective tariff, error sentences

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 25: Tariff tab loader

**Files:**
- Create: `apps/web/src/lib/solar/tariff/load-tariff-tab.ts`
- Test: `apps/web/src/lib/solar/tariff/load-tariff-tab.test.ts`

No PostgREST embeds: plain queries only (so the fake can serve them and cross-schema embeds are never needed).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { loadTariffTab } from './load-tariff-tab'
import { fakeSupabase } from '@/test/fake-supabase'

const tables = {
  'solar.studies': [{ id: 's1', project_id: 'p1', organisation_id: 'org1', updated_at: 'T1', licensee_name: 'city of probe', licensee_id: null,
    nmd_kva: '500', supply_voltage_v: 400, tariff_id: null, tariff_override_id: null, export_rule: null, escalation: null }],
  'tariffs.licensee_alias': [{ alias: 'CITY OF PROBE', licensee_id: 'l1' }],
  'tariffs.licensee': [{ id: 'l1', name: 'City of Probe', kind: 'municipal' }],
  'tariffs.tariff_year': [
    { id: 'y25', licensee_id: 'l1', financial_year: '2025/26', state: 'published', effective_from: '2025-07-01', effective_to: '2026-06-30', approved_increase_pct: '12.72' },
    { id: 'y24', licensee_id: 'l1', financial_year: '2024/25', state: 'superseded', effective_from: '2024-07-01', effective_to: '2025-06-30', approved_increase_pct: null },
  ],
  'tariffs.tariff': [
    { id: 't1', tariff_year_id: 'y25', name: 'Commercial', code: null, category: 'commercial', metering: 'conventional', structure: 'flat', voltage_band: null, phase: null, min_kva: null, max_kva: '100', min_amps: null, max_amps: null, is_legacy: false, export_tariff_id: null },
    { id: 't2', tariff_year_id: 'y25', name: 'Bulk LV', code: null, category: 'bulk', metering: 'conventional', structure: 'tou', voltage_band: null, phase: null, min_kva: '100', max_kva: null, min_amps: null, max_amps: null, is_legacy: false, export_tariff_id: null },
  ],
}

describe('loadTariffTab', () => {
  it('resolves the licensee from the Site & Supply name through the alias, defaults the year covering today, lists its tariffs', async () => {
    const { client } = fakeSupabase({ tables })
    const d = await loadTariffTab(client as never, 'p1', { fy: null, todayIso: '2026-01-10' })
    expect(d.licensee).toEqual({ id: 'l1', name: 'City of Probe', kind: 'municipal' })
    expect(d.years.map((y) => y.financialYear)).toEqual(['2025/26', '2024/25'])
    expect(d.selectedYearId).toBe('y25')
    expect(d.yearNote).toBeNull()
    expect(d.tariffs.map((t) => t.id).sort()).toEqual(['t1', 't2'])
    expect(d.supply).toEqual({ nmdKva: 500, supplyVoltageV: 400 })
    expect(d.pinned).toBeNull()
  })
  it('the ?fy= choice wins; an unknown year falls back', async () => {
    const { client } = fakeSupabase({ tables })
    expect((await loadTariffTab(client as never, 'p1', { fy: '2024/25', todayIso: '2026-01-10' })).selectedYearId).toBe('y24')
    expect((await loadTariffTab(client as never, 'p1', { fy: '1999/00', todayIso: '2026-01-10' })).selectedYearId).toBe('y25')
  })
  it('no study: says so', async () => {
    const d = await loadTariffTab(fakeSupabase({}).client as never, 'p1', { fy: null, todayIso: '2026-01-10' })
    expect(d.study).toBeNull()
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter web exec vitest run src/lib/solar/tariff/load-tariff-tab.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import 'server-only'
/**
 * Everything the Tariff tab renders (spec §5), read through the caller's
 * session: the study, its licensee (studies.licensee_id, else the Site &
 * Supply name matched through tariffs.licensee_alias), the published years,
 * the selected year's tariffs, the pinned tariff and its charges, the
 * override, export rates, the TOU calendar, the escalation path, bill checks.
 */
import {
  buildEscalationRows, escalationSettingsFrom, overrideChargeFromDb, parseExportRule, parseStoredEscalation,
  pickDefaultYear, readSolarOrgSettings, regimeForLicenseeKind, netBillingRule,
  type EscalationRow, type ExportRule, type LicenseeKind, type OverrideChargeRow, type SsegRule, type SupplyFacts,
  type TariffListItem, type TariffYearOption, type TouCalendar, type ExportRateRow,
} from '@esite/shared'
import { normaliseAlias } from '@esite/shared/tariffs/ingest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadStudyCalendar } from './calendar-loader'
import {
  billCheckFromRow, exportRateFromRow, isTouTariff, pinnedChargeFromRow, tariffListItemFromRow, yearOptionFromRow,
  type BillCheckRow, type PinnedCharge,
} from './rows'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export interface PinnedTariff {
  id: string
  name: string
  code: string | null
  structure: string
  isTou: boolean
  yearId: string
  financialYear: string
  yearState: string
  charges: PinnedCharge[]
  exportTariff: { id: string; name: string; charges: PinnedCharge[] } | null
  /** The licensee's SSEG rule for the year, else the Net-Billing Rules default (flagged). */
  sseg: SsegRule
  ssegFromLibrary: boolean
  /** A newer published year exists for this licensee (the pinned one is superseded). */
  newerYear: string | null
}

export interface TariffTabData {
  projectId: string
  study: {
    id: string
    updatedAt: string
    licenseeName: string | null
    tariffId: string | null
    tariffOverrideId: string | null
    exportRule: ExportRule | null
  } | null
  supply: SupplyFacts
  licensee: { id: string; name: string; kind: LicenseeKind } | null
  licenseeOptions: Array<{ id: string; name: string }>
  years: TariffYearOption[]
  selectedYearId: string | null
  yearNote: string | null
  tariffs: TariffListItem[]
  pinned: PinnedTariff | null
  override: { id: string; rows: OverrideChargeRow[] } | null
  exportRates: Array<ExportRateRow & { id: string }>
  exportSourceNote: string | null
  calendar: TouCalendar | null
  calendarAssumedEskom: boolean
  calendarFromEskomFallback: boolean
  /** Public holidays this calendar year (projects.public_holidays, 00194). */
  holidays: Array<{ date: string; name: string }>
  escalation: EscalationRow[]
  analysisYears: number
  billChecks: BillCheckRow[]
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

async function chargesWithTitles(supabase: AnyClient, tariffId: string): Promise<PinnedCharge[]> {
  const t = supabase.schema('tariffs')
  const { data } = await t.from('charge').select('*').eq('tariff_id', tariffId)
  const rows = (data ?? []) as Row[]
  const docIds = [...new Set(rows.map((r) => r.source_document_id).filter((x): x is string => typeof x === 'string'))]
  const titles = new Map<string, string>()
  if (docIds.length) {
    const { data: docs } = await t.from('source_document').select('id, title').in('id', docIds)
    for (const d of (docs ?? []) as Array<{ id: string; title: string }>) titles.set(d.id, d.title)
  }
  return rows.map((r) => pinnedChargeFromRow(r, titles))
    .sort((a, b) => [a.component, a.season, a.tou, a.blockMin ?? -1].join('|').localeCompare([b.component, b.season, b.tou, b.blockMin ?? -1].join('|')))
}

export async function loadTariffTab(supabase: AnyClient, projectId: string, opts: { fy: string | null; todayIso: string }): Promise<TariffTabData> {
  const solar = supabase.schema('solar')
  const tariffs = supabase.schema('tariffs')
  const { data: s } = await solar.from('studies')
    .select('id, organisation_id, updated_at, licensee_name, licensee_id, nmd_kva, supply_voltage_v, tariff_id, tariff_override_id, export_rule, escalation')
    .eq('project_id', projectId).maybeSingle()
  const st = s as Row | null
  const empty: TariffTabData = {
    projectId, study: null, supply: { nmdKva: null, supplyVoltageV: null }, licensee: null, licenseeOptions: [], years: [],
    selectedYearId: null, yearNote: null, tariffs: [], pinned: null, override: null, exportRates: [], exportSourceNote: null,
    calendar: null, calendarAssumedEskom: false, calendarFromEskomFallback: false, holidays: [], escalation: [], analysisYears: 25, billChecks: [],
  }
  if (!st) return empty

  // Licensee: pinned, else the Site & Supply name through the alias table, else the exact name.
  let licenseeId = (st.licensee_id ?? null) as string | null
  const name = typeof st.licensee_name === 'string' ? st.licensee_name.trim() : ''
  if (!licenseeId && name) {
    const { data: a } = await tariffs.from('licensee_alias').select('licensee_id').eq('alias', normaliseAlias(name)).limit(1)
    licenseeId = ((a ?? []) as Row[])[0]?.licensee_id as string | undefined ?? null
    if (!licenseeId) {
      const { data: l } = await tariffs.from('licensee').select('id').eq('name', name).limit(1)
      licenseeId = ((l ?? []) as Row[])[0]?.id as string | undefined ?? null
    }
  }
  let licensee: TariffTabData['licensee'] = null
  let licenseeOptions: TariffTabData['licenseeOptions'] = []
  if (licenseeId) {
    const { data: l } = await tariffs.from('licensee').select('id, name, kind').eq('id', licenseeId).maybeSingle()
    licensee = l ? { id: String((l as Row).id), name: String((l as Row).name), kind: (l as Row).kind as LicenseeKind } : null
  }
  if (!licensee) {
    const { data: ls } = await tariffs.from('licensee').select('id, name').order('name')
    licenseeOptions = ((ls ?? []) as Array<{ id: string; name: string }>)
  }

  // Years (published + superseded only: drafts are admin-only by RLS anyway).
  const { data: ys } = licensee
    ? await tariffs.from('tariff_year').select('id, financial_year, state, effective_from, effective_to, approved_increase_pct')
        .eq('licensee_id', licensee.id).in('state', ['published', 'superseded']).order('financial_year', { ascending: false })
    : { data: [] as Row[] }
  const years = ((ys ?? []) as Row[]).map(yearOptionFromRow).sort((a, b) => b.financialYear.localeCompare(a.financialYear))

  // Pinned tariff.
  let pinned: PinnedTariff | null = null
  const tariffId = (st.tariff_id ?? null) as string | null
  if (tariffId) {
    const { data: tr } = await tariffs.from('tariff').select('*').eq('id', tariffId).maybeSingle()
    const trow = tr as Row | null
    if (trow) {
      const { data: yr } = await tariffs.from('tariff_year').select('id, financial_year, state, licensee_id').eq('id', String(trow.tariff_year_id)).maybeSingle()
      const yrow = (yr ?? {}) as Row
      const charges = await chargesWithTitles(supabase, tariffId)
      let exportTariff: PinnedTariff['exportTariff'] = null
      if (trow.export_tariff_id) {
        const { data: et } = await tariffs.from('tariff').select('id, name').eq('id', String(trow.export_tariff_id)).maybeSingle()
        if (et) exportTariff = { id: String((et as Row).id), name: String((et as Row).name), charges: await chargesWithTitles(supabase, String((et as Row).id)) }
      }
      const { data: rule } = await tariffs.from('sseg_rule').select('*').eq('tariff_year_id', String(trow.tariff_year_id)).maybeSingle()
      const r = rule as Row | null
      const regime = regimeForLicenseeKind(licensee?.kind ?? 'municipal')
      const sseg: SsegRule = r
        ? {
            crediting: r.crediting as SsegRule['crediting'], carryForward: r.carry_forward as SsegRule['carryForward'],
            fyEndMonth: Number(r.fy_end_month), capRule: r.cap_rule as SsegRule['capRule'], offsets: 'energy_only',
            forfeitOnOwnershipChange: Boolean(r.forfeit_on_ownership_change), maxKva: Number(r.max_kva),
            requiresTou: Boolean(r.requires_tou), requiresBidirectionalMeter: Boolean(r.requires_bidirectional_meter),
            locator: (r.locator ?? {}) as Record<string, string>,
          }
        : netBillingRule(regime)
      const newer = years.find((y) => y.state === 'published' && y.financialYear > String(yrow.financial_year ?? ''))
      pinned = {
        id: tariffId, name: String(trow.name), code: (trow.code ?? null) as string | null, structure: String(trow.structure),
        isTou: isTouTariff(String(trow.structure), charges), yearId: String(trow.tariff_year_id),
        financialYear: String(yrow.financial_year ?? ''), yearState: String(yrow.state ?? ''), charges, exportTariff,
        sseg, ssegFromLibrary: Boolean(r), newerYear: newer?.financialYear ?? null,
      }
    }
  }

  // Selected year: ?fy=, else the pinned tariff's year, else the year covering today.
  const regime = regimeForLicenseeKind(licensee?.kind ?? 'municipal')
  const fromFy = opts.fy ? years.find((y) => y.financialYear === opts.fy) : undefined
  const fromPin = pinned ? years.find((y) => y.id === pinned!.yearId) : undefined
  const def = pickDefaultYear(years, opts.todayIso, regime)
  const selectedYearId = fromFy?.id ?? fromPin?.id ?? def.yearId
  const { data: ts } = selectedYearId
    ? await tariffs.from('tariff').select('id, code, name, category, metering, structure, voltage_band, phase, min_kva, max_kva, min_amps, max_amps, is_legacy, export_tariff_id')
        .eq('tariff_year_id', selectedYearId).order('name')
    : { data: [] as Row[] }

  // Override, export rates, bill checks (money tables: this page is Edit + financials).
  const overrideId = (st.tariff_override_id ?? null) as string | null
  const [ov, rates, checks, settingsRow] = await Promise.all([
    overrideId ? solar.from('tariff_override_charges').select('*').eq('override_id', overrideId).order('component') : Promise.resolve({ data: [] as Row[] }),
    solar.from('study_export_rates').select('*').eq('study_id', String(st.id)),
    solar.from('bill_checks').select('id, billing_month, actual_total_excl_vat, modelled_total_excl_vat, difference_pct, created_at')
      .eq('study_id', String(st.id)).order('billing_month', { ascending: false }).limit(12),
    solar.from('org_settings').select('settings').eq('organisation_id', String(st.organisation_id)).maybeSingle(),
  ])
  const rateRows = (rates.data ?? []) as Row[]

  const cal = await loadStudyCalendar(supabase, licensee?.id ?? null, opts.todayIso)
  const year = opts.todayIso.slice(0, 4)
  const { data: hol } = await supabase.schema('projects').from('public_holidays').select('d, name').gte('d', `${year}-01-01`).order('d')
  const holidays = ((hol ?? []) as Array<{ d: string; name: string }>)
    .filter((h) => h.d <= `${year}-12-31`).map((h) => ({ date: h.d, name: h.name }))
  const settings = escalationSettingsFrom(readSolarOrgSettings((settingsRow.data as { settings?: unknown } | null)?.settings ?? null))
  const escalation = buildEscalationRows({
    pinnedFinancialYear: pinned?.financialYear || null,
    published: years.map((y) => ({ financialYear: y.financialYear, approvedIncreasePct: y.approvedIncreasePct })),
    settings, stored: parseStoredEscalation(st.escalation),
  })

  return {
    projectId,
    study: {
      id: String(st.id), updatedAt: String(st.updated_at), licenseeName: name || null, tariffId,
      tariffOverrideId: overrideId, exportRule: parseExportRule(st.export_rule),
    },
    supply: { nmdKva: num(st.nmd_kva), supplyVoltageV: num(st.supply_voltage_v) },
    licensee, licenseeOptions, years, selectedYearId,
    yearNote: fromFy || fromPin ? null : def.note,
    tariffs: ((ts ?? []) as Row[]).map(tariffListItemFromRow),
    pinned,
    override: overrideId ? { id: overrideId, rows: ((ov.data ?? []) as Row[]).map(overrideChargeFromDb) } : null,
    exportRates: rateRows.map(exportRateFromRow),
    exportSourceNote: (rateRows[0]?.source_note as string | undefined) ?? null,
    calendar: cal.calendar, calendarAssumedEskom: cal.assumedEskom, calendarFromEskomFallback: cal.fromEskomFallback,
    holidays, escalation, analysisYears: settings.analysisYears,
    billChecks: ((checks.data ?? []) as Row[]).map(billCheckFromRow),
  }
}
```

⚠ `readSolarOrgSettings` is 1c's (`packages/shared/src/solar/org-settings.ts`) and accepts the stored JSON (`{ version, values }`) or `null`.

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter web exec vitest run src/lib/solar/tariff/load-tariff-tab.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/solar/tariff/load-tariff-tab.ts apps/web/src/lib/solar/tariff/load-tariff-tab.test.ts
git commit -m "feat(solar-tariff): tariff tab loader (licensee via alias, default year, pinned tariff, money rows)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 26: Tariff tab actions

**Files:**
- Create: `apps/web/src/actions/solar-tariff.actions.ts`
- Test: `apps/web/src/actions/solar-tariff.actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  createClient: vi.fn(), svc: vi.fn(), requireSolarLevel: vi.fn(), audit: vi.fn(async () => {}), revalidate: vi.fn(), effective: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient, createServiceClient: h.svc }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/audit', () => ({ recordSolarAudit: h.audit }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidate }))
vi.mock('@/lib/solar/tariff/effective-tariff', () => ({ loadEffectiveTariff: h.effective }))

import {
  selectSolarTariffAction, saveSolarExportRuleAction, createSolarTariffOverrideAction, revertSolarTariffOverrideAction,
  editSolarOverrideChargeAction, recordSolarBillCheckAction, reportTariffErrorAction, saveSolarEscalationAction,
} from './solar-tariff.actions'
import { fakeSupabase, callsTo, type FakeOptions } from '@/test/fake-supabase'
import { EMPTY_BILL_CHECK_FORM, makeCharge, makeTariff } from '@esite/shared'

const P = 'p1'
const T = '22222222-2222-2222-2222-222222222222'
const STALE = 'Someone else changed this — reload to see their version.'

function setup(o: FakeOptions = {}, rpc?: ReturnType<typeof vi.fn>) {
  const fake = fakeSupabase({ userId: 'u1', ...o })
  const client = rpc ? { ...fake.client, schema: (s: string) => ({ ...fake.client.schema(s), rpc }) } : fake.client
  h.createClient.mockResolvedValue(client)
  return fake
}

beforeEach(() => { vi.clearAllMocks(); h.requireSolarLevel.mockResolvedValue('edit_financials') })

describe('solar tariff actions', () => {
  it('every action demands Edit + financials (the gate redirects lower levels)', async () => {
    setup()
    h.requireSolarLevel.mockRejectedValue(new Error('REDIRECT:/projects/p1/solar/locked'))
    await expect(selectSolarTariffAction({ projectId: P, tariffId: T, expectedUpdatedAt: 'T1' })).rejects.toThrow('REDIRECT')
    await expect(reportTariffErrorAction({ projectId: P, tariffId: T, note: 'x' })).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith(P, 'edit_financials', expect.anything())
  })

  it('select: conditioned on updated_at; 0 rows is stale; audit carries the id only', async () => {
    const f = setup({ writes: { 'solar.studies:update': { data: [{ updated_at: 'T2' }] } } })
    expect(await selectSolarTariffAction({ projectId: P, tariffId: T, expectedUpdatedAt: 'T1' })).toEqual({ ok: true, updatedAt: 'T2' })
    expect(callsTo(f.calls, 'solar.studies', 'update')[0]).toMatchObject({ payload: { tariff_id: T }, filters: [['eq', 'project_id', P], ['eq', 'updated_at', 'T1']] })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'tariff_selected', objectRef: { tariffId: T } })
    setup({ writes: { 'solar.studies:update': { data: [] } } })
    expect(await selectSolarTariffAction({ projectId: P, tariffId: T, expectedUpdatedAt: 'T1' })).toEqual({ error: STALE })
  })

  it('select: a draft or overridden pin is refused with the database sentence mapped', async () => {
    setup({ writes: { 'solar.studies:update': { error: { code: '23514', message: 'solar.studies: the project override belongs to another study or tariff; revert it first' } } } })
    expect(await selectSolarTariffAction({ projectId: P, tariffId: T, expectedUpdatedAt: 'T1' }))
      .toEqual({ error: 'Revert the project override before choosing another tariff.' })
  })

  it('export rule manual: note mandatory; rates replaced; the rule saved last and conditioned', async () => {
    const tables = { 'solar.studies': [{ id: 's1', project_id: P, tariff_id: T, updated_at: 'T1' }], 'tariffs.tariff': [{ id: T, export_tariff_id: null }] }
    setup({ tables })
    expect(await saveSolarExportRuleAction({ projectId: P, expectedUpdatedAt: 'T1',
      form: { method: 'manual', sourceNote: '', rates: [{ season: 'all', tou: 'all', unit: 'c_per_kWh', amount: '95' }] } }))
      .toEqual({ fieldErrors: { sourceNote: 'Say where this rate comes from (document and page)' } })
    const f = setup({ tables, writes: { 'solar.studies:update': { data: [{ updated_at: 'T2' }] } } })
    expect(await saveSolarExportRuleAction({ projectId: P, expectedUpdatedAt: 'T1',
      form: { method: 'manual', sourceNote: 'Tshwane SSEG 2026/27 p4', rates: [{ season: 'all', tou: 'all', unit: 'c_per_kWh', amount: '95' }] } }))
      .toEqual({ ok: true, updatedAt: 'T2' })
    const writes = f.calls.filter((c) => c.op !== 'select').map((c) => `${c.table}:${c.op}`)
    expect(writes).toEqual(['solar.study_export_rates:delete', 'solar.study_export_rates:insert', 'solar.studies:update'])
    expect(callsTo(f.calls, 'solar.study_export_rates', 'insert')[0].payload).toEqual([
      { study_id: 's1', season: 'all', tou: 'all', unit: 'c_per_kWh', amount_excl_vat: 95, source_note: 'Tshwane SSEG 2026/27 p4' },
    ])
  })

  it('export rule: a stale study is refused before anything is written', async () => {
    const f = setup({ tables: { 'solar.studies': [{ id: 's1', project_id: P, tariff_id: T, updated_at: 'T9' }], 'tariffs.tariff': [{ id: T, export_tariff_id: null }] } })
    expect(await saveSolarExportRuleAction({ projectId: P, expectedUpdatedAt: 'T1', form: { method: 'none', sourceNote: '', rates: [] } })).toEqual({ error: STALE })
    expect(f.calls.filter((c) => c.op !== 'select')).toHaveLength(0)
  })

  it('override create / revert go through the SQL functions with the expected timestamp', async () => {
    const rpc = vi.fn(async () => ({ data: 'o1', error: null }))
    setup({}, rpc)
    expect(await createSolarTariffOverrideAction({ projectId: P, expectedUpdatedAt: 'T1' })).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('create_tariff_override', { p_project_id: P, p_expected_updated_at: 'T1' })
    const stale = vi.fn(async () => ({ data: null, error: { code: '40001', message: 'solar.revert_tariff_override: stale' } }))
    setup({}, stale)
    expect(await revertSolarTariffOverrideAction({ projectId: P, expectedUpdatedAt: 'T1' })).toEqual({ error: STALE })
  })

  it('override row edit needs a reason and is conditioned on the row updated_at', async () => {
    const tables = { 'solar.tariff_override_charges': [{ id: 'oc1', project_id: P, component: 'energy', season: 'all' }] }
    setup({ tables })
    expect(await editSolarOverrideChargeAction({ projectId: P, chargeId: 'oc1', expectedUpdatedAt: 'R1', form: { amount: '199', unit: 'c_per_kWh', reason: '' } }))
      .toEqual({ fieldErrors: { reason: 'Say why this rate differs from the published one' } })
    const f = setup({ tables, writes: { 'solar.tariff_override_charges:update': { data: [{ id: 'oc1' }] } } })
    expect(await editSolarOverrideChargeAction({ projectId: P, chargeId: 'oc1', expectedUpdatedAt: 'R1', form: { amount: '199', unit: 'c_per_kWh', reason: 'Lease cl. 14' } }))
      .toEqual({ ok: true })
    expect(callsTo(f.calls, 'solar.tariff_override_charges', 'update')[0]).toMatchObject({
      payload: { amount_excl_vat: 199, unit: 'c_per_kWh', reason: 'Lease cl. 14' },
      filters: [['eq', 'id', 'oc1'], ['eq', 'project_id', P], ['eq', 'updated_at', 'R1']],
    })
  })

  it('bill check: models the month with the effective tariff and stores the record', async () => {
    const f = setup({ writes: { 'solar.bill_checks:insert': { data: [{ id: 'b1' }] } } })
    h.effective.mockResolvedValue({ studyId: 's1', tariffId: T, overrideId: null, nmdKva: null, highSeasonMonths: null,
      tariff: makeTariff({ name: 'Flat', structure: 'flat', charges: [
        makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 250 }), makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 400 }),
      ] }) })
    const r = await recordSolarBillCheckAction({ projectId: P, form: { ...EMPTY_BILL_CHECK_FORM, month: '2026-03', totalKwh: '1000', actualTotal: '2700' } })
    expect(r).toMatchObject({ ok: true, result: { modelled: 2900, actual: 2700, differencePct: 7.407, warn: true } })
    expect(callsTo(f.calls, 'solar.bill_checks', 'insert')[0].payload).toMatchObject({
      study_id: 's1', billing_month: '2026-03-01', tariff_id: T, tariff_override_id: null, import_kwh_standard: 1000,
      actual_total_excl_vat: 2700, modelled_total_excl_vat: 2900, difference_pct: 7.407,
    })
    expect(h.audit).toHaveBeenCalledWith({ projectId: P, actorId: 'u1', verb: 'bill_check_recorded', objectRef: { billingMonth: '2026-03' } })
  })

  it('report a tariff error: note required; inserted through the caller session', async () => {
    const f = setup({ writes: { 'tariffs.error_report:insert': { data: [{ id: 'r1' }] } } })
    expect(await reportTariffErrorAction({ projectId: P, tariffId: T, note: '  ' })).toEqual({ error: 'Describe what looks wrong.' })
    expect(await reportTariffErrorAction({ projectId: P, tariffId: T, note: 'Basic charge is last year\'s' })).toEqual({ ok: true })
    expect(callsTo(f.calls, 'tariffs.error_report', 'insert')[0].payload).toEqual({ tariff_id: T, project_id: P, note: 'Basic charge is last year\'s' })
  })

  it('escalation: overrides validated against the org analysis period; empty form clears to defaults', async () => {
    const tables = { 'solar.studies': [{ id: 's1', project_id: P, organisation_id: 'org1', updated_at: 'T1' }], 'solar.org_settings': [] }
    setup({ tables })
    expect(await saveSolarEscalationAction({ projectId: P, expectedUpdatedAt: 'T1', form: { '2': 'abc' } })).toEqual({ fieldErrors: { '2': 'Enter a percentage' } })
    const f = setup({ tables, writes: { 'solar.studies:update': { data: [{ updated_at: 'T2' }] } } })
    expect(await saveSolarEscalationAction({ projectId: P, expectedUpdatedAt: 'T1', form: { '2': '' } })).toEqual({ ok: true, updatedAt: 'T2' })
    expect(callsTo(f.calls, 'solar.studies', 'update')[0].payload).toEqual({ escalation: null })
  })
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter web exec vitest run src/actions/solar-tariff.actions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
'use server'
/**
 * Tariff tab actions (spec §5). Every action re-checks Edit + financials
 * (requireSolarLevel redirects lower levels) and writes through the caller's
 * session so 00213 decides (studies_tariff_guard; money tables' RESTRICTIVE
 * gates; override functions are SECURITY INVOKER). Saves carry
 * expectedUpdatedAt. Audit rows carry ids, never rand amounts.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BILL_ENGINE_VERSION, BillCheckError, escalationSettingsFrom, readSolarOrgSettings, roundCents, runBillCheck,
  validateBillCheckForm, validateEscalationOverrides, validateExportRuleForm, validateOverrideEdit,
  type BillCheckField, type BillCheckForm, type ChargeComponent, type ExportRuleForm, type OverrideEditForm, type TariffSeason,
} from '@esite/shared'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { humanSolarTariffError } from '@/lib/solar/tariff/errors'
import { loadEffectiveTariff } from '@/lib/solar/tariff/effective-tariff'
import { isTouTariff } from '@/lib/solar/tariff/rows'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function gate(projectId: string): Promise<{ supabase: AnyClient; userId: string } | { error: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit_financials', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  return { supabase, userId: user.id }
}

function refresh(projectId: string): void {
  revalidatePath(`/projects/${projectId}/solar`, 'layout')
}

async function updateStudy(supabase: AnyClient, projectId: string, expectedUpdatedAt: string, patch: Row):
  Promise<{ ok: true; updatedAt: string } | { error: string }> {
  const { data, error } = await supabase.schema('solar').from('studies').update(patch)
    .eq('project_id', projectId).eq('updated_at', expectedUpdatedAt).select('updated_at')
  if (error) return { error: humanSolarTariffError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  return { ok: true, updatedAt: String((data[0] as Row).updated_at ?? '') }
}

// ── Licensee link (when the Site & Supply name matches nothing in the library)
export async function setStudyLicenseeAction(input: { projectId: string; licenseeId: string; expectedUpdatedAt: string }) {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  if (!UUID.test(input.licenseeId)) return { error: 'Choose a supply authority from the library.' }
  const r = await updateStudy(g.supabase, input.projectId, input.expectedUpdatedAt, { licensee_id: input.licenseeId })
  if ('error' in r) return r
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'tariff_licensee_linked', objectRef: { licenseeId: input.licenseeId } })
  refresh(input.projectId)
  return r
}

// ── Tariff pin ──────────────────────────────────────────────────────────────
export async function selectSolarTariffAction(input: { projectId: string; tariffId: string; expectedUpdatedAt: string }) {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  if (!UUID.test(input.tariffId)) return { error: 'Choose a tariff.' }
  const r = await updateStudy(g.supabase, input.projectId, input.expectedUpdatedAt, { tariff_id: input.tariffId })
  if ('error' in r) return r
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'tariff_selected', objectRef: { tariffId: input.tariffId } })
  refresh(input.projectId)
  return r
}

// ── Export / SSEG rule ──────────────────────────────────────────────────────
export async function saveSolarExportRuleAction(input: { projectId: string; form: ExportRuleForm; expectedUpdatedAt: string }):
  Promise<{ ok: true; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const solar = g.supabase.schema('solar')
  const { data: s } = await solar.from('studies').select('id, tariff_id, updated_at').eq('project_id', input.projectId).maybeSingle()
  const study = s as Row | null
  if (!study) return { error: 'Save Site & Supply first.' }
  if (String(study.updated_at) !== input.expectedUpdatedAt) return { error: STALE_MESSAGE }
  // The linked method is decided from the pinned tariff, never from the client.
  let hasLinked = false
  if (study.tariff_id) {
    const { data: t } = await g.supabase.schema('tariffs').from('tariff').select('export_tariff_id').eq('id', String(study.tariff_id)).maybeSingle()
    hasLinked = Boolean((t as Row | null)?.export_tariff_id)
  }
  const v = validateExportRuleForm(input.form, hasLinked)
  if ('errors' in v) return { fieldErrors: v.errors }
  const del = await solar.from('study_export_rates').delete().eq('study_id', String(study.id))
  if (del.error) return { error: humanSolarTariffError(del.error) }
  if (v.rates.length > 0) {
    const ins = await solar.from('study_export_rates').insert(v.rates.map((r) => ({
      study_id: String(study.id), season: r.season, tou: r.tou, unit: r.unit, amount_excl_vat: r.amountExclVat, source_note: v.rule.sourceNote,
    })))
    if (ins.error) return { error: humanSolarTariffError(ins.error) }
  }
  const r = await updateStudy(g.supabase, input.projectId, input.expectedUpdatedAt, { export_rule: v.rule })
  if ('error' in r) return r
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'export_rule_saved', objectRef: { method: v.rule.method } })
  refresh(input.projectId)
  return r
}

// ── Escalation path (D-07) ──────────────────────────────────────────────────
export async function saveSolarEscalationAction(input: { projectId: string; form: Record<string, string>; expectedUpdatedAt: string }):
  Promise<{ ok: true; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const { data: s } = await g.supabase.schema('solar').from('studies').select('organisation_id').eq('project_id', input.projectId).maybeSingle()
  const orgId = (s as Row | null)?.organisation_id
  if (!orgId) return { error: 'Save Site & Supply first.' }
  const { data: os } = await g.supabase.schema('solar').from('org_settings').select('settings').eq('organisation_id', String(orgId)).maybeSingle()
  const years = escalationSettingsFrom(readSolarOrgSettings((os as { settings?: unknown } | null)?.settings ?? null)).analysisYears
  const v = validateEscalationOverrides(input.form ?? {}, years)
  if (Object.keys(v.errors).length > 0) return { fieldErrors: v.errors }
  const escalation = Object.keys(v.overrides).length > 0 ? { version: 1, overrides: v.overrides } : null
  const r = await updateStudy(g.supabase, input.projectId, input.expectedUpdatedAt, { escalation })
  if ('error' in r) return r
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'escalation_saved', objectRef: { years: Object.keys(v.overrides).length } })
  refresh(input.projectId)
  return r
}

// ── Project override (D-10) ─────────────────────────────────────────────────
export async function createSolarTariffOverrideAction(input: { projectId: string; expectedUpdatedAt: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').rpc('create_tariff_override', {
    p_project_id: input.projectId, p_expected_updated_at: input.expectedUpdatedAt,
  })
  if (error) return { error: humanSolarTariffError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'tariff_override_created' })
  refresh(input.projectId)
  return { ok: true }
}

export async function revertSolarTariffOverrideAction(input: { projectId: string; expectedUpdatedAt: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').rpc('revert_tariff_override', {
    p_project_id: input.projectId, p_expected_updated_at: input.expectedUpdatedAt,
  })
  if (error) return { error: humanSolarTariffError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'tariff_override_reverted' })
  refresh(input.projectId)
  return { ok: true }
}

export async function editSolarOverrideChargeAction(input: { projectId: string; chargeId: string; form: OverrideEditForm; expectedUpdatedAt: string }):
  Promise<{ ok: true } | { error: string } | { fieldErrors: Partial<Record<'amount' | 'unit' | 'reason', string>> }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const t = g.supabase.schema('solar').from('tariff_override_charges')
  const { data: row } = await t.select('id, component, season').eq('id', input.chargeId).eq('project_id', input.projectId).maybeSingle()
  const c = row as { component: ChargeComponent; season: TariffSeason } | null
  if (!c) return { error: 'That rate no longer exists. Reload the page.' }
  const v = validateOverrideEdit({ component: c.component, season: c.season }, input.form)
  if ('errors' in v) return { fieldErrors: v.errors }
  const { data, error } = await g.supabase.schema('solar').from('tariff_override_charges')
    .update({ amount_excl_vat: v.amountExclVat, unit: v.unit, reason: v.reason })
    .eq('id', input.chargeId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('id')
  if (error) return { error: humanSolarTariffError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'tariff_override_row_edited', objectRef: { chargeId: input.chargeId } })
  refresh(input.projectId)
  return { ok: true }
}

// ── Bill check ──────────────────────────────────────────────────────────────
export interface BillCheckOutcome {
  modelled: number
  actual: number
  differencePct: number
  warn: boolean
  notModelled: string[]
}

export async function recordSolarBillCheckAction(input: { projectId: string; form: BillCheckForm }):
  Promise<{ ok: true; result: BillCheckOutcome } | { error: string } | { fieldErrors: Partial<Record<BillCheckField, string>> }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const eff = await loadEffectiveTariff(g.supabase, input.projectId, new Date().toISOString().slice(0, 10))
  if ('error' in eff) return eff
  const v = validateBillCheckForm(input.form, isTouTariff(eff.tariff.structure, eff.tariff.charges))
  if ('errors' in v) return { fieldErrors: v.errors }
  let res
  try {
    res = runBillCheck(eff.tariff, v.input, { highSeasonMonths: eff.highSeasonMonths, nmdKva: eff.nmdKva })
  } catch (e) {
    if (e instanceof BillCheckError) return { error: e.message }
    console.error('[solar-bill-check] engine failed', { projectId: input.projectId, err: String(e) })
    return { error: 'The bill could not be modelled. Report it as a tariff error.' }
  }
  const month = `${v.input.year}-${String(v.input.month).padStart(2, '0')}`
  const { error } = await g.supabase.schema('solar').from('bill_checks').insert({
    study_id: eff.studyId, billing_month: `${month}-01`, tariff_id: eff.tariffId, tariff_override_id: eff.overrideId,
    import_kwh_peak: v.input.importKwh.peak, import_kwh_standard: v.input.importKwh.standard, import_kwh_off_peak: v.input.importKwh.off_peak,
    max_demand_kva: v.input.maxDemandKva, actual_total_excl_vat: v.input.actualTotalExclVat,
    modelled_total_excl_vat: res.modelledTotalExclVat, difference_pct: res.differencePct,
    modelled: {
      season: res.season,
      lines: res.lines.map((l) => ({ label: l.label, quantity: l.quantity, quantityUnit: l.quantityUnit, rate: l.rate, rateUnit: l.rateUnit, amount: roundCents(l.amount) })),
      notModelled: res.notModelled,
    },
    engine_version: BILL_ENGINE_VERSION, note: v.input.note,
  })
  if (error) return { error: humanSolarTariffError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'bill_check_recorded', objectRef: { billingMonth: month } })
  refresh(input.projectId)
  return {
    ok: true,
    result: {
      modelled: res.modelledTotalExclVat, actual: v.input.actualTotalExclVat, differencePct: res.differencePct, warn: res.warn,
      notModelled: res.notModelled.map((n) => n.reason),
    },
  }
}

export async function deleteSolarBillCheckAction(input: { projectId: string; id: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').from('bill_checks').delete().eq('id', input.id).eq('project_id', input.projectId)
  if (error) return { error: humanSolarTariffError(error) }
  refresh(input.projectId)
  return { ok: true }
}

// ── Report a tariff error (index D2b-3: a platform queue, not a work item) ──
export async function reportTariffErrorAction(input: { projectId: string; tariffId: string; note: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const note = String(input.note ?? '').trim()
  if (!note) return { error: 'Describe what looks wrong.' }
  if (note.length > 2000) return { error: 'Keep the note under 2000 characters.' }
  if (!UUID.test(input.tariffId)) return { error: 'Choose a tariff first.' }
  const { error } = await g.supabase.schema('tariffs').from('error_report').insert({ tariff_id: input.tariffId, project_id: input.projectId, note })
  if (error) return { error: humanSolarTariffError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'tariff_error_reported', objectRef: { tariffId: input.tariffId } })
  return { ok: true }
}

// ── View source (a signed URL minted after the gate) ────────────────────────
export async function getSolarTariffSourceUrlAction(input: { projectId: string; sourceDocumentId: string }):
  Promise<{ url: string; kind: 'pdf' | 'xlsx' | 'link' } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  // Read through the caller's session: 00209 lets subscribed orgs read source documents.
  const { data } = await g.supabase.schema('tariffs').from('source_document').select('storage_path, url').eq('id', input.sourceDocumentId).maybeSingle()
  const doc = data as { storage_path: string | null; url: string | null } | null
  if (!doc) return { error: 'That source document is not available.' }
  if (doc.storage_path) {
    const svc = createServiceClient() as unknown as AnyClient
    const { data: s, error } = await svc.storage.from('tariff-sources').createSignedUrl(doc.storage_path, 600)
    if (error || !s) return { error: 'Could not open the source document. Try again.' }
    return { url: s.signedUrl, kind: doc.storage_path.toLowerCase().endsWith('.pdf') ? 'pdf' : 'xlsx' }
  }
  if (doc.url) return { url: doc.url, kind: 'link' }
  return { error: 'This source has no stored file or link.' }
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter web exec vitest run src/actions/solar-tariff.actions.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/actions/solar-tariff.actions.ts apps/web/src/actions/solar-tariff.actions.test.ts
git commit -m "feat(solar-tariff): tariff tab actions (pin, export rule, escalation, override, bill check, report, source)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 27: Tariff picker and charges table

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/tariff/TariffPicker.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/tariff/ChargesTable.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/tariff/TariffPicker.test.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/tariff/ChargesTable.test.tsx`

- [ ] **Step 1: Write the failing tests**

`TariffPicker.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ select: vi.fn(), refresh: vi.fn(), push: vi.fn() }))
vi.mock('@/actions/solar-tariff.actions', () => ({ selectSolarTariffAction: h.select }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: h.push }), usePathname: () => '/projects/p1/solar/tariff' }))

import { TariffPicker } from './TariffPicker'
import type { TariffListItem } from '@esite/shared'

const t = (p: Partial<TariffListItem>): TariffListItem => ({ id: 'x', code: null, name: 'T', category: 'commercial', metering: 'conventional', structure: 'flat',
  voltageBand: null, phase: null, minKva: null, maxKva: null, minAmps: null, maxAmps: null, isLegacy: false, exportTariffId: null, ...p })
const tariffs = [t({ id: '11111111-1111-1111-1111-111111111111', name: 'Commercial' }), t({ id: '22222222-2222-2222-2222-222222222222', name: 'Megaflex', category: 'industrial', minKva: 1000 })]
const years = [{ id: 'y25', financialYear: '2025/26', state: 'published' as const, effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30', approvedIncreasePct: null },
  { id: 'y24', financialYear: '2024/25', state: 'superseded' as const, effectiveFrom: '2024-07-01', effectiveTo: '2025-06-30', approvedIncreasePct: null }]

beforeEach(() => { vi.clearAllMocks(); h.select.mockResolvedValue({ ok: true, updatedAt: 'T2' }) })

describe('TariffPicker', () => {
  it('lists only eligible tariffs; Show all reveals the rest with the reason', async () => {
    const user = userEvent.setup()
    render(<TariffPicker projectId="p1" years={years} selectedYearId="y25" yearNote={null} tariffs={tariffs} supply={{ nmdKva: 500, supplyVoltageV: 400 }} pinnedTariffId={null} lockedReason={null} updatedAt="T1" />)
    expect(screen.getByRole('radio', { name: /Commercial/ })).toBeDefined()
    expect(screen.queryByRole('radio', { name: /Megaflex/ })).toBeNull()
    expect(screen.getByText('1 more not eligible for this supply')).toBeDefined()
    await user.click(screen.getByLabelText('Show all'))
    expect(screen.getByText('NMD 500 kVA is below the 1000 kVA minimum')).toBeDefined()
  })
  it('choosing a tariff saves with the loaded timestamp', async () => {
    const user = userEvent.setup()
    render(<TariffPicker projectId="p1" years={years} selectedYearId="y25" yearNote={null} tariffs={tariffs} supply={{ nmdKva: 500, supplyVoltageV: 400 }} pinnedTariffId={null} lockedReason={null} updatedAt="T1" />)
    await user.click(screen.getByRole('radio', { name: /Commercial/ }))
    expect(h.select).toHaveBeenCalledWith({ projectId: 'p1', tariffId: '11111111-1111-1111-1111-111111111111', expectedUpdatedAt: 'T1' })
    expect(h.refresh).toHaveBeenCalled()
  })
  it('labels superseded years and moves between years by URL', async () => {
    const user = userEvent.setup()
    render(<TariffPicker projectId="p1" years={years} selectedYearId="y25" yearNote="2026/27 not yet published in the library — using 2025/26 with escalation" tariffs={tariffs} supply={{ nmdKva: null, supplyVoltageV: null }} pinnedTariffId={null} lockedReason={null} updatedAt="T1" />)
    expect(screen.getByRole('option', { name: '2024/25 (superseded)' })).toBeDefined()
    expect(screen.getByText('2026/27 not yet published in the library — using 2025/26 with escalation')).toBeDefined()
    await user.selectOptions(screen.getByLabelText('Financial year'), '2024/25')
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/tariff?fy=2024%2F25')
  })
  it('locked while a project override exists', () => {
    render(<TariffPicker projectId="p1" years={years} selectedYearId="y25" yearNote={null} tariffs={tariffs} supply={{ nmdKva: 500, supplyVoltageV: 400 }} pinnedTariffId={tariffs[0].id} lockedReason="Revert the project override before choosing another tariff." updatedAt="T1" />)
    expect((screen.getByRole('radio', { name: /Commercial/ }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('Revert the project override before choosing another tariff.')).toBeDefined()
  })
})
```

`ChargesTable.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ url: vi.fn() }))
vi.mock('@/actions/solar-tariff.actions', () => ({ getSolarTariffSourceUrlAction: h.url }))
vi.mock('@/components/tariffs/SourceViewer', () => ({ SourceViewer: (p: { title: string }) => <div>viewer {p.title}</div> }))

import { ChargesTable } from './ChargesTable'

describe('ChargesTable', () => {
  it('shows every stored charge with its unit and a View source per row', async () => {
    const user = userEvent.setup()
    render(<ChargesTable projectId="p1" charges={[
      { id: 'c1', component: 'energy', season: 'high', tou: 'peak', dayType: 'all', blockMin: null, blockMax: null, unit: 'c_per_kWh', amount: 412.34, vatBasis: 'stated_excl', sourceDocumentId: 'd1', sourceTitle: 'Eskom 2026/27', locator: { page: 4 } },
      { id: 'c2', component: 'basic', season: 'all', tou: 'all', dayType: 'all', blockMin: null, blockMax: null, unit: 'R_per_day', amount: 25.3, vatBasis: 'stated_excl', sourceDocumentId: null, sourceTitle: null, locator: {} },
    ]} />)
    expect(screen.getByText('412.34 c/kWh')).toBeDefined()
    expect(screen.getByText('R25.30/day')).toBeDefined()
    expect(screen.getByText('Eskom 2026/27, page 4')).toBeDefined()
    await user.click(screen.getAllByRole('button', { name: 'View source' })[0])
    expect(screen.getByText('viewer Energy (High demand (winter), Peak)')).toBeDefined()
    expect((screen.getAllByRole('button', { name: 'View source' })[1] as HTMLButtonElement).disabled).toBe(true)
  })
  it('an empty tariff says so', () => {
    render(<ChargesTable projectId="p1" charges={[]} />)
    expect(screen.getByText('This tariff has no charges in the library. Report it as a tariff error.')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/tariff"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `TariffPicker.tsx`**

```tsx
'use client'
/**
 * Financial year + Tariff (spec §5): published years for the licensee
 * (superseded labelled); tariffs grouped by category, filtered by metering
 * and phase, eligible-only by NMD/voltage unless "Show all". Choosing saves.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  TARIFF_METERING, groupTariffs, yearOptionLabel,
  type SupplyFacts, type TariffListItem, type TariffMetering, type TariffYearOption,
} from '@esite/shared'
import { selectSolarTariffAction } from '@/actions/solar-tariff.actions'

export function TariffPicker({ projectId, years, selectedYearId, yearNote, tariffs, supply, pinnedTariffId, lockedReason, updatedAt }: {
  projectId: string
  years: TariffYearOption[]
  selectedYearId: string | null
  yearNote: string | null
  tariffs: TariffListItem[]
  supply: SupplyFacts
  pinnedTariffId: string | null
  lockedReason: string | null
  updatedAt: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [metering, setMetering] = useState<TariffMetering | ''>('')
  const [phase, setPhase] = useState<'single' | 'three' | ''>('')
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const g = groupTariffs(tariffs, { supply, showAll, query, metering: metering || null, phase: phase || null })
  const selectedFy = years.find((y) => y.id === selectedYearId)?.financialYear ?? ''

  return (
    <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
      <label>Financial year{' '}
        <select aria-label="Financial year" value={selectedFy} onChange={(e) => router.push(`/projects/${projectId}/solar/tariff?fy=${encodeURIComponent(e.target.value)}`)}>
          {years.map((y) => <option key={y.id} value={y.financialYear}>{yearOptionLabel(y)}</option>)}
        </select>
      </label>
      {yearNote && <p role="note" style={{ margin: 0, padding: '6px 10px', background: 'var(--c-amber-dim)', borderRadius: 6 }}>{yearNote}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input aria-label="Search tariffs" placeholder="Search by name or code" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select aria-label="Metering" value={metering} onChange={(e) => setMetering(e.target.value as TariffMetering | '')}>
          <option value="">Any metering</option>{TARIFF_METERING.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select aria-label="Phase" value={phase} onChange={(e) => setPhase(e.target.value as 'single' | 'three' | '')}>
          <option value="">Any phase</option><option value="single">Single phase</option><option value="three">Three phase</option>
        </select>
        <label><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all</label>
      </div>
      {lockedReason && <p role="note" style={{ margin: 0 }}>{lockedReason}</p>}
      {g.groups.length === 0 && <p style={{ margin: 0 }}>No tariffs match. {g.hiddenCount > 0 ? 'Tick "Show all" to see tariffs outside this supply\'s NMD or voltage.' : ''}</p>}
      <div role="radiogroup" aria-label="Tariff" style={{ display: 'grid', gap: 8 }}>
        {g.groups.map((grp) => (
          <fieldset key={grp.category} style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: 8 }}>
            <legend style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{grp.label}</legend>
            {grp.tariffs.map((t) => (
              <label key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', opacity: t.eligible ? 1 : 0.7 }}>
                <input type="radio" name="tariff" value={t.id} checked={pinnedTariffId === t.id} disabled={Boolean(lockedReason) || busy !== null}
                  onChange={async () => {
                    setBusy(t.id); setError(null)
                    const r = await selectSolarTariffAction({ projectId, tariffId: t.id, expectedUpdatedAt: updatedAt })
                    setBusy(null)
                    if ('error' in r) setError(r.error); else router.refresh()
                  }} />
                <span>{t.name}{t.code ? ` (${t.code})` : ''} · {t.structure}</span>
                {!t.eligible && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{t.reasons.join('; ')}</span>}
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      {g.hiddenCount > 0 && <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-dim)' }}>{g.hiddenCount} more not eligible for this supply</p>}
      {error && <p role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4: Implement `ChargesTable.tsx`**

```tsx
'use client'
/** Charges table (spec §5): every stored charge, nothing hidden; View source per row. */
import { useState, type CSSProperties } from 'react'
import { COMPONENT_LABELS, SEASON_LABELS, TOU_LABELS, formatChargeAmount, type TariffSeason, type TouOrAll } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { SourceViewer } from '@/components/tariffs/SourceViewer'
import { getSolarTariffSourceUrlAction } from '@/actions/solar-tariff.actions'
import type { PinnedCharge } from '@/lib/solar/tariff/rows'

const TH: CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--c-text-dim)', fontWeight: 600 }
const TD: CSSProperties = { padding: '6px 8px', fontSize: 13, borderTop: '1px solid var(--c-border)' }

function cite(c: PinnedCharge): string {
  if (!c.sourceTitle) return '—'
  const l = c.locator
  if (typeof l.page === 'number') return `${c.sourceTitle}, page ${l.page}`
  if (l.sheet || l.cell) return `${c.sourceTitle}, ${[l.sheet, l.cell].filter(Boolean).join(' ')}`
  return c.sourceTitle
}

export function ChargesTable({ projectId, charges }: { projectId: string; charges: PinnedCharge[] }) {
  const [viewing, setViewing] = useState<PinnedCharge | null>(null)
  if (charges.length === 0) return <p style={{ fontSize: 13 }}>This tariff has no charges in the library. Report it as a tariff error.</p>
  const title = (c: PinnedCharge) => `${COMPONENT_LABELS[c.component]} (${SEASON_LABELS[c.season as TariffSeason] ?? c.season}, ${TOU_LABELS[c.tou as TouOrAll] ?? c.tou})`
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={TH}>Component</th><th style={TH}>Season</th><th style={TH}>TOU period</th><th style={TH}>Block (kWh)</th><th style={TH}>Amount (excl. VAT)</th><th style={TH}>Source</th><th style={TH} /></tr></thead>
        <tbody>{charges.map((c) => (
          <tr key={c.id}>
            <td style={TD}>{COMPONENT_LABELS[c.component]}</td>
            <td style={TD}>{SEASON_LABELS[c.season as TariffSeason] ?? c.season}</td>
            <td style={TD}>{TOU_LABELS[c.tou as TouOrAll] ?? c.tou}{c.dayType !== 'all' ? ` (${c.dayType})` : ''}</td>
            <td style={TD}>{c.blockMin === null ? '—' : `${c.blockMin}–${c.blockMax ?? '∞'}`}</td>
            <td style={TD}>{formatChargeAmount(c.amount, c.unit)}</td>
            <td style={TD}>{cite(c)}</td>
            <td style={TD}><Button variant="ghost" size="sm" disabled={!c.sourceDocumentId} onClick={() => setViewing(c)}>View source</Button></td>
          </tr>
        ))}</tbody>
      </table>
      {viewing && viewing.sourceDocumentId && (
        <SourceViewer title={title(viewing)} locator={viewing.locator}
          loadUrl={() => getSolarTariffSourceUrlAction({ projectId, sourceDocumentId: viewing.sourceDocumentId as string })}
          onClose={() => setViewing(null)} />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run them — expect PASS**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/tariff"`
Expected: PASS (4 + 2 tests).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/tariff"
git commit -m "feat(solar-tariff): tariff picker (eligibility, filters, years) and charges table with View source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 28: Override, export rule, escalation, bill check and report panels

**Files (all under `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/tariff/`):**
- Create: `OverridePanel.tsx`, `ExportRulePanel.tsx`, `EscalationTable.tsx`, `BillCheckPanel.tsx`, `ReportTariffError.tsx`
- Test: `OverridePanel.test.tsx`, `ExportRulePanel.test.tsx`, `EscalationTable.test.tsx`, `BillCheckPanel.test.tsx`, `ReportTariffError.test.tsx`

- [ ] **Step 1: Write the failing tests**

`OverridePanel.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ create: vi.fn(), revert: vi.fn(), edit: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-tariff.actions', () => ({ createSolarTariffOverrideAction: h.create, revertSolarTariffOverrideAction: h.revert, editSolarOverrideChargeAction: h.edit }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { OverridePanel } from './OverridePanel'
import type { OverrideChargeRow } from '@esite/shared'

const row: OverrideChargeRow = { id: 'oc1', baseChargeId: 'c1', component: 'energy', season: 'all', tou: 'all', dayType: 'all', blockMinKwh: null, blockMaxKwh: null,
  blockBasis: null, unit: 'c_per_kWh', demandBasis: null, amountExclVat: 250, vatRate: 0.15, vatBasis: 'stated_excl', sourceLocator: {}, reason: null, editedAt: null, editedBy: null, updatedAt: 'R1' }

beforeEach(() => { vi.clearAllMocks(); h.create.mockResolvedValue({ ok: true }); h.revert.mockResolvedValue({ ok: true }); h.edit.mockResolvedValue({ ok: true }) })

describe('OverridePanel', () => {
  it('no override: Create project override copies the pinned tariff', async () => {
    const user = userEvent.setup()
    render(<OverridePanel projectId="p1" studyUpdatedAt="T1" override={null} published={{}} />)
    await user.click(screen.getByRole('button', { name: 'Create project override' }))
    expect(h.create).toHaveBeenCalledWith({ projectId: 'p1', expectedUpdatedAt: 'T1' })
  })
  it('editing a rate requires a reason; the unit select is required', async () => {
    const user = userEvent.setup()
    h.edit.mockResolvedValueOnce({ fieldErrors: { reason: 'Say why this rate differs from the published one' } })
    render(<OverridePanel projectId="p1" studyUpdatedAt="T1" override={{ id: 'o1', rows: [row] }} published={{ c1: { amount: 250, unit: 'c_per_kWh' } }} />)
    expect(screen.getByText('Project-specific rates: the engine and the report use these instead of the published tariff.')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByLabelText('New amount'))
    await user.type(screen.getByLabelText('New amount'), '199')
    await user.click(screen.getByRole('button', { name: 'Save rate' }))
    expect(h.edit).toHaveBeenCalledWith({ projectId: 'p1', chargeId: 'oc1', expectedUpdatedAt: 'R1', form: { amount: '199', unit: 'c_per_kWh', reason: '' } })
    expect(screen.getByText('Say why this rate differs from the published one')).toBeDefined()
  })
  it('Revert is two-step', async () => {
    const user = userEvent.setup()
    render(<OverridePanel projectId="p1" studyUpdatedAt="T1" override={{ id: 'o1', rows: [row] }} published={{}} />)
    await user.click(screen.getByRole('button', { name: 'Revert to published tariff' }))
    expect(h.revert).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm revert (drops 1 project rate)' }))
    expect(h.revert).toHaveBeenCalledWith({ projectId: 'p1', expectedUpdatedAt: 'T1' })
  })
})
```

`ExportRulePanel.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-tariff.actions', () => ({ saveSolarExportRuleAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { ExportRulePanel } from './ExportRulePanel'
import { netBillingRule } from '@esite/shared'

beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' }) })

describe('ExportRulePanel', () => {
  it('municipal: defaults to no credit; manual needs a source note before saving', async () => {
    const user = userEvent.setup()
    render(<ExportRulePanel projectId="p1" updatedAt="T1" rule={null} rates={[]} sourceNote={null} linkedExportTariff={null} sseg={netBillingRule('municipal')} ssegFromLibrary={false} />)
    expect((screen.getByLabelText('No export credit (R0)') as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByLabelText('Linked export tariff (published)')).toBeNull()
    await user.click(screen.getByLabelText('Enter export rate manually'))
    await user.type(screen.getByLabelText('Rate 1 amount'), '95')
    await user.click(screen.getByRole('button', { name: 'Save export rule' }))
    expect(screen.getByText('Say where this rate comes from (document and page)')).toBeDefined()
    expect(h.save).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Source of the rate'), 'City of Tshwane SSEG schedule 2026/27 p4')
    await user.click(screen.getByRole('button', { name: 'Save export rule' }))
    expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', expectedUpdatedAt: 'T1', form: {
      method: 'manual', sourceNote: 'City of Tshwane SSEG schedule 2026/27 p4', rates: [{ season: 'all', tou: 'all', unit: 'c_per_kWh', amount: '95' }],
    } })
  })
  it('shows the Net-Billing rule it applies, and says when it is the Rules default', () => {
    render(<ExportRulePanel projectId="p1" updatedAt="T1" rule={null} rates={[]} sourceNote={null} linkedExportTariff={null} sseg={netBillingRule('municipal')} ssegFromLibrary={false} />)
    expect(screen.getByText(/Carry forward to the end of the financial year \(June\)/)).toBeDefined()
    expect(screen.getByText(/NERSA Net-Billing Rules default: no licensee-specific rule in the library/)).toBeDefined()
  })
  it('a missing rule is called out (it blocks Tariff readiness)', () => {
    render(<ExportRulePanel projectId="p1" updatedAt="T1" rule={null} rates={[]} sourceNote={null} linkedExportTariff={null} sseg={netBillingRule('municipal')} ssegFromLibrary={false} />)
    expect(screen.getByText('No export rule saved yet: the Tariff step stays incomplete until you save one.')).toBeDefined()
  })
})
```

`EscalationTable.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-tariff.actions', () => ({ saveSolarEscalationAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { EscalationTable } from './EscalationTable'

beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' }) })

describe('EscalationTable', () => {
  it('shows each year with its source and saves only the years the user changed', async () => {
    const user = userEvent.setup()
    render(<EscalationTable projectId="p1" updatedAt="T1" rows={[
      { year: 2, pct: 12.74, source: 'published', financialYear: '2026/27' },
      { year: 3, pct: 8.75, source: 'default', financialYear: null },
    ]} />)
    expect(screen.getByText('Approved increase 2026/27')).toBeDefined()
    expect(screen.getByText('Org default (D-07)')).toBeDefined()
    await user.type(screen.getByLabelText('Year 3 escalation %'), '10')
    await user.click(screen.getByRole('button', { name: 'Save escalation' }))
    expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', expectedUpdatedAt: 'T1', form: { '3': '10' } })
  })
  it('Reset to defaults clears every override', async () => {
    const user = userEvent.setup()
    render(<EscalationTable projectId="p1" updatedAt="T1" rows={[{ year: 2, pct: 20, source: 'override', financialYear: null }]} />)
    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(h.save).toHaveBeenCalledWith({ projectId: 'p1', expectedUpdatedAt: 'T1', form: {} })
  })
})
```

`BillCheckPanel.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ record: vi.fn(), del: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-tariff.actions', () => ({ recordSolarBillCheckAction: h.record, deleteSolarBillCheckAction: h.del }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { BillCheckPanel } from './BillCheckPanel'

beforeEach(() => vi.clearAllMocks())

describe('BillCheckPanel', () => {
  it('flat tariff: one kWh box; a > 5 % difference is amber with the model', async () => {
    h.record.mockResolvedValue({ ok: true, result: { modelled: 2900, actual: 2700, differencePct: 7.407, warn: true, notModelled: ['saturday-only charges are not modelled'] } })
    const user = userEvent.setup()
    render(<BillCheckPanel projectId="p1" isTou={false} history={[]} canRun />)
    expect(screen.queryByLabelText('Peak kWh')).toBeNull()
    await user.type(screen.getByLabelText('Billing month'), '2026-03')
    await user.type(screen.getByLabelText('Energy (kWh)'), '1000')
    await user.type(screen.getByLabelText('Bill total excl. VAT (R)'), '2700')
    await user.click(screen.getByRole('button', { name: 'Check this bill' }))
    expect(await screen.findByText('Model differs from the bill')).toBeDefined()
    expect(screen.getByText('Modelled R2,900.00 vs actual R2,700.00 (+7.407 %)')).toBeDefined()
    expect(screen.getByText('saturday-only charges are not modelled')).toBeDefined()
  })
  it('TOU tariff asks for the three periods; no tariff means no button', () => {
    const { unmount } = render(<BillCheckPanel projectId="p1" isTou history={[]} canRun />)
    expect(screen.getByLabelText('Peak kWh')).toBeDefined()
    unmount()
    render(<BillCheckPanel projectId="p1" isTou={false} history={[]} canRun={false} />)
    expect(screen.queryByRole('button', { name: 'Check this bill' })).toBeNull()
    expect(screen.getByText('Choose a tariff first.')).toBeDefined()
  })
})
```

`ReportTariffError.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ report: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/actions/solar-tariff.actions', () => ({ reportTariffErrorAction: h.report }))

import { ReportTariffError } from './ReportTariffError'

describe('ReportTariffError', () => {
  it('opens a note, sends it, and confirms', async () => {
    const user = userEvent.setup()
    render(<ReportTariffError projectId="p1" tariffId="t1" />)
    await user.click(screen.getByRole('button', { name: 'Report a tariff error' }))
    await user.type(screen.getByLabelText('What looks wrong?'), 'Basic charge is last year\'s')
    await user.click(screen.getByRole('button', { name: 'Send to the tariff library' }))
    expect(h.report).toHaveBeenCalledWith({ projectId: 'p1', tariffId: 't1', note: 'Basic charge is last year\'s' })
    expect(await screen.findByText('Sent. The tariff library maintainers will review it.')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/tariff"`
Expected: FAIL — the five new modules not found (Task 27's tests still pass).

- [ ] **Step 3: Implement `OverridePanel.tsx`**

```tsx
'use client'
/**
 * Project override (spec §5; D-10 landlord resale). Create copies the pinned
 * tariff; each edited rate needs a unit and a reason; Revert is two-step and
 * drops every project rate.
 */
import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import {
  COMPONENT_LABELS, SEASON_LABELS, TARIFF_UNITS, TOU_LABELS, UNIT_LABELS, formatChargeAmount,
  type OverrideChargeRow, type TariffUnit,
} from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { createSolarTariffOverrideAction, editSolarOverrideChargeAction, revertSolarTariffOverrideAction } from '@/actions/solar-tariff.actions'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

const TH: CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 11, color: 'var(--c-text-dim)', fontWeight: 600 }
const TD: CSSProperties = { padding: '6px 8px', fontSize: 13, borderTop: '1px solid var(--c-border)', verticalAlign: 'top' }

export function OverridePanel({ projectId, studyUpdatedAt, override, published }: {
  projectId: string
  studyUpdatedAt: string
  override: { id: string; rows: OverrideChargeRow[] } | null
  /** base charge id -> the published amount + unit, to show beside the project rate. */
  published: Record<string, { amount: number; unit: TariffUnit }>
}) {
  const router = useRouter()
  const revert = useArmedConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!override) {
    return (
      <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
        <p style={{ margin: 0 }}>Negotiated or landlord resale rates? Copy the pinned tariff into a project override and change the rates that differ.</p>
        <div><Button variant="secondary" isLoading={busy} onClick={async () => {
          setBusy(true); setError(null)
          const r = await createSolarTariffOverrideAction({ projectId, expectedUpdatedAt: studyUpdatedAt })
          setBusy(false)
          if ('error' in r) setError(r.error); else router.refresh()
        }}>Create project override</Button></div>
        {error && <p role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{error}</p>}
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p role="note" style={{ margin: 0, fontSize: 13, padding: '6px 10px', background: 'var(--c-amber-dim)', borderRadius: 6 }}>
        Project-specific rates: the engine and the report use these instead of the published tariff.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={TH}>Component</th><th style={TH}>Season / period</th><th style={TH}>Published</th><th style={TH}>Project rate</th><th style={TH}>Reason</th><th style={TH} /></tr></thead>
          <tbody>{override.rows.map((r) => <OverrideRow key={`${r.id}:${r.updatedAt}`} projectId={projectId} row={r} published={r.baseChargeId ? published[r.baseChargeId] : undefined} />)}</tbody>
        </table>
      </div>
      <div>
        <Button variant="danger" size="sm" isLoading={busy} onClick={async () => {
          if (!revert.armed) return revert.arm()
          revert.disarm(); setBusy(true); setError(null)
          const r = await revertSolarTariffOverrideAction({ projectId, expectedUpdatedAt: studyUpdatedAt })
          setBusy(false)
          if ('error' in r) setError(r.error); else router.refresh()
        }}>{revert.armed ? `Confirm revert (drops ${override.rows.length} project rate${override.rows.length === 1 ? '' : 's'})` : 'Revert to published tariff'}</Button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--c-red)', margin: 0, fontSize: 13 }}>{error}</p>}
    </div>
  )
}

function OverrideRow({ projectId, row, published }: { projectId: string; row: OverrideChargeRow; published?: { amount: number; unit: TariffUnit } }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState(String(row.amountExclVat))
  const [unit, setUnit] = useState<TariffUnit | ''>(row.unit)
  const [reason, setReason] = useState(row.reason ?? '')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [busy, setBusy] = useState(false)
  return (
    <tr>
      <td style={TD}>{COMPONENT_LABELS[row.component]}</td>
      <td style={TD}>{SEASON_LABELS[row.season]} / {TOU_LABELS[row.tou]}</td>
      <td style={TD}>{published ? formatChargeAmount(published.amount, published.unit) : 'Added'}</td>
      <td style={TD}>
        {editing
          ? <span style={{ display: 'inline-flex', gap: 4 }}>
              <input aria-label="New amount" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 90 }} />
              <select aria-label="Unit" required value={unit} onChange={(e) => setUnit(e.target.value as TariffUnit | '')}>
                <option value="">Choose a unit</option>{TARIFF_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
              </select>
            </span>
          : <span>{formatChargeAmount(row.amountExclVat, row.unit)}{row.editedAt ? ' (changed)' : ''}</span>}
        {errors.amount && <div role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{errors.amount}</div>}
        {errors.unit && <div role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{errors.unit}</div>}
      </td>
      <td style={TD}>
        {editing
          ? <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Lease cl. 14 resale rate" style={{ minWidth: 200 }} />
          : (row.reason ?? '—')}
        {errors.reason && <div role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{errors.reason}</div>}
        {errors.form && <div role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}>{errors.form}</div>}
      </td>
      <td style={TD}>
        {editing
          ? <>
              <Button size="sm" isLoading={busy} onClick={async () => {
                setBusy(true); setErrors({})
                const r = await editSolarOverrideChargeAction({ projectId, chargeId: row.id, expectedUpdatedAt: row.updatedAt, form: { amount, unit, reason } })
                setBusy(false)
                if ('fieldErrors' in r) setErrors(r.fieldErrors)
                else if ('error' in r) setErrors({ form: r.error })
                else { setEditing(false); router.refresh() }
              }}>Save rate</Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            </>
          : <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>}
      </td>
    </tr>
  )
}
```

- [ ] **Step 4: Implement `ExportRulePanel.tsx`**

```tsx
'use client'
/**
 * Export / SSEG rule (spec §5; NERSA Net-Billing Rules). Eskom: the linked
 * Gen-offset tariff. Municipal: No export credit (R0) by default, or a
 * manual rate with a mandatory source note. The applicable crediting rules
 * are shown from the library's SSEG rule, else the Rules default (flagged).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  EXPORT_METHOD_LABELS, SEASON_LABELS, TOU_LABELS, exportMethodsFor, formatChargeAmount, validateExportRuleForm,
  type ExportMethod, type ExportRateRow, type ExportRule, type ExportRuleForm, type SsegRule,
} from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { saveSolarExportRuleAction } from '@/actions/solar-tariff.actions'
import type { PinnedCharge } from '@/lib/solar/tariff/rows'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
type RateForm = ExportRuleForm['rates'][number]
const NEW_RATE: RateForm = { season: 'all', tou: 'all', unit: 'c_per_kWh', amount: '' }

function ssegLines(s: SsegRule): string[] {
  return [
    s.crediting === 'net_billing_tou' ? 'Net billing, credited per TOU period' : s.crediting === 'net_billing_flat' ? 'Net billing at a flat export rate' : 'No export crediting',
    'Settled monthly',
    s.carryForward === 'within_financial_year' ? `Carry forward to the end of the financial year (${MONTHS[s.fyEndMonth - 1]})` : 'No carry forward',
    s.capRule === 'kwh_per_tou_period' ? 'Credited kWh capped at the import kWh of the same TOU period' : s.capRule === 'value_per_tou_period' ? 'Credit capped at the energy value of each TOU period' : 'Credit capped at the energy charges',
    'Offsets energy charges only (no cash)',
    `Requires ${[s.requiresBidirectionalMeter ? 'a bidirectional' : null, s.requiresTou ? 'TOU' : null].filter(Boolean).join(' ')} meter; generator up to ${s.maxKva} kVA`,
  ]
}

export function ExportRulePanel({ projectId, updatedAt, rule, rates, sourceNote, linkedExportTariff, sseg, ssegFromLibrary }: {
  projectId: string
  updatedAt: string
  rule: ExportRule | null
  rates: ExportRateRow[]
  sourceNote: string | null
  linkedExportTariff: { name: string; charges: PinnedCharge[] } | null
  sseg: SsegRule
  ssegFromLibrary: boolean
}) {
  const router = useRouter()
  const hasLinked = linkedExportTariff !== null
  const methods = exportMethodsFor(hasLinked)
  const initialMethod: ExportMethod = rule?.method && methods.includes(rule.method) ? rule.method : hasLinked ? 'linked_tariff' : 'none'
  const [method, setMethod] = useState<ExportMethod>(initialMethod)
  const [note, setNote] = useState(rule?.sourceNote ?? sourceNote ?? '')
  const [rows, setRows] = useState<RateForm[]>(rates.length ? rates.map((r) => ({ season: r.season, tou: r.tou, unit: r.unit, amount: String(r.amountExclVat) })) : [{ ...NEW_RATE }])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const setRow = (i: number, p: Partial<RateForm>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...p } : r)))

  return (
    <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
      {!rule && <p role="note" style={{ margin: 0, padding: '6px 10px', background: 'var(--c-amber-dim)', borderRadius: 6 }}>No export rule saved yet: the Tariff step stays incomplete until you save one.</p>}
      <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 4 }}>
        <legend>How exported energy is credited</legend>
        {methods.map((m) => (
          <label key={m}><input type="radio" name="export-method" aria-label={EXPORT_METHOD_LABELS[m]} checked={method === m} onChange={() => setMethod(m)} /> {EXPORT_METHOD_LABELS[m]}</label>
        ))}
      </fieldset>
      {method === 'linked_tariff' && linkedExportTariff && (
        <div>
          <strong>{linkedExportTariff.name}</strong>
          <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{linkedExportTariff.charges.filter((c) => c.component === 'export_credit' || c.component === 'energy').map((c) => (
            <li key={c.id}>{SEASON_LABELS[c.season as 'all']} {TOU_LABELS[c.tou as 'all']}: {formatChargeAmount(c.amount, c.unit)}</li>
          ))}</ul>
        </div>
      )}
      {method === 'manual' && (
        <div style={{ display: 'grid', gap: 6 }}>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <select aria-label={`Rate ${i + 1} season`} value={r.season} onChange={(e) => setRow(i, { season: e.target.value as RateForm['season'] })}>
                <option value="all">All year</option><option value="high">High demand (winter)</option><option value="low">Low demand (summer)</option>
              </select>
              <select aria-label={`Rate ${i + 1} period`} value={r.tou} onChange={(e) => setRow(i, { tou: e.target.value as RateForm['tou'] })}>
                <option value="all">All hours</option><option value="peak">Peak</option><option value="standard">Standard</option><option value="off_peak">Off-peak</option>
              </select>
              <input aria-label={`Rate ${i + 1} amount`} value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} style={{ width: 90 }} />
              <select aria-label={`Rate ${i + 1} unit`} value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value as RateForm['unit'] })}>
                <option value="c_per_kWh">c/kWh</option><option value="R_per_kWh">R/kWh</option>
              </select>
              {rows.length > 1 && <button type="button" aria-label={`Remove rate ${i + 1}`} onClick={() => setRows(rows.filter((_, k) => k !== i))}>×</button>}
              {errors[`rates.${i}`] && <span role="alert" style={{ color: 'var(--c-red)' }}>{errors[`rates.${i}`]}</span>}
            </div>
          ))}
          <div><Button variant="secondary" size="sm" onClick={() => setRows([...rows, { ...NEW_RATE }])}>Add a rate</Button></div>
          <label>Source of the rate<textarea aria-label="Source of the rate" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            placeholder="e.g. City of Tshwane SSEG schedule 2026/27 p4" style={{ width: '100%' }} /></label>
          {errors.sourceNote && <p role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{errors.sourceNote}</p>}
          {errors.rates && <p role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{errors.rates}</p>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button isLoading={busy} onClick={async () => {
          setMsg(null)
          const form: ExportRuleForm = { method, sourceNote: note, rates: method === 'manual' ? rows : [] }
          const check = validateExportRuleForm(form, hasLinked)
          if ('errors' in check) return setErrors(check.errors)
          setErrors({}); setBusy(true)
          const r = await saveSolarExportRuleAction({ projectId, expectedUpdatedAt: updatedAt, form })
          setBusy(false)
          if ('fieldErrors' in r) setErrors(r.fieldErrors)
          else if ('error' in r) setMsg(r.error)
          else { setMsg('Saved.'); router.refresh() }
        }}>Save export rule</Button>
        {msg && <span role="status">{msg}</span>}
      </div>
      <div>
        <strong>Crediting rules that apply</strong>
        <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{ssegLines(sseg).map((l) => <li key={l}>{l}</li>)}</ul>
        {!ssegFromLibrary && <p style={{ margin: 0, fontSize: 12, color: 'var(--c-text-dim)' }}>NERSA Net-Billing Rules default: no licensee-specific rule in the library (Rules approved 17 Dec 2024, pp7-12).</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Implement `EscalationTable.tsx`**

```tsx
'use client'
/** Escalation path (spec §5; D-07): year n -> %, with where each value comes from. */
import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import type { EscalationRow } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { saveSolarEscalationAction } from '@/actions/solar-tariff.actions'

const TD: CSSProperties = { padding: '4px 8px', fontSize: 13, borderTop: '1px solid var(--c-border)' }

function sourceLabel(r: EscalationRow): string {
  if (r.source === 'published') return `Approved increase ${r.financialYear}`
  if (r.source === 'override') return 'Set for this project'
  return 'Org default (D-07)'
}

export function EscalationTable({ projectId, updatedAt, rows }: { projectId: string; updatedAt: string; rows: EscalationRow[] }) {
  const router = useRouter()
  const [form, setForm] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const kept = Object.fromEntries(rows.filter((r) => r.source === 'override').map((r) => [String(r.year), String(r.pct)]))
  const save = async (f: Record<string, string>) => {
    setBusy(true); setMsg(null); setErrors({})
    const r = await saveSolarEscalationAction({ projectId, expectedUpdatedAt: updatedAt, form: f })
    setBusy(false)
    if ('fieldErrors' in r) setErrors(r.fieldErrors)
    else if ('error' in r) setMsg(r.error)
    else { setForm({}); setMsg('Saved.'); router.refresh() }
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table style={{ borderCollapse: 'collapse' }}>
          <thead><tr><th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 11 }}>Year</th><th style={{ textAlign: 'right', padding: '4px 8px', fontSize: 11 }}>Increase</th><th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 11 }}>From</th><th style={{ padding: '4px 8px', fontSize: 11 }}>Change to (%)</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.year}>
              <td style={TD}>Year {r.year}</td>
              <td style={{ ...TD, textAlign: 'right' }}>{r.pct.toFixed(2)} %</td>
              <td style={TD}>{sourceLabel(r)}</td>
              <td style={TD}>
                <input aria-label={`Year ${r.year} escalation %`} value={form[String(r.year)] ?? ''} onChange={(e) => setForm({ ...form, [String(r.year)]: e.target.value })} style={{ width: 70 }} />
                {errors[String(r.year)] && <span role="alert" style={{ color: 'var(--c-red)', fontSize: 12 }}> {errors[String(r.year)]}</span>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button isLoading={busy} onClick={() => save({ ...kept, ...Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== '')) })}>Save escalation</Button>
        <Button variant="ghost" isLoading={busy} onClick={() => save({})}>Reset to defaults</Button>
        {msg && <span role="status" style={{ fontSize: 13 }}>{msg}</span>}
      </div>
    </div>
  )
}
```

(The first test has no `override` rows, so `kept` is `{}` and the save carries only `{ '3': '10' }`.)

- [ ] **Step 6: Implement `BillCheckPanel.tsx`**

```tsx
'use client'
/** Bill check (spec §5): one real bill vs the engine's model; > ±5 % is amber. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EMPTY_BILL_CHECK_FORM, formatRandAmount, type BillCheckForm } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { deleteSolarBillCheckAction, recordSolarBillCheckAction, type BillCheckOutcome } from '@/actions/solar-tariff.actions'
import type { BillCheckRow } from '@/lib/solar/tariff/rows'

function pct(x: number): string {
  return `${x > 0 ? '+' : ''}${x} %`
}

export function BillCheckPanel({ projectId, isTou, history, canRun }: { projectId: string; isTou: boolean; history: BillCheckRow[]; canRun: boolean }) {
  const router = useRouter()
  const [f, setF] = useState<BillCheckForm>({ ...EMPTY_BILL_CHECK_FORM })
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [result, setResult] = useState<BillCheckOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field = (k: keyof BillCheckForm, label: string, placeholder?: string) => (
    <label style={{ display: 'grid', gap: 2 }}>{label}
      <input aria-label={label} value={f[k]} placeholder={placeholder} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  )
  if (!canRun) return <p style={{ fontSize: 13 }}>Choose a tariff first.</p>
  return (
    <div style={{ display: 'grid', gap: 10, fontSize: 13 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
        {field('month', 'Billing month', 'YYYY-MM')}
        {isTou ? <>{field('peak', 'Peak kWh')}{field('standard', 'Standard kWh')}{field('offPeak', 'Off-peak kWh')}</> : field('totalKwh', 'Energy (kWh)')}
        {field('maxDemandKva', 'Maximum demand (kVA, optional)')}
        {field('actualTotal', 'Bill total excl. VAT (R)')}
        {field('note', 'Note (optional)')}
      </div>
      {Object.entries(errors).filter(([, v]) => v).map(([k, v]) => <p key={k} role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{v}</p>)}
      {error && <p role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{error}</p>}
      <div><Button isLoading={busy} onClick={async () => {
        setBusy(true); setErrors({}); setError(null); setResult(null)
        const r = await recordSolarBillCheckAction({ projectId, form: f })
        setBusy(false)
        if ('fieldErrors' in r) setErrors(r.fieldErrors)
        else if ('error' in r) setError(r.error)
        else { setResult(r.result); router.refresh() }
      }}>Check this bill</Button></div>
      {result && (
        <div role="status" style={{ padding: '8px 10px', borderRadius: 6, background: result.warn ? 'var(--c-amber-dim)' : 'var(--c-green-dim)' }}>
          {result.warn && <strong style={{ display: 'block' }}>Model differs from the bill</strong>}
          <span>Modelled {formatRandAmount(result.modelled)} vs actual {formatRandAmount(result.actual)} ({pct(result.differencePct)})</span>
          {result.notModelled.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{result.notModelled.map((n) => <li key={n}>{n}</li>)}</ul>}
        </div>
      )}
      {history.length > 0 && (
        <table style={{ borderCollapse: 'collapse' }}>
          <thead><tr><th align="left">Month</th><th align="right">Actual</th><th align="right">Modelled</th><th align="right">Difference</th><th /></tr></thead>
          <tbody>{history.map((b) => (
            <tr key={b.id}>
              <td>{b.month}</td><td align="right">{formatRandAmount(b.actual)}</td><td align="right">{formatRandAmount(b.modelled)}</td>
              <td align="right" style={{ color: Math.abs(b.differencePct) > 5 ? 'var(--c-amber)' : undefined }}>{pct(b.differencePct)}</td>
              <td><button type="button" aria-label={`Delete the ${b.month} check`} onClick={async () => {
                const r = await deleteSolarBillCheckAction({ projectId, id: b.id })
                if ('error' in r) setError(r.error); else router.refresh()
              }}>×</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Implement `ReportTariffError.tsx`**

```tsx
'use client'
/** "Report a tariff error" (spec §5): a note to the platform tariff library queue (index D2b-3). */
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { reportTariffErrorAction } from '@/actions/solar-tariff.actions'

export function ReportTariffError({ projectId, tariffId }: { projectId: string; tariffId: string }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  if (!open) return <button type="button" onClick={() => setOpen(true)} style={{ background: 'none', border: 0, color: 'var(--c-amber)', cursor: 'pointer', padding: 0, fontSize: 13 }}>Report a tariff error</button>
  return (
    <div style={{ display: 'grid', gap: 6, fontSize: 13 }}>
      <label>What looks wrong?<textarea aria-label="What looks wrong?" value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ width: '100%' }} /></label>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" isLoading={busy} onClick={async () => {
          setBusy(true); setMsg(null)
          const r = await reportTariffErrorAction({ projectId, tariffId, note })
          setBusy(false)
          if ('error' in r) setMsg({ ok: false, text: r.error })
          else { setMsg({ ok: true, text: 'Sent. The tariff library maintainers will review it.' }); setNote('') }
        }}>Send to the tariff library</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} style={{ margin: 0, color: msg.ok ? 'var(--c-green)' : 'var(--c-red)' }}>{msg.text}</p>}
    </div>
  )
}
```

- [ ] **Step 8: Run them — expect PASS**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/tariff"`
Expected: PASS (Task 27's 6 + OverridePanel 3, ExportRulePanel 3, EscalationTable 2, BillCheckPanel 2, ReportTariffError 1).

- [ ] **Step 9: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/tariff"
git commit -m "feat(solar-tariff): override, export rule, escalation, bill check and report panels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 29: The Tariff page, readiness wiring, activity text

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/tariff/page.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/tariff/LinkLicensee.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/tariff/page.test.tsx`
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.tsx` (select two more study columns; wrap readiness)
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/overview/page.tsx` (same)
- Modify: `packages/shared/src/solar/activity.ts` (+ `activity.test.ts`): sentences for the new audit verbs

- [ ] **Step 1: Write the failing tests**

`page.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ createClient: vi.fn(async () => ({})), requireSolarLevel: vi.fn(), load: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.requireSolarLevel }))
vi.mock('@/lib/solar/tariff/load-tariff-tab', () => ({ loadTariffTab: h.load }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
// The panels' actions are exercised in their own tests; here they must not pull server modules in.
vi.mock('@/actions/solar-tariff.actions', () => ({
  selectSolarTariffAction: vi.fn(), saveSolarExportRuleAction: vi.fn(), saveSolarEscalationAction: vi.fn(),
  createSolarTariffOverrideAction: vi.fn(), revertSolarTariffOverrideAction: vi.fn(), editSolarOverrideChargeAction: vi.fn(),
  recordSolarBillCheckAction: vi.fn(), deleteSolarBillCheckAction: vi.fn(), reportTariffErrorAction: vi.fn(),
  getSolarTariffSourceUrlAction: vi.fn(), setStudyLicenseeAction: vi.fn(),
}))

import SolarTariffPage from './page'

const base = {
  projectId: 'p1', supply: { nmdKva: 500, supplyVoltageV: 400 }, licenseeOptions: [], years: [], selectedYearId: null, yearNote: null,
  tariffs: [], pinned: null, override: null, exportRates: [], exportSourceNote: null, calendar: null, calendarAssumedEskom: false,
  calendarFromEskomFallback: false, holidays: [], escalation: [], analysisYears: 25, billChecks: [],
}

describe('Solar Tariff page', () => {
  it('asks for Edit + financials', async () => {
    h.requireSolarLevel.mockRejectedValueOnce(new Error('REDIRECT:/projects/p1/solar/locked'))
    await expect(SolarTariffPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT')
    expect(h.requireSolarLevel).toHaveBeenCalledWith('p1', 'edit_financials', expect.anything())
  })
  it('no study: points at Site & Supply', async () => {
    h.requireSolarLevel.mockResolvedValue('edit_financials')
    h.load.mockResolvedValue({ ...base, study: null, licensee: null })
    render(await SolarTariffPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve({}) }))
    expect(screen.getByRole('link', { name: 'Save Site & Supply first' }).getAttribute('href')).toBe('/projects/p1/solar/site')
  })
  it('no licensee: the spec sentence, with the library link offered', async () => {
    h.requireSolarLevel.mockResolvedValue('edit_financials')
    h.load.mockResolvedValue({ ...base, study: { id: 's1', updatedAt: 'T1', licenseeName: 'Unknown Town', tariffId: null, tariffOverrideId: null, exportRule: null }, licensee: null,
      licenseeOptions: [{ id: 'l1', name: 'City of Probe' }] })
    render(await SolarTariffPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve({}) }))
    expect(screen.getByText('Choose the supply authority on Site & Supply')).toBeDefined()
    expect(screen.getByRole('option', { name: 'City of Probe' })).toBeDefined()
  })
  it('municipal hours assumed from Eskom: the banner', async () => {
    h.requireSolarLevel.mockResolvedValue('edit_financials')
    h.load.mockResolvedValue({ ...base, study: { id: 's1', updatedAt: 'T1', licenseeName: 'City of Probe', tariffId: null, tariffOverrideId: null, exportRule: null },
      licensee: { id: 'l1', name: 'City of Probe', kind: 'municipal' },
      calendar: { highSeasonMonths: [6, 7, 8], windows: [], holidayTreatedAs: 'sunday', source: 'assumed_eskom' }, calendarAssumedEskom: true })
    render(await SolarTariffPage({ params: Promise.resolve({ id: 'p1' }), searchParams: Promise.resolve({}) }))
    expect(screen.getByText("TOU hours assumed equal to Eskom's — confirm against the municipality's by-law")).toBeDefined()
  })
})
```

In `packages/shared/src/solar/activity.test.ts` add:
```ts
  it('describes the Phase 2b tariff verbs without amounts', () => {
    expect(describeSolarAuditEvent('tariff_selected', { tariffId: 't' })).toEqual({ text: 'Tariff chosen', target: null })
    expect(describeSolarAuditEvent('tariff_override_created', {})).toEqual({ text: 'Project tariff override created', target: null })
    expect(describeSolarAuditEvent('tariff_override_row_edited', {})).toEqual({ text: 'Project tariff rate changed', target: null })
    expect(describeSolarAuditEvent('tariff_override_reverted', {})).toEqual({ text: 'Reverted to the published tariff', target: null })
    expect(describeSolarAuditEvent('export_rule_saved', { method: 'manual' })).toEqual({ text: 'Export credit rule saved', target: null })
    expect(describeSolarAuditEvent('escalation_saved', {})).toEqual({ text: 'Tariff escalation path saved', target: null })
    expect(describeSolarAuditEvent('bill_check_recorded', { billingMonth: '2026-03' })).toEqual({ text: 'Bill check recorded (2026-03)', target: null })
    expect(describeSolarAuditEvent('tariff_error_reported', {})).toEqual({ text: 'Tariff error reported to the library', target: null })
    expect(describeSolarAuditEvent('tariff_licensee_linked', {})).toEqual({ text: 'Supply authority linked to the tariff library', target: null })
  })
```
(`target: null` keeps 1c's `SolarActivityTarget` union unchanged; the activity list shows these as plain text.)

- [ ] **Step 2: Run them — expect FAIL**

```bash
pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/tariff/page.test.tsx"
pnpm --filter @esite/shared exec vitest run src/solar/activity.test.ts
```
Expected: FAIL — page module not found; the activity test gets the default `'tariff selected'` text.

- [ ] **Step 3: Add the activity sentences**

In `packages/shared/src/solar/activity.ts`, inside `describeSolarAuditEvent`'s `switch`, before `default:`:
```ts
    case 'tariff_selected':
      return { text: 'Tariff chosen', target: null }
    case 'tariff_licensee_linked':
      return { text: 'Supply authority linked to the tariff library', target: null }
    case 'tariff_override_created':
      return { text: 'Project tariff override created', target: null }
    case 'tariff_override_row_edited':
      return { text: 'Project tariff rate changed', target: null }
    case 'tariff_override_reverted':
      return { text: 'Reverted to the published tariff', target: null }
    case 'export_rule_saved':
      return { text: 'Export credit rule saved', target: null }
    case 'escalation_saved':
      return { text: 'Tariff escalation path saved', target: null }
    case 'bill_check_recorded':
      return { text: typeof ref.billingMonth === 'string' ? `Bill check recorded (${ref.billingMonth})` : 'Bill check recorded', target: null }
    case 'tariff_error_reported':
      return { text: 'Tariff error reported to the library', target: null }
```

- [ ] **Step 4: Implement the page**

`tariff/page.tsx`:
```tsx
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadTariffTab } from '@/lib/solar/tariff/load-tariff-tab'
import { TouCalendarDiagram } from '@/components/tariffs/TouCalendarDiagram'
import { TariffPicker } from './TariffPicker'
import { ChargesTable } from './ChargesTable'
import { OverridePanel } from './OverridePanel'
import { ExportRulePanel } from './ExportRulePanel'
import { EscalationTable } from './EscalationTable'
import { BillCheckPanel } from './BillCheckPanel'
import { ReportTariffError } from './ReportTariffError'
import { LinkLicensee } from './LinkLicensee'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

const P = { fontSize: 13, margin: 0 } as const
const NOTE = { fontSize: 13, margin: 0, padding: '6px 10px', background: 'var(--c-amber-dim)', borderRadius: 6 } as const

/** Tariff (spec §5). Edit + financials only; every action re-checks. */
export default async function SolarTariffPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ fy?: string }>
}) {
  const { id } = await params
  const { fy } = await searchParams
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(id, 'edit_financials', supabase)
  const d = await loadTariffTab(supabase, id, { fy: fy ?? null, todayIso: new Date().toISOString().slice(0, 10) })

  if (!d.study) {
    return <Card><CardBody><p style={P}><Link href={`/projects/${id}/solar/site`}>Save Site & Supply first</Link></p></CardBody></Card>
  }
  const study = d.study
  const pinned = d.pinned
  const published = Object.fromEntries((pinned?.charges ?? []).map((c) => [c.id, { amount: c.amount, unit: c.unit }]))

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader><span className="data-panel-title">Supply authority</span></CardHeader>
        <CardBody>
          {d.licensee
            ? <p style={P}>{d.licensee.name} <Link href={`/projects/${id}/solar/site`} style={{ fontSize: 12 }}>(change on Site & Supply)</Link></p>
            : <div style={{ display: 'grid', gap: 8 }}>
                <p style={P}><Link href={`/projects/${id}/solar/site`}>Choose the supply authority on Site & Supply</Link></p>
                {study.licenseeName && d.licenseeOptions.length > 0 && (
                  <LinkLicensee projectId={id} updatedAt={study.updatedAt} typedName={study.licenseeName} options={d.licenseeOptions} />
                )}
              </div>}
        </CardBody>
      </Card>

      {d.licensee && (
        <Card>
          <CardHeader><span className="data-panel-title">Tariff</span></CardHeader>
          <CardBody>
            {d.years.length === 0
              ? <p style={P}>No published tariff year for {d.licensee.name} in the library yet. Report it below once a tariff is chosen, or ask the tariff library to add it.</p>
              : <TariffPicker projectId={id} years={d.years} selectedYearId={d.selectedYearId} yearNote={d.yearNote} tariffs={d.tariffs}
                  supply={d.supply} pinnedTariffId={study.tariffId}
                  lockedReason={d.override ? 'Revert the project override before choosing another tariff.' : null} updatedAt={study.updatedAt} />}
          </CardBody>
        </Card>
      )}

      {pinned && (
        <>
          <Card>
            <CardHeader>
              <span className="data-panel-title">{pinned.name} · {pinned.financialYear}{pinned.yearState === 'superseded' ? ' (superseded)' : ''}</span>
              <ReportTariffError projectId={id} tariffId={pinned.id} />
            </CardHeader>
            <CardBody>
              {pinned.newerYear && <p style={NOTE}>A newer tariff year ({pinned.newerYear}) is available: choose it above to move this study onto it.</p>}
              {d.override
                ? <OverridePanel projectId={id} studyUpdatedAt={study.updatedAt} override={d.override} published={published} />
                : <div style={{ display: 'grid', gap: 12 }}>
                    <ChargesTable projectId={id} charges={pinned.charges} />
                    <OverridePanel projectId={id} studyUpdatedAt={study.updatedAt} override={null} published={published} />
                  </div>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><span className="data-panel-title">Time-of-use calendar</span></CardHeader>
            <CardBody>
              {!pinned.isTou && <p style={P}>Flat-rate tariff (no time-of-use)</p>}
              {pinned.isTou && d.calendarAssumedEskom && <p style={NOTE}>TOU hours assumed equal to Eskom&apos;s — confirm against the municipality&apos;s by-law</p>}
              {pinned.isTou && (d.calendar
                ? <TouCalendarDiagram calendar={d.calendar} />
                : <p style={P}>No TOU calendar in the library for this supply authority. Report it as a tariff error.</p>)}
              {pinned.isTou && d.holidays.length > 0 && (
                <details style={{ marginTop: 8, fontSize: 13 }}>
                  <summary>Public holidays this year ({d.holidays.length})</summary>
                  <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{d.holidays.map((h) => <li key={h.date}>{h.date} {h.name}</li>)}</ul>
                </details>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><span className="data-panel-title">Export / SSEG rule</span></CardHeader>
            <CardBody>
              <ExportRulePanel projectId={id} updatedAt={study.updatedAt} rule={study.exportRule} rates={d.exportRates} sourceNote={d.exportSourceNote}
                linkedExportTariff={pinned.exportTariff} sseg={pinned.sseg} ssegFromLibrary={pinned.ssegFromLibrary} />
            </CardBody>
          </Card>
        </>
      )}

      {/* Shown whenever a licensee is known: the defaults do not need a pinned tariff. */}
      {d.licensee && !pinned && d.calendarAssumedEskom && d.calendar && (
        <Card><CardBody><p style={NOTE}>TOU hours assumed equal to Eskom&apos;s — confirm against the municipality&apos;s by-law</p></CardBody></Card>
      )}

      <Card>
        <CardHeader><span className="data-panel-title">Escalation path</span></CardHeader>
        <CardBody><EscalationTable projectId={id} updatedAt={study.updatedAt} rows={d.escalation} /></CardBody>
      </Card>

      <Card>
        <CardHeader><span className="data-panel-title">Bill check</span></CardHeader>
        <CardBody><BillCheckPanel projectId={id} isTou={pinned?.isTou ?? false} history={d.billChecks} canRun={Boolean(pinned)} /></CardBody>
      </Card>
    </div>
  )
}
```

`tariff/LinkLicensee.tsx` (small client component the page uses when the Site & Supply name matches no library licensee):
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { setStudyLicenseeAction } from '@/actions/solar-tariff.actions'

export function LinkLicensee({ projectId, updatedAt, typedName, options }: {
  projectId: string; updatedAt: string; typedName: string; options: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
      <span>&ldquo;{typedName}&rdquo; is not in the tariff library under that name. Link it to:</span>
      <select aria-label="Library supply authority" value={id} onChange={(e) => setId(e.target.value)}>
        <option value="">Choose…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <Button size="sm" disabled={!id} isLoading={busy} onClick={async () => {
        setBusy(true); setError(null)
        const r = await setStudyLicenseeAction({ projectId, licenseeId: id, expectedUpdatedAt: updatedAt })
        setBusy(false)
        if ('error' in r) setError(r.error); else router.refresh()
      }}>Link</Button>
      {error && <span role="alert" style={{ color: 'var(--c-red)' }}>{error}</span>}
    </div>
  )
}
```

- [ ] **Step 5: Wire the Tariff readiness row into the chrome and the Overview**

In `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.tsx`:
- the studies select string `'latitude, longitude, licensee_name, nmd_kva'` becomes `'latitude, longitude, licensee_name, nmd_kva, tariff_id, export_rule'`;
- the import line gains `withTariffReadiness, toTariffReadinessInput`;
- `const readiness = computeSolarReadiness(toSiteReadinessInput(study), level)` becomes
```tsx
  const readiness = withTariffReadiness(computeSolarReadiness(toSiteReadinessInput(study), level), toTariffReadinessInput(study))
```
Make the same three edits in `(gated)/overview/page.tsx` (its select string and its `computeSolarReadiness(...)` call inside `<ReadinessChecklist steps={…} />`).

`tariff_id` and `export_rule` are readable at View (they hold no rand value — the manual export RATE is in the money table), so the chrome's select never fails for a View user; `withTariffReadiness` only touches a `tariff` step, which exists only at Edit + financials (`visibleSolarTabs`).

Extend the layout test (`(gated)/layout.test.tsx`) with:
```tsx
describe('Solar gated layout — Tariff readiness', () => {
  it('the Tariff dot is live and amber when a tariff is pinned without an export rule', async () => {
    const { client } = fakeSupabase({
      userId: 'u1',
      rpc: { solar_is_grantor: { data: true, error: null } },
      tables: {
        'projects.projects': [{ id: 'p1', name: 'Kings Mall', organisation_id: 'org-1' }],
        'solar.studies': [{ project_id: 'p1', latitude: -26, longitude: 28, licensee_name: 'X', nmd_kva: 500, tariff_id: 't1', export_rule: null }],
      },
    })
    h.createClient.mockResolvedValue(client)
    h.requireSolarLevel.mockResolvedValue('edit_financials')
    render(await SolarGatedLayout(args))
    expect(screen.getByRole('link', { name: /Tariff/ })).toBeDefined()
    expect(screen.getByTitle('Missing: export credit rule')).toBeDefined()
  })
})
```
(1c's `StatusDot` renders `title={reason}`, so the reason is queryable by title.)

- [ ] **Step 6: Run the tests — expect PASS**

```bash
pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar"
pnpm --filter @esite/shared exec vitest run src/solar
```
Expected: PASS — including 1c's `SolarTabBar.test.tsx` (the Tariff tab is now a link at Edit + financials and still hidden below it) and the new layout/page tests. If 1c's tab-bar test asserted that Tariff renders **disabled**, update that single assertion to "renders as a link to /solar/tariff" — the tab is built now.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar" packages/shared/src/solar/activity.ts packages/shared/src/solar/activity.test.ts
git commit -m "feat(solar-tariff): Tariff tab page, readiness dot and activity text

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
