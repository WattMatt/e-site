import { describe, it, expect } from 'vitest'
import { PROJECTS_LOCAL_QUERY } from '../hooks/projects.queries'

describe('useProjects local query', () => {
  it('selects all local projects with no organisation filter', () => {
    expect(PROJECTS_LOCAL_QUERY).toBe('SELECT * FROM projects ORDER BY name ASC')
  })

  it('never re-hides cross-org shared sites with an org predicate', () => {
    const q = PROJECTS_LOCAL_QUERY.toLowerCase()
    expect(q).not.toContain('organisation_id')
    expect(q).not.toContain('where')
  })
})
