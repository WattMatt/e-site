import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@/actions/solar-schedule-template.actions', () => ({ saveOrgScheduleTemplateAction: h.save }))

import { ScheduleTemplateEditor } from './ScheduleTemplateEditor'
import { DEFAULT_SOLAR_SCHEDULE_TEMPLATE } from '@esite/shared'

beforeEach(() => {
  vi.clearAllMocks()
  h.save.mockResolvedValue({ ok: true, updatedAt: 'T2' })
})

describe('ScheduleTemplateEditor', () => {
  it('lists the items and saves them', async () => {
    render(<ScheduleTemplateEditor initialItems={DEFAULT_SOLAR_SCHEDULE_TEMPLATE} updatedAt={null} isDefault />)
    expect(screen.getByDisplayValue('Site survey and design brief')).toBeTruthy()
    expect(screen.getByText('Using the standard programme')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ items: expect.any(Array), expectedUpdatedAt: null }))
    expect(await screen.findByText('Template saved.')).toBeTruthy()
  })
  it('shows row errors and does not save', async () => {
    render(<ScheduleTemplateEditor initialItems={DEFAULT_SOLAR_SCHEDULE_TEMPLATE.slice(0, 2)} updatedAt="T1" isDefault={false} />)
    fireEvent.change(screen.getAllByLabelText('Follows')[1], { target: { value: 'soon' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByText('Row 2: "soon" should look like 1FS+2d, 3SS.')).toBeTruthy()
    expect(h.save).not.toHaveBeenCalled()
  })
  it('shows the action’s refusal', async () => {
    h.save.mockResolvedValue({ error: 'Only an organisation owner or admin can change the schedule template.' })
    render(<ScheduleTemplateEditor initialItems={DEFAULT_SOLAR_SCHEDULE_TEMPLATE.slice(0, 1)} updatedAt={null} isDefault />)
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }))
    expect(await screen.findByText('Only an organisation owner or admin can change the schedule template.')).toBeTruthy()
  })
  it('adds and removes rows', () => {
    render(<ScheduleTemplateEditor initialItems={DEFAULT_SOLAR_SCHEDULE_TEMPLATE.slice(0, 1)} updatedAt={null} isDefault />)
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(screen.getAllByLabelText('Item name')).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove item' })[1])
    expect(screen.getAllByLabelText('Item name')).toHaveLength(1)
  })
})
