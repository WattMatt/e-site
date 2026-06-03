import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

beforeEach(() => {
  vi.clearAllMocks()
  setPhotosRows([])
  createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed.example/file' } })
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
