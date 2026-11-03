/**
 * The tender issue pack (00252): categories and file rules for the documents
 * WM issues WITH a tender — specifications, drawings, P&G, conditions of
 * tender — and for the attachments an addendum carries after issue.
 */

export const TENDER_DOCUMENT_CATEGORIES = [
  { value: 'specification', label: 'Specification' },
  { value: 'drawing', label: 'Drawing' },
  { value: 'pg', label: 'P&G / preliminaries' },
  { value: 'conditions', label: 'Conditions of tender' },
  { value: 'returnable', label: 'Returnable form' },
  { value: 'addendum', label: 'Addendum attachment' },
  { value: 'other', label: 'Other' },
] as const

export type TenderDocumentCategory = (typeof TENDER_DOCUMENT_CATEGORIES)[number]['value']

export function isTenderDocumentCategory(v: string): v is TenderDocumentCategory {
  return TENDER_DOCUMENT_CATEGORIES.some((c) => c.value === v)
}

export function tenderDocumentCategoryLabel(v: string): string {
  return TENDER_DOCUMENT_CATEGORIES.find((c) => c.value === v)?.label ?? v
}

/** What WM may issue. Wider than bidder uploads (dwg/dxf drawings belong here). */
export const TENDER_DOCUMENT_EXT_RE = /\.(pdf|jpe?g|png|xlsx|xlsm|docx?|dwg|dxf|zip)$/i
export const TENDER_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024

export interface TenderDocumentRow {
  id: string
  clarification_id: string | null
  category: string
  label: string
  file_name: string
  file_size: number
  sort_order: number
  created_at: string
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`
}
