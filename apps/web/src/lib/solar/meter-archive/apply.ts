/**
 * --apply half of scripts/solar-meter-archive.ts. For each `load` decision: find or create the site's
 * project, upload the raw bytes to solar-meter-raw at <org>/<project>/<sha256>.csv, register the
 * meter_files row and COMMIT it through commitMeterFile — the Solar import pipeline unchanged (server
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

export async function findOrCreateProject(client: AnyClient, org: string, user: string, site: string): Promise<{ id: string; created: boolean }> {
  const p = client.schema('projects').from('projects')
  const { data: found, error } = await p.select('id, description').eq('organisation_id', org).eq('name', site).limit(2)
  if (error) throw new Error(`project lookup ${site}: ${error.message}`)
  if ((found ?? []).length > 1) throw new Error(`more than one project is named "${site}"`)
  if (found && found.length === 1) {
    // Reuse only a project this import made (a re-run). A real project of the same name could carry a
    // Solar study, and commitMeterFile would link every archive meter into it: refuse instead.
    const row = found[0] as { id: string; description: string | null }
    if (row.description !== ARCHIVE_PROJECT_DESCRIPTION) throw new Error(`a project named "${site}" already exists and was not made by this import; rename one of them`)
    return { id: row.id, created: false }
  }
  const { data, error: e2 } = await p.insert({
    organisation_id: org, name: site, status: 'planning', project_type: 'retail', description: ARCHIVE_PROJECT_DESCRIPTION, created_by: user,
  }).select('id').single()
  if (e2) throw new Error(`create project ${site}: ${e2.message}`)
  return { id: (data as { id: string }).id, created: true }
}

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
  const projects = new Map<string, string>()
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
      let projectId = projects.get(d.site)
      if (!projectId) {
        const p = await findOrCreateProject(client, a.org, a.user, d.site)
        projectId = p.id
        projects.set(d.site, projectId)
        log({ site: d.site, project: projectId, projectCreated: p.created })
      }
      const bytes = new Uint8Array(readFileSync(f.path))
      const sha = await sha256Hex(bytes)
      const storagePath = `${a.org}/${projectId}/${sha}.csv`
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
