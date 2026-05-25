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

export const generateLetterSchema = z.object({
  notice_code:        z.string().regex(/^N-\d{2}$/),
  recipient_party_id: z.string().uuid(),
  trigger_date:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  manual_values:      z.record(z.string(), z.string()),
})
export type GenerateLetterInput = z.infer<typeof generateLetterSchema>

export const letterStatusSchema = z.object({
  status:         z.enum(['draft', 'issued', 'served']),
  issued_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  service_method: z.enum(['hand', 'email', 'registered_post']).nullable().optional(),
  served_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes:          z.string().max(2000).nullable().optional(),
})
export type LetterStatusInput = z.infer<typeof letterStatusSchema>
