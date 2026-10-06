import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

const h = vi.hoisted(() => ({ index: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/tariffs/explorer-data', () => ({ loadLicenseeIndex: h.index }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))

import TariffExplorerPage from './page'

beforeEach(() => vi.clearAllMocks())
const L = (id: string, name: string, liveFy: string | null, aliases: string[] = []) => ({ id, name, kind: 'municipal', province: 'GP', aliases, liveFy, mdbCode: null, hasAnyYear: true })

describe('tariff explorer home', () => {
  it('browses published authorities by province, metros first, unpublished folded away', async () => {
    h.index.mockResolvedValue([
      { ...L('m', 'SAMPLE METRO', '2026/27'), kind: 'metro' }, L('a', 'CITY OF SAMPLE', '2025/26'), L('b', 'OTHERTOWN', null),
    ])
    render(await TariffExplorerPage())
    expect(screen.getByText('2 of 3 have published tariffs')).toBeDefined()
    const featured = screen.getByRole('region', { name: 'Eskom and the metros' })
    expect(within(featured).getByRole('link', { name: /Sample Metro/ }).getAttribute('href')).toBe('/tariffs/m')
    expect(within(featured).getByText('2026/27 published')).toBeDefined()
    const gp = screen.getByRole('region', { name: 'Gauteng' })
    expect(within(gp).getByRole('link', { name: /City of Sample/ }).getAttribute('href')).toBe('/tariffs/a')
    expect(screen.getByText('1 supply authority has no published tariffs yet')).toBeDefined()
    expect(within(screen.getByRole('group', { name: 'Library coverage' })).getByText('2026/27')).toBeDefined()
  })
  it('typing switches to ranked search hits', async () => {
    h.index.mockResolvedValue([L('a', 'CITY OF SAMPLE', '2025/26'), L('b', 'OTHERTOWN', null)])
    render(await TariffExplorerPage())
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'other' } })
    const hits = screen.getByRole('list', { name: 'Supply authorities' })
    expect(within(hits).getByRole('link', { name: /Othertown/ }).getAttribute('href')).toBe('/tariffs/b')
    expect(within(hits).getByText('No published tariffs')).toBeDefined()
    expect(screen.queryByRole('region', { name: 'Gauteng' })).toBeNull()
  })
  it('a caller RLS gives nothing to read is told why, not shown an empty search', async () => {
    h.index.mockResolvedValue([])
    render(await TariffExplorerPage())
    expect(screen.getByText(/open to members of an active organisation/)).toBeDefined()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
  it('a failed read is an error state, not an empty library', async () => {
    h.index.mockRejectedValue(new Error('licensee'))
    render(await TariffExplorerPage())
    expect(screen.getByText('Could not load the tariff library')).toBeDefined()
  })
})
