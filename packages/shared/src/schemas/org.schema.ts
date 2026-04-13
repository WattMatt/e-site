import { z } from 'zod'

export const createOrgSchema = z.object({
  name: z.string().min(2, 'Organisation name required').max(200),
  province: z.enum([
    'Gauteng', 'Western Cape', 'Eastern Cape', 'KwaZulu-Natal',
    'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape',
  ]).optional(),
  registrationNo: z.string().max(50).optional(),
})

export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['admin', 'project_manager', 'contractor', 'inspector', 'supplier', 'client_viewer']),
})

export type CreateOrgInput = z.infer<typeof createOrgSchema>
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>
