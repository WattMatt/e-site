import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
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

  it('overlapping previews: the stale response is ignored and the previous fetch is aborted', async () => {
    const created: string[] = []
    URL.createObjectURL = vi.fn((b: Blob) => { const u = `blob:${(b as unknown as { tag: string }).tag}`; created.push(u); return u })
    URL.revokeObjectURL = vi.fn()
    const pending: Array<{ resolve: (v: unknown) => void; signal: AbortSignal | undefined }> = []
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((resolve) => { pending.push({ resolve, signal: init?.signal }) }))
    vi.stubGlobal('fetch', fetchMock)
    const respond = (i: number, tag: string) => pending[i]!.resolve({ ok: true, blob: () => Promise.resolve(Object.assign(new Blob(['%PDF']), { tag })) })

    const { TenantScheduleReportButton } = await import('./TenantScheduleReportButton')
    render(<TenantScheduleReportButton projectId={PROJECT_ID} />)
    const generate = screen.getByRole('button', { name: /generate report/i })
    fireEvent.click(generate)
    fireEvent.click(generate)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(pending[0]!.signal?.aborted).toBe(true)
    expect(pending[1]!.signal?.aborted).toBe(false)

    // The newer request answers first, then the stale one arrives late.
    await act(async () => { respond(1, 'new'); await Promise.resolve() })
    await waitFor(() => expect(created).toEqual(['blob:new']))
    await act(async () => { respond(0, 'old'); await Promise.resolve(); await Promise.resolve() })
    expect(created).toEqual(['blob:new'])
    expect(screen.getByTitle(/report preview/i).getAttribute('src')).toBe('blob:new')
  })

  it('closing while a preview is in flight aborts it and never creates a blob', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:late')
    URL.revokeObjectURL = vi.fn()
    let resolve!: (v: unknown) => void
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: { signal?: AbortSignal }) => { signal = init?.signal; return new Promise((r) => { resolve = r }) }))
    const { TenantScheduleReportButton } = await import('./TenantScheduleReportButton')
    render(<TenantScheduleReportButton projectId={PROJECT_ID} />)
    fireEvent.click(screen.getByRole('button', { name: /generate report/i }))
    await waitFor(() => expect(signal).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }))
    expect(signal!.aborted).toBe(true)
    await act(async () => { resolve({ ok: true, blob: () => Promise.resolve(new Blob(['%PDF'])) }); await Promise.resolve(); await Promise.resolve() })
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})
