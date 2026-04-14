/**
 * Tables synced locally via PowerSync.
 * All other tables go direct to Supabase.
 */
export const POWERSYNC_TABLES = new Set(['snags', 'projects', 'snag_photos'])
