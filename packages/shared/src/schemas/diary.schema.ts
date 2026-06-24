import { z } from 'zod'
import type { DiaryEntryType } from '../services/diary.service'

/**
 * The seven diary entry types. `satisfies readonly DiaryEntryType[]` ties this
 * list to the canonical union in diary.service.ts so an invalid value can't be
 * added here without a type error.
 */
export const DIARY_ENTRY_TYPES = [
  'progress',
  'safety',
  'quality',
  'delay',
  'weather',
  'workforce',
  'general',
] as const satisfies readonly DiaryEntryType[]

export const createDiarySchema = z.object({
  projectId: z.string().uuid(),
  // The web/mobile date inputs emit yyyy-mm-dd; the DATE column rejects anything else.
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A valid date is required'),
  entryType: z.enum(DIARY_ENTRY_TYPES).default('progress'),
  progressNotes: z.string().trim().min(1, 'Progress notes are required').max(10000),
  safetyNotes: z.string().max(10000).optional(),
  qualityNotes: z.string().max(10000).optional(),
  delayNotes: z.string().max(10000).optional(),
  weather: z.string().max(100).optional(),
  workersOnSite: z.number().int().min(0).optional(),
  delays: z.string().max(10000).optional(),
})

export type CreateDiaryInput = z.infer<typeof createDiarySchema>
