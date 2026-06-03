'use client'

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ─── Module mocks (vi.hoisted avoids TDZ when the SUT imports server actions) ──

const {
  mockList,
  mockCreate,
  mockAddRevision,
  mockRename,
  mockDeleteRevision,
  mockDeleteDocument,
  mockGetSignedUrl,
} = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockCreate: vi.fn(),
  mockAddRevision: vi.fn(),
  mockRename: vi.fn(),
  mockDeleteRevision: vi.fn(),
  mockDeleteDocument: vi.fn(),
  mockGetSignedUrl: vi.fn(),
}))

vi.mock('@/actions/tenant-documents.actions', () => ({
  listTenantDocumentsAction: (...args: unknown[]) => mockList(...args),
  createTenantDocumentAction: (...args: unknown[]) => mockCreate(...args),
  addTenantDocumentRevisionAction: (...args: unknown[]) => mockAddRevision(...args),
  renameTenantDocumentAction: (...args: unknown[]) => mockRename(...args),
  deleteTenantDocumentRevisionAction: (...args: unknown[]) => mockDeleteRevision(...args),
  deleteTenantDocumentAction: (...args: unknown[]) => mockDeleteDocument(...args),
  getRevisionSignedUrlAction: (...args: unknown[]) => mockGetSignedUrl(...args),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const rev1 = {
  id: 'rev-1',
  tenant_document_id: 'doc-1',
  rev_label: 'Rev B',
  storage_path: 'proj/node/123-file.pdf',
  file_name: 'file.pdf',
  note: 'Second issue',
  issued_at: '2026-06-01T12:00:00Z',
  uploaded_by: 'user-1',
  created_at: '2026-06-01T12:00:00Z',
}

const rev2 = {
  id: 'rev-2',
  tenant_document_id: 'doc-1',
  rev_label: 'Rev A',
  storage_path: 'proj/node/100-file-v1.pdf',
  file_name: 'file-v1.pdf',
  note: null,
  issued_at: '2026-05-01T10:00:00Z',
  uploaded_by: null,
  created_at: '2026-05-01T10:00:00Z',
}

const doc1 = {
  id: 'doc-1',
  node_id: 'node-1',
  kind: 'layout' as const,
  title: 'Electrical Layout',
  sort_order: 0,
  revisions: [rev1, rev2], // newest first
}

const doc2 = {
  id: 'doc-2',
  node_id: 'node-1',
  kind: 'layout' as const,
  title: 'Fire Layout',
  sort_order: 1,
  revisions: [
    {
      id: 'rev-3',
      tenant_document_id: 'doc-2',
      rev_label: 'Rev A',
      storage_path: 'proj/node/200-fire.pdf',
      file_name: 'fire.pdf',
      note: null,
      issued_at: '2026-05-15T08:00:00Z',
      uploaded_by: null,
      created_at: '2026-05-15T08:00:00Z',
    },
  ],
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TenantDocumentList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default stub: window.open no-ops
    vi.stubGlobal('open', vi.fn())
  })

  // ── 1. Renders document rows with title, current rev label, revision-count badge ──

  it('renders N document rows with title, current-rev label, and revision-count badge', async () => {
    const { TenantDocumentList } = await import('./TenantDocumentList')
    render(
      <TenantDocumentList
        kind="layout"
        projectId="p-1"
        nodeId="node-1"
        readOnly={false}
        initialDocuments={[doc1, doc2]}
      />,
    )

    // Both document titles appear
    expect(screen.getByText('Electrical Layout')).toBeTruthy()
    expect(screen.getByText('Fire Layout')).toBeTruthy()

    // Current rev labels (doc1 = Rev B, doc2 = Rev A)
    expect(screen.getByText('Rev B')).toBeTruthy()
    expect(screen.getByText('Rev A')).toBeTruthy()

    // Revision-count badges: doc1 has 2 revisions, doc2 has 1
    expect(screen.getByText('2 revisions')).toBeTruthy()
    expect(screen.getByText('1 revision')).toBeTruthy()
  })

  // ── 2. Clicking "Revisions" opens the drawer for that document ──

  it('clicking Revisions opens the drawer showing that document revisions', async () => {
    const { TenantDocumentList } = await import('./TenantDocumentList')
    render(
      <TenantDocumentList
        kind="layout"
        projectId="p-1"
        nodeId="node-1"
        readOnly={false}
        initialDocuments={[doc1, doc2]}
      />,
    )

    // Click Revisions on doc1
    const revButtons = screen.getAllByRole('button', { name: /Revisions/i })
    await userEvent.click(revButtons[0])

    // Drawer should show both revision labels for doc1.
    // "Rev B" also appears in the doc row badge so use getAllByText.
    expect(screen.getAllByText('Rev B').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Rev A').length).toBeGreaterThanOrEqual(1)
    // Note text from rev1 only appears in the drawer
    expect(screen.getByText('Second issue')).toBeTruthy()
  })

  // ── 3. readOnly hides Add-drawing, Add-revision, rename, and delete controls ──

  it('readOnly hides all mutation controls', async () => {
    const { TenantDocumentList } = await import('./TenantDocumentList')
    render(
      <TenantDocumentList
        kind="layout"
        projectId="p-1"
        nodeId="node-1"
        readOnly={true}
        initialDocuments={[doc1]}
      />,
    )

    // No "Add drawing" button
    expect(screen.queryByRole('button', { name: /Add drawing/i })).toBeNull()
    // No rename controls
    expect(screen.queryByRole('button', { name: /Rename/i })).toBeNull()
    // No delete document
    expect(screen.queryByRole('button', { name: /Delete/i })).toBeNull()

    // Open drawer and confirm no Add revision / delete revision
    const revBtn = screen.getByRole('button', { name: /Revisions/i })
    await userEvent.click(revBtn)

    expect(screen.queryByRole('button', { name: /Add revision/i })).toBeNull()
  })

  // ── 4. Add-drawing flow: upload → create action → optimistic row appears ──

  it('add-drawing flow: fills title + file → POSTs to upload route → calls createTenantDocumentAction → new row appears', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ storagePath: 'proj/node/ts-drawing.pdf', filename: 'drawing.pdf' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    mockCreate.mockResolvedValue({
      ok: true,
      documentId: 'doc-new',
    })

    const { TenantDocumentList } = await import('./TenantDocumentList')
    render(
      <TenantDocumentList
        kind="layout"
        projectId="p-1"
        nodeId="node-1"
        readOnly={false}
        initialDocuments={[]}
      />,
    )

    // Click "+ Add drawing" to expand the form
    await userEvent.click(screen.getByRole('button', { name: /Add drawing/i }))

    // Fill in the title
    const titleInput = screen.getByPlaceholderText(/Drawing title/i)
    await userEvent.type(titleInput, 'New Layout')

    // Attach a file
    const fileInput = screen.getByTestId('add-drawing-file-input')
    const file = new File(['pdf-content'], 'drawing.pdf', { type: 'application/pdf' })
    await userEvent.upload(fileInput, file)

    // Click Upload / submit
    await userEvent.click(screen.getByRole('button', { name: /Upload/i }))

    await waitFor(() => {
      // Upload route called with correct FormData fields
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/tenant-schedule/upload-scope-document',
        expect.objectContaining({ method: 'POST' }),
      )
      // createTenantDocumentAction called with the storage path from the upload response
      expect(mockCreate).toHaveBeenCalledWith(
        'p-1',
        'node-1',
        'layout',
        'New Layout',
        expect.objectContaining({
          storagePath: 'proj/node/ts-drawing.pdf',
          fileName: 'drawing.pdf',
          revLabel: 'Rev A',
        }),
      )
    })

    // Optimistic: new row appears
    await waitFor(() => {
      expect(screen.getByText('New Layout')).toBeTruthy()
    })
  })

  // ── 5. Add-revision flow: opens drawer → Add revision → upload → addTenantDocumentRevisionAction → onChanged ──

  it('add-revision flow: opens drawer → uploads file → calls addTenantDocumentRevisionAction → refresh (listTenantDocumentsAction) is called', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ storagePath: 'proj/node/456-rev-c.pdf', filename: 'rev-c.pdf' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    mockAddRevision.mockResolvedValue({ ok: true, revisionId: 'rev-new' })
    // refresh() calls listTenantDocumentsAction — return the same doc list (simplified)
    mockList.mockResolvedValue({ documents: [doc1] })

    const { TenantDocumentList } = await import('./TenantDocumentList')
    render(
      <TenantDocumentList
        kind="layout"
        projectId="p-1"
        nodeId="node-1"
        readOnly={false}
        initialDocuments={[doc1]}
      />,
    )

    // Open revision drawer for doc1 (has rev1 + rev2)
    await userEvent.click(screen.getByRole('button', { name: /Revisions/i }))

    // Expand the "Add revision" panel
    await userEvent.click(screen.getByRole('button', { name: /\+ Add revision/i }))

    // Rev-label is pre-filled as "Rev C" (next after Rev A + Rev B); clear and type a custom one
    const revLabelInput = screen.getByPlaceholderText(/Rev B/i)
    await userEvent.clear(revLabelInput)
    await userEvent.type(revLabelInput, 'Rev C')

    // Fill in the optional note
    const noteInput = screen.getByPlaceholderText(/Incorporates landlord comments/i)
    await userEvent.type(noteInput, 'Updated per review')

    // Attach a file via the hidden file input
    const fileInput = screen.getByTestId('add-revision-file-input')
    const file = new File(['pdf-bytes'], 'rev-c.pdf', { type: 'application/pdf' })
    await userEvent.upload(fileInput, file)

    // Submit
    await userEvent.click(screen.getByRole('button', { name: /Upload revision/i }))

    await waitFor(() => {
      // 1. Upload route POSTed
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/tenant-schedule/upload-scope-document',
        expect.objectContaining({ method: 'POST' }),
      )

      // 2. addTenantDocumentRevisionAction called with correct args
      expect(mockAddRevision).toHaveBeenCalledWith(
        'p-1',
        'doc-1',
        expect.objectContaining({
          storagePath: 'proj/node/456-rev-c.pdf',
          fileName: 'rev-c.pdf',
          revLabel: 'Rev C',
          note: 'Updated per review',
        }),
      )

      // 3. onChanged → refresh() → listTenantDocumentsAction re-called
      expect(mockList).toHaveBeenCalledWith('p-1', 'node-1')
    })
  })

  // ── 6. Download in drawer calls getRevisionSignedUrlAction and opens the url ──

  it('download in the drawer calls getRevisionSignedUrlAction and opens the url', async () => {
    const openMock = vi.fn()
    vi.stubGlobal('open', openMock)

    mockGetSignedUrl.mockResolvedValue({ ok: true, url: 'https://cdn.example.com/signed' })

    const { TenantDocumentList } = await import('./TenantDocumentList')
    render(
      <TenantDocumentList
        kind="layout"
        projectId="p-1"
        nodeId="node-1"
        readOnly={false}
        initialDocuments={[doc1]}
      />,
    )

    // Open drawer for doc1
    await userEvent.click(screen.getByRole('button', { name: /Revisions/i }))

    // Click Download on the first (newest) revision
    const downloadButtons = screen.getAllByRole('button', { name: /Download/i })
    await userEvent.click(downloadButtons[0])

    await waitFor(() => {
      expect(mockGetSignedUrl).toHaveBeenCalledWith('p-1', 'rev-1')
      expect(openMock).toHaveBeenCalledWith('https://cdn.example.com/signed', '_blank', 'noopener,noreferrer')
    })
  })

  // ── 6. Delete-document calls deleteTenantDocumentAction after confirm step ──

  it('delete-document calls deleteTenantDocumentAction after confirm step', async () => {
    mockDeleteDocument.mockResolvedValue({ ok: true })

    const { TenantDocumentList } = await import('./TenantDocumentList')
    render(
      <TenantDocumentList
        kind="layout"
        projectId="p-1"
        nodeId="node-1"
        readOnly={false}
        initialDocuments={[doc1, doc2]}
      />,
    )

    // Find delete button for doc1 (first row)
    const deleteButtons = screen.getAllByRole('button', { name: /Delete/i })
    // First click arms the confirm step
    await userEvent.click(deleteButtons[0])

    // A confirm button should now appear
    const confirmBtn = screen.getByRole('button', { name: /Confirm/i })
    await userEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockDeleteDocument).toHaveBeenCalledWith('p-1', 'doc-1')
    })

    // doc1 row should be removed optimistically
    await waitFor(() => {
      expect(screen.queryByText('Electrical Layout')).toBeNull()
    })
  })
})
