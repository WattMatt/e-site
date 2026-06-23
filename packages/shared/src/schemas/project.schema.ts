import { z } from 'zod'

export const createProjectSchema = z.object({
  name: z.string().min(2, 'Project name required').max(200),
  description: z.string().max(2000).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  province: z.enum([
    'Gauteng', 'Western Cape', 'Eastern Cape', 'KwaZulu-Natal',
    'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape',
  ]).optional(),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).default('active'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  contractValue: z.number().min(0).optional(),
  clientName: z.string().max(200).optional(),
  clientContact: z.string().max(200).optional(),
})

export const updateProjectSchema = createProjectSchema.partial()

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
