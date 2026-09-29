/**
 * Identity hashes (engine spec §2.1 step 0). The FILE hash is sha256 of the bytes. The BODY hash
 * is sha256 of a canonical text of the parsed series — channel descriptors plus every row's label
 * time, values and status — so that two files with different preambles (PnP B) or an escaped copy
 * (D) of an A file hash equal when their data is equal. Web Crypto only (runs in browser and Node).
 */
import type { RawRow } from './series'
import type { ChannelSpec } from './types'

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const src = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const copy = new Uint8Array(src.byteLength)
  copy.set(src)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const normCell = (c: string) => {
  const t = c.trim()
  return t !== '' && Number.isFinite(Number(t)) ? String(Number(t)) : t
}

export function canonicalBody(channels: ChannelSpec[], rows: RawRow[]): string {
  const header = channels.map((c) => `${c.quantity}:${c.direction}:${c.phase ?? ''}:${c.sourceUnit}`).join(';')
  const body = [...rows]
    .sort((a, b) => a.labelUtcMs - b.labelUtcMs || a.fileIndex - b.fileIndex)
    .map((r) => `${r.labelUtcMs};${r.cells.map(normCell).join(';')};${r.status?.trim() ?? ''}`)
  return [header, ...body].join('\n')
}
