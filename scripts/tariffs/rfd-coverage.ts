/**
 * Coverage of the NERSA RfD parser over a manifest of RfD PDFs. Reads only;
 * writes nothing to any database.
 *
 *   pnpm --filter @esite/shared exec tsx ../../scripts/tariffs/rfd-coverage.ts <dir-with-manifest.csv> \
 *     [--text-cache <dir>] [--dump <out.json>] [--digests <out.json>] [--only LICENSEE,LICENSEE]
 *
 * Per file: tariffs, charges, and blocking / review issue counts (parser issues
 * plus validateTariffYear). --text-cache keeps pdftotext output between runs.
 * --dump writes every file's full parse (tariffs + issues) as JSON, for
 * before/after regression comparisons. --digests writes, for every file that
 * yields a tariff, sha256(JSON.stringify(parse)) — the form the committed
 * regression guard in real-files.test.ts checks.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseRfdText } from '../../packages/shared/src/tariffs/parsers/rfd-text.ts'
import { validateTariffYear } from '../../packages/shared/src/tariffs/validators.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** Minimal CSV reader: quoted fields, doubled quotes, no embedded newlines. */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out
}

function main(): void {
  const dir = process.argv[2]
  if (!dir || dir.startsWith('--')) {
    console.error('usage: rfd-coverage.ts <dir-with-manifest.csv> [--text-cache DIR] [--dump OUT.json] [--only A,B]')
    process.exit(2)
  }
  const cache = arg('text-cache')
  if (cache) mkdirSync(cache, { recursive: true })
  const only = arg('only')?.split(',').map((s) => s.trim().toUpperCase())
  const lines = readFileSync(join(dir, 'manifest.csv'), 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '')
  const head = parseCsvLine(lines[0])
  const col = (n: string): number => head.indexOf(n)
  const rows = lines.slice(1).map(parseCsvLine)

  const dump: Record<string, unknown> = {}
  const digests: { file: string; sha256: string; digest: string }[] = []
  const tot = { files: 0, withTariffs: 0, tariffs: 0, charges: 0, block: 0, review: 0 }
  console.log(['licensee', 'tariffs', 'charges', 'block', 'review', 'increase%', 'file'].join('\t'))
  for (const r of rows) {
    const licensee = r[col('licensee')]
    const file = r[col('filename')]
    if (only && !only.includes(licensee.toUpperCase())) continue
    const path = join(dir, file)
    const bytes = readFileSync(path)
    const sha = createHash('sha256').update(bytes).digest('hex')
    const cached = cache ? join(cache, `${sha}.txt`) : null
    let text: string
    if (cached && existsSync(cached)) text = readFileSync(cached, 'utf8')
    else {
      text = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      if (cached) writeFileSync(cached, text)
    }
    const parsed = parseRfdText(text, { fileSha256: sha })
    const issues = [...parsed.issues, ...validateTariffYear(parsed.tariffs)]
    const charges = parsed.tariffs.reduce((n, t) => n + t.charges.length, 0)
    const block = issues.filter((i) => i.severity === 'block').length
    const review = issues.filter((i) => i.severity === 'review').length
    tot.files++
    if (parsed.tariffs.length > 0) tot.withTariffs++
    tot.tariffs += parsed.tariffs.length
    tot.charges += charges
    tot.block += block
    tot.review += review
    if (parsed.tariffs.length > 0) digests.push({ file, sha256: sha, digest: createHash('sha256').update(JSON.stringify(parsed)).digest('hex') })
    const key = file in dump ? `${file}#${sha}` : file
    dump[key] = { licensee, tariffs: parsed.tariffs, increasePct: parsed.increasePct, issues, unresolved: parsed.unresolved }
    console.log([licensee, parsed.tariffs.length, charges, block, review, parsed.increasePct ?? '', file.split('/').pop()].join('\t'))
  }
  console.log(`TOTAL files=${tot.files} with_tariffs=${tot.withTariffs} tariffs=${tot.tariffs} charges=${tot.charges} block=${tot.block} review=${tot.review}`)
  const out = arg('dump')
  if (out) writeFileSync(out, JSON.stringify(dump, null, 1))
  const dg = arg('digests')
  if (dg) writeFileSync(dg, `${JSON.stringify(digests, null, 1)}\n`)
}

main()
