import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const h = vi.hoisted(() => ({ gate: vi.fn() }))
vi.mock('@/lib/tariffs/admin-gate', () => ({ requirePlatformTariffAdminPage: h.gate }))
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/tariffs' }))
import TariffLibraryLayout from './layout'
import { render, screen } from '@testing-library/react'

describe('tariff library layout', () => {
  it('asks the gate before rendering anything (a non-admin gets its 404 and no child is rendered)', async () => {
    const rendered = vi.fn()
    function Probe() { rendered(); return <p>secret</p> }
    h.gate.mockRejectedValueOnce(new Error('NOT_FOUND'))
    await expect(TariffLibraryLayout({ children: <Probe /> })).rejects.toThrow('NOT_FOUND')
    expect(h.gate).toHaveBeenCalledTimes(1)
    expect(rendered).not.toHaveBeenCalled()
  })
  it('every page under /admin/tariffs gates itself too, as its FIRST await (a layout is not the only gate)', () => {
    const pages: string[] = []
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === 'page.tsx') pages.push(p) } }
    walk(__dirname)
    expect(pages.length).toBeGreaterThanOrEqual(9)
    for (const p of pages) {
      const src = readFileSync(p, 'utf8')
      const body = src.slice(src.indexOf('export default async function'))
      const firstAwait = body.match(/await\s+([A-Za-z_]+)/g) ?? []
      const gateAt = firstAwait.findIndex((a) => a.includes('requirePlatformTariffAdminPage'))
      // params may be awaited first (it reads no data); nothing else may be.
      const before = firstAwait.slice(0, Math.max(gateAt, 0)).filter((a) => !/await\s+(params|searchParams)$/.test(a))
      expect(gateAt, p).toBeGreaterThanOrEqual(0)
      expect(before, p).toEqual([])
    }
  })
  it('renders the library chrome for an admin', async () => {
    h.gate.mockResolvedValueOnce({ supabase: {}, userId: 'a1' })
    render(await TariffLibraryLayout({ children: <p>child</p> }))
    expect(screen.getByRole('heading', { name: 'Tariff library' })).toBeDefined()
    expect(screen.getByRole('link', { name: 'Tariff years' }).getAttribute('href')).toBe('/admin/tariffs/years')
    expect(screen.getByText('child')).toBeDefined()
  })
})
