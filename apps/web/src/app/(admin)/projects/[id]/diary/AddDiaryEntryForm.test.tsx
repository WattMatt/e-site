import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { AddDiaryEntryForm } from './AddDiaryEntryForm'

const { createActionMock, uploadMock, refreshMock } = vi.hoisted(() => ({
  createActionMock: vi.fn(),
  uploadMock: vi.fn(),
  refreshMock: vi.fn(),
}))

vi.mock('@/actions/diary.actions', () => ({
  createDiaryEntryAction: (...a: unknown[]) => createActionMock(...a),
}))
vi.mock('@/lib/diary-attachments', () => ({
  uploadDiaryAttachments: (...a: unknown[]) => uploadMock(...a),
  DIARY_ATTACHMENT_ACCEPT_DOC: 'application/pdf',
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }))

const props = { projectId: 'p1', orgId: 'o1', userId: 'u1' }

function open() {
  render(<AddDiaryEntryForm {...props} />)
  fireEvent.click(screen.getByText('+ Add Entry'))
}

function typeProgress(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/Describe work completed/), { target: { value: text } })
}

function submitForm() {
  const form = document.querySelector('form')!
  return act(async () => { fireEvent.submit(form) })
}

function attachFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => vi.clearAllMocks())

describe('AddDiaryEntryForm', () => {
  it('creates via the server action and refreshes on success (no attachments)', async () => {
    createActionMock.mockResolvedValue({ entryId: 'e1' })
    open()
    typeProgress('Poured the slab.')
    await submitForm()

    expect(createActionMock).toHaveBeenCalledTimes(1)
    expect(createActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', progressNotes: 'Poured the slab.' }),
    )
    expect(uploadMock).not.toHaveBeenCalled()
    await waitFor(() => expect(refreshMock).toHaveBeenCalled())
  })

  it('surfaces the action error and does not refresh', async () => {
    createActionMock.mockResolvedValue({ error: 'nope' })
    open()
    typeProgress('Some notes.')
    await submitForm()

    expect(await screen.findByText('nope')).toBeDefined()
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it('does not create a second entry when an attachment upload fails and the user retries', async () => {
    createActionMock.mockResolvedValue({ entryId: 'e1' })
    uploadMock
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockResolvedValueOnce(undefined)

    open()
    typeProgress('Poured the slab.')
    attachFile(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))

    await submitForm() // create succeeds, attachment upload fails
    expect(await screen.findByText('upload failed')).toBeDefined()

    await submitForm() // retry

    // The entry is created exactly once; the retry only re-runs the upload,
    // reusing the already-created entry id — no duplicate diary entry.
    expect(createActionMock).toHaveBeenCalledTimes(1)
    expect(uploadMock).toHaveBeenCalledTimes(2)
    expect(uploadMock.mock.calls[1][1]).toEqual(expect.objectContaining({ entryId: 'e1' }))
    await waitFor(() => expect(refreshMock).toHaveBeenCalled())
  })

  it('does not re-upload already-committed attachments on retry', async () => {
    createActionMock.mockResolvedValue({ entryId: 'e1' })
    // First call commits file A (via the onFileUploaded callback), then fails on B.
    uploadMock
      .mockImplementationOnce((_client, opts: any, onFileUploaded: (f: File) => void) => {
        onFileUploaded(opts.files[0])
        return Promise.reject(new Error('upload failed'))
      })
      .mockResolvedValueOnce(undefined)

    open()
    typeProgress('Poured the slab.')
    const fileA = new File(['a'], 'a.jpg', { type: 'image/jpeg' })
    const fileB = new File(['b'], 'b.jpg', { type: 'image/jpeg' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [fileA, fileB] } })

    await submitForm()
    expect(await screen.findByText('upload failed')).toBeDefined()

    await submitForm() // retry

    // The committed file A is gone from state; only B is retried.
    expect(uploadMock.mock.calls[1][1].files).toEqual([fileB])
  })
})
