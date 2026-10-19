import { describe, it, expect } from 'vitest'
import {
  formatFileSize,
  isTenderDocumentCategory,
  TENDER_DOCUMENT_CATEGORIES,
  TENDER_DOCUMENT_EXT_RE,
  tenderDocumentCategoryLabel,
} from './documents'

describe('tender document categories', () => {
  it('covers the issue pack a real electrical tender carries', () => {
    const values = TENDER_DOCUMENT_CATEGORIES.map((c) => c.value)
    for (const needed of ['specification', 'drawing', 'pg', 'conditions', 'addendum']) {
      expect(values).toContain(needed)
    }
  })
  it('recognises its own values and nothing else', () => {
    expect(isTenderDocumentCategory('pg')).toBe(true)
    expect(isTenderDocumentCategory('PG')).toBe(false)
    expect(isTenderDocumentCategory('malware')).toBe(false)
  })
  it('labels a category for people, and shows an unknown one as itself', () => {
    expect(tenderDocumentCategoryLabel('pg')).toBe('P&G / preliminaries')
    expect(tenderDocumentCategoryLabel('mystery')).toBe('mystery')
  })
})

describe('issued file rules', () => {
  it('accepts what an engineer issues, including CAD', () => {
    for (const name of ['spec.pdf', 'layout.DWG', 'detail.dxf', 'pg.docx', 'boq-notes.xlsx', 'photos.zip', 'site.JPG']) {
      expect(TENDER_DOCUMENT_EXT_RE.test(name)).toBe(true)
    }
  })
  it('refuses executables and the extensionless', () => {
    for (const name of ['run.exe', 'script.sh', 'archive.rar', 'README']) {
      expect(TENDER_DOCUMENT_EXT_RE.test(name)).toBe(false)
    }
  })
})

describe('formatFileSize', () => {
  it('reads as people do', () => {
    expect(formatFileSize(500)).toBe('1 KB')
    expect(formatFileSize(51200)).toBe('50 KB')
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })
})
