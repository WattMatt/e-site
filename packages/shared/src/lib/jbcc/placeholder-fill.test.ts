// packages/shared/src/lib/jbcc/placeholder-fill.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fillTemplate } from './placeholder-fill'

const FIXTURE = join(__dirname, '__fixtures__/N-01.docx')

/** Extract the visible text of a generated .docx via `unzip -p`. */
function extractText(buf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'jbcc-fill-'))
  const docx = join(dir, 'out.docx')
  writeFileSync(docx, buf)
  const xml = execSync(`unzip -p ${JSON.stringify(docx)} word/document.xml`, { encoding: 'utf-8' })
  return xml.replace(/<\/w:r>\s*<w:r[^>]*>/g, '').replace(/<[^>]+>/g, '')
}

describe('fillTemplate', () => {
  it('substitutes every [bracketed] placeholder with the supplied value', () => {
    const template = readFileSync(FIXTURE)
    const buf = fillTemplate(template, {
      'Insert Date':              '2026-05-22',
      'Name of Recipient':        'Jane Architect',
      'Principal Agent':          'Architects Inc',
      'Company Name':             'Architects Inc',
      'Street Address':           '1 Long Street',
      'City, Postal Code':        'Cape Town, 8001',
      'Contract Title':           'Test Contract',
      'Contract Number':          'TC-001',
      'describe additional work': 'Excavate and re-line the basement sump.',
    })
    const text = extractText(buf)
    // Values are present:
    expect(text).toContain('Jane Architect')
    expect(text).toContain('2026-05-22')
    expect(text).toContain('Excavate and re-line the basement sump.')
    // Original brackets are gone (replaced):
    expect(text).not.toContain('[describe additional work]')
  })

  it('leaves unknown placeholders blank rather than failing', () => {
    const template = readFileSync(FIXTURE)
    const buf = fillTemplate(template, { 'Name of Recipient': 'Pat Inspector' })
    const text = extractText(buf)
    expect(text).toContain('Pat Inspector')
  })
})
