import { z } from 'zod'

export const VARIATION_LINE_KINDS = ['adjust', 'add'] as const
export const VO_STATUSES = ['draft', 'approved'] as const

export const variationOrderSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  organisationId: z.string().uuid(),
  boqImportId: z.string().uuid(),
  voNo: z.number().int(),
  voDate: z.string(),
  title: z.string(),
  reason: z.string().nullable(),
  status: z.enum(VO_STATUSES),
  netChange: z.number().nullable(),
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().nullable(),
})

export const variationLineSchema = z.object({
  id: z.string().uuid(),
  variationOrderId: z.string().uuid(),
  kind: z.enum(VARIATION_LINE_KINDS),
  boqItemId: z.string().uuid().nullable(),
  qtyDelta: z.number().nullable(),
  sectionId: z.string().uuid().nullable(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  unit: z.string().nullable(),
  quantity: z.number().nullable(),
  rateModel: z.enum(['supply_install', 'single']).nullable(),
  supplyRate: z.number().nullable(),
  installRate: z.number().nullable(),
  rate: z.number().nullable(),
  valueChange: z.number(),
  materializedItemId: z.string().uuid().nullable(),
})

export const variationLinePatchSchema = z
  .object({
    kind: z.enum(VARIATION_LINE_KINDS),
    boqItemId: z.string().uuid().optional(),
    qtyDelta: z.number().optional(),
    sectionId: z.string().uuid().optional(),
    code: z.string().nullable().optional(),
    description: z.string().min(1).optional(),
    unit: z.string().nullable().optional(),
    quantity: z.number().nonnegative().optional(),
    rateModel: z.enum(['supply_install', 'single']).optional(),
    supplyRate: z.number().nonnegative().nullable().optional(),
    installRate: z.number().nonnegative().nullable().optional(),
    rate: z.number().nonnegative().nullable().optional(),
  })
  .refine(
    (p) => (p.kind === 'adjust' ? p.boqItemId != null && p.qtyDelta != null : true),
    { message: 'adjust requires boqItemId + qtyDelta' },
  )
  .refine(
    (p) =>
      p.kind === 'add'
        ? p.sectionId != null &&
          p.description != null &&
          p.quantity != null &&
          (p.rateModel === 'single' ? p.rate != null : p.supplyRate != null || p.installRate != null)
        : true,
    { message: 'add requires sectionId + description + quantity + a rate' },
  )

export type VariationOrder = z.infer<typeof variationOrderSchema>
export type VariationLine = z.infer<typeof variationLineSchema>
export type VariationLinePatch = z.infer<typeof variationLinePatchSchema>
export type VariationLineKind = (typeof VARIATION_LINE_KINDS)[number]
export type VoStatus = (typeof VO_STATUSES)[number]
