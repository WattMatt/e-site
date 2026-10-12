import { z } from 'zod'

// A web form submits '' for an untouched <select> or text input and NaN for an
// empty <input type="number" valueAsNumber>. For an optional field each of
// those means "not given", so map them to undefined before validating; the
// insert then writes NULL. Without this an optional Province failed the enum
// on '' and an empty Contract value failed z.number() on NaN.
const blankToUndefined = (v: unknown) =>
  v === null || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && Number.isNaN(v))
    ? undefined
    : v

const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().max(max).optional())

export const createProjectSchema = z.object({
  name: z.string().min(2, 'Project name required').max(200),
  description: optionalText(2000),
  address: optionalText(500),
  city: optionalText(100),
  province: z.preprocess(blankToUndefined, z.enum([
    'Gauteng', 'Western Cape', 'Eastern Cape', 'KwaZulu-Natal',
    'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape',
  ]).optional()),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).default('active'),
  startDate: z.preprocess(blankToUndefined, z.string().optional()),
  endDate: z.preprocess(blankToUndefined, z.string().optional()),
  contractValue: z.preprocess(blankToUndefined, z.number().min(0).optional()),
  clientName: optionalText(200),
  clientContact: optionalText(200),
})

export const updateProjectSchema = createProjectSchema.partial()

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
