import { z } from 'zod'

// Conformance model (migration 00176). QC_CONFORMANCE / QC_SEVERITY are the
// single source of truth for the value domains — the Zod enums, the DB CHECKs
// (projects.qc_entries) and the UI segmented controls all derive from these.
export const QC_CONFORMANCE = ['pass', 'fail', 'na'] as const
export const QC_SEVERITY = ['minor', 'major', 'critical'] as const

export type QcConformanceValue = (typeof QC_CONFORMANCE)[number]
export type QcSeverityValue = (typeof QC_SEVERITY)[number]

export const QC_CONFORMANCE_LABELS: Record<QcConformanceValue, string> = {
  pass: 'Pass',
  fail: 'Fail',
  na: 'N/A',
}

export const QC_SEVERITY_LABELS: Record<QcSeverityValue, string> = {
  minor: 'Minor',
  major: 'Major',
  critical: 'Critical',
}

/**
 * Severity is present iff conformance is 'fail'. The DB CHECK only bounds the
 * value domain (severity NULL or one of the three); this relationship is
 * enforced here at the app layer and attached to any schema carrying both
 * fields so add/edit paths share one rule.
 */
function refineSeverityIffFail(
  val: { conformance: QcConformanceValue; severity?: QcSeverityValue },
  ctx: z.RefinementCtx,
) {
  if (val.conformance === 'fail' && val.severity === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['severity'],
      message: 'Severity is required when conformance is Fail',
    })
  }
  if (val.conformance !== 'fail' && val.severity !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['severity'],
      message: 'Severity applies only to a Fail conformance',
    })
  }
}

export const createQcReportSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(2, 'Title required').max(300),
  description: z.string().max(10000).optional(),
  location: z.string().max(500).optional(),
  // A blank <input type="date"> submits ''. Treat it as "no date chosen"
  // (undefined) so it doesn't fail the format check — the DATE column
  // rejects '' anyway (same coercion as rfi.schema's assignedTo).
  inspectionDate: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A valid date is required').optional(),
  ),
})

export const updateQcReportSchema = createQcReportSchema
  .omit({ projectId: true })
  .partial()
  .extend({ reportId: z.string().uuid() })

export const addQcEntrySchema = z
  .object({
    reportId: z.string().uuid(),
    title: z.string().min(1, 'Title required').max(300),
    description: z.string().max(5000).optional(),
    conformance: z.enum(QC_CONFORMANCE),
    severity: z.enum(QC_SEVERITY).optional(),
  })
  .superRefine(refineSeverityIffFail)

export const updateQcEntrySchema = z
  .object({
    entryId: z.string().uuid(),
    title: z.string().min(1, 'Title required').max(300),
    description: z.string().max(5000).optional(),
    conformance: z.enum(QC_CONFORMANCE),
    severity: z.enum(QC_SEVERITY).optional(),
  })
  .superRefine(refineSeverityIffFail)

export const addQcCommentSchema = z.object({
  entryId: z.string().uuid(),
  // The comment form's "Whole entry" <option value=""> submits ''. Coerce to
  // undefined (group comment) so it doesn't fail the uuid check.
  photoId: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().uuid().optional(),
  ),
  body: z.string().min(1, 'Comment required').max(5000),
})

export type CreateQcReportInput = z.infer<typeof createQcReportSchema>
export type UpdateQcReportInput = z.infer<typeof updateQcReportSchema>
export type AddQcEntryInput = z.infer<typeof addQcEntrySchema>
export type UpdateQcEntryInput = z.infer<typeof updateQcEntrySchema>
export type AddQcCommentInput = z.infer<typeof addQcCommentSchema>
