import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { BaselineSummary } from '@/lib/programme/view-types'

vi.mock('@/actions/programme.actions', () => ({
  saveBaselineAction: vi.fn(), setActiveBaselineAction: vi.fn(), deleteBaselineAction: vi.fn(),
}))
import { deleteBaselineAction, saveBaselineAction, setActiveBaselineAction } from '@/actions/programme.actions'
import { BASELINE_WAIT, BaselinesMenu } from './BaselinesMenu'

const baselines: BaselineSummary[] = [
  { id: 'b1', name: 'Tender', is_active: false, created_at: '2026-03-01T08:00:00Z' },
  { id: 'b2', name: 'Rev 1', is_active: true, created_at: '2026-03-10T08:00:00Z' },
]
const onChanged = vi.fn()
function open(over: Partial<{ canEdit: boolean; unsaved: boolean; baselines: BaselineSummary[] }> = {}) {
  render(<BaselinesMenu programmeId="P1" baselines={over.baselines ?? baselines} canEdit={over.canEdit ?? true} unsaved={over.unsaved ?? false} onChanged={onChanged} />)
  fireEvent.click(screen.getByRole('button', { name: /^Baselines/ }))
}
const click = async (name: string | RegExp) => { await act(async () => { fireEvent.click(screen.getByRole('button', { name })) }) }

beforeEach(() => { vi.clearAllMocks() })

describe('BaselinesMenu', () => {
  it('lists the baselines with the active one marked, and says when there are none', () => {
    open()
    expect(screen.getAllByTestId('baseline-active')).toHaveLength(1)
    expect(screen.getByText('Tender').closest('[data-baseline-id]')!.getAttribute('data-baseline-id')).toBe('b1')
  })
  it('an empty list says so', () => {
    open({ baselines: [] })
    expect(screen.getByText('No baselines saved yet.')).toBeTruthy()
  })

  it('Save baseline… asks for a name, with "Set as active" ticked, and calls the action once', async () => {
    vi.mocked(saveBaselineAction).mockResolvedValue({ ok: true, baselineId: 'b3' })
    open()
    await click('Save baseline…')
    expect((screen.getByLabelText('Set as active') as HTMLInputElement).checked).toBe(true)
    fireEvent.change(screen.getByLabelText('Baseline name'), { target: { value: '  Rev 2  ' } })
    await click('Save')
    expect(saveBaselineAction).toHaveBeenCalledTimes(1)
    expect(saveBaselineAction).toHaveBeenCalledWith({ programmeId: 'P1', name: 'Rev 2', setActive: true })
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('unticking "Set as active" saves it inactive; a blank name is refused without a call', async () => {
    vi.mocked(saveBaselineAction).mockResolvedValue({ ok: true, baselineId: 'b3' })
    open()
    await click('Save baseline…')
    await click('Save')
    expect(saveBaselineAction).not.toHaveBeenCalled()
    expect(screen.getByTestId('baselines-error').textContent).toBe('Give the baseline a name.')
    fireEvent.change(screen.getByLabelText('Baseline name'), { target: { value: 'Rev 2' } })
    fireEvent.click(screen.getByLabelText('Set as active'))
    await click('Save')
    expect(saveBaselineAction).toHaveBeenCalledWith({ programmeId: 'P1', name: 'Rev 2', setActive: false })
  })

  it('a refusal is shown and nothing reloads', async () => {
    vi.mocked(saveBaselineAction).mockResolvedValue({ ok: false, error: 'A baseline with that name already exists.' })
    open()
    await click('Save baseline…')
    fireEvent.change(screen.getByLabelText('Baseline name'), { target: { value: 'Rev 1' } })
    await click('Save')
    expect(screen.getByTestId('baselines-error').textContent).toBe('A baseline with that name already exists.')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('a thrown action is shown as a sentence', async () => {
    vi.mocked(setActiveBaselineAction).mockRejectedValue(new Error('boom'))
    open()
    await click('Set Tender active')
    expect(screen.getByTestId('baselines-error').textContent).toBe('The baseline could not be changed. Try again.')
  })

  it('saving is refused while the screen has unsaved changes', () => {
    open({ unsaved: true })
    expect((screen.getByRole('button', { name: 'Save baseline…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(BASELINE_WAIT)).toBeTruthy()
  })

  it('Set active is offered on the inactive ones only, and calls the action with that id', async () => {
    vi.mocked(setActiveBaselineAction).mockResolvedValue({ ok: true })
    open()
    expect(screen.queryByRole('button', { name: 'Set Rev 1 active' })).toBeNull()
    await click('Set Tender active')
    expect(setActiveBaselineAction).toHaveBeenCalledWith({ baselineId: 'b1' })
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('Delete asks again inline; only Confirm calls the action; Cancel does not', async () => {
    vi.mocked(deleteBaselineAction).mockResolvedValue({ ok: true })
    const confirm = vi.spyOn(window, 'confirm')
    open()
    await click('Delete Tender')
    expect(deleteBaselineAction).not.toHaveBeenCalled()
    expect(within(screen.getByRole('alert')).getByText(/Delete Tender\?/)).toBeTruthy()
    await click('Cancel')
    expect(screen.queryByRole('alert')).toBeNull()
    await click('Delete Tender')
    await click('Confirm delete')
    expect(deleteBaselineAction).toHaveBeenCalledTimes(1)
    expect(deleteBaselineAction).toHaveBeenCalledWith({ baselineId: 'b1' })
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('read-only: the list, and no way to save, activate or delete', () => {
    open({ canEdit: false })
    expect(screen.getAllByTestId('baseline-active')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Save baseline|Set .* active|Delete/ })).toBeNull()
  })
})
