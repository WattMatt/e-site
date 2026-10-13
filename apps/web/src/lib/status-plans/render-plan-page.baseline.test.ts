// @vitest-environment node
/**
 * REGRESSION: a drawing page with no /Annots must render byte-identically before and
 * after annotation flattening (spec 2026-10-13 §3). The hashes below were captured by
 * running this file on the renderer as it stood BEFORE Phase 3 (Task 3.1). pdf-lib's
 * resource names come from a per-document seeded RNG, so with Date frozen the output is
 * deterministic.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import { TENANT_LEGEND, type ShapeStyle } from '@esite/shared/status-plans'
import { renderStatusPlanPdf, type StatusPlanRenderInput } from './render-plan-page'

const BASELINE: Record<string, string> = {
  'source:0': '36efbcb5f2617353fea91d2fc13ab72eb5fd8cd39e123ac0f24017c9b48db1de',
  'source:90': '219552a410610f72264a7f51f9eae3cea5a49e3ddcd72fb1c1eacff16c93f6b9',
  'source:180': '7418f96c0f3637fded532c56768829f91dea3123a82601246f9b27aeaead47bb',
  'source:270': 'b865794ade95db6aa41d41063e1f71250512f82009f9c7f1d7bb7d931bea406d',
  'a3:0': '8d697f479403b4b17b61f8e17c55e348bea8cdb146e221efa45543a72b58dd66',
  'a3:90': '29eb20f3081e3ce179c776af1766be3873aae4c206940633eabebb984c886248',
  'a3:180': 'ce54a78041a4486b9d04b4f279c4ab19d4f600ed7f9085ce1a89485d3c61566b',
  'a3:270': '42d2a8266b3f656052ec4f58b80aceb37edf043b51dc3094687febe2888226d4',
}

const PLAIN: ShapeStyle = { fill: '#2E9E4F', fillOpacity: 0.45, stroke: '#2E9E4F', strokeWidth: 3, dash: null, hatches: [], strikeLabel: false }

async function plainSource(r: number): Promise<Uint8Array> {
  const d = await PDFDocument.create()
  const p = d.addPage([600, 400])
  p.setRotation(degrees(r))
  p.drawRectangle({ x: 500, y: 300, width: 10, height: 10, color: rgb(0, 0, 1) })
  return d.save()
}

function input(bytes: Uint8Array): StatusPlanRenderInput {
  return {
    planId: 'p1', sheetId: 'sh1', planName: 'Baseline plan', sheetLabel: 'Sheet 1 of 1', purpose: 'tenant_layout',
    drawingName: 'baseline.pdf', pageIndex: 1, generatedOn: '2026-10-13', source: { kind: 'pdf', bytes, pageIndex: 1 },
    shapes: [{ points: [100, 100, 300, 100, 300, 300, 100, 300], style: PLAIN, labelLines: ['L01', 'Shop'], invalid: false }],
    legend: TENANT_LEGEND, counts: { complete: 1 }, measured: { totalM2: 50, unmeasured: 0 }, warnings: [],
  }
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T08:00:00Z'))
})
afterAll(() => vi.useRealTimers())

describe('a page with no annotations renders exactly as before', () => {
  it('source and A3 layouts, all four rotations', async () => {
    const actual: Record<string, string> = {}
    for (const layout of ['source', 'a3'] as const) {
      for (const r of [0, 90, 180, 270]) {
        actual[`${layout}:${r}`] = sha(await renderStatusPlanPdf(input(await plainSource(r)), layout))
      }
    }
    expect(actual).toEqual(BASELINE)
  })
})
