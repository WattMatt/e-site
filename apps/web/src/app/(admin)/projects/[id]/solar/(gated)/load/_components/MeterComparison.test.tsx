import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MeterComparison } from './MeterComparison'
import type { MeterView } from '@/lib/solar/load/view-types'

const mk = (id: string, label: string, periodEnd: string | null = '2025-12-31T22:00:00Z'): MeterView => ({
  id, label, kind: 'tenant', siteLabel: null, serials: [], nodeId: null, tenantLabel: null, shopNo: null, areaM2: null,
  supplyPointConfirmed: false, updatedAt: 'M0', primaryChannelId: `c-${id}`, intervalMin: 30, periodStart: '2025-01-01T00:00:00Z', periodEnd,
  completeness: 1, peakKw: 10, annualKwh: 1000, fileIds: [], otherStudyLinks: 0, status: 'imported',
})

const T0 = Date.parse('2025-06-01T00:00:00Z')
function body(unit: string) {
  return {
    channel: { id: 'c', unit, label: 'P' }, channels: [], intervalMin: 30,
    extent: { first: T0, last: T0 + 3_600_000 }, window: { from: T0, to: T0 + 3_600_000 }, fullResolution: true,
    buckets: [{ t0: T0, t1: T0 + 1_800_000, min: 1, max: 1, mean: 1 }, { t0: T0 + 1_800_000, t1: T0 + 3_600_000, min: 2, max: 2, mean: 2 }],
    gaps: [],
  }
}
const ok = (unit: string) => ({ ok: true, json: async () => body(unit) })

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => vi.unstubAllGlobals())

const seriesPaths = (c: HTMLElement) => c.querySelectorAll('path[data-series]').length

describe('MeterComparison', () => {
  it('fetches the series route once per selected meter over the SAME window and draws one chart with N series', async () => {
    fetchMock.mockImplementation(async () => ok('kW'))
    const meters = [mk('m1', 'Pep'), mk('m2', 'Spar'), mk('m3', 'KFC')]
    const { container } = render(<MeterComparison projectId="p1" meters={meters} onClose={vi.fn()} />)
    await waitFor(() => expect(seriesPaths(container)).toBe(3))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const urls = fetchMock.mock.calls.map((c) => new URL(String(c[0]), 'http://x'))
    expect(urls.map((u) => u.pathname)).toEqual([
      '/api/projects/p1/solar/meters/m1/series', '/api/projects/p1/solar/meters/m2/series', '/api/projects/p1/solar/meters/m3/series',
    ])
    const windows = urls.map((u) => `${u.searchParams.get('from')}|${u.searchParams.get('to')}`)
    expect(new Set(windows).size).toBe(1)
    expect(urls[0].searchParams.get('from')).toBeTruthy()
    expect(urls[0].searchParams.get('to')).toBe('2025-12-31T22:00:00.000Z')
    expect(container.querySelectorAll('svg[data-chart]').length).toBe(1)
    for (const l of ['Pep', 'Spar', 'KFC']) expect(screen.getByRole('button', { name: new RegExp(l) })).toBeTruthy()
  })

  it('a failed meter is named and left out; the rest still plot', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/m2/') ? { ok: false, json: async () => ({ error: 'x' }) } : ok('kW')))
    const { container } = render(<MeterComparison projectId="p1" meters={[mk('m1', 'Pep'), mk('m2', 'Spar'), mk('m3', 'KFC')]} onClose={vi.fn()} />)
    await waitFor(() => expect(seriesPaths(container)).toBe(2))
    expect(screen.getByRole('alert').textContent).toMatch(/Spar could not be loaded/)
  })

  it('only meters sharing one unit are overlaid; the others are named with the reason', async () => {
    fetchMock.mockImplementation(async (url: string) => (String(url).includes('/m3/') ? ok('kWh') : ok('kW')))
    const { container } = render(<MeterComparison projectId="p1" meters={[mk('m1', 'Pep'), mk('m2', 'Spar'), mk('m3', 'KFC')]} onClose={vi.fn()} />)
    await waitFor(() => expect(seriesPaths(container)).toBe(2))
    expect(screen.getByText(/KFC is left out: its readings are in kWh; this overlay is in kW/)).toBeTruthy()
  })
})
