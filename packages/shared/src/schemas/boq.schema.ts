import { z } from 'zod'

export const QUANTITY_MODES = ['measured', 'rate_only', 'lump_sum', 'provisional', 'pc_sum'] as const
export const RATE_MODELS = ['supply_install', 'single', 'amount_only'] as const
export const SECTION_KINDS = ['bill', 'section', 'category'] as const

export const boqItemSchema = z.object({
  id: z.string().uuid(),
  sectionId: z.string().uuid(),
  code: z.string().nullable(),
  description: z.string(),
  unit: z.string().nullable(),
  quantity: z.number().nullable(),
  quantityMode: z.enum(QUANTITY_MODES),
  rateModel: z.enum(RATE_MODELS),
  supplyRate: z.number().nullable(),
  installRate: z.number().nullable(),
  rate: z.number().nullable(),
  amount: z.number().nullable(),
  sortOrder: z.number().int(),
  origin: z.enum(['contract', 'variation']),
  variationLineId: z.string().uuid().nullable(),
})

export const boqSectionSchema = z.object({
  id: z.string().uuid(),
  importId: z.string().uuid(),
  parentSectionId: z.string().uuid().nullable(),
  kind: z.enum(SECTION_KINDS),
  code: z.string().nullable(),
  title: z.string(),
  sortOrder: z.number().int(),
  nodeId: z.string().uuid().nullable(),
})

export const boqImportSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  organisationId: z.string().uuid(),
  sourceFilename: z.string(),
  storagePath: z.string().nullable(),
  importedBy: z.string().uuid().nullable(),
  importedAt: z.string(),
  totalExVat: z.number().nullable(),
  vatAmount: z.number().nullable(),
  totalInclVat: z.number().nullable(),
  lineItemCount: z.number().int(),
  isCurrent: z.boolean(),
})

export const boqItemRatePatchSchema = z
  .object({
    supplyRate: z.number().nonnegative().nullable().optional(),
    installRate: z.number().nonnegative().nullable().optional(),
    rate: z.number().nonnegative().nullable().optional(),
  })
  .refine((p) => p.supplyRate !== undefined || p.installRate !== undefined || p.rate !== undefined, {
    message: 'At least one rate field is required',
  })

export type BoqItem = z.infer<typeof boqItemSchema>
export type BoqSection = z.infer<typeof boqSectionSchema>
export type BoqImport = z.infer<typeof boqImportSchema>
export type BoqItemRatePatch = z.infer<typeof boqItemRatePatchSchema>
export type QuantityMode = (typeof QUANTITY_MODES)[number]
export type RateModel = (typeof RATE_MODELS)[number]
export type SectionKind = (typeof SECTION_KINDS)[number]
