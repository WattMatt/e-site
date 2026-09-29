import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
const h = vi.hoisted(() => ({ upload: vi.fn(async () => ({ error: null })), link: vi.fn(async () => ({ ok: true })), refresh: vi.fn(), sha: vi.fn(async () => 'a'.repeat(64)) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ storage: { from: () => ({ upload: h.upload }) } }) }))
vi.mock('@/actions/solar-operations.actions', () => ({ linkMeterAction: h.link }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))
vi.mock('@esite/shared/meter-data', () => ({ sha256Hex: h.sha }))
import { GenerationImport } from './GenerationImport'

const review = (over: Record<string, unknown> = {}) => ({ fileId: 'f1', outcome: 'series', canAccept: true, blockingErrors: [], choicesNeeded: [], ...over })
/** Plain response objects (the component reads only ok / status / json()), so no global Response is needed. */
const res = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })
function mockFetch(reviewOver: Record<string, unknown> = {}, committed = { meterId: 'm9', meterLabel: 'PV new' }) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith('/meter-files')) return res(201, { fileId: 'f1', duplicate: false })
    if (url.endsWith('/parse')) return res(200, { results: [{ fileId: 'f1', reviews: [review(reviewOver)] }] })
    if (url.endsWith('/commit')) return res(200, { ...committed, channels: [] })
    return res(404, {})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const file = () => new File(['ts,kW\n2026-03-10 12:00,7'], 'March.CSV', { type: 'text/csv' })
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('GenerationImport (the existing meter pipeline, meter kind solar)', () => {
  it('uploads by hash, registers, parses, commits to a NEW solar meter and links it for generation', async () => {
    const f = mockFetch()
    render(<GenerationImport projectId="p1" organisationId="o1" installationId="i1" generationMeters={[]} />)
    fireEvent.change(screen.getByLabelText('New meter name'), { target: { value: 'PV new' } })
    fireEvent.change(screen.getByLabelText('Generation file'), { target: { files: [file()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import generation data' }))
    await screen.findByText(/Imported to PV new/)
    expect(h.upload).toHaveBeenCalledWith(`o1/p1/${'a'.repeat(64)}.csv`, expect.any(File), { upsert: false })
    const commit = f.mock.calls.find(([u]) => String(u).endsWith('/commit'))!
    expect(JSON.parse(String((commit[1] as RequestInit).body))).toEqual({ mode: 'series', fileId: 'f1', meter: { new: { label: 'PV new', kind: 'solar' } }, identity: { resolution: 'none' } })
    expect(h.link).toHaveBeenCalledWith({ projectId: 'p1', installationId: 'i1', meterId: 'm9', role: 'generation' })
    expect(h.refresh).toHaveBeenCalled()
  })
  it('an existing generation meter receives the file (re-import replaces its intervals) and is not re-linked', async () => {
    const f = mockFetch({}, { meterId: 'm1', meterLabel: 'PV main' })
    render(<GenerationImport projectId="p1" organisationId="o1" installationId="i1" generationMeters={[{ meterId: 'm1', label: 'PV main' }]} />)
    fireEvent.change(screen.getByLabelText('Generation file'), { target: { files: [file()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import generation data' }))
    await screen.findByText(/Imported to PV main/)
    const commit = f.mock.calls.find(([u]) => String(u).endsWith('/commit'))!
    expect(JSON.parse(String((commit[1] as RequestInit).body)).meter).toEqual({ existingMeterId: 'm1' })
    expect(h.link).not.toHaveBeenCalled()
  })
  it('answers the parser’s choices in place: re-parses with them, then commits with them (review B3)', async () => {
    const needs = review({ canAccept: false, choicesNeeded: ['ambiguous_date_order', 'convention_required', 'unknown_unit'],
      channels: [{ column: 'Energy', sourceUnit: 'unknown', suggestedUnit: 'kWh' }, { column: 'kW', sourceUnit: 'kW', suggestedUnit: null }] })
    let parses = 0
    const f = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/meter-files')) return res(201, { fileId: 'f1', duplicate: false })
      if (url.endsWith('/parse')) { parses++; return res(200, { results: [{ fileId: 'f1', reviews: [parses === 1 ? needs : review()] }] }) }
      if (url.endsWith('/commit')) return res(200, { meterId: 'm1', meterLabel: 'PV main', channels: [] })
      return res(404, {})
    })
    vi.stubGlobal('fetch', f)
    render(<GenerationImport projectId="p1" organisationId="o1" installationId="i1" generationMeters={[{ meterId: 'm1', label: 'PV main' }]} />)
    fireEvent.change(screen.getByLabelText('Generation file'), { target: { files: [file()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import generation data' }))
    fireEvent.change(await screen.findByLabelText('Date order'), { target: { value: 'DMY' } })
    fireEvent.change(screen.getByLabelText('Timestamps mark the'), { target: { value: 'begin' } })
    expect((screen.getByLabelText('Unit of column "Energy"') as HTMLSelectElement).value).toBe('kWh')
    expect(screen.queryByLabelText('Unit of column "kW"')).toBeNull()
    expect(f.mock.calls.some(([u]) => String(u).endsWith('/commit'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Import with these choices' }))
    await screen.findByText(/Imported to PV main/)
    const options = { f1: { dateOrder: 'DMY', tsConvention: 'begin', units: { Energy: 'kWh' } } }
    const parseCalls = f.mock.calls.filter(([u]) => String(u).endsWith('/parse'))
    expect(JSON.parse(String((parseCalls[1]![1] as RequestInit).body))).toEqual({ fileIds: ['f1'], options })
    const commit = f.mock.calls.find(([u]) => String(u).endsWith('/commit'))!
    expect(JSON.parse(String((commit[1] as RequestInit).body)).options).toEqual(options.f1)
    expect(h.upload).toHaveBeenCalledTimes(1)
  })
  it('a date-order choice left unanswered is asked for, not sent', async () => {
    mockFetch({ canAccept: false, choicesNeeded: ['ambiguous_date_order'] })
    render(<GenerationImport projectId="p1" organisationId="o1" installationId="i1" generationMeters={[{ meterId: 'm1', label: 'PV main' }]} />)
    fireEvent.change(screen.getByLabelText('Generation file'), { target: { files: [file()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import generation data' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Import with these choices' }))
    expect(await screen.findByText('Choose the date order.')).toBeTruthy()
  })
  it('a file that needs choices is not committed; the reasons are shown', async () => {
    const f = mockFetch({ canAccept: false, blockingErrors: ['Timestamps go backwards at row 12'], choicesNeeded: ['unit for column "Energy"'] })
    render(<GenerationImport projectId="p1" organisationId="o1" installationId="i1" generationMeters={[{ meterId: 'm1', label: 'PV main' }]} />)
    fireEvent.change(screen.getByLabelText('Generation file'), { target: { files: [file()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import generation data' }))
    expect(await screen.findByText('Timestamps go backwards at row 12')).toBeTruthy()
    expect(screen.getByText('unit for column "Energy"')).toBeTruthy()
    expect(f.mock.calls.some(([u]) => String(u).endsWith('/commit'))).toBe(false)
  })
  it('refuses a file type the pipeline cannot store', async () => {
    mockFetch()
    render(<GenerationImport projectId="p1" organisationId="o1" installationId="i1" generationMeters={[{ meterId: 'm1', label: 'PV main' }]} />)
    fireEvent.change(screen.getByLabelText('Generation file'), { target: { files: [new File(['x'], 'data.pdf')] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import generation data' }))
    expect(await screen.findByText('Choose a .csv, .txt, .xlsx or .xls export.')).toBeTruthy()
    expect(h.upload).not.toHaveBeenCalled()
  })
})
