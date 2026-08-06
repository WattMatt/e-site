/**
 * Hex accent → pdf-lib colour — THE single conversion chokepoint for the
 * low-level pdf-lib renderers (cable-schedule revision pack, tag-list PDF,
 * Avery labels, DB legend card). The react-pdf reports consume the accent
 * hex directly; pdf-lib wants 0–1 rgb components.
 *
 * Accent precedence (project → org → DEFAULT_ACCENT) is resolved upstream
 * by resolveAccent in ./theme — this helper only converts, and falls back
 * to DEFAULT_ACCENT on a missing/malformed hex so a bad DB value can never
 * crash a render.
 *
 * Components are rounded to 3 decimals so the default accent #E69500
 * converts to exactly rgb(0.902, 0.584, 0) — the Watson Mattheus amber
 * constant the renderers hard-coded before the accent was wired through.
 * Existing output is therefore byte-identical when no custom accent is set.
 */

import { rgb, type RGB } from 'pdf-lib'
import { DEFAULT_ACCENT } from './theme'

const HEX_RE = /^#[0-9a-f]{6}$/i

export function accentColor(accentHex?: string | null): RGB {
  const trimmed = accentHex?.trim() ?? ''
  const hex = HEX_RE.test(trimmed) ? trimmed : DEFAULT_ACCENT
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number) => Math.round((v / 255) * 1000) / 1000
  return rgb(c((n >> 16) & 0xff), c((n >> 8) & 0xff), c(n & 0xff))
}
