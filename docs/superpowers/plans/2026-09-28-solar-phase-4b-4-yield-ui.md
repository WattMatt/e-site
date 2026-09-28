# Solar Phase 4b — Part 4: Yield & Scenarios UI (charts, loaders, case list, editor, results, compare, stale banner)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-28-solar-phase-4b-0-index.md` first; Parts 1–3 must be done.

**Goal:** `/projects/[id]/solar/yield` — the case list, the case editor (every §7.2 section), Save / Run / Cancel / Discard, the stored results (§7.3) with charts, Compare 2–4, and the Stale banner — every number read from a stored run.

**Architecture:** One server loader (`lib/solar/cases/page-data.ts`) turns rows into JSON-only view models (no functions, no typed arrays, no Dates). Client components render them; the only client "computation" is formatting and the DC/AC ratio of the *inputs*. Charts are hand-rolled SVG on a tested geometry module (E-Site has no charting library; `components/mv/TccPlot.tsx` set the precedent). A contract test forbids client files from importing engine/compute runtime.

**Tech Stack:** Next.js 15 server components + client components, React 19, RTL, SVG.

---

### Task 23: Chart geometry + SVG chart components

**Files:**
- Create: `apps/web/src/components/solar/charts/geometry.ts` (+ `geometry.test.ts`)
- Create: `apps/web/src/components/solar/charts/LineChart.tsx`, `BarChart.tsx`, `WaterfallChart.tsx`, `TornadoChart.tsx`, `CashflowChart.tsx`
- Create: `apps/web/src/components/solar/charts/charts.test.tsx`
- Create: `apps/web/src/components/solar/format.ts` (+ `format.test.ts`)

- [ ] **Step 1: Failing tests.**

`geometry.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { linearScale, niceTicks, linePath, extentWithZero, waterfallBars, tornadoLayout } from './geometry'

describe('chart geometry', () => {
  it('linearScale maps domain to range (inverted y works)', () => {
    const y = linearScale([0, 100], [200, 0])
    expect(y(0)).toBe(200); expect(y(100)).toBe(0); expect(y(50)).toBe(100)
    expect(linearScale([5, 5], [0, 10])(5)).toBe(0)
  })
  it('niceTicks returns round steps covering the domain', () => {
    expect(niceTicks(0, 97, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(-3, 7, 5)).toEqual([-4, -2, 0, 2, 4, 6, 8])
  })
  it('extentWithZero always includes zero', () => {
    expect(extentWithZero([[3, 5], [4]])).toEqual([0, 5])
    expect(extentWithZero([[-2, 1]])).toEqual([-2, 1])
    expect(extentWithZero([[]])).toEqual([0, 1])
  })
  it('linePath', () => {
    expect(linePath([1, 2], (i) => i * 10, (v) => v)).toBe('M0,1L10,2')
  })
  it('waterfallBars: start/subtotal/end from 0, losses step down', () => {
    expect(waterfallBars([
      { kwh: 100, kind: 'start' }, { kwh: 10, kind: 'loss' }, { kwh: 90, kind: 'subtotal' }, { kwh: 5, kind: 'loss' }, { kwh: 85, kind: 'end' },
    ])).toEqual([{ from: 0, to: 100 }, { from: 90, to: 100 }, { from: 0, to: 90 }, { from: 85, to: 90 }, { from: 0, to: 85 }])
  })
  it('tornadoLayout sorts by spread and centres on the base', () => {
    const t = tornadoLayout(0, [{ variable: 'a', lowNpvZar: -1, highNpvZar: 1, spreadZar: 2 }, { variable: 'b', lowNpvZar: -5, highNpvZar: 3, spreadZar: 8 }])
    expect(t.rows.map((r) => r.variable)).toEqual(['b', 'a'])
    expect(t.domain).toEqual([-5, 3])
  })
})
```

`format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { rand, mwh, num, pct, years } from './format'
describe('solar display format (units always shown, spec §0.4 rule 3)', () => {
  it('rand: space thousands, dot decimals, R prefix; negatives', () => {
    expect(rand(3406513.93)).toBe('R 3 406 514')
    expect(rand(-1200.4)).toBe('−R 1 200')
    expect(rand(1234.5, 2)).toBe('R 1 234.50')
  })
  it('mwh / num / pct / years', () => {
    expect(mwh(1_234_567)).toBe('1 234.6 MWh')
    expect(num(1690.4, 0)).toBe('1 690')
    expect(pct(0.1234)).toBe('12.3 %')
    expect(years(null)).toBe('n/a')
    expect(years(5.26)).toBe('5.3 years')
  })
})
```

`charts.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LineChart } from './LineChart'
import { BarChart } from './BarChart'
import { WaterfallChart } from './WaterfallChart'
import { TornadoChart } from './TornadoChart'
import { CashflowChart } from './CashflowChart'

describe('solar charts', () => {
  it('LineChart: one path per series, labelled for assistive tech', () => {
    const { container } = render(<LineChart title="Typical day" unit="kW" xLabels={['0', '1', '2']} series={[{ label: 'PV', values: [0, 5, 3] }, { label: 'Load', values: [2, 2, 2] }]} />)
    expect(screen.getByRole('img', { name: 'Typical day' })).toBeTruthy()
    expect(container.querySelectorAll('path[data-series]')).toHaveLength(2)
    expect(screen.getByText('PV')).toBeTruthy()
  })
  it('BarChart: groups × series rects', () => {
    const { container } = render(<BarChart title="Monthly" unit="MWh" groups={[{ label: 'Jan', values: [1, 2] }, { label: 'Feb', values: [3, 4] }]} seriesLabels={['A', 'B']} />)
    expect(container.querySelectorAll('rect[data-bar]')).toHaveLength(4)
  })
  it('WaterfallChart: one bar per step with its label', () => {
    const { container } = render(<WaterfallChart title="Losses" steps={[{ key: 'reference', label: 'Ref', kwh: 100, kind: 'start' }, { key: 'l', label: 'Loss', kwh: 10, kind: 'loss' }, { key: 'ac_output', label: 'AC', kwh: 90, kind: 'end' }]} />)
    expect(container.querySelectorAll('rect[data-step]')).toHaveLength(3)
    expect(screen.getByText('Loss')).toBeTruthy()
  })
  it('TornadoChart: two bars per variable', () => {
    const { container } = render(<TornadoChart title="Sensitivity" baseNpvZar={100} bars={[{ variable: 'capex', label: 'Capex', lowNpvZar: 50, highNpvZar: 150, spreadZar: 100 }]} />)
    expect(container.querySelectorAll('rect[data-side]')).toHaveLength(2)
  })
  it('CashflowChart: a bar per year and one cumulative line', () => {
    const { container } = render(<CashflowChart title="Cashflow" rows={[{ year: 0, netZar: -100, cumulativeZar: -100 }, { year: 1, netZar: 60, cumulativeZar: -40 }, { year: 2, netZar: 60, cumulativeZar: 20 }]} />)
    expect(container.querySelectorAll('rect[data-year]')).toHaveLength(3)
    expect(container.querySelectorAll('path[data-series="cumulative"]')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run — FAIL.** `pnpm --filter web test -- src/components/solar`

- [ ] **Step 3: Implement.**

`format.ts`:
```ts
/** Display formatting only (no result is computed here). Units are always shown (spec §0.4 rule 3). */
const group = (n: number, dp: number) => {
  const [i, d] = Math.abs(n).toFixed(dp).split('.')
  const g = i!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return d ? `${g}.${d}` : g
}
export const num = (x: number, dp = 1) => `${x < 0 ? '−' : ''}${group(x, dp)}`
export const rand = (zar: number, dp = 0) => `${zar < 0 ? '−' : ''}R ${group(zar, dp)}`
export const mwh = (kwh: number) => `${num(kwh / 1000, 1)} MWh`
export const kw = (x: number) => `${num(x, 1)} kW`
export const pct = (fraction: number, dp = 1) => `${num(fraction * 100, dp)} %`
export const years = (y: number | null) => (y === null ? 'n/a' : `${num(y, 1)} years`)
```

`geometry.ts`:
```ts
/** Pure SVG geometry for the Solar charts (tested; the components only draw what this returns). */
export function linearScale([d0, d1]: [number, number], [r0, r1]: [number, number]) {
  const span = d1 - d0
  return (v: number) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0))
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min]
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const start = Math.floor(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 1e-9 || out.length === 0 || out[out.length - 1]! < max; v += step) out.push(Math.round(v / step) * step)
  return out
}

export function extentWithZero(series: number[][]): [number, number] {
  const all = series.flat().filter(Number.isFinite)
  if (all.length === 0) return [0, 1]
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all)
  return hi === lo ? [lo, lo + 1] : [lo, hi]
}

const r2 = (v: number) => Math.round(v * 100) / 100
export function linePath(values: number[], x: (i: number) => number, y: (v: number) => number): string {
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${r2(x(i))},${r2(y(v))}`).join('')
}

export function waterfallBars(steps: Array<{ kwh: number; kind: 'start' | 'loss' | 'subtotal' | 'end' }>): Array<{ from: number; to: number }> {
  let level = 0
  return steps.map((s) => {
    if (s.kind === 'loss') { const b = { from: level - s.kwh, to: level }; level -= s.kwh; return b }
    level = s.kwh
    return { from: 0, to: s.kwh }
  })
}

export function tornadoLayout<T extends { lowNpvZar: number; highNpvZar: number; spreadZar: number }>(base: number, bars: T[]) {
  const rows = [...bars].sort((a, b) => b.spreadZar - a.spreadZar)
  const vals = rows.flatMap((b) => [b.lowNpvZar, b.highNpvZar, base])
  return { rows, domain: [Math.min(...vals), Math.max(...vals)] as [number, number] }
}

export const SERIES_COLOURS = ['var(--c-amber, #d97706)', 'var(--c-blue, #2563eb)', 'var(--c-green, #16a34a)', 'var(--c-red, #dc2626)', 'var(--c-violet, #7c3aed)'] as const
```
(`niceTicks(0, 97, 5)`: raw 19.4 → mag 10 → step 20 → 0,20,…,100. `niceTicks(-3, 7, 5)`: raw 2 → step 2 → start −4 → −4…8.)

`LineChart.tsx`:
```tsx
'use client'
import { extentWithZero, linearScale, linePath, niceTicks, SERIES_COLOURS } from './geometry'
import { num } from '../format'

export interface LineSeries { label: string; values: number[] }
const W = 640, H = 240, L = 48, R = 12, T = 12, B = 28

export function LineChart({ title, unit, xLabels, series, height = H }: { title: string; unit: string; xLabels: string[]; series: LineSeries[]; height?: number }) {
  const [lo, hi] = extentWithZero(series.map((s) => s.values))
  const ticks = niceTicks(lo, hi, 4)
  const y = linearScale([ticks[0]!, ticks[ticks.length - 1]!], [height - B, T])
  const n = Math.max(1, ...series.map((s) => s.values.length))
  const x = linearScale([0, Math.max(1, n - 1)], [L, W - R])
  const every = Math.ceil(xLabels.length / 12)
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto' }}>
        <title>{title}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--c-border, #e5e7eb)" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--c-text-dim)">{num(t, 0)}</text>
          </g>
        ))}
        {xLabels.map((lab, i) => (i % every === 0 ? <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--c-text-dim)">{lab}</text> : null))}
        <text x={4} y={T + 4} fontSize="10" fill="var(--c-text-dim)">{unit}</text>
        {series.map((s, k) => (
          <path key={s.label} data-series={s.label} d={linePath(s.values, x, y)} fill="none" stroke={SERIES_COLOURS[k % SERIES_COLOURS.length]} strokeWidth={1.8} />
        ))}
      </svg>
      <figcaption style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12 }}>
        {series.map((s, k) => (
          <span key={s.label}><span aria-hidden style={{ display: 'inline-block', width: 10, height: 3, background: SERIES_COLOURS[k % SERIES_COLOURS.length], marginRight: 4, verticalAlign: 'middle' }} />{s.label}</span>
        ))}
      </figcaption>
    </figure>
  )
}
```

`BarChart.tsx`:
```tsx
'use client'
import { extentWithZero, linearScale, niceTicks, SERIES_COLOURS } from './geometry'
import { num } from '../format'

const W = 640, H = 240, L = 48, R = 12, T = 12, B = 28
export function BarChart({ title, unit, groups, seriesLabels }: { title: string; unit: string; groups: Array<{ label: string; values: number[] }>; seriesLabels: string[] }) {
  const [lo, hi] = extentWithZero(groups.map((g) => g.values))
  const ticks = niceTicks(lo, hi, 4)
  const y = linearScale([ticks[0]!, ticks[ticks.length - 1]!], [H - B, T])
  const gw = (W - L - R) / Math.max(1, groups.length)
  const bw = (gw * 0.8) / Math.max(1, seriesLabels.length)
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto' }}>
        <title>{title}</title>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--c-border, #e5e7eb)" /><text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--c-text-dim)">{num(t, 0)}</text></g>)}
        <text x={4} y={T + 4} fontSize="10" fill="var(--c-text-dim)">{unit}</text>
        {groups.map((g, gi) => (
          <g key={g.label}>
            {g.values.map((v, si) => (
              <rect key={si} data-bar="" x={L + gi * gw + gw * 0.1 + si * bw} width={bw} y={Math.min(y(v), y(0))} height={Math.abs(y(v) - y(0))} fill={SERIES_COLOURS[si % SERIES_COLOURS.length]}>
                <title>{`${g.label} — ${seriesLabels[si]}: ${num(v, 1)} ${unit}`}</title>
              </rect>
            ))}
            <text x={L + gi * gw + gw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--c-text-dim)">{g.label}</text>
          </g>
        ))}
      </svg>
      <figcaption style={{ display: 'flex', gap: 12, fontSize: 12 }}>
        {seriesLabels.map((s, k) => <span key={s}><span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, background: SERIES_COLOURS[k % SERIES_COLOURS.length], marginRight: 4 }} />{s}</span>)}
      </figcaption>
    </figure>
  )
}
```

`WaterfallChart.tsx`:
```tsx
'use client'
import { linearScale, niceTicks, waterfallBars } from './geometry'
import { num } from '../format'

export interface Step { key: string; label: string; kwh: number; kind: 'start' | 'loss' | 'subtotal' | 'end' }
const W = 640, ROW = 26, L = 250, R = 70
export function WaterfallChart({ title, steps }: { title: string; steps: Step[] }) {
  const bars = waterfallBars(steps)
  const max = Math.max(1, ...steps.map((s) => s.kwh))
  const ticks = niceTicks(0, max, 4)
  const x = linearScale([0, ticks[ticks.length - 1]!], [L, W - R])
  const H = steps.length * ROW + 20
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto' }}>
      <title>{title}</title>
      {steps.map((s, i) => (
        <g key={s.key}>
          <text x={L - 8} y={i * ROW + 17} textAnchor="end" fontSize="11">{s.label}</text>
          <rect data-step={s.key} x={x(bars[i]!.from)} width={Math.max(1, x(bars[i]!.to) - x(bars[i]!.from))} y={i * ROW + 5} height={ROW - 10}
            fill={s.kind === 'loss' ? 'var(--c-red, #dc2626)' : 'var(--c-amber, #d97706)'} />
          <text x={W - R + 4} y={i * ROW + 17} fontSize="11">{s.kind === 'loss' ? '−' : ''}{num(s.kwh / 1000, 1)} MWh</text>
        </g>
      ))}
    </svg>
  )
}
```

`TornadoChart.tsx`:
```tsx
'use client'
import { linearScale, tornadoLayout } from './geometry'
import { rand } from '../format'

export interface TornadoBarView { variable: string; label: string; lowNpvZar: number; highNpvZar: number; spreadZar: number }
const W = 640, ROW = 28, L = 150, R = 20
export function TornadoChart({ title, baseNpvZar, bars }: { title: string; baseNpvZar: number; bars: TornadoBarView[] }) {
  const { rows, domain } = tornadoLayout(baseNpvZar, bars)
  const x = linearScale(domain, [L, W - R])
  const H = rows.length * ROW + 30
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto' }}>
      <title>{title}</title>
      <line x1={x(baseNpvZar)} x2={x(baseNpvZar)} y1={0} y2={H - 20} stroke="var(--c-text-dim)" />
      <text x={x(baseNpvZar)} y={H - 6} textAnchor="middle" fontSize="10">Base NPV {rand(baseNpvZar)}</text>
      {rows.map((b, i) => {
        const y = i * ROW + 4
        const lowX = x(Math.min(b.lowNpvZar, baseNpvZar)), lowW = Math.abs(x(b.lowNpvZar) - x(baseNpvZar))
        const highX = x(Math.min(b.highNpvZar, baseNpvZar)), highW = Math.abs(x(b.highNpvZar) - x(baseNpvZar))
        return (
          <g key={b.variable}>
            <text x={L - 8} y={y + 15} textAnchor="end" fontSize="11">{b.label}</text>
            <rect data-side="low" x={lowX} width={lowW} y={y} height={ROW - 8} fill="var(--c-blue, #2563eb)"><title>{`${b.label} −20 %: ${rand(b.lowNpvZar)}`}</title></rect>
            <rect data-side="high" x={highX} width={highW} y={y} height={ROW - 8} fill="var(--c-amber, #d97706)" opacity={0.8}><title>{`${b.label} +20 %: ${rand(b.highNpvZar)}`}</title></rect>
          </g>
        )
      })}
    </svg>
  )
}
```

`CashflowChart.tsx`:
```tsx
'use client'
import { extentWithZero, linearScale, linePath, niceTicks } from './geometry'
import { num } from '../format'

const W = 640, H = 260, L = 64, R = 12, T = 12, B = 28
export function CashflowChart({ title, rows }: { title: string; rows: Array<{ year: number; netZar: number; cumulativeZar: number }> }) {
  const [lo, hi] = extentWithZero([rows.map((r) => r.netZar), rows.map((r) => r.cumulativeZar)])
  const ticks = niceTicks(lo, hi, 4)
  const y = linearScale([ticks[0]!, ticks[ticks.length - 1]!], [H - B, T])
  const bw = (W - L - R) / Math.max(1, rows.length)
  const cx = (i: number) => L + i * bw + bw / 2
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto' }}>
      <title>{title}</title>
      {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--c-border, #e5e7eb)" /><text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10">{num(t / 1e6, 1)}</text></g>)}
      <text x={4} y={T + 4} fontSize="10" fill="var(--c-text-dim)">R million</text>
      {rows.map((r, i) => (
        <rect key={r.year} data-year={r.year} x={L + i * bw + bw * 0.15} width={bw * 0.7} y={Math.min(y(r.netZar), y(0))} height={Math.abs(y(r.netZar) - y(0))}
          fill={r.netZar < 0 ? 'var(--c-red, #dc2626)' : 'var(--c-green, #16a34a)'}><title>{`Year ${r.year}: net R ${num(r.netZar, 0)}`}</title></rect>
      ))}
      <path data-series="cumulative" d={linePath(rows.map((r) => r.cumulativeZar), cx, y)} fill="none" stroke="var(--c-amber, #d97706)" strokeWidth={2} />
      {rows.map((r, i) => (i % 5 === 0 ? <text key={r.year} x={cx(i)} y={H - 8} textAnchor="middle" fontSize="10">{r.year}</text> : null))}
    </svg>
  )
}
```

- [ ] **Step 4: Run — PASS; commit** ("feat(solar): SVG chart kit (no chart dependency) and display formatting").

---

### Task 24: Page loaders (Yield view model, readiness extra, headline KPIs)

**Files:**
- Create: `apps/web/src/lib/solar/cases/page-data.ts`
- Test: `apps/web/src/lib/solar/cases/page-data.test.ts`

- [ ] **Step 1: Failing test:**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { defaultCaseConfig } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'

const h = vi.hoisted(() => ({ shared: vi.fn(), ctx: vi.fn() }))
vi.mock('./run-context', () => ({ loadStudyInputs: h.shared, contextForCase: h.ctx }))
import { loadYieldPageData, loadSolarReadinessExtra, loadHeadlineKpis } from './page-data'

const P = 'p1', S = 's1', ORG = 'o1'
const cfg = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 500, acKw: 400 })
const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64)
const kpis = { dcKwp: 500, acKw: 400, annualAcKwh: 800_000, pvAcKwh: 800_000, specificYieldKwhPerKwp: 1600 }
const outputs = { version: 1, kpis, monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, pvKwh: 1000 * (i + 1) })), typicalDays: [], daily: [], waterfall: [], checks: [], provenance: {} }
const tables = {
  'solar.cases': [
    { id: 'c1', study_id: S, project_id: P, name: 'Base', pv_source: 'manual', config: cfg, updated_at: 'T1', created_at: '1' },
    { id: 'c2', study_id: S, project_id: P, name: 'Big', pv_source: 'manual', config: cfg, updated_at: 'T1', created_at: '2' },
  ],
  'solar.case_runs': [
    { id: 'r1', case_id: 'c1', project_id: P, status: 'succeeded', inputs_hash: H1, started_at: '2026-09-28T09:00:00Z', finished_at: '2026-09-28T09:00:05Z', run_by: 'u1', outputs },
    { id: 'r2', case_id: 'c2', project_id: P, status: 'succeeded', inputs_hash: H1, started_at: '2026-09-28T09:00:00Z', finished_at: '2026-09-28T09:00:05Z', run_by: 'u1', outputs },
  ],
  'solar.case_run_financials': [{ case_id: 'c1', case_run_id: 'r1', created_at: 'T', results: { year1Bills: { beforeZar: 1e6, afterZar: 6e5 }, finance: { lcoeZarPerKwh: 0.9, models: [{ model: 'cash', views: [{ view: 'owner', npvZar: 2e6, irr: 0.2, simplePaybackYears: 5, discountedPaybackYears: 7 }] }] } } }],
  'solar.equipment': [{ id: 'm1', organisation_id: null, kind: 'module', make: 'Generic', model: 'M', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35 }, retired_at: null }],
  'public.profiles': [{ id: 'u1', full_name: 'Arno' }],
}
const shared = { study: { id: S, organisation_id: ORG, selected_case_id: 'c1', updated_at: 'T0', export_mode: 'net_billing', export_limit_kw: null }, siteLoad: { series: new Array(8760).fill(100), basis: 'S1', referenceYear: 2025 }, tariff: { ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' }, touPeriods: null }

beforeEach(() => {
  vi.clearAllMocks()
  h.shared.mockResolvedValue(shared)
  // c1 current (H1), c2 stale (H2)
  h.ctx.mockImplementation(async (_svc: unknown, _s: unknown, row: { id: string }) => ({ ok: true, ctx: { build: { ok: true }, currentHash: row.id === 'c1' ? H1 : H2, weather: null, config: cfg } }))
})

describe('loadYieldPageData', () => {
  it('cards: status per case from the stored runs vs the current hash; saving only for cost-view', async () => {
    const svc = fakeSupabase({ tables: { 'solar.org_settings': [] } }).client
    const d = await loadYieldPageData(fakeSupabase({ tables }).client as never, svc as never, P, 'edit_financials', {})
    expect(d.cases.map((c) => [c.id, c.status, c.selected, c.canSelect])).toEqual([['c1', 'done', true, true], ['c2', 'stale', false, true]])
    expect(d.cases[0]!.annualPvKwh).toBe(800_000)
    expect(d.cases[0]!.year1SavingZar).toBe(400_000)
    const view = await loadYieldPageData(fakeSupabase({ tables }).client as never, svc as never, P, 'view', {})
    expect(view.cases[0]!.year1SavingZar).toBeNull()
    expect(view.equipment.modules).toEqual([])
  })
  it('editor opens ?case=, else the selected case; JSON-only; tariff reason passed through', async () => {
    const svc = fakeSupabase({ tables: { 'solar.org_settings': [], 'public.profiles': [{ id: 'u1', full_name: 'Arno' }] } }).client
    const d = await loadYieldPageData(fakeSupabase({ tables }).client as never, svc as never, P, 'edit', { caseId: 'c2' })
    expect(d.editor!.caseId).toBe('c2')
    expect(d.editor!.lastRun!.runByName).toBe('Arno')
    expect(d.editor!.tariffNote).toBe('No tariff is pinned for this study — pin one on the Tariff tab.')
    expect(d.editor!.siteLoad).toEqual({ basis: 'S1', referenceYear: 2025, annualKwh: 876_000, peakKw: 100 })
    expect(JSON.parse(JSON.stringify(d))).toEqual(d)
  })
  it('compare 2–4 cases; ignores unknown ids; money only for cost-view', async () => {
    const svc = fakeSupabase({ tables: { 'solar.org_settings': [] } }).client
    const d = await loadYieldPageData(fakeSupabase({ tables }).client as never, svc as never, P, 'edit', { compare: 'c1,c2,zz' })
    expect(d.compare!.map((c) => c.caseId)).toEqual(['c1', 'c2'])
    expect(d.compare![0]!.money).toBeNull()
    expect(d.compare![0]!.monthlyPvKwh).toHaveLength(12)
    expect((await loadYieldPageData(fakeSupabase({ tables }).client as never, svc as never, P, 'edit', { compare: 'c1' })).compare).toBeNull()
  })
  it('no study → empty state data', async () => {
    h.shared.mockResolvedValueOnce(null)
    const d = await loadYieldPageData(fakeSupabase({}).client as never, {} as never, P, 'edit', {})
    expect(d).toMatchObject({ hasStudy: false, cases: [], editor: null })
  })
})

describe('loadSolarReadinessExtra + loadHeadlineKpis', () => {
  it('reports the selected case status and flags stale', async () => {
    h.ctx.mockImplementation(async () => ({ ok: true, ctx: { build: { ok: true }, currentHash: H2, weather: null, config: cfg } }))
    const x = await loadSolarReadinessExtra(fakeSupabase({ tables }).client as never, {} as never, P, 'edit')
    expect(x.yield).toEqual({ caseCount: 2, selectedCaseId: 'c1', selectedStatus: 'stale' })
    expect(x.stale).toEqual({ caseId: 'c1', caseName: 'Base' })
    expect(x.layoutManual).toBe(true)
  })
  it('headline KPIs from the selected case’s stored run; rand values only for cost-view', async () => {
    const k = await loadHeadlineKpis(fakeSupabase({ tables }).client as never, P, 'edit_financials', 'c1')
    expect(k).toMatchObject({ caseId: 'c1', caseName: 'Base', energy: { dcKwp: 500 }, money: { billBeforeZar: 1e6, billAfterZar: 6e5, savingZar: 4e5, irr: 0.2, npvZar: 2e6, lcoeZarPerKwh: 0.9, simplePaybackYears: 5 } })
    expect((await loadHeadlineKpis(fakeSupabase({ tables }).client as never, P, 'edit', 'c1'))!.money).toBeNull()
    expect(await loadHeadlineKpis(fakeSupabase({ tables }).client as never, P, 'edit', null)).toBeNull()
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `page-data.ts`:

```ts
import 'server-only'
/**
 * View models for the Yield & Scenarios page, the tab readiness and the Overview KPIs. JSON only
 * (a page.tsx hands these to client components). Every figure is read from a stored run or stored
 * financial result; the only arithmetic here is summarising the stored INPUT load for display
 * and year-1 saving = stored bill before − stored bill after.
 * Callers must have passed requireSolarLevel(project, 'view') first — `svc` reads the study inputs.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSolarOrgSettings, type SolarAccessLevel, type SolarReadinessExtra, type FinancialsReadinessInput } from '@esite/shared'
import { caseStatus, capexTotals, parseCaseConfig, parseFinanceConfig, resetLossesToDefaults, type CaseConfig, type CaseLosses, type CaseRunOutputs, type CaseStatus, type RunKpis } from '@esite/shared/solar-cases'
import { contextForCase, loadStudyInputs, type CaseRow } from './run-context'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CaseCardView {
  id: string; name: string; pvSource: string; dcKwp: number; acKw: number; batteryKwh: number | null; updatedAt: string
  status: CaseStatus; statusLabel: string; lastRunAt: string | null; annualPvKwh: number | null; year1SavingZar: number | null
  selected: boolean; canSelect: boolean
}
export interface RunView { id: string; startedAt: string; finishedAt: string | null; runByName: string; outputs: CaseRunOutputs }
export interface EquipmentOption { id: string; make: string; model: string; retired: boolean; specs: Record<string, number | boolean> }
export interface CaseEditorData {
  caseId: string; name: string; updatedAt: string; config: CaseConfig; buildReasons: string[]
  status: CaseStatus; statusLabel: string; running: boolean
  weather: { id: string; latRound: number; lngRound: number; fetchedAt: string; radiationDb: string | null; gsaPvoutKwhPerKwp: number | null } | null
  studyExport: { mode: string | null; limitKw: number | null }
  siteLoad: { basis: string; referenceYear: number; annualKwh: number; peakKw: number } | null
  tariffNote: string | null
  defaultLosses: { racked: CaseLosses; flush: CaseLosses }
  lastRun: RunView | null
}
export interface CompareMoney { year1SavingZar: number; irr: number | null; npvZar: number; simplePaybackYears: number | null }
export interface CompareColumn { caseId: string; name: string; kpis: RunKpis; monthlyPvKwh: number[]; money: CompareMoney | null }
export interface YieldPageData {
  hasStudy: boolean; studyUpdatedAt: string | null; selectedCaseId: string | null
  cases: CaseCardView[]; editor: CaseEditorData | null; compare: CompareColumn[] | null
  equipment: { modules: EquipmentOption[]; inverters: EquipmentOption[]; batteries: EquipmentOption[] }
}

const EMPTY_EQUIPMENT = { modules: [], inverters: [], batteries: [] }

export async function runsByCase(user: AnyClient, projectId: string) {
  const { data } = await user.schema('solar').from('case_runs')
    .select('id, case_id, status, inputs_hash, started_at, finished_at, run_by').eq('project_id', projectId).order('started_at', { ascending: false })
  const all = (data ?? []) as Row[]
  const latest = new Map<string, Row>(), ok = new Map<string, Row>()
  for (const r of all) {
    if (!latest.has(r.case_id)) latest.set(r.case_id, r)
    if (r.status === 'succeeded' && !ok.has(r.case_id)) ok.set(r.case_id, r)
  }
  return { latest, ok }
}

export async function outputsOf(user: AnyClient, runId: string): Promise<CaseRunOutputs | null> {
  const { data } = await user.schema('solar').from('case_runs').select('outputs').eq('id', runId).maybeSingle()
  return ((data as Row | null)?.outputs as CaseRunOutputs | undefined) ?? null
}

export async function latestMoney(user: AnyClient, caseIds: string[]): Promise<Map<string, Row>> {
  if (caseIds.length === 0) return new Map()
  const { data } = await user.schema('solar').from('case_run_financials').select('case_id, case_run_id, created_at, results').in('case_id', caseIds).order('created_at', { ascending: false })
  const m = new Map<string, Row>()
  for (const r of (data ?? []) as Row[]) if (!m.has(r.case_id)) m.set(r.case_id, r)
  return m
}

const moneyOf = (fin: Row | undefined): CompareMoney | null => {
  if (!fin) return null
  const v = fin.results?.finance?.models?.[0]?.views?.[0]
  const b = fin.results?.year1Bills
  if (!v || !b) return null
  return { year1SavingZar: b.beforeZar - b.afterZar, irr: v.irr ?? null, npvZar: v.npvZar, simplePaybackYears: v.simplePaybackYears ?? null }
}

export async function loadYieldPageData(user: AnyClient, svc: AnyClient, projectId: string, level: SolarAccessLevel, q: { caseId?: string; compare?: string }): Promise<YieldPageData> {
  const shared = await loadStudyInputs(svc, projectId)
  if (!shared) return { hasStudy: false, studyUpdatedAt: null, selectedCaseId: null, cases: [], editor: null, compare: null, equipment: EMPTY_EQUIPMENT }
  const { data: caseData } = await user.schema('solar').from('cases').select('id, study_id, project_id, name, pv_source, config, updated_at, created_at')
    .eq('project_id', projectId).order('created_at', { ascending: true })
  const rows = (caseData ?? []) as CaseRow[]
  const { latest, ok } = await runsByCase(user, projectId)
  const money = level === 'edit_financials' ? await latestMoney(user, rows.map((r) => r.id)) : new Map<string, Row>()
  const now = Date.now()

  const ctxs = new Map<string, Awaited<ReturnType<typeof contextForCase>>>()
  for (const r of rows) ctxs.set(r.id, await contextForCase(svc, shared, r))
  const outputsCache = new Map<string, CaseRunOutputs | null>()
  const outputsFor = async (runId: string) => {
    if (!outputsCache.has(runId)) outputsCache.set(runId, await outputsOf(user, runId))
    return outputsCache.get(runId)!
  }

  const cases: CaseCardView[] = []
  for (const r of rows) {
    const c = ctxs.get(r.id)!
    const last = latest.get(r.id) ?? null, lastOk = ok.get(r.id) ?? null
    const st = caseStatus(last ? { status: last.status, inputsHash: last.inputs_hash, startedAt: last.started_at } : null,
      lastOk ? { inputsHash: lastOk.inputs_hash } : null, c.ok ? c.ctx.currentHash : null, now)
    const cfg = parseCaseConfig(r.config)
    const out = lastOk ? await outputsFor(lastOk.id) : null
    const m = moneyOf(money.get(r.id))
    cases.push({
      id: r.id, name: r.name, pvSource: r.pv_source, updatedAt: r.updated_at,
      dcKwp: cfg.ok ? cfg.config.pv.dcKwp : 0, acKw: cfg.ok ? cfg.config.pv.acKw : 0,
      batteryKwh: cfg.ok && cfg.config.battery.enabled ? cfg.config.battery.usableKwh : null,
      status: st.status, statusLabel: st.label, lastRunAt: lastOk?.finished_at ?? null,
      annualPvKwh: out?.kpis.annualAcKwh ?? null, year1SavingZar: m ? m.year1SavingZar : null,
      selected: shared.study.selected_case_id === r.id, canSelect: Boolean(lastOk),
    })
  }

  const editorId = [q.caseId, shared.study.selected_case_id, rows[0]?.id].find((id) => id && rows.some((r) => r.id === id)) ?? null
  let editor: CaseEditorData | null = null
  if (editorId) {
    const r = rows.find((x) => x.id === editorId)!
    const c = ctxs.get(editorId)!
    const card = cases.find((x) => x.id === editorId)!
    const lastOk = ok.get(editorId) ?? null
    const { data: os } = await svc.schema('solar').from('org_settings').select('settings').eq('organisation_id', shared.study.organisation_id).maybeSingle()
    const settings = readSolarOrgSettings((os as Row | null)?.settings ?? null)
    const parsed = parseCaseConfig(r.config)
    if (c.ok && parsed.ok) {
      const config = parsed.config
      let lastRun: RunView | null = null
      if (lastOk) {
        const outputs = await outputsFor(lastOk.id)
        const { data: prof } = await svc.from('profiles').select('id, full_name').eq('id', lastOk.run_by).maybeSingle()
        if (outputs) lastRun = { id: lastOk.id, startedAt: lastOk.started_at, finishedAt: lastOk.finished_at, runByName: ((prof as Row | null)?.full_name as string | undefined)?.trim() || 'Someone', outputs }
      }
      const series = shared.siteLoad?.series ?? []
      const w = c.ctx.weather
      editor = {
        caseId: r.id, name: r.name, updatedAt: r.updated_at, config,
        buildReasons: c.ctx.build.ok ? [] : c.ctx.build.reasons,
        status: card.status, statusLabel: card.statusLabel, running: card.status === 'running',
        weather: w ? { id: w.id, latRound: Number(w.lat_round), lngRound: Number(w.lng_round), fetchedAt: String(w.fetched_at ?? ''), radiationDb: (w.radiation_db ?? null) as string | null,
          gsaPvoutKwhPerKwp: w.gsa_pvout_kwh_per_kwp === null || w.gsa_pvout_kwh_per_kwp === undefined ? null : Number(w.gsa_pvout_kwh_per_kwp) } : null,
        studyExport: { mode: shared.study.export_mode, limitKw: shared.study.export_limit_kw },
        siteLoad: shared.siteLoad ? { basis: shared.siteLoad.basis, referenceYear: shared.siteLoad.referenceYear, annualKwh: series.reduce((a, v) => a + v, 0), peakKw: series.reduce((a, v) => Math.max(a, v), 0) } : null,
        tariffNote: shared.tariff.ok ? null : shared.tariff.reason,
        defaultLosses: {
          racked: resetLossesToDefaults({ ...config, pv: { ...config.pv, mounting: 'racked' } }, settings).losses,
          flush: resetLossesToDefaults({ ...config, pv: { ...config.pv, mounting: 'flush' } }, settings).losses,
        },
        lastRun,
      }
    }
  }

  const ids = (q.compare ?? '').split(',').filter((id) => rows.some((r) => r.id === id))
  let compare: CompareColumn[] | null = null
  if (ids.length >= 2 && ids.length <= 4) {
    compare = []
    for (const id of ids) {
      const lastOk = ok.get(id)
      const out = lastOk ? await outputsFor(lastOk.id) : null
      if (!out) continue
      compare.push({ caseId: id, name: rows.find((r) => r.id === id)!.name, kpis: out.kpis, monthlyPvKwh: out.monthly.map((m) => m.pvKwh), money: moneyOf(money.get(id)) })
    }
  }

  let equipment: YieldPageData['equipment'] = EMPTY_EQUIPMENT
  if (level !== 'view') {
    const { data: eq } = await user.schema('solar').from('equipment').select('id, organisation_id, kind, make, model, specs, retired_at')
    const opts = ((eq ?? []) as Row[]).map((e) => ({ id: e.id, make: e.make, model: e.model, retired: e.retired_at !== null, specs: e.specs, kind: e.kind }))
    const pick = (k: string) => opts.filter((o) => o.kind === k).map(({ kind: _k, ...o }) => o) // eslint-disable-line @typescript-eslint/no-unused-vars
    equipment = { modules: pick('module'), inverters: pick('inverter'), batteries: pick('battery') }
  }

  return { hasStudy: true, studyUpdatedAt: shared.study.updated_at, selectedCaseId: shared.study.selected_case_id, cases, editor, compare, equipment }
}

export interface ReadinessState extends SolarReadinessExtra { stale: { caseId: string; caseName: string } | null }

export async function loadSolarReadinessExtra(user: AnyClient, svc: AnyClient, projectId: string, level: SolarAccessLevel): Promise<ReadinessState> {
  const shared = await loadStudyInputs(svc, projectId)
  if (!shared) return { stale: null }
  const { data: caseData } = await user.schema('solar').from('cases').select('id, study_id, project_id, name, pv_source, config, updated_at').eq('project_id', projectId)
  const rows = (caseData ?? []) as CaseRow[]
  const sel = rows.find((r) => r.id === shared.study.selected_case_id) ?? null
  let selectedStatus: CaseStatus | null = null
  if (sel) {
    const { latest, ok } = await runsByCase(user, projectId)
    const c = await contextForCase(svc, shared, sel)
    const last = latest.get(sel.id), lastOk = ok.get(sel.id)
    selectedStatus = caseStatus(last ? { status: last.status, inputsHash: last.inputs_hash, startedAt: last.started_at } : null,
      lastOk ? { inputsHash: lastOk.inputs_hash } : null, c.ok ? c.ctx.currentHash : null, Date.now()).status
  }
  let financials: FinancialsReadinessInput | null = null
  if (sel && level === 'edit_financials') {
    const { data } = await user.schema('solar').from('case_financials').select('config').eq('case_id', sel.id)
    const row = Array.isArray(data) ? (data[0] as Row | undefined) : undefined
    const fin = row ? parseFinanceConfig(row.config) : null
    const cfg = parseCaseConfig(sel.config)
    if (fin?.ok && cfg.ok) {
      const m = fin.fin.models
      financials = {
        capexZar: capexTotals(fin.fin.capex, cfg.config.pv.dcKwp).exclVatZar,
        hasModel: m.cash.enabled || m.debt.enabled || m.ppa.enabled || m.lease.enabled,
        usingOrgDefaults: fin.fin.capex.length > 0 && fin.fin.capex.every((l) => l.source === 'rate_card'),
      }
    }
  }
  return {
    yield: { caseCount: rows.length, selectedCaseId: sel?.id ?? null, selectedStatus },
    financials,
    layoutManual: sel?.pv_source === 'manual',
    stale: sel && selectedStatus === 'stale' ? { caseId: sel.id, caseName: sel.name } : null,
  }
}

export interface HeadlineKpis {
  caseId: string; caseName: string
  energy: Pick<RunKpis, 'dcKwp' | 'acKw' | 'batteryKwh' | 'batteryKw' | 'annualAcKwh' | 'specificYieldKwhPerKwp' | 'selfConsumption' | 'solarFraction' | 'exportKwh'>
  money: { billBeforeZar: number; billAfterZar: number; savingZar: number; simplePaybackYears: number | null; irr: number | null; npvZar: number; lcoeZarPerKwh: number | null } | null
}

/** Overview §2.4 — from the selected case's latest succeeded run (and its latest financial result). */
export async function loadHeadlineKpis(user: AnyClient, projectId: string, level: SolarAccessLevel, selectedCaseId: string | null): Promise<HeadlineKpis | null> {
  if (!selectedCaseId) return null
  const { data: c } = await user.schema('solar').from('cases').select('id, name').eq('id', selectedCaseId).eq('project_id', projectId).maybeSingle()
  if (!c) return null
  const { ok } = await runsByCase(user, projectId)
  const lastOk = ok.get(selectedCaseId)
  if (!lastOk) return null
  const out = await outputsOf(user, lastOk.id)
  if (!out) return null
  const k = out.kpis
  let money: HeadlineKpis['money'] = null
  if (level === 'edit_financials') {
    const fin = (await latestMoney(user, [selectedCaseId])).get(selectedCaseId)
    const v = fin?.results?.finance?.models?.[0]?.views?.[0]
    const b = fin?.results?.year1Bills
    if (fin && v && b && fin.case_run_id === lastOk.id) {
      money = { billBeforeZar: b.beforeZar, billAfterZar: b.afterZar, savingZar: b.beforeZar - b.afterZar, simplePaybackYears: v.simplePaybackYears ?? null, irr: v.irr ?? null, npvZar: v.npvZar, lcoeZarPerKwh: fin.results.finance.lcoeZarPerKwh ?? null }
    }
  }
  return {
    caseId: (c as Row).id, caseName: (c as Row).name,
    energy: { dcKwp: k.dcKwp, acKw: k.acKw, batteryKwh: k.batteryKwh ?? null, batteryKw: k.batteryKw ?? null, annualAcKwh: k.annualAcKwh, specificYieldKwhPerKwp: k.specificYieldKwhPerKwp, selfConsumption: k.selfConsumption, solarFraction: k.solarFraction, exportKwh: k.exportKwh },
    money,
  }
}
```
Test fixture note: the stub `kpis` lacks some fields; `toMatchObject` only checks those asserted. `SolarReadinessExtra` and `FinancialsReadinessInput` are exported from `@esite/shared` via `solar/readiness.ts` (Task 13).

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): Yield view model, readiness state and headline KPIs from stored runs").

---

### Task 25: Yield page shell, case list, new-case dialog, stale banner

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/yield/page.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/yield/CaseList.tsx` (+ `CaseList.test.tsx`)
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/yield/NewCaseDialog.tsx` (+ `NewCaseDialog.test.tsx`)
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/_components/StaleBanner.tsx` (+ `StaleBanner.test.tsx`)
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/_components/runCase.ts` (client fetch helpers)

- [ ] **Step 1: Failing tests.**

`StaleBanner.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ refresh: vi.fn(), post: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('./runCase', () => ({ postRun: h.post }))
import { StaleBanner } from './StaleBanner'

beforeEach(() => vi.clearAllMocks())
describe('StaleBanner', () => {
  it('names the case and, for writers, re-runs it and refreshes on success', async () => {
    h.post.mockResolvedValue({ ok: true })
    render(<StaleBanner projectId="p1" caseId="c1" caseName="Base" canRun />)
    expect(screen.getByRole('status').textContent).toContain('Results for “Base” no longer match its inputs')
    fireEvent.click(screen.getByRole('button', { name: 'Re-run selected case' }))
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
    expect(h.post).toHaveBeenCalledWith('p1', 'c1')
  })
  it('shows the server sentence on failure; no button for View users', async () => {
    h.post.mockResolvedValue({ ok: false, error: 'Build the site load on the Load tab first.' })
    const { rerender } = render(<StaleBanner projectId="p1" caseId="c1" caseName="Base" canRun />)
    fireEvent.click(screen.getByRole('button', { name: 'Re-run selected case' }))
    await screen.findByText('Build the site load on the Load tab first.')
    rerender(<StaleBanner projectId="p1" caseId="c1" caseName="Base" canRun={false} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
```

`CaseList.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), dup: vi.fn(), del: vi.fn(), sel: vi.fn(), ren: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }))
vi.mock('@/actions/solar-cases.actions', () => ({ duplicateSolarCaseAction: h.dup, deleteSolarCaseAction: h.del, setSelectedSolarCaseAction: h.sel, renameSolarCaseAction: h.ren, createSolarCaseAction: vi.fn() }))
import { CaseList } from './CaseList'
import type { CaseCardView } from '@/lib/solar/cases/page-data'

const card = (over: Partial<CaseCardView>): CaseCardView => ({ id: 'c1', name: 'Base', pvSource: 'manual', dcKwp: 500, acKw: 400, batteryKwh: null, updatedAt: 'T', status: 'done', statusLabel: 'Done', lastRunAt: '2026-09-28T09:00:05Z', annualPvKwh: 800_000, year1SavingZar: 400_000, selected: true, canSelect: true, ...over })
beforeEach(() => vi.clearAllMocks())

describe('CaseList', () => {
  it('cards show kWp, status, yield; saving only when given (cost-view)', () => {
    render(<CaseList projectId="p1" level="edit_financials" cases={[card({}), card({ id: 'c2', name: 'Big', status: 'stale', statusLabel: 'Stale', selected: false, year1SavingZar: null })]} studyUpdatedAt="T0" openCaseId="c1" />)
    expect(screen.getByText('500.0 kWp · 400.0 kW AC')).toBeTruthy()
    expect(screen.getByText('Stale')).toBeTruthy()
    expect(screen.getByText('800.0 MWh/yr')).toBeTruthy()
    expect(screen.getByText('Year-1 saving R 400 000')).toBeTruthy()
    expect(screen.getByText('Selected')).toBeTruthy()
  })
  it('View users see no write controls', () => {
    render(<CaseList projectId="p1" level="view" cases={[card({})]} studyUpdatedAt="T0" openCaseId="c1" />)
    for (const name of ['New case', 'Duplicate', 'Rename', 'Delete', 'Set as selected']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.getByRole('button', { name: 'Compare' })).toBeTruthy()
  })
  it('Delete arms first, commits on the second press; selected case delete shows the server sentence', async () => {
    h.del.mockResolvedValue({ error: 'This is the selected case — choose another selected case first.' })
    render(<CaseList projectId="p1" level="edit" cases={[card({})]} studyUpdatedAt="T0" openCaseId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(h.del).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete “Base”?' }))
    await screen.findByText('This is the selected case — choose another selected case first.')
  })
  it('Compare needs 2–4 ticked cases and navigates with their ids', () => {
    render(<CaseList projectId="p1" level="view" cases={[card({}), card({ id: 'c2', name: 'Big', selected: false })]} studyUpdatedAt="T0" openCaseId="c1" />)
    const compare = screen.getByRole('button', { name: 'Compare' }) as HTMLButtonElement
    expect(compare.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Compare Base'))
    fireEvent.click(screen.getByLabelText('Compare Big'))
    fireEvent.click(compare)
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/yield?compare=c1,c2')
  })
  it('Set as selected is offered only for a case with a completed run', async () => {
    h.sel.mockResolvedValue({ ok: true, updatedAt: 'T1' })
    render(<CaseList projectId="p1" level="edit" cases={[card({ selected: false }), card({ id: 'c2', name: 'Big', selected: false, canSelect: false })]} studyUpdatedAt="T0" openCaseId="c1" />)
    const buttons = screen.getAllByRole('button', { name: 'Set as selected' }) as HTMLButtonElement[]
    expect(buttons.map((b) => b.disabled)).toEqual([false, true])
    fireEvent.click(buttons[0]!)
    await waitFor(() => expect(h.sel).toHaveBeenCalledWith({ projectId: 'p1', caseId: 'c1', expectedUpdatedAt: 'T0' }))
  })
})
```

`NewCaseDialog.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ create: vi.fn(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: vi.fn() }) }))
vi.mock('@/actions/solar-cases.actions', () => ({ createSolarCaseAction: h.create }))
import { NewCaseDialog } from './NewCaseDialog'

describe('NewCaseDialog', () => {
  it('From layout is disabled with the reason; Manual creates and opens the case', async () => {
    h.create.mockResolvedValue({ ok: true, caseId: 'c9' })
    render(<NewCaseDialog projectId="p1" cases={[{ id: 'c1', name: 'Base' }]} onClose={() => {}} />)
    const layout = screen.getByLabelText('From layout') as HTMLInputElement
    expect(layout.disabled).toBe(true)
    expect(screen.getByText('Arrives with the Layout tab')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Option B' } })
    fireEvent.change(screen.getByLabelText('DC size (kWp)'), { target: { value: '600' } })
    fireEvent.change(screen.getByLabelText('AC size (kW)'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create case' }))
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/yield?case=c9'))
    expect(h.create).toHaveBeenCalledWith({ projectId: 'p1', name: 'Option B', start: { kind: 'manual', dcKwp: 600, acKw: 500 } })
  })
  it('field errors render beside their fields', async () => {
    h.create.mockResolvedValue({ fieldErrors: { name: 'A case with this name already exists' } })
    render(<NewCaseDialog projectId="p1" cases={[]} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Base' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create case' }))
    await screen.findByText('A case with this name already exists')
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement.**

`_components/runCase.ts`:
```ts
'use client'
/** Browser → the gated run/cancel routes. Returns the server's sentence verbatim (spec §0.4 rule 5). */
export async function postRun(projectId: string, caseId: string): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/projects/${projectId}/solar/cases/${caseId}/run`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    return res.ok ? { ok: true, runId: body.runId } : { ok: false, error: body.error ?? 'The run failed — try again.' }
  } catch {
    return { ok: false, error: 'The server could not be reached — check your connection and try again.' }
  }
}
export async function postCancel(projectId: string, caseId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/projects/${projectId}/solar/cases/${caseId}/cancel`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    return res.ok ? { ok: true } : { ok: false, error: body.error ?? 'The run could not be cancelled.' }
  } catch {
    return { ok: false, error: 'The server could not be reached.' }
  }
}
```

`_components/StaleBanner.tsx`:
```tsx
'use client'
/** Spec §0.3 "Stale" banner — Yield, Financials (and Reports later). The decision is made server-side. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { postRun } from './runCase'

export function StaleBanner({ projectId, caseId, caseName, canRun }: { projectId: string; caseId: string; caseName: string; canRun: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div role="status" style={{ border: '1px solid var(--c-amber)', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>Results for “{caseName}” no longer match its inputs — they are Stale.</span>
      {canRun && (
        <Button type="button" size="sm" disabled={busy} onClick={async () => {
          setBusy(true); setError(null)
          const r = await postRun(projectId, caseId)
          setBusy(false)
          if (r.ok) router.refresh(); else setError(r.error)
        }}>{busy ? 'Running…' : 'Re-run selected case'}</Button>
      )}
      {error && <span role="alert" style={{ color: 'var(--c-red, #dc2626)' }}>{error}</span>}
    </div>
  )
}
```

`yield/NewCaseDialog.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { createSolarCaseAction } from '@/actions/solar-cases.actions'

type Start = 'manual' | 'copy' | 'layout'
export function NewCaseDialog({ projectId, cases, onClose }: { projectId: string; cases: Array<{ id: string; name: string }>; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [start, setStart] = useState<Start>('manual')
  const [dc, setDc] = useState(''), [ac, setAc] = useState(''), [from, setFrom] = useState(cases[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true); setErrors({}); setError(null)
    const r = await createSolarCaseAction({ projectId, name, start: start === 'copy' ? { kind: 'copy', fromCaseId: from } : { kind: 'manual', dcKwp: Number(dc), acKw: Number(ac) } })
    setBusy(false)
    if ('ok' in r) { onClose(); router.push(`/projects/${projectId}/solar/yield?case=${r.caseId}`) }
    else if ('fieldErrors' in r) setErrors(r.fieldErrors)
    else setError(r.error)
  }
  return (
    <div role="dialog" aria-label="New case" style={{ border: '1px solid var(--c-border, #e5e7eb)', borderRadius: 8, padding: 16, display: 'grid', gap: 10 }}>
      <label>Name <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} /></label>
      {errors.name && <span role="alert">{errors.name}</span>}
      <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: 6 }}>
        <legend>Start from</legend>
        <label><input type="radio" aria-label="Manual size" checked={start === 'manual'} onChange={() => setStart('manual')} /> Manual size</label>
        {start === 'manual' && (
          <div style={{ display: 'flex', gap: 12 }}>
            <label>DC size (kWp) <input aria-label="DC size (kWp)" inputMode="decimal" value={dc} onChange={(e) => setDc(e.target.value)} /></label>
            <label>AC size (kW) <input aria-label="AC size (kW)" inputMode="decimal" value={ac} onChange={(e) => setAc(e.target.value)} /></label>
          </div>
        )}
        {errors.dcKwp && <span role="alert">{errors.dcKwp}</span>}
        {errors.acKw && <span role="alert">{errors.acKw}</span>}
        <label><input type="radio" aria-label="Copy of case" disabled={cases.length === 0} checked={start === 'copy'} onChange={() => setStart('copy')} /> Copy of case</label>
        {start === 'copy' && (
          <select aria-label="Case to copy" value={from} onChange={(e) => setFrom(e.target.value)}>
            {cases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <label><input type="radio" aria-label="From layout" disabled /> From layout <span style={{ color: 'var(--c-text-dim)' }}>Arrives with the Layout tab</span></label>
      </fieldset>
      {error && <span role="alert">{error}</span>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="button" disabled={busy} onClick={submit}>{busy ? 'Creating…' : 'Create case'}</Button>
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  )
}
```

`yield/CaseList.tsx`:
```tsx
'use client'
/** Case list (functional spec §7.1). Controls above the caller's level are hidden, not disabled. */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { SolarAccessLevel } from '@esite/shared'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { deleteSolarCaseAction, duplicateSolarCaseAction, renameSolarCaseAction, setSelectedSolarCaseAction } from '@/actions/solar-cases.actions'
import type { CaseCardView } from '@/lib/solar/cases/page-data'
import { useArmedConfirm } from '../../_components/useArmedConfirm'
import { mwh, num, rand } from '@/components/solar/format'
import { NewCaseDialog } from './NewCaseDialog'

const STATUS_VARIANT = { not_run: 'ghost', running: 'info', done: 'success', failed: 'danger', stale: 'warning' } as const

function Card({ c, projectId, canWrite, studyUpdatedAt, ticked, onTick, open }: { c: CaseCardView; projectId: string; canWrite: boolean; studyUpdatedAt: string | null; ticked: boolean; onTick: () => void; open: boolean }) {
  const router = useRouter()
  const del = useArmedConfirm()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(c.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = async (fn: () => Promise<{ error?: string; fieldErrors?: Record<string, string> } | object>) => {
    setBusy(true); setError(null)
    const r = (await fn()) as { error?: string; fieldErrors?: Record<string, string> }
    setBusy(false)
    if (r.error) setError(r.error)
    else if (r.fieldErrors) setError(Object.values(r.fieldErrors)[0] ?? null)
    else { setRenaming(false); router.refresh() }
  }
  return (
    <li style={{ border: `1px solid ${open ? 'var(--c-amber)' : 'var(--c-border, #e5e7eb)'}`, borderRadius: 8, padding: 12, display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" aria-label={`Compare ${c.name}`} checked={ticked} onChange={onTick} />
        {renaming
          ? <input aria-label="New name" value={name} onChange={(e) => setName(e.target.value)} />
          : <Link href={`/projects/${projectId}/solar/yield?case=${c.id}`} style={{ fontWeight: 600 }}>{c.name}</Link>}
        <Badge variant={STATUS_VARIANT[c.status]}>{c.statusLabel}</Badge>
        {c.selected && <Badge variant="info">Selected</Badge>}
      </div>
      <span>{num(c.dcKwp)} kWp · {num(c.acKw)} kW AC</span>
      {c.batteryKwh !== null && <span>Battery {num(c.batteryKwh)} kWh</span>}
      {c.annualPvKwh !== null && <span>{mwh(c.annualPvKwh).replace(' MWh', ' MWh/yr')}</span>}
      {c.year1SavingZar !== null && <span>Year-1 saving {rand(c.year1SavingZar)}</span>}
      {c.lastRunAt && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Last run {new Date(c.lastRunAt).toLocaleString('en-ZA')}</span>}
      {canWrite && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => act(() => duplicateSolarCaseAction({ projectId, caseId: c.id }))}>Duplicate</Button>
          {renaming
            ? <Button type="button" size="sm" disabled={busy} onClick={() => act(() => renameSolarCaseAction({ projectId, caseId: c.id, name, expectedUpdatedAt: c.updatedAt }))}>Save name</Button>
            : <Button type="button" size="sm" variant="secondary" onClick={() => setRenaming(true)}>Rename</Button>}
          <Button type="button" size="sm" variant="secondary" disabled={busy || c.selected || !c.canSelect || !studyUpdatedAt}
            title={c.canSelect ? undefined : 'Run this case first'}
            onClick={() => act(() => setSelectedSolarCaseAction({ projectId, caseId: c.id, expectedUpdatedAt: studyUpdatedAt! }))}>Set as selected</Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy}
            onClick={() => (del.armed ? (del.disarm(), act(() => deleteSolarCaseAction({ projectId, caseId: c.id }))) : del.arm())}>
            {del.armed ? `Delete “${c.name}”?` : 'Delete'}
          </Button>
        </div>
      )}
      {error && <span role="alert" style={{ color: 'var(--c-red, #dc2626)' }}>{error}</span>}
    </li>
  )
}

export function CaseList({ projectId, level, cases, studyUpdatedAt, openCaseId }: { projectId: string; level: SolarAccessLevel; cases: CaseCardView[]; studyUpdatedAt: string | null; openCaseId: string | null }) {
  const router = useRouter()
  const canWrite = level !== 'view'
  const [ticked, setTicked] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  return (
    <section aria-label="Cases" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {canWrite && <Button type="button" onClick={() => setAdding(true)}>New case</Button>}
        <Button type="button" variant="secondary" disabled={ticked.length < 2 || ticked.length > 4}
          title="Tick 2 to 4 cases" onClick={() => router.push(`/projects/${projectId}/solar/yield?compare=${ticked.join(',')}`)}>Compare</Button>
      </div>
      {adding && <NewCaseDialog projectId={projectId} cases={cases.map((c) => ({ id: c.id, name: c.name }))} onClose={() => setAdding(false)} />}
      {cases.length === 0
        ? <EmptyState dense title="No cases yet" description="A case is one design option: a system size, losses, battery and export settings." action={canWrite ? <Button type="button" onClick={() => setAdding(true)}>New case</Button> : undefined} />
        : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {cases.map((c) => (
              <Card key={c.id} c={c} projectId={projectId} canWrite={canWrite} studyUpdatedAt={studyUpdatedAt} open={c.id === openCaseId}
                ticked={ticked.includes(c.id)} onTick={() => setTicked((t) => (t.includes(c.id) ? t.filter((x) => x !== c.id) : [...t, c.id]))} />
            ))}
          </ul>
        )}
    </section>
  )
}
```
Check `EmptyState` accepts `description` (`EmptyStateProps` at `components/ui/EmptyState.tsx:12`); if it does not, drop that prop. Check `Badge` variants include `ghost | info | warning | success | danger` (they do, per CLAUDE.md conventions).

`yield/page.tsx`:
```tsx
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadYieldPageData } from '@/lib/solar/cases/page-data'
import { EmptyState } from '@/components/ui/EmptyState'
import { StaleBanner } from '../../_components/StaleBanner'
import { CaseList } from './CaseList'
import { CaseEditor } from './CaseEditor'
import { RunResults } from './RunResults'
import { CompareView } from './CompareView'

export const dynamic = 'force-dynamic'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Yield & Scenarios (functional spec §7). Every figure below comes from a stored run. */
export default async function SolarYieldPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ case?: string; compare?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const data = await loadYieldPageData(supabase, createServiceClient() as unknown as AnyClient, id, level, { caseId: sp.case, compare: sp.compare })
  if (!data.hasStudy) return <EmptyState title="Save Site & Supply first" description="Cases need the site’s coordinates and supply." />
  const selected = data.cases.find((c) => c.selected)
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {selected?.status === 'stale' && <StaleBanner projectId={id} caseId={selected.id} caseName={selected.name} canRun={level !== 'view'} />}
      <CaseList projectId={id} level={level} cases={data.cases} studyUpdatedAt={data.studyUpdatedAt} openCaseId={data.editor?.caseId ?? null} />
      {data.compare && <CompareView columns={data.compare} showMoney={level === 'edit_financials'} />}
      {data.editor && (
        <>
          <CaseEditor projectId={id} level={level} data={data.editor} equipment={data.equipment} />
          {data.editor.lastRun
            ? <RunResults projectId={id} caseId={data.editor.caseId} run={data.editor.lastRun} />
            : <EmptyState dense title="This case has not been run yet" description={level === 'view' ? 'Ask an editor to run it.' : 'Save it, then press Run.'} />}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Run the three component tests — PASS** (the page itself is exercised by `next build` in Task 36 and by the loader tests). Commit ("feat(solar): Yield page, case list, new-case dialog, stale banner").

---

### Task 26: Case editor (every §7.2 section; Save / Run / Cancel / Discard)

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/yield/CaseEditor.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/yield/editor-fields.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/yield/CaseEditor.test.tsx`

- [ ] **Step 1: Failing test:**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { defaultCaseConfig } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'
import type { CaseEditorData } from '@/lib/solar/cases/page-data'

const h = vi.hoisted(() => ({ save: vi.fn(), weather: vi.fn(), run: vi.fn(), cancel: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/actions/solar-cases.actions', () => ({ saveSolarCaseAction: h.save, fetchSolarWeatherAction: h.weather }))
vi.mock('../../_components/runCase', () => ({ postRun: h.run, postCancel: h.cancel }))
import { CaseEditor } from './CaseEditor'

const cfg = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 500, acKw: 400 })
const data = (over: Partial<CaseEditorData> = {}): CaseEditorData => ({
  caseId: 'c1', name: 'Base', updatedAt: 'T1', config: cfg, buildReasons: [], status: 'done', statusLabel: 'Done', running: false,
  weather: { id: 'w1', latRound: -26.2, lngRound: 28.05, fetchedAt: '2026-09-28T10:00:00Z', radiationDb: 'PVGIS-SARAH2', gsaPvoutKwhPerKwp: 1712 },
  studyExport: { mode: 'net_billing', limitKw: 100 },
  siteLoad: { basis: 'S1', referenceYear: 2025, annualKwh: 876_000, peakKw: 180 },
  tariffNote: null, defaultLosses: { racked: cfg.losses, flush: { ...cfg.losses, shadingPct: 1 } }, lastRun: null, ...over,
})
const equipment = { modules: [{ id: '11111111-1111-4111-8111-111111111111', make: 'Generic', model: 'M', retired: false, specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35 } }], inverters: [], batteries: [] }
beforeEach(() => vi.clearAllMocks())

describe('CaseEditor', () => {
  it('renders every §7.2 section; From layout disabled; DC/AC shown as derived', () => {
    render(<CaseEditor projectId="p1" level="edit" data={data()} equipment={equipment} />)
    for (const s of ['PV system', 'Losses', 'Degradation', 'Weather', 'Battery', 'Grid / export', 'Load', 'Load-shedding value']) expect(screen.getByRole('group', { name: s })).toBeTruthy()
    expect((screen.getByLabelText('From layout') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('DC/AC ratio 1.25 (derived)')).toBeTruthy()
    expect(screen.getByText('Inherited: net billing, export limit 100 kW')).toBeTruthy()
    expect(screen.getByText('S1 load, reference year 2025: 876.0 MWh/yr, peak 180.0 kW')).toBeTruthy()
    expect(screen.getByText(/GSA 1 712 kWh\/kWp/)).toBeTruthy()
  })

  it('View users get a read-only form and no buttons', () => {
    render(<CaseEditor projectId="p1" level="view" data={data()} equipment={equipment} />)
    expect((screen.getByLabelText('DC size (kWp)') as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save case' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
  })

  it('editing enables Save and disables Run ("Save first"); Save sends the config with expectedUpdatedAt', async () => {
    h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' })
    render(<CaseEditor projectId="p1" level="edit" data={data()} equipment={equipment} />)
    fireEvent.change(screen.getByLabelText('Soiling (%)'), { target: { value: '3' } })
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Save first — Run uses the saved inputs')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save case' }))
    await waitFor(() => expect(h.save).toHaveBeenCalled())
    const arg = h.save.mock.calls[0]![0]
    expect(arg).toMatchObject({ projectId: 'p1', caseId: 'c1', expectedUpdatedAt: 'T1' })
    expect(arg.config.losses.soilingPct).toBe(3)
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
  })

  it('blocking reasons are listed and disable Run', () => {
    render(<CaseEditor projectId="p1" level="edit" data={data({ buildReasons: ['Build the site load on the Load tab first.'] })} equipment={equipment} />)
    expect(screen.getByText('Build the site load on the Load tab first.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Run posts, shows Running with a Cancel, and refreshes when done', async () => {
    let finish: (v: unknown) => void = () => {}
    h.run.mockReturnValue(new Promise((r) => { finish = r }))
    h.cancel.mockResolvedValue({ ok: true })
    render(<CaseEditor projectId="p1" level="edit" data={data()} equipment={equipment} />)
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel run' }))
    expect(h.cancel).toHaveBeenCalledWith('p1', 'c1')
    finish({ ok: false, error: 'The run was cancelled.' })
    await screen.findByText('The run was cancelled.')
    expect(h.refresh).toHaveBeenCalled()
  })

  it('Fetch weather sets the dataset (dirty) and shows the fetch date', async () => {
    h.weather.mockResolvedValue({ ok: true, dataset: { id: '33333333-3333-4333-8333-333333333333', fetchedAt: '2026-09-29T08:00:00Z', radiationDb: 'PVGIS-SARAH3', latRound: -26.2, lngRound: 28.05, gsaPvoutKwhPerKwp: null, cached: false } })
    render(<CaseEditor projectId="p1" level="edit" data={data({ weather: null })} equipment={equipment} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fetch PVGIS weather' }))
    await screen.findByText(/PVGIS-SARAH3/)
    expect((screen.getByRole('button', { name: 'Save case' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('Grid charging is only offered for TOU arbitrage; Discard asks twice and restores', () => {
    render(<CaseEditor projectId="p1" level="edit" data={data()} equipment={equipment} />)
    const battery = screen.getByRole('group', { name: 'Battery' })
    fireEvent.click(within(battery).getByLabelText('Battery enabled'))
    expect((within(battery).getByLabelText('Allow grid charging') as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(within(battery).getByLabelText('Strategy'), { target: { value: 'tou-arbitrage' } })
    expect((within(battery).getByLabelText('Allow grid charging') as HTMLInputElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard all changes?' }))
    expect((within(screen.getByRole('group', { name: 'Battery' })).getByLabelText('Battery enabled') as HTMLInputElement).checked).toBe(false)
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement.**

`editor-fields.tsx`:
```tsx
'use client'
/** Small labelled inputs for the case editor. Numbers are parsed on change; the server validates. */
import type { ReactNode } from 'react'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset aria-label={title} style={{ border: '1px solid var(--c-border, #e5e7eb)', borderRadius: 8, padding: 12, display: 'grid', gap: 8 }}>
      <legend style={{ fontWeight: 600 }}>{title}</legend>
      {children}
    </fieldset>
  )
}

export function NumField({ label, unit, value, onChange, disabled, error, step = 'any' }: { label: string; unit: string; value: number | null; onChange: (v: number | null) => void; disabled?: boolean; error?: string; step?: string }) {
  const id = `f-${label.replace(/\W+/g, '-')}`
  return (
    <label htmlFor={id} style={{ display: 'grid', gap: 2 }}>
      <span style={{ fontSize: 12 }}>{label}</span>
      <input id={id} aria-label={`${label}${unit ? ` (${unit})` : ''}`} type="number" step={step} disabled={disabled}
        value={value === null || Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
      {error && <span role="alert" style={{ color: 'var(--c-red, #dc2626)', fontSize: 12 }}>{error}</span>}
    </label>
  )
}

export function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <label><input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
}
```

`CaseEditor.tsx`:
```tsx
'use client'
/**
 * Case editor (functional spec §7.2). Holds the draft config; Save sends it (server validates and
 * re-derives catalogue snapshots); Run runs the SAVED inputs, so it is disabled while the draft is dirty.
 * Nothing here computes a result — the DC/AC ratio shown is a ratio of two INPUTS (spec: "derived, not an input").
 */
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SolarAccessLevel } from '@esite/shared'
import type { CaseConfig } from '@esite/shared/solar-cases'
import { Button } from '@/components/ui/Button'
import { saveSolarCaseAction, fetchSolarWeatherAction } from '@/actions/solar-cases.actions'
import type { CaseEditorData, EquipmentOption } from '@/lib/solar/cases/page-data'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'
import { useArmedConfirm } from '../../_components/useArmedConfirm'
import { postCancel, postRun } from '../../_components/runCase'
import { mwh, num } from '@/components/solar/format'
import { Check, NumField, Section } from './editor-fields'

const EXPORT_MODE: Record<string, string> = { net_billing: 'net billing', no_credit: 'export without credit', zero_export: 'zero export' }

export function CaseEditor({ projectId, level, data, equipment }: { projectId: string; level: SolarAccessLevel; data: CaseEditorData; equipment: { modules: EquipmentOption[]; inverters: EquipmentOption[]; batteries: EquipmentOption[] } }) {
  const router = useRouter()
  const ro = level === 'view'
  const [cfg, setCfg] = useState<CaseConfig>(data.config)
  const [saved, setSaved] = useState<CaseConfig>(data.config)
  const [weather, setWeather] = useState(data.weather)
  const [updatedAt, setUpdatedAt] = useState(data.updatedAt)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<'save' | 'run' | 'weather' | null>(null)
  const discard = useArmedConfirm()
  const dirty = useMemo(() => JSON.stringify(cfg) !== JSON.stringify(saved), [cfg, saved])
  useSolarDirtyGuard(dirty)

  const set = <K extends keyof CaseConfig>(k: K, patch: Partial<CaseConfig[K]>) => setCfg((c) => ({ ...c, [k]: { ...(c[k] as object), ...patch } }))
  const n = (v: number | null) => (v === null ? Number.NaN : v)

  const save = async () => {
    setBusy('save'); setErrors({}); setMessage(null)
    const r = await saveSolarCaseAction({ projectId, caseId: data.caseId, config: cfg, expectedUpdatedAt: updatedAt })
    setBusy(null)
    if ('ok' in r) { setSaved(cfg); setUpdatedAt(r.updatedAt); setMessage('Saved.'); router.refresh() }
    else if ('fieldErrors' in r) setErrors(r.fieldErrors)
    else setMessage(r.error)
  }
  const run = async () => {
    setBusy('run'); setMessage(null)
    const r = await postRun(projectId, data.caseId)
    setBusy(null)
    if (!r.ok) setMessage(r.error)
    router.refresh()
  }
  const fetchWeather = async () => {
    setBusy('weather'); setMessage(null)
    const r = await fetchSolarWeatherAction({ projectId })
    setBusy(null)
    if ('ok' in r) {
      setWeather({ id: r.dataset.id, latRound: r.dataset.latRound, lngRound: r.dataset.lngRound, fetchedAt: r.dataset.fetchedAt, radiationDb: r.dataset.radiationDb, gsaPvoutKwhPerKwp: r.dataset.gsaPvoutKwhPerKwp })
      set('weather', { datasetId: r.dataset.id })
    } else setMessage(r.error)
  }

  const b = cfg.battery, l = cfg.losses, g = cfg.grid
  const moduleOpts = equipment.modules.filter((m) => !m.retired || m.id === cfg.pv.module?.equipmentId)
  const pickModule = (id: string) => {
    const m = equipment.modules.find((x) => x.id === id)
    set('pv', { module: m ? { equipmentId: m.id, make: m.make, model: m.model, pmaxW: Number(m.specs.pmaxW), gammaPmaxPctPerC: Number(m.specs.gammaPmaxPctPerC) } : null })
  }
  const pickInverter = (id: string) => {
    const m = equipment.inverters.find((x) => x.id === id)
    set('pv', { inverter: m ? { equipmentId: m.id, make: m.make, model: m.model, acKw: Number(m.specs.acKw), euroEfficiencyPct: Number(m.specs.euroEfficiencyPct) } : null })
  }
  const pickBattery = (id: string) => {
    const m = equipment.batteries.find((x) => x.id === id)
    set('battery', m ? { unit: { equipmentId: m.id, make: m.make, model: m.model, usableKwh: Number(m.specs.usableKwh), powerKw: Number(m.specs.powerKw), rtePct: Number(m.specs.rtePct) }, usableKwh: Number(m.specs.usableKwh), maxChargeKw: Number(m.specs.powerKw), maxDischargeKw: Number(m.specs.powerKw), rtePct: Number(m.specs.rtePct) } : { unit: null })
  }
  const ratio = cfg.pv.acKw > 0 ? cfg.pv.dcKwp / cfg.pv.acKw : null
  const blocked = data.buildReasons.length > 0

  return (
    <form onSubmit={(e) => e.preventDefault()} style={{ display: 'grid', gap: 12 }} aria-label={`Case ${data.name}`}>
      <Section title="PV system">
        <div style={{ display: 'flex', gap: 12 }}>
          <label><input type="radio" aria-label="Manual" checked readOnly disabled={ro} /> Manual</label>
          <label><input type="radio" aria-label="From layout" disabled /> From layout <span style={{ color: 'var(--c-text-dim)' }}>(arrives with the Layout tab)</span></label>
        </div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          <NumField label="DC size" unit="kWp" value={cfg.pv.dcKwp} disabled={ro} error={errors['pv.dcKwp']} onChange={(v) => set('pv', { dcKwp: n(v) })} />
          <NumField label="AC size" unit="kW" value={cfg.pv.acKw} disabled={ro} error={errors['pv.acKw']} onChange={(v) => set('pv', { acKw: n(v) })} />
          <NumField label="Tilt" unit="°" value={cfg.pv.tiltDeg} disabled={ro} error={errors['pv.tiltDeg']} onChange={(v) => set('pv', { tiltDeg: n(v) })} />
          <NumField label="Azimuth (0 = north)" unit="°" value={cfg.pv.azimuthDeg} disabled={ro} error={errors['pv.azimuthDeg']} onChange={(v) => set('pv', { azimuthDeg: n(v) })} />
          <label>Mounting <select aria-label="Mounting" disabled={ro} value={cfg.pv.mounting} onChange={(e) => set('pv', { mounting: e.target.value as 'racked' | 'flush' })}><option value="racked">Racked</option><option value="flush">Flush</option></select></label>
          <label>Module type <select aria-label="Module type" disabled={ro} value={cfg.pv.module?.equipmentId ?? ''} onChange={(e) => pickModule(e.target.value)}>
            <option value="">Choose…</option>
            {moduleOpts.map((m) => <option key={m.id} value={m.id}>{m.make} {m.model}{m.retired ? ' (retired)' : ''}</option>)}
            {cfg.pv.module && !moduleOpts.some((m) => m.id === cfg.pv.module!.equipmentId) && <option value={cfg.pv.module.equipmentId}>{cfg.pv.module.make} {cfg.pv.module.model}</option>}
          </select></label>
          <label>Inverter <select aria-label="Inverter" disabled={ro} value={cfg.pv.inverter?.equipmentId ?? ''} onChange={(e) => pickInverter(e.target.value)}>
            <option value="">Generic (97.5 % Euro efficiency)</option>
            {equipment.inverters.filter((m) => !m.retired || m.id === cfg.pv.inverter?.equipmentId).map((m) => <option key={m.id} value={m.id}>{m.make} {m.model}</option>)}
          </select></label>
        </div>
        {errors['pv.module'] && <span role="alert">{errors['pv.module']}</span>}
        {ratio !== null && <span>DC/AC ratio {ratio.toFixed(2)} (derived)</span>}
      </Section>

      <Section title="Losses">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label>Mode <select aria-label="Loss mode" disabled={ro} value={l.mode} onChange={(e) => set('losses', { mode: e.target.value as 'standard' | 'detailed' })}><option value="standard">Standard</option><option value="detailed">Detailed</option></select></label>
          {!ro && <Button type="button" size="sm" variant="secondary" onClick={() => set('losses', { ...data.defaultLosses[cfg.pv.mounting], mode: l.mode })}>Reset to defaults</Button>}
        </div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
          <NumField label="Soiling" unit="%" value={l.soilingPct} disabled={ro} onChange={(v) => set('losses', { soilingPct: n(v) })} />
          <NumField label="Near shading" unit="%" value={l.shadingPct} disabled={ro} onChange={(v) => set('losses', { shadingPct: n(v) })} />
          <NumField label="Mismatch" unit="%" value={l.mismatchPct} disabled={ro} onChange={(v) => set('losses', { mismatchPct: n(v) })} />
          <NumField label="DC wiring" unit="%" value={l.dcWiringPct} disabled={ro} onChange={(v) => set('losses', { dcWiringPct: n(v) })} />
          <NumField label="AC wiring" unit="%" value={l.acWiringPct} disabled={ro} onChange={(v) => set('losses', { acWiringPct: n(v) })} />
          <NumField label="LID / LeTID" unit="%" value={l.lidPct} disabled={ro} onChange={(v) => set('losses', { lidPct: n(v) })} />
          <NumField label="Availability" unit="%" value={l.availabilityPct} disabled={ro} onChange={(v) => set('losses', { availabilityPct: n(v) })} />
          {l.mode === 'detailed' && <>
            <NumField label="Nameplate" unit="%" value={l.nameplatePct} disabled={ro} onChange={(v) => set('losses', { nameplatePct: n(v) })} />
            <NumField label="Albedo" unit="" value={l.albedo} disabled={ro} onChange={(v) => set('losses', { albedo: n(v) })} />
            <NumField label="IAM b0" unit="" value={l.iamB0} disabled={ro} onChange={(v) => set('losses', { iamB0: n(v) })} />
            <label>Transposition <select aria-label="Transposition" disabled={ro} value={l.transposition} onChange={(e) => set('losses', { transposition: e.target.value as 'perez' | 'hay-davies' })}><option value="perez">Perez</option><option value="hay-davies">Hay–Davies</option></select></label>
            <label>Cell temperature <select aria-label="Cell temperature model" disabled={ro} value={l.cellTemp.kind} onChange={(e) => set('losses', { cellTemp: e.target.value === 'noct' ? { kind: 'noct', noctC: 45 } : { kind: 'faiman', u0: 25, u1: 6.84 } })}><option value="faiman">Faiman</option><option value="noct">NOCT</option></select></label>
          </>}
        </div>
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Inverter efficiency from the inverter’s Euro efficiency; temperature from the cell-temperature model.</span>
      </Section>

      <Section title="Degradation">
        <div style={{ display: 'flex', gap: 12 }}>
          <NumField label="Year-1" unit="%" value={cfg.degradation.firstYearPct} disabled={ro} onChange={(v) => set('degradation', { firstYearPct: n(v) })} />
          <NumField label="Annual" unit="%/yr" value={cfg.degradation.annualPct} disabled={ro} onChange={(v) => set('degradation', { annualPct: n(v) })} />
        </div>
      </Section>

      <Section title="Weather">
        <div style={{ display: 'flex', gap: 12 }}>
          <label><input type="radio" aria-label="PVGIS TMY" checked readOnly disabled={ro} /> PVGIS TMY</label>
          <label><input type="radio" aria-label="Upload measured weather" disabled /> Upload measured weather <span style={{ color: 'var(--c-text-dim)' }}>(coming later)</span></label>
        </div>
        {weather
          ? <span>PVGIS TMY at {weather.latRound.toFixed(2)}, {weather.lngRound.toFixed(2)}{weather.radiationDb ? ` (${weather.radiationDb})` : ''}, fetched {new Date(weather.fetchedAt).toLocaleDateString('en-ZA')}{weather.gsaPvoutKwhPerKwp !== null ? ` · GSA ${num(weather.gsaPvoutKwhPerKwp, 0)} kWh/kWp (sanity check after a run)` : ''}</span>
          : <span>No weather yet.</span>}
        {!ro && <Button type="button" size="sm" variant="secondary" disabled={busy !== null} onClick={fetchWeather}>{busy === 'weather' ? 'Fetching…' : 'Fetch PVGIS weather'}</Button>}
      </Section>

      <Section title="Battery">
        <Check label="Battery enabled" checked={b.enabled} disabled={ro} onChange={(v) => set('battery', { enabled: v })} />
        {b.enabled && <>
          <label>Battery unit <select aria-label="Battery unit" disabled={ro} value={b.unit?.equipmentId ?? ''} onChange={(e) => pickBattery(e.target.value)}>
            <option value="">Custom</option>
            {equipment.batteries.filter((m) => !m.retired || m.id === b.unit?.equipmentId).map((m) => <option key={m.id} value={m.id}>{m.make} {m.model}</option>)}
          </select></label>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            <NumField label="Usable capacity" unit="kWh" value={b.usableKwh} disabled={ro} onChange={(v) => set('battery', { usableKwh: n(v) })} />
            <NumField label="Max charge" unit="kW" value={b.maxChargeKw} disabled={ro} onChange={(v) => set('battery', { maxChargeKw: n(v) })} />
            <NumField label="Max discharge" unit="kW" value={b.maxDischargeKw} disabled={ro} onChange={(v) => set('battery', { maxDischargeKw: n(v) })} />
            <NumField label="Round-trip efficiency" unit="%" value={b.rtePct} disabled={ro} onChange={(v) => set('battery', { rtePct: n(v) })} />
            <NumField label="SoC min" unit="%" value={b.socMinPct} disabled={ro} error={errors['battery.socMinPct']} onChange={(v) => set('battery', { socMinPct: n(v) })} />
            <NumField label="SoC max" unit="%" value={b.socMaxPct} disabled={ro} error={errors['battery.socMaxPct']} onChange={(v) => set('battery', { socMaxPct: n(v) })} />
            <NumField label="Initial SoC" unit="%" value={b.initialSocPct} disabled={ro} error={errors['battery.initialSocPct']} onChange={(v) => set('battery', { initialSocPct: n(v) })} />
            <NumField label="Backup reserve" unit="%" value={b.backupReservePct} disabled={ro} onChange={(v) => set('battery', { backupReservePct: n(v) })} />
          </div>
          <label>Strategy <select aria-label="Strategy" disabled={ro} value={b.strategy} onChange={(e) => {
            const s = e.target.value as CaseConfig['battery']['strategy']
            set('battery', { strategy: s, gridCharging: s === 'tou-arbitrage' ? b.gridCharging : false })
          }}><option value="self-consumption">Self-consumption</option><option value="tou-arbitrage">TOU arbitrage</option><option value="peak-shaving">Peak shaving</option></select></label>
          {b.strategy === 'peak-shaving' && <NumField label="Peak-shaving target" unit="kW" value={b.peakTargetKw} disabled={ro} error={errors['battery.peakTargetKw']} onChange={(v) => set('battery', { peakTargetKw: v })} />}
          <Check label="Allow grid charging" checked={b.gridCharging} disabled={ro || b.strategy !== 'tou-arbitrage'} onChange={(v) => set('battery', { gridCharging: v })} />
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Replacement year and cost are set on Financials.</span>
        </>}
      </Section>

      <Section title="Grid / export">
        <span>Inherited: {data.studyExport.mode ? EXPORT_MODE[data.studyExport.mode] : 'not set'}{data.studyExport.limitKw !== null ? `, export limit ${num(data.studyExport.limitKw, 0)} kW` : ''}</span>
        <Check label="Override for this case" checked={g.overrideExport} disabled={ro} onChange={(v) => set('grid', { overrideExport: v })} />
        {g.overrideExport && <div style={{ display: 'flex', gap: 12 }}>
          <Check label="Export allowed" checked={g.exportAllowed} disabled={ro} onChange={(v) => set('grid', { exportAllowed: v })} />
          <NumField label="Export limit" unit="kW" value={g.exportLimitKw} disabled={ro || !g.exportAllowed} onChange={(v) => set('grid', { exportLimitKw: v })} />
        </div>}
        <NumField label="Inverter AC cap" unit="kW" value={g.inverterAcCapKw} disabled={ro} onChange={(v) => set('grid', { inverterAcCapKw: v })} />
      </Section>

      <Section title="Load">
        <span>{data.siteLoad ? `${data.siteLoad.basis} load, reference year ${data.siteLoad.referenceYear}: ${mwh(data.siteLoad.annualKwh)}/yr, peak ${num(data.siteLoad.peakKw)} kW` : 'No site load yet — build it on the Load tab.'}</span>
        <NumField label="Load adjustment (what-if)" unit="%" value={cfg.load.adjustmentPct} disabled={ro} onChange={(v) => set('load', { adjustmentPct: n(v) })} />
      </Section>

      <Section title="Load-shedding value">
        <Check label="Value load-shedding avoided" checked={cfg.loadShedding.enabled} disabled={ro} onChange={(v) => set('loadShedding', { enabled: v })} />
        {cfg.loadShedding.enabled && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label>Stage <select aria-label="Load-shedding stage" disabled={ro} value={cfg.loadShedding.stage} onChange={(e) => set('loadShedding', { stage: Number(e.target.value) })}>{[1, 2, 3, 4, 5, 6, 7, 8].map((s) => <option key={s} value={s}>Stage {s}</option>)}</select></label>
          <NumField label="Hours a year avoided" unit="h" value={cfg.loadShedding.hoursPerYear} disabled={ro} onChange={(v) => set('loadShedding', { hoursPerYear: n(v) })} />
          <NumField label="Backed-up load" unit="kW" value={cfg.loadShedding.backedLoadKw} disabled={ro} onChange={(v) => set('loadShedding', { backedLoadKw: n(v) })} />
        </div>}
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Reported as a separate line, never in the IRR (D-14). The R/kWh value is set on Financials.</span>
      </Section>

      {data.tariffNote && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Tariff: {data.tariffNote} Energy results do not need it; the TOU split and TOU arbitrage do.</span>}
      {blocked && <ul aria-label="Before this case can run">{data.buildReasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      {message && <span role="alert">{message}</span>}

      {!ro && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button type="button" disabled={!dirty || busy !== null} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save case'}</Button>
          <Button type="button" disabled={dirty || blocked || busy !== null || data.running} onClick={run}>{busy === 'run' ? 'Running…' : 'Run'}</Button>
          {(busy === 'run' || data.running) && <Button type="button" variant="secondary" onClick={async () => { const r = await postCancel(projectId, data.caseId); if (!r.ok) setMessage(r.error) }}>Cancel run</Button>}
          <Button type="button" variant="secondary" disabled={!dirty} onClick={() => (discard.armed ? (discard.disarm(), setCfg(saved), setWeather(data.weather), setErrors({})) : discard.arm())}>
            {discard.armed ? 'Discard all changes?' : 'Discard changes'}
          </Button>
          {dirty && <span style={{ fontSize: 12 }}>Save first — Run uses the saved inputs</span>}
        </div>
      )}
    </form>
  )
}
```
The number inputs' accessible names are `"<label> (<unit>)"` (e.g. "Soiling (%)", "DC size (kWp)"), which the tests use. `useSolarDirtyGuard` is the existing hook from `lib/solar/dirty-store.ts` (browser `beforeunload` + in-app confirm, spec §0.3).

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): case editor with every §7.2 section, Save/Run/Cancel/Discard").

---

### Task 27: Stored results (KPI strip, energy flow, annual zoom, monthly table, waterfall, checks, provenance)

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/yield/RunResults.tsx`
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/yield/AnnualChart.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/yield/RunResults.test.tsx`

- [ ] **Step 1: Failing test:**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { RunView } from '@/lib/solar/cases/page-data'
import { RunResults } from './RunResults'

const zeros = () => new Array(24).fill(0)
const run: RunView = {
  id: 'r1', startedAt: '2026-09-28T09:00:00Z', finishedAt: '2026-09-28T09:00:05Z', runByName: 'Arno',
  outputs: {
    version: 1,
    kpis: { dcKwp: 500, acKw: 400, specificYieldKwhPerKwp: 1690, performanceRatio: 0.81, annualAcKwh: 845_000, pvAcKwh: 845_000, deliveredKwh: 840_000, selfConsumedKwh: 700_000, exportKwh: 140_000, curtailedKwh: 5_000, loadKwh: 1_200_000, importBeforeKwh: 1_200_000, importAfterKwh: 500_000, solarFraction: 0.58, selfConsumption: 0.83, peakDemandBeforeKw: 320, peakDemandAfterKw: 290, peakDemandBasis: 'hourly', batteryKwh: null, batteryKw: null },
    monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, pvKwh: 70_000, loadKwh: 100_000, importBeforeKwh: 100_000, importKwh: 42_000, exportKwh: 12_000, maxDemandBeforeKw: 320, maxDemandAfterKw: 290, touImportBefore: null, touImportAfter: null })),
    typicalDays: Array.from({ length: 12 }, (_, m) => (['all', 'weekday', 'saturday', 'sunday'] as const).map((d) => ({ month: m + 1, dayType: d, pv: zeros(), load: zeros(), import: zeros(), export: zeros(), batteryNet: zeros() }))).flat(),
    daily: Array.from({ length: 365 }, (_, d) => ({ day: d, pvKwh: 2300, loadKwh: 3300, importKwh: 1400, exportKwh: 380 })),
    waterfall: [{ key: 'reference', label: 'Nameplate × POA', kwh: 1_000_000, kind: 'start' }, { key: 'dc_losses', label: 'DC losses', kwh: 80_000, kind: 'loss' }, { key: 'ac_output', label: 'AC output', kwh: 845_000, kind: 'end' }],
    checks: [{ id: 'dc_ac_ratio', label: 'DC/AC ratio', status: 'pass', detail: 'DC/AC ratio 1.25 (expected 1.00 to 1.40).' }, { id: 'string_voltage', label: 'String voltage checks', status: 'n/a', detail: 'String checks need a layout — this case uses a manual system size.' }],
    provenance: { engineVersion: '0.1.0', inputsHash: 'f'.repeat(64), weatherDatasetId: 'w1', weatherSource: 'PVGIS TMY (PVGIS-SARAH2)', weatherFetchedAt: '2026-09-28T08:00:00Z', gsaPvoutKwhPerKwp: 1712, tariffRef: null, loadBasis: 'S1', loadReferenceYear: 2025 },
  },
}
beforeEach(() => { vi.restoreAllMocks() })

describe('RunResults (every figure from the stored run)', () => {
  it('KPI strip', () => {
    render(<RunResults projectId="p1" caseId="c1" run={run} />)
    for (const t of ['1 690 kWh/kWp', '81.0 %', '845.0 MWh', '700.0 MWh', '140.0 MWh', '5.0 MWh', '1 200.0 MWh → 500.0 MWh', '58.0 %', '83.0 %', '320.0 kW → 290.0 kW (hourly)']) expect(screen.getByText(t)).toBeTruthy()
  })
  it('monthly table has 12 rows, TOU split says why it is empty, and a CSV link to the stored export', () => {
    render(<RunResults projectId="p1" caseId="c1" run={run} />)
    expect(screen.getAllByRole('row')).toHaveLength(13)
    expect(screen.getByText('TOU split needs a pinned tariff (Tariff tab).')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Download monthly CSV' }).getAttribute('href')).toBe('/api/projects/p1/solar/cases/c1/runs/r1/export?kind=monthly')
    expect(screen.getByRole('link', { name: 'Download 8760 CSV' }).getAttribute('href')).toBe('/api/projects/p1/solar/cases/c1/runs/r1/export?kind=hourly')
  })
  it('checks and provenance footer', () => {
    render(<RunResults projectId="p1" caseId="c1" run={run} />)
    expect(screen.getByText('String checks need a layout — this case uses a manual system size.')).toBeTruthy()
    const foot = screen.getByRole('contentinfo')
    for (const t of ['Engine 0.1.0', 'PVGIS TMY (PVGIS-SARAH2)', 'Inputs ffffffffffff', 'Run by Arno', 'No tariff pinned']) expect(foot.textContent).toContain(t)
  })
  it('energy-flow month and day-type selects switch the typical day', () => {
    render(<RunResults projectId="p1" caseId="c1" run={run} />)
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Day type'), { target: { value: 'sunday' } })
    expect(screen.getByRole('img', { name: 'Typical Sunday in July' })).toBeTruthy()
  })
  it('zooming the annual chart fetches the stored hourly slice', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ rows: [{ hour: 0, startSast: '2025-01-01T00:00+02:00', loadKw: 1, pvAcKw: 0, importKw: 1, exportKw: 0, socKwh: 0 }] })))
    render(<RunResults projectId="p1" caseId="c1" run={run} />)
    fireEvent.change(screen.getByLabelText('Zoom from day'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Zoom span'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show hourly' }))
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/projects/p1/solar/cases/c1/runs/r1/export?kind=slice&from=10&to=16'))
    await screen.findByRole('img', { name: 'Hourly, days 11 to 17' })
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement.**

`AnnualChart.tsx`:
```tsx
'use client'
/** Annual chart (spec §7.3): 365 stored daily totals, zoomable into the stored hourly series via the export route. */
import { useState } from 'react'
import type { DailyRow } from '@esite/shared/solar-cases'
import { Button } from '@/components/ui/Button'
import { LineChart } from '@/components/solar/charts/LineChart'

interface SliceRow { hour: number; startSast: string; loadKw: number; pvAcKw: number; importKw: number; exportKw: number; socKwh: number }

export function AnnualChart({ projectId, caseId, runId, daily }: { projectId: string; caseId: string; runId: string; daily: DailyRow[] }) {
  const [from, setFrom] = useState(0)
  const [span, setSpan] = useState(7)
  const [slice, setSlice] = useState<{ from: number; to: number; rows: SliceRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    const to = Math.min(364, from + span - 1)
    setError(null)
    const res = await fetch(`/api/projects/${projectId}/solar/cases/${caseId}/runs/${runId}/export?kind=slice&from=${from}&to=${to}`)
    const body = await res.json().catch(() => ({}))
    if (res.ok) setSlice({ from, to, rows: body.rows }); else setError(body.error ?? 'The hourly data could not be loaded.')
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <LineChart title="Daily energy through the year" unit="kWh/day" xLabels={daily.map((d) => String(d.day + 1))}
        series={[{ label: 'PV', values: daily.map((d) => d.pvKwh) }, { label: 'Load', values: daily.map((d) => d.loadKwh) }, { label: 'Import', values: daily.map((d) => d.importKwh) }, { label: 'Export', values: daily.map((d) => d.exportKwh) }]} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label>From day <input aria-label="Zoom from day" type="number" min={0} max={364} value={from} onChange={(e) => setFrom(Math.max(0, Math.min(364, Number(e.target.value))))} /></label>
        <label>Span <select aria-label="Zoom span" value={span} onChange={(e) => setSpan(Number(e.target.value))}><option value={1}>1 day</option><option value={7}>7 days</option><option value={31}>31 days</option></select></label>
        <Button type="button" size="sm" variant="secondary" onClick={load}>Show hourly</Button>
        <a href={`/api/projects/${projectId}/solar/cases/${caseId}/runs/${runId}/export?kind=hourly`}>Download 8760 CSV</a>
      </div>
      {error && <span role="alert">{error}</span>}
      {slice && <LineChart title={`Hourly, days ${slice.from + 1} to ${slice.to + 1}`} unit="kW" xLabels={slice.rows.map((r) => r.startSast.slice(5, 13).replace('T', ' '))}
        series={[{ label: 'PV AC', values: slice.rows.map((r) => r.pvAcKw) }, { label: 'Load', values: slice.rows.map((r) => r.loadKw) }, { label: 'Import', values: slice.rows.map((r) => r.importKw) }, { label: 'Export', values: slice.rows.map((r) => r.exportKw) }, { label: 'Battery SoC (kWh)', values: slice.rows.map((r) => r.socKwh) }]} />}
    </div>
  )
}
```

`RunResults.tsx`:
```tsx
'use client'
/** Results of the stored run (functional spec §7.3). Formatting only — every figure is read from `run.outputs`. */
import { useState } from 'react'
import type { DayType } from '@esite/shared/solar-cases'
import type { RunView } from '@/lib/solar/cases/page-data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { LineChart } from '@/components/solar/charts/LineChart'
import { WaterfallChart } from '@/components/solar/charts/WaterfallChart'
import { kw, mwh, num, pct } from '@/components/solar/format'
import { AnnualChart } from './AnnualChart'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_LABEL: Record<DayType, string> = { all: 'day', weekday: 'weekday', saturday: 'Saturday', sunday: 'Sunday' }
const CHECK_VARIANT = { pass: 'success', warn: 'warning', fail: 'danger', 'n/a': 'ghost' } as const

export function RunResults({ projectId, caseId, run }: { projectId: string; caseId: string; run: RunView }) {
  const o = run.outputs, k = o.kpis, p = o.provenance
  const [month, setMonth] = useState(1)
  const [dayType, setDayType] = useState<DayType>('all')
  const day = o.typicalDays.find((d) => d.month === month && d.dayType === dayType)
  const kpis: Array<[string, string]> = [
    ['Specific yield', `${num(k.specificYieldKwhPerKwp, 0)} kWh/kWp`],
    ['Performance ratio', pct(k.performanceRatio)],
    ['Annual PV (AC)', mwh(k.pvAcKwh)],
    ['Self-consumed', mwh(k.selfConsumedKwh)],
    ['Export', mwh(k.exportKwh)],
    ['Curtailed', mwh(k.curtailedKwh)],
    ['Grid import before → after', `${mwh(k.importBeforeKwh)} → ${mwh(k.importAfterKwh)}`],
    ['Solar fraction', pct(k.solarFraction)],
    ['Self-consumption', pct(k.selfConsumption)],
    ['Peak demand before → after', `${kw(k.peakDemandBeforeKw)} → ${kw(k.peakDemandAfterKw)} (${k.peakDemandBasis})`],
  ]
  const tou = o.monthly[0]?.touImportBefore !== null
  const base = `/api/projects/${projectId}/solar/cases/${caseId}/runs/${run.id}/export`
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card><CardHeader><span className="data-panel-title">Results</span></CardHeader><CardBody>
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, margin: 0 }}>
          {kpis.map(([label, value]) => <div key={label}><dt style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{label}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd></div>)}
        </dl>
      </CardBody></Card>

      <Card><CardHeader><span className="data-panel-title">Energy flow — typical day</span></CardHeader><CardBody>
        <div style={{ display: 'flex', gap: 8 }}>
          <label>Month <select aria-label="Month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
          <label>Day type <select aria-label="Day type" value={dayType} onChange={(e) => setDayType(e.target.value as DayType)}>
            <option value="all">All days</option><option value="weekday">Weekday</option><option value="saturday">Saturday</option><option value="sunday">Sunday</option></select></label>
        </div>
        {day && <LineChart title={`Typical ${DAY_LABEL[dayType]} in ${MONTHS[month - 1]}`} unit="kW" xLabels={Array.from({ length: 24 }, (_, h) => String(h))}
          series={[{ label: 'PV', values: day.pv }, { label: 'Load', values: day.load }, { label: 'Import', values: day.import }, { label: 'Export', values: day.export }, { label: 'Battery (+ discharge)', values: day.batteryNet }]} />}
        <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Public holidays are not separated from their weekday.</span>
      </CardBody></Card>

      <Card><CardHeader><span className="data-panel-title">Annual (8,760 hours)</span></CardHeader><CardBody>
        <AnnualChart projectId={projectId} caseId={caseId} runId={run.id} daily={o.daily} />
      </CardBody></Card>

      <Card><CardHeader><span className="data-panel-title">Monthly</span></CardHeader><CardBody>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Month</th><th>PV (MWh)</th><th>Load (MWh)</th><th>Import before (MWh)</th><th>Import after (MWh)</th><th>Export (MWh)</th><th>Max demand before (kW)</th><th>Max demand after (kW)</th>{tou && <><th>Import before P/S/O (MWh)</th><th>Import after P/S/O (MWh)</th></>}</tr></thead>
            <tbody>{o.monthly.map((m) => (
              <tr key={m.month}><td>{MONTHS[m.month - 1]!.slice(0, 3)}</td><td>{num(m.pvKwh / 1000)}</td><td>{num(m.loadKwh / 1000)}</td><td>{num(m.importBeforeKwh / 1000)}</td><td>{num(m.importKwh / 1000)}</td><td>{num(m.exportKwh / 1000)}</td><td>{num(m.maxDemandBeforeKw)}</td><td>{num(m.maxDemandAfterKw)}</td>
                {tou && <><td>{[m.touImportBefore!.peak, m.touImportBefore!.standard, m.touImportBefore!.offPeak].map((v) => num(v / 1000)).join(' / ')}</td><td>{[m.touImportAfter!.peak, m.touImportAfter!.standard, m.touImportAfter!.offPeak].map((v) => num(v / 1000)).join(' / ')}</td></>}
              </tr>))}</tbody>
          </table>
        </div>
        {!tou && <span style={{ fontSize: 12 }}>TOU split needs a pinned tariff (Tariff tab).</span>}
        <div><a href={`${base}?kind=monthly`}>Download monthly CSV</a></div>
      </CardBody></Card>

      <Card><CardHeader><span className="data-panel-title">Loss waterfall</span></CardHeader><CardBody>
        <WaterfallChart title="From irradiation to AC output" steps={o.waterfall} />
      </CardBody></Card>

      <Card><CardHeader><span className="data-panel-title">Checks</span></CardHeader><CardBody>
        <ul style={{ margin: 0, paddingLeft: 16 }}>{o.checks.map((c) => <li key={c.id}><Badge variant={CHECK_VARIANT[c.status]}>{c.status}</Badge> <strong>{c.label}</strong> — <span>{c.detail}</span></li>)}</ul>
      </CardBody></Card>

      <footer role="contentinfo" style={{ fontSize: 12, color: 'var(--c-text-dim)', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <span>Engine {p.engineVersion}</span>
        <span>{p.weatherSource}{p.weatherFetchedAt ? `, fetched ${new Date(p.weatherFetchedAt).toLocaleDateString('en-ZA')}` : ''}</span>
        <span>{p.tariffRef ? `Tariff ${p.tariffRef.licenseeName} ${p.tariffRef.tariffName} ${p.tariffRef.financialYear}` : 'No tariff pinned'}</span>
        <span>Load {p.loadBasis} {p.loadReferenceYear}</span>
        <span>Inputs {p.inputsHash.slice(0, 12)}</span>
        <span>Run by {run.runByName}</span>
        <span>Run at {new Date(run.finishedAt ?? run.startedAt).toLocaleString('en-ZA')}</span>
      </footer>
    </div>
  )
}
```
`DailyRow` and `DayType` are TYPE-only imports from `@esite/shared/solar-cases` (allowed by the Task 29 contract).

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): stored run results — KPIs, energy flow, annual zoom, monthly, waterfall, checks, provenance").

---

### Task 28: Compare view

**Files:**
- Create: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/yield/CompareView.tsx`
- Test: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/yield/CompareView.test.tsx`

- [ ] **Step 1: Failing test:**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CompareView } from './CompareView'
import type { CompareColumn } from '@/lib/solar/cases/page-data'

const col = (id: string, name: string, dc: number, money: CompareColumn['money']): CompareColumn => ({
  caseId: id, name, monthlyPvKwh: new Array(12).fill(1000), money,
  kpis: { dcKwp: dc, acKw: 400, specificYieldKwhPerKwp: 1690, performanceRatio: 0.8, annualAcKwh: 1, pvAcKwh: 845_000, deliveredKwh: 1, selfConsumedKwh: 1, exportKwh: 1, curtailedKwh: 0, loadKwh: 1, importBeforeKwh: 1, importAfterKwh: 1, solarFraction: 0.5, selfConsumption: 0.9, peakDemandBeforeKw: 1, peakDemandAfterKw: 1, peakDemandBasis: 'hourly', batteryKwh: null, batteryKw: null },
})

describe('CompareView', () => {
  it('one column per case; rand rows only for cost-view', () => {
    const cols = [col('a', 'Base', 500, { year1SavingZar: 400_000, irr: 0.2, npvZar: 2e6, simplePaybackYears: 5 }), col('b', 'Big', 800, null)]
    const { rerender } = render(<CompareView columns={cols} showMoney />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['KPI', 'Base', 'Big'])
    expect(screen.getByText('Year-1 saving')).toBeTruthy()
    expect(screen.getByText('R 400 000')).toBeTruthy()
    expect(screen.getAllByText('Run financials first')).toHaveLength(4)
    rerender(<CompareView columns={cols} showMoney={false} />)
    expect(screen.queryByText('Year-1 saving')).toBeNull()
    expect(screen.getByRole('img', { name: 'Monthly PV energy by case' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement:**

```tsx
'use client'
/** Compare 2–4 cases (functional spec §7.1): every KPI + a monthly energy chart; rand rows only for cost-view. */
import type { CompareColumn } from '@/lib/solar/cases/page-data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { BarChart } from '@/components/solar/charts/BarChart'
import { kw, mwh, num, pct, rand, years } from '@/components/solar/format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
type Row = [string, (c: CompareColumn) => string]
const ENERGY: Row[] = [
  ['PV size', (c) => `${num(c.kpis.dcKwp)} kWp / ${num(c.kpis.acKw)} kW`],
  ['Battery', (c) => (c.kpis.batteryKwh === null ? '—' : `${num(c.kpis.batteryKwh)} kWh / ${num(c.kpis.batteryKw ?? 0)} kW`)],
  ['Specific yield', (c) => `${num(c.kpis.specificYieldKwhPerKwp, 0)} kWh/kWp`],
  ['Performance ratio', (c) => pct(c.kpis.performanceRatio)],
  ['Annual PV (AC)', (c) => mwh(c.kpis.pvAcKwh)],
  ['Self-consumed', (c) => mwh(c.kpis.selfConsumedKwh)],
  ['Export', (c) => mwh(c.kpis.exportKwh)],
  ['Curtailed', (c) => mwh(c.kpis.curtailedKwh)],
  ['Grid import after', (c) => mwh(c.kpis.importAfterKwh)],
  ['Solar fraction', (c) => pct(c.kpis.solarFraction)],
  ['Self-consumption', (c) => pct(c.kpis.selfConsumption)],
  ['Peak demand after', (c) => kw(c.kpis.peakDemandAfterKw)],
]
const MONEY: Row[] = [
  ['Year-1 saving', (c) => (c.money ? rand(c.money.year1SavingZar) : 'Run financials first')],
  ['IRR', (c) => (c.money ? (c.money.irr === null ? 'n/a' : pct(c.money.irr)) : 'Run financials first')],
  ['NPV', (c) => (c.money ? rand(c.money.npvZar) : 'Run financials first')],
  ['Simple payback', (c) => (c.money ? years(c.money.simplePaybackYears) : 'Run financials first')],
]

export function CompareView({ columns, showMoney }: { columns: CompareColumn[]; showMoney: boolean }) {
  const rows = showMoney ? [...ENERGY, ...MONEY] : ENERGY
  return (
    <Card><CardHeader><span className="data-panel-title">Compare cases</span></CardHeader><CardBody>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th scope="col">KPI</th>{columns.map((c) => <th key={c.caseId} scope="col">{c.name}</th>)}</tr></thead>
          <tbody>{rows.map(([label, f]) => <tr key={label}><th scope="row">{label}</th>{columns.map((c) => <td key={c.caseId}>{f(c)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <BarChart title="Monthly PV energy by case" unit="MWh" seriesLabels={columns.map((c) => c.name)}
        groups={MONTHS.map((m, i) => ({ label: m, values: columns.map((c) => (c.monthlyPvKwh[i] ?? 0) / 1000) }))} />
    </CardBody></Card>
  )
}
```

- [ ] **Step 3: Run — PASS; commit** ("feat(solar): compare 2–4 cases").

---

### Task 29: Contract test — the browser never computes a displayed result

**Files:**
- Create: `apps/web/src/lib/solar/no-browser-engine.contract.test.ts`

- [ ] **Step 1: Write the test:**

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Functional spec §7.3 / dev plan P4 verification: "Every KPI on every tab traced to one case_runs row
 * (test asserts no client-side computation of displayed results)". A 'use client' file may import TYPES
 * from the engine or the case model, never runtime: no simulateCase / runFinancials / buildRunOutputs /
 * runStoredFinancials / buildFinanceInput / capexTotals / applyRateCard in the browser.
 */
const ROOT = resolve(__dirname, '../../')
const DIRS = ['app/(admin)/projects/[id]/solar', 'app/(admin)/settings/solar', 'components/solar']
const FORBIDDEN_MODULES = ['@esite/shared/solar-engine', '@esite/shared/solar-cases', '@esite/shared/tariffs/ingest']

function files(dir: string): string[] {
  let out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out = out.concat(files(p))
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p)
  }
  return out
}

export function runtimeImportsOf(src: string): string[] {
  const bad: string[] = []
  const re = /^\s*import\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const [, typeOnly, clause, mod] = m
    if (!FORBIDDEN_MODULES.includes(mod!)) continue
    if (typeOnly) continue
    const inner = clause!.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
    if (clause!.trim().startsWith('{') && inner.every((s) => s.startsWith('type '))) continue
    bad.push(`${mod}: ${clause!.trim()}`)
  }
  return bad
}

describe('no Solar result is computed in the browser', () => {
  const clientFiles = DIRS.flatMap((d) => files(join(ROOT, d))).filter((f) => /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')))

  it('finds the client components (the scan is not vacuous)', () => {
    expect(clientFiles.length).toBeGreaterThanOrEqual(10)
    expect(clientFiles.some((f) => f.endsWith('RunResults.tsx'))).toBe(true)
  })

  it.each(clientFiles.map((f) => [f.slice(ROOT.length + 1), f]))('%s imports only types from the engine/case model', (_n, f) => {
    expect(runtimeImportsOf(readFileSync(f, 'utf8'))).toEqual([])
  })

  it('the detector can fail (mutation guard)', () => {
    expect(runtimeImportsOf(`import { simulateCase } from '@esite/shared/solar-engine'`)).toHaveLength(1)
    expect(runtimeImportsOf(`import { type DayType, capexTotals } from '@esite/shared/solar-cases'`)).toHaveLength(1)
    expect(runtimeImportsOf(`import type { DayType } from '@esite/shared/solar-cases'`)).toHaveLength(0)
    expect(runtimeImportsOf(`import { type DayType } from '@esite/shared/solar-cases'`)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run — PASS** (if any client file fails, change its import to `import type` or move the computation server-side into `page-data.ts`). Then prove it can fail: temporarily change `RunResults.tsx`'s `import type { DayType }` to `import { DayType }`, run, see exactly that file fail, revert.

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-4b && pnpm --filter web test -- src/lib/solar/no-browser-engine.contract.test.ts 2>&1 | tail -5
```

- [ ] **Step 3: Commit** ("test(solar): contract — no client file computes a Solar result").
