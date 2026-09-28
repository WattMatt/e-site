import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScheduleRowList } from './ScheduleRowList'
import { buildScheduleRows, GANTT_HEADER_HEIGHT, GANTT_ROW_HEIGHT, type ScheduleTaskView } from '@esite/shared'

const t = (id: string, over: Partial<ScheduleTaskView> = {}): ScheduleTaskView => ({
  id, workItemId: `w${id}`, ref: `SOLAR-${id}`, name: `Task ${id}`, category: 'Design', zone: '', start: '2026-10-01', end: '2026-10-02',
  isMilestone: false, status: 'in_progress', awaitingSignOff: false, progress: 40, colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann',
  sortOrder: Number(id), description: '', updatedAt: 'U', segments: [], ...over,
})
const dt = () => {
  const store: Record<string, string> = {}
  return { setData: (k: string, v: string) => { store[k] = v }, getData: (k: string) => store[k], effectAllowed: '', dropEffect: '' }
}
const noop = () => ({ onToggleSelect: vi.fn(), onToggleGroup: vi.fn(), onOpenTask: vi.fn(), onReorder: vi.fn() })

describe('ScheduleRowList', () => {
  const rows = buildScheduleRows([t('1'), t('2', { awaitingSignOff: true, status: 'done' }), t('3', { category: 'Install' })], 'category', new Set())
  it('renders headers and tasks at the chart’s row height, with progress and sign-off badges', () => {
    const { container } = render(<ScheduleRowList rows={rows} canEdit selected={new Set()} {...noop()} />)
    expect((container.firstChild as HTMLElement).firstChild).toHaveProperty('style.height', `${GANTT_HEADER_HEIGHT}px`)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(5)
    for (const li of items) expect(li.style.height).toBe(`${GANTT_ROW_HEIGHT}px`)
    expect(screen.getAllByText('40%')).toHaveLength(2) // tasks 1 and 3; task 2 is done → 100%
    expect(screen.getByText('100%')).toBeTruthy()
    expect(screen.getByText('Awaiting sign-off')).toBeTruthy()
  })
  it('group headers collapse; task names open the dialog; checkboxes select', () => {
    const cb = noop()
    render(<ScheduleRowList rows={rows} canEdit selected={new Set(['1'])} {...cb} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Design (2)' }))
    expect(cb.onToggleGroup).toHaveBeenCalledWith('category:Design')
    fireEvent.click(screen.getByRole('button', { name: 'SOLAR-3 Task 3' }))
    expect(cb.onOpenTask).toHaveBeenCalledWith('3')
    expect((screen.getByRole('checkbox', { name: 'Select SOLAR-1' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SOLAR-2' }))
    expect(cb.onToggleSelect).toHaveBeenCalledWith('2')
  })
  it('dragging a selected row moves the whole selection before the drop target', () => {
    const cb = noop()
    render(<ScheduleRowList rows={buildScheduleRows([t('1'), t('2'), t('3')], 'none', new Set())} canEdit selected={new Set(['2', '1'])} {...cb} />)
    const transfer = dt()
    fireEvent.dragStart(screen.getAllByRole('button', { name: 'Drag to reorder' })[0], { dataTransfer: transfer })
    fireEvent.drop(screen.getAllByRole('listitem')[2], { dataTransfer: transfer })
    expect(cb.onReorder).toHaveBeenCalledWith(['1', '2'], '3')
  })
  it('dragging an unselected row moves only that row', () => {
    const cb = noop()
    render(<ScheduleRowList rows={buildScheduleRows([t('1'), t('2'), t('3')], 'none', new Set())} canEdit selected={new Set(['1'])} {...cb} />)
    const transfer = dt()
    fireEvent.dragStart(screen.getAllByRole('button', { name: 'Drag to reorder' })[2], { dataTransfer: transfer })
    fireEvent.drop(screen.getAllByRole('listitem')[0], { dataTransfer: transfer })
    expect(cb.onReorder).toHaveBeenCalledWith(['3'], '1')
  })
  it('dropping a row onto itself (or onto a row it is moving) does nothing', () => {
    const cb = noop()
    render(<ScheduleRowList rows={buildScheduleRows([t('1'), t('2'), t('3')], 'none', new Set())} canEdit selected={new Set(['1', '2'])} {...cb} />)
    const transfer = dt()
    fireEvent.dragStart(screen.getAllByRole('button', { name: 'Drag to reorder' })[0], { dataTransfer: transfer })
    fireEvent.drop(screen.getAllByRole('listitem')[1], { dataTransfer: transfer })
    expect(cb.onReorder).not.toHaveBeenCalled()
  })
  it('the drag handle also moves a row from the keyboard (Alt + arrow)', () => {
    const cb = noop()
    render(<ScheduleRowList rows={buildScheduleRows([t('1'), t('2'), t('3')], 'none', new Set())} canEdit selected={new Set()} {...cb} />)
    const handles = screen.getAllByRole('button', { name: 'Drag to reorder' })
    fireEvent.keyDown(handles[2], { key: 'ArrowUp', altKey: true })
    expect(cb.onReorder).toHaveBeenLastCalledWith(['3'], '2')
    fireEvent.keyDown(handles[0], { key: 'ArrowDown', altKey: true })
    expect(cb.onReorder).toHaveBeenLastCalledWith(['1'], '3')
    fireEvent.keyDown(handles[1], { key: 'ArrowDown', altKey: true })
    expect(cb.onReorder).toHaveBeenLastCalledWith(['2'], null)
    cb.onReorder.mockClear()
    fireEvent.keyDown(handles[0], { key: 'ArrowUp', altKey: true }) // already first
    expect(cb.onReorder).not.toHaveBeenCalled()
  })
  it('View level: no checkboxes and no drag handles', () => {
    render(<ScheduleRowList rows={rows} canEdit={false} selected={new Set()} {...noop()} />)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: 'Drag to reorder' })).toHaveLength(0)
  })
})
