import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ save: vi.fn(async () => ({ ok: true, updatedAt: 'T2' })) }))
vi.mock('@/actions/solar-handover.actions', () => ({ saveHandoverTemplateAction: h.save }))
import { HandoverTemplateForm } from './HandoverTemplateForm'
beforeEach(() => vi.clearAllMocks())

describe('HandoverTemplateForm', () => {
  it('edits, adds and removes items, then saves on the loaded version', async () => {
    render(<HandoverTemplateForm initial={{ name: 'Solar PV Handover', items: [{ key: 'coc', label: 'CoC', required: true }] }} updatedAt="T1" />)
    fireEvent.change(screen.getByLabelText('Label of item 1'), { target: { value: 'Certificate of Compliance' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    fireEvent.change(screen.getByLabelText('Key of item 2'), { target: { value: 'eskom_letter' } })
    fireEvent.change(screen.getByLabelText('Label of item 2'), { target: { value: 'Eskom approval letter' } })
    fireEvent.click(screen.getByLabelText('Item 2 required'))
    fireEvent.click(screen.getByRole('button', { name: 'Save handover template' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ name: 'Solar PV Handover', expectedUpdatedAt: 'T1', items: [
      { key: 'coc', label: 'Certificate of Compliance', required: true },
      { key: 'eskom_letter', label: 'Eskom approval letter', required: false },
    ] }))
  })
  it('shows a validation error', async () => {
    h.save.mockResolvedValue({ fieldErrors: { template: 'items.0.key: Use lower-case letters, digits and underscores.' } } as never)
    render(<HandoverTemplateForm initial={{ name: 'X', items: [{ key: 'coc', label: 'CoC', required: true }] }} updatedAt={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save handover template' }))
    expect(await screen.findByText('items.0.key: Use lower-case letters, digits and underscores.')).toBeTruthy()
  })
})
