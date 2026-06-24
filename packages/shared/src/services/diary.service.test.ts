import { describe, it, expect, vi } from 'vitest'
import { attachmentKindFromMime, diaryService } from './diary.service'

describe('attachmentKindFromMime', () => {
  it('classifies images', () => {
    expect(attachmentKindFromMime('image/jpeg')).toBe('image')
    expect(attachmentKindFromMime('image/png')).toBe('image')
    expect(attachmentKindFromMime('image/heic')).toBe('image')
  })
  it('classifies video', () => {
    expect(attachmentKindFromMime('video/mp4')).toBe('video')
    expect(attachmentKindFromMime('video/quicktime')).toBe('video')
  })
  it('classifies everything else as document', () => {
    expect(attachmentKindFromMime('application/pdf')).toBe('document')
    expect(attachmentKindFromMime('application/vnd.ms-excel')).toBe('document')
    expect(attachmentKindFromMime('')).toBe('document')
  })
})

/** Mock for getEntryForGate: schema().from().select().eq().maybeSingle(). */
function makeGateClient(row: object | null) {
  return {
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: row, error: null }),
          }),
        }),
      }),
    }),
  }
}

/**
 * Mock for hardDelete:
 * - listAttachments  → schema().from().select().in().order()
 * - entry delete     → schema().from().delete().eq()
 * - storage cleanup  → storage.from().remove()
 */
function makeDeleteClient(opts: {
  attachments?: Array<{ file_path: string }>
  deleteError?: { message: string } | null
  removeRejects?: boolean
} = {}) {
  const { attachments = [], deleteError = null, removeRejects = false } = opts
  const removeSpy = vi.fn(() =>
    removeRejects
      ? Promise.reject(new Error('storage down'))
      : Promise.resolve({ data: [], error: null }),
  )
  const client = {
    schema: () => ({
      from: () => ({
        select: () => ({
          in: () => ({
            order: () => Promise.resolve({ data: attachments, error: null }),
          }),
        }),
        delete: () => ({
          eq: () => Promise.resolve({ error: deleteError }),
        }),
      }),
    }),
    storage: { from: () => ({ remove: removeSpy }) },
  }
  return { client, removeSpy }
}

describe('diaryService.getEntryForGate', () => {
  it('returns the row when found', async () => {
    const row = { id: 'e1', project_id: 'p1', organisation_id: 'o1', created_by: 'u1' }
    const res = await diaryService.getEntryForGate(makeGateClient(row) as never, 'e1')
    expect(res).toEqual(row)
  })
  it('returns null when not found', async () => {
    const res = await diaryService.getEntryForGate(makeGateClient(null) as never, 'missing')
    expect(res).toBeNull()
  })
})

describe('diaryService.hardDelete', () => {
  it('gathers attachment paths, deletes the entry, then removes the blobs', async () => {
    const { client, removeSpy } = makeDeleteClient({
      attachments: [{ file_path: 'o/p/e/a.jpg' }, { file_path: 'o/p/e/b.pdf' }],
    })
    await diaryService.hardDelete(client as never, 'e1')
    expect(removeSpy).toHaveBeenCalledWith(['o/p/e/a.jpg', 'o/p/e/b.pdf'])
  })

  it('does not call storage.remove when there are no attachments', async () => {
    const { client, removeSpy } = makeDeleteClient({ attachments: [] })
    await diaryService.hardDelete(client as never, 'e1')
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('throws when the entry delete fails, before any storage work', async () => {
    const { client, removeSpy } = makeDeleteClient({
      attachments: [{ file_path: 'a' }],
      deleteError: { message: 'boom' },
    })
    await expect(diaryService.hardDelete(client as never, 'e1')).rejects.toEqual({ message: 'boom' })
    expect(removeSpy).not.toHaveBeenCalled()
  })

  it('still resolves when storage removal rejects (best-effort)', async () => {
    const { client } = makeDeleteClient({ attachments: [{ file_path: 'a' }], removeRejects: true })
    await expect(diaryService.hardDelete(client as never, 'e1')).resolves.toBeUndefined()
  })
})

/** Captures the row handed to .insert(): schema().from().insert().select().single(). */
function buildInsertCaptureClient() {
  const captured: { payload?: any } = {}
  const single = vi.fn(() =>
    Promise.resolve({ data: { id: 'diary-1', ...(captured.payload ?? {}) }, error: null }),
  )
  const select = vi.fn(() => ({ single }))
  const insert = vi.fn((payload: any) => {
    captured.payload = payload
    return { select }
  })
  const from = vi.fn(() => ({ insert }))
  const schema = vi.fn(() => ({ from }))
  return { client: { schema } as any, captured }
}

const baseCreateInput = {
  projectId: 'project-1',
  entryDate: '2026-06-24',
  progressNotes: 'Poured the slab on grid B.',
}

describe('diaryService.create — server-forced tenancy + field mapping', () => {
  it('binds organisation_id and created_by to its arguments, ignoring any input-borne values', async () => {
    const { client, captured } = buildInsertCaptureClient()

    await diaryService.create(
      client,
      'org-real',
      'user-real',
      // A hostile caller cannot smuggle tenancy in through the input object.
      { ...baseCreateInput, organisation_id: 'org-evil', created_by: 'user-evil' } as any,
    )

    expect(captured.payload.organisation_id).toBe('org-real')
    expect(captured.payload.created_by).toBe('user-real')
  })

  it('defaults entry_type to "progress" when none is supplied', async () => {
    const { client, captured } = buildInsertCaptureClient()
    await diaryService.create(client, 'o', 'u', { ...baseCreateInput })
    expect(captured.payload.entry_type).toBe('progress')
  })

  it('writes quality_notes for a quality entry (backs the wired-in Quality field)', async () => {
    const { client, captured } = buildInsertCaptureClient()
    await diaryService.create(client, 'o', 'u', {
      ...baseCreateInput,
      entryType: 'quality',
      qualityNotes: 'Concrete cube test passed at 30 MPa.',
    })
    expect(captured.payload.entry_type).toBe('quality')
    expect(captured.payload.quality_notes).toBe('Concrete cube test passed at 30 MPa.')
  })

  it('coerces omitted optional notes to null', async () => {
    const { client, captured } = buildInsertCaptureClient()
    await diaryService.create(client, 'o', 'u', { ...baseCreateInput })
    expect(captured.payload.safety_notes).toBeNull()
    expect(captured.payload.quality_notes).toBeNull()
    expect(captured.payload.delay_notes).toBeNull()
  })
})
