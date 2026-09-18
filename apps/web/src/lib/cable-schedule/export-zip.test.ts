import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { renderRevisionZip } from './export-zip'
import type { ExportPayload } from './export-payload'
import type { RouteSheetAttachment } from './route-sheets'

/** The smallest payload the renderers accept — an empty revision. */
function emptyPayload(): ExportPayload {
  return {
    costRedacted: false,
    project: { id: '44444444-4444-4444-4444-444444444444', name: 'KINGSWALK', organisation_id: 'org' },
    revision: {
      id: '33333333-3333-3333-3333-333333333333', code: 'Rev 0', description: null, status: 'DRAFT',
      issued_at: null, issued_by_name: null, fault_level_ka: null, change_notes: null,
      created_at: '2026-09-01T00:00:00.000Z', vat_pct: 15,
    },
    sources: [], nodes: [], supplies: [], cables: [], runs: [], costLines: [], cableTags: [], changeLog: [],
  } as unknown as ExportPayload
}

async function sheetPdf(label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([1190.55, 841.89]).drawText(label, { x: 40, y: 800, size: 12, font })
  return doc.save()
}

function sheet(over: Partial<RouteSheetAttachment>, bytes: Uint8Array): RouteSheetAttachment {
  return {
    reportId: 'rep-1', title: 'Cable routes — POWER LAYOUT A', version: 2, generatedAt: '2026-09-15T10:00:00.000Z',
    storagePath: 'x.pdf', sizeBytes: bytes.byteLength, floorPlanId: 'plan-a', pageIndex: 1, stale: false, bytes, ...over,
  }
}

describe('renderRevisionZip — route sheets ride along only when asked', () => {
  it('without the option the pack is exactly what it always was', async () => {
    const zip = await JSZip.loadAsync(await renderRevisionZip(emptyPayload()))
    expect(Object.keys(zip.files).some((f) => f.startsWith('route-sheets/'))).toBe(false)
    expect(await zip.file('README.txt')!.async('string')).not.toContain('route-sheets/')
  })

  it('adds each sheet as a file under route-sheets/, appends them inside the pack PDF, and says so in the README', async () => {
    const payload = emptyPayload()
    const a = await sheetPdf('ALPHA')
    payload.routeSheets = {
      sheets: [
        sheet({}, a),
        sheet({ reportId: 'rep-2', title: 'Cable routes — POWER LAYOUT A (page 2)', version: 1, pageIndex: 2, stale: true }, a),
      ],
      omitted: [{ title: 'Cable routes — PORTION B', reason: 'file could not be read (gone)' }],
    }
    const zip = await JSZip.loadAsync(await renderRevisionZip(payload))
    const names = Object.keys(zip.files).filter((f) => f.startsWith('route-sheets/') && !zip.files[f].dir)
    expect(names).toEqual(['route-sheets/power-layout-a-v2.pdf', 'route-sheets/power-layout-a-page-2-v1.pdf'])
    expect((await zip.file(names[0])!.async('uint8array')).byteLength).toBe(a.byteLength)

    const readme = await zip.file('README.txt')!.async('string')
    expect(readme).toContain('2 marked-up cable route sheet(s)')
    expect(readme).toContain('power-layout-a-page-2-v1.pdf')
    expect(readme).toContain('routes changed after export')
    expect(readme).toContain('NOT included: Cable routes — PORTION B')

    // The pack PDF itself carries the appendix: cover + divider + the two sheet pages.
    const packName = Object.keys(zip.files).find((f) => f.endsWith('.pdf') && !f.startsWith('route-sheets/'))!
    const pack = await PDFDocument.load(await zip.file(packName)!.async('uint8array'))
    const bare = await PDFDocument.load(await (await JSZip.loadAsync(await renderRevisionZip(emptyPayload()))).file(packName)!.async('uint8array'))
    expect(pack.getPageCount()).toBe(bare.getPageCount() + 1 + 2)
  })
})
