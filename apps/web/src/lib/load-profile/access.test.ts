import { describe, expect, it } from 'vitest'
import { LOAD_PROFILE_READ_ROLES, LOAD_PROFILE_WRITE_ROLES, loadProfileFilePath, parseLoadProfileFilePath } from './access'

const P = '11111111-2222-3333-4444-555555555555'
const SHA = 'a'.repeat(64)

describe('load profile access', () => {
  it('read excludes only client_viewer; write is owner/admin/PM (00230)', () => {
    expect(LOAD_PROFILE_READ_ROLES).not.toContain('client_viewer')
    expect(LOAD_PROFILE_READ_ROLES).toEqual(expect.arrayContaining(['owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier']))
    expect([...LOAD_PROFILE_WRITE_ROLES].sort()).toEqual(['admin', 'owner', 'project_manager'])
  })
  it('builds and parses the stored path; refuses another project and other extensions', () => {
    const p = loadProfileFilePath(P, SHA, 'Meter 1.CSV')
    expect(p).toBe(`${P}/${SHA}.csv`)
    expect(parseLoadProfileFilePath(p!, P)).toEqual({ sha256: SHA, ext: 'csv' })
    expect(parseLoadProfileFilePath(p!, '99999999-2222-3333-4444-555555555555')).toBeNull()
    expect(loadProfileFilePath(P, SHA, 'book.xls')).toBeNull()
    expect(parseLoadProfileFilePath(`${P}/../${SHA}.csv`, P)).toBeNull()
  })
})
