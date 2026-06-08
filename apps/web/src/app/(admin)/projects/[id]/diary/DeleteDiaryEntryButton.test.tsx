import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { DeleteDiaryEntryButton } from './DeleteDiaryEntryButton'

const { deleteMock, refreshMock } = vi.hoisted(() => ({ deleteMock: vi.fn(), refreshMock: vi.fn() }))
vi.mock('@/actions/diary.actions', () => ({
  deleteDiaryEntryAction: (...args: unknown[]) => deleteMock(...args),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }))

beforeEach(() => vi.clearAllMocks())

describe('DeleteDiaryEntryButton', () => {
  it('shows "Delete" initially and calls nothing', () => {
    render(<DeleteDiaryEntryButton entryId="e1" />)
    expect(screen.getByText('Delete')).toBeDefined()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('arms on the first click without calling the action', () => {
    render(<DeleteDiaryEntryButton entryId="e1" />)
    fireEvent.click(screen.getByText('Delete'))
    expect(screen.getByText('Confirm delete?')).toBeDefined()
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('calls deleteDiaryEntryAction + router.refresh on the second click', async () => {
    deleteMock.mockResolvedValue({})
    render(<DeleteDiaryEntryButton entryId="e1" />)
    fireEvent.click(screen.getByText('Delete'))            // arm
    await act(async () => {
      fireEvent.click(screen.getByText('Confirm delete?')) // commit
    })
    expect(deleteMock).toHaveBeenCalledWith('e1')
    expect(refreshMock).toHaveBeenCalled()
  })

  it('shows the error and does not refresh when the action fails', async () => {
    deleteMock.mockResolvedValue({ error: 'nope' })
    render(<DeleteDiaryEntryButton entryId="e1" />)
    fireEvent.click(screen.getByText('Delete'))
    await act(async () => {
      fireEvent.click(screen.getByText('Confirm delete?'))
    })
    expect(screen.getByText('nope')).toBeDefined()
    expect(refreshMock).not.toHaveBeenCalled()
  })
})
