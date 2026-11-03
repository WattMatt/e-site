import { describe, it, expect } from 'vitest'
import { projectIdFromFilters, projectIdFromRows } from './project-id'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'

describe('projectIdFromFilters', () => {
  it('reads an eq filter on project_id with a uuid', () => {
    expect(projectIdFromFilters([{ column: 'status', op: 'eq', value: 'open' }, { column: 'project_id', op: 'eq', value: P1 }])).toBe(P1)
  })
  it('is null for in, a non-uuid value, another column, or no filters', () => {
    expect(projectIdFromFilters([{ column: 'project_id', op: 'in', value: [P1] }])).toBeNull()
    expect(projectIdFromFilters([{ column: 'project_id', op: 'eq', value: 'nope' }])).toBeNull()
    expect(projectIdFromFilters([{ column: 'id', op: 'eq', value: P1 }])).toBeNull()
    expect(projectIdFromFilters(undefined)).toBeNull()
  })
})

describe('projectIdFromRows', () => {
  it('returns the project id when every row carries the same one', () => {
    expect(projectIdFromRows([{ project_id: P1, a: 1 }, { project_id: P1 }])).toBe(P1)
  })
  it('is null for mixed projects, a missing id, or no rows', () => {
    expect(projectIdFromRows([{ project_id: P1 }, { project_id: P2 }])).toBeNull()
    expect(projectIdFromRows([{ project_id: P1 }, { a: 1 }])).toBeNull()
    expect(projectIdFromRows([{ project_id: 'x' }])).toBeNull()
    expect(projectIdFromRows([])).toBeNull()
  })
})
