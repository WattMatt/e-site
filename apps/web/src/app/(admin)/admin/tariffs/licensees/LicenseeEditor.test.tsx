import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn(), save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/tariff-library.actions', () => ({ addLicenseeAliasAction: h.add, removeLicenseeAliasAction: h.remove, saveLicenseeAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { LicenseeEditor, type LicenseeRow } from './LicenseeEditor'

const rows: LicenseeRow[] = [
  { id: 'l1', name: 'City of Probe', kind: 'development_agency', mdbCode: 'PRB', province: 'GP', nersaLicenceNo: '', updatedAt: 'U1', aliases: ['PROBE'] },
]

beforeEach(() => vi.clearAllMocks())

describe('LicenseeEditor', () => {
  it('a search with no match says so', async () => {
    const user = userEvent.setup()
    render(<LicenseeEditor rows={rows} />)
    await user.type(screen.getByLabelText('Search licensees'), 'zzz')
    expect(screen.getByText('No licensee matches "zzz". Check the spelling, or add it.')).toBeDefined()
  })
  it('the kind is shown in words', () => {
    render(<LicenseeEditor rows={rows} />)
    expect(screen.getByText('Development agency')).toBeDefined()
  })
  it('Add alias shows it is working while the save runs', async () => {
    let finish: (v: { ok: true }) => void = () => {}
    h.add.mockReturnValue(new Promise((r) => { finish = r }))
    const user = userEvent.setup()
    render(<LicenseeEditor rows={rows} />)
    await user.type(screen.getByLabelText('New alias'), 'PROBE MUNI')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(h.add).toHaveBeenCalledWith({ licenseeId: 'l1', alias: 'PROBE MUNI' })
    expect((screen.getByRole('button', { name: /^Add$/ }) as HTMLButtonElement).disabled).toBe(true)
    finish({ ok: true })
  })
})
