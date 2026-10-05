import { describe, it, expect } from 'vitest'
import { currentProjectId, captureTargets, orderForPhone, isActiveHref } from './shell'

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

describe('captureTargets', () => {
  it('scopes every target to the project', () => {
    const t = captureTargets('p-1')
    expect(t.map(x => x.key)).toEqual(['diary', 'snag', 'form', 'inspection', 'rfi'])
    for (const x of t) expect(x.href).toContain('p-1')
  })
  it('opens the diary form directly and carries the project into the RFI form', () => {
    const t = Object.fromEntries(captureTargets('p-1').map(x => [x.key, x.href]))
    expect(t.diary).toBe('/projects/p-1/diary?new=1')
    expect(t.rfi).toBe('/rfis/new?projectId=p-1')
  })
  it('encodes an id so it cannot break out of the path', () => {
    expect(captureTargets('a/b?c')[1].href).toBe('/projects/a%2Fb%3Fc/snags/new')
  })
})

describe('orderForPhone', () => {
  it('puts field modules first and keeps the rest in sidebar order', () => {
    const items = ['Overview', 'Equipment & Materials', 'Cables', 'Site Diary', 'Snags', 'JBCC', 'Forms'].map(label => ({ label }))
    expect(orderForPhone(items).map(i => i.label)).toEqual(['Overview', 'Snags', 'Site Diary', 'Forms', 'Equipment & Materials', 'Cables', 'JBCC'])
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
