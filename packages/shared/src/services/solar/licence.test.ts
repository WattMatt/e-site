/**
 * BSD-3-Clause compliance for code and tables derived from pvlib-python: source redistributions
 * must retain the copyright notice, the three conditions and the disclaimer. Bundles keep the
 * notice because it is a `/*! @license` legal comment, which minifiers preserve.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const NOTICE_LINES = [
  'Copyright (c) 2023 pvlib python Contributors',
  'Copyright (c) 2014 PVLIB python Development Team',
  'Copyright (c) 2013 Sandia National Laboratories',
  'Redistributions of source code must retain the above copyright notice',
  'Redistributions in binary form must reproduce the above copyright notice',
  'Neither the name of the copyright holder nor the names of its',
  'THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"',
]

describe('pvlib BSD-3 notice', () => {
  it('spa.ts carries the full notice in a preserved legal comment', () => {
    const src = read('./solar-position/spa.ts')
    expect(src.startsWith('/*! @license')).toBe(true)
    for (const line of NOTICE_LINES) expect(src).toContain(line)
  })

  it('THIRD_PARTY_NOTICES.md carries the full notice', () => {
    const src = read('./THIRD_PARTY_NOTICES.md')
    for (const line of NOTICE_LINES) expect(src).toContain(line)
  })

  it('the generated tables and the Perez table point at the notice', () => {
    expect(read('./solar-position/spa-tables.ts')).toContain('THIRD_PARTY_NOTICES.md')
    expect(read('./irradiance/transposition.ts')).toContain('THIRD_PARTY_NOTICES.md')
  })
})
