import { describe, it, expect } from 'vitest'
import { contentTypeFor, sourceStoragePath, validateSourceMeta, MAX_SOURCE_BYTES } from './source-files'

describe('tariff source files', () => {
  it('accepts only the bucket MIME types, by extension', () => {
    expect(contentTypeFor('Eskom 2026-27.xlsm')).toBe('application/vnd.ms-excel.sheet.macroEnabled.12')
    expect(contentTypeFor('GP.XLSX')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(contentTypeFor('rfd.pdf')).toBe('application/pdf')
    expect(contentTypeFor('notes.docx')).toBeNull()
  })
  it('stores by financial year and sha256 (2a naming); a document without a year goes under reference/', () => {
    const sha = 'a'.repeat(64)
    expect(sourceStoragePath({ financialYear: '2026/27', sha256: sha, fileName: 'X.PDF' })).toBe(`2026-27/${sha}.pdf`)
    expect(sourceStoragePath({ financialYear: null, sha256: sha, fileName: 'rules.pdf' })).toBe(`reference/${sha}.pdf`)
  })
  it('validates the metadata a source needs', () => {
    const ok = { fileName: 'a.pdf', sha256: 'b'.repeat(64), size: 10, kind: 'nersa_decision', title: 'City Power RfD', financialYear: '2026/27', status: 'nersa_approved', licenseeId: null, publishedOn: '', url: '' }
    expect(validateSourceMeta(ok)).toEqual({})
    expect(validateSourceMeta({ ...ok, sha256: 'x', size: MAX_SOURCE_BYTES + 1, title: ' ', financialYear: '2026/28', kind: 'memo' })).toEqual({
      file: 'The file is larger than 50 MB', sha256: 'The file checksum is missing', title: 'Give the document a title',
      financialYear: 'Use the form 2026/27', kind: 'Choose the document kind',
    })
  })
})
