// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { TENANT_LEGEND, SCHEMATIC_LEGEND } from '@esite/shared/status-plans'
import { squash } from '@/test/pdf-text'
import { drawnText } from '@/test/pdf-ops'
import { appendStatusPlansToReport } from './appendix'
import { A3_LANDSCAPE, type StatusPlanRenderInput } from './render-plan-page'
import type { PlanRenderLoadResult } from './plan-render-data'

const A4: [number, number] = [595.28, 841.89]

async function report(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const f = await d.embedFont(StandardFonts.Helvetica)
  for (const n of [1, 2]) d.addPage(A4).drawText(`REPORT PAGE ${n}`, { x: 40, y: 800, size: 12, font: f })
  return d.save()
}
async function drawing(): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  d.addPage([600, 400]).drawRectangle({ x: 10, y: 10, width: 20, height: 20, color: rgb(0, 0, 1) })
  return d.save()
}
function plan(id: string, name: string, purpose: StatusPlanRenderInput['purpose'], bytes: Uint8Array): StatusPlanRenderInput {
  return {
    planId: id, planName: name, purpose, drawingName: 'Drawing', pageIndex: 1, generatedOn: '2026-10-09',
    source: { kind: 'pdf', bytes, pageIndex: 1 }, shapes: [], counts: {}, measured: null, warnings: [],
    legend: purpose === 'tenant_layout' ? TENANT_LEGEND : SCHEMATIC_LEGEND,
  }
}
async function pageText(bytes: Uint8Array, i: number): Promise<string> {
  const src = await PDFDocument.load(bytes)
  const one = await PDFDocument.create()
  const [p] = await one.copyPages(src, [i])
  one.addPage(p!)
  return squash(drawnText(await one.save()))
}
async function sizes(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())])
}

describe('appendStatusPlansToReport', () => {
  it('nothing to append → the report bytes untouched', async () => {
    const base = await report()
    expect(await appendStatusPlansToReport(base, { inputs: [], omitted: [] }, '2026-10-09')).toBe(base)
  })

  it('report pages, then the divider, then one A3 page per plan in the given order', async () => {
    const src = await drawing()
    const load: PlanRenderLoadResult = {
      inputs: [plan('a', 'Alpha tenants', 'tenant_layout', src), plan('b', 'Bravo schematic', 'distribution_schematic', src)],
      omitted: [{ title: 'Charlie (Tenant layout, page 1)', reason: 'the drawing file could not be read (Object not found)' }],
    }
    const out = await appendStatusPlansToReport(await report(), load, '2026-10-09')
    const a3 = [Math.round(A3_LANDSCAPE[0]), Math.round(A3_LANDSCAPE[1])]
    expect(await sizes(out)).toEqual([[595, 842], [595, 842], [595, 842], a3, a3])
    expect(await pageText(out, 0)).toContain('REPORTPAGE1')
    const divider = await pageText(out, 2)
    expect(divider).toContain('Appendix—Tenantstatusplans')
    expect(divider.indexOf('Alphatenants')).toBeLessThan(divider.indexOf('Bravoschematic'))
    expect(divider).toContain('Charlie')
    expect(divider).toContain('couldnotberead(Objectnotfound)')
    expect(await pageText(out, 3)).toContain('Alphatenants')
    expect(await pageText(out, 4)).toContain('Bravoschematic')
  })

  it('a drawing that fails to embed gets no page and is listed with its reason', async () => {
    const load: PlanRenderLoadResult = {
      inputs: [plan('a', 'Alpha', 'tenant_layout', new TextEncoder().encode('not a pdf')), plan('b', 'Bravo', 'tenant_layout', await drawing())],
      omitted: [],
    }
    const out = await appendStatusPlansToReport(await report(), load, '2026-10-09')
    expect((await sizes(out)).length).toBe(4) // 2 report + divider + Bravo
    const divider = await pageText(out, 2)
    expect(divider).toContain('Alpha')
    expect(divider).toContain('thedrawingPDFcouldnotberead')
    expect(await pageText(out, 3)).toContain('Bravo')
  })

  it('three plans on one drawing carry the drawing ~once, not three times', async () => {
    const d = await PDFDocument.create()
    const p = d.addPage([2000, 1400])
    p.setRotation(degrees(90))
    let seed = 3
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let k = 0; k < 20; k++) {
      let path = `M ${(rnd() * 2000).toFixed(1)} ${(rnd() * 1400).toFixed(1)}`
      for (let i = 0; i < 500; i++) path += ` L ${(rnd() * 2000).toFixed(1)} ${(rnd() * 1400).toFixed(1)}`
      p.drawSvgPath(path, { x: 0, y: 1400, borderColor: rgb(0, 0, 0), borderWidth: 0.3 })
    }
    const src = await d.save()
    const withKey = (id: string) => ({ ...plan(id, `Plan ${id}`, 'tenant_layout', src), source: { kind: 'pdf' as const, bytes: src, pageIndex: 1, key: 'org/proj/e300.pdf' } })
    const base = await report()
    const out = await appendStatusPlansToReport(base, { inputs: [withKey('a'), withKey('b'), withKey('c')], omitted: [] }, '2026-10-09')
    expect((await sizes(out)).length).toBe(6) // 2 report + divider + 3 plans
    expect(out.byteLength).toBeLessThan(base.byteLength + src.byteLength * 1.6 + 30_000)
  })
})
