// @vitest-environment node
/**
 * REGRESSION: a drawing page with no /Annots must render byte-identically before and
 * after annotation flattening (spec 2026-10-13 §3). The hashes below were captured by
 * running this file on the renderer as it stood BEFORE Phase 3 (Task 3.1). pdf-lib's
 * resource names come from a per-document seeded RNG, so with Date frozen the output is
 * deterministic.
 *
 * Re-captured 2026-10-14, deliberately: the legend printed here is TENANT_LEGEND, and its
 * Overdue swatch became a solid red fill (no hatch). Proven to be the only difference —
 * with the old hatched Overdue swatch substituted into the legend, the previous eight
 * hashes reproduced exactly. This file guards annotation flattening, not shape styles.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { createHash } from 'node:crypto'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import { TENANT_LEGEND, type ShapeStyle } from '@esite/shared/status-plans'
import { renderStatusPlanPdf, type StatusPlanRenderInput } from './render-plan-page'

const BASELINE: Record<string, string> = {
  'source:0': 'd38a423743c2dbf5876bf20c5b395c65db77db36081b16c6693ccdea105c6293',
  'source:90': 'ced4b7e8c5cc1b0204abf58b7a5c039febb7301f60a22d6e91c09a6f7d03b418',
  'source:180': '2c941f4147688bcba859a46e56fc8f9c9f2776bb33be26e7750ce332e96cdcdd',
  'source:270': 'f6202bd5ca8e4a75c522359d329458bdd4cf7966862667ea5e9317a979d7285e',
  'a3:0': '0cd2256f5d8ea4b61cedb5139ba6da14fe90ff0646f369e9f0ed2b35021a331a',
  'a3:90': 'abedd5563c8d31285a06a88a766c4c51c5caba8ca7e5dbb2f1ccef64cb838e29',
  'a3:180': 'b1b52e9c057628f5e78905e57c23b938c56b30a4f604a05ff2048f4f54481ece',
  'a3:270': '3142183cfc2a6ea6764270bdf5e865e868b1847fdb62b7ce875da90a781eea23',
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
