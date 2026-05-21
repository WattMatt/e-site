import { z } from 'zod';

const nodeKindEnum = z.enum([
  'tenant_db',
  'main_board',
  'common_area_board',
  'common_area_lighting',
  'rmu',
  'mini_sub',
  'generator',
  'custom',
]);

const nodeStatusEnum = z.enum(['active', 'decommissioned']);

// Input shape: omits server-set id, created_at, updated_at.
// All nullable columns are typed string | null / number | null.
const nodeBaseSchema = z.object({
  project_id: z.string().uuid(),
  organisation_id: z.string().uuid(),
  kind: nodeKindEnum,
  custom_kind_label: z.string().nullable().optional(),
  code: z.string().min(1),
  name: z.string().nullable().optional(),
  coc_required: z.boolean().optional(),
  status: nodeStatusEnum.optional(),
  // Tenant facet
  shop_number: z.string().nullable().optional(),
  shop_name: z.string().nullable().optional(),
  shop_area_m2: z.number().nullable().optional(),
  // Electrical facet
  breaker_rating_a: z.number().nullable().optional(),
  pole_config: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  rating_kva: z.number().nullable().optional(),
  voltage_v: z.number().nullable().optional(),
  // General
  notes: z.string().nullable().optional(),
  decommission_reason: z.string().nullable().optional(),
  created_by: z.string().uuid().nullable().optional(),
});

// Per-kind refinement: tenant_db requires a non-empty shop_number.
export const nodeSchema = nodeBaseSchema
  .refine(
    (data) => {
      if (data.kind === 'tenant_db') {
        return typeof data.shop_number === 'string' && data.shop_number.length > 0;
      }
      return true;
    },
    {
      message: 'shop_number is required and must be non-empty when kind is tenant_db',
      path: ['shop_number'],
    },
  )
  .refine(
    (data) => {
      if (data.kind === 'custom') {
        return typeof data.custom_kind_label === 'string' && data.custom_kind_label.trim().length > 0;
      }
      return true;
    },
    {
      message: 'custom_kind_label is required and must be non-empty when kind is custom',
      path: ['custom_kind_label'],
    },
  );

export type NodeInput = z.infer<typeof nodeSchema>;
