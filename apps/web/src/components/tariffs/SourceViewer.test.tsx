import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./PdfPageCrop', () => ({ PdfPageCrop: (p: { page: number; highlight: string | null }) => <div>PDF page {p.page} — {p.highlight}</div> }))

import { SourceViewer } from './SourceViewer'

describe('SourceViewer', () => {
  it('a PDF locator renders the cited page with the value highlighted', async () => {
    render(<SourceViewer title="Energy" locator={{ page: 12, raw_text: '247.76' }} loadUrl={async () => ({ url: 'https://s', kind: 'pdf' })} onClose={() => {}} />)
    expect(await screen.findByText('PDF page 12 — 247.76')).toBeDefined()
  })
  it('a workbook locator shows the cell snippet and a download link', async () => {
    render(<SourceViewer title="Basic" locator={{ sheet: 'CITY POWER', cell: 'D14', label: 'Basic charge', raw_text: '157.91', raw_unit: 'R/month' }}
      loadUrl={async () => ({ url: 'https://s/x.xlsx', kind: 'xlsx' })} onClose={() => {}} />)
    expect(await screen.findByText('CITY POWER')).toBeDefined()
    expect(screen.getByText('D14')).toBeDefined()
    expect(screen.getByText('157.91')).toBeDefined()
    await waitFor(() => expect(screen.getByRole('link', { name: 'Download the workbook' }).getAttribute('href')).toBe('https://s/x.xlsx'))
  })
  it('a failure is a sentence; Close calls back', async () => {
    const onClose = vi.fn()
    render(<SourceViewer title="X" locator={{}} loadUrl={async () => ({ error: 'That source document no longer exists.' })} onClose={onClose} />)
    expect(await screen.findByText('That source document no longer exists.')).toBeDefined()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
