/**
 * The meter-archive plan (owner decision 2026-10-05: all 42 sites of `006. METER CSV` into the
 * Solar ORG meter library, VERIFIED data only). Pure: parsed outcomes in, one decision per file out.
 * Nothing here touches the database; scripts/solar-meter-archive.ts runs it and, with --apply,
 * commits each `load` decision through the Solar import pipeline (commitMeterFile) unchanged.
 *
 * What "verified" means (docs/solar/as-is/10-meter-csv-source.md §1.4–1.5):
 *  - Formats A (sep= export) and C (PnP energy) are mostly sound: a file loads unless its data body is
 *    a duplicate. Identical bodies in ONE site load once; identical bodies across DIFFERENT sites (the
 *    crossed Flamwood/Fourways pairs) load nowhere.
 *  - Format B (PnP power) is mostly MIS-FILED by a failed downloader: 703 files, 29 serials. A B file
 *    loads only if (1) the downloader log names its line-1 serial(s) as THIS site's meter, (2) a serial in
 *    the filename, if any, is the line-1 serial, and (3) its body appears in no other site.
 *  - Never: non-data shapes (D/E/F/G, empty), water, daily-only files, files with parser errors.
 */
import { siteKey, type MeterParseOutcome } from '@esite/shared/meter-data'
import { meterKindFromLabel } from '@esite/shared/load-profile'

/** The label → meter-kind rule lives in @esite/shared/load-profile (one rule for the archive and the Load profile tab). */
export { meterKindFromLabel as kindFromLabel }

export type ArchiveKind = 'tenant' | 'bulk' | 'council' | 'generator' | 'solar' | 'common' | 'vacant' | 'check' | 'virtual' | 'unknown'

export type SkipReason =
  | 'not_meter_data'
  | 'water'
  | 'daily_only'
  | 'parser_errors'
  | 'no_load_channel'
  | 'duplicate_body'
  | 'cross_site_duplicate'
  | 'pnp_serial_not_this_site'
  | 'pnp_serial_unknown'
  | 'pnp_filename_serial_mismatch'
  | 'pnp_no_serial'

/** PnP serials: the line-1 serial keeps leading zeros ("01180385"), the downloader log drops them ("1180385"). */
export const serialKey = (s: string) => s.trim().replace(/^0+(?=\d)/, '')
/** Site key for folders and the log's mall names; the log misspells "Thabazimbi Square" as "Spuare". */
export const archiveSiteKey = (s: string) => siteKey(s.replace(/\bSPUARE\b/gi, 'SQUARE'))

export interface ArchiveFile {
  site: string
  fileName: string
  outcome: MeterParseOutcome
}

export interface LoadDecision {
  action: 'load'
  site: string
  fileName: string
  kind: ArchiveKind
  label: string
  shopNo: string | null
  areaM2: number | null
  /** Columns to commit: the primary active-power channel and, when present, its apparent-power (kVA) channel. */
  channels: Array<{ sourceColumn: string; isPrimary: boolean }>
  readings: number
  bodySha256: string
  /** PnP (format B) meters: the serial key, so later files of the same meter link to it instead of minting another. */
  pnpSerial: string | null
}
export interface SkipDecision {
  action: 'skip'
  site: string
  fileName: string
  reason: SkipReason
  detail: string
}
export type ArchiveDecision = LoadDecision | SkipDecision

function choose(outcome: Extract<MeterParseOutcome, { kind: 'series' }>): LoadDecision['channels'] | null {
  const usable = outcome.channels.filter((c) => !c.coverageOnly && c.intervalMin < 1440 && c.stats.usable > 0)
  const isKw = (c: (typeof usable)[number]) => (c.spec.quantity === 'active_power' || c.spec.quantity === 'active_energy') && c.spec.direction !== 'export' && c.spec.phase === null
  const primary = usable.find((c) => c.spec.sourceColumn === outcome.primaryColumn && isKw(c)) ?? usable.find(isKw)
  if (!primary) return null
  const kva = usable.find((c) => (c.spec.quantity === 'apparent_power' || c.spec.quantity === 'apparent_energy') && c.spec.phase === null && !c.spec.isScalarSum && c.intervalMin === primary.intervalMin)
  return [{ sourceColumn: primary.spec.sourceColumn, isPrimary: true }, ...(kva ? [{ sourceColumn: kva.spec.sourceColumn, isPrimary: false }] : [])]
}

/**
 * @param serialSite  serial → siteKey of the mall the downloader log lists it under.
 * @param serialName  serial → the log's own name for the meter ("E0385 ; Solar 1 ; Rustenburg Mall ; Rustenburg").
 */
export function planArchive(files: ArchiveFile[], serialSite: ReadonlyMap<string, string>, serialName: ReadonlyMap<string, string> = new Map()): ArchiveDecision[] {
  // Which sites does each data body appear in? (Deterministic: files sorted by site then name.)
  // An original wins over its numbered copy ("X (2).csv"), so the loaded file keeps the clean name.
  const dup = (f: ArchiveFile) => (f.outcome.kind === 'series' || f.outcome.kind === 'rejected' ? f.outcome.filename.dupIndex ?? 0 : 0)
  const ordered = [...files].sort((a, b) => a.site.localeCompare(b.site) || dup(a) - dup(b) || a.fileName.localeCompare(b.fileName))
  const bodySites = new Map<string, Set<string>>()
  for (const f of ordered) {
    if (f.outcome.kind !== 'series') continue
    const set = bodySites.get(f.outcome.bodySha256) ?? new Set<string>()
    // The EXACT folder: siteKey folds RUSTENBURG MALL / RUSTENBURG PLAZA (and BIYELA CENTRE / SQUARE) together.
    set.add(f.site.trim().toUpperCase())
    bodySites.set(f.outcome.bodySha256, set)
  }
  const loadedBodies = new Set<string>()
  const skip = (f: ArchiveFile, reason: SkipReason, detail: string): SkipDecision => ({ action: 'skip', site: f.site, fileName: f.fileName, reason, detail })

  return ordered.map((f): ArchiveDecision => {
    const o = f.outcome
    if (o.kind !== 'series') {
      const water = o.report.errors.some((e) => e.code === 'water_channel')
      return skip(f, water ? 'water' : 'not_meter_data', o.report.errors.map((e) => e.message).join(' ') || o.format)
    }
    if (o.report.errors.length > 0) return skip(f, 'parser_errors', o.report.errors.map((e) => e.code).join(', '))
    if (o.channels.every((c) => c.coverageOnly || c.intervalMin >= 1440)) return skip(f, 'daily_only', 'Daily totals only')
    const channels = choose(o)
    if (!channels) return skip(f, 'no_load_channel', 'No usable active-power import channel')

    if (o.format !== 'A' && o.format !== 'B' && o.format !== 'C') return skip(f, 'not_meter_data', `Format ${o.format} is not part of the verified archive (A, B and C only)`)
    if (o.format === 'B') {
      if (o.sourceSerials.length === 0) return skip(f, 'pnp_no_serial', 'A PnP export with no serial on line 1')
      // A PnP file belongs where the downloader log puts its serial(s). The failed downloader copied one
      // meter's body into other malls' slots, so the copy at the serial's own site loads and the
      // misfiled copies elsewhere are skipped by this same test.
      const here = archiveSiteKey(f.site)
      const keys = o.sourceSerials.map(serialKey)
      const unknown = keys.filter((s) => !serialSite.has(s))
      if (unknown.length > 0) return skip(f, 'pnp_serial_unknown', `Serial ${unknown.join(', ')} is not in the downloader log`)
      const elsewhere = keys.filter((s) => serialSite.get(s) !== here)
      if (elsewhere.length > 0) return skip(f, 'pnp_serial_not_this_site', `Serial ${elsewhere.join(', ')} belongs to ${elsewhere.map((s) => serialSite.get(s)).join(', ')}`)
      const named = o.filename.serialHint
      if (named && !keys.includes(serialKey(named))) return skip(f, 'pnp_filename_serial_mismatch', `Filename names ${named}; the file holds ${o.sourceSerials.join(', ')}`)
    } else {
      // No serial to settle ownership (formats A and C): the same data under two sites is ambiguous.
      const sites = bodySites.get(o.bodySha256) as Set<string>
      if (sites.size > 1) return skip(f, 'cross_site_duplicate', `The same data appears under ${sites.size} sites`)
    }

    if (loadedBodies.has(o.bodySha256)) return skip(f, 'duplicate_body', 'Identical data already loaded from another file of this site')
    loadedBodies.add(o.bodySha256)

    const primary = o.channels.find((c) => c.spec.sourceColumn === channels[0].sourceColumn)!
    // A PnP filename is unreliable (the downloader wrote bodies into the wrong slots); the log names the meter.
    const logName = o.format === 'B' && o.sourceSerials.length === 1 ? logLabel(serialName.get(serialKey(o.sourceSerials[0])), f.site) : null
    const base = logName ?? o.filename.label ?? (o.filename.shopNo ? `Shop ${o.filename.shopNo}` : f.fileName.replace(/\.[^.]+$/, ''))
    // A numbered copy ("X, 450 (2).csv") with different data is a second meter: keep the number visible.
    const label = `${base}${o.filename.dupIndex ? ` (${o.filename.dupIndex})` : ''}`.slice(0, 200)
    // A PnP filename is unreliable for shop and area too; only the label is taken from the log.
    const pnp = o.format === 'B'
    return {
      action: 'load',
      site: f.site,
      fileName: f.fileName,
      kind: meterKindFromLabel(logName ? logName.replace(/^E\d+\s·\s/, '') : o.filename.label, o.sourceSerials.length) as ArchiveKind,
      label,
      shopNo: pnp ? null : o.filename.shopNo,
      areaM2: !pnp && o.filename.areaM2Hint !== null && o.filename.areaM2Hint > 0 ? o.filename.areaM2Hint : null,
      channels,
      readings: Math.max(primary.readings.length, primary.stats.slots), // the script drops readings after parsing; slots is the same count
      bodySha256: o.bodySha256,
      pnpSerial: pnp && o.sourceSerials.length === 1 ? serialKey(o.sourceSerials[0]) : null,
    }
  })
}

/** "E0385 ; Solar 1 ; Rustenburg Mall ; Rustenburg" → "E0385 · Solar 1": the mall segment and everything after it dropped. */
export function logLabel(name: string | undefined, site: string): string | null {
  if (!name) return null
  const parts = name.split(';').map((p) => p.trim()).filter((p) => p && p.toLowerCase() !== 'nan')
  const here = archiveSiteKey(site)
  const mall = parts.findIndex((p) => archiveSiteKey(p) === here)
  const kept = parts.slice(0, mall >= 0 ? mall : Math.max(1, parts.length - 1))
  return kept.length ? kept.join(' · ') : null
}

/** Rough on-disk size of the readings a plan would write (heap row + primary-key index entry). */
export const BYTES_PER_READING = 120

export function summarise(decisions: ArchiveDecision[]) {
  const bySite = new Map<string, { load: number; skip: number; readings: number }>()
  const reasons = new Map<SkipReason, number>()
  let readings = 0
  for (const d of decisions) {
    const s = bySite.get(d.site) ?? { load: 0, skip: 0, readings: 0 }
    if (d.action === 'load') {
      s.load++
      const rows = d.readings * d.channels.length
      s.readings += rows
      readings += rows
    } else {
      s.skip++
      reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1)
    }
    bySite.set(d.site, s)
  }
  return {
    files: decisions.length,
    load: decisions.filter((d) => d.action === 'load').length,
    skip: decisions.filter((d) => d.action === 'skip').length,
    readings,
    estimatedBytes: readings * BYTES_PER_READING,
    reasons: Object.fromEntries([...reasons.entries()].sort((a, b) => b[1] - a[1])),
    bySite: Object.fromEntries([...bySite.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  }
}
