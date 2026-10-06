/**
 * --apply half of scripts/solar-meter-archive.ts. Archive files belong to the org's Solar meter library
 * and to NO project (owner, 2026-10-05: the sites "cannot be and aren't projects"; migration 00237). For
 * each `load` decision: upload the raw bytes to solar-meter-raw at <org>/archive/<sha256>.csv, register
 * the meter_files row with no project and COMMIT it through commitMeterFile — the Solar import pipeline unchanged (server
 * re-parse, identity checks, readings read-back). Runs with the service role (write_readings and
 * clear_channel_readings admit a NULL auth.uid()); every import is audited against the owner who
 * ordered the load, marked source 'meter_archive_import'.
 * Re-running is safe: an accepted file is skipped; progress is appended to <out>/meter-archive-apply.jsonl.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { sha256Hex } from '@esite/shared/meter-data'
import { CommitError, commitMeterFile, type CommitBody } from '../meter-import/commit'
import { createMeterImportRepo, METER_RAW_BUCKET, type MeterImportRepo } from '../meter-import/repo'
import { registerStoredRawFile } from '../meter-import/register'
import { recordSolarAudit } from '../audit'
import type { ArchiveDecision, ArchiveFile, LoadDecision } from './plan'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const ARCHIVE_PROJECT_DESCRIPTION = 'Meter archive site: meters loaded into the Solar meter library from 006. METER CSV (verified files only), 2026-10-05.'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = ReturnType<typeof createClient<any, any, any>>

/** The commit body for one decision: every channel of the file listed, only the chosen ones included. */
export function commitBody(fileId: string, d: LoadDecision, f: ArchiveFile, existingMeterId: string | null = null): CommitBody {
  const chosen = new Map(d.channels.map((c) => [c.sourceColumn, c.isPrimary]))
  const all = f.outcome.kind === 'series' ? f.outcome.channels.map((c) => c.spec.sourceColumn) : []
  return {
    mode: 'series',
    fileId,
    // A later file of a PnP meter already created in this run is LINKED to it (lookupIdentity reports the
    // shared serial as a blocking same_serial conflict; 'link' to that very meter is the resolution).
    meter: existingMeterId ? { existingMeterId } : { new: {
      label: d.label, kind: d.kind, siteLabel: d.site, shopNo: d.shopNo, areaM2: d.areaM2, areaSource: d.areaM2 !== null ? 'filename' : null,
    } },
    identity: existingMeterId ? { resolution: 'link' } : { resolution: 'none' },
    channels: all.map((col) => ({ sourceColumn: col, include: chosen.has(col), ...(chosen.get(col) ? { isPrimary: true } : {}) })),
  }
}

export async function applyArchive(a: {
  decisions: ArchiveDecision[]
  files: Array<ArchiveFile & { path: string }>
  org: string | null
  user: string | null
  out: string
  client?: AnyClient
  /** Stop (cleanly, resumable) once the database filesystem is this full. */
  maxDiskPct?: number
  diskUsedPct?: () => Promise<number | null>
}): Promise<void> {
  if (!a.org || !UUID.test(a.org) || !a.user || !UUID.test(a.user)) throw new Error('--apply needs --org <uuid> and --user <uuid>')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!a.client && (!url || !key)) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  const client = a.client ?? createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } })
  const base = createMeterImportRepo(client as never)
  const repo: MeterImportRepo = {
    ...base,
    // meter_import_reports_accept_pair: accepted_by and accepted_at are set together. In the app the
    // signed-in user accepts; on the service path nobody is signed in, so the owner who ordered the load does.
    async acceptReport(reportId) {
      const { error } = await client.schema('solar').from('meter_import_reports').update({ accepted_at: new Date().toISOString(), accepted_by: a.user }).eq('id', reportId)
      if (error) throw new Error(`accept report: ${error.message}`)
    },
    // The one audit writer (audit-writers contract): attributed to the owner who ordered the load.
    async audit(projectId, verb, objectRef) {
      await recordSolarAudit({ projectId, actorId: a.user, verb, objectRef: { ...objectRef, source: 'meter_archive_import' } })
    },
  }
  const log = (row: Record<string, unknown>) => appendFileSync(join(a.out, 'meter-archive-apply.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n')
  const fileOf = new Map(a.files.map((f) => [`${f.site}|${f.fileName}`, f]))
  const loads = a.decisions.filter((d): d is LoadDecision => d.action === 'load')
  /** site|pnpSerial → the meter its first file created, so the meter's later files link to it. */
  const pnpMeters = new Map<string, string>()
  let done = 0
  let checked = 0
  for (const d of loads) {
    // Disk guard: every 10 files, read the filesystem's use. A full disk puts the whole database read-only.
    if (a.diskUsedPct && checked++ % 10 === 0) {
      const pct = await a.diskUsedPct()
      if (pct !== null && pct >= (a.maxDiskPct ?? 75)) {
        log({ result: 'stopped', reason: 'disk_threshold', diskUsedPct: pct })
        console.log(`STOPPED: database disk ${pct.toFixed(1)} % used (limit ${a.maxDiskPct ?? 75} %). ${done} imported; re-run to resume once the disk is larger.`)
        return
      }
    }
    const f = fileOf.get(`${d.site}|${d.fileName}`)!
    try {
      const projectId = null
      const bytes = new Uint8Array(readFileSync(f.path))
      const sha = await sha256Hex(bytes)
      const storagePath = `${a.org}/archive/${sha}.csv`
      const up = await client.storage.from(METER_RAW_BUCKET).upload(storagePath, bytes, { upsert: false, contentType: 'text/csv' })
      const exists = up.error && ((up.error as { statusCode?: string }).statusCode === '409' || /already exists/i.test(up.error.message))
      if (up.error && !exists) throw new Error(`upload: ${up.error.message}`)
      const reg = await registerStoredRawFile(repo, { projectId, orgId: a.org, storagePath, originalName: d.fileName, bytes, sha })
      if (reg.status === 409) {
        if (!exists) await client.storage.from(METER_RAW_BUCKET).remove([storagePath]) // no orphan object for a refused file
        log({ site: d.site, file: d.fileName, result: 'skipped', reason: 'already_in_library_elsewhere' })
        continue
      }
      const fileId = String(reg.body.fileId)
      const file = await repo.getFile(fileId)
      if (!file) throw new Error('registered file row not readable')
      if (file.status === 'accepted') { log({ site: d.site, file: d.fileName, result: 'already_imported', fileId }); continue }
      const linkKey = d.pnpSerial ? `${d.site}|${d.pnpSerial}` : null
      const existing = linkKey ? pnpMeters.get(linkKey) ?? null : null
      const r = await commitMeterFile(repo, { projectId, orgId: a.org, file }, commitBody(fileId, d, f, existing), { chunkSize: 20000 })
      if (linkKey && !existing && typeof r.meterId === 'string') pnpMeters.set(linkKey, r.meterId)
      done++
      log({ site: d.site, file: d.fileName, result: 'imported', fileId, meterId: r.meterId, channels: r.channels })
      if (done % 25 === 0) console.log(`… ${done}/${loads.length} imported`)
    } catch (e) {
      const body = e instanceof CommitError ? e.body : { error: e instanceof Error ? e.message : String(e) }
      log({ site: d.site, file: d.fileName, result: 'failed', ...body })
      console.error(`FAILED ${d.site} / ${d.fileName}: ${JSON.stringify(body).slice(0, 300)}`)
    }
  }
  console.log(`done: ${done} imported of ${loads.length} planned; see meter-archive-apply.jsonl`)
}

/**
 * Retire the planning projects the FIRST archive load created (identified by ARCHIVE_PROJECT_DESCRIPTION):
 * each of their meter files moves to the org archive (raw bytes to <org>/archive/<sha>.<ext>, then the row
 * detached, which 00237's bind trigger allows the service role only), their Solar audit rows are written to
 * <out>/retired-projects-audit.json, and only then is a project with no files left deleted. Meters and
 * readings belong to the org library and are untouched. Dry run unless `apply` is true.
 */
export async function retireArchiveProjects(a: { org: string; out: string; apply: boolean; client?: AnyClient }): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const client = a.client ?? createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: projects, error } = await client.schema('projects').from('projects').select('id, name').eq('organisation_id', a.org).eq('description', ARCHIVE_PROJECT_DESCRIPTION)
  if (error) throw new Error(`projects: ${error.message}`)
  const list = (projects ?? []) as Array<{ id: string; name: string }>
  console.log(`${list.length} archive project(s) to retire${a.apply ? '' : ' (dry run; pass --apply)'}`)
  const auditDump: unknown[] = []
  for (const p of list) {
    const { data: files, error: fe } = await client.schema('solar').from('meter_files').select('id, sha256, storage_path').eq('project_id', p.id)
    if (fe) throw new Error(`files of ${p.name}: ${fe.message}`)
    const { data: audit } = await client.schema('solar').from('audit_events').select('*').eq('project_id', p.id)
    auditDump.push({ project: p, audit: audit ?? [] })
    console.log(`${p.name}: ${(files ?? []).length} file(s), ${(audit ?? []).length} audit row(s)`)
    if (!a.apply) continue
    for (const f of (files ?? []) as Array<{ id: string; sha256: string; storage_path: string }>) {
      const ext = f.storage_path.match(/\.[a-z]+$/)?.[0] ?? '.csv'
      const target = `${a.org}/archive/${f.sha256}${ext}`
      const mv = await client.storage.from(METER_RAW_BUCKET).move(f.storage_path, target)
      if (mv.error && !/not.?found|already exists/i.test(mv.error.message)) throw new Error(`move ${f.storage_path}: ${mv.error.message}`)
      const { error: ue } = await client.schema('solar').from('meter_files').update({ project_id: null, storage_path: target }).eq('id', f.id)
      if (ue) throw new Error(`detach ${f.id}: ${ue.message}`)
    }
    const { count } = await client.schema('solar').from('meter_files').select('id', { count: 'exact', head: true }).eq('project_id', p.id)
    if (count) throw new Error(`${p.name} still has ${count} file(s); not deleted`)
    appendFileSync(join(a.out, 'retired-projects-audit.json'), JSON.stringify(auditDump[auditDump.length - 1]) + '\n')
    const { error: de } = await client.schema('projects').from('projects').delete().eq('id', p.id).eq('description', ARCHIVE_PROJECT_DESCRIPTION)
    if (de) throw new Error(`delete ${p.name}: ${de.message}`)
    console.log(`  retired ${p.name}`)
  }
}
