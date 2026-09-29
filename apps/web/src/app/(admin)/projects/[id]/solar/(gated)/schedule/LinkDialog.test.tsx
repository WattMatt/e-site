import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LinkDialog } from './LinkDialog'

describe('LinkDialog', () => {
  it('edits type and lag', () => {
    const onSave = vi.fn()
    render(<LinkDialog title="Design → Install" initialType="FS" initialLag={0} canEdit isNew={false} onSave={onSave} onRemove={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Link type'), { target: { value: 'SS' } })
    fireEvent.change(screen.getByLabelText('Lag (days)'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }))
    expect(onSave).toHaveBeenCalledWith('SS', 2)
  })
  it('refuses a lag beyond a year', () => {
    const onSave = vi.fn()
    render(<LinkDialog title="A → B" initialType="FS" initialLag={0} canEdit isNew onSave={onSave} onRemove={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Lag (days)'), { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))
    expect(screen.getByText('Lag must be a whole number of days between -365 and 365.')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })
  it('a new link has nothing to remove', () => {
    render(<LinkDialog title="A → B" initialType="FS" initialLag={0} canEdit isNew onSave={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Remove link' })).toBeNull()
  })
  it('remove needs a second press; View level sees no controls', () => {
    const onRemove = vi.fn()
    const { unmount } = render(<LinkDialog title="A → B" initialType="FF" initialLag={1} canEdit isNew={false} onSave={vi.fn()} onRemove={onRemove} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }))
    expect(onRemove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    expect(onRemove).toHaveBeenCalled()
    unmount()
    render(<LinkDialog title="A → B" initialType="FF" initialLag={1} canEdit={false} isNew={false} onSave={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Save link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove link' })).toBeNull()
    expect(screen.getByText('Finish to finish, lag 1 day')).toBeTruthy()
  })
})
