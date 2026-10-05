/**
 * Numbered items a WhatsApp photo can attach to ("photo for item 10").
 *
 * Every field the web form lets a photo sit on (each answerable entry carries an
 * inline photo strip) plus the template's own photo fields, in template order,
 * numbered from 1. Signatures and file uploads are not photo targets.
 * Repeating groups never reach this path (a template with one is not Flow-capable).
 */
import type { Template } from '../inspections/types'

export interface PhotoItem {
  n: number
  sectionId: string
  fieldId: string
  label: string
  required: boolean
  /** True for a `photo` field, whose only answer IS the photo. */
  isPhotoField: boolean
}

const PHOTO_TARGET_TYPES = new Set(['pass_fail', 'number', 'text', 'textarea', 'dropdown', 'multi_select', 'date', 'photo'])

export function photoItems(t: Template): PhotoItem[] {
  const out: PhotoItem[] = []
  for (const s of t.sections) {
    for (const f of s.fields ?? []) {
      if (!PHOTO_TARGET_TYPES.has(f.type)) continue
      out.push({
        n: out.length + 1,
        sectionId: s.section_id,
        fieldId: f.field_id,
        label: f.label,
        required: f.type === 'photo' && !!f.required,
        isPhotoField: f.type === 'photo',
      })
    }
  }
  return out
}

/** "10", "item 10", "#10", "no. 10" → 10. Anything ambiguous → null. Max 999. */
export function parseItemRef(text: string): number | null {
  const m = text.trim().match(/^(?:item\s*|no\.?\s*|#\s*)?(\d{1,3})\.?$/i)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 ? n : null
}
