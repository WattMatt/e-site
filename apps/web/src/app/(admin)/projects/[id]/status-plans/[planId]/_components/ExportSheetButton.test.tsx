import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportSheetButton } from './ExportSheetButton'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('ExportSheetButton', () => {
  it('downloads the sheet under the name the server put on the signed URL it redirected to', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/s')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    // fetch followed the route's 303 to storage: Content-Disposition is not CORS-exposed there, so the
    // name comes from the signed URL's `download` parameter.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      url: 'https://ref.supabase.co/storage/v1/object/sign/reports/o/p/status-plans/s/sheet.pdf?token=t&download=mb-3-1-p1-2026-10-09.pdf',
      headers: new Headers(),
      blob: () => Promise.resolve(new Blob(['%PDF'])),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ExportSheetButton projectId="p" planId="s" />)
    await userEvent.click(screen.getByRole('button', { name: /export sheet/i }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/p/status-plans/s/sheet')
    const a = click.mock.contexts[0] as HTMLAnchorElement
    expect(a.download).toBe('mb-3-1-p1-2026-10-09.pdf')
    expect(a.href).toBe('blob:http://localhost/s')
  })
  it('shows the server sentence when the sheet cannot be exported, and downloads nothing', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, json: () => Promise.resolve({ error: 'This sheet could not be exported: the drawing PDF is password-protected.' }) }))
    render(<ExportSheetButton projectId="p" planId="s" />)
    await userEvent.click(screen.getByRole('button', { name: /export sheet/i }))
    expect((await screen.findByRole('alert')).textContent).toContain('password-protected')
    expect(click).not.toHaveBeenCalled()
  })
  it('a network failure says so', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    render(<ExportSheetButton projectId="p" planId="s" />)
    await userEvent.click(screen.getByRole('button', { name: /export sheet/i }))
    expect((await screen.findByRole('alert')).textContent).toContain('check your connection')
  })
})
