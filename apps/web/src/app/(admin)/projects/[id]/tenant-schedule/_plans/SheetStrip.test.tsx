import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { SheetSummary } from '@/lib/status-plans/types'

vi.mock('./TenantPlanUploader', () => ({ TenantPlanUploader: ({ label }: { label?: string }) => <button type="button">{label}</button> }))

import { SheetStrip } from './SheetStrip'

const s = (id: string, i: number, over: Partial<SheetSummary> = {}): SheetSummary => ({
  id, label: `Level ${i}`, sortOrder: i, fileName: `E-10${i}.pdf`, mime: 'application/pdf', pageIndex: 1, revision: 1,
  replacedAt: null, pixelsPerMeter: null, updatedAt: 't', ...over,
})
const SHEETS = [s('a', 0), s('b', 1, { replacedAt: 't9' }), s('c', 2)]

describe('SheetStrip', () => {
  it('links every sheet by ?sheet= and marks the current one', () => {
    render(<SheetStrip projectId="p1" purpose="tenant_layout" sheets={SHEETS} currentId="b" canEdit={false} />)
    const nav = screen.getByRole('navigation', { name: 'Sheets' })
    const links = within(nav).getAllByRole('link').filter((a) => !a.getAttribute('aria-label'))
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/projects/p1/tenant-schedule/floor-plan?sheet=a',
      '/projects/p1/tenant-schedule/floor-plan?sheet=b',
      '/projects/p1/tenant-schedule/floor-plan?sheet=c',
    ])
    expect(links[1]!.getAttribute('aria-current')).toBe('page')
    expect(links[0]!.getAttribute('aria-current')).toBeNull()
  })

  it('previous and next step to the neighbours', () => {
    render(<SheetStrip projectId="p1" purpose="distribution_schematic" sheets={SHEETS} currentId="b" canEdit={false} />)
    expect(screen.getByRole('link', { name: 'Previous sheet' }).getAttribute('href')).toBe('/projects/p1/tenant-schedule/line-diagram?sheet=a')
    expect(screen.getByRole('link', { name: 'Next sheet' }).getAttribute('href')).toBe('/projects/p1/tenant-schedule/line-diagram?sheet=c')
  })

  it('no previous on the first sheet, no next on the last', () => {
    const { rerender } = render(<SheetStrip projectId="p1" purpose="tenant_layout" sheets={SHEETS} currentId="a" canEdit={false} />)
    expect(screen.queryByRole('link', { name: 'Previous sheet' })).toBeNull()
    rerender(<SheetStrip projectId="p1" purpose="tenant_layout" sheets={SHEETS} currentId="c" canEdit={false} />)
    expect(screen.queryByRole('link', { name: 'Next sheet' })).toBeNull()
  })

  it('a replaced sheet says so; writers get "Add sheets", readers do not', () => {
    const { rerender } = render(<SheetStrip projectId="p1" purpose="tenant_layout" sheets={SHEETS} currentId="a" canEdit />)
    expect(screen.getByRole('link', { name: /Level 1/ }).getAttribute('title')).toBe('File replaced — check the shapes')
    expect(screen.getByRole('button', { name: 'Add sheets' })).toBeTruthy()
    rerender(<SheetStrip projectId="p1" purpose="tenant_layout" sheets={SHEETS} currentId="a" canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Add sheets' })).toBeNull()
  })
})
