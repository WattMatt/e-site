import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const previewPriceFromLibraryAction = vi.fn()
const applyPriceFromLibraryAction = vi.fn()
const addProjectBoqToLibraryAction = vi.fn()
vi.mock('@/actions/rate-catalogue.actions', () => ({
  previewPriceFromLibraryAction: (...a: unknown[]) => previewPriceFromLibraryAction(...a),
  applyPriceFromLibraryAction: (...a: unknown[]) => applyPriceFromLibraryAction(...a),
  addProjectBoqToLibraryAction: (...a: unknown[]) => addProjectBoqToLibraryAction(...a),
}))

import { LibraryPricingPanel } from './LibraryPricingPanel'

const none = { supplyRate: null, installRate: null, rate: null }

function row(over: Record<string, unknown>) {
  return {
    boqItemId: 'x', status: 'priced', reason: null, signature: 'sig', itemId: 'it', itemCode: 'CAB-16-4C', n: 5,
    current: none, proposed: null, description: 'desc', heading: 'Cables', unit: 'm', ...over,
  }
}

const rows = [
  row({ boqItemId: 'a', description: 'Cable 16mm 4c PVC SWA', current: { supplyRate: null, installRate: null, rate: 100 }, proposed: { supplyRate: null, installRate: null, rate: 1234.5 } }),
  row({ boqItemId: 'b', description: 'DB board 12 way', itemCode: 'DB-12', n: 3, current: { supplyRate: 1000, installRate: 200, rate: null }, proposed: { supplyRate: 2500, installRate: 350.25, rate: null } }),
  row({ boqItemId: 'c', status: 'skipped', reason: 'no_library_item', description: 'Mystery item', itemCode: null, n: 0 }),
  row({ boqItemId: 'd', status: 'skipped', reason: 'no_library_item', description: 'Another mystery', itemCode: null, n: 0 }),
  row({ boqItemId: 'e', status: 'skipped', reason: 'no_split_in_library', description: 'Split-less item', n: 2 }),
]
const previewOk = { ok: true, data: { rows, priced: 2, skipped: { no_library_item: 2, no_split_in_library: 1 } } }

function open() {
  render(<LibraryPricingPanel projectId="p1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Price from library' }))
}

async function openAndPreview() {
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await screen.findByText('Cable 16mm 4c PVC SWA')
  // React 19 commits the post-await setState before the transition's isPending
  // clears, so Apply is briefly disabled after the rows appear. Wait it out.
  await waitFor(() => expect((screen.getByRole('button', { name: /^Apply to/ }) as HTMLButtonElement).disabled).toBe(false))
}

beforeEach(() => {
  refresh.mockReset()
  previewPriceFromLibraryAction.mockReset().mockResolvedValue(previewOk)
  applyPriceFromLibraryAction.mockReset().mockResolvedValue({ ok: true, data: { updated: 1 } })
  addProjectBoqToLibraryAction.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LibraryPricingPanel — preview', () => {
  it('is collapsed until "Price from library" is pressed', () => {
    render(<LibraryPricingPanel projectId="p1" />)
    expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Price from library' }))
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy()
    expect(screen.getByText('Median is the default; P75 is the more cautious figure.')).toBeTruthy()
  })

  it('renders priced rows with formatted rates and a plain-words skip summary; skipped rows hidden until asked', async () => {
    await openAndPreview()
    expect(previewPriceFromLibraryAction).toHaveBeenCalledWith('p1', 'median')

    const priced = screen.getAllByTestId('priced-row')
    expect(priced).toHaveLength(2)
    // single rate: current 100.00 → proposed 1 234.50, catalogue code shown
    expect(within(priced[0]).getByText('100.00')).toBeTruthy()
    expect(within(priced[0]).getByText('1 234.50')).toBeTruthy()
    expect(within(priced[0]).getByText('CAB-16-4C')).toBeTruthy()
    // supply/install pair
    expect(within(priced[1]).getByText('S 2 500.00')).toBeTruthy()
    expect(within(priced[1]).getByText('I 350.25')).toBeTruthy()
    expect(within(priced[1]).getByText('3')).toBeTruthy()

    expect(screen.getByText('2 lines can be priced from the library; 3 lines skipped')).toBeTruthy()
    expect(screen.getByText('2 — no matching catalogue item')).toBeTruthy()
    expect(screen.getByText('1 — library has no supply/install split')).toBeTruthy()

    // every priced row is checked by default
    const boxes = priced.map((r) => within(r).getByRole('checkbox') as HTMLInputElement)
    expect(boxes.every((b) => b.checked)).toBe(true)

    // skipped rows are not listed individually…
    expect(screen.queryByText('Mystery item')).toBeNull()
    expect(screen.queryAllByTestId('skipped-row')).toHaveLength(0)
    // …until "Show skipped"
    fireEvent.click(screen.getByRole('button', { name: 'Show skipped' }))
    expect(screen.getAllByTestId('skipped-row')).toHaveLength(3)
    expect(screen.getByText('Mystery item')).toBeTruthy()
  })

  it('passes P75 to the preview action when toggled', async () => {
    open()
    fireEvent.click(screen.getByRole('radio', { name: 'P75' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await screen.findByText('Cable 16mm 4c PVC SWA')
    expect(previewPriceFromLibraryAction).toHaveBeenCalledTimes(1)
    expect(previewPriceFromLibraryAction).toHaveBeenCalledWith('p1', 'p75')
  })

  it('discards the preview when the statistic changes, so nothing unseen can be applied', async () => {
    await openAndPreview()
    fireEvent.click(screen.getByRole('radio', { name: 'P75' }))
    expect(screen.queryByText('Cable 16mm 4c PVC SWA')).toBeNull()
    expect(screen.queryByRole('button', { name: /Apply to/ })).toBeNull()
  })

  it('shows the action error and does not throw', async () => {
    previewPriceFromLibraryAction.mockResolvedValue({ ok: false, error: 'The rate library is limited to owners, admins and project managers' })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The rate library is limited to owners, admins and project managers')
  })
})

describe('LibraryPricingPanel — apply', () => {
  it('needs a second press, then sends ONLY the checked ids with the preview statistic', async () => {
    await openAndPreview()
    // untick the second priced row
    fireEvent.click(within(screen.getAllByTestId('priced-row')[1]).getByRole('checkbox'))

    const first = screen.getByRole('button', { name: 'Apply to 1 line' })
    fireEvent.click(first)
    // armed, not applied
    expect(applyPriceFromLibraryAction).not.toHaveBeenCalled()
    const confirm = screen.getByRole('button', { name: 'Confirm — overwrite 1 rate' })
    fireEvent.click(confirm)

    await waitFor(() => expect(applyPriceFromLibraryAction).toHaveBeenCalledTimes(1))
    expect(applyPriceFromLibraryAction).toHaveBeenCalledWith('p1', 'median', ['a'])
    expect(await screen.findByText('Updated 1 line')).toBeTruthy()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('disarms after 4 seconds without applying', async () => {
    await openAndPreview()
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 lines' }))
    expect(screen.getByRole('button', { name: 'Confirm — overwrite 2 rates' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(4000) })
    expect(screen.getByRole('button', { name: 'Apply to 2 lines' })).toBeTruthy()
    expect(applyPriceFromLibraryAction).not.toHaveBeenCalled()
  })

  it('reports an apply error without refreshing', async () => {
    applyPriceFromLibraryAction.mockResolvedValue({ ok: false, error: 'Some chosen lines can no longer be priced from the library. Preview again.' })
    await openAndPreview()
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 lines' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm — overwrite 2 rates' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Preview again/)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('LibraryPricingPanel — add this BOQ to the library', () => {
  it('refuses an empty contractor name without calling the action', () => {
    open()
    fireEvent.change(screen.getByLabelText('Contractor name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to library' }))
    expect(screen.getByRole('alert').textContent).toBe('Name the contractor who priced this BOQ')
    expect(addProjectBoqToLibraryAction).not.toHaveBeenCalled()
  })

  it('sends the name and date, and reports the counts in a sentence', async () => {
    addProjectBoqToLibraryAction.mockResolvedValue({
      ok: true,
      data: { sourceId: 's1', alreadyImported: false, counts: { lines: 120, autoConfirmed: 80, suggested: 10, unmatched: 25, excluded: 5, newItems: 7, observations: 78 } },
    })
    open()
    fireEvent.change(screen.getByLabelText('Contractor name'), { target: { value: '  Voltex Electrical ' } })
    fireEvent.change(screen.getByLabelText('Priced on (optional)'), { target: { value: '2026-03-14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to library' }))
    await waitFor(() => expect(addProjectBoqToLibraryAction).toHaveBeenCalledWith('p1', { contractorName: 'Voltex Electrical', pricedOn: '2026-03-14' }))
    expect(
      (await screen.findByRole('status')).textContent,
    ).toBe(
      'Added 120 lines to the library: 80 matched automatically, 10 suggested for review, 25 unmatched and 5 excluded; 7 new catalogue items and 78 rate observations recorded.',
    )
  })

  it('says "Already in the library" when the BOQ was imported before', async () => {
    addProjectBoqToLibraryAction.mockResolvedValue({
      ok: true,
      data: { sourceId: 's1', alreadyImported: true, counts: { lines: 0, autoConfirmed: 0, suggested: 0, unmatched: 0, excluded: 0, newItems: 0, observations: 0 } },
    })
    open()
    fireEvent.change(screen.getByLabelText('Contractor name'), { target: { value: 'Voltex' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to library' }))
    expect((await screen.findByRole('status')).textContent).toBe('Already in the library')
    expect(addProjectBoqToLibraryAction).toHaveBeenCalledWith('p1', { contractorName: 'Voltex' })
  })
})
