/**
 * A Flow's `response_json` → inspection response rows, in the exact shape the web
 * capture form writes (PassFailField: value_bool + pass_state + fail_reason; every
 * other type: its one value column only).
 *
 * Only keys `flowFieldKeys()` issued are read. Anything else is reported in
 * `unknownKeys` and written nowhere. A value the template does not allow is an
 * error for that field alone; the rest of the reply still applies.
 */
import type { Template } from '../inspections/types'
import { flowFieldKeys } from './flow-builder'

export const MAX_TEXT = 4000

export interface MappedResponse {
  section_id: string
  field_id: string
  value_bool?: boolean | null
  value_number?: number | null
  value_text?: string | null
  value_array?: string[] | null
  pass_state?: 'pass' | 'fail' | 'na'
  fail_reason?: string | null
}

export interface MapResult {
  responses: MappedResponse[]
  errors: { sectionId: string; fieldId: string; message: string }[]
  unknownKeys: string[]
}

const RESERVED = new Set(['flow_token'])

function asText(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length === 0 ? null : t
}

function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function mapFlowReply(t: Template, reply: Record<string, unknown>): MapResult {
  const keys = flowFieldKeys(t)
  const known = new Set(keys.map((k) => k.key))
  const unknownKeys = Object.keys(reply).filter((k) => !known.has(k) && !RESERVED.has(k))
  const responses: MappedResponse[] = []
  const errors: MapResult['errors'] = []

  for (const k of keys) {
    if (k.role !== 'value') continue
    const f = k.field
    const base = { section_id: k.sectionId, field_id: k.fieldId }
    const err = (message: string) => errors.push({ sectionId: k.sectionId, fieldId: k.fieldId, message })
    const raw = reply[k.key]

    if (f.type === 'multi_select') {
      if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) continue
      const arr = Array.isArray(raw) ? raw : null
      const opts = new Set(f.options ?? [])
      if (!arr || !arr.every((x) => typeof x === 'string' && opts.has(x))) { err('not one of the listed options'); continue }
      responses.push({ ...base, value_array: [...new Set(arr as string[])] })
      continue
    }

    const v = asText(raw)
    if (v === null) continue

    switch (f.type) {
      case 'pass_fail': {
        if (v === 'pass') responses.push({ ...base, value_bool: true, pass_state: 'pass', fail_reason: null })
        else if (v === 'na') responses.push({ ...base, value_bool: null, pass_state: 'na', fail_reason: null })
        else if (v === 'fail') {
          const reason = asText(reply[`${k.key}_r`])
          responses.push({ ...base, value_bool: false, pass_state: 'fail', fail_reason: reason ? reason.slice(0, MAX_TEXT) : null })
        } else err('must be Pass, Fail or N/A')
        break
      }
      case 'number': {
        if (!/^-?\d+(?:[.,]\d+)?$/.test(v)) { err('not a number'); break }
        const n = Number(v.replace(',', '.'))
        if (!Number.isFinite(n)) { err('not a number'); break }
        responses.push({ ...base, value_number: n })
        break
      }
      case 'date':
        if (!isIsoDate(v)) { err('not a date'); break }
        responses.push({ ...base, value_text: v })
        break
      case 'dropdown':
        if (!(f.options ?? []).includes(v)) { err('not one of the listed options'); break }
        responses.push({ ...base, value_text: v })
        break
      case 'text':
      case 'textarea':
        responses.push({ ...base, value_text: v.slice(0, MAX_TEXT) })
        break
    }
  }
  return { responses, errors, unknownKeys }
}
