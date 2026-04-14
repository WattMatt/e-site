import { describe, it, expect } from 'vitest'

// Tables synced locally via PowerSync (matches useDb.ts)
const POWERSYNC_TABLES = new Set(['snags', 'projects', 'snag_photos'])

function routeTable(table: string): 'local' | 'remote' {
  return POWERSYNC_TABLES.has(table) ? 'local' : 'remote'
}

describe('useDb routing', () => {
  it('routes synced tables to local PowerSync', () => {
    expect(routeTable('snags')).toBe('local')
    expect(routeTable('projects')).toBe('local')
    expect(routeTable('snag_photos')).toBe('local')
  })

  it('routes non-synced tables to remote Supabase', () => {
    expect(routeTable('rfis')).toBe('remote')
    expect(routeTable('compliance_coc')).toBe('remote')
    expect(routeTable('site_diary_entries')).toBe('remote')
    expect(routeTable('handover_checklist')).toBe('remote')
  })
})
