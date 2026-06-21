import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }))

const PROJECT_ID = '00000000-0000-0000-0000-000000000011'

describe('TenantScheduleReportButton', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('refreshes the page after a successful Save to project', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/x')
    URL.revokeObjectURL = vi.fn()
    const fetchMock = vi.fn()
      // openPreview → blob
      .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(['%PDF'], { type: 'application/pdf' })) })
      // save → 201
      .mockResolvedValueOnce({ status: 201, json: () => Promise.resolve({ reportId: 'r1', version: 1 }) })
    vi.stubGlobal('fetch', fetchMock)

    const { TenantScheduleReportButton } = await import('./TenantScheduleReportButton')
    render(<TenantScheduleReportButton projectId={PROJECT_ID} />)

    await userEvent.click(screen.getByRole('button', { name: /generate report/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /save to project/i })).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: /save to project/i }))

    await waitFor(() => expect(refreshMock).toHaveBeenCalled())
  })
})
