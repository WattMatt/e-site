import { ToolRefusal } from '../../define-tool'
import { UNKNOWN_SCHEMA } from './sentences'

// Matches PostgREST `db_schema`; the mcp_catalog migration compares against the same list.
export const EXPOSED_SCHEMAS = [
  'public', 'projects', 'inspections', 'field', 'tenants', 'suppliers', 'billing', 'marketplace',
  'cable_schedule', 'structure', 'gcr', 'solar', 'tariffs', 'whatsapp',
] as const

export function assertExposedSchema(schema: string): void {
  if (!(EXPOSED_SCHEMAS as readonly string[]).includes(schema)) throw new ToolRefusal(UNKNOWN_SCHEMA)
}
