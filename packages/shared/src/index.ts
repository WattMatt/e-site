// Schemas
export * from './schemas'

// Services
export * from './services'

// Types
export * from './types'

// Utils
export * from './utils'

// Email (transactional render + recipient resolution)
export * from './email/rfi-email'

// Inspections (Phase 2 — engine + template schema)
export * from './inspections'

// Structure (Phase 2 — nodes, tenant schedule import)
export * from './structure'

// JBCC — Phase 5 pure modules.
// NOTE: `placeholder-fill` is intentionally NOT re-exported here. It imports
// docxtemplater + pizzip at module-init, which Next.js's server bundler
// mishandles. Re-exporting from this barrel would transitively load those
// modules on every page that imports any runtime symbol from @esite/shared
// (e.g. Sidebar.tsx imports OWNER_ADMIN), crashing the admin layout.
// Import fillTemplate via the sub-path entry: '@esite/shared/placeholder-fill'.
export * from './lib/jbcc/sa-public-holidays'
export * from './lib/jbcc/working-days'
