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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const generateLetterSchema = z.object({
  notice_code:        z.string().regex(/^N-\d{2}$/),
  recipient_party_id: z.string().uuid(),
  trigger_date:       isoDate.nullable().optional(),
  manual_values:      z.record(z.string(), z.string()),
  subject:            z.string().trim().max(240).nullable().optional(),
  cc_party_ids:       z.array(z.string().uuid()).max(20).optional(),
})
export type GenerateLetterInput = z.infer<typeof generateLetterSchema>

/** Preview accepts NO recipient — an example letter renders from the onset. */
export const previewLetterSchema = z.object({
  notice_code:        z.string().regex(/^N-\d{2}$/),
  recipient_party_id: z.string().uuid().nullable().optional(),
  trigger_date:       isoDate.nullable().optional(),
  manual_values:      z.record(z.string(), z.string()).default({}),
})
export type PreviewLetterInput = z.infer<typeof previewLetterSchema>

// Legacy shape retained so the old tracking transition keeps working.
export const letterStatusSchema = z.object({
  status:         z.enum(['draft', 'issued', 'served']),
  issued_date:    isoDate.nullable().optional(),
  service_method: z.enum(['hand', 'email', 'registered_post']).nullable().optional(),
  served_date:    isoDate.nullable().optional(),
  notes:          z.string().max(2000).nullable().optional(),
})
export type LetterStatusInput = z.infer<typeof letterStatusSchema>

/** Controlled ISO-9001 lifecycle transitions used by the letter detail page. */
export const letterLifecycleSchema = z.object({
  action: z.enum([
    'submit_for_review', 'approve', 'issue', 'mark_served',
    'revert_to_draft', 'withdraw', 'soft_delete',
    'set_legal_hold', 'clear_legal_hold',
  ]),
  issued_date:       isoDate.nullable().optional(),
  service_method:    z.enum(['hand', 'email', 'registered_post']).nullable().optional(),
  served_date:       isoDate.nullable().optional(),
  service_reference: z.string().trim().max(200).nullable().optional(),
  notes:             z.string().max(2000).nullable().optional(),
})
export type LetterLifecycleInput = z.infer<typeof letterLifecycleSchema>
