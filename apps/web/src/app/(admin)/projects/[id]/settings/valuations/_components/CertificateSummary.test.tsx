import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { CertificateSummary } from './CertificateSummary'

const summary = {
  grossToDate: 10000,
  retention: 500,
  netToDate: 9500,
  previousNet: 4000,
  dueExVat: 5500,
  vat: 825,
  dueInclVat: 6325,
}

describe('CertificateSummary', () => {
  it('renders the seven certificate figure lines from props', () => {
    render(<CertificateSummary summary={summary} retentionPct={5} />)

    // The seven labels.
    expect(screen.getByText('Gross value to date')).toBeTruthy()
    expect(screen.getByText(/less Retention \(5%\)/)).toBeTruthy()
    expect(screen.getByText('Net value to date')).toBeTruthy()
    expect(screen.getByText('less Previously certified')).toBeTruthy()
    expect(screen.getByText('Amount due (excl. VAT)')).toBeTruthy()
    expect(screen.getByText('VAT (15%)')).toBeTruthy()
    expect(screen.getByText('Total due (incl. VAT)')).toBeTruthy()

    // Spot-check two figures are formatted as ZAR (en-ZA uses a non-breaking
    // thousands space; match the digits + the currency symbol).
    expect(screen.getByText(/R\s*10\s*000,00/)).toBeTruthy()
    expect(screen.getByText(/R\s*6\s*325,00/)).toBeTruthy()
  })

  it('omits the per-bill table when no bills are passed', () => {
    render(<CertificateSummary summary={summary} retentionPct={5} />)
    expect(screen.queryByText('Summary by bill')).toBeNull()
  })

  it('renders the per-bill table when bills are provided', () => {
    render(
      <CertificateSummary
        summary={summary}
        retentionPct={5}
        bills={[
          { code: 'A', title: 'Preliminaries', grossToDate: 4000, retention: 200 },
          { code: 'B', title: 'Electrical', grossToDate: 6000, retention: 300 },
        ]}
      />,
    )
    expect(screen.getByText('Summary by bill')).toBeTruthy()
    expect(screen.getByText('Preliminaries')).toBeTruthy()
    expect(screen.getByText('Electrical')).toBeTruthy()
  })
})
