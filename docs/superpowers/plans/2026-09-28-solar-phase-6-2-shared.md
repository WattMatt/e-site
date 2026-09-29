# Solar Phase 6 — Part 2: `@esite/shared/solar-reports` (pure logic)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-28-solar-phase-6-0-index.md` first.

Everything here is pure (no I/O). The PDF and the screen both format through `fmt.ts`, so a figure is the same byte string in both places — the property the §9.4 "portal = PDF" test (Task 14 / Task 27) relies on.

---

### Task 5: Subpath export, number formatting, offer price

**Files:**
- Modify: `packages/shared/package.json` (`exports`)
- Create: `packages/shared/src/solar/reports/index.ts`
- Create: `packages/shared/src/solar/reports/fmt.ts`, `fmt.test.ts`
- Create: `packages/shared/src/solar/reports/offer.ts`, `offer.test.ts`

- [ ] **Step 1: Add the export** in `packages/shared/package.json`, after the `"./solar-cases"` line (4b added it):

```json
    "./solar-reports": "./src/solar/reports/index.ts",
```

- [ ] **Step 2: Write the failing tests.**

`packages/shared/src/solar/reports/fmt.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { fixed, zar, zarCents, pct, mwh, kwp, kw, years, isoDate } from './fmt'

describe('fmt (locale-free, identical on server, browser and PDF)', () => {
  it('groups thousands with a plain space and never uses a locale', () => {
    expect(fixed(1234567.891, 2)).toBe('1 234 567.89')
    expect(fixed(999, 0)).toBe('999')
    expect(fixed(-0.001, 1)).toBe('0.0')
    expect(fixed(Number.NaN, 1)).toBe('n/a')
  })
  it('formats rand, percent, energy, power and years with units', () => {
    expect(zar(1_000_000)).toBe('R 1 000 000')
    expect(zar(-1500.4)).toBe('-R 1 500')
    expect(zarCents(1150000)).toBe('R 1 150 000.00')
    expect(pct(0.2105)).toBe('21.1 %')
    expect(pct(null)).toBe('n/a')
    expect(mwh(845_000)).toBe('845.0 MWh')
    expect(kwp(500)).toBe('500.0 kWp')
    expect(kw(400)).toBe('400.0 kW')
    expect(years(4.63)).toBe('4.6 years')
    expect(years(null)).toBe('n/a')
    expect(isoDate('2026-10-28T09:00:00.000Z')).toBe('2026-10-28')
  })
  it('emits only printable ASCII (safe for every PDF standard font)', () => {
    for (const s of [zar(-12345.6), pct(0.5), mwh(1), years(2), fixed(1e9, 2)]) expect(s).toMatch(/^[\x20-\x7e]+$/)
  })
})
```

`packages/shared/src/solar/reports/offer.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { offerBaseZar, offerPrice } from './offer'

describe('offerPrice (§9.3: capex + margin %)', () => {
  it('adds the margin, then VAT on the offer, to the cent', () => {
    expect(offerPrice(1_000_000, 15)).toEqual({
      capexExclVatZar: 1_000_000, marginPct: 15, marginZar: 150_000,
      offerExclVatZar: 1_150_000, vatZar: 172_500, offerInclVatZar: 1_322_500,
    })
  })
  it('rounds to cents', () => {
    const o = offerPrice(333.333, 10)
    expect(o.marginZar).toBe(33.33)
    expect(o.capexExclVatZar).toBe(333.33)
    expect(o.offerExclVatZar).toBe(366.66) // the sum of the two rounded parts, so the lines add up on paper
  })
  it('refuses a non-positive capex or an out-of-range margin', () => {
    expect(() => offerPrice(0, 10)).toThrow('capex')
    expect(() => offerPrice(100, -1)).toThrow('margin')
    expect(() => offerPrice(100, 101)).toThrow('margin')
  })
  it('excludes capex lines already categorised as margin (no double margin)', () => {
    expect(offerBaseZar({ exclVatZar: 1_100_000, byCategory: { modules: 1_000_000, margin: 100_000 } })).toBe(1_000_000)
    expect(offerBaseZar({ exclVatZar: 500, byCategory: {} })).toBe(500)
  })
})
```

- [ ] **Step 3: Run — expect FAIL** (modules missing).

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6 && pnpm --filter @esite/shared test -- src/solar/reports 2>&1 | tail -6
```

- [ ] **Step 4: Implement.**

`packages/shared/src/solar/reports/fmt.ts`:
```ts
/**
 * Locale-free number formatting for Solar reports and proposals. The PDF (react-pdf, WinAnsi) and
 * the client page both call these, so a figure is the same byte string in both — never
 * `toLocaleString`, whose output differs between Node and browsers (narrow no-break spaces).
 * Output is printable ASCII only.
 */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function fixed(n: number, dp: number): string {
  if (!Number.isFinite(n)) return 'n/a'
  const [w, f] = Math.abs(n).toFixed(dp).split('.')
  const isZero = Number(`${w}.${f ?? '0'}`) === 0
  return `${n < 0 && !isZero ? '-' : ''}${group(w!)}${f ? `.${f}` : ''}`
}

const money = (n: number, dp: number) => (Number.isFinite(n) ? `${n < 0 ? '-' : ''}R ${fixed(Math.abs(n), dp)}` : 'n/a')
export const zar = (n: number): string => money(n, 0)
export const zarCents = (n: number): string => money(n, 2)
export const pct = (fraction: number | null, dp = 1): string =>
  fraction === null || !Number.isFinite(fraction) ? 'n/a' : `${fixed(fraction * 100, dp)} %`
export const mwh = (kwh: number): string => `${fixed(kwh / 1000, 1)} MWh`
export const kwp = (v: number): string => `${fixed(v, 1)} kWp`
export const kw = (v: number): string => `${fixed(v, 1)} kW`
export const years = (y: number | null): string => (y === null || !Number.isFinite(y) ? 'n/a' : `${fixed(y, 1)} years`)
export const isoDate = (iso: string): string => iso.slice(0, 10)
```

`packages/shared/src/solar/reports/offer.ts`:
```ts
/** Offer price (functional spec §9.3): capex (excl. VAT, excluding any "margin" capex lines) + margin %. */
import { VAT_RATE, type CapexTotals } from '../cases/finance-config'

export interface OfferPrice {
  capexExclVatZar: number
  marginPct: number
  marginZar: number
  offerExclVatZar: number
  vatZar: number
  offerInclVatZar: number
}

const cents = (x: number) => Math.round(x * 100) / 100

/** The capex the margin is applied to: every line except the "margin" category (else it doubles). */
export function offerBaseZar(t: Pick<CapexTotals, 'exclVatZar' | 'byCategory'>): number {
  return cents(t.exclVatZar - (t.byCategory.margin ?? 0))
}

export function offerPrice(capexExclVatZar: number, marginPct: number): OfferPrice {
  if (!(capexExclVatZar > 0)) throw new Error('capex must be positive')
  if (!(marginPct >= 0 && marginPct <= 100)) throw new Error('margin must be between 0 and 100 %')
  const marginZar = cents((capexExclVatZar * marginPct) / 100)
  const offerExclVatZar = cents(capexExclVatZar + marginZar)
  const vatZar = cents(offerExclVatZar * VAT_RATE)
  return {
    capexExclVatZar: cents(capexExclVatZar), marginPct, marginZar,
    offerExclVatZar, vatZar, offerInclVatZar: cents(offerExclVatZar + vatZar),
  }
}
```

`packages/shared/src/solar/reports/index.ts` (the barrel grows task by task):
```ts
// Imported as `@esite/shared/solar-reports`; deliberately NOT re-exported from the package root.
export * from './fmt'
export * from './offer'
```

- [ ] **Step 5: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter @esite/shared test -- src/solar/reports 2>&1 | tail -4
git add packages/shared/package.json packages/shared/src/solar/reports
git commit -m "feat(solar): solar-reports subpath with locale-free formatting and offer price

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Proposal draft schema

**Files:**
- Create: `packages/shared/src/solar/reports/proposal-draft.ts`, `proposal-draft.test.ts`
- Modify: `packages/shared/src/solar/reports/index.ts`

- [ ] **Step 1: Failing test** `proposal-draft.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { defaultProposalDraft, parseProposalDraft, readProposalDraft, type ProposalDraft } from './proposal-draft'

const good: ProposalDraft = {
  clientName: 'Acme Retail (Pty) Ltd', marginPct: 15, validityDays: 30, financeOptions: ['cash', 'ppa'],
  summary: 'A 500 kWp rooftop system.', scope: 'Supply and install.', priceTerms: '40 % deposit.',
  assumptions: 'Roof is sound.', inclusions: ['Monitoring'], exclusions: ['Roof repairs'], terms: 'Standard terms.', narrative: '',
}

describe('proposal draft (§9.3 structured fields)', () => {
  it('accepts a complete draft', () => {
    expect(parseProposalDraft(good)).toEqual({ ok: true, draft: good })
  })
  it('names every invalid field', () => {
    const r = parseProposalDraft({ ...good, clientName: ' ', marginPct: 120, financeOptions: [], validityDays: 0 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(['clientName', 'financeOptions', 'marginPct', 'validityDays'])
      expect(r.errors.financeOptions).toBe('Offer at least one finance option')
    }
  })
  it('refuses a finance option offered twice', () => {
    const r = parseProposalDraft({ ...good, financeOptions: ['cash', 'cash'] })
    expect(r.ok).toBe(false)
  })
  it('defaults from the org templates, the rate-card margin and the case’s enabled models', () => {
    const d = defaultProposalDraft({ clientName: 'Acme', marginPct: null, validityDays: 45, termsText: 'Org terms', enabledKinds: ['debt', 'cash'] })
    expect(d).toMatchObject({ clientName: 'Acme', marginPct: 0, validityDays: 45, terms: 'Org terms', financeOptions: ['cash', 'debt'] })
    expect(defaultProposalDraft({ clientName: null, marginPct: 12, validityDays: null, termsText: null, enabledKinds: [] }))
      .toMatchObject({ clientName: '', marginPct: 12, validityDays: 30, terms: '', financeOptions: ['cash'] })
  })
  it('reads a stored draft leniently (unknown keys dropped, wrong types defaulted)', () => {
    expect(readProposalDraft({ clientName: 'X', marginPct: 'ten', inclusions: ['a', 3], evil: true })).toMatchObject({
      clientName: 'X', marginPct: 0, inclusions: ['a'],
    })
    expect(readProposalDraft(null).financeOptions).toEqual(['cash'])
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `proposal-draft.ts`:

```ts
/**
 * The proposal draft (functional spec §9.3): structured fields only, no free markup. Stored in
 * solar.proposals.draft (a money table). Money-shaped inputs here are the margin % only; the
 * offer price is computed (offer.ts), never typed.
 */
import { z } from 'zod'

export const FINANCE_OPTION_KINDS = ['cash', 'debt', 'ppa', 'lease'] as const
export type FinanceOptionKind = (typeof FINANCE_OPTION_KINDS)[number]
export const FINANCE_OPTION_LABELS: Record<FinanceOptionKind, string> = {
  cash: 'Cash purchase',
  debt: 'Debt-financed',
  ppa: 'Power purchase agreement (PPA)',
  lease: 'Lease / rent-to-own',
}

const text = (max: number) => z.string().max(max, `At most ${max} characters`)
const list = z.array(z.string().trim().min(1, 'Remove empty lines').max(300, 'At most 300 characters per line')).max(50, 'At most 50 lines')

export const ProposalDraftSchema = z.object({
  clientName: z.string().trim().min(1, 'Enter the client name').max(200, 'At most 200 characters'),
  marginPct: z.number({ invalid_type_error: 'Enter a number' }).min(0, 'Margin must be between 0 and 100 %').max(100, 'Margin must be between 0 and 100 %'),
  validityDays: z.number({ invalid_type_error: 'Enter a number' }).int('Whole days only').min(1, 'Between 1 and 365 days').max(365, 'Between 1 and 365 days'),
  financeOptions: z.array(z.enum(FINANCE_OPTION_KINDS))
    .min(1, 'Offer at least one finance option').max(4)
    .refine((a) => new Set(a).size === a.length, 'Each finance option may be offered once'),
  summary: text(4000),
  scope: text(8000),
  priceTerms: text(4000),
  assumptions: text(4000),
  inclusions: list,
  exclusions: list,
  terms: text(20000),
  narrative: text(8000),
})
export type ProposalDraft = z.infer<typeof ProposalDraftSchema>

export type ParseDraftResult = { ok: true; draft: ProposalDraft } | { ok: false; errors: Record<string, string> }

export function parseProposalDraft(raw: unknown): ParseDraftResult {
  const r = ProposalDraftSchema.safeParse(raw)
  if (r.success) return { ok: true, draft: r.data }
  const errors: Record<string, string> = {}
  for (const i of r.error.issues) {
    const k = String(i.path[0] ?? 'draft')
    if (!errors[k]) errors[k] = i.message
  }
  return { ok: false, errors }
}

const BLANK: ProposalDraft = {
  clientName: '', marginPct: 0, validityDays: 30, financeOptions: ['cash'],
  summary: '', scope: '', priceTerms: '', assumptions: '', inclusions: [], exclusions: [], terms: '', narrative: '',
}

export interface DraftDefaults {
  clientName: string | null
  /** 4b rate-card `rc_margin_pct`; NULL ⇒ 0 %, which the editor flags. */
  marginPct: number | null
  validityDays: number | null
  termsText: string | null
  /** Finance models enabled on the case's Financials tab (their inputs live there). */
  enabledKinds: readonly FinanceOptionKind[]
}

export function defaultProposalDraft(d: DraftDefaults): ProposalDraft {
  const kinds = FINANCE_OPTION_KINDS.filter((k) => d.enabledKinds.includes(k))
  return {
    ...BLANK,
    clientName: d.clientName?.trim() ?? '',
    marginPct: d.marginPct ?? 0,
    validityDays: d.validityDays ?? 30,
    terms: d.termsText ?? '',
    financeOptions: kinds.length ? kinds : ['cash'],
  }
}

/** Lenient read of a stored draft for the editor: never throws, never keeps unknown keys. */
export function readProposalDraft(raw: unknown): ProposalDraft {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const str = (k: keyof ProposalDraft) => (typeof o[k] === 'string' ? (o[k] as string) : (BLANK[k] as string))
  const num = (k: 'marginPct' | 'validityDays') => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : BLANK[k])
  const strs = (k: 'inclusions' | 'exclusions') => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [])
  const fo = Array.isArray(o.financeOptions)
    ? FINANCE_OPTION_KINDS.filter((k) => (o.financeOptions as unknown[]).includes(k))
    : []
  return {
    clientName: str('clientName'), marginPct: num('marginPct'), validityDays: num('validityDays'),
    financeOptions: fo.length ? fo : ['cash'],
    summary: str('summary'), scope: str('scope'), priceTerms: str('priceTerms'), assumptions: str('assumptions'),
    inclusions: strs('inclusions'), exclusions: strs('exclusions'), terms: str('terms'), narrative: str('narrative'),
  }
}
```

- [ ] **Step 3: Barrel** — append `export * from './proposal-draft'` to `index.ts`. **Run — PASS; commit** ("feat(solar): proposal draft schema").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter @esite/shared test -- src/solar/reports 2>&1 | tail -4
git add packages/shared/src/solar/reports && git commit -m "feat(solar): proposal draft schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Finance options (D-15) — offer-priced finance input and client-facing summaries

**Files:**
- Create: `packages/shared/src/solar/reports/finance-options.ts`, `finance-options.test.ts`
- Modify: `packages/shared/src/solar/reports/index.ts`

- [ ] **Step 1: Failing test** `finance-options.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { FinanceInput, FinanceResult } from '../../services/solar/finance/cashflow'
import { proposalFinanceInput, summariseFinanceOptions } from './finance-options'

const base = {
  kWpDc: 500,
  capex: { totalZar: 1_000_000, inverterZar: 200_000, batteryZar: 0, section12bQualifyingZar: 800_000 },
  models: [
    { kind: 'cash' },
    { kind: 'debt', loanFraction: 0.7, annualRate: 0.115, termYears: 7, graceMonths: 0 },
    { kind: 'ppa', startTariffZarPerKwh: 1.45, escalation: 0.06, termYears: 20, buyout: null },
  ],
} as unknown as FinanceInput

const row = (year: number, net: number, cum: number) => ({ year, energyKwh: 1, billBeforeZar: 0, billAfterZar: 0, savingZar: net + 10, opexZar: 10, replacementZar: 0, taxZar: 0, financeZar: 0, netZar: net, cumulativeZar: cum })
const result = {
  lcoeZarPerKwh: 0.9, loadShedding: null,
  models: [
    { model: 'cash', views: [{ view: 'owner', upfrontZar: 1_150_000, npvZar: 2_000_000, irr: 0.2, simplePaybackYears: 4.6, discountedPaybackYears: 6, rows: [row(1, 250_000, -900_000), row(2, 260_000, 3_100_000)] }] },
    { model: 'ppa', views: [
      { view: 'client', upfrontZar: 0, npvZar: 500_000, irr: null, simplePaybackYears: null, discountedPaybackYears: null, rows: [row(1, 60_000, 60_000), row(2, 65_000, 900_000)] },
      { view: 'investor', upfrontZar: 1_150_000, npvZar: 100_000, irr: 0.13, simplePaybackYears: 8, discountedPaybackYears: 11, rows: [row(1, 1, 1)] },
    ] },
  ],
} as unknown as FinanceResult

describe('proposalFinanceInput', () => {
  it('prices the capex at the offer (components scaled) and keeps only the offered models, in order', () => {
    const r = proposalFinanceInput(base, 1_150_000, ['ppa', 'cash'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input.capex).toEqual({ totalZar: 1_150_000, inverterZar: 230_000, batteryZar: 0, section12bQualifyingZar: 920_000 })
    expect(r.input.models.map((m) => m.kind)).toEqual(['ppa', 'cash'])
    expect(base.capex.totalZar).toBe(1_000_000) // input not mutated
  })
  it('names offered models that have no inputs on the case', () => {
    expect(proposalFinanceInput(base, 1_150_000, ['cash', 'lease'])).toEqual({ ok: false, missing: ['lease'] })
  })
})

describe('summariseFinanceOptions', () => {
  it('uses the CLIENT view where one exists, otherwise the owner view; never the investor view', () => {
    const s = summariseFinanceOptions(result, [base.models[0]!, base.models[2]!])
    expect(s.map((x) => [x.kind, x.view])).toEqual([['cash', 'owner'], ['ppa', 'client']])
    expect(s[0]).toMatchObject({ upfrontZar: 1_150_000, year1NetZar: 250_000, lifetimeNetZar: 3_100_000, npvZar: 2_000_000, irr: 0.2, simplePaybackYears: 4.6, years: 2, terms: 'Paid upfront' })
    expect(s[1]).toMatchObject({ upfrontZar: 0, year1NetZar: 60_000, irr: null, terms: 'R 1.45/kWh escalating 6.0 %/yr for 20 years' })
  })
  it('describes debt terms', () => {
    const r = { ...result, models: [{ model: 'debt', views: [{ ...result.models[0]!.views[0]!, view: 'owner' }] }] } as unknown as FinanceResult
    expect(summariseFinanceOptions(r, [base.models[1]!])[0]!.terms).toBe('70 % financed over 7 years at 11.50 %')
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `finance-options.ts`:

```ts
/**
 * Proposal finance options (decision D-15): any of cash / debt / PPA / lease, each computed by the
 * engine. The CLIENT pays the offer price, so the finance input's capex is replaced by the offer
 * (components scaled pro rata) before runStoredFinancials runs on the STORED energy — arithmetic on
 * the stored run, never a re-simulation.
 */
import type { FinanceInput, FinanceModel, FinanceResult, ViewResult } from '../../services/solar/finance/cashflow'
import type { FinanceOptionKind } from './proposal-draft'
import { fixed, pct, zar } from './fmt'

export function proposalFinanceInput(
  base: FinanceInput,
  offerExclVatZar: number,
  kinds: readonly FinanceOptionKind[],
): { ok: true; input: FinanceInput } | { ok: false; missing: FinanceOptionKind[] } {
  const missing = kinds.filter((k) => !base.models.some((m) => m.kind === k))
  if (missing.length) return { ok: false, missing }
  const f = base.capex.totalZar > 0 ? offerExclVatZar / base.capex.totalZar : 1
  const c = base.capex
  return {
    ok: true,
    input: {
      ...base,
      capex: {
        totalZar: offerExclVatZar,
        inverterZar: Math.round(c.inverterZar * f * 100) / 100,
        batteryZar: Math.round(c.batteryZar * f * 100) / 100,
        section12bQualifyingZar: Math.round(c.section12bQualifyingZar * f * 100) / 100,
      },
      models: kinds.map((k) => base.models.find((m) => m.kind === k)!),
    },
  }
}

export interface FinanceOptionSummary {
  kind: FinanceOptionKind
  view: ViewResult['view']
  upfrontZar: number
  year1NetZar: number
  lifetimeNetZar: number
  npvZar: number
  irr: number | null
  simplePaybackYears: number | null
  years: number
  terms: string
}

function termsOf(m: FinanceModel): string {
  switch (m.kind) {
    case 'cash': return 'Paid upfront'
    case 'debt': return `${pct(m.loanFraction, 0)} financed over ${m.termYears} years at ${fixed(m.annualRate * 100, 2)} %`
    case 'ppa': return `R ${fixed(m.startTariffZarPerKwh, 2)}/kWh escalating ${fixed(m.escalation * 100, 1)} %/yr for ${m.termYears} years`
    case 'lease': return `${zar(m.monthlyPaymentZar)}/month escalating ${fixed(m.escalation * 100, 1)} %/yr for ${m.termYears} years`
  }
}

const r2 = (x: number) => Math.round(x * 100) / 100

export function summariseFinanceOptions(result: FinanceResult, models: readonly FinanceModel[]): FinanceOptionSummary[] {
  return models.map((m) => {
    const mr = result.models.find((x) => x.model === m.kind)
    if (!mr) throw new Error(`the finance result has no ${m.kind} model`)
    const v = mr.views.find((x) => x.view === 'client') ?? mr.views.find((x) => x.view === 'owner')
    if (!v) throw new Error(`the ${m.kind} model has no client or owner view`)
    const first = v.rows[0]
    const last = v.rows[v.rows.length - 1]
    return {
      kind: m.kind, view: v.view,
      upfrontZar: r2(v.upfrontZar), year1NetZar: r2(first?.netZar ?? 0), lifetimeNetZar: r2(last?.cumulativeZar ?? 0),
      npvZar: r2(v.npvZar), irr: v.irr, simplePaybackYears: v.simplePaybackYears, years: v.rows.length,
      terms: termsOf(m),
    }
  })
}
```

- [ ] **Step 3: Barrel** `export * from './finance-options'`; **Run — PASS; commit** ("feat(solar): offer-priced finance options for proposals").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter @esite/shared test -- src/solar/reports 2>&1 | tail -4
git add packages/shared/src/solar/reports && git commit -m "feat(solar): offer-priced finance options for proposals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The frozen snapshot, key figures and the finance table

**Files:**
- Create: `packages/shared/src/solar/reports/snapshot.ts`, `snapshot.test.ts`
- Modify: `packages/shared/src/solar/reports/index.ts`

The snapshot is the ONLY data a client ever receives (§9.4 "no data beyond the frozen snapshot"): it carries the client price, never the capex or the margin. `keyFigures` and `financeOptionTable` are the single source for both the PDF and the client page.

- [ ] **Step 1: Failing test** `snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildProposalSnapshot, financeOptionTable, keyFigures, type BuildSnapshotInput } from './snapshot'
import { offerPrice } from './offer'

export const snapshotInput = (): BuildSnapshotInput => ({
  proposal: { id: 'p1', familyId: 'p1', version: 2, title: 'Rooftop PV for Acme', issuedAt: '2026-09-29T08:00:00.000Z', validUntil: '2026-10-29T08:00:00.000Z' },
  issuer: { orgName: 'Sun Co', proposerName: 'Pat Proposer', proposerEmail: 'pat@sun.example' },
  project: { name: 'Acme Mall', address: '1 Main Rd, Pretoria' },
  case: { id: 'c1', name: 'Base', runId: 'r1', inputsHash: 'a'.repeat(64), engineVersion: '0.1.0', runFinishedAt: '2026-09-28T10:00:00.000Z' },
  kpis: { dcKwp: 500, acKw: 400, batteryKwh: null, batteryKw: null, annualAcKwh: 845_000, specificYieldKwhPerKwp: 1690, selfConsumption: 0.834, solarFraction: 0.581, exportKwh: 140_000 },
  price: offerPrice(1_000_000, 15),
  bills: { beforeZar: 1_000_000, afterZar: 600_000 },
  financeOptions: [
    { kind: 'cash', view: 'owner', upfrontZar: 1_150_000, year1NetZar: 390_000, lifetimeNetZar: 9_000_000, npvZar: 2_000_000, irr: 0.21, simplePaybackYears: 3.1, years: 25, terms: 'Paid upfront' },
    { kind: 'ppa', view: 'client', upfrontZar: 0, year1NetZar: 60_000, lifetimeNetZar: 2_500_000, npvZar: 500_000, irr: null, simplePaybackYears: null, years: 20, terms: 'R 1.45/kWh escalating 6.0 %/yr for 20 years' },
  ],
  draft: {
    clientName: 'Acme Retail (Pty) Ltd', marginPct: 15, validityDays: 30, financeOptions: ['cash', 'ppa'],
    summary: 'Resistance ≤ 0,2 Ω ✓', scope: 'Supply → install', priceTerms: 'Deposit 40 %', assumptions: 'None',
    inclusions: ['Monitoring'], exclusions: ['Roof repairs'], terms: 'Terms', narrative: 'Narrative',
  },
  disclaimer: 'Org disclaimer',
  provenance: { financeInputsHash: 'b'.repeat(64), tariff: { tariffId: 't1', tariffName: 'Business 1', financialYear: '2026/27', licenseeName: 'City of Tshwane' } },
})

describe('buildProposalSnapshot', () => {
  it('freezes the client price but NEVER the capex or the margin', () => {
    const s = buildProposalSnapshot(snapshotInput())
    expect(s.price).toEqual({ offerExclVatZar: 1_150_000, vatZar: 172_500, offerInclVatZar: 1_322_500 })
    const json = JSON.stringify(s)
    expect(json).not.toContain('marginPct')
    expect(json).not.toContain('capexExclVatZar')
    expect(json).not.toContain('marginZar')
  })
  it('passes every string through the sanitiser (so PDF and page print identical text)', () => {
    const s = buildProposalSnapshot(snapshotInput(), (t) => t.replace(/[^\x20-\x7e]/g, '?'))
    expect(s.text.summary).toBe('Resistance ? 0,2 ? ?')
    expect(s.client.name).toBe('Acme Retail (Pty) Ltd')
  })
  it('is JSON-stable (what is stored is what is served)', () => {
    const s = buildProposalSnapshot(snapshotInput())
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})

describe('keyFigures / financeOptionTable (one source for PDF and page)', () => {
  it('lists the client-facing figures with units', () => {
    expect(keyFigures(buildProposalSnapshot(snapshotInput()))).toEqual([
      { label: 'System size', value: '500.0 kWp DC / 400.0 kW AC' },
      { label: 'Year-1 solar generation', value: '845.0 MWh' },
      { label: 'Specific yield', value: '1 690 kWh/kWp' },
      { label: 'Share of your consumption from solar', value: '58.1 %' },
      { label: 'Offer price (excl. VAT)', value: 'R 1 150 000.00' },
      { label: 'VAT (15 %)', value: 'R 172 500.00' },
      { label: 'Offer price (incl. VAT)', value: 'R 1 322 500.00' },
      { label: 'Estimated year-1 electricity saving (excl. VAT)', value: 'R 400 000' },
      { label: 'Valid until', value: '2026-10-29' },
    ])
  })
  it('adds the battery line only when there is one', () => {
    const i = snapshotInput()
    i.kpis = { ...i.kpis, batteryKwh: 200, batteryKw: 100 }
    expect(keyFigures(buildProposalSnapshot(i))).toContainEqual({ label: 'Battery', value: '200.0 kWh / 100.0 kW' })
  })
  it('tabulates the offered options side by side', () => {
    const t = financeOptionTable(buildProposalSnapshot(snapshotInput()))
    expect(t.columns).toEqual(['', 'Cash purchase', 'Power purchase agreement (PPA)'])
    expect(t.rows).toEqual([
      ['Terms', 'Paid upfront', 'R 1.45/kWh escalating 6.0 %/yr for 20 years'],
      ['Upfront payment', 'R 1 150 000', 'R 0'],
      ['Year-1 net benefit', 'R 390 000', 'R 60 000'],
      ['Net benefit over the term', 'R 9 000 000 (25 years)', 'R 2 500 000 (20 years)'],
      ['Simple payback', '3.1 years', 'n/a'],
      ['IRR', '21.0 %', 'n/a'],
    ])
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `snapshot.ts`:

```ts
/**
 * The frozen proposal snapshot (functional spec §9.3 Issue, §9.4). Written once at Issue into
 * solar.proposals.snapshot and never recomputed; the token page, the portal and the PDF all render
 * it. It holds the CLIENT price only — capex and margin stay in the (money-gated) draft.
 */
import type { RunKpis, TariffRef } from '../cases/outputs'
import { VAT_RATE } from '../cases/finance-config'
import type { OfferPrice } from './offer'
import type { FinanceOptionSummary } from './finance-options'
import { FINANCE_OPTION_LABELS, type ProposalDraft } from './proposal-draft'
import { fixed, isoDate, kw, kwp, mwh, pct, years, zar, zarCents } from './fmt'

export const SNAPSHOT_VERSION = 1 as const

export interface ProposalSnapshot {
  version: typeof SNAPSHOT_VERSION
  proposal: { id: string; familyId: string; version: number; title: string; issuedAt: string; validUntil: string }
  issuer: { orgName: string; proposerName: string; proposerEmail: string | null }
  client: { name: string }
  project: { name: string; address: string | null }
  case: { id: string; name: string; runId: string; inputsHash: string; engineVersion: string; runFinishedAt: string }
  system: {
    dcKwp: number; acKw: number; batteryKwh: number | null; batteryKw: number | null
    year1PvKwh: number; specificYieldKwhPerKwp: number; selfConsumption: number; solarFraction: number; exportKwh: number
  }
  price: { offerExclVatZar: number; vatZar: number; offerInclVatZar: number }
  bills: { beforeZar: number; afterZar: number; savingZar: number } | null
  financeOptions: FinanceOptionSummary[]
  text: {
    summary: string; scope: string; priceTerms: string; assumptions: string
    inclusions: string[]; exclusions: string[]; terms: string; narrative: string; disclaimer: string
  }
  provenance: { financeInputsHash: string; tariff: TariffRef | null }
}

export interface BuildSnapshotInput {
  proposal: ProposalSnapshot['proposal']
  issuer: ProposalSnapshot['issuer']
  project: ProposalSnapshot['project']
  case: ProposalSnapshot['case']
  kpis: Pick<RunKpis, 'dcKwp' | 'acKw' | 'batteryKwh' | 'batteryKw' | 'annualAcKwh' | 'specificYieldKwhPerKwp' | 'selfConsumption' | 'solarFraction' | 'exportKwh'>
  price: OfferPrice
  bills: { beforeZar: number; afterZar: number } | null
  financeOptions: FinanceOptionSummary[]
  draft: ProposalDraft
  disclaimer: string
  provenance: ProposalSnapshot['provenance']
}

const r3 = (x: number) => Math.round(x * 1000) / 1000
const r2 = (x: number) => Math.round(x * 100) / 100

export function buildProposalSnapshot(i: BuildSnapshotInput, sanitize: (s: string) => string = (s) => s): ProposalSnapshot {
  const t = sanitize
  const tr = i.provenance.tariff
  return {
    version: SNAPSHOT_VERSION,
    proposal: { ...i.proposal, title: t(i.proposal.title) },
    issuer: { orgName: t(i.issuer.orgName), proposerName: t(i.issuer.proposerName), proposerEmail: i.issuer.proposerEmail },
    client: { name: t(i.draft.clientName) },
    project: { name: t(i.project.name), address: i.project.address === null ? null : t(i.project.address) },
    case: { ...i.case, name: t(i.case.name) },
    system: {
      dcKwp: r3(i.kpis.dcKwp), acKw: r3(i.kpis.acKw),
      batteryKwh: i.kpis.batteryKwh === null ? null : r3(i.kpis.batteryKwh),
      batteryKw: i.kpis.batteryKw === null ? null : r3(i.kpis.batteryKw),
      year1PvKwh: r3(i.kpis.annualAcKwh), specificYieldKwhPerKwp: r3(i.kpis.specificYieldKwhPerKwp),
      selfConsumption: r3(i.kpis.selfConsumption), solarFraction: r3(i.kpis.solarFraction), exportKwh: r3(i.kpis.exportKwh),
    },
    price: { offerExclVatZar: i.price.offerExclVatZar, vatZar: i.price.vatZar, offerInclVatZar: i.price.offerInclVatZar },
    bills: i.bills ? { beforeZar: r2(i.bills.beforeZar), afterZar: r2(i.bills.afterZar), savingZar: r2(i.bills.beforeZar - i.bills.afterZar) } : null,
    financeOptions: i.financeOptions.map((o) => ({ ...o, terms: t(o.terms) })),
    text: {
      summary: t(i.draft.summary), scope: t(i.draft.scope), priceTerms: t(i.draft.priceTerms), assumptions: t(i.draft.assumptions),
      inclusions: i.draft.inclusions.map(t), exclusions: i.draft.exclusions.map(t),
      terms: t(i.draft.terms), narrative: t(i.draft.narrative), disclaimer: t(i.disclaimer),
    },
    provenance: {
      financeInputsHash: i.provenance.financeInputsHash,
      tariff: tr ? { tariffId: tr.tariffId, tariffName: t(tr.tariffName), financialYear: tr.financialYear, licenseeName: t(tr.licenseeName) } : null,
    },
  }
}

export interface KeyFigure { label: string; value: string }

export function keyFigures(s: ProposalSnapshot): KeyFigure[] {
  const out: KeyFigure[] = [{ label: 'System size', value: `${kwp(s.system.dcKwp)} DC / ${kw(s.system.acKw)} AC` }]
  if (s.system.batteryKwh !== null) out.push({ label: 'Battery', value: `${fixed(s.system.batteryKwh, 1)} kWh / ${kw(s.system.batteryKw ?? 0)}` })
  out.push(
    { label: 'Year-1 solar generation', value: mwh(s.system.year1PvKwh) },
    { label: 'Specific yield', value: `${fixed(s.system.specificYieldKwhPerKwp, 0)} kWh/kWp` },
    { label: 'Share of your consumption from solar', value: pct(s.system.solarFraction) },
    { label: 'Offer price (excl. VAT)', value: zarCents(s.price.offerExclVatZar) },
    { label: `VAT (${fixed(VAT_RATE * 100, 0)} %)`, value: zarCents(s.price.vatZar) },
    { label: 'Offer price (incl. VAT)', value: zarCents(s.price.offerInclVatZar) },
  )
  if (s.bills) out.push({ label: 'Estimated year-1 electricity saving (excl. VAT)', value: zar(s.bills.savingZar) })
  out.push({ label: 'Valid until', value: isoDate(s.proposal.validUntil) })
  return out
}

export interface FinanceOptionTable { columns: string[]; rows: string[][] }

export function financeOptionTable(s: ProposalSnapshot): FinanceOptionTable {
  const o = s.financeOptions
  return {
    columns: ['', ...o.map((x) => FINANCE_OPTION_LABELS[x.kind])],
    rows: [
      ['Terms', ...o.map((x) => x.terms)],
      ['Upfront payment', ...o.map((x) => zar(x.upfrontZar))],
      ['Year-1 net benefit', ...o.map((x) => zar(x.year1NetZar))],
      ['Net benefit over the term', ...o.map((x) => `${zar(x.lifetimeNetZar)} (${x.years} years)`)],
      ['Simple payback', ...o.map((x) => years(x.simplePaybackYears))],
      ['IRR', ...o.map((x) => pct(x.irr))],
    ],
  }
}
```

- [ ] **Step 3: Barrel** `export * from './snapshot'`; **Run — PASS; commit** ("feat(solar): frozen proposal snapshot and shared key figures").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter @esite/shared test -- src/solar/reports 2>&1 | tail -4
git add packages/shared/src/solar/reports && git commit -m "feat(solar): frozen proposal snapshot and shared key figures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Feasibility / technical report model (from the stored run only)

**Files:**
- Create: `packages/shared/src/solar/reports/report-model.ts`, `report-model.test.ts`
- Modify: `packages/shared/src/solar/reports/index.ts`

- [ ] **Step 1: Failing test** `report-model.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { CaseRunOutputs } from '../cases/outputs'
import { buildSolarReportModel, type SolarReportInput } from './report-model'

const monthly = Array.from({ length: 12 }, (_, i) => ({
  month: i + 1, pvKwh: 70_000, loadKwh: 120_000, importBeforeKwh: 120_000, importKwh: 60_000, exportKwh: 10_000,
  maxDemandBeforeKw: 400, maxDemandAfterKw: 350, touImportBefore: null, touImportAfter: null,
}))
export const outputs = {
  version: 1,
  kpis: { dcKwp: 500, acKw: 400, specificYieldKwhPerKwp: 1690, performanceRatio: 0.81, annualAcKwh: 845_000, pvAcKwh: 845_000, deliveredKwh: 840_000,
    selfConsumedKwh: 700_000, exportKwh: 140_000, curtailedKwh: 5_000, loadKwh: 1_440_000, importBeforeKwh: 1_440_000, importAfterKwh: 740_000,
    solarFraction: 0.486, selfConsumption: 0.834, peakDemandBeforeKw: 420, peakDemandAfterKw: 380, peakDemandBasis: 'hourly', batteryKwh: null, batteryKw: null },
  monthly, typicalDays: [], daily: [],
  waterfall: [{ key: 'poa', label: 'Plane-of-array irradiation', kwh: 1_100_000, kind: 'start' }, { key: 'soiling', label: 'Soiling', kwh: -22_000, kind: 'loss' }, { key: 'ac', label: 'AC energy', kwh: 845_000, kind: 'end' }],
  checks: [{ id: 'dc_ac_ratio', label: 'DC/AC ratio', status: 'pass', detail: '1.25' }],
  provenance: { engineVersion: '0.1.0', inputsHash: 'a'.repeat(64), weatherDatasetId: 'w1', weatherSource: 'PVGIS TMY', weatherFetchedAt: '2026-09-01T00:00:00Z', gsaPvoutKwhPerKwp: 1700,
    tariffRef: null, loadBasis: 'metered', loadReferenceYear: 2025 },
} as unknown as CaseRunOutputs

const money = {
  capex: { exclVatZar: 1_000_000, vatZar: 150_000, inclVatZar: 1_150_000, zarPerWp: 2, inverterZar: 200_000, batteryZar: 0, qualifying12bZar: 800_000, byCategory: { modules: 800_000, inverters: 200_000 } },
  year1Bills: { beforeZar: 1_000_000, afterZar: 600_000, afterPvOnlyZar: 600_000, exportCreditUsedZar: 20_000 },
  finance: { lcoeZarPerKwh: 0.95, loadShedding: { annualZar: [50_000], npvZar: 400_000 }, models: [{ model: 'cash', views: [{ view: 'owner', upfrontZar: 1_000_000, npvZar: 2_000_000, irr: 0.21, simplePaybackYears: 2.6, discountedPaybackYears: 3.4,
    rows: [{ year: 1, energyKwh: 845_000, billBeforeZar: 1_000_000, billAfterZar: 600_000, savingZar: 400_000, opexZar: 80_000, replacementZar: 0, taxZar: 0, financeZar: 0, netZar: 320_000, cumulativeZar: -680_000 }] }] }] },
  tornado: { model: 'cash', view: 'owner', baseNpvZar: 2_000_000, swing: 0.2, bars: [{ variable: 'capex', lowNpvZar: 2_200_000, highNpvZar: 1_800_000, spreadZar: 400_000 }], omitted: [] },
  tariffName: 'Business 1 (City of Tshwane, 2026/27)',
}

export const reportInput = (kind: 'feasibility' | 'technical'): SolarReportInput => ({
  kind, projectName: 'Acme Mall', address: '1 Main Rd', caseName: 'Base',
  site: { latitude: -25.75, longitude: 28.19, licenseeName: 'City of Tshwane', nmdKva: 800, exportMode: 'net_billing', exportLimitKw: 100 },
  run: { id: 'r1', finishedAt: '2026-09-28T10:00:00.000Z', outputs },
  money: kind === 'feasibility' ? (money as unknown as SolarReportInput['money']) : null,
  options: { layoutSheetAttached: false, include8760: true },
  disclaimer: 'Org disclaimer text',
  generatedAt: '2026-09-29T08:00:00.000Z',
})

const allText = (m: ReturnType<typeof buildSolarReportModel>) =>
  JSON.stringify(m.sections.map((s) => [s.title, s.paragraphs, s.tables.map((t) => [t.columns, t.rows])]))

describe('buildSolarReportModel', () => {
  it('feasibility carries every spec section in order', () => {
    const m = buildSolarReportModel(reportInput('feasibility'))
    expect(m.sections.map((s) => s.title)).toEqual([
      'Executive summary', 'Site and supply', 'Load analysis', 'Tariff', 'System design', 'Yield',
      'Financials', 'Sensitivity', 'Assumptions and provenance', 'Disclaimers',
    ])
    expect(allText(m)).toContain('R 400 000')
    expect(allText(m)).toContain('21.0 %')
    expect(m.summary).toEqual({ kwp: 500, mwhYear1: 845, saving: 'R 400 000', irrPct: 21, runId: 'r1' })
  })
  it('technical has NO rand value anywhere, even when money is passed by mistake', () => {
    const i = reportInput('technical')
    i.money = reportInput('feasibility').money
    const m = buildSolarReportModel(i)
    expect(m.sections.map((s) => s.title)).not.toContain('Financials')
    expect(m.sections.map((s) => s.title)).not.toContain('Tariff')
    expect(allText(m)).not.toMatch(/R \d|ZAR|R\/kWh|IRR|NPV/)
    expect(m.summary).toEqual({ kwp: 500, mwhYear1: 845, runId: 'r1' })
  })
  it('refuses a feasibility report without stored financial results', () => {
    expect(() => buildSolarReportModel({ ...reportInput('feasibility'), money: null })).toThrow('financial results')
  })
  it('labels the monthly table by position and keeps load-shedding out of the cashflow', () => {
    const m = buildSolarReportModel(reportInput('feasibility'))
    const load = m.sections.find((s) => s.title === 'Load analysis')!
    expect(load.tables[0]!.rows.map((r) => r[0])).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
    const fin = m.sections.find((s) => s.title === 'Financials')!
    expect(fin.paragraphs.join(' ')).toContain('reported separately and not included in any cashflow or IRR')
  })
  it('names the run and the hourly export when the 8760 appendix is requested', () => {
    const prov = buildSolarReportModel(reportInput('technical')).sections.find((s) => s.title === 'Assumptions and provenance')!
    expect(prov.paragraphs.join(' ')).toContain('Hourly data (8 760 rows) for run r1')
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `report-model.ts`:

```ts
/**
 * Feasibility and technical report content (functional spec §9.1) built ONLY from a stored run's
 * outputs (and, for feasibility, its stored financial result). Nothing is recomputed. The technical
 * report carries no rand value: money is dropped at the top, whatever the caller passes.
 */
import type { CaseRunOutputs } from '../cases/outputs'
import { CAPEX_CATEGORY_LABELS, type CapexTotals } from '../cases/finance-config'
import type { FinanceResult } from '../../services/solar/finance/cashflow'
import type { Tornado } from '../../services/solar/finance/sensitivity'
import type { Year1Bills } from '../../services/solar/finance/bill-calculator'
import { fixed, isoDate, kw, kwp, mwh, pct, years, zar } from './fmt'

export type SolarReportKind = 'feasibility' | 'technical'
export interface ReportTable { columns: string[]; rows: string[][]; numeric: boolean[] }
export interface ReportSection { title: string; paragraphs: string[]; tables: ReportTable[] }
export interface SolarReportModel {
  kind: SolarReportKind
  title: string
  kicker: string
  sections: ReportSection[]
  summary: Record<string, number | string>
}
export interface SolarReportMoney { capex: CapexTotals; year1Bills: Year1Bills; finance: FinanceResult; tornado: Tornado; tariffName: string | null }
export interface SolarReportInput {
  kind: SolarReportKind
  projectName: string
  address: string | null
  site: { latitude: number | null; longitude: number | null; licenseeName: string | null; nmdKva: number | null; exportMode: string | null; exportLimitKw: number | null }
  caseName: string
  run: { id: string; finishedAt: string; outputs: CaseRunOutputs }
  money: SolarReportMoney | null
  options: { layoutSheetAttached: boolean; include8760: boolean }
  disclaimer: string
  generatedAt: string
}

export const REPORT_DISCLAIMER_BASE =
  'Figures are modelled from the stored run named in this report, using a typical meteorological year and, where shown, ' +
  'the tariff named. Actual generation and savings will differ with weather, consumption, equipment performance and tariff ' +
  'changes. Rand values exclude VAT unless marked.'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MODEL_LABELS: Record<string, string> = { cash: 'Cash', debt: 'Debt-financed', ppa: 'PPA', lease: 'Lease' }
const TORNADO_LABELS: Record<string, string> = { capex: 'Capex', tariffEscalation: 'Tariff escalation', yield: 'Yield', discountRate: 'Discount rate', exportRate: 'Export rate' }
const EXPORT_LABELS: Record<string, string> = { net_billing: 'Net billing (export credited)', no_credit: 'Export allowed, no credit', zero_export: 'Zero export' }
const n1 = (v: number) => fixed(v, 1)
const table = (columns: string[], rows: string[][], numericFrom = 1): ReportTable => ({ columns, rows, numeric: columns.map((_, i) => i >= numericFrom) })

export function buildSolarReportModel(i: SolarReportInput): SolarReportModel {
  const money = i.kind === 'feasibility' ? i.money : null
  if (i.kind === 'feasibility' && !money) throw new Error('a feasibility report needs stored financial results')
  const o = i.run.outputs
  const k = o.kpis
  const battery = k.batteryKwh === null ? 'no battery' : `a ${n1(k.batteryKwh)} kWh / ${kw(k.batteryKw ?? 0)} battery`
  const sections: ReportSection[] = []

  // 1. Executive summary
  const summaryParas = [
    `${i.caseName}: ${kwp(k.dcKwp)} DC / ${kw(k.acKw)} AC with ${battery}, producing ${mwh(k.annualAcKwh)} in year 1 ` +
    `(${fixed(k.specificYieldKwhPerKwp, 0)} kWh/kWp) and supplying ${pct(k.solarFraction)} of the site's consumption.`,
  ]
  const kpiRows: string[][] = [
    ['PV size', `${kwp(k.dcKwp)} DC / ${kw(k.acKw)} AC`],
    ['Battery', k.batteryKwh === null ? 'None' : `${n1(k.batteryKwh)} kWh / ${kw(k.batteryKw ?? 0)}`],
    ['Year-1 PV yield', `${mwh(k.annualAcKwh)} (${fixed(k.specificYieldKwhPerKwp, 0)} kWh/kWp)`],
    ['Self-consumption', pct(k.selfConsumption)],
    ['Solar fraction of load', pct(k.solarFraction)],
    ['Export', mwh(k.exportKwh)],
  ]
  let firstView: FinanceResult['models'][number]['views'][number] | undefined
  if (money) {
    const b = money.year1Bills
    firstView = money.finance.models[0]?.views[0]
    summaryParas.push(`Year-1 electricity cost falls from ${zar(b.beforeZar)} to ${zar(b.afterZar)} (excl. VAT), a saving of ${zar(b.beforeZar - b.afterZar)}.`)
    kpiRows.push(
      ['Year-1 bill before / after (excl. VAT)', `${zar(b.beforeZar)} / ${zar(b.afterZar)}`],
      ['Year-1 saving', zar(b.beforeZar - b.afterZar)],
      ['Simple payback', years(firstView?.simplePaybackYears ?? null)],
      ['IRR', pct(firstView?.irr ?? null)],
      ['NPV', firstView ? zar(firstView.npvZar) : 'n/a'],
      ['LCOE', money.finance.lcoeZarPerKwh === null ? 'n/a' : `R ${fixed(money.finance.lcoeZarPerKwh, 2)}/kWh`],
    )
  }
  sections.push({ title: 'Executive summary', paragraphs: summaryParas, tables: [table(['Metric', 'Value'], kpiRows)] })

  // 2. Site and supply
  const s = i.site
  sections.push({
    title: 'Site and supply', paragraphs: [],
    tables: [table(['Item', 'Value'], [
      ['Project', i.projectName],
      ['Address', i.address ?? 'Not recorded'],
      ['Coordinates', s.latitude === null || s.longitude === null ? 'Not recorded' : `${fixed(s.latitude, 5)}, ${fixed(s.longitude, 5)}`],
      ['Supply authority', s.licenseeName ?? 'Not recorded'],
      ['Notified maximum demand', s.nmdKva === null ? 'Not recorded' : `${n1(s.nmdKva)} kVA`],
      ['Export rule', s.exportMode ? `${EXPORT_LABELS[s.exportMode] ?? s.exportMode}${s.exportLimitKw !== null ? `, limit ${kw(s.exportLimitKw)}` : ''}` : 'Not recorded'],
    ])],
  })

  // 3. Load analysis
  sections.push({
    title: 'Load analysis',
    paragraphs: [`Annual consumption ${mwh(k.loadKwh)}; peak demand ${kw(k.peakDemandBeforeKw)} before and ${kw(k.peakDemandAfterKw)} after solar (hourly basis). Load basis: ${o.provenance.loadBasis}, reference year ${o.provenance.loadReferenceYear}.`],
    tables: [table(['Month', 'Load (MWh)', 'PV (MWh)', 'Import before (MWh)', 'Import after (MWh)', 'Export (MWh)', 'Max demand before (kW)', 'Max demand after (kW)'],
      o.monthly.map((m, idx) => [MONTHS[idx] ?? String(m.month), n1(m.loadKwh / 1000), n1(m.pvKwh / 1000), n1(m.importBeforeKwh / 1000), n1(m.importKwh / 1000), n1(m.exportKwh / 1000), n1(m.maxDemandBeforeKw), n1(m.maxDemandAfterKw)]))],
  })

  // 4. Tariff (money)
  if (money) {
    const b = money.year1Bills
    sections.push({
      title: 'Tariff', paragraphs: [`Tariff: ${money.tariffName ?? 'as pinned on the Tariff tab'}.`],
      tables: [table(['Year-1 bill (excl. VAT)', 'Value'], [
        ['Without solar', zar(b.beforeZar)], ['With PV only', zar(b.afterPvOnlyZar)],
        ['With PV and battery', zar(b.afterZar)], ['Export credit used', zar(b.exportCreditUsedZar)],
      ])],
    })
  }

  // 5. System design
  sections.push({
    title: 'System design',
    paragraphs: i.options.layoutSheetAttached ? ['The PV layout sheet is attached at the end of this report.'] : [],
    tables: [table(['Item', 'Value'], [
      ['DC capacity', kwp(k.dcKwp)], ['AC capacity', kw(k.acKw)],
      ['DC/AC ratio', k.acKw > 0 ? fixed(k.dcKwp / k.acKw, 2) : 'n/a'],
      ['Battery', k.batteryKwh === null ? 'None' : `${n1(k.batteryKwh)} kWh / ${kw(k.batteryKw ?? 0)}`],
      ['Performance ratio', pct(k.performanceRatio)],
    ])],
  })

  // 6. Yield
  sections.push({
    title: 'Yield', paragraphs: [],
    tables: [
      table(['Energy flow', 'kWh'], o.waterfall.map((w) => [w.label, fixed(w.kwh, 0)])),
      table(['Check', 'Status', 'Detail'], o.checks.map((c) => [c.label, c.status === 'n/a' ? 'Not applicable' : c.status.charAt(0).toUpperCase() + c.status.slice(1), c.detail]), 99),
    ],
  })

  // 7-8. Financials and sensitivity (money)
  if (money) {
    const c = money.capex
    const capexRows = Object.entries(c.byCategory)
      .filter(([, v]) => typeof v === 'number' && v !== 0)
      .map(([cat, v]) => [CAPEX_CATEGORY_LABELS[cat as keyof typeof CAPEX_CATEGORY_LABELS] ?? cat, zar(v as number)])
    capexRows.push(['Total (excl. VAT)', zar(c.exclVatZar)], ['VAT', zar(c.vatZar)], ['Total (incl. VAT)', zar(c.inclVatZar)],
      ['Cost per watt (DC)', c.zarPerWp === null ? 'n/a' : `R ${fixed(c.zarPerWp, 2)}/Wp`])
    const modelRows = money.finance.models.flatMap((m) => m.views.map((v) => [
      MODEL_LABELS[m.model] ?? m.model, v.view, zar(v.upfrontZar), zar(v.npvZar), pct(v.irr), years(v.simplePaybackYears), years(v.discountedPaybackYears),
    ]))
    const cf = firstView ? firstView.rows.map((r) => [String(r.year), zar(r.savingZar), zar(r.opexZar), zar(r.replacementZar), zar(r.financeZar), zar(r.taxZar), zar(r.netZar), zar(r.cumulativeZar)]) : []
    const ls = money.finance.loadShedding
    sections.push({
      title: 'Financials',
      paragraphs: [
        `LCOE ${money.finance.lcoeZarPerKwh === null ? 'n/a' : `R ${fixed(money.finance.lcoeZarPerKwh, 2)}/kWh`}.`,
        ...(ls ? [`Load-shedding value (NPV ${zar(ls.npvZar)}) is reported separately and not included in any cashflow or IRR.`] : []),
      ],
      tables: [
        table(['Capex', 'Amount'], capexRows),
        table(['Model', 'View', 'Upfront', 'NPV', 'IRR', 'Simple payback', 'Discounted payback'], modelRows, 2),
        table(['Year', 'Saving', 'Opex', 'Replacements', 'Finance', 'Tax', 'Net', 'Cumulative'], cf),
      ],
    })
    sections.push({
      title: 'Sensitivity',
      paragraphs: [`NPV of the ${MODEL_LABELS[money.tornado.model] ?? money.tornado.model} (${money.tornado.view}) case at plus or minus ${fixed(money.tornado.swing * 100, 0)} % of each input. Base NPV ${zar(money.tornado.baseNpvZar)}.`],
      tables: [table(['Input', 'NPV low', 'NPV high', 'Spread'], money.tornado.bars.map((b) => [TORNADO_LABELS[b.variable] ?? b.variable, zar(b.lowNpvZar), zar(b.highNpvZar), zar(b.spreadZar)]))],
    })
  }

  // 9. Assumptions and provenance
  const p = o.provenance
  sections.push({
    title: 'Assumptions and provenance',
    paragraphs: i.options.include8760
      ? [`Hourly data (8 760 rows) for run ${i.run.id} is available as CSV from Yield and Scenarios, Export hourly.`]
      : [],
    tables: [table(['Item', 'Value'], [
      ['Case', i.caseName], ['Run', i.run.id], ['Run completed', isoDate(i.run.finishedAt)],
      ['Engine version', p.engineVersion], ['Inputs hash', p.inputsHash],
      ['Weather', `${p.weatherSource}${p.weatherFetchedAt ? `, fetched ${isoDate(p.weatherFetchedAt)}` : ''}`],
      ['Global Solar Atlas PVOUT', p.gsaPvoutKwhPerKwp === null ? 'n/a' : `${fixed(p.gsaPvoutKwhPerKwp, 0)} kWh/kWp`],
      ...(money && p.tariffRef ? [['Tariff', `${p.tariffRef.tariffName} (${p.tariffRef.licenseeName}, ${p.tariffRef.financialYear})`]] : []),
      ['Report generated', isoDate(i.generatedAt)],
    ], 99)],
  })

  // 10. Disclaimers
  sections.push({ title: 'Disclaimers', paragraphs: [REPORT_DISCLAIMER_BASE, ...(i.disclaimer.trim() ? [i.disclaimer.trim()] : [])], tables: [] })

  const summary: Record<string, number | string> = { kwp: Math.round(k.dcKwp * 10) / 10, mwhYear1: Math.round(k.annualAcKwh / 100) / 10 }
  if (money) {
    summary.saving = zar(money.year1Bills.beforeZar - money.year1Bills.afterZar)
    summary.irrPct = firstView?.irr == null ? 'n/a' : Math.round(firstView.irr * 1000) / 10
  }
  summary.runId = i.run.id
  return {
    kind: i.kind,
    title: i.kind === 'feasibility' ? 'Solar PV feasibility report' : 'Solar PV technical report',
    kicker: i.kind === 'feasibility' ? 'SOLAR FEASIBILITY' : 'SOLAR TECHNICAL',
    sections, summary,
  }
}
```

(The `Tariff` row inside provenance is money-gated because a tariff name next to bill figures is commercial; the technical report names neither.)

- [ ] **Step 3: Barrel** `export * from './report-model'`; **Run — PASS; commit** ("feat(solar): feasibility and technical report model from the stored run").

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter @esite/shared test -- src/solar/reports 2>&1 | tail -4
git add packages/shared/src/solar/reports && git commit -m "feat(solar): feasibility and technical report model from the stored run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Proposal status, Reports readiness rule, activity verbs

**Files:**
- Create: `packages/shared/src/solar/reports/proposal-status.ts`, `proposal-status.test.ts`
- Modify: `packages/shared/src/solar/reports/index.ts`
- Modify: `packages/shared/src/solar/readiness.ts` (+ `readiness.test.ts`)
- Modify: `packages/shared/src/solar/activity.ts` (+ `activity.test.ts`)

- [ ] **Step 1: Failing tests.**

`proposal-status.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { effectiveProposalStatus, proposalControls, PROPOSAL_STATUS_LABELS } from './proposal-status'

const NOW = Date.parse('2026-09-29T12:00:00Z')

describe('effectiveProposalStatus (mirrors solar.proposal_effective_status)', () => {
  it('derives expired only for a live proposal past its expiry', () => {
    expect(effectiveProposalStatus('issued', '2026-09-29T11:59:59Z', NOW)).toBe('expired')
    expect(effectiveProposalStatus('viewed', '2026-09-29T12:00:00Z', NOW)).toBe('expired')
    expect(effectiveProposalStatus('viewed', '2026-10-01T00:00:00Z', NOW)).toBe('viewed')
    expect(effectiveProposalStatus('accepted', '2026-01-01T00:00:00Z', NOW)).toBe('accepted')
    expect(effectiveProposalStatus('draft', null, NOW)).toBe('draft')
  })
  it('has a label for every status', () => {
    expect(Object.keys(PROPOSAL_STATUS_LABELS).sort()).toEqual(['accepted', 'declined', 'draft', 'expired', 'issued', 'viewed', 'withdrawn'])
  })
})

describe('proposalControls', () => {
  const base = { status: 'issued' as const, expiresAt: '2026-10-29T00:00:00Z', isLatest: true, familyHasDraft: false, familyHasAccepted: false }
  it('draft: edit, preview, issue, delete', () => {
    expect(proposalControls({ ...base, status: 'draft', expiresAt: null }, NOW)).toEqual({ canEdit: true, canIssue: true, canDelete: true, canWithdraw: false, canRotate: false, canRevise: false })
  })
  it('issued: withdraw, new link, revise', () => {
    expect(proposalControls(base, NOW)).toEqual({ canEdit: false, canIssue: false, canDelete: false, canWithdraw: true, canRotate: true, canRevise: true })
  })
  it('expired: withdraw and revise, but no new link', () => {
    expect(proposalControls({ ...base, expiresAt: '2026-09-01T00:00:00Z' }, NOW)).toMatchObject({ canWithdraw: true, canRotate: false, canRevise: true })
  })
  it('no revise when a draft exists, an accepted version exists, or this is not the latest version', () => {
    expect(proposalControls({ ...base, familyHasDraft: true }, NOW).canRevise).toBe(false)
    expect(proposalControls({ ...base, familyHasAccepted: true }, NOW).canRevise).toBe(false)
    expect(proposalControls({ ...base, isLatest: false }, NOW).canRevise).toBe(false)
  })
  it('accepted / declined / withdrawn: read only (revise allowed after decline or withdraw)', () => {
    expect(proposalControls({ ...base, status: 'accepted', familyHasAccepted: true }, NOW)).toEqual({ canEdit: false, canIssue: false, canDelete: false, canWithdraw: false, canRotate: false, canRevise: false })
    expect(proposalControls({ ...base, status: 'declined' }, NOW).canRevise).toBe(true)
    expect(proposalControls({ ...base, status: 'withdrawn' }, NOW).canWithdraw).toBe(false)
  })
})
```

Append to `packages/shared/src/solar/readiness.test.ts`:
```ts
describe('Reports readiness (Phase 6)', () => {
  it('Reports & Proposal is a built tab', () => {
    expect(SOLAR_TABS.find((t) => t.slug === 'reports')?.built).toBe(true)
  })
  it('green only when a feasibility report exists for the selected case’s current run', () => {
    expect(reportsReadiness({ hasCurrentFeasibility: true })).toEqual({ status: 'green', reason: 'A feasibility report exists for the selected case’s current run' })
    expect(reportsReadiness({ hasCurrentFeasibility: false }).status).toBe('grey')
    expect(reportsReadiness(null)).toEqual({ status: 'grey', reason: 'Feasibility reports need Edit + financials access' })
  })
  it('computeSolarReadiness makes the Reports step live', () => {
    const steps = computeSolarReadiness(null, 'edit_financials', { reports: { hasCurrentFeasibility: true } })
    expect(steps.find((s) => s.slug === 'reports')).toMatchObject({ live: true, status: 'green' })
  })
})
```
(Add `reportsReadiness` and, if not already imported, `SOLAR_TABS` to that file's import from `./readiness`.)

Append to `packages/shared/src/solar/activity.test.ts`:
```ts
describe('report and proposal verbs (Phase 6)', () => {
  it('describes each and links to the Reports tab', () => {
    expect(describeSolarAuditEvent('report_generated', { kind: 'feasibility', version: 3 })).toEqual({ text: 'Feasibility report v3 generated', target: 'reports' })
    expect(describeSolarAuditEvent('proposal_issued', { version: 2 })).toEqual({ text: 'Proposal v2 issued', target: 'reports' })
    expect(describeSolarAuditEvent('proposal_accepted', { version: 2 })).toEqual({ text: 'Proposal v2 accepted by the client', target: 'reports' })
    expect(describeSolarAuditEvent('proposal_declined', { version: 1 })).toEqual({ text: 'Proposal v1 declined by the client', target: 'reports' })
    expect(describeSolarAuditEvent('proposal_withdrawn', { version: 1 }).target).toBe('reports')
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement.**

`proposal-status.ts`:
```ts
/** Proposal status chip (functional spec §9.3) — server-set; `expired` is derived (00217 mirrors this). */
export type ProposalStatus = 'draft' | 'issued' | 'viewed' | 'accepted' | 'declined' | 'withdrawn'
export type EffectiveProposalStatus = ProposalStatus | 'expired'

export const PROPOSAL_STATUS_LABELS: Record<EffectiveProposalStatus, string> = {
  draft: 'Draft', issued: 'Issued', viewed: 'Viewed', accepted: 'Accepted',
  declined: 'Declined', expired: 'Expired', withdrawn: 'Withdrawn',
}

export function effectiveProposalStatus(status: ProposalStatus, expiresAt: string | null, now: number): EffectiveProposalStatus {
  if ((status === 'issued' || status === 'viewed') && expiresAt !== null && Date.parse(expiresAt) <= now) return 'expired'
  return status
}

export interface ProposalControlInput {
  status: ProposalStatus
  expiresAt: string | null
  /** This row is the highest version of its family. */
  isLatest: boolean
  familyHasDraft: boolean
  familyHasAccepted: boolean
}
export interface ProposalControls {
  canEdit: boolean; canIssue: boolean; canDelete: boolean
  canWithdraw: boolean; canRotate: boolean; canRevise: boolean
}

export function proposalControls(p: ProposalControlInput, now: number): ProposalControls {
  const eff = effectiveProposalStatus(p.status, p.expiresAt, now)
  const draft = p.status === 'draft'
  return {
    canEdit: draft, canIssue: draft, canDelete: draft,
    canWithdraw: p.status === 'issued' || p.status === 'viewed',
    canRotate: eff === 'issued' || eff === 'viewed',
    canRevise: !draft && p.status !== 'accepted' && p.isLatest && !p.familyHasDraft && !p.familyHasAccepted,
  }
}
```

In `packages/shared/src/solar/readiness.ts`:
1. Change the `reports` row of `SOLAR_TABS` to `built: true`.
2. Add after `financialsReadiness` (4b):
```ts
export function reportsReadiness(r: { hasCurrentFeasibility: boolean } | null): { status: ReadinessStatus; reason: string } {
  if (!r) return { status: 'grey', reason: 'Feasibility reports need Edit + financials access' }
  return r.hasCurrentFeasibility
    ? { status: 'green', reason: 'A feasibility report exists for the selected case’s current run' }
    : { status: 'grey', reason: 'No feasibility report for the selected case’s current run yet' }
}
```
3. Add to `SolarReadinessExtra`:
```ts
  /** Null (or absent) for callers below Edit + financials, who cannot see feasibility reports. */
  reports?: { hasCurrentFeasibility: boolean } | null
```
4. In `computeSolarReadiness`, immediately after the `financials` line, add:
```ts
      if (t.slug === 'reports') return { slug: t.slug, label: t.label, live: true, ...reportsReadiness(extra.reports ?? null) }
```

In `packages/shared/src/solar/activity.ts`: add `'reports'` to the `SolarActivityTarget` union (keep every existing member), and add before `default:`:
```ts
    case 'report_generated': {
      const kind = ref.kind === 'feasibility' ? 'Feasibility' : ref.kind === 'technical' ? 'Technical' : 'Solar'
      return { text: `${kind} report v${Number(ref.version ?? 1)} generated`, target: 'reports' }
    }
    case 'proposal_created':
      return { text: `Proposal v${Number(ref.version ?? 1)} drafted`, target: 'reports' }
    case 'proposal_issued':
      return { text: `Proposal v${Number(ref.version ?? 1)} issued`, target: 'reports' }
    case 'proposal_withdrawn':
      return { text: `Proposal v${Number(ref.version ?? 1)} withdrawn`, target: 'reports' }
    case 'proposal_link_rotated':
      return { text: `Proposal v${Number(ref.version ?? 1)}: new client link`, target: 'reports' }
    case 'proposal_accepted':
      return { text: `Proposal v${Number(ref.version ?? 1)} accepted by the client`, target: 'reports' }
    case 'proposal_declined':
      return { text: `Proposal v${Number(ref.version ?? 1)} declined by the client`, target: 'reports' }
```

`index.ts`: append `export * from './proposal-status'`.

- [ ] **Step 3: Fix any old expectation that assumed Reports was unbuilt.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
git grep -n -E "reports" -- packages/shared/src/solar/readiness.test.ts 'apps/web/src/app/(admin)/projects/[id]/solar/_components/*.test.tsx' 'apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.test.tsx'
```
For each hit expecting the `reports` tab `built: false` / `live: false` / "Not started — available in a later phase", change it to the live expectation. Change nothing else.

- [ ] **Step 4: Run shared + web — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter @esite/shared test 2>&1 | tail -3
pnpm --filter web test -- 'src/app/(admin)/projects/[id]/solar' 2>&1 | tail -3
git add packages/shared/src/solar && git commit -m "feat(solar): proposal status, Reports readiness and activity verbs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Note: the tab bar now links `/solar/reports`, which 404s until Task 25. Acceptable mid-branch.
