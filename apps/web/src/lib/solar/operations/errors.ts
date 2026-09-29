/**
 * 00217's triggers raise "solar.<table>: <sentence>" with SQLSTATE 23514 / 23P01 / 23503 / 42501 / 23505.
 * Those sentences are written for people, so they are shown; anything else goes through
 * humanSolarError, which never echoes database text.
 */
import { humanSolarError } from '@/lib/solar/errors'

const PREFIX = /^solar\.[a-z_]+: /
const SHOWN = new Set(['23514', '23P01', '23503', '42501', '23505'])

export function opsError(err: { code?: string; message?: string } | null | undefined): string {
  const m = err?.message ?? ''
  if (SHOWN.has(err?.code ?? '') && PREFIX.test(m)) {
    const s = m.replace(PREFIX, '').trim()
    return `${s.charAt(0).toUpperCase()}${s.slice(1)}${s.endsWith('.') ? '' : '.'}`
  }
  return humanSolarError(err)
}
