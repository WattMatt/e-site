import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ commit: vi.fn(), parse: vi.fn() }))
vi.mock('@/lib/solar/load/import-client', async (orig) => ({ ...(await orig<object>()), commitReview: h.commit, parseFiles: h.parse }))

import { ImportReviewDialog } from './ImportReviewDialog'
import { review } from './review-fixture'

const nodes = [{ id: 'n12', label: '12 · Pep', shopNumber: '12' }]
beforeEach(() => { vi.clearAllMocks(); h.commit.mockResolvedValue({ ok: true, meterLabel: 'PEP' }) })

describe('ImportReviewDialog', () => {
  it('accepts a clean file and finishes', async () => {
    const onFinished = vi.fn()
    render(<ImportReviewDialog projectId="p1" reviews={[review()]} nodes={nodes} studyMeters={[]} editMeterId={null} onClose={vi.fn()} onFinished={onFinished} />)
    expect(screen.getByRole('region', { name: 'Validation summary' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Accept & import' }))
    expect(h.commit).toHaveBeenCalledWith('p1', expect.objectContaining({ mode: 'series', fileId: 'f1' }))
    expect(onFinished).toHaveBeenCalledWith({ imported: 1, skipped: 0, registers: 0 })
  })
  it('keeps Accept disabled until an identity conflict is overridden with a reason', async () => {
    const r = review({ identity: { sourceSerials: ['S'], filenameSerial: null, conflicts: [{ kind: 'same_body', message: 'Same data as Shop 7 at YA.', meterId: 'm7' }], blocking: true } })
    render(<ImportReviewDialog projectId="p1" reviews={[r]} nodes={nodes} studyMeters={[]} editMeterId={null} onClose={vi.fn()} onFinished={vi.fn()} />)
    expect(screen.getByText('Same data as Shop 7 at YA.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Accept & import' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByLabelText('Override with reason'))
    await userEvent.type(screen.getByLabelText('Override reason'), 'Different tenant on the same CT')
    expect((screen.getByRole('button', { name: 'Accept & import' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('a generic unit must be chosen and the preview re-run before Accept', async () => {
    const r = review({ canAccept: false, choicesNeeded: ['unknown_unit'], channels: [{ ...review().channels[0], sourceUnit: 'unknown', storedUnit: 'unknown', unitFromTable: false }] })
    h.parse.mockResolvedValue({ reviews: [review()], failed: [] })
    render(<ImportReviewDialog projectId="p1" reviews={[r]} nodes={nodes} studyMeters={[]} editMeterId={null} onClose={vi.fn()} onFinished={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText('Unit for p14'), 'kWh')
    await userEvent.click(screen.getByRole('button', { name: 'Re-run preview' }))
    expect(h.parse).toHaveBeenCalledWith('p1', ['f1'], { f1: { units: { p14: 'kWh' }, areaM2: 120 } })
    expect((screen.getByRole('button', { name: 'Accept & import' }) as HTMLButtonElement).disabled).toBe(false)
  })
  it('a file with errors offers Skip with the reason pre-filled', async () => {
    const r = review({ canAccept: false, blockingErrors: ['low_completeness'], report: { ...review().report, errors: [{ code: 'low_completeness', message: 'Only 31 % of intervals have data.' }] } as never })
    render(<ImportReviewDialog projectId="p1" reviews={[r]} nodes={nodes} studyMeters={[]} editMeterId={null} onClose={vi.fn()} onFinished={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Skip this file' }))
    expect(h.commit).toHaveBeenCalledWith('p1', { mode: 'skip', fileId: 'f1', reason: 'Cannot import: Only 31 % of intervals have data.' })
  })
  it('a meter register imports as a register', async () => {
    const r = review({ outcome: 'register', registerRows: 21, canAccept: false, channels: [] })
    render(<ImportReviewDialog projectId="p1" reviews={[r]} nodes={nodes} studyMeters={[]} editMeterId={null} onClose={vi.fn()} onFinished={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Import register (21 rows)' }))
    expect(h.commit).toHaveBeenCalledWith('p1', { mode: 'register', fileId: 'f1', siteLabel: 'SITE YA' })
  })

  it('a 409 identity conflict from the server opens the conflict panel instead of dead-ending (LS-01)', async () => {
    const identity = { sourceSerials: [], filenameSerial: null, conflicts: [{ kind: 'same_body', meterId: 'm7', message: 'Same data as Shop 7 at YA.' }], blocking: true }
    h.commit.mockResolvedValueOnce({ ok: false, message: 'Resolve the identity conflict first: link to the existing meter, skip, or override with a reason.', identity })
    render(<ImportReviewDialog projectId="p1" reviews={[review()]} nodes={nodes} studyMeters={[]} editMeterId={null} onClose={vi.fn()} onFinished={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Accept & import' }))
    expect(screen.getByText('Same data as Shop 7 at YA.')).toBeTruthy()
    expect((screen.getByLabelText('Skip this file (recommended)') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByLabelText('Override with reason')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Skip this file' }))
    expect(h.commit).toHaveBeenLastCalledWith('p1', { mode: 'skip', fileId: 'f1', reason: 'Duplicate data: Same data as Shop 7 at YA.' })
  })
  it('an exact duplicate offers Skip first and warns against merging or double-counting (LS-07)', async () => {
    const r = review({ identity: { sourceSerials: [], filenameSerial: null, conflicts: [{ kind: 'same_body', message: 'Same data as Shop 7 at YA.', meterId: 'm7' }], blocking: true } })
    render(<ImportReviewDialog projectId="p1" reviews={[r]} nodes={nodes} studyMeters={[]} editMeterId={null} onClose={vi.fn()} onFinished={vi.fn()} />)
    const radios = screen.getAllByRole('radio', { name: /Skip this file|Link to existing meter|Override with reason/ })
    expect(radios.map((x) => (x as HTMLInputElement).labels?.[0]?.textContent?.trim())).toEqual(['Skip this file (recommended)', 'Link to existing meter', 'Override with reason'])
    expect(screen.getByText(/usually the portal returning another meter's data/)).toBeTruthy()
    expect(screen.getByText(/counts the load twice/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Accept & import' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('a same-upload duplicate can link to the meter the earlier file just created (LS-01)', async () => {
    h.commit.mockResolvedValueOnce({ ok: true, meterId: 'mNew', meterLabel: 'PEP' })
    const second = review({ fileId: 'f2', fileName: 'copy.csv', identity: { sourceSerials: [], filenameSerial: null, conflicts: [{ kind: 'same_body', message: 'Same data as f1.csv in this upload.', fileId: 'f1' }], blocking: true } })
    render(<ImportReviewDialog projectId="p1" reviews={[review(), second]} nodes={nodes} studyMeters={[]} editMeterId={null} onClose={vi.fn()} onFinished={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Accept & import' }))
    await userEvent.click(screen.getByLabelText('Link to existing meter'))
    expect((screen.getByLabelText('Existing meter') as HTMLSelectElement).value).toBe('mNew')
    await userEvent.click(screen.getByRole('button', { name: 'Accept & import' }))
    expect(h.commit).toHaveBeenLastCalledWith('p1', expect.objectContaining({ fileId: 'f2', meter: { existingMeterId: 'mNew' }, identity: { resolution: 'link' } }))
  })
})
