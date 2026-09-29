# Solar Phase 7 — Part 2: `@esite/shared/solar-operations` (pure logic)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-29-solar-phase-7-0-index.md` first.

Everything in this part is pure TypeScript (no Supabase, no Next), unit-tested with vitest in `packages/shared`. The web app calls these functions on the server only. Directory: `packages/shared/src/solar/operations/`.

Run any one test file with:
```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7 && pnpm --filter @esite/shared test -- src/solar/operations/<file>.test.ts 2>&1 | tail -8
```

---

### Task 5: SAST calendar helpers + the package export

**Files:**
- Create: `packages/shared/src/solar/operations/time.ts`, `time.test.ts`, `index.ts`
- Modify: `packages/shared/package.json` (exports)

- [ ] **Step 1: Failing test** `time.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  addMonths, daysInMonth, isMonthKey, isoToSastLocal, monthEndMs, monthKeyOfMs, monthLabel, monthRange, monthStartMs,
  monthsBetween, sastLocalToIso, sastMidnightMs, sastParts,
} from './time'

describe('SAST calendar helpers', () => {
  it('a month starts at SAST midnight', () => {
    expect(monthStartMs('2026-03')).toBe(Date.parse('2026-03-01T00:00:00+02:00'))
    expect(monthEndMs('2026-12')).toBe(Date.parse('2027-01-01T00:00:00+02:00'))
  })
  it('an instant belongs to its SAST month (22:30 UTC on 31 Dec is already January in SAST)', () => {
    expect(monthKeyOfMs(Date.parse('2025-12-31T21:59:00Z'))).toBe('2025-12')
    expect(monthKeyOfMs(Date.parse('2025-12-31T22:00:00Z'))).toBe('2026-01')
  })
  it('adds and counts months across years in both directions', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2025-11', 14)).toBe('2027-01')
    expect(monthsBetween('2025-11', '2026-02')).toBe(3)
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(monthRange('2026-02', '2025-11')).toEqual([])
  })
  it('knows leap Februaries', () => {
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
  })
  it('splits an instant into SAST parts', () => {
    expect(sastParts(Date.parse('2026-06-21T04:30:00Z'))).toEqual({ year: 2026, month: 6, day: 21, hour: 6, minute: 30 })
    expect(sastMidnightMs('2026-02-15')).toBe(Date.parse('2026-02-15T00:00:00+02:00'))
  })
  it('validates and labels month keys', () => {
    expect(isMonthKey('2026-03')).toBe(true)
    expect(isMonthKey('2026-13')).toBe(false)
    expect(isMonthKey('2026-3')).toBe(false)
    expect(monthLabel('2026-03')).toBe('March 2026')
  })
  it('reads a datetime-local value as SAST and back', () => {
    expect(sastLocalToIso('2026-03-10T10:00')).toBe('2026-03-10T08:00:00.000Z')
    expect(sastLocalToIso('2026-02-30T10:00')).toBeNull()
    expect(sastLocalToIso('10:00')).toBeNull()
    expect(isoToSastLocal('2026-03-10T08:00:00.000Z')).toBe('2026-03-10T10:00')
  })
})
```

- [ ] **Step 2: Run — FAIL** (module missing).

- [ ] **Step 3: Implement** `time.ts`:

```ts
/**
 * Calendar helpers for Operations. Every month boundary is SAST (UTC+2, no DST), the same rule the
 * SQL aggregation uses (`AT TIME ZONE 'Africa/Johannesburg'`). An interval belongs to the month its
 * START falls in — never to a month chosen in the UI (WM defect G4).
 */
export const SAST_OFFSET_MS = 2 * 3_600_000
export type MonthKey = string

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export function isMonthKey(s: unknown): s is MonthKey {
  return typeof s === 'string' && MONTH_RE.test(s)
}

export function monthParts(k: MonthKey): { year: number; month: number } {
  const m = MONTH_RE.exec(k)
  if (!m) throw new Error(`not a month key: ${k}`)
  return { year: Number(m[1]), month: Number(m[2]) }
}

export function monthKey(year: number, month: number): MonthKey {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addMonths(k: MonthKey, n: number): MonthKey {
  const { year, month } = monthParts(k)
  const idx = year * 12 + (month - 1) + n
  const y = Math.floor(idx / 12)
  return monthKey(y, idx - y * 12 + 1)
}

export function monthsBetween(a: MonthKey, b: MonthKey): number {
  const pa = monthParts(a)
  const pb = monthParts(b)
  return (pb.year - pa.year) * 12 + (pb.month - pa.month)
}

/** Inclusive; empty when `to` is before `from`. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const n = monthsBetween(from, to)
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addMonths(from, i))
}

/** UTC epoch ms of SAST midnight on the 1st of the month. */
export function monthStartMs(k: MonthKey): number {
  const { year, month } = monthParts(k)
  return Date.UTC(year, month - 1, 1) - SAST_OFFSET_MS
}

export function monthEndMs(k: MonthKey): number {
  return monthStartMs(addMonths(k, 1))
}

export interface SastParts { year: number; month: number; day: number; hour: number; minute: number }

export function sastParts(ms: number): SastParts {
  const d = new Date(ms + SAST_OFFSET_MS)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

export function monthKeyOfMs(ms: number): MonthKey {
  const p = sastParts(ms)
  return monthKey(p.year, p.month)
}

/** 'YYYY-MM-DD' → UTC epoch ms of SAST midnight that day. */
export function sastMidnightMs(isoDate: string): number {
  const m = DATE_RE.exec(isoDate)
  if (!m) throw new Error(`not a date: ${isoDate}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - SAST_OFFSET_MS
}

/** 'YYYY-MM-DD' → its month key. */
export function dateMonthKey(isoDate: string): MonthKey {
  if (!DATE_RE.test(isoDate)) throw new Error(`not a date: ${isoDate}`)
  return isoDate.slice(0, 7)
}

export function monthLabel(k: MonthKey): string {
  const { year, month } = monthParts(k)
  return `${MONTH_NAMES[month - 1]} ${year}`
}

/** 'YYYY-MM' → 'YYYY-MM-01' (the DATE the database stores for a month). */
export function monthFirstDay(k: MonthKey): string {
  monthParts(k)
  return `${k}-01`
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** A `<input type="datetime-local">` value read as SAST → ISO UTC, or null when malformed. */
export function sastLocalToIso(local: string): string | null {
  const m = LOCAL_RE.exec(local)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number]
  const ms = Date.UTC(y, mo - 1, d, h, mi) - SAST_OFFSET_MS
  const back = sastParts(ms)
  if (back.year !== y || back.month !== mo || back.day !== d || back.hour !== h || back.minute !== mi) return null
  return new Date(ms).toISOString()
}

/** ISO → the SAST `datetime-local` value ('YYYY-MM-DDTHH:mm'). */
export function isoToSastLocal(iso: string): string {
  return new Date(Date.parse(iso) + SAST_OFFSET_MS).toISOString().slice(0, 16)
}
```

`index.ts`:
```ts
export * from './time'
```

- [ ] **Step 4: Add the subpath export** in `packages/shared/package.json`, after the `"./solar-reports"` line (keep every existing entry):

```json
    "./solar-operations": "./src/solar/operations/index.ts",
```

- [ ] **Step 5: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test -- src/solar/operations/time.test.ts 2>&1 | tail -4
git add packages/shared/src/solar/operations packages/shared/package.json
git commit -m "feat(solar): operations SAST calendar helpers and the solar-operations export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: As-built record

**Files:**
- Create: `packages/shared/src/solar/operations/as-built.ts`, `as-built.test.ts`
- Modify: `packages/shared/src/solar/operations/index.ts`

- [ ] **Step 1: Failing test** `as-built.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { asBuiltFromCase, equipmentComplete, parseAsBuilt, type CaseSystemLike } from './as-built'

const caseSys: CaseSystemLike = {
  pv: {
    dcKwp: 500, acKw: 400, tiltDeg: 15, azimuthDeg: 0,
    module: { make: 'Acme', model: 'M-550', pmaxW: 550 },
    inverter: { make: 'Volt', model: 'I-100', acKw: 100 },
  },
  battery: { enabled: true, unit: { make: 'Cell', model: 'B-10', usableKwh: 10, powerKw: 5 }, usableKwh: 200, maxDischargeKw: 100 },
}

describe('as-built record', () => {
  it('seeds equipment and sizes from the accepted case', () => {
    const a = asBuiltFromCase(caseSys)
    expect(a).toMatchObject({ dcKwp: 500, acKw: 400, batteryKwh: 200, batteryKw: 100, tiltDeg: 15, azimuthDeg: 0 })
    expect(a.equipment).toEqual([
      { kind: 'module', make: 'Acme', model: 'M-550', rating: 550, unit: 'W', quantity: 909 },
      { kind: 'inverter', make: 'Volt', model: 'I-100', rating: 100, unit: 'kW', quantity: 4 },
      { kind: 'battery', make: 'Cell', model: 'B-10', rating: 10, unit: 'kWh', quantity: 20 },
    ])
  })
  it('leaves equipment empty when the case names none (never a placeholder)', () => {
    const a = asBuiltFromCase({ ...caseSys, pv: { ...caseSys.pv, module: null, inverter: null }, battery: { ...caseSys.battery, enabled: false } })
    expect(a.equipment).toEqual([])
    expect(a.batteryKwh).toBeNull()
    expect(equipmentComplete(a)).toEqual({ ok: false, reason: 'Record at least one module line and one inverter line on the installation.' })
  })
  it('validates an edited record', () => {
    expect(parseAsBuilt({ ...asBuiltFromCase(caseSys), dcKwp: -1 }).ok).toBe(false)
    const r = parseAsBuilt({ ...asBuiltFromCase(caseSys), equipment: [{ kind: 'module', make: ' ', model: 'x', rating: 1, unit: 'W', quantity: 1 }] })
    expect(r.ok).toBe(false)
    expect(parseAsBuilt(asBuiltFromCase(caseSys))).toEqual({ ok: true, value: asBuiltFromCase(caseSys) })
    expect(equipmentComplete(asBuiltFromCase(caseSys))).toEqual({ ok: true, reason: null })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `as-built.ts`:

```ts
/**
 * The as-built system on an installation (spec §10: "installed system from accepted proposal case,
 * editable as-built"). Seeded from the accepted case's config; every line is editable afterwards.
 * The monthly report prints this table — an empty table is refused at Generate, never filled with
 * placeholders (WM defect M4).
 */
import { z } from 'zod'

export const EQUIPMENT_KINDS = ['module', 'inverter', 'battery', 'other'] as const
export const EQUIPMENT_UNITS = ['W', 'kW', 'kWh'] as const

const num = (min: number, max: number) => z.number().finite().min(min).max(max)

export const EquipmentLineSchema = z.object({
  kind: z.enum(EQUIPMENT_KINDS),
  make: z.string().trim().min(1).max(120),
  model: z.string().trim().min(1).max(120),
  rating: z.number().finite().positive().max(10_000_000),
  unit: z.enum(EQUIPMENT_UNITS),
  quantity: z.number().int().min(1).max(1_000_000),
}).strict()
export type EquipmentLine = z.infer<typeof EquipmentLineSchema>

export const AsBuiltSchema = z.object({
  dcKwp: num(0.1, 100_000),
  acKw: num(0.1, 100_000),
  batteryKwh: num(0, 1_000_000).nullable(),
  batteryKw: num(0, 1_000_000).nullable(),
  tiltDeg: num(0, 90).nullable(),
  azimuthDeg: z.number().finite().min(0).lt(360).nullable(),
  equipment: z.array(EquipmentLineSchema).max(50),
}).strict()
export type AsBuilt = z.infer<typeof AsBuiltSchema>

/** The parts of 4b's CaseConfig the seed reads (structural, so the full config type is not imported). */
export interface CaseSystemLike {
  pv: {
    dcKwp: number; acKw: number; tiltDeg: number; azimuthDeg: number
    module: { make: string; model: string; pmaxW: number } | null
    inverter: { make: string; model: string; acKw: number } | null
  }
  battery: {
    enabled: boolean
    unit: { make: string; model: string; usableKwh: number; powerKw: number } | null
    usableKwh: number; maxDischargeKw: number
  }
}

export function asBuiltFromCase(c: CaseSystemLike): AsBuilt {
  const equipment: EquipmentLine[] = []
  if (c.pv.module) {
    equipment.push({ kind: 'module', make: c.pv.module.make, model: c.pv.module.model, rating: c.pv.module.pmaxW, unit: 'W',
      quantity: Math.max(1, Math.round((c.pv.dcKwp * 1000) / c.pv.module.pmaxW)) })
  }
  if (c.pv.inverter) {
    equipment.push({ kind: 'inverter', make: c.pv.inverter.make, model: c.pv.inverter.model, rating: c.pv.inverter.acKw, unit: 'kW',
      quantity: Math.max(1, Math.round(c.pv.acKw / c.pv.inverter.acKw)) })
  }
  if (c.battery.enabled && c.battery.unit) {
    equipment.push({ kind: 'battery', make: c.battery.unit.make, model: c.battery.unit.model, rating: c.battery.unit.usableKwh, unit: 'kWh',
      quantity: Math.max(1, Math.round(c.battery.usableKwh / c.battery.unit.usableKwh)) })
  }
  return {
    dcKwp: c.pv.dcKwp, acKw: c.pv.acKw,
    batteryKwh: c.battery.enabled ? c.battery.usableKwh : null,
    batteryKw: c.battery.enabled ? c.battery.maxDischargeKw : null,
    tiltDeg: c.pv.tiltDeg, azimuthDeg: c.pv.azimuthDeg,
    equipment,
  }
}

export function parseAsBuilt(raw: unknown): { ok: true; value: AsBuilt } | { ok: false; errors: string[] } {
  const r = AsBuiltSchema.safeParse(raw)
  if (r.success) return { ok: true, value: r.data }
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || 'record'}: ${i.message}`) }
}

export function equipmentComplete(a: AsBuilt): { ok: boolean; reason: string | null } {
  const has = (k: EquipmentLine['kind']) => a.equipment.some((e) => e.kind === k)
  return has('module') && has('inverter')
    ? { ok: true, reason: null }
    : { ok: false, reason: 'Record at least one module line and one inverter line on the installation.' }
}
```

Append to `index.ts`: `export * from './as-built'`

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): as-built record seeded from the accepted case").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test -- src/solar/operations/as-built.test.ts 2>&1 | tail -4
git add packages/shared/src/solar/operations && git commit -m "feat(solar): as-built record seeded from the accepted case

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The frozen modelled baseline

**Files:**
- Create: `packages/shared/src/solar/operations/baseline.ts`, `baseline.test.ts`
- Modify: `index.ts`

- [ ] **Step 1: Failing test** `baseline.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { HOURS_PER_YEAR, monthHourRanges } from '../../services/solar/time'
import { buildBaseline, diurnalProfile, monthlyGhiKwhM2, readBaseline } from './baseline'

// PV = 10 kW from 08:00 to 15:59 SAST every day, else 0.
const pvAc = Float64Array.from({ length: HOURS_PER_YEAR }, (_, h) => (h % 24 >= 8 && h % 24 < 16 ? 10 : 0))
const monthly = monthHourRanges().map(({ month, start, end }) => ({ month, pvKwh: ((end - start) / 24) * 80 }))

describe('baseline', () => {
  it('diurnal profile = mean kW per SAST hour of day, per month', () => {
    const d = diurnalProfile(pvAc)
    expect(d).toHaveLength(12)
    expect(d[0]).toHaveLength(24)
    expect(d[5]![7]).toBe(0)
    expect(d[5]![8]).toBe(10)
    expect(d[5]![15]).toBe(10)
    expect(d[5]![16]).toBe(0)
  })
  it('monthly GHI from TMY rows (W/m² hourly means → kWh/m²)', () => {
    const rows = [{ month: 1, ghi: 500 }, { month: 1, ghi: 500 }, { month: 2, ghi: 1000 }]
    const g = monthlyGhiKwhM2(rows)
    expect(g[0]).toBe(1)
    expect(g[1]).toBe(1)
    expect(g[2]).toBe(0)
  })
  it('builds and re-reads a baseline', () => {
    const b = buildBaseline({
      caseRunId: 'r1', inputsHash: 'h'.repeat(64), kpis: { dcKwp: 100, acKw: 80, performanceRatio: 0.81 },
      monthly: [...monthly].reverse(), pvAc, tmyRows: null,
    })
    expect(b.monthlyKwh[0]).toBe(31 * 80)
    expect(b.monthlyKwh[1]).toBe(28 * 80)
    expect(b.ghiKwhM2).toBeNull()
    expect(readBaseline(JSON.parse(JSON.stringify(b)))).toEqual(b)
  })
  it('refuses a run without twelve months', () => {
    expect(() => buildBaseline({ caseRunId: 'r1', inputsHash: 'h', kpis: { dcKwp: 1, acKw: 1, performanceRatio: 0.8 }, monthly: monthly.slice(0, 11), pvAc, tmyRows: null }))
      .toThrow('twelve monthly rows')
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `baseline.ts`:

```ts
/**
 * The modelled baseline frozen into an installation at creation (index decision 2). It is what the
 * guarantee, the shaped expectation and the irradiation correction are measured against, so a later
 * case edit, re-run or deletion can never change the guarantee of an operating plant.
 *   monthlyKwh  12 × P50 AC kWh of the accepted run (TMY months; February has 28 days)
 *   diurnalKw   12 × 24 mean PV kW per SAST hour of day (the shape used to value downtime)
 *   ghiKwhM2    12 × TMY GHI kWh/m² (for a GHI-based irradiation correction), or null
 */
import { z } from 'zod'
import { HOURS_PER_YEAR, monthHourRanges } from '../../services/solar/time'

export const BASELINE_VERSION = 1 as const

export const OpsBaselineSchema = z.object({
  version: z.literal(BASELINE_VERSION),
  caseRunId: z.string().min(1),
  inputsHash: z.string().min(1),
  dcKwp: z.number().finite().positive(),
  acKw: z.number().finite().positive(),
  performanceRatio: z.number().finite().min(0).max(1.5),
  monthlyKwh: z.array(z.number().finite().min(0)).length(12),
  diurnalKw: z.array(z.array(z.number().finite().min(0)).length(24)).length(12),
  ghiKwhM2: z.array(z.number().finite().min(0)).length(12).nullable(),
}).strict()
export type OpsBaseline = z.infer<typeof OpsBaselineSchema>

const r4 = (x: number) => Math.round(x * 10_000) / 10_000
const r2 = (x: number) => Math.round(x * 100) / 100

export function diurnalProfile(pvAc: ArrayLike<number>): number[][] {
  if (pvAc.length !== HOURS_PER_YEAR) throw new Error(`the PV series must have ${HOURS_PER_YEAR} hours`)
  return monthHourRanges().map(({ start, end }) => {
    const sums = new Array<number>(24).fill(0)
    const days = (end - start) / 24
    for (let h = start; h < end; h++) sums[h % 24] = sums[h % 24]! + pvAc[h]!
    return sums.map((s) => r4(s / days))
  })
}

export function monthlyGhiKwhM2(rows: ReadonlyArray<{ month: number; ghi: number }>): number[] {
  const wh = new Array<number>(12).fill(0)
  for (const r of rows) if (r.month >= 1 && r.month <= 12 && Number.isFinite(r.ghi)) wh[r.month - 1] = wh[r.month - 1]! + r.ghi
  return wh.map((v) => r2(v / 1000))
}

export interface BuildBaselineInput {
  caseRunId: string
  inputsHash: string
  kpis: { dcKwp: number; acKw: number; performanceRatio: number }
  monthly: ReadonlyArray<{ month: number; pvKwh: number }>
  pvAc: ArrayLike<number>
  tmyRows: ReadonlyArray<{ month: number; ghi: number }> | null
}

export function buildBaseline(i: BuildBaselineInput): OpsBaseline {
  const byMonth = [...i.monthly].sort((a, b) => a.month - b.month)
  if (byMonth.length !== 12 || byMonth.some((r, k) => r.month !== k + 1)) throw new Error('the run must have twelve monthly rows')
  return OpsBaselineSchema.parse({
    version: BASELINE_VERSION,
    caseRunId: i.caseRunId,
    inputsHash: i.inputsHash,
    dcKwp: i.kpis.dcKwp,
    acKw: i.kpis.acKw,
    performanceRatio: i.kpis.performanceRatio,
    monthlyKwh: byMonth.map((r) => r2(r.pvKwh)),
    diurnalKw: diurnalProfile(i.pvAc),
    ghiKwhM2: i.tmyRows ? monthlyGhiKwhM2(i.tmyRows) : null,
  })
}

export function readBaseline(raw: unknown): OpsBaseline {
  return OpsBaselineSchema.parse(raw)
}
```

Append to `index.ts`: `export * from './baseline'`

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): frozen operations baseline (monthly P50, diurnal shape, TMY GHI)").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test -- src/solar/operations/baseline.test.ts 2>&1 | tail -4
git add packages/shared/src/solar/operations && git commit -m "feat(solar): frozen operations baseline (monthly P50, diurnal shape, TMY GHI)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Guarantee basis → expected kWh per month

**Files:**
- Create: `packages/shared/src/solar/operations/guarantee.ts`, `guarantee.test.ts`
- Create: `packages/shared/src/solar/operations/__fixtures__/baseline.ts` (shared test fixture)
- Modify: `index.ts`

- [ ] **Step 1: Create the fixture** `__fixtures__/baseline.ts`:

```ts
import type { OpsBaseline } from '../baseline'

/** 100 kWp; 1,000 kWh in every TMY month; PV only 10:00–13:59 SAST, flat. */
export const flatBaseline = (over: Partial<OpsBaseline> = {}): OpsBaseline => ({
  version: 1, caseRunId: 'run-1', inputsHash: 'a'.repeat(64), dcKwp: 100, acKw: 80, performanceRatio: 0.8,
  monthlyKwh: new Array(12).fill(1000),
  diurnalKw: Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 14 ? 5 : 0))),
  ghiKwhM2: new Array(12).fill(200),
  ...over,
})
```

- [ ] **Step 2: Failing test** `guarantee.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { expectedForMonth, guaranteeFromRow, modelledMonthKwh, operatingYear, parseGuarantee } from './guarantee'
import { flatBaseline } from './__fixtures__/baseline'

const b = flatBaseline()
const p50 = { basis: 'p50' as const, pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0 }

describe('guarantee derivation (no retyping per month)', () => {
  it('P50 = the baseline month, scaled for a leap February', () => {
    expect(modelledMonthKwh(b, '2026-02')).toBe(1000)
    expect(modelledMonthKwh(b, '2028-02')).toBeCloseTo(1000 * 29 / 28, 6)
  })
  it('nothing is expected before the commissioning month', () => {
    expect(expectedForMonth({ month: '2026-01', guarantee: p50, baseline: b, commissioningDate: '2026-02-15' })).toBeNull()
  })
  it('the commissioning month is prorated by days, from the commissioning day inclusive', () => {
    const e = expectedForMonth({ month: '2026-02', guarantee: p50, baseline: b, commissioningDate: '2026-02-15' })!
    expect(e.fullKwh).toBe(1000)
    expect(e.activeFraction).toBeCloseTo(14 / 28, 6)
    expect(e.kwh).toBeCloseTo(500, 3)
    expect(e.operatingYear).toBe(1)
  })
  it('degrades P50 and % of modelled from operating year 2; manual is the contract and is not degraded', () => {
    expect(operatingYear('2026-02-15', '2027-01')).toBe(1)
    expect(operatingYear('2026-02-15', '2027-02')).toBe(2)
    const d = { ...p50, degradationPctPerYear: 0.5 }
    expect(expectedForMonth({ month: '2027-03', guarantee: d, baseline: b, commissioningDate: '2026-02-15' })!.kwh).toBeCloseTo(995, 6)
    const pct = { ...d, basis: 'pct_of_modelled' as const, pct: 90 }
    expect(expectedForMonth({ month: '2027-03', guarantee: pct, baseline: b, commissioningDate: '2026-02-15' })!.kwh).toBeCloseTo(895.5, 6)
    const manual = { basis: 'manual' as const, pct: null, manualMonthlyKwh: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], degradationPctPerYear: 0.5 }
    expect(expectedForMonth({ month: '2027-03', guarantee: manual, baseline: b, commissioningDate: '2026-02-15' })!.kwh).toBe(3)
  })
  it('validates the basis fields exactly like the database CHECKs', () => {
    expect(parseGuarantee({ ...p50, basis: 'pct_of_modelled' }).ok).toBe(false)
    expect(parseGuarantee({ ...p50, basis: 'manual', manualMonthlyKwh: [1, 2] }).ok).toBe(false)
    expect(parseGuarantee({ ...p50, pct: 50 }).ok).toBe(false)
    expect(parseGuarantee({ ...p50, degradationPctPerYear: 6 }).ok).toBe(false)
    expect(parseGuarantee(p50)).toEqual({ ok: true, value: p50 })
  })
  it('maps a database row (numeric columns arrive as strings)', () => {
    expect(guaranteeFromRow({ basis: 'pct_of_modelled', pct: '92.50', manual_monthly_kwh: null, degradation_pct_per_year: '0.400' }))
      .toEqual({ basis: 'pct_of_modelled', pct: 92.5, manualMonthlyKwh: null, degradationPctPerYear: 0.4 })
  })
})
```

- [ ] **Step 3: Run — FAIL. Implement** `guarantee.ts`:

```ts
/**
 * Expected generation per month, derived from ONE guarantee basis (spec §10: "auto-derived per month
 * from the case run (no retyping each month)"; WM typed it monthly — defect D.7):
 *   p50              baseline month × (1 − degradation)^(operating year − 1)
 *   pct_of_modelled  pct % of that
 *   manual           the contract's 12 monthly kWh (not degraded: the contract is its own schedule)
 * The commissioning month is prorated by days; a leap February is scaled 29/28 (TMY Feb = 28 days).
 */
import { z } from 'zod'
import type { OpsBaseline } from './baseline'
import { dateMonthKey, daysInMonth, monthParts, monthsBetween, type MonthKey } from './time'

export const GUARANTEE_BASES = ['p50', 'manual', 'pct_of_modelled'] as const
export type GuaranteeBasis = (typeof GUARANTEE_BASES)[number]
export const GUARANTEE_BASIS_LABELS: Record<GuaranteeBasis, string> = {
  p50: 'P50 of the accepted case',
  manual: 'Manual monthly kWh (contract schedule)',
  pct_of_modelled: '% of modelled (P50)',
}
export const TMY_DAYS: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export interface Guarantee {
  basis: GuaranteeBasis
  pct: number | null
  manualMonthlyKwh: number[] | null
  degradationPctPerYear: number
}

export const GuaranteeSchema = z.object({
  basis: z.enum(GUARANTEE_BASES),
  pct: z.number().finite().gt(0).max(200).nullable(),
  manualMonthlyKwh: z.array(z.number().finite().min(0)).length(12).nullable(),
  degradationPctPerYear: z.number().finite().min(0).max(5),
}).strict().superRefine((g, ctx) => {
  if ((g.basis === 'pct_of_modelled') !== (g.pct !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pct'], message: 'A percentage is needed for "% of modelled", and only for it.' })
  }
  if ((g.basis === 'manual') !== (g.manualMonthlyKwh !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['manualMonthlyKwh'], message: 'Twelve monthly kWh values are needed for "Manual", and only for it.' })
  }
})

export function parseGuarantee(raw: unknown): { ok: true; value: Guarantee } | { ok: false; errors: Record<string, string> } {
  const r = GuaranteeSchema.safeParse(raw)
  if (r.success) return { ok: true, value: r.data }
  const errors: Record<string, string> = {}
  for (const i of r.error.issues) errors[String(i.path[0] ?? 'basis')] ??= i.message
  return { ok: false, errors }
}

const n = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export function guaranteeFromRow(row: Record<string, unknown>): Guarantee {
  const manual = row.manual_monthly_kwh
  return {
    basis: row.basis as GuaranteeBasis,
    pct: n(row.pct),
    manualMonthlyKwh: Array.isArray(manual) ? manual.map((v) => Number(v)) : null,
    degradationPctPerYear: n(row.degradation_pct_per_year) ?? 0,
  }
}

/** 1 for the first twelve months from the commissioning month, then 2, … */
export function operatingYear(commissioningDate: string, month: MonthKey): number {
  const m = monthsBetween(dateMonthKey(commissioningDate), month)
  return Math.max(1, Math.floor(m / 12) + 1)
}

/** The baseline's P50 for an ACTUAL calendar month (leap February scaled). */
export function modelledMonthKwh(b: OpsBaseline, month: MonthKey): number {
  const { year, month: m } = monthParts(month)
  return (b.monthlyKwh[m - 1]! * daysInMonth(year, m)) / TMY_DAYS[m - 1]!
}

export interface MonthExpectation {
  /** The whole month's expectation (used to shape per-interval expectations). */
  fullKwh: number
  /** Prorated for the commissioning month. */
  kwh: number
  activeFraction: number
  operatingYear: number
}

export function expectedForMonth(i: { month: MonthKey; guarantee: Guarantee; baseline: OpsBaseline; commissioningDate: string }): MonthExpectation | null {
  const commMonth = dateMonthKey(i.commissioningDate)
  if (monthsBetween(commMonth, i.month) < 0) return null
  const { year, month: m } = monthParts(i.month)
  const year1 = operatingYear(i.commissioningDate, i.month)
  const g = i.guarantee
  const full = g.basis === 'manual'
    ? g.manualMonthlyKwh![m - 1]!
    : modelledMonthKwh(i.baseline, i.month) * (g.basis === 'pct_of_modelled' ? g.pct! / 100 : 1)
      * (1 - g.degradationPctPerYear / 100) ** (year1 - 1)
  const days = daysInMonth(year, m)
  const fraction = i.month === commMonth ? (days - Number(i.commissioningDate.slice(8, 10)) + 1) / days : 1
  return { fullKwh: full, kwh: full * fraction, activeFraction: fraction, operatingYear: year1 }
}
```

Append to `index.ts`: `export * from './guarantee'`

- [ ] **Step 4: Run — PASS; commit** ("feat(solar): derive expected kWh per month from one guarantee basis").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test -- src/solar/operations/guarantee.test.ts 2>&1 | tail -4
git add packages/shared/src/solar/operations && git commit -m "feat(solar): derive expected kWh per month from one guarantee basis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Shaped expectation for any window

**Files:**
- Create: `packages/shared/src/solar/operations/shape.ts`, `shape.test.ts`
- Modify: `index.ts`

- [ ] **Step 1: Failing test** `shape.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { expectedKwhBetween, hourShare } from './shape'
import { monthEndMs, monthStartMs } from './time'
import { flatBaseline } from './__fixtures__/baseline'

const b = flatBaseline()
const full = () => 1000

describe('shaped expectation (not a flat per-slot figure, WM G14)', () => {
  it('a whole month sums to the month expectation', () => {
    expect(expectedKwhBetween(b, full, monthStartMs('2026-03'), monthEndMs('2026-03'))).toBeCloseTo(1000, 6)
  })
  it('night hours expect nothing; a producing hour expects its share', () => {
    expect(hourShare(b, '2026-03', 2)).toBe(0)
    expect(hourShare(b, '2026-03', 11)).toBeCloseTo(1 / (4 * 31), 9)
    const t0 = Date.parse('2026-03-10T11:00:00+02:00')
    expect(expectedKwhBetween(b, full, t0, t0 + 3_600_000)).toBeCloseTo(1000 / (4 * 31), 6)
    expect(expectedKwhBetween(b, full, t0 - 9 * 3_600_000, t0 - 8 * 3_600_000)).toBe(0)
  })
  it('splits partial hours and crosses month boundaries with each month’s own kWh', () => {
    const t0 = Date.parse('2026-03-10T11:15:00+02:00')
    expect(expectedKwhBetween(b, full, t0, t0 + 30 * 60_000)).toBeCloseTo(0.5 * 1000 / (4 * 31), 6)
    const perMonth = (k: string) => (k === '2026-03' ? 1000 : 2000)
    const total = expectedKwhBetween(b, perMonth, monthStartMs('2026-03'), monthEndMs('2026-04'))
    expect(total).toBeCloseTo(3000, 6)
  })
  it('an empty or inverted window is zero', () => {
    expect(expectedKwhBetween(b, full, 10, 10)).toBe(0)
    expect(expectedKwhBetween(b, full, 20, 10)).toBe(0)
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `shape.ts`:

```ts
/**
 * Expected energy inside any window, shaped by the baseline's diurnal profile: an hour's share of the
 * month is profile[hour] / (Σ profile × days in month). A zero at noon is therefore worth far more
 * than a zero at 07:00 — the opposite of WM's flat per-slot expectation (defect G14).
 * `fullKwhFor(month)` is the FULL (unprorated) month expectation from guarantee.ts.
 */
import type { OpsBaseline } from './baseline'
import { daysInMonth, monthKeyOfMs, monthParts, sastParts, type MonthKey } from './time'

const HOUR_MS = 3_600_000

export function hourShare(b: OpsBaseline, month: MonthKey, hourOfDay: number): number {
  const { year, month: m } = monthParts(month)
  const profile = b.diurnalKw[m - 1]!
  const daySum = profile.reduce((s, v) => s + v, 0)
  if (daySum <= 0) return 0
  return profile[hourOfDay]! / (daySum * daysInMonth(year, m))
}

export function expectedKwhBetween(b: OpsBaseline, fullKwhFor: (month: MonthKey) => number, startMs: number, endMs: number): number {
  let kwh = 0
  let t = startMs
  while (t < endMs) {
    // SAST is a whole-hour offset, so SAST hour boundaries are UTC hour boundaries.
    const segEnd = Math.min(endMs, (Math.floor(t / HOUR_MS) + 1) * HOUR_MS)
    const month = monthKeyOfMs(t)
    kwh += fullKwhFor(month) * hourShare(b, month, sastParts(t).hour) * ((segEnd - t) / HOUR_MS)
    t = segEnd
  }
  return kwh
}
```

Append to `index.ts`: `export * from './shape'`

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): shaped expected energy for any window").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test -- src/solar/operations/shape.test.ts 2>&1 | tail -4
git add packages/shared/src/solar/operations && git commit -m "feat(solar): shaped expected energy for any window

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Downtime candidates from the sun's position

**Files:**
- Create: `packages/shared/src/solar/operations/downtime-detect.ts`, `downtime-detect.test.ts`
- Modify: `index.ts`

- [ ] **Step 1: Failing test** `downtime-detect.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectDowntimeCandidates, isDaylight, zeroThresholdKw, type SeriesPoint } from './downtime-detect'

const PTA = { latitude: -25.75, longitude: 28.19, elevationM: 1339 }
const at = (iso: string) => Date.parse(iso)
/** One clear day, 30-min points: 40 kW for interval ends 06:30 to 18:30 (all of March daylight in Pretoria), except zeros where asked. */
function day(date: string, zerosAt: string[] = [], missing: string[] = []): SeriesPoint[] {
  const out: SeriesPoint[] = []
  for (let k = 1; k <= 48; k++) {
    const end = at(`${date}T00:00:00+02:00`) + k * 30 * 60_000
    const hhmm = new Date(end + 2 * 3_600_000).toISOString().slice(11, 16)
    if (missing.includes(hhmm)) continue
    const producing = hhmm >= '06:30' && hhmm <= '18:30'
    out.push({ endMs: end, kw: producing && !zerosAt.includes(hhmm) ? 40 : 0, intervalMin: 30 })
  }
  return out
}

describe('daylight = SPA elevation > 5° at the interval midpoint (not a fixed 06:00–17:30 window, WM G14)', () => {
  it('06:30 SAST is dark at the June solstice and light at the December solstice in Pretoria', () => {
    expect(isDaylight(at('2026-06-21T06:30:00+02:00'), PTA)).toBe(false)
    expect(isDaylight(at('2026-12-21T06:30:00+02:00'), PTA)).toBe(true)
    expect(isDaylight(at('2026-06-21T12:00:00+02:00'), PTA)).toBe(true)
    expect(isDaylight(at('2026-06-21T17:45:00+02:00'), PTA)).toBe(false)
  })
  it('the zero threshold is 0.5 % of AC kW, never below 10 W', () => {
    expect(zeroThresholdKw(80)).toBeCloseTo(0.4, 9)
    expect(zeroThresholdKw(1)).toBe(0.01)
  })
})

describe('detectDowntimeCandidates', () => {
  it('proposes consecutive zero daylight intervals as one window', () => {
    const c = detectDowntimeCandidates(day('2026-03-10', ['12:00', '12:30', '13:00']), PTA, 80, [])
    expect(c).toEqual([{ startsAt: '2026-03-10T09:30:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', intervals: 3, hours: 1.5 }])
  })
  it('ignores night zeros and a single isolated zero', () => {
    expect(detectDowntimeCandidates(day('2026-03-10', ['10:00']), PTA, 80, [])).toEqual([])
  })
  it('never treats missing data as downtime: a gap splits a run', () => {
    const c = detectDowntimeCandidates(day('2026-03-10', ['12:00', '13:00'], ['12:30']), PTA, 80, [])
    expect(c).toEqual([])
  })
  it('does not re-propose a window already recorded', () => {
    const rec = [{ startMs: at('2026-03-10T11:45:00+02:00'), endMs: at('2026-03-10T12:15:00+02:00') }]
    expect(detectDowntimeCandidates(day('2026-03-10', ['12:00', '12:30', '13:00']), PTA, 80, rec)).toEqual([])
  })
  it('does not flag a winter 06:30 zero that WM’s fixed window would have', () => {
    const pts: SeriesPoint[] = [
      { endMs: at('2026-06-21T06:30:00+02:00'), kw: 0, intervalMin: 30 },
      { endMs: at('2026-06-21T07:00:00+02:00'), kw: 0, intervalMin: 30 },
    ]
    expect(detectDowntimeCandidates(pts, PTA, 80, [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `downtime-detect.ts`:

```ts
/**
 * Auto-detected downtime CANDIDATES (spec §10: "zero output during daylight from the weather file's
 * sun position, not a fixed 06:00–17:30 window"). Daylight = the engine's SPA sun elevation at the
 * interval MIDPOINT is above 5°. Zero = at most 0.5 % of as-built AC kW. A candidate is at least two
 * CONSECUTIVE zero daylight intervals; a missing reading is a data gap and breaks the run — it is
 * never booked as downtime (WM G14). The user confirms a candidate to record it.
 */
import { solarPosition } from '../../services/solar/solar-position/spa'

export interface SeriesPoint { endMs: number; kw: number; intervalMin: number }
export interface SiteLocation { latitude: number; longitude: number; elevationM: number }
export interface TimeWindow { startMs: number; endMs: number }
export interface DowntimeCandidate { startsAt: string; endsAt: string; intervals: number; hours: number }

export const DAYLIGHT_ELEVATION_DEG = 5
export const ZERO_OUTPUT_FRACTION = 0.005
export const MIN_CANDIDATE_INTERVALS = 2

export function sunElevationDeg(ms: number, site: SiteLocation): number {
  return solarPosition(ms, site.latitude, site.longitude, { elevationM: site.elevationM, pressureHpa: 1013.25, temperatureC: 20 }).elevation
}

export function isDaylight(ms: number, site: SiteLocation): boolean {
  return sunElevationDeg(ms, site) > DAYLIGHT_ELEVATION_DEG
}

export function zeroThresholdKw(acKw: number): number {
  return Math.max(ZERO_OUTPUT_FRACTION * acKw, 0.01)
}

export function detectDowntimeCandidates(
  points: readonly SeriesPoint[],
  site: SiteLocation,
  acKw: number,
  recorded: readonly TimeWindow[],
): DowntimeCandidate[] {
  const threshold = zeroThresholdKw(acKw)
  const sorted = [...points].sort((a, b) => a.endMs - b.endMs)
  const out: DowntimeCandidate[] = []
  let run: SeriesPoint[] = []
  const flush = () => {
    if (run.length >= MIN_CANDIDATE_INTERVALS) {
      const startMs = run[0]!.endMs - run[0]!.intervalMin * 60_000
      const endMs = run[run.length - 1]!.endMs
      if (!recorded.some((w) => w.startMs < endMs && startMs < w.endMs)) {
        out.push({
          startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString(),
          intervals: run.length, hours: Math.round(((endMs - startMs) / 3_600_000) * 100) / 100,
        })
      }
    }
    run = []
  }
  for (const p of sorted) {
    const midMs = p.endMs - p.intervalMin * 30_000
    if (!(p.kw <= threshold && isDaylight(midMs, site))) {
      flush()
      continue
    }
    const prev = run[run.length - 1]
    if (prev && p.endMs - prev.endMs !== p.intervalMin * 60_000) flush()
    run.push(p)
  }
  flush()
  return out
}
```

Append to `index.ts`: `export * from './downtime-detect'`

- [ ] **Step 3: Run — PASS.** If the solstice assertions fail, print `sunElevationDeg` for the four instants before touching anything: expected roughly −3° (June 06:30), +16° (December 06:30), +41° (June noon), −6° (June 17:45). A sign error there means the wrong argument order to `solarPosition` (it is `(unixMs, latDeg, lonDeg, options)`).

- [ ] **Step 4: Commit** ("feat(solar): SPA-based downtime candidates; gaps are never downtime").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
git add packages/shared/src/solar/operations && git commit -m "feat(solar): SPA-based downtime candidates; gaps are never downtime

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Monthly performance rows, per-source split and real year-to-date

**Files:**
- Create: `packages/shared/src/solar/operations/performance.ts`, `performance.test.ts`
- Modify: `index.ts`

- [ ] **Step 1: Failing test** `performance.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { downtimeHoursInMonth, performanceRows, sourceRows, totalsByMonth, yearToDate, type PerformanceInput } from './performance'
import { flatBaseline } from './__fixtures__/baseline'

const base = (over: Partial<PerformanceInput> = {}): PerformanceInput => ({
  months: ['2026-02', '2026-03', '2026-04'],
  baseline: flatBaseline(),
  guarantee: { basis: 'p50', pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0 },
  commissioningDate: '2026-02-15',
  dcKwp: 100,
  actual: { '2026-02': { kwh: 450, coverageMinutes: 14 * 1440 }, '2026-03': { kwh: 900, coverageMinutes: 31 * 1440 } },
  generationMeterCount: 1,
  downtime: [],
  irradiation: [],
  ...over,
})

describe('performanceRows', () => {
  it('expected, actual, variance and coverage per month; a month with no data has actual null', () => {
    const rows = performanceRows(base())
    expect(rows.map((r) => r.month)).toEqual(['2026-02', '2026-03', '2026-04'])
    expect(rows[0]).toMatchObject({ expectedKwh: 500, guaranteeKwh: 500, actualKwh: 450, varianceKwh: -50, variancePct: -10, coveragePct: 100 })
    expect(rows[1]).toMatchObject({ guaranteeKwh: 1000, actualKwh: 900, variancePct: -10 })
    expect(rows[2]).toMatchObject({ actualKwh: null, variancePct: null, coveragePct: null })
  })
  it('excluded downtime lowers the guarantee by the SHAPED expectation of its window', () => {
    // 11:00–13:00 on 10 March: 2 producing hours of 4 per day, 31 days → 2/124 of 1000 kWh.
    const rows = performanceRows(base({ downtime: [{ id: 'd1', startsAt: '2026-03-10T09:00:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', cause: 'grid_outage', description: null, excludedFromGuarantee: true, source: 'manual' }] }))
    const m = rows[1]!
    expect(m.excludedKwh).toBeCloseTo(1000 * 2 / 124, 6)
    expect(m.guaranteeKwh).toBeCloseTo(1000 - 1000 * 2 / 124, 6)
    expect(m.downtimeHours).toBe(2)
    expect(m.excludedHours).toBe(2)
  })
  it('POA irradiation gives PR and a PR-corrected expectation; GHI gives a ratio correction and no PR', () => {
    const poa = performanceRows(base({ irradiation: [{ month: '2026-03', plane: 'poa', kwhPerM2: 150, sourceNote: 'Station' }] }))[1]!
    expect(poa.performanceRatio).toBeCloseTo(900 / (100 * 150), 9)
    expect(poa.correctedExpectedKwh).toBeCloseTo(0.8 * 100 * 150, 6)
    const ghi = performanceRows(base({ irradiation: [{ month: '2026-03', plane: 'ghi', kwhPerM2: 180, sourceNote: 'Portal' }] }))[1]!
    expect(ghi.performanceRatio).toBeNull()
    expect(ghi.correctedExpectedKwh).toBeCloseTo(1000 * 180 / 200, 6)
  })
  it('months before commissioning are dropped', () => {
    expect(performanceRows(base({ months: ['2026-01', '2026-02'] })).map((r) => r.month)).toEqual(['2026-02'])
  })
})

describe('yearToDate — real sums, never the month repeated (WM M4)', () => {
  it('sums January (or commissioning) to the report month', () => {
    const rows = performanceRows(base())
    const y = yearToDate(rows, '2026-03')
    expect(y).toMatchObject({ year: 2026, fromMonth: '2026-02', toMonth: '2026-03', guaranteeKwh: 1500, actualKwh: 1350, monthsWithoutData: 0 })
    expect(y.variancePct).toBeCloseTo(-10, 9)
    expect(y.actualKwh).not.toBe(rows[1]!.actualKwh)
    expect(yearToDate(rows, '2026-04').monthsWithoutData).toBe(1)
  })
})

describe('helpers', () => {
  it('sums meters per month and counts downtime hours inside the month only', () => {
    expect(totalsByMonth({ a: { '2026-03': { kwh: 10, n: 2, intervalMin: 30 } }, b: { '2026-03': { kwh: 5, n: 4, intervalMin: 15 } } }))
      .toEqual({ '2026-03': { kwh: 15, coverageMinutes: 120 } })
    const d = [{ id: 'x', startsAt: '2026-03-31T20:00:00.000Z', endsAt: '2026-04-01T02:00:00.000Z', cause: 'other', description: null, excludedFromGuarantee: false, source: 'manual' as const }]
    expect(downtimeHoursInMonth(d, '2026-03')).toEqual({ total: 2, excluded: 0 })
    expect(downtimeHoursInMonth(d, '2026-04')).toEqual({ total: 4, excluded: 0 })
  })
  it('splits expected per source by share, or equally when no share is set', () => {
    const mm = { m1: { '2026-03': { kwh: 600, n: 1, intervalMin: 30 } }, m2: { '2026-03': { kwh: 300, n: 1, intervalMin: 30 } } }
    expect(sourceRows([{ meterId: 'm1', label: 'A', sharePct: null }, { meterId: 'm2', label: 'B', sharePct: null }], mm, '2026-03', 1000))
      .toEqual([
        { meterId: 'm1', label: 'A', sharePct: 50, expectedKwh: 500, actualKwh: 600, allocatedEqually: true },
        { meterId: 'm2', label: 'B', sharePct: 50, expectedKwh: 500, actualKwh: 300, allocatedEqually: true },
      ])
    expect(sourceRows([{ meterId: 'm1', label: 'A', sharePct: 70 }, { meterId: 'm2', label: 'B', sharePct: 30 }], mm, '2026-03', 1000)[0])
      .toMatchObject({ expectedKwh: 700, allocatedEqually: false })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `performance.ts`:

```ts
/**
 * The monthly performance table (spec §10): expected (guarantee), actual, variance %, PR,
 * irradiation-corrected expected, downtime hours — one shared implementation for the page AND the
 * report (WM kept two copies, M13). Year to date is a real sum of months (WM printed the month
 * twice, M4).
 */
import type { OpsBaseline } from './baseline'
import { expectedForMonth, TMY_DAYS, type Guarantee } from './guarantee'
import { expectedKwhBetween } from './shape'
import { daysInMonth, monthEndMs, monthParts, monthStartMs, type MonthKey } from './time'

export interface MonthActual { kwh: number; n: number; intervalMin: number }
export type MeterMonths = Record<string, Record<MonthKey, MonthActual>>
export interface MonthTotal { kwh: number; coverageMinutes: number }

export interface DowntimeRecord {
  id: string
  startsAt: string
  endsAt: string
  cause: string
  description: string | null
  excludedFromGuarantee: boolean
  source: 'manual' | 'detected'
}
export interface IrradiationRecord { month: MonthKey; plane: 'ghi' | 'poa'; kwhPerM2: number; sourceNote: string }

export interface PerformanceRow {
  month: MonthKey
  operatingYear: number
  expectedKwh: number
  excludedKwh: number
  guaranteeKwh: number
  actualKwh: number | null
  varianceKwh: number | null
  variancePct: number | null
  performanceRatio: number | null
  correctedExpectedKwh: number | null
  irradiationPlane: 'ghi' | 'poa' | null
  downtimeHours: number
  excludedHours: number
  coveragePct: number | null
}

export interface PerformanceInput {
  months: MonthKey[]
  baseline: OpsBaseline
  guarantee: Guarantee
  commissioningDate: string
  /** As-built DC kWp (PR denominator). */
  dcKwp: number
  actual: Record<MonthKey, MonthTotal>
  generationMeterCount: number
  downtime: DowntimeRecord[]
  irradiation: IrradiationRecord[]
}

const r3 = (x: number) => Math.round(x * 1000) / 1000
const r2 = (x: number) => Math.round(x * 100) / 100

export function totalsByMonth(m: MeterMonths): Record<MonthKey, MonthTotal> {
  const out: Record<MonthKey, MonthTotal> = {}
  for (const months of Object.values(m)) {
    for (const [k, v] of Object.entries(months)) {
      const t = (out[k] ??= { kwh: 0, coverageMinutes: 0 })
      t.kwh = r3(t.kwh + Number(v.kwh))
      t.coverageMinutes += Number(v.n) * Number(v.intervalMin)
    }
  }
  return out
}

const overlapMs = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

export function downtimeHoursInMonth(rows: readonly DowntimeRecord[], month: MonthKey): { total: number; excluded: number } {
  const m0 = monthStartMs(month)
  const m1 = monthEndMs(month)
  let total = 0
  let excluded = 0
  for (const d of rows) {
    const h = overlapMs(Date.parse(d.startsAt), Date.parse(d.endsAt), m0, m1) / 3_600_000
    total += h
    if (d.excludedFromGuarantee) excluded += h
  }
  return { total: r2(total), excluded: r2(excluded) }
}

export function performanceRow(i: PerformanceInput, month: MonthKey): PerformanceRow | null {
  const exp = expectedForMonth({ month, guarantee: i.guarantee, baseline: i.baseline, commissioningDate: i.commissioningDate })
  if (!exp) return null
  const fullFor = (k: MonthKey) => expectedForMonth({ month: k, guarantee: i.guarantee, baseline: i.baseline, commissioningDate: i.commissioningDate })?.fullKwh ?? 0
  const m0 = monthStartMs(month)
  const m1 = monthEndMs(month)
  let excludedKwh = 0
  for (const d of i.downtime) {
    if (!d.excludedFromGuarantee) continue
    const s = Math.max(Date.parse(d.startsAt), m0)
    const e = Math.min(Date.parse(d.endsAt), m1)
    if (e > s) excludedKwh += expectedKwhBetween(i.baseline, fullFor, s, e)
  }
  const guaranteeKwh = Math.max(0, exp.kwh - excludedKwh)
  const a = i.actual[month]
  const actualKwh = a ? a.kwh : null
  const varianceKwh = actualKwh === null ? null : actualKwh - guaranteeKwh
  const variancePct = varianceKwh === null || guaranteeKwh <= 0 ? null : (varianceKwh / guaranteeKwh) * 100
  const irr = i.irradiation.find((r) => r.month === month) ?? null
  const { year, month: m } = monthParts(month)
  let performanceRatio: number | null = null
  let correctedExpectedKwh: number | null = null
  if (irr?.plane === 'poa') {
    performanceRatio = actualKwh !== null && i.dcKwp > 0 ? actualKwh / (i.dcKwp * irr.kwhPerM2) : null
    correctedExpectedKwh = i.baseline.performanceRatio * i.dcKwp * irr.kwhPerM2 * exp.activeFraction
  } else if (irr?.plane === 'ghi' && i.baseline.ghiKwhM2) {
    const modelled = (i.baseline.ghiKwhM2[m - 1]! * daysInMonth(year, m)) / TMY_DAYS[m - 1]!
    correctedExpectedKwh = modelled > 0 ? guaranteeKwh * (irr.kwhPerM2 / modelled) : null
  }
  const hours = downtimeHoursInMonth(i.downtime, month)
  const possible = daysInMonth(year, m) * 1440 * exp.activeFraction * Math.max(1, i.generationMeterCount)
  return {
    month, operatingYear: exp.operatingYear,
    expectedKwh: r3(exp.kwh), excludedKwh: r3(excludedKwh), guaranteeKwh: r3(guaranteeKwh),
    actualKwh: actualKwh === null ? null : r3(actualKwh),
    varianceKwh: varianceKwh === null ? null : r3(varianceKwh),
    variancePct: variancePct === null ? null : r2(variancePct),
    performanceRatio: performanceRatio === null ? null : Math.round(performanceRatio * 10_000) / 10_000,
    correctedExpectedKwh: correctedExpectedKwh === null ? null : r3(correctedExpectedKwh),
    irradiationPlane: irr?.plane ?? null,
    downtimeHours: hours.total, excludedHours: hours.excluded,
    coveragePct: a ? r2(Math.min(100, (a.coverageMinutes / possible) * 100)) : null,
  }
}

export function performanceRows(i: PerformanceInput): PerformanceRow[] {
  return i.months.map((k) => performanceRow(i, k)).filter((r): r is PerformanceRow => r !== null)
}

export interface YearToDate {
  year: number
  fromMonth: MonthKey
  toMonth: MonthKey
  guaranteeKwh: number
  actualKwh: number
  varianceKwh: number
  variancePct: number | null
  monthsWithoutData: number
}

export function yearToDate(rows: readonly PerformanceRow[], month: MonthKey): YearToDate {
  const { year } = monthParts(month)
  const inYear = rows.filter((r) => r.month.startsWith(`${year}-`) && r.month <= month)
  const guaranteeKwh = inYear.reduce((s, r) => s + r.guaranteeKwh, 0)
  const actualKwh = inYear.reduce((s, r) => s + (r.actualKwh ?? 0), 0)
  const varianceKwh = actualKwh - guaranteeKwh
  return {
    year, fromMonth: inYear[0]?.month ?? month, toMonth: month,
    guaranteeKwh: r3(guaranteeKwh), actualKwh: r3(actualKwh), varianceKwh: r3(varianceKwh),
    variancePct: guaranteeKwh > 0 ? r2((varianceKwh / guaranteeKwh) * 100) : null,
    monthsWithoutData: inYear.filter((r) => r.actualKwh === null).length,
  }
}

export interface SourceRow {
  meterId: string
  label: string
  sharePct: number
  expectedKwh: number
  actualKwh: number | null
  allocatedEqually: boolean
}

export function sourceRows(
  meters: ReadonlyArray<{ meterId: string; label: string; sharePct: number | null }>,
  meterMonths: MeterMonths,
  month: MonthKey,
  guaranteeKwh: number,
): SourceRow[] {
  const equal = meters.every((m) => m.sharePct === null)
  return meters.map((m) => {
    const share = equal ? 100 / Math.max(1, meters.length) : (m.sharePct ?? 0)
    const a = meterMonths[m.meterId]?.[month]
    return {
      meterId: m.meterId, label: m.label, sharePct: r2(share),
      expectedKwh: r3((guaranteeKwh * share) / 100),
      actualKwh: a ? r3(Number(a.kwh)) : null,
      allocatedEqually: equal,
    }
  })
}
```

Append to `index.ts`: `export * from './performance'`

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): monthly performance rows, per-source split and real year to date").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test -- src/solar/operations/performance.test.ts 2>&1 | tail -4
git add packages/shared/src/solar/operations && git commit -m "feat(solar): monthly performance rows, per-source split and real year to date

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Lost energy per downtime window + the hourly series the bill engine values

**Files:**
- Create: `packages/shared/src/solar/operations/lost-energy.ts`, `lost-energy.test.ts`
- Modify: `index.ts`

- [ ] **Step 1: Failing test** `lost-energy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lostHourlyKwh, lostKwh, lostSteps, referenceHourIndex } from './lost-energy'
import { flatBaseline } from './__fixtures__/baseline'

const b = flatBaseline()
const full = () => 1240 // 10 kWh per producing hour in March (4 h × 31 d = 124 h)
const at = (iso: string) => Date.parse(iso)

describe('lost energy = shaped expected minus actual, per interval', () => {
  it('a full outage loses the whole shaped expectation', () => {
    const steps = lostSteps({ startMs: at('2026-03-10T11:00:00+02:00'), endMs: at('2026-03-10T13:00:00+02:00') }, [], b, full)
    expect(steps).toHaveLength(4)
    expect(lostKwh(steps)).toBeCloseTo(20, 6)
  })
  it('partial production is subtracted; over-production never makes loss negative', () => {
    const pts = [
      { endMs: at('2026-03-10T11:30:00+02:00'), kw: 4, intervalMin: 30 }, // 2 kWh of 5 expected
      { endMs: at('2026-03-10T12:00:00+02:00'), kw: 30, intervalMin: 30 }, // 15 kWh ≥ 5 expected
    ]
    const steps = lostSteps({ startMs: at('2026-03-10T11:00:00+02:00'), endMs: at('2026-03-10T12:00:00+02:00') }, pts, b, full)
    expect(steps.map((s) => s.lostKwh)).toEqual([3, 0])
  })
  it('uses the data’s own interval for the step', () => {
    const pts = [{ endMs: at('2026-03-10T11:15:00+02:00'), kw: 0, intervalMin: 15 }]
    expect(lostSteps({ startMs: at('2026-03-10T11:00:00+02:00'), endMs: at('2026-03-10T12:00:00+02:00') }, pts, b, full)).toHaveLength(4)
  })
})

describe('the bill engine’s 365-day hour index (29 Feb dropped)', () => {
  it('maps SAST times; 29 February folds onto 28 February', () => {
    expect(referenceHourIndex(at('2026-01-01T00:30:00+02:00'))).toBe(0)
    expect(referenceHourIndex(at('2026-03-01T10:00:00+02:00'))).toBe(59 * 24 + 10)
    expect(referenceHourIndex(at('2028-02-29T10:00:00+02:00'))).toBe(58 * 24 + 10)
    expect(referenceHourIndex(at('2028-03-01T10:00:00+02:00'))).toBe(59 * 24 + 10)
  })
  it('accumulates lost kWh into 8760 hours', () => {
    const steps = lostSteps({ startMs: at('2026-03-10T11:00:00+02:00'), endMs: at('2026-03-10T13:00:00+02:00') }, [], b, full)
    const h = lostHourlyKwh(steps)
    expect(h).toHaveLength(8760)
    expect(h[referenceHourIndex(at('2026-03-10T11:00:00+02:00'))]).toBeCloseTo(10, 6)
    expect(h[referenceHourIndex(at('2026-03-10T12:00:00+02:00'))]).toBeCloseTo(10, 6)
    expect(h.reduce((s, v) => s + v, 0)).toBeCloseTo(20, 6)
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `lost-energy.ts`:

```ts
/**
 * Lost energy during a downtime window (spec §10 monthly report: "downtime table with lost kWh and lost
 * revenue"): per interval, the SHAPED expectation (shape.ts) minus what the meter recorded, clipped at
 * zero. The step is the data's own interval (default 30 min when the window has no data at all). The
 * hourly series places each step's loss on the bill engine's 365-day hour index so the pinned
 * tariff's TOU calendar values it (lost-revenue.ts in the web app).
 */
import type { OpsBaseline } from './baseline'
import type { SeriesPoint, TimeWindow } from './downtime-detect'
import { expectedKwhBetween } from './shape'
import { sastParts, type MonthKey } from './time'

export interface LostStep { startMs: number; endMs: number; expectedKwh: number; actualKwh: number; lostKwh: number }

const r6 = (x: number) => Math.round(x * 1e6) / 1e6

function dominantInterval(points: readonly SeriesPoint[], fallback: number): number {
  const count = new Map<number, number>()
  for (const p of points) count.set(p.intervalMin, (count.get(p.intervalMin) ?? 0) + 1)
  let best = fallback
  let n = 0
  for (const [k, v] of count) if (v > n) { best = k; n = v }
  return best
}

export function lostSteps(
  w: TimeWindow,
  points: readonly SeriesPoint[],
  b: OpsBaseline,
  fullKwhFor: (month: MonthKey) => number,
  defaultIntervalMin = 30,
): LostStep[] {
  const inside = points.filter((p) => p.endMs > w.startMs && p.endMs - p.intervalMin * 60_000 < w.endMs)
  const stepMs = dominantInterval(inside, defaultIntervalMin) * 60_000
  const byEnd = new Map(inside.map((p) => [p.endMs, p.kw]))
  const out: LostStep[] = []
  for (let t = w.startMs; t < w.endMs; t += stepMs) {
    const segEnd = Math.min(t + stepMs, w.endMs)
    const expectedKwh = expectedKwhBetween(b, fullKwhFor, t, segEnd)
    const kw = byEnd.get(t + stepMs)
    const actualKwh = kw === undefined ? 0 : (kw * (segEnd - t)) / 3_600_000
    out.push({ startMs: t, endMs: segEnd, expectedKwh: r6(expectedKwh), actualKwh: r6(actualKwh), lostKwh: r6(Math.max(0, expectedKwh - actualKwh)) })
  }
  return out
}

export function lostKwh(steps: readonly LostStep[]): number {
  return r6(steps.reduce((s, x) => s + x.lostKwh, 0))
}

const MONTH_START_DAY = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

/** SAST hour-of-year on a 365-day year (the bill engine's 8760 index; 29 Feb folds onto 28 Feb). */
export function referenceHourIndex(ms: number): number {
  const p = sastParts(ms)
  const day = p.month === 2 && p.day === 29 ? 28 : p.day
  return (MONTH_START_DAY[p.month - 1]! + day - 1) * 24 + p.hour
}

export function lostHourlyKwh(steps: readonly LostStep[]): Float64Array {
  const out = new Float64Array(8760)
  for (const s of steps) out[referenceHourIndex(s.startMs)] = out[referenceHourIndex(s.startMs)]! + s.lostKwh
  return out
}
```

Append to `index.ts`: `export * from './lost-energy'`

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): lost energy per downtime window on the bill engine's hour index").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test -- src/solar/operations/lost-energy.test.ts 2>&1 | tail -4
git add packages/shared/src/solar/operations && git commit -m "feat(solar): lost energy per downtime window on the bill engine's hour index

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Handover template and completion

**Files:**
- Create: `packages/shared/src/solar/operations/handover.ts`, `handover.test.ts`
- Modify: `index.ts`

- [ ] **Step 1: Failing test** `handover.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_HANDOVER_TEMPLATE, handoverCompletion, parseHandoverTemplate, templateFromRow } from './handover'

describe('handover template', () => {
  it('the built-in "Solar PV Handover" names the spec’s documents', () => {
    expect(DEFAULT_HANDOVER_TEMPLATE.name).toBe('Solar PV Handover')
    expect(DEFAULT_HANDOVER_TEMPLATE.items.map((i) => i.key)).toEqual([
      'coc', 'sld_as_built', 'commissioning_tests', 'om_manual', 'warranties', 'sseg_registration', 'monitoring_handover', 'as_built_layout', 'training_record',
    ])
  })
  it('validates keys, labels and duplicates', () => {
    expect(parseHandoverTemplate({ name: 'X', items: [{ key: 'Bad Key', label: 'x', required: true }] }).ok).toBe(false)
    expect(parseHandoverTemplate({ name: 'X', items: [{ key: 'a', label: 'A', required: true }, { key: 'a', label: 'B', required: false }] }).ok).toBe(false)
    expect(parseHandoverTemplate({ name: 'X', items: [] }).ok).toBe(false)
    expect(parseHandoverTemplate(DEFAULT_HANDOVER_TEMPLATE)).toEqual({ ok: true, value: DEFAULT_HANDOVER_TEMPLATE })
  })
  it('falls back to the default when the org has no row', () => {
    expect(templateFromRow(null)).toEqual(DEFAULT_HANDOVER_TEMPLATE)
    expect(templateFromRow({ name: 'Ours', items: [{ key: 'coc', label: 'CoC', required: true }] }).items).toHaveLength(1)
  })
})

describe('handoverCompletion', () => {
  it('an item is complete when it links a document or is marked N/A', () => {
    const c = handoverCompletion([
      { required: true, documentId: 'd1', notApplicable: false },
      { required: true, documentId: null, notApplicable: true },
      { required: true, documentId: null, notApplicable: false },
      { required: false, documentId: null, notApplicable: false },
    ])
    expect(c).toEqual({ done: 2, total: 4, pct: 50, requiredDone: 2, requiredTotal: 3 })
  })
  it('no items is 0 %, not NaN', () => {
    expect(handoverCompletion([])).toEqual({ done: 0, total: 0, pct: 0, requiredDone: 0, requiredTotal: 0 })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `handover.ts`:

```ts
/**
 * Handover checklist (spec §10; carried from WM's Documents tab checklist). Each item links ONE file
 * in E-Site Documents (tenants.documents) — there is no separate document store and no dependence on
 * folder names. The org edits the template in /settings/solar; without one, this default applies.
 */
import { z } from 'zod'

export const HandoverTemplateItemSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,60}$/, 'Use lower-case letters, digits and underscores.'),
  label: z.string().trim().min(1).max(200),
  required: z.boolean(),
}).strict()

export const HandoverTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  items: z.array(HandoverTemplateItemSchema).min(1).max(60),
}).strict().superRefine((t, ctx) => {
  const seen = new Set<string>()
  t.items.forEach((i, k) => {
    if (seen.has(i.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', k, 'key'], message: `"${i.key}" is used twice.` })
    seen.add(i.key)
  })
})
export type HandoverTemplate = z.infer<typeof HandoverTemplateSchema>

export const DEFAULT_HANDOVER_TEMPLATE: HandoverTemplate = {
  name: 'Solar PV Handover',
  items: [
    { key: 'coc', label: 'Certificate of Compliance (CoC)', required: true },
    { key: 'sld_as_built', label: 'Single-line diagram (as-built)', required: true },
    { key: 'commissioning_tests', label: 'Commissioning test sheets', required: true },
    { key: 'om_manual', label: 'Operation and maintenance manual', required: true },
    { key: 'warranties', label: 'Warranties (modules, inverters, batteries)', required: true },
    { key: 'sseg_registration', label: 'SSEG registration / approval letter', required: true },
    { key: 'monitoring_handover', label: 'Monitoring portal login handed over', required: true },
    { key: 'as_built_layout', label: 'As-built array layout', required: false },
    { key: 'training_record', label: 'Client training record', required: false },
  ],
}

export function parseHandoverTemplate(raw: unknown): { ok: true; value: HandoverTemplate } | { ok: false; errors: string[] } {
  const r = HandoverTemplateSchema.safeParse(raw)
  if (r.success) return { ok: true, value: r.data }
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || 'template'}: ${i.message}`) }
}

export function templateFromRow(row: { name: unknown; items: unknown } | null): HandoverTemplate {
  if (!row) return DEFAULT_HANDOVER_TEMPLATE
  const r = parseHandoverTemplate({ name: row.name, items: row.items })
  return r.ok ? r.value : DEFAULT_HANDOVER_TEMPLATE
}

export interface HandoverCompletion { done: number; total: number; pct: number; requiredDone: number; requiredTotal: number }

export function handoverCompletion(items: ReadonlyArray<{ required: boolean; documentId: string | null; notApplicable: boolean }>): HandoverCompletion {
  const complete = (i: { documentId: string | null; notApplicable: boolean }) => i.documentId !== null || i.notApplicable
  const done = items.filter(complete).length
  const required = items.filter((i) => i.required)
  return {
    done, total: items.length,
    pct: items.length === 0 ? 0 : Math.round((done / items.length) * 100),
    requiredDone: required.filter(complete).length, requiredTotal: required.length,
  }
}
```

Append to `index.ts`: `export * from './handover'`

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): handover template and completion").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test -- src/solar/operations/handover.test.ts 2>&1 | tail -4
git add packages/shared/src/solar/operations && git commit -m "feat(solar): handover template and completion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Monthly report snapshot + report model

**Files:**
- Create: `packages/shared/src/solar/operations/report.ts`, `report.test.ts`
- Modify: `index.ts`

- [ ] **Step 1: Confirm Phase 6's report types and formatters.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
git grep -n "export interface ReportSection\|export interface ReportTable" -- packages/shared/src/solar/reports/report-model.ts
git grep -n "export function fixed\|export const zar " -- packages/shared/src/solar/reports/fmt.ts
```
Expected: all four match. (If `ReportSection` lives in another file of that folder, import it from there — change nothing else.)

- [ ] **Step 2: Failing test** `report.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildMonthlySnapshot, monthlyReportModel, NOTE_SECTIONS, type BuildMonthlyInput } from './report'
import { performanceRows, sourceRows, yearToDate } from './performance'
import { flatBaseline } from './__fixtures__/baseline'

const perfIn = {
  months: ['2026-02', '2026-03'], baseline: flatBaseline(),
  guarantee: { basis: 'p50' as const, pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0 },
  commissioningDate: '2026-02-15', dcKwp: 100,
  actual: { '2026-02': { kwh: 450, coverageMinutes: 14 * 1440 }, '2026-03': { kwh: 900, coverageMinutes: 31 * 1440 } },
  generationMeterCount: 1, downtime: [], irradiation: [],
}
const rows = performanceRows(perfIn)
const input = (over: Partial<BuildMonthlyInput> = {}): BuildMonthlyInput => ({
  period: '2026-03', generatedAt: '2026-04-02T08:00:00.000Z', projectName: 'Acme Mall → North',
  commissioningDate: '2026-02-15',
  asBuilt: { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0,
    equipment: [{ kind: 'module', make: 'Acme Ω', model: 'M-550', rating: 550, unit: 'W', quantity: 182 }, { kind: 'inverter', make: 'Volt', model: 'I-80', rating: 80, unit: 'kW', quantity: 1 }] },
  baseline: flatBaseline(), guarantee: perfIn.guarantee,
  performance: rows[1]!,
  sources: sourceRows([{ meterId: 'm1', label: 'PV main', sharePct: null }], { m1: { '2026-03': { kwh: 900, n: 1488, intervalMin: 30 } } }, '2026-03', rows[1]!.guaranteeKwh),
  downtime: [{ startsAt: '2026-03-10T09:00:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', cause: 'inverter_fault', description: 'Trip ✓',
    excludedFromGuarantee: false, source: 'detected', lostKwh: 16.13, lostZar: 42.5 }],
  lostZarTotal: 42.5,
  tariff: { name: 'Business 1 (City of Tshwane, 2026/27)' },
  ytd: yearToDate(rows, '2026-03'),
  consumption: { gridKwh: 12000, meterLabels: ['Council main'] },
  notes: { summary: 'Solid month.', actions: 'Replace fuse.' },
  ...over,
})

describe('buildMonthlySnapshot', () => {
  it('freezes every figure the report prints, with the period in the shape the database checks', () => {
    const s = buildMonthlySnapshot(input())
    expect(s.version).toBe(1)
    expect(s.period).toBe('2026-03')
    expect(s.periodLabel).toBe('March 2026')
    expect(s.performance.actualKwh).toBe(900)
    expect(s.ytd.actualKwh).toBe(1350)
    expect(s.lost).toEqual({ kwh: 16.13, zar: 42.5 })
    expect(s.consumption.solarSharePct).toBeCloseTo((900 / (900 + 12000)) * 100, 2)
    expect(Object.keys(s.notes).sort()).toEqual([...NOTE_SECTIONS].sort())
    expect(s.notes.performance).toBe('')
  })
  it('without a tariff there is no Rand anywhere', () => {
    const s = buildMonthlySnapshot(input({ tariff: null, lostZarTotal: null, downtime: [{ ...input().downtime[0]!, lostZar: null }] }))
    expect(s.lost.zar).toBeNull()
    expect(s.downtime[0]!.lostZar).toBeNull()
  })
  it('no consumption meter → gridKwh and share are null (never the generation repeated, WM M10)', () => {
    const s = buildMonthlySnapshot(input({ consumption: { gridKwh: null, meterLabels: [] } }))
    expect(s.consumption).toEqual({ gridKwh: null, meterLabels: [], solarSharePct: null })
  })
})

describe('monthlyReportModel', () => {
  it('has every section of the spec, an equipment table from the record, real YTD and the tariff basis', () => {
    const m = monthlyReportModel(buildMonthlySnapshot(input()))
    expect(m.title).toBe('Solar monthly report — March 2026')
    expect(m.sections.map((x) => x.title)).toEqual([
      'Performance summary', 'Expected vs actual per source', 'Year to date', 'Downtime', 'Realised consumption',
      'Installed equipment', 'Commentary and actions', 'Basis of figures',
    ])
    const eq = m.sections.find((x) => x.title === 'Installed equipment')!.tables[0]!
    expect(eq.rows[0]).toEqual(['Module', 'Acme Ω', 'M-550', '550 W', '182'])
    const ytd = m.sections.find((x) => x.title === 'Year to date')!.tables[0]!
    expect(ytd.rows[0]![2]).toBe('1 350')
    const dt = m.sections.find((x) => x.title === 'Downtime')!
    expect(dt.paragraphs.join(' ')).toContain('Business 1 (City of Tshwane, 2026/27)')
    expect(m.summary).toEqual({ period: '2026-03', actualKwh: 900, guaranteeKwh: 1000, variancePct: -10 })
  })
  it('drops empty commentary instead of printing blanks', () => {
    const m = monthlyReportModel(buildMonthlySnapshot(input({ notes: {} })))
    expect(m.sections.find((x) => x.title === 'Commentary and actions')!.paragraphs).toEqual(['No commentary was recorded for this month.'])
  })
})
```

- [ ] **Step 3: Run — FAIL. Implement** `report.ts`:

```ts
/**
 * The monthly client report (spec §10). The SNAPSHOT is built once at Generate and stored
 * (solar.monthly_reports) — the PDF is rendered from it, and regenerating a month writes v(n+1),
 * never edits v(n) (WM M1/M2). Commentary is copied in at generation; editing a note later never
 * changes a stored figure. Content fixed against WM's defects: real YTD (M4), equipment from the
 * installation record (M4), every source listed (M5), realised consumption from the council/bulk
 * meter (M10), lost revenue at the pinned tariff's TOU rates or nothing at all (M11/G13).
 */
import { fixed, zar } from '../reports/fmt'
import type { ReportSection, ReportTable } from '../reports/report-model'
import type { AsBuilt } from './as-built'
import type { OpsBaseline } from './baseline'
import { GUARANTEE_BASIS_LABELS, type Guarantee, type GuaranteeBasis } from './guarantee'
import type { PerformanceRow, SourceRow, YearToDate } from './performance'
import { monthLabel, type MonthKey } from './time'

export const NOTE_SECTIONS = ['summary', 'performance', 'downtime', 'financial', 'actions'] as const
export type NoteSection = (typeof NOTE_SECTIONS)[number]
export const NOTE_SECTION_LABELS: Record<NoteSection, string> = {
  summary: 'Summary commentary', performance: 'Performance commentary', downtime: 'Downtime commentary',
  financial: 'Financial commentary', actions: 'Actions',
}
export const CAUSE_LABELS: Record<string, string> = {
  grid_outage: 'Grid outage', inverter_fault: 'Inverter fault', planned_maintenance: 'Planned maintenance',
  unplanned_maintenance: 'Unplanned maintenance', curtailment: 'Curtailment', communications: 'Communications',
  weather_damage: 'Weather damage', other: 'Other',
}
export const MONTHLY_SNAPSHOT_VERSION = 1 as const

export interface MonthlyDowntimeInput {
  startsAt: string; endsAt: string; cause: string; description: string | null
  excludedFromGuarantee: boolean; source: 'manual' | 'detected'; lostKwh: number; lostZar: number | null
}
export interface MonthlyDowntimeLine extends MonthlyDowntimeInput { hours: number; causeLabel: string }

export interface MonthlySnapshot {
  version: typeof MONTHLY_SNAPSHOT_VERSION
  period: MonthKey
  periodLabel: string
  generatedAt: string
  project: { name: string }
  installation: { commissioningDate: string; asBuilt: AsBuilt; baselineRunId: string; baselineInputsHash: string; designPr: number }
  guarantee: { basis: GuaranteeBasis; basisLabel: string; pct: number | null; degradationPctPerYear: number }
  performance: PerformanceRow
  sources: SourceRow[]
  downtime: MonthlyDowntimeLine[]
  lost: { kwh: number; zar: number | null }
  tariff: { name: string } | null
  ytd: YearToDate
  consumption: { gridKwh: number | null; meterLabels: string[]; solarSharePct: number | null }
  notes: Record<NoteSection, string>
}

export interface BuildMonthlyInput {
  period: MonthKey
  generatedAt: string
  projectName: string
  commissioningDate: string
  asBuilt: AsBuilt
  baseline: OpsBaseline
  guarantee: Guarantee
  performance: PerformanceRow
  sources: SourceRow[]
  downtime: MonthlyDowntimeInput[]
  lostZarTotal: number | null
  tariff: { name: string } | null
  ytd: YearToDate
  consumption: { gridKwh: number | null; meterLabels: string[] }
  notes: Partial<Record<NoteSection, string>>
}

const r2 = (x: number) => Math.round(x * 100) / 100

export function buildMonthlySnapshot(i: BuildMonthlyInput): MonthlySnapshot {
  const downtime = i.downtime.map((d) => ({
    ...d,
    hours: r2((Date.parse(d.endsAt) - Date.parse(d.startsAt)) / 3_600_000),
    causeLabel: CAUSE_LABELS[d.cause] ?? d.cause,
    lostKwh: r2(d.lostKwh),
    lostZar: i.tariff && d.lostZar !== null ? r2(d.lostZar) : null,
  }))
  const actual = i.performance.actualKwh
  const grid = i.consumption.gridKwh
  return {
    version: MONTHLY_SNAPSHOT_VERSION,
    period: i.period,
    periodLabel: monthLabel(i.period),
    generatedAt: i.generatedAt,
    project: { name: i.projectName },
    installation: {
      commissioningDate: i.commissioningDate, asBuilt: i.asBuilt,
      baselineRunId: i.baseline.caseRunId, baselineInputsHash: i.baseline.inputsHash, designPr: i.baseline.performanceRatio,
    },
    guarantee: { basis: i.guarantee.basis, basisLabel: GUARANTEE_BASIS_LABELS[i.guarantee.basis], pct: i.guarantee.pct, degradationPctPerYear: i.guarantee.degradationPctPerYear },
    performance: i.performance,
    sources: i.sources,
    downtime,
    lost: { kwh: r2(downtime.reduce((s, d) => s + d.lostKwh, 0)), zar: i.tariff && i.lostZarTotal !== null ? r2(i.lostZarTotal) : null },
    tariff: i.tariff,
    ytd: i.ytd,
    consumption: {
      gridKwh: grid,
      meterLabels: i.consumption.meterLabels,
      solarSharePct: grid !== null && actual !== null && actual + grid > 0 ? r2((actual / (actual + grid)) * 100) : null,
    },
    notes: Object.fromEntries(NOTE_SECTIONS.map((k) => [k, (i.notes[k] ?? '').trim()])) as Record<NoteSection, string>,
  }
}

const kwh = (v: number | null) => (v === null ? 'no data' : fixed(v, 0))
const pctText = (v: number | null) => (v === null ? 'n/a' : `${v > 0 ? '+' : ''}${fixed(v, 1)} %`)
const table = (columns: string[], rows: string[][], numericFrom = 1): ReportTable => ({ columns, rows, numeric: columns.map((_, k) => k >= numericFrom) })
const sast = (iso: string) => new Date(Date.parse(iso) + 2 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')
const KIND_LABEL: Record<string, string> = { module: 'Module', inverter: 'Inverter', battery: 'Battery', other: 'Other' }

export function monthlyReportModel(s: MonthlySnapshot): { title: string; kicker: string; sections: ReportSection[]; summary: Record<string, number | string> } {
  const p = s.performance
  const sections: ReportSection[] = []
  const para = (t: string) => (t ? [t] : [])

  sections.push({
    title: 'Performance summary',
    paragraphs: [
      `${s.periodLabel}: ${kwh(p.actualKwh)} kWh generated against a guarantee of ${kwh(p.guaranteeKwh)} kWh (${pctText(p.variancePct)}).`,
      ...para(s.notes.summary),
    ],
    tables: [table(['Metric', 'Value'], [
      [`Expected (${s.guarantee.basisLabel})`, `${kwh(p.expectedKwh)} kWh`],
      ['Expected lost to downtime excluded from the guarantee', `${kwh(p.excludedKwh)} kWh`],
      ['Guarantee for the month', `${kwh(p.guaranteeKwh)} kWh`],
      ['Actual generation', p.actualKwh === null ? 'no data' : `${kwh(p.actualKwh)} kWh`],
      ['Variance', pctText(p.variancePct)],
      ['Performance ratio', p.performanceRatio === null ? 'needs plane-of-array irradiation' : fixed(p.performanceRatio, 3)],
      ['Irradiation-corrected expected', p.correctedExpectedKwh === null ? 'no irradiation recorded' : `${kwh(p.correctedExpectedKwh)} kWh (${p.irradiationPlane === 'poa' ? 'plane of array' : 'horizontal'})`],
      ['Downtime', `${fixed(p.downtimeHours, 1)} h (${fixed(p.excludedHours, 1)} h excluded)`],
      ['Data coverage', p.coveragePct === null ? 'no data' : `${fixed(p.coveragePct, 1)} %`],
    ])],
  })

  sections.push({
    title: 'Expected vs actual per source',
    paragraphs: s.sources.some((x) => x.allocatedEqually) ? ['The guarantee is allocated equally between the generation meters (no share has been set).'] : [],
    tables: [table(['Source', 'Share', 'Expected kWh', 'Actual kWh', 'Variance'], s.sources.map((x) => [
      x.label, `${fixed(x.sharePct, 1)} %`, kwh(x.expectedKwh), kwh(x.actualKwh),
      x.actualKwh === null || x.expectedKwh <= 0 ? 'n/a' : pctText(((x.actualKwh - x.expectedKwh) / x.expectedKwh) * 100),
    ]))],
  })

  sections.push({
    title: 'Year to date',
    paragraphs: s.ytd.monthsWithoutData > 0 ? [`${s.ytd.monthsWithoutData} month(s) in this period have no generation data and count as zero.`] : [],
    tables: [table(['Period', 'Guarantee kWh', 'Actual kWh', 'Variance'], [[
      `${monthLabel(s.ytd.fromMonth)} to ${monthLabel(s.ytd.toMonth)}`, kwh(s.ytd.guaranteeKwh), kwh(s.ytd.actualKwh), pctText(s.ytd.variancePct),
    ]])],
  })

  const money = s.tariff !== null
  sections.push({
    title: 'Downtime',
    paragraphs: [
      s.downtime.length === 0 ? 'No downtime was recorded this month.' : `${s.downtime.length} downtime event(s); ${fixed(s.lost.kwh, 1)} kWh of expected generation lost.`,
      money
        ? `Lost revenue is the energy cost of the lost kWh at ${s.tariff!.name} time-of-use rates, excl. VAT.`
        : 'Lost revenue is not shown: no tariff is pinned for this study.',
      ...para(s.notes.downtime),
    ],
    tables: s.downtime.length === 0 ? [] : [table(
      ['Start (SAST)', 'End (SAST)', 'Hours', 'Cause', 'Excluded', 'Lost kWh', ...(money ? ['Lost revenue'] : [])],
      [
        ...s.downtime.map((d) => [sast(d.startsAt), sast(d.endsAt), fixed(d.hours, 2), d.description ? `${d.causeLabel}: ${d.description}` : d.causeLabel,
          d.excludedFromGuarantee ? 'Yes' : 'No', fixed(d.lostKwh, 1), ...(money ? [d.lostZar === null ? 'n/a' : zar(d.lostZar)] : [])]),
        ['Total', '', fixed(s.downtime.reduce((t, d) => t + d.hours, 0), 2), '', '', fixed(s.lost.kwh, 1), ...(money ? [s.lost.zar === null ? 'n/a' : zar(s.lost.zar)] : [])],
      ],
      2,
    )],
  })

  sections.push({
    title: 'Realised consumption',
    paragraphs: s.consumption.gridKwh === null
      ? ['No council or bulk meter is linked to this installation, so grid-supplied energy is not reported.']
      : [
          `Grid-supplied energy (${s.consumption.meterLabels.join(', ')}): ${kwh(s.consumption.gridKwh)} kWh.`,
          `Solar share of site energy: ${s.consumption.solarSharePct === null ? 'n/a' : `${fixed(s.consumption.solarSharePct, 1)} %`} (assumes no export).`,
        ],
    tables: [],
  })

  const a = s.installation.asBuilt
  sections.push({
    title: 'Installed equipment',
    paragraphs: [`${fixed(a.dcKwp, 1)} kWp DC / ${fixed(a.acKw, 1)} kW AC${a.batteryKwh !== null ? `, battery ${fixed(a.batteryKwh, 1)} kWh` : ''}; commissioned ${s.installation.commissioningDate}.`],
    tables: [table(['Kind', 'Make', 'Model', 'Rating', 'Quantity'], a.equipment.map((e) => [
      KIND_LABEL[e.kind] ?? e.kind, e.make, e.model, `${fixed(e.rating, e.rating % 1 === 0 ? 0 : 2)} ${e.unit}`, String(e.quantity),
    ]), 4)],
  })

  const commentary = [s.notes.performance, s.notes.financial, s.notes.actions].filter((t) => t.length > 0)
  sections.push({
    title: 'Commentary and actions',
    paragraphs: commentary.length ? [
      ...(s.notes.performance ? [`Performance: ${s.notes.performance}`] : []),
      ...(s.notes.financial ? [`Financial: ${s.notes.financial}`] : []),
      ...(s.notes.actions ? [`Actions: ${s.notes.actions}`] : []),
    ] : ['No commentary was recorded for this month.'],
    tables: [],
  })

  sections.push({
    title: 'Basis of figures',
    paragraphs: [
      `Guarantee basis: ${s.guarantee.basisLabel}${s.guarantee.pct !== null ? ` (${fixed(s.guarantee.pct, 1)} %)` : ''}; degradation ${fixed(s.guarantee.degradationPctPerYear, 2)} % a year from operating year 2.`,
      `Modelled from the accepted case run ${s.installation.baselineRunId} (inputs ${s.installation.baselineInputsHash.slice(0, 12)}), frozen when the installation was recorded.`,
      'Months are South African Standard Time calendar months; an interval belongs to the month in which it starts. Missing readings are data gaps, never downtime.',
    ],
    tables: [],
  })

  return {
    title: `Solar monthly report — ${s.periodLabel}`,
    kicker: 'SOLAR MONTHLY REPORT',
    sections,
    summary: { period: s.period, actualKwh: p.actualKwh ?? 0, guaranteeKwh: p.guaranteeKwh, variancePct: p.variancePct ?? 0 },
  }
}
```

Append to `index.ts`: `export * from './report'`

- [ ] **Step 4: Run — PASS; commit** ("feat(solar): monthly report snapshot and model").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test -- src/solar/operations/report.test.ts 2>&1 | tail -4
git add packages/shared/src/solar/operations && git commit -m "feat(solar): monthly report snapshot and model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Operations readiness, the tab, activity verbs

**Files:**
- Modify: `packages/shared/src/solar/readiness.ts`, `readiness.test.ts`
- Modify: `packages/shared/src/solar/activity.ts`, `activity.test.ts`

- [ ] **Step 1: Failing tests.** Append to `readiness.test.ts` (keep the file's existing imports; add `operationsReadiness` and `SOLAR_TABS` to its import from `./readiness` if absent):

```ts
describe('Operations readiness (§2.3)', () => {
  it('the tab is built and visible to every level', () => {
    const t = SOLAR_TABS.find((x) => x.slug === 'operations')!
    expect(t).toMatchObject({ built: true, hidden: false, financial: false })
  })
  it('grey until installed; amber installed without data or date; green with a date and ≥ 1 month of data', () => {
    expect(operationsReadiness(null)).toEqual({ status: 'grey', reason: 'Not installed yet — record the installation from the accepted proposal' })
    expect(operationsReadiness({ installed: true, commissioningDate: null, monthsWithData: 3 }).status).toBe('amber')
    expect(operationsReadiness({ installed: true, commissioningDate: '2026-02-15', monthsWithData: 0 }))
      .toEqual({ status: 'amber', reason: 'Installed, but no generation data imported yet' })
    expect(operationsReadiness({ installed: true, commissioningDate: '2026-02-15', monthsWithData: 2 }))
      .toEqual({ status: 'green', reason: 'Commissioned 2026-02-15; 2 months of generation data' })
  })
})
```

Append to `activity.test.ts`:

```ts
describe('operations activity', () => {
  it('describes each verb and targets the Operations tab', () => {
    expect(describeSolarAuditEvent('installation_created', {})).toEqual({ text: 'Installation recorded', target: 'operations' })
    expect(describeSolarAuditEvent('downtime_added', { hours: 2 })).toEqual({ text: 'Downtime recorded (2 h)', target: 'operations' })
    expect(describeSolarAuditEvent('monthly_report_generated', { period: '2026-03', version: 2 })).toEqual({ text: 'Monthly report 2026-03 v2 generated', target: 'operations' })
    expect(describeSolarAuditEvent('handover_updated', { item: 'CoC' })).toEqual({ text: 'Handover: CoC updated', target: 'operations' })
  })
})
```

- [ ] **Step 2: Run — FAIL.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
pnpm --filter @esite/shared test -- src/solar/readiness.test.ts src/solar/activity.test.ts 2>&1 | tail -8
```

- [ ] **Step 3: Implement.** In `packages/shared/src/solar/readiness.ts`:

1. Change the `operations` row of `SOLAR_TABS` to:
```ts
  { slug: 'operations', label: 'Operations',         built: true,  financial: false, hidden: false },
```
2. Add after `reportsReadiness` (Phase 6):
```ts
export interface OperationsReadinessInput { installed: boolean; commissioningDate: string | null; monthsWithData: number }

export function operationsReadiness(o: OperationsReadinessInput | null): { status: ReadinessStatus; reason: string } {
  if (!o || !o.installed) return { status: 'grey', reason: 'Not installed yet — record the installation from the accepted proposal' }
  if (!o.commissioningDate) return { status: 'amber', reason: 'Installed, but no commissioning date set' }
  if (o.monthsWithData < 1) return { status: 'amber', reason: 'Installed, but no generation data imported yet' }
  return { status: 'green', reason: `Commissioned ${o.commissioningDate}; ${o.monthsWithData} month${o.monthsWithData === 1 ? '' : 's'} of generation data` }
}
```
3. Add to `SolarReadinessExtra`:
```ts
  /** Null or absent until an installation exists. */
  operations?: OperationsReadinessInput | null
```
4. In `computeSolarReadiness`, immediately after the `reports` line (Phase 6), add:
```ts
      if (t.slug === 'operations') return { slug: t.slug, label: t.label, live: true, ...operationsReadiness(extra.operations ?? null) }
```

In `packages/shared/src/solar/activity.ts`: add `'operations'` to the `SolarActivityTarget` union (keep every existing member) and add before `default:`:
```ts
    case 'installation_created':
      return { text: 'Installation recorded', target: 'operations' }
    case 'installation_saved':
      return { text: 'Installation details saved', target: 'operations' }
    case 'meter_linked':
      return { text: `Meter linked for ${ref.role === 'consumption' ? 'consumption' : 'generation'}`, target: 'operations' }
    case 'meter_unlinked':
      return { text: 'Meter unlinked', target: 'operations' }
    case 'guarantee_saved':
      return { text: 'Guarantee basis saved', target: 'operations' }
    case 'irradiation_saved':
      return { text: `Irradiation recorded for ${String(ref.month ?? '')}`, target: 'operations' }
    case 'downtime_added':
      return { text: `Downtime recorded (${Number(ref.hours ?? 0)} h)`, target: 'operations' }
    case 'downtime_updated':
      return { text: 'Downtime updated', target: 'operations' }
    case 'downtime_deleted':
      return { text: 'Downtime removed', target: 'operations' }
    case 'monthly_report_generated':
      return { text: `Monthly report ${String(ref.period ?? '')} v${Number(ref.version ?? 1)} generated`, target: 'operations' }
    case 'handover_updated':
      return { text: `Handover: ${String(ref.item ?? 'item')} updated`, target: 'operations' }
```

- [ ] **Step 4: Fix any old expectation that assumed Operations was hidden.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
git grep -n -E "operations" -- packages/shared/src/solar/readiness.test.ts 'apps/web/src/app/(admin)/projects/[id]/solar/_components/*.test.tsx' 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.test.tsx'
```
For each hit expecting the `operations` tab hidden / absent / not built, change it to the visible, built, live expectation. Change nothing else.

- [ ] **Step 5: Barrel check and run.** `packages/shared/src/solar/index.ts` already re-exports `readiness` and `activity`; confirm, then run shared + the Solar web tests.

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-7
git grep -n "readiness\|activity" -- packages/shared/src/solar/index.ts
pnpm --filter @esite/shared test 2>&1 | tail -3
pnpm --filter web test -- 'src/app/(admin)/projects/[id]/solar' 2>&1 | tail -3
git add packages/shared/src/solar && git commit -m "feat(solar): Operations tab visible, readiness rule and activity verbs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Note: the tab bar now links `/solar/operations`, which 404s until Task 25. Acceptable mid-branch.
