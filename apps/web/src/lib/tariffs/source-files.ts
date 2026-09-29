/**
 * Tariff source files: the three MIME types the private tariff-sources bucket
 * accepts (00209), 2a's storage naming (<fy>/<sha256>.<ext>), metadata checks.
 */
import { SOURCE_DOCUMENT_KINDS, SOURCE_DOCUMENT_STATUSES } from '@esite/shared'

export const MAX_SOURCE_BYTES = 52_428_800

const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
}

function ext(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
}

export function contentTypeFor(fileName: string): string | null {
  return TYPES[ext(fileName)] ?? null
}

/** Same as 2a's storagePathFor for a dated source; undated references live under reference/. */
export function sourceStoragePath(s: { financialYear: string | null; sha256: string; fileName: string }): string {
  return s.financialYear ? `${s.financialYear.replace('/', '-')}/${s.sha256}${ext(s.fileName)}` : `reference/${s.sha256}${ext(s.fileName)}`
}

export interface SourceMeta {
  fileName: string
  sha256: string
  size: number
  kind: string
  title: string
  financialYear: string
  status: string
  licenseeId: string | null
  publishedOn: string
  url: string
}

export type SourceMetaField = 'file' | 'sha256' | 'kind' | 'title' | 'financialYear' | 'status' | 'publishedOn' | 'url'

const FY = /^(\d{4})\/(\d{2})$/

export function validateSourceMeta(m: SourceMeta): Partial<Record<SourceMetaField, string>> {
  const e: Partial<Record<SourceMetaField, string>> = {}
  if (!contentTypeFor(m.fileName)) e.file = 'Upload a PDF, XLSX or XLSM file'
  else if (!(m.size > 0)) e.file = 'The file is empty'
  else if (m.size > MAX_SOURCE_BYTES) e.file = 'The file is larger than 50 MB'
  if (!/^[0-9a-f]{64}$/.test(m.sha256)) e.sha256 = 'The file checksum is missing'
  if (!(SOURCE_DOCUMENT_KINDS as readonly string[]).includes(m.kind)) e.kind = 'Choose the document kind'
  if (!m.title.trim()) e.title = 'Give the document a title'
  else if (m.title.trim().length > 300) e.title = 'Keep the title under 300 characters'
  if (m.financialYear.trim()) {
    const f = FY.exec(m.financialYear.trim())
    if (!f || (Number(f[1]) + 1) % 100 !== Number(f[2])) e.financialYear = 'Use the form 2026/27'
  }
  if (!(SOURCE_DOCUMENT_STATUSES as readonly string[]).includes(m.status)) e.status = 'Choose the document status'
  if (m.publishedOn && !/^\d{4}-\d{2}-\d{2}$/.test(m.publishedOn)) e.publishedOn = 'Use a date'
  if (m.url && !/^https:\/\/\S+$/.test(m.url)) e.url = 'Use an https:// link'
  return e
}
