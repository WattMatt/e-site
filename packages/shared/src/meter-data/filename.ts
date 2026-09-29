/**
 * Filename grammar of the office corpus (as-is/10 §1.3). Every field is a HINT: the consolidation
 * register (3a-ii) outranks it, and a PnP line-1 serial outranks the filename serial.
 */
export interface ParsedFilename {
  grammar: 'standard' | 'audit' | 'other'
  siteHint: string | null
  shopNo: string | null
  label: string | null
  areaM2Hint: number | null
  dupIndex: number | null
  serialHint: string | null
  extension: string
}

const EXT = /\.(csv|txt|xlsx|xls)$/i

function clean(s: string | undefined): string | null {
  if (s === undefined) return null
  const t = s.replace(/"/g, '').trim()
  return t === '' ? null : t
}

function findSerial(s: string | null): string | null {
  if (!s) return null
  const m = s.match(/(?<![0-9])([0-9]{7,8}[A-Z]?)(?![0-9])/)
  return m ? m[1] : null
}

export function parseMeterFilename(fileName: string): ParsedFilename {
  const base = fileName.split('/').pop() ?? fileName
  const extMatch = base.match(EXT)
  const extension = extMatch ? extMatch[1].toLowerCase() : ''
  let stem = extMatch ? base.slice(0, -extMatch[0].length) : base
  let dupIndex: number | null = null
  const dup = stem.match(/\s\((\d+)\)$/)
  if (dup) {
    dupIndex = Number(dup[1])
    stem = stem.slice(0, -dup[0].length)
  }

  const parts = stem.split(',')
  if (parts.length >= 4) {
    const areaRaw = clean(parts[parts.length - 1])
    const label = clean(parts[parts.length - 2])
    const shopParts = parts
      .slice(1, -2)
      .map((p) => p.replace(/"/g, '').trim())
      .filter((p) => p !== '')
    return {
      grammar: 'standard',
      siteHint: clean(parts[0]),
      shopNo: shopParts.length > 0 ? shopParts.join(', ') : null,
      label,
      areaM2Hint: areaRaw !== null && /^\d+(\.\d+)?$/.test(areaRaw) ? Number(areaRaw) : null,
      dupIndex,
      serialHint: findSerial(label),
      extension,
    }
  }

  const audit = stem.match(/^([A-Z0-9]{1,5})\s+-\s+(.+?)(?:\s+(\d+(?:\.\d+)?))?$/)
  if (audit) {
    return {
      grammar: 'audit',
      siteHint: audit[1],
      shopNo: null,
      label: audit[2].trim(),
      areaM2Hint: audit[3] ? Number(audit[3]) : null,
      dupIndex,
      serialHint: findSerial(audit[2]),
      extension,
    }
  }

  const label = clean(stem)
  return { grammar: 'other', siteHint: null, shopNo: null, label, areaM2Hint: null, dupIndex, serialHint: findSerial(label), extension }
}
