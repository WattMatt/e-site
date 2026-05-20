import { z } from 'zod'
import { ORG_ROLES } from '../types'

export const createOrgSchema = z.object({
  name: z.string().min(2, 'Organisation name required').max(200),
  province: z.enum([
    'Gauteng', 'Western Cape', 'Eastern Cape', 'KwaZulu-Natal',
    'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape',
  ]).optional(),
  registrationNo: z.string().max(50).optional(),
})

/** Runtime validator for OrgRole — derives from the canonical ORG_ROLES tuple. */
export const orgRoleSchema = z.enum(ORG_ROLES)

export type CreateOrgInput = z.infer<typeof createOrgSchema>
