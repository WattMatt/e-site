import 'server-only'
/**
 * The two Phase 4b buckets are SERVICE-ONLY (00215: no storage.objects policy for authenticated).
 * Call these only with the service client and only after the caller's Solar gate has passed.
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export const RUNS_BUCKET = 'solar-runs'
export const WEATHER_BUCKET = 'solar-weather'
export type SolarBucket = typeof RUNS_BUCKET | typeof WEATHER_BUCKET

export const runCsvPath = (orgId: string, projectId: string, caseId: string, runId: string) => `${orgId}/${projectId}/${caseId}/${runId}.csv.gz`
export const weatherPath = (orgId: string, datasetId: string) => `${orgId}/${datasetId}.csv.gz`

export async function putGzipText(svc: AnyClient, bucket: SolarBucket, path: string, text: string): Promise<void> {
  const { error } = await svc.storage.from(bucket).upload(path, gzipSync(Buffer.from(text, 'utf8')), { contentType: 'application/gzip', upsert: false })
  if (error) throw new Error(`storage upload failed: ${error.message}`)
}

export async function getGzipText(svc: AnyClient, bucket: SolarBucket, path: string): Promise<string> {
  const { data, error } = await svc.storage.from(bucket).download(path)
  if (error || !data) throw new Error('stored file not found')
  return gunzipSync(Buffer.from(await data.arrayBuffer())).toString('utf8')
}

export async function removeObject(svc: AnyClient, bucket: SolarBucket, path: string): Promise<void> {
  const { error } = await svc.storage.from(bucket).remove([path])
  if (error) console.error('[solar-storage] remove failed', { bucket, path, message: error.message })
}
