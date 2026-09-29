// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildMonthlySnapshot, monthlyReportModel, performanceRows, sourceRows, yearToDate } from '@esite/shared/solar-operations'
import { isWinAnsi } from '@/lib/pdf/winansi'
import { extractPdfText, squash } from '@/test/pdf-text'
import { solarBranding } from '@/lib/solar/reports/branding'
import { renderMonthlyReport } from './render-monthly'

const baseline = {
  version: 1 as const, caseRunId: 'run-1', inputsHash: 'a'.repeat(64), dcKwp: 100, acKw: 80, performanceRatio: 0.8,
  monthlyKwh: new Array(12).fill(1000), diurnalKw: Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, h) => (h >= 10 && h < 14 ? 5 : 0))), ghiKwhM2: null,
}
const guarantee = { basis: 'p50' as const, pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0 }
const rows = performanceRows({ months: ['2026-02', '2026-03'], baseline, guarantee, commissioningDate: '2026-02-15', dcKwp: 100,
  actual: { '2026-02': { kwh: 450, coverageMinutes: 20160 }, '2026-03': { kwh: 900, coverageMinutes: 44640 } }, generationMeterCount: 1, downtime: [], irradiation: [] })
const snapshot = (hostile: boolean) => buildMonthlySnapshot({
  period: '2026-03', generatedAt: '2026-04-02T08:00:00.000Z', projectName: hostile ? 'Mall → North ≤ Ω ✓' : 'Acme Mall', commissioningDate: '2026-02-15',
  asBuilt: { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0,
    equipment: [{ kind: 'module', make: hostile ? 'Acme Ω' : 'Acme', model: 'M-550', rating: 550, unit: 'W', quantity: 182 }, { kind: 'inverter', make: 'Volt', model: 'I-80', rating: 80, unit: 'kW', quantity: 1 }] },
  baseline, guarantee, performance: rows[1]!,
  sources: sourceRows([{ meterId: 'm1', label: 'PV main', sharePct: null }], { m1: { '2026-03': { kwh: 900, n: 1488, minutes: 44640, intervalMin: 30 } } }, '2026-03', rows[1]!.guaranteeKwh),
  downtime: [{ startsAt: '2026-03-10T09:00:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', cause: 'inverter_fault', description: hostile ? 'Trip ✓ → reset' : 'Trip',
    excludedFromGuarantee: false, source: 'detected', lostKwh: 16.13, lostZar: 42.5 }],
  lostZarTotal: 42.5, tariff: { name: 'Business 1 (City of Tshwane, 2026/27)' }, ytd: yearToDate(rows, '2026-03'),
  consumption: { gridKwh: 12000, meterLabels: ['Council main'] },
  notes: { summary: hostile ? 'Good ≥ plan ✓' : 'Good', actions: 'Replace fuse' },
})
const brand = solarBranding({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall' },
  { title: 'Solar monthly report', kicker: 'SOLAR MONTHLY REPORT', date: '2026-04-02' }).branding

describe('renderMonthlyReport (real render, decoded content streams)', () => {
  it('prints every section, the real YTD, the equipment from the record and the lost revenue', async () => {
    const text = squash(extractPdfText(await renderMonthlyReport(monthlyReportModel(snapshot(false)), brand)))
    for (const t of ['Performance summary', 'Expected vs actual per source', 'Year to date', 'Downtime', 'Realised consumption', 'Installed equipment', 'Commentary and actions', 'Basis of figures']) {
      expect(text).toContain(squash(t))
    }
    expect(text).toContain(squash('1 350'))
    expect(text).toContain(squash('M-550'))
    expect(text).toContain(squash('R 43'))
    expect(text).not.toMatch(/\[MODULE|PLACEHOLDER|Tie-In/)
  }, 30_000)
  it('no glyph outside WinAnsi reaches the PDF; hostile ones are spelled out', async () => {
    const text = extractPdfText(await renderMonthlyReport(monthlyReportModel(snapshot(true)), brand))
    expect([...text].filter((c) => c !== '\n' && !isWinAnsi(c))).toEqual([])
    expect(squash(text)).toContain(squash('Acme Ohm'))
    expect(squash(text)).toContain(squash('Trip Yes -> reset'))
    expect(squash(text)).toContain(squash('Good >= plan Yes'))
    expect(text).not.toContain('©')
  }, 30_000)
})
