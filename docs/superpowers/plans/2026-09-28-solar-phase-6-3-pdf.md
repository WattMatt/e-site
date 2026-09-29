# Solar Phase 6 — Part 3: PDF rendering (glyph-safe, neutral branding)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-09-28-solar-phase-6-0-index.md` first.

**The lesson this part is built around (PR #154 / #167):** react-pdf never throws on a glyph outside WinAnsi — it silently prints a different one (`Ω`→`©`, `≤`→`d`, `✓` vanishes). "The PDF rendered" proves nothing. Every test below renders the REAL document, inflates the content streams, decodes them as WinAnsi (not latin1 — latin1 made the old assertions vacuous) and asserts on the characters.

---

### Task 11: PDF text sanitiser + a WinAnsi-aware test extractor

**Files:**
- Create: `apps/web/src/lib/solar/reports/pdf-text.ts`, `pdf-text.test.ts`
- Create: `apps/web/src/test/pdf-text.ts`

- [ ] **Step 1: Failing test** `apps/web/src/lib/solar/reports/pdf-text.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isWinAnsiSafe } from '@/lib/pdf/winansi'
import { pdfText } from './pdf-text'

describe('pdfText (react-pdf path)', () => {
  it('spells out the symbols react-pdf would silently corrupt', () => {
    expect(pdfText('Rinsul ≤ 0,2 Ω ✓ → next ✗')).toBe('Rinsul <= 0,2 Ohm Yes -> next No')
  })
  it('keeps WinAnsi-safe punctuation and units untouched', () => {
    expect(pdfText('500 kWp · 12 m² · 25 °C — “quoted”')).toBe('500 kWp · 12 m² · 25 °C — “quoted”')
  })
  it('keeps newlines (react-pdf line-breaks natively; collapsing them is a pdf-lib rule)', () => {
    expect(pdfText('line 1\nline 2')).toBe('line 1\nline 2')
  })
  it('always returns WinAnsi-safe text, and is idempotent', () => {
    const hostile = 'Δ√≈ ✔✘ 漢字 😀 ≥'
    expect(isWinAnsiSafe(pdfText(hostile).replace(/\n/g, ''))).toBe(true)
    expect(pdfText(pdfText(hostile))).toBe(pdfText(hostile))
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `apps/web/src/lib/solar/reports/pdf-text.ts`:

```ts
/**
 * Every string drawn into a Solar PDF goes through here (spec §0.4 rule 7). winAnsiSafe maps
 * Ω, ≤, →, etc.; ✓ and ✗ have no ASCII reading there (they become "?"), so they are spelled out
 * first. collapseWhitespace:false because react-pdf line-breaks on "\n" natively — collapsing is a
 * pdf-lib constraint, and applying it here would flatten every multi-line field.
 */
import { winAnsiSafe } from '@/lib/pdf/winansi'

const SPELLED: Record<string, string> = { '✓': 'Yes', '✔': 'Yes', '✗': 'No', '✘': 'No' }

export function pdfText(s: string): string {
  return winAnsiSafe(s.replace(/[✓✔✗✘]/g, (c) => SPELLED[c]!), { collapseWhitespace: false })
}
```

- [ ] **Step 3: Create the shared test extractor** `apps/web/src/test/pdf-text.ts` (lifted from `equipment-materials-report.render.test.ts`, which proved it against real output):

```ts
/**
 * Test helper: the text of a react-pdf PDF, read from its content streams and decoded as WinAnsi
 * (NOT latin1 — latin1 mangles 0x80–0x9F and made assertions on real punctuation pass vacuously,
 * the PR #161 finding). Only for tests; tests using it need `// @vitest-environment node`.
 */
import zlib from 'node:zlib'

const WINANSI_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
}

function fromWinAnsi(bytes: Buffer): string {
  let out = ''
  for (const b of bytes) out += WINANSI_HIGH[b] ?? String.fromCharCode(b)
  return out
}

export function extractPdfText(buf: Buffer): string {
  let text = ''
  const streamMarker = Buffer.from('stream')
  const endMarker = Buffer.from('endstream')
  let cursor = 0
  for (;;) {
    const start = buf.indexOf(streamMarker, cursor)
    if (start === -1) break
    const end = buf.indexOf(endMarker, start)
    if (end === -1) break
    let dataStart = start + streamMarker.length
    while (buf[dataStart] === 0x0d || buf[dataStart] === 0x0a) dataStart++
    const chunk = buf.subarray(dataStart, end)
    let decoded: string
    try {
      decoded = zlib.inflateSync(chunk).toString('latin1')
    } catch {
      decoded = chunk.toString('latin1')
    }
    for (const m of decoded.matchAll(/<([0-9a-fA-F]+)>/g)) text += fromWinAnsi(Buffer.from(m[1]!, 'hex'))
    cursor = end + endMarker.length
  }
  return text
}

/** Whitespace-free comparison form: a wrapped line drops its break space, so compare without spaces. */
export const squash = (s: string) => s.replace(/\s+/g, '')
```

- [ ] **Step 4: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/lib/solar/reports/pdf-text.test.ts 2>&1 | tail -4
git add apps/web/src/lib/solar/reports/pdf-text.ts apps/web/src/lib/solar/reports/pdf-text.test.ts apps/web/src/test/pdf-text.ts
git commit -m "feat(solar): PDF text sanitiser and WinAnsi test extractor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Org branding with a neutral fallback (no WM anywhere)

**Files:**
- Create: `apps/web/src/lib/solar/reports/branding.ts`, `branding.test.ts`
- Create: `apps/web/src/lib/solar/reports/branding-loader.ts`

- [ ] **Step 1: Failing test** `branding.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { solarBranding, NEUTRAL_ACCENT, NO_BRANDING_WARNING } from './branding'

const data = { orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall' }
const meta = { title: 'Solar PV proposal', kicker: 'PROPOSAL', date: '2026-09-29' }

describe('solarBranding', () => {
  it('no branding: org name as wordmark, a NEUTRAL accent (never the E-Site amber) and a warning', () => {
    const r = solarBranding(data, meta)
    expect(r.branding.accent).toBe(NEUTRAL_ACCENT)
    expect(r.branding.accent.toUpperCase()).not.toBe('#E69500')
    expect(r.branding.issuer).toEqual({ wordmark: 'Sun Co' })
    expect(r.warning).toBe(NO_BRANDING_WARNING)
  })
  it('org accent and logo win; no warning', () => {
    const r = solarBranding({ ...data, orgAccent: '#0055AA', orgLogoDataUri: 'data:image/png;base64,AAAA' }, meta)
    expect(r.branding.accent.toLowerCase()).toBe('#0055aa')
    expect(r.branding.issuer).toEqual({ logoSrc: 'data:image/png;base64,AAAA' })
    expect(r.warning).toBeNull()
  })
  it('project accent beats org accent', () => {
    expect(solarBranding({ ...data, orgAccent: '#0055AA', projectAccent: '#AA5500' }, meta).branding.accent.toLowerCase()).toBe('#aa5500')
  })
  it('an unusable accent string falls back to NEUTRAL, not to the default amber', () => {
    expect(solarBranding({ ...data, orgAccent: 'not-a-colour' }, meta).branding.accent).toBe(NEUTRAL_ACCENT)
  })
  it('sanitises every drawn string', () => {
    const r = solarBranding({ ...data, orgName: 'Ω Power ✓', projectName: 'Mall → North' }, meta)
    expect(r.branding.issuer).toEqual({ wordmark: 'Ohm Power Yes' })
    expect(r.branding.projectLine).toBe('Mall -> North')
  })
})

describe('no hard-coded Watson Mattheus in Solar report code (spec §9.2)', () => {
  it('holds for every Solar report/proposal source file', () => {
    const SRC = path.resolve(__dirname, '../../..')
    const roots = ['lib/solar/reports', 'lib/solar/proposals', 'components/solar/proposal', 'app/(proposal)']
    const offenders: string[] = []
    for (const r of roots) {
      const dir = path.join(SRC, r)
      if (!fs.existsSync(dir)) continue
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name)
          if (e.isDirectory()) walk(f)
          else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && /watson|mattheus|wm consult|wmeng|#e69500/i.test(fs.readFileSync(f, 'utf8'))) offenders.push(path.relative(SRC, f))
        }
      }
      walk(dir)
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run — FAIL. Implement** `apps/web/src/lib/solar/reports/branding.ts`:

```ts
/**
 * Solar report branding (spec §9.2): the org's (or project's) logo and accent, else a NEUTRAL
 * template — the org name as wordmark and a slate accent — plus a warning. Never the E-Site/WM amber
 * that lib/reports/theme.ts uses as its own default. Pure: the loader is branding-loader.ts.
 */
import { resolveBranding, type ResolvedBranding } from '@/lib/reports/branding'
import { pdfText } from './pdf-text'

export const NEUTRAL_ACCENT = '#334155'
const HEX = /^#[0-9a-f]{6}$/i
export const NO_BRANDING_WARNING =
  'Your organisation has no report branding, so a neutral template was used. Add a logo and an accent colour under Settings, Branding.'

export interface SolarBrandingData {
  orgName: string
  orgLogoDataUri: string | null
  orgAccent: string | null
  projectAccent: string | null
  clientLogoDataUri: string | null
  projectName: string
}

export function solarBranding(
  d: SolarBrandingData,
  meta: { title: string; kicker: string; date: string },
): { branding: ResolvedBranding; warning: string | null } {
  const resolved = resolveBranding({
    org: { name: d.orgName, logoSrc: d.orgLogoDataUri, accent: d.orgAccent },
    project: { name: d.projectName, clientLogoSrc: d.clientLogoDataUri, accent: d.projectAccent },
    contractor: null,
    title: meta.title, kicker: meta.kicker, date: meta.date,
  })
  // resolveBranding falls back to the E-Site amber, so the accent is chosen here: the first VALID
  // supplied colour (project before org), else neutral.
  const chosen = [d.projectAccent, d.orgAccent].map((a) => a?.trim() ?? '').find((a) => HEX.test(a)) ?? null
  const accentIsSupplied = chosen !== null
  const branding: ResolvedBranding = {
    ...resolved,
    accent: chosen ?? NEUTRAL_ACCENT,
    issuer: resolved.issuer.wordmark !== undefined ? { wordmark: pdfText(resolved.issuer.wordmark) } : resolved.issuer,
    title: pdfText(resolved.title),
    kicker: pdfText(resolved.kicker),
    projectLine: pdfText(resolved.projectLine),
    footerStamp: pdfText(resolved.footerStamp),
  }
  const warning = !d.orgLogoDataUri && !accentIsSupplied ? NO_BRANDING_WARNING : null
  return { branding, warning }
}
```

- [ ] **Step 3: Implement the loader** `apps/web/src/lib/solar/reports/branding-loader.ts` (same reads as the equipment report's gather, service client, called only AFTER the caller's gate):

```ts
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SolarBrandingData } from './branding'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const LOGO_BUCKET = 'report-logos'

async function toDataUri(svc: AnyClient, path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  try {
    const { data, error } = await svc.storage.from(LOGO_BUCKET).download(path)
    if (error || !data) return null
    const bytes = Buffer.from(await data.arrayBuffer())
    return `data:${data.type || 'image/png'};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

/** Branding inputs for a project. `svc` is the service client; the CALLER has already gated. */
export async function loadSolarBrandingData(svc: AnyClient, projectId: string): Promise<SolarBrandingData> {
  const { data: p } = await svc.schema('projects').from('projects')
    .select('name, organisation_id, client_logo_url, report_accent_color').eq('id', projectId).maybeSingle()
  const proj = (p ?? {}) as { name?: string; organisation_id?: string; client_logo_url?: string | null; report_accent_color?: string | null }
  const { data: o } = proj.organisation_id
    ? await svc.from('organisations').select('name, logo_url, report_accent_color').eq('id', proj.organisation_id).maybeSingle()
    : { data: null }
  const org = (o ?? {}) as { name?: string; logo_url?: string | null; report_accent_color?: string | null }
  const [orgLogoDataUri, clientLogoDataUri] = await Promise.all([toDataUri(svc, org.logo_url), toDataUri(svc, proj.client_logo_url)])
  return {
    orgName: org.name?.trim() || 'Organisation',
    orgLogoDataUri, clientLogoDataUri,
    orgAccent: org.report_accent_color ?? null,
    projectAccent: proj.report_accent_color ?? null,
    projectName: proj.name ?? '',
  }
}
```

- [ ] **Step 4: Run — PASS; commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/lib/solar/reports/branding.test.ts 2>&1 | tail -4
git add apps/web/src/lib/solar/reports/branding.ts apps/web/src/lib/solar/reports/branding.test.ts apps/web/src/lib/solar/reports/branding-loader.ts
git commit -m "feat(solar): org branding with a neutral fallback for Solar reports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Feasibility / technical PDF document

**Files:**
- Create: `apps/web/src/lib/solar/reports/report-document.tsx`
- Create: `apps/web/src/lib/solar/reports/render-report.ts`, `render-report.render.test.ts`

- [ ] **Step 1: Failing test** `render-report.render.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { CaseRunOutputs } from '@esite/shared/solar-cases'
import { buildSolarReportModel, type SolarReportInput } from '@esite/shared/solar-reports'
import { isWinAnsi } from '@/lib/pdf/winansi'
import { extractPdfText, squash } from '@/test/pdf-text'
import { solarBranding } from './branding'
import { renderSolarReport } from './render-report'

const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, pvKwh: 70_000, loadKwh: 120_000, importBeforeKwh: 120_000, importKwh: 60_000, exportKwh: 10_000, maxDemandBeforeKw: 400, maxDemandAfterKw: 350, touImportBefore: null, touImportAfter: null }))
const outputs = {
  version: 1,
  kpis: { dcKwp: 500, acKw: 400, specificYieldKwhPerKwp: 1690, performanceRatio: 0.81, annualAcKwh: 845_000, pvAcKwh: 845_000, deliveredKwh: 840_000, selfConsumedKwh: 700_000, exportKwh: 140_000, curtailedKwh: 5_000, loadKwh: 1_440_000, importBeforeKwh: 1_440_000, importAfterKwh: 740_000, solarFraction: 0.486, selfConsumption: 0.834, peakDemandBeforeKw: 420, peakDemandAfterKw: 380, peakDemandBasis: 'hourly', batteryKwh: null, batteryKw: null },
  monthly, typicalDays: [], daily: [],
  waterfall: [{ key: 'ac', label: 'AC energy', kwh: 845_000, kind: 'end' }],
  checks: [{ id: 'dc_ac_ratio', label: 'DC/AC ratio ≤ 1.3 ✓', status: 'pass', detail: 'Ω check → ok' }],
  provenance: { engineVersion: '0.1.0', inputsHash: 'a'.repeat(64), weatherDatasetId: 'w1', weatherSource: 'PVGIS TMY', weatherFetchedAt: null, gsaPvoutKwhPerKwp: null, tariffRef: null, loadBasis: 'metered', loadReferenceYear: 2025 },
} as unknown as CaseRunOutputs
const money = {
  capex: { exclVatZar: 1_000_000, vatZar: 150_000, inclVatZar: 1_150_000, zarPerWp: 2, inverterZar: 0, batteryZar: 0, qualifying12bZar: 0, byCategory: { modules: 1_000_000 } },
  year1Bills: { beforeZar: 1_000_000, afterZar: 600_000, afterPvOnlyZar: 600_000, exportCreditUsedZar: 0 },
  finance: { lcoeZarPerKwh: 0.95, loadShedding: null, models: [{ model: 'cash', views: [{ view: 'owner', upfrontZar: 1_000_000, npvZar: 2_000_000, irr: 0.21, simplePaybackYears: 2.6, discountedPaybackYears: 3.4, rows: [{ year: 1, energyKwh: 1, billBeforeZar: 0, billAfterZar: 0, savingZar: 400_000, opexZar: 80_000, replacementZar: 0, taxZar: 0, financeZar: 0, netZar: 320_000, cumulativeZar: -680_000 }] }] }] },
  tornado: { model: 'cash', view: 'owner', baseNpvZar: 2_000_000, swing: 0.2, bars: [], omitted: [] },
  tariffName: 'Business 1',
} as unknown as NonNullable<SolarReportInput['money']>
const input = (kind: 'feasibility' | 'technical'): SolarReportInput => ({
  kind, projectName: 'Acme Mall → North', address: null, caseName: 'Base ≤ Ω ✓',
  site: { latitude: -25.75, longitude: 28.19, licenseeName: 'City of Tshwane', nmdKva: 800, exportMode: 'net_billing', exportLimitKw: null },
  run: { id: 'r1', finishedAt: '2026-09-28T10:00:00.000Z', outputs },
  money: kind === 'feasibility' ? money : null,
  options: { layoutSheetAttached: false, include8760: false },
  disclaimer: 'Org disclaimer ✓', generatedAt: '2026-09-29T08:00:00.000Z',
})
const brand = solarBranding({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall → North' }, { title: 'Solar PV feasibility report', kicker: 'SOLAR FEASIBILITY', date: '2026-09-29' }).branding

describe('renderSolarReport (real render, decoded content streams)', () => {
  it('feasibility: every section heading and the headline money figures are printed', async () => {
    const text = extractPdfText(await renderSolarReport(buildSolarReportModel(input('feasibility')), brand))
    for (const t of ['Executive summary', 'Load analysis', 'Tariff', 'Financials', 'Sensitivity', 'Disclaimers']) expect(squash(text)).toContain(squash(t))
    expect(squash(text)).toContain(squash('R 400 000'))
    expect(squash(text)).toContain(squash('21.0 %'))
  }, 30_000)

  it('no glyph outside WinAnsi reaches the PDF, and the hostile ones are spelled out', async () => {
    const text = extractPdfText(await renderSolarReport(buildSolarReportModel(input('feasibility')), brand))
    const bad = [...text].filter((c) => c !== '\n' && !isWinAnsi(c))
    expect(bad).toEqual([])
    expect(squash(text)).toContain(squash('Base <= Ohm Yes'))
    expect(squash(text)).toContain(squash('DC/AC ratio <= 1.3 Yes'))
    expect(squash(text)).toContain(squash('Ohm check -> ok'))
    expect(text).not.toContain('©')
  }, 30_000)

  it('technical: no rand value, no IRR/NPV, no tariff section', async () => {
    const text = extractPdfText(await renderSolarReport(buildSolarReportModel(input('technical')), brand))
    expect(squash(text)).toContain(squash('Load analysis'))
    for (const banned of ['R400000', 'R1000000', 'IRR', 'NPV', 'Tariff']) expect(squash(text)).not.toContain(banned)
  }, 30_000)
})
```

- [ ] **Step 2: Run — FAIL. Implement** `apps/web/src/lib/solar/reports/report-document.tsx`:

```tsx
/**
 * Solar feasibility / technical report (spec §9.1). Server-side react-pdf only (no 'use client').
 * Renders a SolarReportModel verbatim — every string through pdfText().
 */
import React from 'react'
import { Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { ResolvedBranding } from '@/lib/reports/branding'
import { Cover, Document, pageStyles } from '@/lib/reports/components'
import type { ReportTable, SolarReportModel } from '@esite/shared/solar-reports'
import { pdfText } from './pdf-text'

const s = StyleSheet.create({
  body: { paddingBottom: 40 },
  h2: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  p: { fontSize: 9, lineHeight: 1.4, marginBottom: 4, color: '#222222' },
  table: { marginTop: 4, marginBottom: 8, borderTopWidth: 0.5, borderTopColor: '#999999' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#DDDDDD' },
  head: { flexDirection: 'row', borderBottomWidth: 0.75, borderBottomColor: '#999999', backgroundColor: '#F4F5F7' },
  cell: { flex: 1, fontSize: 7.5, paddingVertical: 2.5, paddingHorizontal: 3 },
  cellHead: { flex: 1, fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 2.5, paddingHorizontal: 3 },
  num: { textAlign: 'right' },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#777777' },
})

function Table({ t, accent }: { t: ReportTable; accent: string }) {
  return (
    <View style={[s.table, { borderTopColor: accent }]}>
      <View style={s.head} fixed>
        {t.columns.map((c, i) => <Text key={i} style={[s.cellHead, t.numeric[i] ? s.num : {}]}>{pdfText(c)}</Text>)}
      </View>
      {t.rows.map((r, ri) => (
        <View key={ri} style={s.row} wrap={false}>
          {r.map((c, ci) => <Text key={ci} style={[s.cell, t.numeric[ci] ? s.num : {}]}>{pdfText(c)}</Text>)}
        </View>
      ))}
    </View>
  )
}

export function SolarReportDocument({ model, branding }: { model: SolarReportModel; branding: ResolvedBranding }) {
  return (
    <Document title={branding.title} producer="e-site.live">
      <Page size="A4" style={pageStyles.page}>
        <Cover resolved={branding} />
      </Page>
      <Page size="A4" style={pageStyles.page} wrap>
        <View style={s.body}>
          {model.sections.map((sec) => (
            <View key={sec.title}>
              <Text style={[s.h2, { color: branding.accent }]} minPresenceAhead={60}>{pdfText(sec.title)}</Text>
              {sec.paragraphs.map((p, i) => <Text key={i} style={s.p}>{pdfText(p)}</Text>)}
              {sec.tables.map((t, i) => <Table key={i} t={t} accent={branding.accent} />)}
            </View>
          ))}
        </View>
        <View style={s.footer} fixed>
          <Text>{branding.footerStamp}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
```

`apps/web/src/lib/solar/reports/render-report.ts`:
```ts
// Node-only: renderToBuffer is unavailable in the browser build. Tests use `// @vitest-environment node`.
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { ResolvedBranding } from '@/lib/reports/branding'
import type { SolarReportModel } from '@esite/shared/solar-reports'
import { SolarReportDocument } from './report-document'

export async function renderSolarReport(model: SolarReportModel, branding: ResolvedBranding): Promise<Buffer> {
  const el = React.createElement(SolarReportDocument, { model, branding }) as React.ReactElement<DocumentProps>
  return renderToBuffer(el)
}
```

- [ ] **Step 3: Run — PASS.** If the glyph test fails, find the string that bypassed `pdfText` (the failing character tells you which field) — never loosen the assertion.

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/lib/solar/reports/render-report.render.test.ts 2>&1 | tail -6
```

- [ ] **Step 4: Prove the glyph test can fail.** Temporarily change `pdfText(p)` in the paragraph line of `report-document.tsx` to `p`, re-run: the case-name paragraph must go red (a raw `≤`/`Ω` reaches the stream). Revert.

- [ ] **Step 5: Commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
git add apps/web/src/lib/solar/reports/report-document.tsx apps/web/src/lib/solar/reports/render-report.ts apps/web/src/lib/solar/reports/render-report.render.test.ts
git commit -m "feat(solar): feasibility and technical report PDF (glyph-safe)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Proposal PDF document — figures identical to the snapshot

**Files:**
- Create: `apps/web/src/lib/solar/reports/proposal-document.tsx`
- Create: `apps/web/src/lib/solar/reports/render-proposal.ts`, `render-proposal.render.test.ts`
- Create: `apps/web/src/test/proposal-fixture.ts` (shared by Tasks 14, 21, 23, 27)

- [ ] **Step 1: Create the fixture** `apps/web/src/test/proposal-fixture.ts`:

```ts
import { buildProposalSnapshot, offerPrice, type BuildSnapshotInput, type ProposalSnapshot } from '@esite/shared/solar-reports'
import { pdfText } from '@/lib/solar/reports/pdf-text'

export function proposalSnapshotInput(over: Partial<BuildSnapshotInput> = {}): BuildSnapshotInput {
  return {
    proposal: { id: 'p1', familyId: 'p1', version: 2, title: 'Rooftop PV for Acme → phase 1', issuedAt: '2026-09-29T08:00:00.000Z', validUntil: '2026-10-29T08:00:00.000Z' },
    issuer: { orgName: 'Sun Co', proposerName: 'Pat Proposer', proposerEmail: 'pat@sun.example' },
    project: { name: 'Acme Mall', address: '1 Main Rd, Pretoria' },
    case: { id: 'c1', name: 'Base', runId: 'r1', inputsHash: 'a'.repeat(64), engineVersion: '0.1.0', runFinishedAt: '2026-09-28T10:00:00.000Z' },
    kpis: { dcKwp: 500, acKw: 400, batteryKwh: 200, batteryKw: 100, annualAcKwh: 845_000, specificYieldKwhPerKwp: 1690, selfConsumption: 0.834, solarFraction: 0.581, exportKwh: 140_000 },
    price: offerPrice(1_000_000, 15),
    bills: { beforeZar: 1_000_000, afterZar: 600_000 },
    financeOptions: [
      { kind: 'cash', view: 'owner', upfrontZar: 1_150_000, year1NetZar: 390_000, lifetimeNetZar: 9_000_000, npvZar: 2_000_000, irr: 0.21, simplePaybackYears: 3.1, years: 25, terms: 'Paid upfront' },
      { kind: 'ppa', view: 'client', upfrontZar: 0, year1NetZar: 60_000, lifetimeNetZar: 2_500_000, npvZar: 500_000, irr: null, simplePaybackYears: null, years: 20, terms: 'R 1.45/kWh escalating 6.0 %/yr for 20 years' },
    ],
    draft: {
      clientName: 'Acme Retail (Pty) Ltd', marginPct: 15, validityDays: 30, financeOptions: ['cash', 'ppa'],
      summary: 'Insulation ≤ 0,2 Ω ✓', scope: 'Supply → install\nCommission', priceTerms: '40 % deposit', assumptions: 'Roof sound',
      inclusions: ['Monitoring ✓'], exclusions: ['Roof repairs'], terms: 'Standard terms', narrative: 'A narrative paragraph.',
    },
    disclaimer: 'Org disclaimer',
    provenance: { financeInputsHash: 'b'.repeat(64), tariff: null },
    ...over,
  }
}

/** The snapshot exactly as Issue stores it: sanitised with pdfText. */
export function proposalSnapshot(over: Partial<BuildSnapshotInput> = {}): ProposalSnapshot {
  return buildProposalSnapshot(proposalSnapshotInput(over), pdfText)
}
```

- [ ] **Step 2: Failing test** `render-proposal.render.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { financeOptionTable, keyFigures } from '@esite/shared/solar-reports'
import { isWinAnsi } from '@/lib/pdf/winansi'
import { extractPdfText, squash } from '@/test/pdf-text'
import { proposalSnapshot } from '@/test/proposal-fixture'
import { solarBranding } from './branding'
import { renderProposalPdf } from './render-proposal'

const brand = solarBranding({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall' },
  { title: 'Solar PV proposal', kicker: 'PROPOSAL', date: '2026-09-29' }).branding

describe('renderProposalPdf (real render, decoded content streams)', () => {
  it('prints EVERY key figure and finance-table cell exactly as the snapshot formats them', async () => {
    const snap = proposalSnapshot()
    const text = squash(extractPdfText(await renderProposalPdf(snap, brand, { preview: false })))
    for (const f of keyFigures(snap)) {
      expect(text).toContain(squash(f.label))
      expect(text).toContain(squash(f.value))
    }
    const t = financeOptionTable(snap)
    for (const c of [...t.columns, ...t.rows.flat()].filter(Boolean)) expect(text).toContain(squash(c))
  }, 30_000)

  it('no glyph outside WinAnsi; hostile text spelled out; margin and capex never printed', async () => {
    const raw = extractPdfText(await renderProposalPdf(proposalSnapshot(), brand, { preview: false }))
    expect([...raw].filter((c) => c !== '\n' && !isWinAnsi(c))).toEqual([])
    expect(squash(raw)).toContain(squash('Insulation <= 0,2 Ohm Yes'))
    expect(squash(raw)).toContain(squash('Rooftop PV for Acme -> phase 1'))
    expect(raw).not.toMatch(/margin/i)
    expect(squash(raw)).not.toContain('R1000000')
  }, 30_000)

  it('PREVIEW watermark only on a preview', async () => {
    const snap = proposalSnapshot()
    expect(extractPdfText(await renderProposalPdf(snap, brand, { preview: true }))).toContain('PREVIEW')
    expect(extractPdfText(await renderProposalPdf(snap, brand, { preview: false }))).not.toContain('PREVIEW')
  }, 30_000)
})
```

- [ ] **Step 3: Run — FAIL. Implement** `apps/web/src/lib/solar/reports/proposal-document.tsx`:

```tsx
/**
 * Client proposal PDF (spec §9.3). Renders a ProposalSnapshot ONLY, through keyFigures() and
 * financeOptionTable() — the same functions the client page uses — so the page and the PDF cannot
 * disagree (WM showed different assumptions in its portal and its PDF). Server-side only.
 */
import React from 'react'
import { Page, View, Text, StyleSheet } from '@react-pdf/renderer'
import type { ResolvedBranding } from '@/lib/reports/branding'
import { Cover, Document, Watermark, pageStyles } from '@/lib/reports/components'
import { financeOptionTable, isoDate, keyFigures, type ProposalSnapshot } from '@esite/shared/solar-reports'
import { pdfText } from './pdf-text'

const s = StyleSheet.create({
  body: { paddingBottom: 40 },
  h2: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  p: { fontSize: 9, lineHeight: 1.4, marginBottom: 4, color: '#222222' },
  bullet: { fontSize: 9, lineHeight: 1.4, marginLeft: 8, color: '#222222' },
  kv: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#DDDDDD', paddingVertical: 3 },
  k: { flex: 3, fontSize: 9, color: '#444444' },
  v: { flex: 2, fontSize: 9, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#DDDDDD' },
  cell: { flex: 1, fontSize: 7.5, paddingVertical: 2.5, paddingHorizontal: 3 },
  cellHead: { flex: 1, fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 2.5, paddingHorizontal: 3 },
  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: '#777777' },
})

function Para({ title, body, accent }: { title: string; body: string; accent: string }) {
  if (!body.trim()) return null
  return (
    <View>
      <Text style={[s.h2, { color: accent }]} minPresenceAhead={40}>{pdfText(title)}</Text>
      {body.split('\n').map((line, i) => <Text key={i} style={s.p}>{pdfText(line)}</Text>)}
    </View>
  )
}

function Bullets({ title, items, accent }: { title: string; items: string[]; accent: string }) {
  if (items.length === 0) return null
  return (
    <View>
      <Text style={[s.h2, { color: accent }]} minPresenceAhead={40}>{pdfText(title)}</Text>
      {items.map((it, i) => <Text key={i} style={s.bullet}>{`• ${pdfText(it)}`}</Text>)}
    </View>
  )
}

export function ProposalDocument({ snapshot, branding, preview }: { snapshot: ProposalSnapshot; branding: ResolvedBranding; preview: boolean }) {
  const a = branding.accent
  const t = financeOptionTable(snapshot)
  const x = snapshot.text
  return (
    <Document title={pdfText(snapshot.proposal.title)} producer="e-site.live">
      <Page size="A4" style={pageStyles.page}>
        {preview && <Watermark text="PREVIEW" />}
        <Cover resolved={branding} />
      </Page>
      <Page size="A4" style={pageStyles.page} wrap>
        {preview && <Watermark text="PREVIEW" />}
        <View style={s.body}>
          <Text style={[s.h2, { color: a }]}>{pdfText(snapshot.proposal.title)}</Text>
          <Text style={s.p}>{pdfText(`Prepared for ${snapshot.client.name} · ${snapshot.project.name}${snapshot.project.address ? `, ${snapshot.project.address}` : ''}`)}</Text>
          <Text style={s.p}>{pdfText(`Version ${snapshot.proposal.version} · issued ${isoDate(snapshot.proposal.issuedAt)} · valid until ${isoDate(snapshot.proposal.validUntil)}`)}</Text>

          <Text style={[s.h2, { color: a }]}>Key figures</Text>
          {keyFigures(snapshot).map((f) => (
            <View key={f.label} style={s.kv} wrap={false}>
              <Text style={s.k}>{pdfText(f.label)}</Text>
              <Text style={s.v}>{pdfText(f.value)}</Text>
            </View>
          ))}

          <Para title="Summary" body={x.summary} accent={a} />
          <Para title="About this proposal" body={x.narrative} accent={a} />
          <Para title="Scope" body={x.scope} accent={a} />
          <Bullets title="Included" items={x.inclusions} accent={a} />
          <Bullets title="Excluded" items={x.exclusions} accent={a} />

          <Text style={[s.h2, { color: a }]} minPresenceAhead={80}>Finance options</Text>
          <View style={[s.row, { borderBottomColor: '#999999' }]}>
            {t.columns.map((c, i) => <Text key={i} style={s.cellHead}>{pdfText(c)}</Text>)}
          </View>
          {t.rows.map((r, ri) => (
            <View key={ri} style={s.row} wrap={false}>
              {r.map((c, ci) => <Text key={ci} style={ci === 0 ? s.cellHead : s.cell}>{pdfText(c)}</Text>)}
            </View>
          ))}

          <Para title="Price and payment terms" body={x.priceTerms} accent={a} />
          <Para title="Assumptions" body={x.assumptions} accent={a} />
          <Para title="Terms and conditions" body={x.terms} accent={a} />
          <Para title="Disclaimer" body={x.disclaimer} accent={a} />
          <Text style={s.p}>{pdfText(`Contact: ${snapshot.issuer.proposerName}${snapshot.issuer.proposerEmail ? ` (${snapshot.issuer.proposerEmail})` : ''}, ${snapshot.issuer.orgName}.`)}</Text>
        </View>
        <View style={s.footer} fixed>
          <Text>{pdfText(`${snapshot.issuer.orgName} · proposal v${snapshot.proposal.version}`)}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
```

`apps/web/src/lib/solar/reports/render-proposal.ts`:
```ts
// Node-only: renderToBuffer is unavailable in the browser build.
import React from 'react'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { ResolvedBranding } from '@/lib/reports/branding'
import type { ProposalSnapshot } from '@esite/shared/solar-reports'
import { ProposalDocument } from './proposal-document'

export async function renderProposalPdf(snapshot: ProposalSnapshot, branding: ResolvedBranding, opts: { preview: boolean }): Promise<Buffer> {
  const el = React.createElement(ProposalDocument, { snapshot, branding, preview: opts.preview }) as React.ReactElement<DocumentProps>
  return renderToBuffer(el)
}
```

- [ ] **Step 4: Run — PASS.** Then prove the figure test can fail: temporarily change the value `<Text>` to `{pdfText(f.value.replace(/\d/, '9'))}`, re-run (red), revert.

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
pnpm --filter web test -- src/lib/solar/reports/render-proposal.render.test.ts 2>&1 | tail -6
```

- [ ] **Step 5: Commit.**

```bash
cd /Users/spud/.config/superpowers/worktrees/esite/solar-phase-6
git add apps/web/src/lib/solar/reports/proposal-document.tsx apps/web/src/lib/solar/reports/render-proposal.ts apps/web/src/lib/solar/reports/render-proposal.render.test.ts apps/web/src/test/proposal-fixture.ts
git commit -m "feat(solar): proposal PDF from the frozen snapshot (figures and glyphs asserted)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
