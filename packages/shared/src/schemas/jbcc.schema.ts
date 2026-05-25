import { z } from 'zod'

export const partyRoleSchema = z.enum([
  'principal_agent', 'employer', 'guarantor', 'subcontractor', 'other',
])

const optionalString = (max: number) =>
  z.string().trim().max(max).nullable().optional()
    .transform(v => (v === '' ? null : v ?? null))

export const partyInputSchema = z.object({
  party_role: partyRoleSchema,
  name:       z.string().trim().min(1, 'Name is required').max(120),
  company:    optionalString(160),
  address:    optionalString(400),
  email:      z.union([
                z.string().trim().email(),
                z.literal('').transform(() => null),
              ]).nullable().optional(),
  phone:      optionalString(40),
})
export type PartyInput = z.infer<typeof partyInputSchema>
