import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { PlanSheet } from '@/lib/status-plans/types'

const m = vi.hoisted(() => ({ rename: vi.fn(), del: vi.fn(), prep: vi.fn(), replace: vi.fn(), upload: vi.fn(), navigate: vi.fn() }))
vi.mock('@/actions/tenant-plan-sheets.actions', () => ({
  renameTenantPlanSheetAction: (...a: unknown[]) => m.rename(...a),
  deleteTenantPlanSheetAction: (...a: unknown[]) => m.del(...a),
  prepareTenantPlanSheetReplaceAction: (...a: unknown[]) => m.prep(...a),
  replaceTenantPlanSheetAction: (...a: unknown[]) => m.replace(...a),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: (...a: unknown[]) => m.upload(...a) }) } }) }))
vi.mock('@/lib/status-plans/navigate', () => ({ navigateTo: (...a: unknown[]) => m.navigate(...a) }))

import { SheetControls } from './SheetControls'

const SHEET: PlanSheet = {
  id: 'sh1', label: 'Ground floor', sortOrder: 0, fileName: 'E-100.pdf', mime: 'application/pdf', pageIndex: 2, revision: 1,
  replacedAt: null, pixelsPerMeter: 20, updatedAt: 'u0', signedUrl: 'https://s/x', isPdf: true,
}
const base = { projectId: 'p1', purpose: 'tenant_layout' as const, sheet: SHEET, shapeCount: 3 }

beforeEach(() => {
  vi.clearAllMocks()
  m.upload.mockResolvedValue({ error: null })
})

describe('SheetControls', () => {
  it('rename saves the trimmed label conditionally and hands the stored sheet back', async () => {
    const onChanged = vi.fn()
    m.rename.mockResolvedValue({ ok: true, data: { ...SHEET, label: 'Level 1', updatedAt: 'u1' } })
    render(<SheetControls {...base} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Sheet name'), { target: { value: ' Level 1 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ label: 'Level 1' })))
    expect(m.rename).toHaveBeenCalledWith({ sheetId: 'sh1', expectedUpdatedAt: 'u0', label: ' Level 1 ' })
  })

  it('delete takes two presses, names the shapes it takes with it, then leaves the sheet', async () => {
    m.del.mockResolvedValue({ ok: true, data: { id: 'sh1' } })
    render(<SheetControls {...base} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete sheet' }))
    expect(m.del).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Press again to delete this sheet and its 3 shapes' }))
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith('/projects/p1/tenant-schedule/floor-plan'))
    expect(m.del).toHaveBeenCalledWith({ sheetId: 'sh1', expectedUpdatedAt: 'u0' })
  })

  it('replace: prepare, upload to the signed path, swap with the chosen page, reopen the sheet', async () => {
    m.prep.mockResolvedValue({ ok: true, data: { path: 'o/p/pl/sh1/2.pdf', token: 'tk', mime: 'application/pdf' } })
    m.replace.mockResolvedValue({ ok: true, data: { ...SHEET, revision: 2 } })
    render(<SheetControls {...base} onChanged={vi.fn()} />)
    expect((screen.getByLabelText('Page in the new file') as HTMLInputElement).value).toBe('2')
    fireEvent.change(screen.getByLabelText('Page in the new file'), { target: { value: '3' } })
    const file = new File(['%PDF'], 'E-100 rev C.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Choose the replacement file'), { target: { files: [file] } })
    await waitFor(() => expect(m.navigate).toHaveBeenCalledWith('/projects/p1/tenant-schedule/floor-plan?sheet=sh1'))
    expect(m.prep).toHaveBeenCalledWith({ sheetId: 'sh1', file: { name: 'E-100 rev C.pdf', size: 4, type: 'application/pdf' } })
    expect(m.upload).toHaveBeenCalledWith('o/p/pl/sh1/2.pdf', 'tk', file, { contentType: 'application/pdf' })
    expect(m.replace).toHaveBeenCalledWith({ sheetId: 'sh1', expectedUpdatedAt: 'u0', path: 'o/p/pl/sh1/2.pdf', fileName: 'E-100 rev C.pdf', mime: 'application/pdf', pageIndex: 3 })
  })

  it('a refused replace shows the sentence and stays on the page', async () => {
    m.prep.mockResolvedValue({ ok: true, data: { path: 'o/p/pl/sh1/2.pdf', token: 'tk', mime: 'application/pdf' } })
    m.replace.mockResolvedValue({ ok: false, error: 'E-100 rev C.pdf has 2 pages; pick a page from 1 to 2.' })
    render(<SheetControls {...base} onChanged={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Choose the replacement file'), { target: { files: [new File(['%PDF'], 'E-100 rev C.pdf', { type: 'application/pdf' })] } })
    expect(await screen.findByText('E-100 rev C.pdf has 2 pages; pick a page from 1 to 2.')).toBeTruthy()
    expect(m.navigate).not.toHaveBeenCalled()
  })
})
