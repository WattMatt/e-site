import { z } from 'zod'

// Proposable fields = editable INPUTS ONLY (D1, spec §5.3). Mirrors
// GcrChangeRequestField in services/generator-cost-recovery/types.ts.
export const gcrChangeRequestFieldSchema = z.enum([
  'area',
  'category',
  'participation',
  'zone',
  'manual_kw_override',
])

// One captured proposal on a published snapshot. newValue/oldValue stay free-form
// strings (nullable) — the accept path coerces/validates per-field. comment is the
// client's optional note.
export const gcrChangeRequestInputSchema = z.object({
  nodeId: z.string().uuid('nodeId must be a uuid'),
  field: gcrChangeRequestFieldSchema,
  oldValue: z.string().nullable(),
  newValue: z.string().max(1000, 'newValue too long').nullable(),
  comment: z.string().max(2000, 'comment too long').nullable(),
})

export const gcrChangeRequestBatchSchema = z
  .array(gcrChangeRequestInputSchema)
  .min(1, 'Nothing to submit')

export type GcrChangeRequestInputParsed = z.infer<typeof gcrChangeRequestInputSchema>
