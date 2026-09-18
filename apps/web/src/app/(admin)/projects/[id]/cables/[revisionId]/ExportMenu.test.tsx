import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExportMenu } from './ExportMenu'

// The menu triggers the download with a synthetic <a download>.click(); jsdom
// logs "Not implemented: navigation" for it. Make the click inert here.
beforeAll(() => {
  HTMLAnchorElement.prototype.click = function click() { /* inert under jsdom */ }
})

const PROJECT_ID = '44444444-4444-4444-4444-444444444444'
const REVISION_ID = '33333333-3333-3333-3333-333333333333'

/** Every menu item's target, keyed by its label. Items are buttons; the href lives in the click handler, so read it off the key. */
function open(props: Partial<React.ComponentProps<typeof ExportMenu>> = {}) {
  render(<ExportMenu projectId={PROJECT_ID} revisionId={REVISION_ID} {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /export/i }))
}

function hrefOf(label: RegExp): string {
  // The menu button's React key is the href; it is not in the DOM, so the
  // hint text is the observable — assert on it and on the fetch target below.
  return screen.getByRole('menuitem', { name: label }).textContent ?? ''
}

describe('ExportMenu — the route-sheet option', () => {
  it('offers nothing when the revision has no exported route sheets (the menu is unchanged)', () => {
    open({ routeSheets: { count: 0, stale: 0 } })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(hrefOf(/PDF revision pack/)).not.toContain('route sheet')
  })

  it('offers the option, ticked by default, and the pack formats say they carry the sheets', () => {
    open({ routeSheets: { count: 3, stale: 0 } })
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(screen.getByText(/include the marked-up route sheets \(3\)/i)).toBeDefined()
    expect(hrefOf(/PDF revision pack/)).toContain('+ 3 route sheets')
    expect(hrefOf(/Revision pack \(ZIP\)/)).toContain('+ 3 route sheets')
    expect(hrefOf(/All ISSUED revisions/)).toContain('each with its route sheets')
    // Tabular formats never carry a drawing.
    expect(hrefOf(/Excel workbook/)).not.toContain('route sheet')
    expect(hrefOf(/CSV — Schedule/)).not.toContain('route sheet')
  })

  it('unticking removes the sheets from every pack format', () => {
    open({ routeSheets: { count: 1, stale: 0 } })
    fireEvent.click(screen.getByRole('checkbox'))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
    expect(hrefOf(/PDF revision pack/)).not.toContain('route sheet')
    expect(hrefOf(/Revision pack \(ZIP\)/)).not.toContain('route sheet')
    expect(hrefOf(/All ISSUED revisions/)).not.toContain('route sheet')
  })

  it('warns when a sheet is older than the routes on it', () => {
    open({ routeSheets: { count: 2, stale: 1 } })
    expect(screen.getByText(/1 sheet is older than the routes on it/i)).toBeDefined()
  })

  it('the download URL carries routeSheets=1 only while the option is ticked', async () => {
    const calls: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url))
      return new Response(new Blob(['%PDF-'], { type: 'application/pdf' }), { status: 200 })
    }) as typeof fetch
    // jsdom has no URL.createObjectURL; the menu only needs it to not throw.
    const realCreate = URL.createObjectURL
    const realRevoke = URL.revokeObjectURL
    URL.createObjectURL = () => 'blob:x'
    URL.revokeObjectURL = () => undefined
    try {
      open({ routeSheets: { count: 2, stale: 0 } })
      fireEvent.click(screen.getByRole('menuitem', { name: /PDF revision pack/ }))
      await new Promise((r) => setTimeout(r, 0))
      expect(calls[0]).toBe(`/api/cable-schedule/export/pdf?projectId=${PROJECT_ID}&revisionId=${REVISION_ID}&routeSheets=1`)

      fireEvent.click(screen.getByRole('button', { name: /export/i }))   // reopen
      fireEvent.click(screen.getByRole('checkbox'))
      fireEvent.click(screen.getByRole('menuitem', { name: /Revision pack \(ZIP\)/ }))
      await new Promise((r) => setTimeout(r, 0))
      expect(calls[1]).toBe(`/api/cable-schedule/export/zip?projectId=${PROJECT_ID}&revisionId=${REVISION_ID}`)
    } finally {
      globalThis.fetch = realFetch
      URL.createObjectURL = realCreate
      URL.revokeObjectURL = realRevoke
    }
  })
})
