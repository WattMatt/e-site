import { z } from 'zod'

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

export const addQcEntrySchema = z.object({
  reportId: z.string().uuid(),
  title: z.string().min(1, 'Title required').max(300),
  description: z.string().max(5000).optional(),
})

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
export type AddQcCommentInput = z.infer<typeof addQcCommentSchema>
