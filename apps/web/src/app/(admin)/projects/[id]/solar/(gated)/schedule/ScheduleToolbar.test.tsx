import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { ScheduleToolbar, type ScheduleToolbarProps } from './ScheduleToolbar'
import { EMPTY_SCHEDULE_FILTERS } from '@esite/shared'

function props(over: Partial<ScheduleToolbarProps> = {}): ScheduleToolbarProps {
  return {
    canEdit: true, zoom: 'week', onZoom: vi.fn(), search: '', onSearch: vi.fn(), filters: EMPTY_SCHEDULE_FILTERS, onFilters: vi.fn(),
    owners: [{ id: 'u1', name: 'Ann Smith' }], colours: ['#3b82f6', '#ef4444'],
    presets: [{ id: 'f1', name: 'Late', filters: { ...EMPTY_SCHEDULE_FILTERS, statuses: ['in_progress'] } }],
    onApplyPreset: vi.fn(), onSavePreset: vi.fn(async () => null), onDeletePreset: vi.fn(),
    show: { links: true, milestones: true, split: true }, onShow: vi.fn(), groupBy: 'none', onGroupBy: vi.fn(),
    baselines: [{ id: 'b1', name: 'Contract', description: null, createdAt: '2026-09-01T10:00:00Z', durationMode: 'calendar' }],
    compareId: null, onCompare: vi.fn(), onSaveBaseline: vi.fn(async () => null), onDeleteBaseline: vi.fn(),
    settings: { durationMode: 'calendar', workloadThreshold: 2, updatedAt: null }, onSaveSettings: vi.fn(async () => null),
    canUndo: true, canRedo: false, onUndo: vi.fn(), onRedo: vi.fn(),
    onAddTask: vi.fn(), onAddMilestone: vi.fn(), onUseTemplate: vi.fn(), onImport: vi.fn(), onToday: vi.fn(), onShiftRange: vi.fn(), onHelp: vi.fn(),
    exportBase: '/api/projects/p1/solar/schedule/export', onExportPng: vi.fn(), searchRef: createRef<HTMLInputElement>(),
    ...over,
  }
}

describe('ScheduleToolbar', () => {
  it('View level sees view controls only (edit controls are not rendered)', () => {
    render(<ScheduleToolbar {...props({ canEdit: false })} />)
    for (const name of ['Add task', 'Add milestone', 'Use template', 'Import', 'Undo', 'Redo', 'Schedule settings']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.getByRole('button', { name: 'Week' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Export/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Baselines' }))
    expect(screen.queryByRole('button', { name: 'Save current as baseline' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete baseline Contract' })).toBeNull()
  })
  it('edit controls report their presses; undo/redo follow the stack', () => {
    const p = props()
    render(<ScheduleToolbar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add milestone' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(p.onAddTask).toHaveBeenCalled()
    expect(p.onAddMilestone).toHaveBeenCalled()
    expect(p.onUndo).toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('zoom, search with clear, group by and show toggles report changes', () => {
    const p = props({ search: 'inst' })
    render(<ScheduleToolbar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Day' }))
    expect(p.onZoom).toHaveBeenCalledWith('day')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'design' } })
    expect(p.onSearch).toHaveBeenCalledWith('design')
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(p.onSearch).toHaveBeenCalledWith('')
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'category_zone' } })
    expect(p.onGroupBy).toHaveBeenCalledWith('category_zone')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dependencies' }))
    expect(p.onShow).toHaveBeenCalledWith({ links: false, milestones: true, split: true })
  })
  it('filters: colours in use, the owners passed in, save a preset to the database, apply one', async () => {
    const p = props({ filters: { ...EMPTY_SCHEDULE_FILTERS, statuses: ['done'] } })
    render(<ScheduleToolbar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Filters (1)' }))
    expect(screen.getByRole('checkbox', { name: '#ef4444' })).toBeTruthy()
    // The owner list is exactly the `owners` prop (whoever owns a task; ScheduleClient builds it).
    expect(screen.getAllByRole('checkbox').filter((c) => c.getAttribute('data-owner') !== null)).toHaveLength(1)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ann Smith' }))
    expect(p.onFilters).toHaveBeenCalledWith({ ...EMPTY_SCHEDULE_FILTERS, statuses: ['done'], ownerIds: ['u1'] })
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Done only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as preset' }))
    await waitFor(() => expect(p.onSavePreset).toHaveBeenCalledWith('Done only'))
    expect(await screen.findByText('Preset saved.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Late' }))
    expect(p.onApplyPreset).toHaveBeenCalledWith('f1')
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(p.onFilters).toHaveBeenCalledWith(EMPTY_SCHEDULE_FILTERS)
  })
  it('a preset is deleted only after a second press', () => {
    const p = props()
    render(<ScheduleToolbar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete preset Late' }))
    expect(p.onDeletePreset).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete preset Late' }))
    expect(p.onDeletePreset).toHaveBeenCalledWith('f1')
  })
  it('baselines: save with a name, compare, and delete only after a second press', async () => {
    const p = props()
    render(<ScheduleToolbar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Baselines' }))
    fireEvent.change(screen.getByLabelText('Baseline name'), { target: { value: 'Tender' } })
    fireEvent.change(screen.getByLabelText('Baseline description'), { target: { value: 'As tendered' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save current as baseline' }))
    await waitFor(() => expect(p.onSaveBaseline).toHaveBeenCalledWith('Tender', 'As tendered'))
    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'b1' } })
    expect(p.onCompare).toHaveBeenCalledWith('b1')
    fireEvent.click(screen.getByRole('button', { name: 'Delete baseline Contract' }))
    expect(p.onDeleteBaseline).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Contract' }))
    expect(p.onDeleteBaseline).toHaveBeenCalledWith('b1')
  })
  it('export menu links to the server formats and exports PNG in the browser', () => {
    const p = props({ canEdit: false })
    render(<ScheduleToolbar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    expect(screen.getByRole('link', { name: 'PDF (A3 landscape)' }).getAttribute('href')).toBe('/api/projects/p1/solar/schedule/export/pdf')
    expect(screen.getByRole('link', { name: 'Excel' }).getAttribute('href')).toBe('/api/projects/p1/solar/schedule/export/xlsx')
    expect(screen.getByRole('link', { name: 'Calendar (.ics)' }).getAttribute('href')).toBe('/api/projects/p1/solar/schedule/export/ics')
    fireEvent.click(screen.getByRole('button', { name: 'Image (PNG)' }))
    expect(p.onExportPng).toHaveBeenCalled()
  })
  it('export menu offers no Word document (owner decision Q7)', () => {
    render(<ScheduleToolbar {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    const menu = screen.getByRole('menu')
    expect(menu.textContent ?? '').not.toMatch(/word|docx/i)
    for (const a of menu.querySelectorAll('a')) expect(a.getAttribute('href') ?? '').not.toMatch(/docx/)
    expect(menu.querySelectorAll('a')).toHaveLength(3)
  })
  it('settings: working days and the workload limit', async () => {
    const p = props()
    render(<ScheduleToolbar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Schedule settings' }))
    expect((screen.getByLabelText('Flag an owner with more than this many tasks at once') as HTMLInputElement).value).toBe('2')
    fireEvent.click(screen.getByRole('radio', { name: 'Working days (weekends and SA public holidays excluded)' }))
    fireEvent.change(screen.getByLabelText('Flag an owner with more than this many tasks at once'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(p.onSaveSettings).toHaveBeenCalledWith('working', 3))
  })
  it('settings: a limit outside 1–50 is refused with a sentence, not sent', () => {
    const p = props()
    render(<ScheduleToolbar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Schedule settings' }))
    fireEvent.change(screen.getByLabelText('Flag an owner with more than this many tasks at once'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(screen.getByText('The workload limit must be a whole number from 1 to 50.')).toBeTruthy()
    expect(p.onSaveSettings).not.toHaveBeenCalled()
  })
})
