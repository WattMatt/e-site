import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddQcEntryForm } from './AddQcEntryForm'

// Stage-4 conformance UI: the add-entry form must force an explicit Pass/Fail/N-A
// choice, reveal the severity select only for Fail, and thread both into
// addQcEntryAction. These tests drive the real form + shared ConformanceInputs
// with the actions/uploads mocked.

const { addMock, refreshMock } = vi.hoisted(() => ({
  addMock: vi.fn(),
  refreshMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@/lib/qc-photos', () => ({
  uploadQcEntryPhotos: vi.fn(),
  uploadQcMarkup: vi.fn(),
  replaceQcMarkup: vi.fn(),
  toSceneGraph: (x: unknown) => x,
}))
vi.mock('@/actions/qc.actions', () => ({ addQcEntryAction: addMock }))

beforeEach(() => {
  vi.clearAllMocks()
  addMock.mockResolvedValue({ entryId: 'e1' })
})

function openForm() {
  render(<AddQcEntryForm projectId="p1" reportId="r1" orgId="o1" userId="u1" />)
  fireEvent.click(screen.getByRole('button', { name: '+ Add Entry' }))
}

describe('AddQcEntryForm conformance', () => {
  it('hides the severity select until Fail is chosen', () => {
    openForm()
    expect(screen.queryByLabelText('Severity *')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Fail' }))
    expect(screen.getByLabelText('Severity *')).toBeTruthy()
    // Switching away from Fail hides + clears it again.
    fireEvent.click(screen.getByRole('radio', { name: 'Pass' }))
    expect(screen.queryByLabelText('Severity *')).toBeNull()
  })

  it('refuses to submit without a conformance choice', async () => {
    openForm()
    fireEvent.change(screen.getByPlaceholderText(/Cable tray supports/), { target: { value: 'Riser check' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Entry' }))
    expect(await screen.findByText(/Select a conformance status/)).toBeTruthy()
    expect(addMock).not.toHaveBeenCalled()
  })

  it('requires a severity when Fail is chosen', async () => {
    openForm()
    fireEvent.change(screen.getByPlaceholderText(/Cable tray supports/), { target: { value: 'Riser check' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Fail' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Entry' }))
    expect(await screen.findByText(/Select a severity/)).toBeTruthy()
    expect(addMock).not.toHaveBeenCalled()
  })

  it('threads conformance + severity into addQcEntryAction on a valid Fail', async () => {
    openForm()
    fireEvent.change(screen.getByPlaceholderText(/Cable tray supports/), { target: { value: 'Riser check' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Fail' }))
    fireEvent.change(screen.getByLabelText('Severity *'), { target: { value: 'major' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Entry' }))
    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(1))
    expect(addMock).toHaveBeenCalledWith({
      reportId: 'r1',
      title: 'Riser check',
      description: undefined,
      conformance: 'fail',
      severity: 'major',
    })
  })

  it('passes a Pass conformance with no severity', async () => {
    openForm()
    fireEvent.change(screen.getByPlaceholderText(/Cable tray supports/), { target: { value: 'Riser check' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Pass' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Entry' }))
    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(1))
    expect(addMock).toHaveBeenCalledWith({
      reportId: 'r1',
      title: 'Riser check',
      description: undefined,
      conformance: 'pass',
      severity: undefined,
    })
  })
})
