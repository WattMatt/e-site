import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { solarOrgSettingDefaults, solarSettingsToForm } from '@esite/shared'

const h = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/solar-settings.actions', () => ({ saveSolarOrgSettingsAction: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))

import { SolarSettingsForm } from './SolarSettingsForm'

const initial = solarSettingsToForm(solarOrgSettingDefaults())

beforeEach(() => { vi.clearAllMocks(); h.save.mockResolvedValue({ ok: true, updatedAt: 'T1' }) })

describe('SolarSettingsForm', () => {
  it('shows the seeded defaults with units', () => {
    render(<SolarSettingsForm initial={initial} updatedAt={null} />)
    expect((screen.getByLabelText('Discount rate (%)') as HTMLInputElement).value).toBe('11')
    expect((screen.getByLabelText('O&M (R/kWp/yr)') as HTMLInputElement).value).toBe('150')
    expect((screen.getByLabelText('Section 12B allowance on by default') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText('Finance defaults')).toBeDefined()
    expect(screen.getByText('Loss defaults')).toBeDefined()
  })

  it('an out-of-range value blocks the save with its sentence', async () => {
    const user = userEvent.setup()
    render(<SolarSettingsForm initial={initial} updatedAt={null} />)
    const field = screen.getByLabelText('Availability (%)')
    await user.clear(field)
    await user.type(field, '120')
    await user.click(screen.getByRole('button', { name: 'Save defaults' }))
    expect(screen.getByText('Must be between 50 and 100 %')).toBeDefined()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('saves the form with the stale token and then uses the new one', async () => {
    const user = userEvent.setup()
    render(<SolarSettingsForm initial={initial} updatedAt="T0" />)
    await user.click(screen.getByLabelText('Section 12B allowance on by default'))
    await user.click(screen.getByRole('button', { name: 'Save defaults' }))
    expect(h.save).toHaveBeenCalledWith({ form: { ...initial, section_12b_default: true }, expectedUpdatedAt: 'T0' })
    expect(await screen.findByText('Saved')).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Save defaults' }))
    expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ expectedUpdatedAt: 'T1' }))
  })

  it('shows the stale sentence', async () => {
    h.save.mockResolvedValueOnce({ error: 'Someone else changed this — reload to see their version.' })
    render(<SolarSettingsForm initial={initial} updatedAt="T0" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save defaults' }))
    expect(await screen.findByText('Someone else changed this — reload to see their version.')).toBeDefined()
  })
})
