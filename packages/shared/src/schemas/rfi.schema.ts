import { z } from 'zod'

export const createRfiSchema = z.object({
  projectId: z.string().uuid(),
  subject: z.string().min(2, 'Subject required').max(300),
  description: z.string().min(10, 'Description required').max(10000),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  category: z.string().max(100).optional(),
  dueDate: z.string().optional(),
  // The web form's default "Unassigned" <option value=""> submits ''. Treat a
  // blank string as "no assignee chosen" (undefined) so it doesn't fail the
  // uuid check — the create path then applies the project default if any.
  assignedTo: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().uuid().optional(),
  ),
})

export const respondToRfiSchema = z.object({
  rfiId: z.string().uuid(),
  body: z.string().min(10, 'Response required').max(10000),
})

export const updateRfiStatusSchema = z.object({
  rfiId: z.string().uuid(),
  status: z.enum(['draft', 'open', 'responded', 'closed']),
})

export type CreateRfiInput = z.infer<typeof createRfiSchema>
export type RespondToRfiInput = z.infer<typeof respondToRfiSchema>
export type UpdateRfiStatusInput = z.infer<typeof updateRfiStatusSchema>
