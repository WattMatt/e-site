/**
 * Runs queued tariffs.ingest_job rows (D-03: staff run ingestion; nothing is
 * published). PDF ingests need poppler's `pdftotext -layout`, which the web
 * server does not have, so the admin UI queues them and this worker, on the
 * staff Mac, executes them with the same core as scripts/tariffs/ingest.ts.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/ingest-worker.ts [--once] [--interval 60]
 *
 * --once: drain the queue and exit. Otherwise polls every --interval seconds.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSupabaseJobQueue } from '../../packages/shared/src/tariffs/ingest/supabase-jobs.ts'
import { createSupabaseTariffStore } from '../../packages/shared/src/tariffs/ingest/supabase-store.ts'
import { runIngestJob } from '../../packages/shared/src/tariffs/ingest/job-runner.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function pdfToText(bytes: Uint8Array): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'tariff-pdf-'))
  try {
    const file = join(dir, 'source.pdf')
    writeFileSync(file, bytes)
    return Promise.resolve(execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    console.log('usage: ingest-worker.ts [--once] [--interval 60]  (needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, pdftotext)')
    return
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    process.exit(2)
  }
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' })
  } catch {
    console.error('pdftotext is missing: brew install poppler')
    process.exit(2)
  }
  const queue = createSupabaseJobQueue(url, key)
  const store = createSupabaseTariffStore(url, key)
  const once = process.argv.includes('--once')
  const interval = Math.max(10, Number(arg('interval') ?? 60)) * 1000
  for (;;) {
    const job = await queue.claim()
    if (!job) {
      if (once) return
      await new Promise((r) => setTimeout(r, interval))
      continue
    }
    console.log(`job ${job.id}: ${job.parser} ${job.financialYear} ${job.licenseeName ?? ''}`)
    const outcome = await runIngestJob(job, {
      loadSource: (id) => queue.loadSource(id), download: (p) => queue.download(p), pdfToText, store,
      netBillingRulesSha256: job.parser === 'eskom_xlsm' ? await queue.rulesSha256() : null,
    })
    await queue.finish(job.id, outcome)
    console.log(`job ${job.id}: ${outcome.status}${outcome.error ? ` (${outcome.error})` : ''}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
