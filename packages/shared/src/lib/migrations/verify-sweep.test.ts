import { describe, it, expect } from 'vitest'
import { buildVerifySweepSql } from './verify-header'

const MIG_A = [
  '-- @verify:begin',
  '-- table: tenants.alpha',
  '-- behaviour: an owner can open the alpha page',
  '-- @verify:end',
  'CREATE TABLE tenants.alpha (id int);',
].join('\n')

const MIG_B = ['-- @verify:begin', '-- sql: (SELECT 1 = 1)', '-- @verify:end'].join('\n')

describe('buildVerifySweepSql', () => {
  it('emits one labelled (check, ok) branch per checkable directive', () => {
    const sql = buildVerifySweepSql([
      { file: '00300_a.sql', sql: MIG_A },
      { file: '00301_b.sql', sql: MIG_B },
      { file: '00302_none.sql', sql: 'SELECT 1;' },
    ])
    expect(sql.match(/UNION ALL/g)).toHaveLength(1)
    expect(sql).toContain(`'00300_a.sql #1 table'::text AS "check"`)
    expect(sql).toContain(`'00301_b.sql #1 sql'::text AS "check"`)
    expect(sql).toContain("to_regclass('tenants.alpha')")
    expect(sql).not.toContain('an owner can open the alpha page')
    expect(sql.trimEnd().endsWith(';')).toBe(true)
  })

  it('escapes quotes in labels', () => {
    const sql = buildVerifySweepSql([{ file: "00303_o'neil.sql", sql: MIG_B }])
    expect(sql).toContain(`'00303_o''neil.sql #1 sql'::text`)
  })

  it('refuses to sweep nothing, because a sweep over nothing passes vacuously', () => {
    expect(() => buildVerifySweepSql([{ file: '00302_none.sql', sql: 'SELECT 1;' }])).toThrow('nothing to sweep')
  })
})
