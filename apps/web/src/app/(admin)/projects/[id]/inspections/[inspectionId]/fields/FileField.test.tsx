import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import FileField from './FileField'
import type { RendererProps } from '../FieldRenderer'

// vi.hoisted so the mock fns/state exist before the hoisted vi.mock factory runs.
// The builder is a chainable PostgREST-style query object that is ALSO awaitable:
// awaiting the chain resolves to `{ data }`. Only the `photos` table yields rows —
// a query against the (non-existent) `attachments` relation comes back empty,
// exactly as the real PostgREST 404 would behave. That makes these tests
// sensitive to the table/column the component actually reads.
const { createClientMock, fromSpy, selectSpy, createSignedUrlMock, setPhotosRows } = vi.hoisted(() => {
  const state = { table: '', rows: [] as Array<Record<string, unknown>> }
  const createSignedUrlMock = vi.fn()
  const builder: Record<string, unknown> = {}
  const fromSpy = vi.fn((t: string) => {
    state.table = t
    return builder
  })
  const selectSpy = vi.fn(() => builder)
  builder.schema = () => builder
  builder.from = fromSpy
  builder.select = selectSpy
  builder.eq = () => builder
  ;(builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve({ data: state.table === 'photos' ? state.rows : [] })
  const client = {
    schema: () => builder,
    storage: { from: () => ({ createSignedUrl: createSignedUrlMock }) },
  }
  return {
    createClientMock: vi.fn(() => client),
    fromSpy,
    selectSpy,
    createSignedUrlMock,
    setPhotosRows: (rows: Array<Record<string, unknown>>) => {
      state.rows = rows
    },
  }
})
vi.mock('@/lib/supabase/client', () => ({ createClient: createClientMock }))

// Upload path: bytes go browser → storage via the shared helper, then a server
// action attaches the inspections.photos row. Both are mocked at the module
// boundary — the helper has its own unit tests (inspection-attachments-upload.test.ts).
const { uploadHelperMock, removeHelperMock, attachActionMock } = vi.hoisted(() => ({
  uploadHelperMock: vi.fn(),
  removeHelperMock: vi.fn(),
  attachActionMock: vi.fn(),
}))
vi.mock('@/lib/storage/inspection-attachments-upload', () => ({
  uploadInspectionAttachmentFile: uploadHelperMock,
  removeInspectionAttachmentFile: removeHelperMock,
}))
vi.mock('@/actions/inspections.actions', () => ({
  attachInspectionFileAction: attachActionMock,
}))

function renderFileField() {
  const props = {
    field: { field_id: 'f-file-1', label: 'Spec sheet (PDF)', type: 'file', required: false },
    inspectionId: 'insp-1',
    sectionId: 'sec-1',
    readOnly: false,
    verifierFlipMode: false,
    onChange: () => {},
  } as unknown as RendererProps
  return render(<FileField {...props} />)
}

function pickFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

const STORAGE_PATH = 'proj-1/insp-1/sec-1/f-file-1/999-spec.pdf'

beforeEach(() => {
  vi.clearAllMocks()
  setPhotosRows([])
  createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/file' } })
  uploadHelperMock.mockResolvedValue({ storagePath: STORAGE_PATH, filename: 'spec.pdf' })
  removeHelperMock.mockResolvedValue(undefined)
  attachActionMock.mockResolvedValue({ ok: true, id: 'ph-9' })
})

describe('FileField', () => {
  it('renders previously-uploaded files read from inspections.photos (filename from caption)', async () => {
    setPhotosRows([
      { id: 'ph-1', storage_path: 'proj/insp-1/sec-1/f-file-1/123-spec.pdf', caption: 'spec.pdf' },
    ])
    renderFileField()
    const link = await screen.findByText('spec.pdf')
    expect(link).toBeDefined()
    expect((link as HTMLAnchorElement).getAttribute('href')).toBe('https://signed.example/file')
  })

  it('reads from the inspections.photos table, not the non-existent attachments table', async () => {
    renderFileField()
    await waitFor(() => expect(fromSpy).toHaveBeenCalledWith('photos'))
    expect(fromSpy).not.toHaveBeenCalledWith('attachments')
    // The original filename lives in the `caption` column on inspections.photos.
    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining('caption'))
  })

  it('uploads direct-to-storage via the helper, then attaches through the server action', async () => {
    // Regression guard: bytes must never transit a Next.js API route again
    // (Vercel 413s bodies over ~4.5 MB before the route runs).
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { container } = renderFileField()
    const file = new File(['pdf-bytes'], 'spec.pdf', { type: 'application/pdf' })
    pickFile(container, file)

    const link = await screen.findByText('spec.pdf')
    expect((link as HTMLAnchorElement).getAttribute('href')).toBe('https://signed.example/file')

    expect(uploadHelperMock).toHaveBeenCalledWith({
      inspectionId: 'insp-1',
      sectionId: 'sec-1',
      fieldId: 'f-file-1',
      file,
    })
    expect(attachActionMock).toHaveBeenCalledWith({
      inspectionId: 'insp-1',
      sectionId: 'sec-1',
      fieldId: 'f-file-1',
      storagePath: STORAGE_PATH,
      filename: 'spec.pdf',
    })
    expect(removeHelperMock).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('removes the orphaned object and shows the error when the DB attach fails', async () => {
    attachActionMock.mockResolvedValue({ ok: false, error: 'Inspection not found' })

    const { container } = renderFileField()
    pickFile(container, new File(['x'], 'spec.pdf', { type: 'application/pdf' }))

    await screen.findByText('Inspection not found')
    expect(removeHelperMock).toHaveBeenCalledWith(STORAGE_PATH)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('surfaces the helper’s validation error without calling the attach action', async () => {
    uploadHelperMock.mockRejectedValue(
      new Error('Only PDF, Word (.docx) and Excel (.xlsx) files are accepted.'),
    )

    const { container } = renderFileField()
    pickFile(container, new File(['x'], 'notes.txt', { type: 'text/plain' }))

    await screen.findByText(/Only PDF, Word/)
    expect(attachActionMock).not.toHaveBeenCalled()
    expect(removeHelperMock).not.toHaveBeenCalled()
  })
})
