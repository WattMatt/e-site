import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ url: vi.fn() }))
vi.mock('@/actions/solar-tariff.actions', () => ({ getSolarTariffSourceUrlAction: h.url }))
vi.mock('@/components/tariffs/SourceViewer', () => ({ SourceViewer: (p: { title: string }) => <div>viewer {p.title}</div> }))

import { ChargesTable } from './ChargesTable'

describe('ChargesTable', () => {
  it('shows every stored charge with its unit and a View source per row', async () => {
    const user = userEvent.setup()
    render(<ChargesTable projectId="p1" charges={[
      { id: 'c1', component: 'energy', season: 'high', tou: 'peak', dayType: 'all', blockMin: null, blockMax: null, unit: 'c_per_kWh', amount: 412.34, vatBasis: 'stated_excl', sourceDocumentId: 'd1', sourceTitle: 'Eskom 2026/27', locator: { page: 4 } },
      { id: 'c2', component: 'basic', season: 'all', tou: 'all', dayType: 'all', blockMin: null, blockMax: null, unit: 'R_per_day', amount: 25.3, vatBasis: 'stated_excl', sourceDocumentId: null, sourceTitle: null, locator: {} },
    ]} />)
    expect(screen.getByText('412.34 c/kWh')).toBeDefined()
    expect(screen.getByText('R25.30/day')).toBeDefined()
    expect(screen.getByText('Eskom 2026/27, page 4')).toBeDefined()
    await user.click(screen.getAllByRole('button', { name: 'View source' })[0])
    expect(screen.getByText('viewer Energy (High demand (winter), Peak)')).toBeDefined()
    expect((screen.getAllByRole('button', { name: 'View source' })[1] as HTMLButtonElement).disabled).toBe(true)
  })
  it('an empty tariff says so', () => {
    render(<ChargesTable projectId="p1" charges={[]} />)
    expect(screen.getByText('This tariff has no charges in the library. Report it as a tariff error.')).toBeDefined()
  })
})
