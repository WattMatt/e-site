import { describe, it, expect } from 'vitest'
import { renderQcIssuedEmail } from './qc-email'

describe('renderQcIssuedEmail', () => {
  const vars = {
    projectName: 'Centurion Substation',
    reportTitle: 'Slab pour QC',
    reportNo: 3,
    issuerName: 'Jane Foreman',
    entryCount: 5,
    photoCount: 12,
    deepLink: 'https://app.e-site.live/projects/proj-123/quality-control/qc-9',
    pdfUrl: 'https://cdn.example.com/qc-report-qc-9-v1.pdf?token=x',
  }

  it('subject is "QC Report issued: <title>"', () => {
    expect(renderQcIssuedEmail(vars).subject).toBe('QC Report issued: Slab pour QC')
  })

  it('html contains the deep link to the report', () => {
    expect(renderQcIssuedEmail(vars).html).toContain(
      'https://app.e-site.live/projects/proj-123/quality-control/qc-9',
    )
  })

  it('html contains the PDF download link when pdfUrl is set', () => {
    const { html } = renderQcIssuedEmail(vars)
    expect(html).toContain('https://cdn.example.com/qc-report-qc-9-v1.pdf?token=x')
    expect(html).toContain('Download PDF')
  })

  it('omits the PDF link cleanly when pdfUrl is null', () => {
    const { html } = renderQcIssuedEmail({ ...vars, pdfUrl: null })
    expect(html).not.toContain('Download PDF')
    expect(html).not.toContain('null')
  })

  it('html contains the summary (issuer, project, report no, counts)', () => {
    const { html } = renderQcIssuedEmail(vars)
    expect(html).toContain('Jane Foreman')
    expect(html).toContain('Centurion Substation')
    expect(html).toContain('#3')
    expect(html).toContain('Entries:</strong> 5')
    expect(html).toContain('Photos:</strong> 12')
  })

  it('escapes HTML in user-supplied fields (no XSS injection)', () => {
    const { html } = renderQcIssuedEmail({ ...vars, reportTitle: '<script>alert(1)</script>' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes HTML in the issuer name too', () => {
    const { html } = renderQcIssuedEmail({ ...vars, issuerName: '<img src=x onerror=1>' })
    expect(html).not.toContain('<img src=x onerror=1>')
    expect(html).toContain('&lt;img')
  })
})
