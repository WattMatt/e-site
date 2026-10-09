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
  function stubPdfFetch() {
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/x')
    URL.revokeObjectURL = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}), blob: () => Promise.resolve(new Blob(['%PDF'], { type: 'application/pdf' })) })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('previews with tenant plans by default and schematics off', async () => {
    const fetchMock = stubPdfFetch()
    const { TenantScheduleReportButton } = await import('./TenantScheduleReportButton')
    render(<TenantScheduleReportButton projectId={PROJECT_ID} />)
    await userEvent.click(screen.getByRole('button', { name: /generate report/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/projects/${PROJECT_ID}/tenant-schedule/report-preview?tenantPlans=1`)
    expect((screen.getByRole('checkbox', { name: /tenant status plans/i }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: /distribution schematics/i }) as HTMLInputElement).checked).toBe(false)
  })

  it('ticking schematics re-renders, and Save carries the same choice', async () => {
    const fetchMock = stubPdfFetch()
    const { TenantScheduleReportButton } = await import('./TenantScheduleReportButton')
    render(<TenantScheduleReportButton projectId={PROJECT_ID} />)
    await userEvent.click(screen.getByRole('button', { name: /generate report/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((screen.getByRole('checkbox', { name: /distribution schematics/i }) as HTMLInputElement).disabled).toBe(false))
    await userEvent.click(screen.getByRole('checkbox', { name: /distribution schematics/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/projects/${PROJECT_ID}/tenant-schedule/report-preview?tenantPlans=1&schematicPlans=1`)
    await waitFor(() => expect((screen.getByRole('button', { name: /save to project/i }) as HTMLButtonElement).disabled).toBe(false))
    await userEvent.click(screen.getByRole('button', { name: /save to project/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[2]![0]).toBe(`/api/projects/${PROJECT_ID}/tenant-schedule/reports?tenantPlans=1&schematicPlans=1`)
    expect(fetchMock.mock.calls[2]![1]).toEqual({ method: 'POST' })
  })
})
