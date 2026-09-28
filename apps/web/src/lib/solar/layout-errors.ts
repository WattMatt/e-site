/**
 * Errors from 00211 (roof sources, layouts, layout objects, the save RPC) → one
 * human sentence (spec §0.4 rule 5). Keyed on SQLSTATE plus the exact sentences
 * the bind triggers raise. Falls back to humanSolarError EXCEPT for 23505, whose
 * generic mapping there is the access-request sentence.
 */
import { GENERIC_ERROR, STALE_MESSAGE, humanSolarError } from './errors'

export function humanLayoutError(err: { code?: string; message?: string } | null | undefined): string {
  const m = err?.message ?? ''
  const code = err?.code
  if (code === '40001' || m.includes('stale layout')) return STALE_MESSAGE
  if (m.includes('has no scale')) return 'This drawing page has no scale yet — calibrate it before drawing.'
  if (m.includes('drawing belongs to another project')) return 'That drawing belongs to another project.'
  if (m.includes('no longer active')) return 'That drawing has been removed from the project.'
  if (m.includes('stored under another project')) return 'The satellite image does not belong to this project.'
  if (m.includes('sheet of a roof source cannot change')) return 'A roof source keeps its sheet — add a new roof source instead.'
  if (m.includes('stays on the sheet')) return 'A layout stays on the sheet it was drawn on.'
  if (m.includes('roof source belongs to another study')) return 'That roof source belongs to another project.'
  if (m.includes('DB symbol must link to a board')) return 'Link the DB symbol to a board.'
  if (m.includes('equipment board belongs to another project')) return 'That board belongs to another project.'
  if (m.includes('belongs to another layout or changed kind')) return STALE_MESSAGE
  if (code === '23505' && m.includes('layouts_study_name_key')) return 'A layout with that name already exists.'
  if (code === '23505' && m.includes('roof_sources_drawing_page_key')) return 'That drawing page is already a roof source.'
  // "cases" first: a layout-delete FK message names both tables.
  if (code === '23503' && m.includes('"cases"')) return 'Used by a case — change the case first.'
  if (code === '23503' && m.includes('"layouts"')) return 'This roof source is used by a layout — delete the layout first.'
  if (code === 'P0002') return 'This layout no longer exists — reload.'
  if (code === '23505') return GENERIC_ERROR
  return humanSolarError(err)
}
