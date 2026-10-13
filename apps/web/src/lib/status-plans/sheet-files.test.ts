// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  MAX_FILES_PER_UPLOAD, MAX_SHEETS_PER_PLAN, countPdfPages, defaultSheetLabels, extFor, fileProblem,
  mimeForFile, parseSheetPath, sheetFilePath,
} from './sheet-files'

const O = '66666666-6666-4666-8666-666666666666'
const P = '11111111-1111-4111-8111-111111111111'
const PL = '33333333-3333-4333-8333-333333333333'
const F = '77777777-7777-4777-8777-777777777777'

describe('storage paths', () => {
  it('builds {org}/{project}/{plan}/{folder}/{revision}.{ext} and reads it back', () => {
    const path = sheetFilePath({ orgId: O, projectId: P, planId: PL, folderId: F, revision: 3, mime: 'image/jpeg' })
    expect(path).toBe(`${O}/${P}/${PL}/${F}/3.jpg`)
    expect(parseSheetPath(path)).toEqual({ orgId: O, projectId: P, planId: PL, folderId: F, revision: 3, ext: 'jpg' })
  })
  it('refuses anything the bucket policy would refuse', () => {
    for (const bad of [
      `${O}/${P}/${PL}/${F}/0.pdf`,
      `${O}/${P}/${PL}/${F}/1.jpeg`,
      `${O}/${P}/${PL}/${F}/1.PDF`,
      `${O}/${P}/${PL}/../1.pdf`,
      `${O}/${P}/${PL}/1.pdf`,
      `x/${P}/${PL}/${F}/1.pdf`,
    ]) expect(parseSheetPath(bad), bad).toBeNull()
  })
  it('one extension per type', () => {
    expect([extFor('application/pdf'), extFor('image/png'), extFor('image/jpeg')]).toEqual(['pdf', 'png', 'jpg'])
  })
})

describe('file types and sizes', () => {
  it('trusts a known browser type, else the extension', () => {
    expect(mimeForFile('x.bin', 'application/pdf')).toBe('application/pdf')
    expect(mimeForFile('E-100.PDF', '')).toBe('application/pdf')
    expect(mimeForFile('photo.JPEG', 'application/octet-stream')).toBe('image/jpeg')
    expect(mimeForFile('layout.png', '')).toBe('image/png')
    expect(mimeForFile('layout.dwg', '')).toBeNull()
    expect(mimeForFile('layout.webp', 'image/webp')).toBeNull()
  })
  it('says what is wrong with a file, by name', () => {
    expect(fileProblem({ name: 'a.dwg', size: 10, type: '' })).toBe('a.dwg is not a PDF, PNG or JPEG.')
    expect(fileProblem({ name: 'a.pdf', size: 0, type: 'application/pdf' })).toBe('a.pdf is empty.')
    expect(fileProblem({ name: 'a.pdf', size: 50 * 1024 * 1024 + 1, type: 'application/pdf' })).toBe('a.pdf is larger than 50 MB.')
    expect(fileProblem({ name: 'a.pdf', size: 50 * 1024 * 1024, type: 'application/pdf' })).toBeNull()
  })
  it('limits per upload and per plan', () => {
    expect(MAX_FILES_PER_UPLOAD).toBe(20)
    expect(MAX_SHEETS_PER_PLAN).toBe(200)
  })
})

describe('default labels', () => {
  it('a one-page file is called by its name', () => {
    expect(defaultSheetLabels('Mall GF tenant layout.pdf', 1)).toEqual(['Mall GF tenant layout'])
  })
  it('each page of a multi-page PDF is "Sheet n of N (name)", so two files never collide', () => {
    expect(defaultSheetLabels('E-300.pdf', 3)).toEqual(['Sheet 1 of 3 (E-300)', 'Sheet 2 of 3 (E-300)', 'Sheet 3 of 3 (E-300)'])
  })
  it('never exceeds the 120-character label limit', () => {
    const [label] = defaultSheetLabels(`${'x'.repeat(300)}.pdf`, 2)
    expect(label!.length).toBeLessThanOrEqual(120)
  })
})

describe('countPdfPages', () => {
  it('counts the pages of a real PDF', async () => {
    const d = await PDFDocument.create()
    d.addPage([300, 200]); d.addPage([300, 200]); d.addPage([300, 200])
    expect(await countPdfPages(await d.save())).toBe(3)
  })
  it('null for bytes that are not a PDF', async () => {
    expect(await countPdfPages(new TextEncoder().encode('not a pdf'))).toBeNull()
  })
})
