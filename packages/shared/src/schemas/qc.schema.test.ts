import { describe, it, expect } from 'vitest'
import {
  createQcReportSchema,
  updateQcReportSchema,
  addQcEntrySchema,
  updateQcEntrySchema,
  addQcCommentSchema,
  QC_CONFORMANCE,
  QC_SEVERITY,
  QC_CONFORMANCE_LABELS,
  QC_SEVERITY_LABELS,
} from './qc.schema'

const PROJECT = '00000000-0000-0000-0000-000000000001'
const REPORT = '00000000-0000-0000-0000-000000000002'
const ENTRY = '00000000-0000-0000-0000-000000000003'
const PHOTO = '00000000-0000-0000-0000-000000000004'

describe('createQcReportSchema', () => {
  const base = { projectId: PROJECT, title: 'Slab pour QC' }

  it('accepts a minimal valid report', () => {
    const result = createQcReportSchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  it('rejects a non-uuid projectId', () => {
    const result = createQcReportSchema.safeParse({ ...base, projectId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('rejects a title shorter than 2 characters', () => {
    const result = createQcReportSchema.safeParse({ ...base, title: 'x' })
    expect(result.success).toBe(false)
  })

  it('coerces a blank inspectionDate ("") to undefined (does not reject it)', () => {
    // A blank <input type="date"> submits ''.
    const result = createQcReportSchema.safeParse({ ...base, inspectionDate: '' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.inspectionDate).toBeUndefined()
  })

  it('accepts a yyyy-mm-dd inspectionDate', () => {
    const result = createQcReportSchema.safeParse({ ...base, inspectionDate: '2026-07-14' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.inspectionDate).toBe('2026-07-14')
  })

  it('rejects a malformed inspectionDate (must be yyyy-mm-dd)', () => {
    const result = createQcReportSchema.safeParse({ ...base, inspectionDate: '14-07-2026' })
    expect(result.success).toBe(false)
  })
})

describe('updateQcReportSchema', () => {
  it('accepts a partial patch keyed by reportId', () => {
    const result = updateQcReportSchema.safeParse({ reportId: REPORT, title: 'Renamed' })
    expect(result.success).toBe(true)
  })

  it('rejects a missing reportId', () => {
    const result = updateQcReportSchema.safeParse({ title: 'Renamed' })
    expect(result.success).toBe(false)
  })

  it('does not accept projectId (omitted from the patch shape)', () => {
    const result = updateQcReportSchema.safeParse({ reportId: REPORT, projectId: PROJECT })
    expect(result.success).toBe(true)
    if (result.success) expect((result.data as Record<string, unknown>).projectId).toBeUndefined()
  })
})

describe('addQcEntrySchema', () => {
  it('accepts a valid non-fail entry (conformance, no severity)', () => {
    const result = addQcEntrySchema.safeParse({ reportId: REPORT, title: 'DB room', conformance: 'na' })
    expect(result.success).toBe(true)
  })

  it('accepts a fail entry with a severity', () => {
    const result = addQcEntrySchema.safeParse({
      reportId: REPORT,
      title: 'Cracked slab',
      conformance: 'fail',
      severity: 'major',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an empty title', () => {
    const result = addQcEntrySchema.safeParse({ reportId: REPORT, title: '', conformance: 'pass' })
    expect(result.success).toBe(false)
  })

  it('rejects a missing conformance (required, no DB default at the app layer)', () => {
    const result = addQcEntrySchema.safeParse({ reportId: REPORT, title: 'DB room' })
    expect(result.success).toBe(false)
  })

  it('rejects an out-of-domain conformance value', () => {
    const result = addQcEntrySchema.safeParse({ reportId: REPORT, title: 'DB room', conformance: 'maybe' })
    expect(result.success).toBe(false)
  })

  // superRefine: severity present IFF conformance === 'fail' — both directions.
  it('rejects a fail without a severity (severity required for fail)', () => {
    const result = addQcEntrySchema.safeParse({ reportId: REPORT, title: 'Cracked slab', conformance: 'fail' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'severity')).toBe(true)
    }
  })

  it('rejects a non-fail carrying a severity (severity only applies to fail)', () => {
    for (const conformance of ['pass', 'na'] as const) {
      const result = addQcEntrySchema.safeParse({
        reportId: REPORT,
        title: 'DB room',
        conformance,
        severity: 'minor',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.join('.') === 'severity')).toBe(true)
      }
    }
  })

  it('rejects an out-of-domain severity value on a fail', () => {
    const result = addQcEntrySchema.safeParse({
      reportId: REPORT,
      title: 'Cracked slab',
      conformance: 'fail',
      severity: 'catastrophic',
    })
    expect(result.success).toBe(false)
  })
})

describe('updateQcEntrySchema', () => {
  const base = { entryId: ENTRY, title: 'DB room', conformance: 'pass' as const }

  it('accepts a full non-fail patch', () => {
    const result = updateQcEntrySchema.safeParse(base)
    expect(result.success).toBe(true)
  })

  it('accepts a fail patch with a severity', () => {
    const result = updateQcEntrySchema.safeParse({
      entryId: ENTRY,
      title: 'Cracked slab',
      conformance: 'fail',
      severity: 'critical',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a missing entryId', () => {
    const result = updateQcEntrySchema.safeParse({ title: 'DB room', conformance: 'pass' })
    expect(result.success).toBe(false)
  })

  it('enforces the severity-iff-fail rule (fail without severity)', () => {
    const result = updateQcEntrySchema.safeParse({ entryId: ENTRY, title: 'x', conformance: 'fail' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'severity')).toBe(true)
    }
  })

  it('enforces the severity-iff-fail rule (non-fail with severity)', () => {
    const result = updateQcEntrySchema.safeParse({ ...base, severity: 'minor' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'severity')).toBe(true)
    }
  })
})

describe('QC conformance/severity constants', () => {
  it('exposes the value domains matching the DB CHECKs', () => {
    expect(QC_CONFORMANCE).toEqual(['pass', 'fail', 'na'])
    expect(QC_SEVERITY).toEqual(['minor', 'major', 'critical'])
  })

  it('has a label for every value', () => {
    for (const c of QC_CONFORMANCE) expect(QC_CONFORMANCE_LABELS[c]).toBeTruthy()
    for (const s of QC_SEVERITY) expect(QC_SEVERITY_LABELS[s]).toBeTruthy()
  })
})

describe('addQcCommentSchema', () => {
  const base = { entryId: ENTRY, body: 'Looks good.' }

  it('accepts a group comment (no photoId)', () => {
    const result = addQcCommentSchema.safeParse(base)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.photoId).toBeUndefined()
  })

  it('coerces the empty-string "Whole entry" option to undefined (does not reject it)', () => {
    const result = addQcCommentSchema.safeParse({ ...base, photoId: '' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.photoId).toBeUndefined()
  })

  it('accepts a valid uuid photoId (per-photo comment)', () => {
    const result = addQcCommentSchema.safeParse({ ...base, photoId: PHOTO })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.photoId).toBe(PHOTO)
  })

  it('still rejects a non-empty, non-uuid photoId', () => {
    const result = addQcCommentSchema.safeParse({ ...base, photoId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty body', () => {
    const result = addQcCommentSchema.safeParse({ ...base, body: '' })
    expect(result.success).toBe(false)
  })
})
