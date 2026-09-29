import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ ensure: vi.fn(), register: vi.fn(), parse: vi.fn() }))
vi.mock('@/actions/solar-load.actions', () => ({ ensureSolarStudyAction: h.ensure }))
vi.mock('@/lib/solar/load/import-client', async (orig) => ({ ...(await orig<object>()), registerRawFile: h.register, parseFiles: h.parse }))

import { UploadMeterFiles } from './UploadMeterFiles'

const SHA = 'b'.repeat(64)
beforeEach(() => {
  vi.clearAllMocks()
  h.ensure.mockResolvedValue({ ok: true, studyId: 's1', updatedAt: 'T0' })
  h.register.mockResolvedValue({ ok: true, fileId: 'f1', duplicate: false })
  h.parse.mockResolvedValue({ reviews: [{ fileId: 'f1' }], failed: [] })
})

describe('UploadMeterFiles', () => {
  it('uploads to <org>/<project>/<sha>.<ext>, registers, parses and hands the reviews over', async () => {
    const upload = vi.fn(async () => null)
    const onReviews = vi.fn()
    render(<UploadMeterFiles projectId="p1" orgId="o1" label="Upload meter files" accept=".csv,.txt,.xlsx,.xls" onReviews={onReviews} upload={upload} hash={async () => SHA} />)
    await userEvent.upload(screen.getByLabelText('Upload meter files'), new File(['date,p14\n'], 'Shop 12.csv', { type: 'text/csv' }))
    expect(upload).toHaveBeenCalledWith(`o1/p1/${SHA}.csv`, expect.any(File))
    expect(h.register).toHaveBeenCalledWith('p1', `o1/p1/${SHA}.csv`, 'Shop 12.csv')
    expect(h.parse).toHaveBeenCalledWith('p1', ['f1'])
    expect(onReviews).toHaveBeenCalledWith([{ fileId: 'f1' }])
  })
  it('refuses a wrong extension and an oversized file before uploading', async () => {
    const upload = vi.fn(async () => null)
    render(<UploadMeterFiles projectId="p1" orgId="o1" label="Upload meter files" accept=".csv,.txt,.xlsx,.xls" onReviews={vi.fn()} upload={upload} hash={async () => SHA} />)
    const big = new File(['x'], 'big.csv')
    Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 })
    await userEvent.upload(screen.getByLabelText('Upload meter files'), [new File(['x'], 'a.pdf'), big], { applyAccept: false })
    expect(upload).not.toHaveBeenCalled()
    expect(screen.getByText(/a\.pdf: only \.csv, \.txt, \.xlsx or \.xls/)).toBeTruthy()
    expect(screen.getByText(/big\.csv: larger than 50 MB/)).toBeTruthy()
  })
  it('shows the duplicate-elsewhere sentence', async () => {
    h.register.mockResolvedValue({ ok: false, error: 'duplicate_in_other_project', message: 'Same data as Shop 7 at YA — use Copy from org meter library.' })
    render(<UploadMeterFiles projectId="p1" orgId="o1" label="Upload meter files" accept=".csv" onReviews={vi.fn()} upload={async () => null} hash={async () => SHA} />)
    await userEvent.upload(screen.getByLabelText('Upload meter files'), new File(['x'], 'a.csv'))
    expect(await screen.findByText(/Same data as Shop 7 at YA/)).toBeTruthy()
  })
})
