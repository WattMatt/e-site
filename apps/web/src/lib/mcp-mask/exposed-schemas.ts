// Matches PostgREST `db_schema`; the mcp_catalog migration compares against the same list.
// Lives here, free of imports, so the generator script can read it under tsx; tools/db/exposed-schemas.ts re-exports it.
export const EXPOSED_SCHEMAS = [
  'public', 'projects', 'inspections', 'field', 'tenants', 'suppliers', 'billing', 'marketplace',
  'cable_schedule', 'structure', 'gcr', 'solar', 'tariffs', 'whatsapp',
] as const
