import { z } from 'zod'

export const INPUT_METHODS = ['percent', 'quantity', 'section'] as const
export const VALUATION_STATUSES = ['draft', 'certified'] as const

export const valuationLineSchema = z.object({
  id: z.string().uuid(),
  valuationId: z.string().uuid(),
  boqItemId: z.string().uuid(),
  inputMethod: z.enum(INPUT_METHODS),
  percentComplete: z.number().nullable(),
  qtyComplete: z.number().nullable(),
  valueToDate: z.number(),
})

export const valuationSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  organisationId: z.string().uuid(),
  boqImportId: z.string().uuid(),
  valuationNo: z.number().int(),
  valuationDate: z.string(),
  status: z.enum(VALUATION_STATUSES),
  retentionPct: z.number(),
  grossToDate: z.number().nullable(),
  retentionAmount: z.number().nullable(),
  netToDate: z.number().nullable(),
  previousNet: z.number().nullable(),
  dueExVat: z.number().nullable(),
  vatAmount: z.number().nullable(),
  dueInclVat: z.number().nullable(),
  reportId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  certifiedBy: z.string().uuid().nullable(),
  certifiedAt: z.string().nullable(),
})

export const valuationProgressPatchSchema = z
  .object({
    boqItemId: z.string().uuid(),
    inputMethod: z.enum(INPUT_METHODS),
    percentComplete: z.number().min(0).max(100).nullable().optional(),
    qtyComplete: z.number().min(0).nullable().optional(),
  })
  .refine(
    (p) => (p.inputMethod === 'quantity' ? p.qtyComplete != null : p.percentComplete != null),
    { message: 'percent/section require percentComplete; quantity requires qtyComplete' },
  )

export type Valuation = z.infer<typeof valuationSchema>
export type ValuationLine = z.infer<typeof valuationLineSchema>
export type ValuationProgressPatch = z.infer<typeof valuationProgressPatchSchema>
export type InputMethod = (typeof INPUT_METHODS)[number]
export type ValuationStatus = (typeof VALUATION_STATUSES)[number]
