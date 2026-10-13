import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const m = vi.hoisted(() => ({ prepare: vi.fn(), register: vi.fn(), upload: vi.fn(), navigate: vi.fn(), bucket: vi.fn() }))
vi.mock('@/actions/tenant-plan-sheets.actions', () => ({
  prepareTenantPlanUploadAction: (...a: unknown[]) => m.prepare(...a),
  registerTenantPlanSheetsAction: (...a: unknown[]) => m.register(...a),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ storage: { from: (b: string) => { m.bucket(b); return { uploadToSignedUrl: (...a: unknown[]) => m.upload(...a) } } } }),
}))
vi.mock('@/lib/status-plans/navigate', () => ({ navigateTo: (...a: unknown[]) => m.navigate(...a) }))

import { TenantPlanUploader } from './TenantPlanUploader'

const f1 = new File(['%PDF'], 'E-300.pdf', { type: 'application/pdf' })
const f2 = new File(['png'], 'Mall GF.png', { type: 'image/png' })
const choose = (files: File[]) => fireEvent.change(screen.getByLabelText(/choose files/i), { target: { files } })

beforeEach(() => {
  vi.clearAllMocks()
  m.prepare.mockResolvedValue({ ok: true, data: { planId: 'pl1', uploads: [
    { path: 'o/p/pl1/a/1.pdf', token: 't1', mime: 'application/pdf' },
    { path: 'o/p/pl1/b/1.png', token: 't2', mime: 'image/png' },
  ] } })
  m.upload.mockResolvedValue({ error: null })
  m.register.mockResolvedValue({ ok: true, data: { sheets: [{ id: 'a' }, { id: 'a2' }, { id: 'b' }] } })
})

describe('TenantPlanUploader', () => {
  it('prepares, uploads each file straight to storage, registers, then opens the first new sheet', async () => {
    render(<TenantPlanUploader projectId="p1" purpose="tenant_layout" />)
    choose([f1, f2])
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith('/projects/p1/tenant-schedule/floor-plan?sheet=a'))
    expect(m.prepare).toHaveBeenCalledWith({ projectId: 'p1', purpose: 'tenant_layout', files: [
      { name: 'E-300.pdf', size: 4, type: 'application/pdf' },
      { name: 'Mall GF.png', size: 3, type: 'image/png' },
    ] })
    expect(m.bucket).toHaveBeenCalledWith('tenant-plan-files')
    expect(m.upload.mock.calls.map((c) => [c[0], c[1], c[2], c[3]])).toEqual([
      ['o/p/pl1/a/1.pdf', 't1', f1, { contentType: 'application/pdf' }],
      ['o/p/pl1/b/1.png', 't2', f2, { contentType: 'image/png' }],
    ])
    expect(m.register).toHaveBeenCalledWith({ planId: 'pl1', files: [
      { path: 'o/p/pl1/a/1.pdf', fileName: 'E-300.pdf', mime: 'application/pdf' },
      { path: 'o/p/pl1/b/1.png', fileName: 'Mall GF.png', mime: 'image/png' },
    ] })
  })

  it('a refusal from the server is shown and nothing is uploaded', async () => {
    m.prepare.mockResolvedValue({ ok: false, error: 'E-100.dwg is not a PDF, PNG or JPEG.' })
    render(<TenantPlanUploader projectId="p1" purpose="tenant_layout" />)
    choose([f1])
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('E-100.dwg is not a PDF, PNG or JPEG.')).toBeTruthy()
    expect(m.upload).not.toHaveBeenCalled()
    expect(m.navigate).not.toHaveBeenCalled()
  })

  it('a failed upload names the file and registers nothing', async () => {
    m.upload.mockResolvedValueOnce({ error: { message: 'Payload too large' } })
    render(<TenantPlanUploader projectId="p1" purpose="distribution_schematic" label="Add sheets" />)
    expect(screen.getByRole('button', { name: 'Add sheets' })).toBeTruthy()
    choose([f1, f2])
    expect(await screen.findByText('Uploading E-300.pdf failed. Try again.')).toBeTruthy()
    expect(m.register).not.toHaveBeenCalled()
  })
})
