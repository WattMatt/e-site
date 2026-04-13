import { z } from 'zod'

export const createSnagSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(2, 'Title required').max(300),
  description: z.string().max(5000).optional(),
  location: z.string().max(500).optional(),
  category: z.string().max(100).default('general'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  assignedTo: z.string().uuid().optional(),
  floorPlanPin: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      floorPlanId: z.string().uuid(),
    })
    .optional(),
})

export const updateSnagSchema = createSnagSchema.partial().extend({
  status: z
    .enum(['open', 'in_progress', 'resolved', 'pending_sign_off', 'signed_off', 'closed'])
    .optional(),
})

export const signOffSnagSchema = z.object({
  snagId: z.string().uuid(),
  signaturePath: z.string().min(1, 'Signature required'),
})

export type CreateSnagInput = z.infer<typeof createSnagSchema>
export type UpdateSnagInput = z.infer<typeof updateSnagSchema>
export type SignOffSnagInput = z.infer<typeof signOffSnagSchema>
