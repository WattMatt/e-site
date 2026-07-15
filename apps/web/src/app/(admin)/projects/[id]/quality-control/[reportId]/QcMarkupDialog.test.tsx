import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QcMarkupDialog } from './QcMarkupDialog'

// QcMarkupDialog's picker is the "access the full drawing list" fix: it queries
// tenants.floor_plans with NO extension filter, so PDFs (which the old
// FloorPlanAttachDialog dropped by only accepting images) now appear. These
// tests drive the picker step with a mocked supabase client and assert the PDF
// row is listed + markable, images are markable, and DWG/DXF are shown-disabled
// (listed, not filtered).

const { rowsRef, createSignedUrlMock, refreshMock } = vi.hoisted(() => ({
  rowsRef: { current: [] as Array<Record<string, unknown>> },
  createSignedUrlMock: vi.fn(),
  refreshMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }))

// Chainable stub mirroring the dialog's read:
// .schema('tenants').from('floor_plans').select().eq().eq().order() → { data, error }
vi.mock('@/lib/supabase/client', () => {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.order = () => Promise.resolve({ data: rowsRef.current, error: null })
  return {
    createClient: () => ({
      schema: () => ({ from: () => builder }),
      storage: { from: () => ({ createSignedUrl: createSignedUrlMock }) },
    }),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null })
  rowsRef.current = [
    // A PDF drawing — the row the old image-only picker filtered out.
    { id: 'pdf1', name: 'Ground Floor', level: null, file_path: 'o/p/ground-floor.pdf', width_px: 1000, height_px: 800, pixels_per_meter: 50 },
    // A raster image drawing.
    { id: 'img1', name: 'Site Photo', level: 'Roof', file_path: 'o/p/site.png', width_px: 640, height_px: 480, pixels_per_meter: null },
    // A CAD file — listed but not markable (no canvas support).
    { id: 'dwg1', name: 'CAD Export', level: null, file_path: 'o/p/plan.dwg', width_px: null, height_px: null, pixels_per_meter: null },
  ]
})

describe('QcMarkupDialog picker', () => {
  it('lists PDF drawings (does NOT filter them out) and makes them markable', async () => {
    render(<QcMarkupDialog projectId="p1" onClose={vi.fn()} onStaged={vi.fn()} />)

    // The PDF row appears at all — the core fix. Its button is enabled (markable)
    // and its meta badge reads 'PDF' (level is null).
    const pdfBtn = (await screen.findByText('Ground Floor')).closest('button')
    expect(pdfBtn).not.toBeNull()
    expect(pdfBtn!.disabled).toBe(false)
    expect(screen.getByText('PDF')).toBeTruthy()

    // The image row is also listed and markable.
    const imgBtn = screen.getByText('Site Photo').closest('button')
    expect(imgBtn!.disabled).toBe(false)
  })

  it('shows DWG/DXF rows disabled rather than dropping them from the list', async () => {
    render(<QcMarkupDialog projectId="p1" onClose={vi.fn()} onStaged={vi.fn()} />)

    // The CAD row is present (proving no extension filter) but disabled with the
    // "Not markable" badge — the picker gates only non-renderable formats.
    const dwgBtn = (await screen.findByText('CAD Export')).closest('button')
    expect(dwgBtn).not.toBeNull()
    expect(dwgBtn!.disabled).toBe(true)
    expect(screen.getByText('Not markable')).toBeTruthy()
  })

  it('signs only the markable rows (PDF + image), not the DWG', async () => {
    render(<QcMarkupDialog projectId="p1" onClose={vi.fn()} onStaged={vi.fn()} />)
    await screen.findByText('Ground Floor')

    // Signed URLs are requested for the PDF and the image but never the DWG.
    const signedPaths = createSignedUrlMock.mock.calls.map((c) => c[0])
    expect(signedPaths).toContain('o/p/ground-floor.pdf')
    expect(signedPaths).toContain('o/p/site.png')
    expect(signedPaths).not.toContain('o/p/plan.dwg')
    expect(createSignedUrlMock).toHaveBeenCalledTimes(2)
  })
})
