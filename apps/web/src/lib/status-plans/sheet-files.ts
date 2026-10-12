/**
 * Tenant plan files: where they live, what they may be, what they are called
 * (spec 2026-10-12 §3). Server-side: the sheet actions import it; pdf-lib is
 * loaded only to count pages.
 *
 * The path pattern is the one the 00248 trigger and bucket policy enforce:
 *   {org}/{project}/{plan}/{folder}/{revision}.{pdf|png|jpg}
 * where folder is the id of the first sheet the file was uploaded for. A PDF
 * of N pages is N sheets sharing one path.
 */
import { PDFDocument } from 'pdf-lib'
import { SHEET_LABEL_MAX, TENANT_PLAN_MAX_BYTES, TENANT_PLAN_MIMES, type TenantPlanMime } from '@esite/shared/status-plans'

export const MAX_FILES_PER_UPLOAD = 20
export const MAX_SHEETS_PER_PLAN = 200

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PATH_RE = new RegExp(`^(${UUID})/(${UUID})/(${UUID})/(${UUID})/([1-9][0-9]{0,5})\\.(pdf|png|jpg)$`)

export type SheetExt = 'pdf' | 'png' | 'jpg'

export function extFor(mime: TenantPlanMime): SheetExt {
  if (mime === 'application/pdf') return 'pdf'
  return mime === 'image/png' ? 'png' : 'jpg'
}

/** The browser's type when it is one we take, else the extension; null = not a PDF, PNG or JPEG. */
export function mimeForFile(name: string, type: string): TenantPlanMime | null {
  if ((TENANT_PLAN_MIMES as readonly string[]).includes(type)) return type as TenantPlanMime
  if (/\.pdf$/i.test(name)) return 'application/pdf'
  if (/\.png$/i.test(name)) return 'image/png'
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg'
  return null
}

/** A sentence naming what is wrong with a chosen file, or null when it can be uploaded. */
export function fileProblem(f: { name: string; size: number; type: string }): string | null {
  if (!mimeForFile(f.name, f.type)) return `${f.name} is not a PDF, PNG or JPEG.`
  if (!(f.size > 0)) return `${f.name} is empty.`
  if (f.size > TENANT_PLAN_MAX_BYTES) return `${f.name} is larger than 60 MB.`
  return null
}

export interface SheetPathParts {
  orgId: string
  projectId: string
  planId: string
  folderId: string
  revision: number
  ext: SheetExt
}

export function sheetFilePath(p: Omit<SheetPathParts, 'ext'> & { mime: TenantPlanMime }): string {
  return `${p.orgId}/${p.projectId}/${p.planId}/${p.folderId}/${p.revision}.${extFor(p.mime)}`
}

export function parseSheetPath(path: string): SheetPathParts | null {
  const m = PATH_RE.exec(path)
  if (!m) return null
  return { orgId: m[1]!, projectId: m[2]!, planId: m[3]!, folderId: m[4]!, revision: Number(m[5]), ext: m[6] as SheetExt }
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim() || 'Sheet'
}

function clip(label: string): string {
  return label.length <= SHEET_LABEL_MAX ? label : `${label.slice(0, SHEET_LABEL_MAX - 1)}…`
}

/**
 * Default labels for one uploaded file: its name for a one-page file, and
 * "Sheet n of N (name)" for each page of a multi-page PDF, so two multi-page
 * files uploaded together never produce the same label. Renamable afterwards.
 */
export function defaultSheetLabels(fileName: string, pageCount: number): string[] {
  const base = baseName(fileName)
  if (pageCount <= 1) return [clip(base)]
  return Array.from({ length: pageCount }, (_, i) => clip(`Sheet ${i + 1} of ${pageCount} (${base})`))
}

/**
 * Page count of a PDF, or null when pdf-lib cannot read it. Encrypted files
 * are counted (ignoreEncryption), not opened: the canvas and the renderer say
 * so themselves if they cannot draw one.
 */
export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false })
    const n = doc.getPageCount()
    return n > 0 ? n : null
  } catch {
    return null
  }
}
