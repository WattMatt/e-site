import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ index: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/tariffs/explorer-data', () => ({ loadLicenseeIndex: h.index }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))

import TariffExplorerPage from './page'

beforeEach(() => vi.clearAllMocks())
const L = (id: string, name: string, liveFy: string | null, aliases: string[] = []) => ({ id, name, kind: 'municipal', province: 'GP', aliases, liveFy, mdbCode: null, hasAnyYear: true })

describe('tariff explorer home', () => {
  it('lists every supply authority with its published year, linking to its page', async () => {
    h.index.mockResolvedValue([L('a', 'CITY POWER', '2026/27'), L('b', 'MIDVAAL', null)])
    render(await TariffExplorerPage())
    expect(screen.getByText('1 of 2 have published tariffs')).toBeDefined()
    expect(screen.getByText('2026/27 published')).toBeDefined()
    expect(screen.getByText('No published tariffs')).toBeDefined()
    expect(screen.getByRole('link', { name: /CITY POWER/ }).getAttribute('href')).toBe('/tariffs/a')
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
