import { describe, it, expect } from 'vitest'
import { jobFromRow, jobFinishPatch } from './supabase-jobs'

describe('ingest job rows', () => {
  it('maps a claimed row', () => {
    expect(jobFromRow({ id: 'j', source_document_id: 'd', parser: 'rfd_pdf', financial_year: '2026/27', licensee_name: 'City Power', create_licensees: false, requested_by: 'u' }))
      .toEqual({ id: 'j', sourceDocumentId: 'd', parser: 'rfd_pdf', financialYear: '2026/27', licenseeName: 'City Power', createLicensees: false, requestedBy: 'u' })
  })
  it('the finish patch stores the summary, never the raw bytes', () => {
    const p = jobFinishPatch({ status: 'failed', report: null, runId: null, error: 'x' }, '2026-09-28T00:00:00Z')
    expect(p).toEqual({ status: 'failed', finished_at: '2026-09-28T00:00:00Z', ingest_run_id: null, report: null, error: 'x' })
  })
})
