import { z } from 'zod'

export const visitAttendeeSchema = z.object({
  name: z.string().min(1).max(200),
  company: z.string().max(200).optional().default(''),
})

export const createSnagVisitSchema = z.object({
  projectId: z.string().uuid(),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  conductedBy: z.string().uuid().optional(),
  attendees: z.array(visitAttendeeSchema).max(50).default([]),
  title: z.string().max(300).optional(),
  notes: z.string().max(5000).optional(),
})

export const updateSnagVisitSchema = createSnagVisitSchema
  .omit({ projectId: true })
  .partial()
  .extend({ visitId: z.string().uuid() })

export type VisitAttendee = z.infer<typeof visitAttendeeSchema>
export type CreateSnagVisitInput = z.infer<typeof createSnagVisitSchema>
export type UpdateSnagVisitInput = z.infer<typeof updateSnagVisitSchema>
