import { describe, it, expect } from 'vitest'
import { currentProjectId, captureHref, orderForPhone, isActiveHref } from './shell'
import { projectNav } from '@/components/layout/Sidebar'

describe('currentProjectId', () => {
  it('reads the project from a project path', () => {
    expect(currentProjectId('/projects/abc/snags/new', null)).toBe('abc')
    expect(currentProjectId('/projects/abc', null)).toBe('abc')
  })
  it('treats /projects/new as no project (it is the create form)', () => {
    expect(currentProjectId('/projects/new', null)).toBeNull()
  })
  it('falls back to ?projectId= (the RFI pages) and to null', () => {
    expect(currentProjectId('/rfis', 'p1')).toBe('p1')
    expect(currentProjectId('/rfis', '')).toBeNull()
    expect(currentProjectId('/dashboard', null)).toBeNull()
  })
  it('prefers the path over the query', () => {
    expect(currentProjectId('/projects/a/diary', 'b')).toBe('a')
  })
})

describe('captureHref', () => {
  it("points at the project's own Capture page (E1 owns the action list)", () => {
    expect(captureHref('p-1')).toBe('/projects/p-1/capture')
  })
  it('encodes an id so it cannot break out of the path', () => {
    expect(captureHref('a/b?c')).toBe('/projects/a%2Fb%3Fc/capture')
  })
})

describe('orderForPhone', () => {
  it('puts the field sections of the REAL project nav first, then the rest in sidebar order', () => {
    const labels = orderForPhone(projectNav('x')).map(i => i.label)
    const field = ['Overview', 'Capture', 'Snags', 'Site Diary', 'Forms', 'Inspections', 'Quality Control', 'RFIs', 'Floor Plans']
    expect(labels.slice(0, field.length)).toEqual(field)
    const rest = projectNav('x').map(i => i.label).filter(l => !field.includes(l))
    expect(labels.slice(field.length)).toEqual(rest)
  })
})

describe('isActiveHref', () => {
  it('matches exactly or by prefix and ignores the query string', () => {
    expect(isActiveHref('/projects/a', '/projects/a/snags', true)).toBe(false)
    expect(isActiveHref('/projects/a/snags', '/projects/a/snags/x', false)).toBe(true)
    expect(isActiveHref('/rfis?projectId=a', '/rfis', false)).toBe(true)
    expect(isActiveHref('/projects/a/snag', '/projects/a/snags', false)).toBe(false)
  })
})
