import { it, expect } from 'vitest'
import { refuseOnDbError } from './db-error'
import { ToolRefusal } from '../../define-tool'
import * as S from './sentences'

const msg = (e: Parameters<typeof refuseOnDbError>[0]) => { try { refuseOnDbError(e) } catch (x) { expect(x).toBeInstanceOf(ToolRefusal); return (x as Error).message } return null }

it('does not throw on null', () => expect(() => refuseOnDbError(null)).not.toThrow())
it('formats code and message', () => {
  expect(msg({ code: '42P01', message: 'relation "x" does not exist', details: null, hint: null })).toBe('Database error 42P01: relation "x" does not exist')
})
it('appends details and hint when present', () => {
  expect(msg({ code: '23505', message: 'duplicate key', details: 'Key (id)=(1) exists.', hint: 'Use another id.' }))
    .toBe('Database error 23505: duplicate key — Key (id)=(1) exists. (Use another id.)')
  expect(msg({ code: '23505', message: 'm', hint: 'h' })).toBe('Database error 23505: m (h)')
})
it('uses unknown for a missing code', () => expect(msg({ message: 'boom' })).toBe('Database error unknown: boom'))
it('passes a known sentence through alone, dropping code, details and hint', () => {
  expect(msg({ code: 'P0001', message: 'Only one read-only SELECT is allowed here.', details: 'd', hint: 'h' })).toBe('Only one read-only SELECT is allowed here.')
})
it('passes every sentence of the module through', () => {
  for (const s of [S.NEED_FILTER, S.DENYLISTED, S.UNKNOWN_OP, S.BAD_IDENT, S.MASKED_COLUMN, S.SQL_ONLY_SELECT, S.PREVIEW_MISMATCH, S.PREVIEW_TOO_WIDE, S.SQL_ROLE, S.UNKNOWN_SCHEMA, S.EMPTY_PATCH]) {
    expect(msg({ code: 'P0001', message: s })).toBe(s)
  }
})
