import { z } from 'zod';

const nodeKindEnum = z.enum([
  'tenant_db',
  'main_board',
  'common_area_board',
  'rmu',
  'mini_sub',
  'generator',
]);

const nodeStatusEnum = z.enum(['active', 'decommissioned']);

// Input shape: omits server-set id, created_at, updated_at.
// All nullable columns are typed string | null / number | null.
const nodeBaseSchema = z.object({
  project_id: z.string().uuid(),
  organisation_id: z.string().uuid(),
  kind: nodeKindEnum,
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
  created_by: z.string().uuid().nullable().optional(),
});

// Per-kind refinement: tenant_db requires a non-empty shop_number.
export const nodeSchema = nodeBaseSchema.refine(
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
);

export type NodeInput = z.infer<typeof nodeSchema>;
