import { z } from 'zod'

/** Every id an MCP tool accepts is a uuid: the wrapper reads projectId / organisationId from the parsed args as audit labels. */
export const projectId = z.string().uuid()
export const organisationId = z.string().uuid()

/** Out-of-range limits are clamped, not refused. */
export const MAX_LIMIT = 200
export const limit = z.number().int().default(50).transform((n) => Math.min(MAX_LIMIT, Math.max(1, n)))

export const cursor = z.string().optional()
