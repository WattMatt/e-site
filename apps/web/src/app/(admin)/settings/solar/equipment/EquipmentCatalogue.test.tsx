import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const h = vi.hoisted(() => ({ save: vi.fn(), retire: vi.fn(), importCsv: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@/actions/solar-equipment.actions', () => ({ saveSolarEquipmentAction: h.save, retireSolarEquipmentAction: h.retire, importSolarEquipmentCsvAction: h.importCsv }))
import { EquipmentCatalogue, type EquipmentRowView } from './EquipmentCatalogue'

const rows: EquipmentRowView[] = [
  { id: 'p1', kind: 'module', make: 'Generic', model: 'Mono PERC 550 W', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35 }, platform: true, retired: false, source: 'seed', updatedAt: 'T' },
  { id: 'e1', kind: 'module', make: 'Acme', model: 'M-600', specs: { pmaxW: 600, gammaPmaxPctPerC: -0.34, bifacial: true }, platform: false, retired: false, source: 'manual', updatedAt: 'T1' },
  { id: 'e2', kind: 'battery', make: 'Acme', model: 'B-1', specs: { usableKwh: 100, powerKw: 50, rtePct: 90 }, platform: false, retired: true, source: 'csv', updatedAt: 'T1' },
]
const header = 'kind,make,model,pmaxW'
beforeEach(() => vi.clearAllMocks())

describe('EquipmentCatalogue', () => {
  it('lists by kind; platform rows are read-only; retired rows are marked', () => {
    render(<EquipmentCatalogue rows={rows} csvHeader={header} />)
    expect(screen.getByText('E-Site catalogue')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Retire' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)
    expect(screen.queryByText('Acme B-1')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Batteries' }))
    expect(screen.getByText('Acme B-1')).toBeTruthy()
    expect(screen.getByText('Retired')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retire' })).toBeNull()
  })
  it('Retire arms then commits; there is no Delete anywhere', async () => {
    h.retire.mockResolvedValue({ ok: true })
    render(<EquipmentCatalogue rows={rows} csvHeader={header} />)
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retire' }))
    expect(h.retire).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Retire Acme M-600?' }))
    await waitFor(() => expect(h.retire).toHaveBeenCalledWith({ id: 'e1' }))
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
  })
  it('Add module sends kind-specific specs; field errors show', async () => {
    h.save.mockResolvedValueOnce({ fieldErrors: { pmaxW: 'Number must be greater than or equal to 1' } })
    render(<EquipmentCatalogue rows={rows} csvHeader={header} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add module' }))
    fireEvent.change(screen.getByLabelText('Make'), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'M-700' } })
    fireEvent.change(screen.getByLabelText('Pmax (W)'), { target: { value: '0' } })
    fireEvent.change(screen.getByLabelText('Temp. coefficient of Pmax (%/°C)'), { target: { value: '-0.3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save equipment' }))
    await screen.findByText('Number must be greater than or equal to 1')
    expect(h.save).toHaveBeenCalledWith({ id: null, kind: 'module', make: 'Acme', model: 'M-700', specs: { pmaxW: 0, gammaPmaxPctPerC: -0.3 }, expectedUpdatedAt: null })
  })
  it('Edit keeps the row id + stale guard and round-trips a boolean spec (bifacial) as a boolean', async () => {
    h.save.mockResolvedValueOnce({ ok: true, id: 'e1', updatedAt: 'T2' })
    render(<EquipmentCatalogue rows={rows} csvHeader={header} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((screen.getByLabelText('Bifacial') as HTMLInputElement).checked).toBe(true)
    fireEvent.change(screen.getByLabelText('Pmax (W)'), { target: { value: '605' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save equipment' }))
    await waitFor(() => expect(h.save).toHaveBeenCalledWith({ id: 'e1', kind: 'module', make: 'Acme', model: 'M-600', specs: { pmaxW: 605, gammaPmaxPctPerC: -0.34, bifacial: true }, expectedUpdatedAt: 'T1' }))
    await waitFor(() => expect(h.refresh).toHaveBeenCalled())
  })
  it('CSV import reports per-line errors, or the count added; template download uses the server-given header', async () => {
    h.importCsv.mockResolvedValueOnce({ errors: [{ line: 2, message: 'kind must be module, inverter or battery' }] })
    h.importCsv.mockResolvedValueOnce({ ok: true, added: 3, skipped: 1 })
    render(<EquipmentCatalogue rows={rows} csvHeader={header} />)
    expect(screen.getByRole('link', { name: 'Download CSV template' }).getAttribute('href')).toBe(`data:text/csv;charset=utf-8,${encodeURIComponent(header + '\n')}`)
    const file = new File(['x'], 'e.csv', { type: 'text/csv' })
    fireEvent.change(screen.getByLabelText('Import from CSV'), { target: { files: [file] } })
    await screen.findByText('Line 2: kind must be module, inverter or battery')
    expect(h.importCsv).toHaveBeenCalledWith({ text: 'x' })
    fireEvent.change(screen.getByLabelText('Import from CSV'), { target: { files: [file] } })
    await screen.findByText('3 added, 1 already in the catalogue.')
  })
})
