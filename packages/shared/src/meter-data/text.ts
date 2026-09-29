export interface DecodedText {
  text: string
  encoding: 'utf-8' | 'utf-8-bom' | 'latin1'
  lineEnding: 'crlf' | 'lf' | 'mixed' | 'none'
}

/** UTF-8 (BOM stripped); anything that is not valid UTF-8 is read as Windows-1252 and reported. */
export function decodeMeterText(bytes: Uint8Array): DecodedText {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  const body = hasBom ? bytes.subarray(3) : bytes
  let text: string
  let encoding: DecodedText['encoding']
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    encoding = hasBom ? 'utf-8-bom' : 'utf-8'
  } catch {
    text = new TextDecoder('windows-1252').decode(body)
    encoding = 'latin1'
  }
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length
  const lineEnding = lf === 0 ? 'none' : crlf === lf ? 'crlf' : crlf === 0 ? 'lf' : 'mixed'
  return { text, encoding, lineEnding }
}

export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Quote-aware row split. Cells are trimmed; a quote opens a quoted cell only at the start of a cell
 * (after optional spaces), which is what PnP's `, "…"` headers need. `""` inside quotes is a quote.
 */
export function splitRow(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += ch
    } else if (ch === '"' && cur.trim() === '') {
      inQuotes = true
      cur = ''
    } else if (ch === delimiter) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}
