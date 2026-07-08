import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import FileField from './FileField'
import type { RendererProps } from '../FieldRenderer'

// vi.hoisted so the mock fns/state exist before the hoisted vi.mock factory runs.
// The builder is a chainable PostgREST-style query object that is ALSO awaitable:
// awaiting the chain resolves to `{ data }`. Only the `photos` table yields rows —
// a query against the (non-existent) `attachments` relation comes back empty,
// exactly as the real PostgREST 404 would behave. That makes these tests
// sensitive to the table/column the component actually reads.
// The upload path runs through the same client: storage.from().upload/remove,
// auth.getUser, and insert().select().single() against inspections.photos.
const {
  createClientMock,
  fromSpy,
  selectSpy,
  insertSpy,
  createSignedUrlMock,
  uploadMock,
  removeMock,
  getUserMock,
  setPhotosRows,
  setInsertResult,
} = vi.hoisted(() => {
  const state = {
    table: '',
    rows: [] as Array<Record<string, unknown>>,
    insertResult: { data: null, error: null } as { data: unknown; error: unknown },
  }
  const createSignedUrlMock = vi.fn()
  const uploadMock = vi.fn()
  const removeMock = vi.fn()
  const getUserMock = vi.fn()
  const builder: Record<string, unknown> = {}
  const fromSpy = vi.fn((t: string) => {
    state.table = t
    return builder
  })
  const selectSpy = vi.fn(() => builder)
  const insertSpy = vi.fn(() => builder)
  builder.schema = () => builder
  builder.from = fromSpy
  builder.select = selectSpy
  builder.insert = insertSpy
  builder.eq = () => builder
  builder.single = () => Promise.resolve(state.insertResult)
  builder.maybeSingle = () => Promise.resolve({ data: null })
  ;(builder as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve({ data: state.table === 'photos' ? state.rows : [] })
  const client = {
    schema: () => builder,
    auth: { getUser: getUserMock },
    storage: {
      from: (bucket: string) => ({
        upload: (...args: unknown[]) => uploadMock(bucket, ...args),
        remove: (...args: unknown[]) => removeMock(bucket, ...args),
        createSignedUrl: (...args: unknown[]) => createSignedUrlMock(bucket, ...args),
      }),
    },
  }
  return {
    createClientMock: vi.fn(() => client),
    fromSpy,
    selectSpy,
    insertSpy,
    createSignedUrlMock,
    uploadMock,
    removeMock,
    getUserMock,
    setPhotosRows: (rows: Array<Record<string, unknown>>) => {
      state.rows = rows
    },
    setInsertResult: (result: { data: unknown; error: unknown }) => {
      state.insertResult = result
    },
  }
})
vi.mock('@/lib/supabase/client', () => ({ createClient: createClientMock }))
// Capture routes live under /projects/[id]/… — pin the route param so the
// upload path resolves the project id without the inspections-table fallback.
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'proj-1' }) }))

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

function pickFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  setPhotosRows([])
  setInsertResult({ data: { id: 'ph-new' }, error: null })
  createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/file' } })
  uploadMock.mockResolvedValue({ error: null })
  removeMock.mockResolvedValue({ error: null })
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-7' } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
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
})

describe('FileField upload', () => {
  it('uploads to the inspection-attachments bucket then inserts the inspections.photos row', async () => {
    renderFileField()
    pickFile(new File(['%PDF-1.4'], 'spec sheet.pdf', { type: 'application/pdf' }))

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1))
    const [bucket, path, uploaded, opts] = uploadMock.mock.calls[0]
    expect(bucket).toBe('inspection-attachments')
    // Path convention: {projectId}/{inspectionId}/{sectionId}/{fieldId}/{ts}-{sanitised name}
    expect(path).toMatch(/^proj-1\/insp-1\/sec-1\/f-file-1\/\d+-spec_sheet\.pdf$/)
    expect((uploaded as File).name).toBe('spec sheet.pdf')
    expect(opts).toEqual({ contentType: 'application/pdf' })

    await waitFor(() => expect(insertSpy).toHaveBeenCalledTimes(1))
    expect(insertSpy).toHaveBeenCalledWith({
      inspection_id: 'insp-1',
      section_id: 'sec-1',
      field_id: 'f-file-1',
      storage_path: path,
      file_size_bytes: 8,
      caption: 'spec sheet.pdf', // original (unsanitised) filename lives in caption
      uploaded_by: 'user-7',
    })

    // The new file appears in the list with its signed URL
    const link = await screen.findByText('spec sheet.pdf')
    expect((link as HTMLAnchorElement).getAttribute('href')).toBe('https://signed.example/file')
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('infers the MIME from the extension when the browser reports an empty file.type', async () => {
    renderFileField()
    pickFile(new File(['%PDF-1.4'], 'report.pdf', { type: '' }))
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1))
    expect(uploadMock.mock.calls[0][3]).toEqual({ contentType: 'application/pdf' })
  })

  it('removes the just-uploaded storage object and surfaces the error when the photos insert fails', async () => {
    setInsertResult({ data: null, error: { message: 'new row violates row-level security policy "photos_insert"' } })
    renderFileField()
    pickFile(new File(['%PDF-1.4'], 'doomed.pdf', { type: 'application/pdf' }))

    await waitFor(() => expect(removeMock).toHaveBeenCalledTimes(1))
    const uploadedPath = uploadMock.mock.calls[0][1]
    expect(removeMock).toHaveBeenCalledWith('inspection-attachments', [uploadedPath])
    await screen.findByText(/new row violates row-level security policy/)
    // The orphaned upload must not show up as a saved file
    expect(screen.queryByText('doomed.pdf')).toBeNull()
  })

  it('maps a storage RLS rejection to a readable error and never inserts a photos row', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'new row violates row-level security policy' } })
    renderFileField()
    pickFile(new File(['%PDF-1.4'], 'locked.pdf', { type: 'application/pdf' }))
    await screen.findByText('Upload not allowed — this inspection is no longer editable.')
    expect(insertSpy).not.toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('rejects a file over 25 MB client-side without any storage or insert call', async () => {
    renderFileField()
    const big = new File(['x'], 'huge.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 })
    pickFile(big)
    await screen.findByText(/the limit is 25 MB/)
    expect(uploadMock).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('accepts a file of exactly 25 MB (the limit is exclusive)', async () => {
    renderFileField()
    const atLimit = new File(['x'], 'at-limit.pdf', { type: 'application/pdf' })
    Object.defineProperty(atLimit, 'size', { value: 25 * 1024 * 1024 })
    pickFile(atLimit)
    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1))
  })

  it('rejects a disallowed MIME type client-side without any storage or insert call', async () => {
    renderFileField()
    pickFile(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
    await screen.findByText(/Unsupported file type/)
    expect(uploadMock).not.toHaveBeenCalled()
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('never fetches any /api/ route during upload (bytes go browser → storage, not through Vercel)', async () => {
    // The old /api/inspections/upload-file route died on Vercel's 4.5 MB body
    // cap (see the tenant-documents precedent); guard against the byte path
    // regressing to a proxied API route.
    const fetchSpy = vi.fn(async (..._args: unknown[]) => ({ ok: true }))
    vi.stubGlobal('fetch', fetchSpy)
    renderFileField()
    pickFile(new File(['%PDF-1.4'], 'direct.pdf', { type: 'application/pdf' }))
    await screen.findByText('direct.pdf') // upload fully completed
    const apiCalls = fetchSpy.mock.calls.filter((call) => {
      const input = call[0]
      const url = typeof input === 'string' ? input : ((input as { url?: string })?.url ?? String(input))
      return url.includes('/api/')
    })
    expect(apiCalls).toEqual([])
  })
})
